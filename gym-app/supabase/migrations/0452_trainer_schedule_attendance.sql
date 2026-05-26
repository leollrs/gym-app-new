-- 0452_trainer_schedule_attendance.sql
-- ---------------------------------------------------------------------------
-- Trainer scheduling + attendance + richer money views. Builds on 0450/0451.
--   • trainer_client_schedule: a client's standing WEEKLY plan (day + time).
--     Saving it materializes the next 8 weeks of trainer_sessions (from_schedule)
--     so they show on the existing calendar — "properly scheduled".
--   • get_client_attendance: per-day attendance for a range, flagged
--     with_trainer (completed session with this trainer) vs alone.
--   • get_trainer_money_overview(p_month): now takes a month so Cobros can page
--     to past months; per-client row also carries attended counts for the month.
--   • get_trainer_year_overview(p_year): income per month + per client.
--   • get_client_payment_status: + this-month collected & attendance summary.
-- Timezone: PR gyms (America/Puerto_Rico, no DST) — wall-clock times are stored
-- against that zone so they display correctly on members' devices.
-- ---------------------------------------------------------------------------

ALTER TABLE public.trainer_sessions
  ADD COLUMN IF NOT EXISTS from_schedule BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.trainer_client_schedule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id        UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time    TIME NOT NULL,
  duration_mins SMALLINT NOT NULL DEFAULT 60,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trainer_id, client_id, day_of_week, start_time)
);
CREATE INDEX IF NOT EXISTS trainer_client_schedule_pair_idx ON public.trainer_client_schedule (trainer_id, client_id);

ALTER TABLE public.trainer_client_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tcs_trainer_all" ON public.trainer_client_schedule;
CREATE POLICY "tcs_trainer_all" ON public.trainer_client_schedule
  FOR ALL TO authenticated USING (trainer_id = auth.uid()) WITH CHECK (trainer_id = auth.uid());
DROP POLICY IF EXISTS "tcs_client_select" ON public.trainer_client_schedule;
CREATE POLICY "tcs_client_select" ON public.trainer_client_schedule
  FOR SELECT TO authenticated USING (client_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_client_schedule TO authenticated;

-- ── set_client_schedule ────────────────────────────────────────────────────
-- Replaces the client's standing schedule and re-materializes the next 8 weeks
-- of sessions. p_slots = [{ "day_of_week":1, "start_time":"09:00", "duration_mins":60 }, …]
CREATE OR REPLACE FUNCTION public.set_client_schedule(p_client_id UUID, p_slots JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID := auth.uid(); v_gym UUID;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  -- Schedule is the trainer's own arrangement; require an active trainer link.
  SELECT gym_id INTO v_gym FROM trainer_clients
    WHERE trainer_id = uid AND client_id = p_client_id AND is_active = true LIMIT 1;
  IF v_gym IS NULL THEN
    SELECT gym_id INTO v_gym FROM profiles WHERE id = p_client_id;
  END IF;

  -- Clear future schedule-generated sessions + the old template.
  DELETE FROM trainer_sessions
    WHERE trainer_id = uid AND client_id = p_client_id
      AND from_schedule = true AND scheduled_at >= date_trunc('day', now());
  DELETE FROM trainer_client_schedule WHERE trainer_id = uid AND client_id = p_client_id;

  -- Insert the new template.
  INSERT INTO trainer_client_schedule (trainer_id, client_id, gym_id, day_of_week, start_time, duration_mins)
  SELECT uid, p_client_id, v_gym,
         (s->>'day_of_week')::int,
         (s->>'start_time')::time,
         COALESCE((s->>'duration_mins')::int, 60)
  FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) s;

  -- Materialize the next 8 weeks onto the calendar.
  INSERT INTO trainer_sessions (gym_id, trainer_id, client_id, title, scheduled_at, duration_mins, status, from_schedule)
  SELECT v_gym, uid, p_client_id, 'Entrenamiento',
         ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico'),
         sch.duration_mins, 'scheduled', true
  FROM trainer_client_schedule sch
  CROSS JOIN generate_series(date_trunc('day', now())::date, (now() + interval '8 weeks')::date, '1 day') d
  WHERE sch.trainer_id = uid AND sch.client_id = p_client_id
    AND EXTRACT(dow FROM d) = sch.day_of_week
    AND ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico') >= now();
END;
$$;

-- ── get_client_schedule ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_schedule(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'day_of_week', day_of_week,
      'start_time', to_char(start_time, 'HH24:MI'),
      'duration_mins', duration_mins
    ) ORDER BY day_of_week, start_time)
    FROM trainer_client_schedule
    WHERE client_id = p_client_id
      AND trainer_id = (SELECT trainer_id FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = auth.uid()) DESC LIMIT 1)
  ), '[]'::jsonb);
END;
$$;

-- ── get_client_attendance ──────────────────────────────────────────────────
-- Days the client trained in [p_from, p_to], each flagged with_trainer.
CREATE OR REPLACE FUNCTION public.get_client_attendance(p_client_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN COALESCE((
    WITH trained AS (
      SELECT DISTINCT (checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date AS d
        FROM check_ins
        WHERE profile_id = p_client_id
          AND checked_in_at >= p_from::timestamptz AND checked_in_at < (p_to + 1)::timestamptz
      UNION
      SELECT DISTINCT (completed_at AT TIME ZONE 'America/Puerto_Rico')::date
        FROM workout_sessions
        WHERE profile_id = p_client_id AND status = 'completed'
          AND completed_at >= p_from::timestamptz AND completed_at < (p_to + 1)::timestamptz
    ),
    withtr AS (
      SELECT DISTINCT (scheduled_at AT TIME ZONE 'America/Puerto_Rico')::date AS d
        FROM trainer_sessions
        WHERE client_id = p_client_id AND trainer_id = uid AND status = 'completed'
          AND scheduled_at >= p_from::timestamptz AND scheduled_at < (p_to + 1)::timestamptz
    ),
    alldays AS (
      SELECT d FROM trained UNION SELECT d FROM withtr
    )
    SELECT jsonb_agg(jsonb_build_object(
      'day', to_char(d, 'YYYY-MM-DD'),
      'with_trainer', (d IN (SELECT d FROM withtr))
    ) ORDER BY d)
    FROM alldays
  ), '[]'::jsonb);
END;
$$;

-- ── _trainer_month_attendance helper counts (inlined below) ────────────────

-- ── get_trainer_money_overview(p_month) ────────────────────────────────────
-- Now month-aware (NULL = current). Per-client row also carries this month's
-- attended_total / attended_with_trainer for the income view.
-- Drop the 0451 no-arg version first so the no-param RPC call isn't ambiguous.
DROP FUNCTION IF EXISTS public.get_trainer_money_overview();
CREATE OR REPLACE FUNCTION public.get_trainer_money_overview(p_month DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid       UUID := auth.uid();
  v_month   DATE := COALESCE(date_trunc('month', p_month)::date, date_trunc('month', now())::date);
  v_today   INT  := EXTRACT(day FROM now())::int;
  v_cur_mon DATE := date_trunc('month', now())::date;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN (
    WITH cli AS (
      SELECT
        tc.client_id, tc.monthly_fee, tc.default_payment_method, tc.billing_day,
        p.full_name, p.username, p.avatar_url, p.avatar_type, p.avatar_value, p.phone_number,
        mp.amount AS paid_amount, mp.paid_at AS paid_at, (mp.profile_id IS NOT NULL) AS paid_this_month,
        (SELECT count(*) FROM check_ins ci
           WHERE ci.profile_id = tc.client_id
             AND (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
             AND (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')) AS attended_total,
        (SELECT count(*) FROM trainer_sessions ts
           WHERE ts.client_id = tc.client_id AND ts.trainer_id = uid AND ts.status = 'completed'
             AND (ts.scheduled_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
             AND (ts.scheduled_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')) AS attended_with_trainer
      FROM trainer_clients tc
      JOIN profiles p ON p.id = tc.client_id
      LEFT JOIN member_payments mp
        ON mp.profile_id = tc.client_id AND mp.period_month = v_month
      WHERE tc.trainer_id = uid AND tc.is_active = true
    )
    SELECT jsonb_build_object(
      'month',           v_month,
      'is_current',      (v_month = v_cur_mon),
      'active_clients',  (SELECT count(*) FROM cli),
      'with_fee',        (SELECT count(*) FROM cli WHERE COALESCE(monthly_fee, 0) > 0),
      'expected_total',  (SELECT COALESCE(sum(monthly_fee), 0) FROM cli WHERE COALESCE(monthly_fee, 0) > 0),
      'collected_total', (SELECT COALESCE(sum(paid_amount), 0) FROM cli WHERE paid_this_month),
      'collected_count', (SELECT count(*) FROM cli WHERE paid_this_month),
      'pending_count',   (SELECT count(*) FROM cli WHERE COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month),
      'pending_total',   (SELECT COALESCE(sum(monthly_fee), 0) FROM cli WHERE COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month),
      'clients', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'client_id', client_id, 'full_name', full_name, 'username', username,
          'avatar_url', avatar_url, 'avatar_type', avatar_type, 'avatar_value', avatar_value,
          'phone_number', phone_number,
          'monthly_fee', monthly_fee, 'payment_method', default_payment_method, 'billing_day', billing_day,
          'paid_this_month', paid_this_month, 'paid_amount', paid_amount, 'paid_at', paid_at,
          'attended_total', attended_total, 'attended_with_trainer', attended_with_trainer,
          'overdue_days', CASE
            WHEN COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month
                 AND billing_day IS NOT NULL AND v_month = v_cur_mon AND v_today > billing_day
            THEN v_today - billing_day ELSE 0 END
        ) ORDER BY paid_this_month ASC, COALESCE(monthly_fee, 0) DESC, full_name ASC)
        FROM cli
      ), '[]'::jsonb)
    )
  );
END;
$$;

-- ── get_trainer_year_overview(p_year) ──────────────────────────────────────
-- Income per month + per client for a calendar year (collected = member_payments
-- by period_month for the trainer's active clients).
CREATE OR REPLACE FUNCTION public.get_trainer_year_overview(p_year INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid    UUID := auth.uid();
  v_year INT  := COALESCE(p_year, EXTRACT(year FROM now())::int);
  v_from DATE := make_date(v_year, 1, 1);
  v_to   DATE := make_date(v_year, 12, 31);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN (
    WITH pays AS (
      SELECT mp.profile_id, EXTRACT(month FROM mp.period_month)::int AS mon, mp.amount, mp.paid_at
      FROM member_payments mp
      JOIN trainer_clients tc ON tc.client_id = mp.profile_id AND tc.trainer_id = uid AND tc.is_active = true
      WHERE mp.period_month BETWEEN v_from AND v_to
    )
    SELECT jsonb_build_object(
      'year', v_year,
      'total', (SELECT COALESCE(sum(amount), 0) FROM pays),
      'paid_count', (SELECT count(*) FROM pays),
      'months', (
        SELECT jsonb_agg(jsonb_build_object('month', m, 'collected', COALESCE(s.amt, 0), 'count', COALESCE(s.cnt, 0)) ORDER BY m)
        FROM generate_series(1, 12) m
        LEFT JOIN (SELECT mon, sum(amount) amt, count(*) cnt FROM pays GROUP BY mon) s ON s.mon = m
      ),
      'clients', COALESCE((
        SELECT jsonb_agg(c ORDER BY (c->>'total')::numeric DESC)
        FROM (
          SELECT jsonb_build_object(
            'client_id', tc.client_id,
            'full_name', p.full_name,
            'avatar_url', p.avatar_url,
            'avatar_type', p.avatar_type,
            'avatar_value', p.avatar_value,
            'total', COALESCE((SELECT sum(amount) FROM pays WHERE profile_id = tc.client_id), 0),
            'months', (
              SELECT jsonb_agg(COALESCE((SELECT sum(amount) FROM pays WHERE profile_id = tc.client_id AND mon = m), 0) ORDER BY m)
              FROM generate_series(1, 12) m
            )
          ) AS c
          FROM trainer_clients tc
          JOIN profiles p ON p.id = tc.client_id
          WHERE tc.trainer_id = uid AND tc.is_active = true
            AND EXISTS (SELECT 1 FROM pays WHERE profile_id = tc.client_id)
        ) sub
      ), '[]'::jsonb)
    )
  );
END;
$$;

-- ── get_client_payment_status (+ this-month collected & attendance) ─────────
CREATE OR REPLACE FUNCTION public.get_client_payment_status(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid     UUID := auth.uid();
  v_month DATE := date_trunc('month', now())::date;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN jsonb_build_object(
    'period_month', v_month,
    'full_name',    (SELECT full_name    FROM profiles WHERE id = p_client_id),
    'phone_number', (SELECT phone_number FROM profiles WHERE id = p_client_id),
    'paid_this_month', EXISTS (SELECT 1 FROM member_payments WHERE profile_id = p_client_id AND period_month = v_month),
    'collected_this_month', COALESCE((SELECT amount FROM member_payments WHERE profile_id = p_client_id AND period_month = v_month), 0),
    'last_paid_at', (SELECT paid_at FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
    'last_period', (SELECT period_month FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
    'monthly_fee',    (SELECT monthly_fee            FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'payment_method', (SELECT default_payment_method FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'billing_day',    (SELECT billing_day            FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'attended_total', (SELECT count(*) FROM check_ins
        WHERE profile_id = p_client_id
          AND (checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
          AND (checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')),
    'attended_with_trainer', (SELECT count(*) FROM trainer_sessions
        WHERE client_id = p_client_id AND trainer_id = uid AND status = 'completed'
          AND (scheduled_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
          AND (scheduled_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'period_month', h.period_month, 'amount', h.amount, 'note', h.note, 'paid_at', h.paid_at
      ) ORDER BY h.period_month DESC)
      FROM (
        SELECT period_month, amount, note, paid_at FROM member_payments
        WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 12
      ) h
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_client_schedule(UUID, JSONB)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_schedule(UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_attendance(UUID, DATE, DATE)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trainer_money_overview(DATE)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trainer_year_overview(INT)             TO authenticated;
