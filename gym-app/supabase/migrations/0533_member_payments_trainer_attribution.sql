-- 0533_member_payments_trainer_attribution.sql
-- ---------------------------------------------------------------------------
-- ROOT CAUSES FIXED (trainer audit 2026-06-11):
--
-- • P1-12 — member_payments had UNIQUE (profile_id, period_month) with NO
--   trainer attribution (0450:25). Two trainers of the same client both saw
--   the full amount as "theirs", either could hard-delete the other's record
--   via Undo, and year totals double-counted. Fix: add trainer_id, upsert on
--   (profile_id, period_month, trainer_id), and scope every payment read in
--   the trainer RPCs to the caller's trainer_id (NULL legacy rows are still
--   included for backward compat — they predate attribution).
--
-- • P2-18 — get_trainer_money_overview / get_trainer_year_overview filtered
--   payments through `trainer_clients.is_active = true`, so DEACTIVATING a
--   client erased their already-collected money from every month/year view.
--   Fix: collected/year totals now count payments by trainer_id for the
--   requested period regardless of the client's current active flag;
--   expected/pending stays active-clients-only. Former clients who paid in
--   the viewed period are appended to the `clients` array with the NEW key
--   `is_active_client: false` (keys only ADDED, never removed).
--
-- • P2-4 — get_client_payment_status.attended_total counted raw check-in
--   ROWS (double-counts re-scans, ignored workouts) while the Attendance tab
--   counts DISTINCT days of check-ins ∪ completed workouts (0452:122). Same
--   client/month showed two different numbers one tab apart. Fix: both
--   attended_total fields (status RPC + money-overview client rows) now use
--   the get_client_attendance day-union semantics.
--
-- • P2-11 — trainer_send_payment_reminder was hardcoded Spanish AND said
--   "membresía / front desk" when the debt is the trainer's own PT fee
--   (0450:190). Fix: personal-training wording, localized by the member's
--   profiles.preferred_language (the column the app actually writes), and
--   delivered via _notify_push (0440) so the member also gets a native push.
--
-- Response shapes: every replaced RPC keeps its existing keys exactly; new
-- keys added: clients[].note, clients[].is_active_client (money overview).
-- Builds on 0450/0451/0452/0453. Timezone: America/Puerto_Rico (no DST).
-- ---------------------------------------------------------------------------

-- ── 1. trainer_id column + backfill ─────────────────────────────────────────
ALTER TABLE public.member_payments
  ADD COLUMN IF NOT EXISTS trainer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS member_payments_trainer_period_idx
  ON public.member_payments (trainer_id, period_month DESC);

-- Backfill pass 1: the person who marked it is a trainer (primary or
-- additional role) → the payment is theirs.
UPDATE public.member_payments mp
SET trainer_id = mp.marked_by
WHERE mp.trainer_id IS NULL
  AND mp.marked_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = mp.marked_by
      AND (pr.role::text = 'trainer'
           OR 'trainer'::user_role = ANY(COALESCE(pr.additional_roles, '{}'::user_role[])))
  );

-- Backfill pass 2: marker wasn't a trainer (admin / NULL) — attribute to the
-- member's single active trainer when unambiguous. Anything else stays NULL
-- (legacy rows; tolerated by the scoped reads below).
UPDATE public.member_payments mp
SET trainer_id = (
  SELECT tc.trainer_id FROM public.trainer_clients tc
  WHERE tc.client_id = mp.profile_id AND tc.is_active = true
  LIMIT 1
)
WHERE mp.trainer_id IS NULL
  AND (SELECT count(DISTINCT tc.trainer_id) FROM public.trainer_clients tc
       WHERE tc.client_id = mp.profile_id AND tc.is_active = true) = 1;

-- ── 2. Unique key now includes the trainer ──────────────────────────────────
-- Old key (0450 inline UNIQUE) auto-named profile_id/period_month. NULL
-- trainer_ids stay distinct under the new key = legacy rows tolerated.
ALTER TABLE public.member_payments
  DROP CONSTRAINT IF EXISTS member_payments_profile_id_period_month_key;

DO $$ BEGIN
  ALTER TABLE public.member_payments
    ADD CONSTRAINT member_payments_profile_period_trainer_key
    UNIQUE (profile_id, period_month, trainer_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. mark_client_paid (5-arg, 0453 signature) — now attributes the row ───
-- marked_by stays the real actor; trainer_id is the attribution. If the
-- caller isn't an active trainer of this client (e.g. an admin marking on a
-- trainer's behalf), attribute to the client's single active trainer when
-- unambiguous — same rule as the backfill — else fall back to the caller.
-- Before upserting, any legacy NULL-trainer row for the same (client, month)
-- is adopted so the month can't double-count (one legacy + one attributed).
CREATE OR REPLACE FUNCTION public.mark_client_paid(
  p_client_id    UUID,
  p_period_month DATE        DEFAULT NULL,
  p_amount       NUMERIC     DEFAULT NULL,
  p_note         TEXT        DEFAULT NULL,
  p_paid_at      TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym UUID; v_month DATE; v_paid TIMESTAMPTZ; v_trainer UUID;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  v_paid  := COALESCE(p_paid_at, now());
  v_month := COALESCE(date_trunc('month', p_period_month)::date, date_trunc('month', v_paid)::date);
  SELECT gym_id INTO v_gym FROM profiles WHERE id = p_client_id;

  v_trainer := auth.uid();
  IF NOT EXISTS (
    SELECT 1 FROM trainer_clients
    WHERE trainer_id = v_trainer AND client_id = p_client_id AND is_active = true
  ) THEN
    -- Caller is an admin (allowed by _can_manage_client): attribute to the
    -- client's single active trainer when unambiguous.
    IF (SELECT count(DISTINCT trainer_id) FROM trainer_clients
        WHERE client_id = p_client_id AND is_active = true) = 1 THEN
      SELECT trainer_id INTO v_trainer FROM trainer_clients
      WHERE client_id = p_client_id AND is_active = true LIMIT 1;
    END IF;
  END IF;

  -- Adopt a pre-attribution row for this month (if any) so the upsert below
  -- updates it instead of creating a parallel duplicate.
  UPDATE member_payments
  SET trainer_id = v_trainer
  WHERE profile_id = p_client_id AND period_month = v_month AND trainer_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM member_payments
      WHERE profile_id = p_client_id AND period_month = v_month AND trainer_id = v_trainer
    );

  INSERT INTO member_payments (profile_id, gym_id, period_month, paid_at, marked_by, amount, note, trainer_id)
  VALUES (p_client_id, v_gym, v_month, v_paid, auth.uid(), p_amount, p_note, v_trainer)
  ON CONFLICT (profile_id, period_month, trainer_id) DO UPDATE
    SET paid_at = v_paid, marked_by = auth.uid(),
        amount = COALESCE(EXCLUDED.amount, member_payments.amount),
        note = COALESCE(EXCLUDED.note, member_payments.note);
END;
$$;

-- ── 4. unmark_client_paid — only deletes the caller's (or legacy) rows ──────
CREATE OR REPLACE FUNCTION public.unmark_client_paid(p_client_id UUID, p_period_month DATE DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_month DATE;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  v_month := COALESCE(date_trunc('month', p_period_month)::date, date_trunc('month', now())::date);
  DELETE FROM member_payments
  WHERE profile_id = p_client_id AND period_month = v_month
    AND (trainer_id = auth.uid() OR trainer_id IS NULL);
END;
$$;

-- ── 5. get_client_payment_status — trainer-scoped + day-union attendance ────
-- Shape preserved from 0453 (period_month, full_name, phone_number,
-- paid_this_month, collected_this_month, last_paid_at, last_period,
-- monthly_fee, cost_per_session, payment_method, billing_day, next_due_date,
-- weekly_sessions, attended_total, attended_with_trainer, history[]).
-- Admin callers keep seeing all rows (they manage on behalf of trainers).
CREATE OR REPLACE FUNCTION public.get_client_payment_status(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid        UUID := auth.uid();
  v_month    DATE := date_trunc('month', now())::date;
  v_bday     INT;
  v_paidthis BOOLEAN;
  v_next     DATE;
  v_is_admin BOOLEAN;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  v_is_admin := EXISTS (
    SELECT 1 FROM profiles
    WHERE id = uid
      AND (role::text IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(COALESCE(additional_roles, '{}'::user_role[]))
           OR 'super_admin'::user_role = ANY(COALESCE(additional_roles, '{}'::user_role[])))
  );

  SELECT billing_day INTO v_bday FROM trainer_clients
    WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1;
  v_paidthis := EXISTS (
    SELECT 1 FROM member_payments
    WHERE profile_id = p_client_id AND period_month = v_month
      AND (v_is_admin OR trainer_id = uid OR trainer_id IS NULL));
  IF v_bday IS NOT NULL THEN
    v_next := make_date(EXTRACT(year FROM v_month)::int, EXTRACT(month FROM v_month)::int, LEAST(v_bday, 28));
    IF v_paidthis OR v_next < now()::date THEN
      v_next := (v_next + interval '1 month')::date;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'period_month', v_month,
    'full_name',    (SELECT full_name    FROM profiles WHERE id = p_client_id),
    'phone_number', (SELECT phone_number FROM profiles WHERE id = p_client_id),
    'paid_this_month', v_paidthis,
    'collected_this_month', COALESCE((
      SELECT sum(amount) FROM member_payments
      WHERE profile_id = p_client_id AND period_month = v_month
        AND (v_is_admin OR trainer_id = uid OR trainer_id IS NULL)), 0),
    'last_paid_at', (SELECT paid_at FROM member_payments
      WHERE profile_id = p_client_id
        AND (v_is_admin OR trainer_id = uid OR trainer_id IS NULL)
      ORDER BY period_month DESC LIMIT 1),
    'last_period',  (SELECT period_month FROM member_payments
      WHERE profile_id = p_client_id
        AND (v_is_admin OR trainer_id = uid OR trainer_id IS NULL)
      ORDER BY period_month DESC LIMIT 1),
    'monthly_fee',      (SELECT monthly_fee            FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'cost_per_session', (SELECT cost_per_session       FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'payment_method',   (SELECT default_payment_method FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'billing_day',   v_bday,
    'next_due_date', v_next,
    'weekly_sessions', (SELECT count(*) FROM trainer_client_schedule WHERE client_id = p_client_id AND trainer_id = uid),
    -- P2-4: DISTINCT training days (check-ins ∪ completed workouts), matching
    -- get_client_attendance (0452) instead of raw check-in rows.
    'attended_total', (SELECT count(*) FROM (
        SELECT DISTINCT (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date AS d
          FROM check_ins ci
          WHERE ci.profile_id = p_client_id
            AND (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
            AND (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')
        UNION
        SELECT DISTINCT (ws.completed_at AT TIME ZONE 'America/Puerto_Rico')::date
          FROM workout_sessions ws
          WHERE ws.profile_id = p_client_id AND ws.status = 'completed'
            AND (ws.completed_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
            AND (ws.completed_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')
      ) days),
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
        WHERE profile_id = p_client_id
          AND (v_is_admin OR trainer_id = uid OR trainer_id IS NULL)
        ORDER BY period_month DESC LIMIT 12
      ) h
    ), '[]'::jsonb)
  );
END;
$$;

-- ── 6. get_trainer_money_overview(p_month) — attributed + history-proof ─────
-- Shape preserved from 0452; NEW client-row keys: note, is_active_client.
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
      -- Active roster: drives expected/pending.
      SELECT tc.client_id, tc.monthly_fee, tc.default_payment_method, tc.billing_day,
             p.full_name, p.username, p.avatar_url, p.avatar_type, p.avatar_value, p.phone_number,
             TRUE AS is_active_client
      FROM trainer_clients tc
      JOIN profiles p ON p.id = tc.client_id
      WHERE tc.trainer_id = uid AND tc.is_active = true
    ),
    pays AS (
      -- P2-18: caller-attributed payments for the period, regardless of
      -- whether the client is still active. NULL trainer_id = legacy rows,
      -- included when the member has (or had) a link to this trainer.
      SELECT mp.profile_id, mp.amount, mp.paid_at, mp.note
      FROM member_payments mp
      WHERE mp.period_month = v_month
        AND (mp.trainer_id = uid
             OR (mp.trainer_id IS NULL AND EXISTS (
                   SELECT 1 FROM trainer_clients tc2
                   WHERE tc2.trainer_id = uid AND tc2.client_id = mp.profile_id)))
    ),
    former AS (
      -- Paid this period but no longer on the active roster.
      SELECT pa.profile_id AS client_id, tc.monthly_fee, tc.default_payment_method, tc.billing_day,
             p.full_name, p.username, p.avatar_url, p.avatar_type, p.avatar_value, p.phone_number,
             FALSE AS is_active_client
      FROM (SELECT DISTINCT profile_id FROM pays) pa
      JOIN profiles p ON p.id = pa.profile_id
      LEFT JOIN LATERAL (
        SELECT monthly_fee, default_payment_method, billing_day
        FROM trainer_clients
        WHERE trainer_id = uid AND client_id = pa.profile_id
        ORDER BY is_active DESC LIMIT 1
      ) tc ON TRUE
      WHERE pa.profile_id NOT IN (SELECT client_id FROM cli)
    ),
    roster AS (
      SELECT * FROM cli UNION ALL SELECT * FROM former
    ),
    enriched AS (
      SELECT r.*,
             pay.amount AS paid_amount, pay.paid_at AS paid_at, pay.note AS paid_note,
             (pay.profile_id IS NOT NULL) AS paid_this_month,
             -- P2-4: distinct training days, same union as get_client_attendance.
             (SELECT count(*) FROM (
                SELECT DISTINCT (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date AS d
                  FROM check_ins ci
                  WHERE ci.profile_id = r.client_id
                    AND (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
                    AND (ci.checked_in_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')
                UNION
                SELECT DISTINCT (ws.completed_at AT TIME ZONE 'America/Puerto_Rico')::date
                  FROM workout_sessions ws
                  WHERE ws.profile_id = r.client_id AND ws.status = 'completed'
                    AND (ws.completed_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
                    AND (ws.completed_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')
              ) days) AS attended_total,
             (SELECT count(*) FROM trainer_sessions ts
                WHERE ts.client_id = r.client_id AND ts.trainer_id = uid AND ts.status = 'completed'
                  AND (ts.scheduled_at AT TIME ZONE 'America/Puerto_Rico')::date >= v_month
                  AND (ts.scheduled_at AT TIME ZONE 'America/Puerto_Rico')::date < (v_month + interval '1 month')) AS attended_with_trainer
      FROM roster r
      LEFT JOIN LATERAL (
        SELECT profile_id, amount, paid_at, note FROM pays
        WHERE pays.profile_id = r.client_id
        ORDER BY paid_at DESC NULLS LAST LIMIT 1
      ) pay ON TRUE
    )
    SELECT jsonb_build_object(
      'month',           v_month,
      'is_current',      (v_month = v_cur_mon),
      'active_clients',  (SELECT count(*) FROM cli),
      'with_fee',        (SELECT count(*) FROM cli WHERE COALESCE(monthly_fee, 0) > 0),
      'expected_total',  (SELECT COALESCE(sum(monthly_fee), 0) FROM cli WHERE COALESCE(monthly_fee, 0) > 0),
      'collected_total', (SELECT COALESCE(sum(amount), 0) FROM pays),
      'collected_count', (SELECT count(DISTINCT profile_id) FROM pays),
      'pending_count',   (SELECT count(*) FROM enriched WHERE is_active_client AND COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month),
      'pending_total',   (SELECT COALESCE(sum(monthly_fee), 0) FROM enriched WHERE is_active_client AND COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month),
      'clients', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'client_id', client_id, 'full_name', full_name, 'username', username,
          'avatar_url', avatar_url, 'avatar_type', avatar_type, 'avatar_value', avatar_value,
          'phone_number', phone_number,
          'monthly_fee', monthly_fee, 'payment_method', default_payment_method, 'billing_day', billing_day,
          'paid_this_month', paid_this_month, 'paid_amount', paid_amount, 'paid_at', paid_at,
          'note', paid_note,
          'is_active_client', is_active_client,
          'attended_total', attended_total, 'attended_with_trainer', attended_with_trainer,
          'overdue_days', CASE
            WHEN is_active_client AND COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month
                 AND billing_day IS NOT NULL AND v_month = v_cur_mon AND v_today > billing_day
            THEN v_today - billing_day ELSE 0 END
        ) ORDER BY paid_this_month ASC, COALESCE(monthly_fee, 0) DESC, full_name ASC)
        FROM enriched
      ), '[]'::jsonb)
    )
  );
END;
$$;

-- ── 7. get_trainer_year_overview(p_year) — attributed + history-proof ───────
-- Shape preserved from 0452 (year, total, paid_count, months[], clients[]).
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
      -- P2-18: payments attributed to this trainer for the year, no longer
      -- gated on trainer_clients.is_active — deactivating a client must not
      -- erase collected history. NULL trainer_id = legacy, via any link.
      SELECT mp.profile_id, EXTRACT(month FROM mp.period_month)::int AS mon, mp.amount, mp.paid_at
      FROM member_payments mp
      WHERE mp.period_month BETWEEN v_from AND v_to
        AND (mp.trainer_id = uid
             OR (mp.trainer_id IS NULL AND EXISTS (
                   SELECT 1 FROM trainer_clients tc
                   WHERE tc.trainer_id = uid AND tc.client_id = mp.profile_id)))
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
            'client_id', payer.profile_id,
            'full_name', p.full_name,
            'avatar_url', p.avatar_url,
            'avatar_type', p.avatar_type,
            'avatar_value', p.avatar_value,
            'total', COALESCE((SELECT sum(amount) FROM pays WHERE profile_id = payer.profile_id), 0),
            'months', (
              SELECT jsonb_agg(COALESCE((SELECT sum(amount) FROM pays WHERE profile_id = payer.profile_id AND mon = m), 0) ORDER BY m)
              FROM generate_series(1, 12) m
            )
          ) AS c
          FROM (SELECT DISTINCT profile_id FROM pays) payer
          JOIN profiles p ON p.id = payer.profile_id
        ) sub
      ), '[]'::jsonb)
    )
  );
END;
$$;

-- ── 8. trainer_send_payment_reminder — honest copy, member's language ───────
-- P2-11: it's the trainer's own PT fee, not the gym membership, and EN
-- members were getting hardcoded Spanish. Localizes by the member's
-- profiles.preferred_language (the column Settings/Onboarding write) and
-- routes through _notify_push (0440) for in-app + native push with the same
-- once-per-day dedup (now per trainer, so two trainers don't collide).
CREATE OR REPLACE FUNCTION public.trainer_send_payment_reminder(p_client_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym UUID; v_dedup TEXT; v_lang TEXT; v_tname TEXT; v_title TEXT; v_body TEXT;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT gym_id INTO v_gym FROM profiles WHERE id = p_client_id;
  SELECT COALESCE(NULLIF(preferred_language, ''), 'en') INTO v_lang FROM profiles WHERE id = p_client_id;
  SELECT COALESCE(NULLIF(full_name, ''), 'tu entrenador') INTO v_tname FROM profiles WHERE id = auth.uid();

  IF v_lang LIKE 'es%' THEN
    v_title := 'Recordatorio de pago';
    v_body  := 'Tu pago de entrenamiento con ' || v_tname || ' está pendiente. Coordina con él/ella para ponerte al día.';
  ELSE
    v_title := 'Payment reminder';
    v_body  := 'Your training payment with ' || v_tname || ' is pending. Reach out to get squared away.';
  END IF;

  v_dedup := 'payment_reminder:' || p_client_id || ':' || auth.uid() || ':' || to_char(now(), 'YYYY-MM-DD');

  -- _notify_push inserts the in-app row (audience taken from arg) + best-effort
  -- native push; we pre-localize so both language slots carry the same text.
  PERFORM public._notify_push(
    p_client_id, v_gym, 'member'::user_role, 'payment_reminder'::notification_type,
    v_title, v_body, v_title, v_body,
    jsonb_build_object('trainer_id', auth.uid()),
    v_dedup
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_client_paid(UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_client_paid(UUID, DATE)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_payment_status(UUID)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trainer_money_overview(DATE)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trainer_year_overview(INT)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.trainer_send_payment_reminder(UUID)                      TO authenticated;

NOTIFY pgrst, 'reload schema';
