-- Security fix: Revoke write access on profile_lookup table
-- The profile_lookup table has RLS disabled to avoid recursion in helper functions.
-- Migration 0137 revoked SELECT but forgot INSERT/UPDATE/DELETE.
-- Without this fix, any authenticated user can escalate to admin by updating their own row.

REVOKE INSERT, UPDATE, DELETE ON public.profile_lookup FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profile_lookup FROM anon;
REVOKE TRUNCATE ON public.profile_lookup FROM authenticated;
REVOKE TRUNCATE ON public.profile_lookup FROM anon;
