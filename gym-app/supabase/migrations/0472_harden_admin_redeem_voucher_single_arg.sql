-- ============================================================
-- 0472 — Harden admin_redeem_voucher(p_qr_code) single-arg overload
-- ============================================================
-- The single-argument admin_redeem_voucher(text) overload had NO
-- authorization check and NO gym boundary: any authenticated caller who
-- knew (or guessed) a voucher's qr_code could mark it redeemed, in any
-- gym. The two-arg overload (p_qr_code, p_member_id) is properly gated;
-- this brings the one-arg version to the same standard.
--
-- Gate idiom matches admin_get_or_create_voucher: service_role callers
-- (edge functions, which do their own admin check before invoking) pass
-- through; everyone else must be a gym admin (is_admin() is multi-role
-- aware after 0465), scoped to their own gym. super_admin / service_role
-- bypass the gym boundary.
--
-- This is a TIGHTENING change (isolated in its own migration for easy
-- review/revert). Legit callers — gym admins via the scanner, and edge
-- functions via service_role — are unaffected.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_redeem_voucher(p_qr_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_voucher    email_reward_vouchers;
  v_is_service BOOLEAN := (auth.role() = 'service_role');
BEGIN
  -- Authorization: service role (edge functions) OR a gym admin.
  IF NOT v_is_service AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO v_voucher
  FROM email_reward_vouchers
  WHERE qr_code = p_qr_code
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Voucher not found or already redeemed');
  END IF;

  -- Gym boundary for non-service, non-super callers.
  IF NOT v_is_service
     AND NOT public.is_super_admin()
     AND v_voucher.gym_id IS DISTINCT FROM public.current_gym_id() THEN
    RETURN json_build_object('error', 'Voucher not found in your gym');
  END IF;

  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < NOW() THEN
    UPDATE email_reward_vouchers SET status = 'expired' WHERE id = v_voucher.id;
    RETURN json_build_object('error', 'Voucher has expired');
  END IF;

  UPDATE email_reward_vouchers
  SET status = 'redeemed', redeemed_at = NOW()
  WHERE id = v_voucher.id
  RETURNING * INTO v_voucher;

  RETURN row_to_json(v_voucher);
END;
$function$;

NOTIFY pgrst, 'reload schema';
