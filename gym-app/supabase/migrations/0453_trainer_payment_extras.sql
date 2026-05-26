-- 0453_trainer_payment_extras.sql
-- ---------------------------------------------------------------------------
-- Payment polish for the trainer tier:
--   • trainer_clients.cost_per_session — optional per-session rate; when set
--     (and no flat monthly given) set_client_fee estimates the monthly fee from
--     the client's weekly schedule (sessions/wk × 52/12).
--   • mark_client_paid gains p_paid_at so the trainer can set the real payment
--     date (calendar pick / backdate), not just "now".
--   • get_client_payment_status returns cost_per_session, weekly_sessions and a
--     computed next_due_date (from billing_day).
--   • profiles.trainer_default_rate / trainer_rate_unit — the trainer's own
--     optional rate, editable in their profile.
-- Builds on 0450–0452. Signature-changing functions are DROP'd first so the
-- new arg lists aren't ambiguous for PostgREST.
-- ---------------------------------------------------------------------------

ALTER TABLE public.trainer_clients
  ADD COLUMN IF NOT EXISTS cost_per_session NUMERIC(10,2);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trainer_default_rate NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS trainer_rate_unit    TEXT;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_trainer_rate_unit_chk
    CHECK (trainer_rate_unit IS NULL OR trainer_rate_unit IN ('month', 'session'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── set_client_fee (+ cost_per_session) ────────────────────────────────────
DROP FUNCTION IF EXISTS public.set_client_fee(UUID, NUMERIC, TEXT, INT);
CREATE OR REPLACE FUNCTION public.set_client_fee(
  p_client_id        UUID,
  p_monthly_fee      NUMERIC DEFAULT NULL,
  p_payment_method   TEXT    DEFAULT NULL,
  p_billing_day      INT     DEFAULT NULL,
  p_cost_per_session NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_weekly INT; v_monthly NUMERIC;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT count(*) INTO v_weekly FROM trainer_client_schedule
    WHERE client_id = p_client_id AND trainer_id = auth.uid();
  -- Explicit monthly wins; else estimate from per-session × weekly schedule.
  v_monthly := p_monthly_fee;
  IF v_monthly IS NULL AND p_cost_per_session IS NOT NULL AND COALESCE(v_weekly, 0) > 0 THEN
    v_monthly := round(p_cost_per_session * v_weekly * 52.0 / 12.0, 2);
  END IF;
  UPDATE trainer_clients
    SET monthly_fee            = v_monthly,
        default_payment_method = p_payment_method,
        billing_day            = NULLIF(p_billing_day, 0),
        cost_per_session       = p_cost_per_session
    WHERE client_id = p_client_id
      AND is_active = true
      AND (trainer_id = auth.uid()
           OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text IN ('admin', 'super_admin')));
END;
$$;

-- ── mark_client_paid (+ p_paid_at) ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_client_paid(UUID, DATE, NUMERIC, TEXT);
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
DECLARE v_gym UUID; v_month DATE; v_paid TIMESTAMPTZ;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  v_paid  := COALESCE(p_paid_at, now());
  v_month := COALESCE(date_trunc('month', p_period_month)::date, date_trunc('month', v_paid)::date);
  SELECT gym_id INTO v_gym FROM profiles WHERE id = p_client_id;
  INSERT INTO member_payments (profile_id, gym_id, period_month, paid_at, marked_by, amount, note)
  VALUES (p_client_id, v_gym, v_month, v_paid, auth.uid(), p_amount, p_note)
  ON CONFLICT (profile_id, period_month) DO UPDATE
    SET paid_at = v_paid, marked_by = auth.uid(),
        amount = COALESCE(EXCLUDED.amount, member_payments.amount),
        note = COALESCE(EXCLUDED.note, member_payments.note);
END;
$$;

-- ── get_client_payment_status (+ cost_per_session, weekly_sessions, next_due) ─
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
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT billing_day INTO v_bday FROM trainer_clients
    WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1;
  v_paidthis := EXISTS (SELECT 1 FROM member_payments WHERE profile_id = p_client_id AND period_month = v_month);
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
    'collected_this_month', COALESCE((SELECT amount FROM member_payments WHERE profile_id = p_client_id AND period_month = v_month), 0),
    'last_paid_at', (SELECT paid_at FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
    'last_period',  (SELECT period_month FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
    'monthly_fee',      (SELECT monthly_fee            FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'cost_per_session', (SELECT cost_per_session       FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'payment_method',   (SELECT default_payment_method FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = uid) DESC LIMIT 1),
    'billing_day',   v_bday,
    'next_due_date', v_next,
    'weekly_sessions', (SELECT count(*) FROM trainer_client_schedule WHERE client_id = p_client_id AND trainer_id = uid),
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

GRANT EXECUTE ON FUNCTION public.set_client_fee(UUID, NUMERIC, TEXT, INT, NUMERIC)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_client_paid(UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated;
