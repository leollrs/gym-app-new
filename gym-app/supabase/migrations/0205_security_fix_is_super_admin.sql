-- Security fix: is_super_admin() should query profile_lookup (no RLS) instead of profiles
-- This matches the pattern used for is_admin(), current_gym_id(), current_user_role()
-- which were all fixed in migration 0062 to avoid infinite RLS recursion.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role = 'super_admin' FROM public.profile_lookup WHERE id = auth.uid() LIMIT 1),
    FALSE
  );
$$;
