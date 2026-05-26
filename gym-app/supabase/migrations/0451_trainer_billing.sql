-- 0451_trainer_billing.sql
-- ---------------------------------------------------------------------------
-- Trainer money tools (still no real billing — manual tracking only):
--   • trainer_clients gets a per-client monthly fee + usual method + billing day
--     so "expected", "pending" and "collected" become real numbers.
--   • get_trainer_money_overview(): one call that powers the dashboard money
--     card AND the /trainer/payments "who owes me" tracker — aggregates +
--     a per-client list (pending first), with phone_number for WhatsApp nudges.
--   • set_client_fee(): trainer (or gym admin) sets a client's monthly fee.
--   • get_client_payment_status() is extended to also return the client's fee.
-- Builds on 0450 (member_payments, _can_manage_client, mark_client_paid,
-- trainer_send_payment_reminder). All cross-client access stays behind
-- SECURITY DEFINER RPCs that verify the caller via _can_manage_client.
-- ---------------------------------------------------------------------------

ALTER TABLE public.trainer_clients
  ADD COLUMN IF NOT EXISTS monthly_fee            NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS default_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS billing_day            SMALLINT;

-- Keep billing_day a safe day-of-month (1–28 so it exists in every month).
DO $$
BEGIN
  ALTER TABLE public.trainer_clients
    ADD CONSTRAINT trainer_clients_billing_day_chk
    CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 28);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── set_client_fee ─────────────────────────────────────────────────────────
-- Sets the monthly arrangement for a client. Trainer updates their own
-- trainer_clients row; a gym admin may update the active row on the trainer's
-- behalf. Pass NULLs to clear the fee.
CREATE OR REPLACE FUNCTION public.set_client_fee(
  p_client_id      UUID,
  p_monthly_fee    NUMERIC DEFAULT NULL,
  p_payment_method TEXT    DEFAULT NULL,
  p_billing_day    INT     DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE trainer_clients
    SET monthly_fee            = p_monthly_fee,
        default_payment_method = p_payment_method,
        billing_day            = NULLIF(p_billing_day, 0)
    WHERE client_id = p_client_id
      AND is_active = true
      AND (
        trainer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text IN ('admin', 'super_admin'))
      );
END;
$$;

-- ── get_trainer_money_overview ───────────────────────────────────────────────
-- Trainer-scoped (uses auth.uid() as the trainer). Returns the headline
-- aggregates + a per-client list sorted pending-first. Drives both the home
-- money card and the payments tracker.
CREATE OR REPLACE FUNCTION public.get_trainer_money_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid     UUID := auth.uid();
  v_month DATE := date_trunc('month', now())::date;
  v_today INT  := EXTRACT(day FROM now())::int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN (
    WITH cli AS (
      SELECT
        tc.client_id,
        tc.monthly_fee,
        tc.default_payment_method,
        tc.billing_day,
        p.full_name, p.username,
        p.avatar_url, p.avatar_type, p.avatar_value,
        p.phone_number,
        mp.amount  AS paid_amount,
        mp.paid_at AS paid_at,
        (mp.profile_id IS NOT NULL) AS paid_this_month
      FROM trainer_clients tc
      JOIN profiles p ON p.id = tc.client_id
      LEFT JOIN member_payments mp
        ON mp.profile_id = tc.client_id AND mp.period_month = v_month
      WHERE tc.trainer_id = uid AND tc.is_active = true
    )
    SELECT jsonb_build_object(
      'month',           v_month,
      'active_clients',  (SELECT count(*) FROM cli),
      'with_fee',        (SELECT count(*) FROM cli WHERE COALESCE(monthly_fee, 0) > 0),
      'expected_total',  (SELECT COALESCE(sum(monthly_fee), 0) FROM cli WHERE COALESCE(monthly_fee, 0) > 0),
      'collected_total', (SELECT COALESCE(sum(paid_amount), 0) FROM cli WHERE paid_this_month),
      'collected_count', (SELECT count(*) FROM cli WHERE paid_this_month),
      'pending_count',   (SELECT count(*) FROM cli WHERE COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month),
      'pending_total',   (SELECT COALESCE(sum(monthly_fee), 0) FROM cli WHERE COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month),
      'clients', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'client_id',       client_id,
          'full_name',       full_name,
          'username',        username,
          'avatar_url',      avatar_url,
          'avatar_type',     avatar_type,
          'avatar_value',    avatar_value,
          'phone_number',    phone_number,
          'monthly_fee',     monthly_fee,
          'payment_method',  default_payment_method,
          'billing_day',     billing_day,
          'paid_this_month', paid_this_month,
          'paid_amount',     paid_amount,
          'paid_at',         paid_at,
          'overdue_days',    CASE
                               WHEN COALESCE(monthly_fee, 0) > 0 AND NOT paid_this_month
                                    AND billing_day IS NOT NULL AND v_today > billing_day
                               THEN v_today - billing_day ELSE 0 END
        ) ORDER BY paid_this_month ASC, COALESCE(monthly_fee, 0) DESC, full_name ASC)
        FROM cli
      ), '[]'::jsonb)
    )
  );
END;
$$;

-- ── get_client_payment_status (extended with the client's fee) ───────────────
CREATE OR REPLACE FUNCTION public.get_client_payment_status(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_month DATE := date_trunc('month', now())::date;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN jsonb_build_object(
    'period_month', v_month,
    'full_name',    (SELECT full_name    FROM profiles WHERE id = p_client_id),
    'phone_number', (SELECT phone_number FROM profiles WHERE id = p_client_id),
    'paid_this_month', EXISTS (SELECT 1 FROM member_payments WHERE profile_id = p_client_id AND period_month = v_month),
    'last_paid_at', (SELECT paid_at FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
    'last_period', (SELECT period_month FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
    -- caller's own arrangement first, else any active trainer's row
    'monthly_fee',    (SELECT monthly_fee            FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = auth.uid()) DESC LIMIT 1),
    'payment_method', (SELECT default_payment_method FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = auth.uid()) DESC LIMIT 1),
    'billing_day',    (SELECT billing_day            FROM trainer_clients WHERE client_id = p_client_id AND is_active = true ORDER BY (trainer_id = auth.uid()) DESC LIMIT 1),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'period_month', h.period_month,
        'amount', h.amount,
        'note', h.note,
        'paid_at', h.paid_at
      ) ORDER BY h.period_month DESC)
      FROM (
        SELECT period_month, amount, note, paid_at
        FROM member_payments
        WHERE profile_id = p_client_id
        ORDER BY period_month DESC
        LIMIT 12
      ) h
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_client_fee(UUID, NUMERIC, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trainer_money_overview()             TO authenticated;
