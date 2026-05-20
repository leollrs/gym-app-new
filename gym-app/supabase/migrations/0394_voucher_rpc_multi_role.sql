-- =============================================================
-- 0394 — admin_get_or_create_voucher honors multi-role + service role
--
-- The RPC was rewritten in 0199 to check that the caller is admin /
-- super_admin of the target gym. Two problems with that version:
--
--   1. It reads role from `profile_lookup` which only exposes the primary
--      `role` column. A user whose admin authority lives in
--      `profiles.additional_roles` (per mig 0332) gets rejected with
--      "Only gym admins can create vouchers". In send-admin-email this
--      surfaces as a missing voucher row → no QR code → the email
--      renders the "QR unavailable" placeholder.
--
--   2. It calls auth.uid() unconditionally. Edge functions running with
--      SUPABASE_SERVICE_ROLE_KEY have auth.uid() = NULL — the EXISTS
--      check fails and the INSERT writes NULL into admin_id (which has
--      ON DELETE SET NULL but is otherwise allowed).
--
-- This migration rewrites the RPC to:
--   * Check primary `role` AND `additional_roles`.
--   * Short-circuit the auth check when auth.role() = 'service_role'
--     (the edge function does its own admin check before calling).
--   * Fall back to p_admin_id when auth.uid() is NULL so admin_id is
--     still populated correctly for service-role invocations.
-- =============================================================

CREATE OR REPLACE FUNCTION admin_get_or_create_voucher(
  p_gym_id UUID,
  p_member_id UUID,
  p_admin_id UUID,
  p_reward_type TEXT,
  p_reward_label TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing email_reward_vouchers;
  v_new_code TEXT;
  v_result email_reward_vouchers;
  v_is_service_role BOOLEAN := (auth.role() = 'service_role');
BEGIN
  -- Authorize unless the caller is the service role (edge functions),
  -- which do their own admin-role check before invoking.
  IF NOT v_is_service_role THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.profiles
       WHERE id = auth.uid()
         AND gym_id = p_gym_id
         AND (
           role IN ('admin', 'super_admin')
           OR additional_roles && ARRAY['admin', 'super_admin']::user_role[]
         )
    ) THEN
      RAISE EXCEPTION 'Only gym admins can create vouchers';
    END IF;
  END IF;

  -- Reuse any existing active voucher of the same reward_type for this member.
  SELECT * INTO v_existing
    FROM email_reward_vouchers
   WHERE gym_id = p_gym_id
     AND member_id = p_member_id
     AND reward_type = p_reward_type
     AND status = 'active';

  IF FOUND THEN
    RETURN row_to_json(v_existing);
  END IF;

  -- Mint a 12-char alphanumeric code.
  v_new_code := '';
  FOR i IN 1..12 LOOP
    v_new_code := v_new_code || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36 + 1)::int, 1);
  END LOOP;

  INSERT INTO email_reward_vouchers (gym_id, member_id, admin_id, reward_type, reward_label, qr_code)
  VALUES (p_gym_id, p_member_id, COALESCE(auth.uid(), p_admin_id), p_reward_type, p_reward_label, v_new_code)
  RETURNING * INTO v_result;

  RETURN row_to_json(v_result);
END;
$$;
