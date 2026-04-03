-- Defense-in-depth: Ensure profile_lookup is completely locked down for non-service roles
-- The table intentionally has no RLS (to avoid recursion in helper functions)
-- so we rely on REVOKE to control access.

-- Revoke ALL privileges from anon (SELECT was already revoked in 0137, this covers everything else)
REVOKE ALL ON public.profile_lookup FROM anon;

-- Ensure authenticated can only read (SELECT was re-granted in 0137 for helper functions)
-- Actually, 0137 revoked SELECT too. The helper functions work because they're SECURITY DEFINER
-- (running as the function owner, not as the authenticated user).
-- So we can safely revoke ALL from authenticated:
REVOKE ALL ON public.profile_lookup FROM authenticated;
