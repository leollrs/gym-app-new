-- ============================================================================
-- 0588 — platform_gym_owner_contact RPC                  (audit: completeness-8 / -3)
-- ============================================================================
-- Across the platform the gym owner was shown by NAME only, so the operator
-- could never see the owner's email/phone to actually reach them — even though
-- the whole Attention board tells them to "nudge the owner". profiles has no
-- email column (auth.users does), so a SECURITY DEFINER RPC is required to join
-- it. Returns the owner's contact so GymDetail can render Email / Call /
-- WhatsApp actions for real (manual) outreach.
--
-- Gated to super_admin (RAISE EXCEPTION otherwise); auth.users is reachable
-- because the function runs as its owner (postgres).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.platform_gym_owner_contact(p_gym_id uuid)
RETURNS TABLE(owner_user_id uuid, full_name text, email text, phone_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, u.email::text, p.phone_number
      FROM public.gyms g
      JOIN public.profiles p   ON p.id = g.owner_user_id
      LEFT JOIN auth.users u    ON u.id = p.id
     WHERE g.id = p_gym_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.platform_gym_owner_contact(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_gym_owner_contact(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
