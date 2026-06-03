-- 0511 — Fix admin_get_member_emails 403 (cannot read auth.users)
--
-- The Outreach composer ("Enviar mensaje") resolves member email addresses via
-- this RPC when the Email channel is on. Member emails live in auth.users, which
-- the `authenticated` role cannot read directly — so the function MUST run as
-- SECURITY DEFINER (owned by a superuser) to read auth.users on the caller's
-- behalf. The copy deployed on some environments was not effective-definer
-- (drifted to invoker / an older copy / 0268 never applied here), so the
-- auth.users read raised insufficient_privilege → HTTP 403 in the client.
--
-- is_admin() itself is correct (0465 made it multi-role-safe and profile_lookup
-- reflects admin/super_admin roles — verified), so the gate is kept as-is. This
-- migration just re-establishes the function cleanly: SECURITY DEFINER + pinned
-- search_path, gym-scoped, admin-gated, execute restricted to authenticated.

CREATE OR REPLACE FUNCTION public.admin_get_member_emails(p_member_ids UUID[])
RETURNS TABLE (member_id UUID, email TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admin-only (multi-role-safe via public.is_admin()).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.id AS member_id, u.email::text
  FROM auth.users u
  INNER JOIN public.profiles p ON p.id = u.id
  WHERE u.id = ANY(p_member_ids)
    AND p.gym_id = public.current_gym_id();
END;
$$;

-- Lock execution down to authenticated callers only (the is_admin() check inside
-- enforces the actual admin gate; this just removes the implicit PUBLIC grant).
REVOKE ALL ON FUNCTION public.admin_get_member_emails(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_member_emails(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
