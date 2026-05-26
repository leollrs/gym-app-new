-- 0450_trainer_payments_recovery.sql
-- ---------------------------------------------------------------------------
-- Trainer-side additions (no real billing — manual tracking + reminders):
--   • member_payments: a trainer/admin marks a client paid for a month.
--   • get_client_recovery: training-load + soreness inputs so the trainer can
--     see a client's recovery + get suggestions (reuses the member readiness
--     engine client-side; sleep/HRV stays device-local so it's omitted).
--   • trainer_send_payment_reminder: manual in-app nudge to the member.
-- All cross-client access goes through SECURITY DEFINER RPCs that verify the
-- caller is the client's active trainer OR an admin/super_admin in the same gym.
-- ---------------------------------------------------------------------------

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_reminder';

CREATE TABLE IF NOT EXISTS public.member_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id       UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,                 -- first day of the covered month
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount       NUMERIC(10,2),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, period_month)
);
CREATE INDEX IF NOT EXISTS member_payments_gym_period_idx ON public.member_payments (gym_id, period_month DESC);

ALTER TABLE public.member_payments ENABLE ROW LEVEL SECURITY;
-- Members can read their own payment history; all writes + trainer/admin reads
-- go through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "member_payments_select_own" ON public.member_payments;
CREATE POLICY "member_payments_select_own" ON public.member_payments
  FOR SELECT USING (profile_id = auth.uid());
GRANT SELECT ON public.member_payments TO authenticated;

-- ── auth helper: caller may manage this client? ───────────────────────────
CREATE OR REPLACE FUNCTION public._can_manage_client(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID; caller_gym UUID; caller_role TEXT; client_gym UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN FALSE; END IF;
  SELECT gym_id, role::text INTO caller_gym, caller_role FROM profiles WHERE id = uid;
  SELECT gym_id INTO client_gym FROM profiles WHERE id = p_client_id;
  IF client_gym IS NULL OR caller_gym IS DISTINCT FROM client_gym THEN RETURN FALSE; END IF;
  IF caller_role IN ('admin', 'super_admin') THEN RETURN TRUE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM trainer_clients
    WHERE trainer_id = uid AND client_id = p_client_id AND is_active = true
  );
END;
$$;

-- ── get_client_recovery ───────────────────────────────────────────────────
-- Returns the inputs the member readiness engine needs (recent sessions + sets
-- + latest soreness). Sleep/HRV are device-local on the member, so omitted.
CREATE OR REPLACE FUNCTION public.get_client_recovery(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN jsonb_build_object(
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'completed_at', ws.completed_at,
        'workout_sets', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'exercise_id', se.exercise_id,
            'weight_lbs',  ss.weight_lbs,
            'reps',        ss.reps,
            'completed',   ss.is_completed
          ))
          FROM session_exercises se
          JOIN session_sets ss ON ss.session_exercise_id = se.id
          WHERE se.session_id = ws.id
        ), '[]'::jsonb)
      ))
      FROM workout_sessions ws
      WHERE ws.profile_id = p_client_id
        AND ws.status = 'completed'
        AND ws.completed_at > now() - interval '14 days'
    ), '[]'::jsonb),
    'soreness', (
      SELECT soreness FROM wellness_checkins
      WHERE profile_id = p_client_id AND checkin_date >= (now()::date - 2)
      ORDER BY checkin_date DESC LIMIT 1
    ),
    'goal', (SELECT primary_goal FROM member_onboarding WHERE profile_id = p_client_id),
    'priority_muscles', (SELECT to_jsonb(priority_muscles) FROM member_onboarding WHERE profile_id = p_client_id)
  );
END;
$$;

-- ── get_client_payment_status ─────────────────────────────────────────────
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
    'paid_this_month', EXISTS (SELECT 1 FROM member_payments WHERE profile_id = p_client_id AND period_month = v_month),
    'last_paid_at', (SELECT paid_at FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
    'last_period', (SELECT period_month FROM member_payments WHERE profile_id = p_client_id ORDER BY period_month DESC LIMIT 1),
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

-- ── mark_client_paid / unmark ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_client_paid(p_client_id UUID, p_period_month DATE DEFAULT NULL, p_amount NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_gym UUID; v_month DATE;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  v_month := COALESCE(date_trunc('month', p_period_month)::date, date_trunc('month', now())::date);
  SELECT gym_id INTO v_gym FROM profiles WHERE id = p_client_id;
  INSERT INTO member_payments (profile_id, gym_id, period_month, paid_at, marked_by, amount, note)
  VALUES (p_client_id, v_gym, v_month, now(), auth.uid(), p_amount, p_note)
  ON CONFLICT (profile_id, period_month) DO UPDATE
    SET paid_at = now(), marked_by = auth.uid(),
        amount = COALESCE(EXCLUDED.amount, member_payments.amount),
        note = COALESCE(EXCLUDED.note, member_payments.note);
END;
$$;

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
  DELETE FROM member_payments WHERE profile_id = p_client_id AND period_month = v_month;
END;
$$;

-- ── trainer_send_payment_reminder ─────────────────────────────────────────
-- Manual in-app nudge to the member. Deduped to once per day per client.
CREATE OR REPLACE FUNCTION public.trainer_send_payment_reminder(p_client_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_gym UUID; v_dedup TEXT;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT gym_id INTO v_gym FROM profiles WHERE id = p_client_id;
  v_dedup := 'payment_reminder:' || p_client_id || ':' || to_char(now(), 'YYYY-MM-DD');
  INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key, audience)
  VALUES (
    p_client_id, v_gym, 'payment_reminder',
    'Recordatorio de pago',
    'Tu pago de membresía está pendiente. Pasa por el front desk para ponerte al día.',
    v_dedup, 'member'
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_recovery(UUID)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_payment_status(UUID)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_client_paid(UUID, DATE, NUMERIC, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_client_paid(UUID, DATE)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.trainer_send_payment_reminder(UUID)             TO authenticated;
