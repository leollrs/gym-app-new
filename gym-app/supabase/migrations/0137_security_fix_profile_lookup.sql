-- Security fix: revoke direct access to profile_lookup
-- The SECURITY DEFINER helper functions (current_gym_id, current_user_role, is_admin, etc.)
-- access this table with owner privileges, so no direct user access is needed.

REVOKE SELECT ON public.profile_lookup FROM authenticated;
REVOKE SELECT ON public.profile_lookup FROM anon;
