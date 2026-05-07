-- ============================================================
-- 0367 — Anon EXECUTE on auth helpers + short-circuit gyms_select_own
-- ============================================================
-- Problem: signup-time queries against `gyms_public` (the security-barrier
-- view granted to anon in migration 0110) fail with:
--
--   42501  permission denied for function current_gym_id
--
-- Root cause:
--   • Anon queries the underlying `gyms` table via `gyms_public`.
--   • Postgres evaluates ALL permissive SELECT policies on `gyms` (they're
--     OR'd) — including `gyms_select_own` whose USING clause calls
--     `current_gym_id()`.
--   • `current_gym_id()` is SECURITY DEFINER but anon never had EXECUTE on
--     it (Supabase strips `PUBLIC` grants on `public` schema functions by
--     default; migration 0363's grep-based sweep also did not add anon to
--     the keep-list because its in_policy check only protects what was
--     already granted, not what should be).
--   • Postgres throws 42501 when evaluating `gyms_select_own`, BEFORE the
--     OR can fall through to `gyms_select_anon_active`.
--
-- Two-part fix (belt + suspenders):
--
--   1. GRANT EXECUTE on the auth helpers to anon. These functions read
--      `profile_lookup` filtered by `auth.uid()`. For anon, auth.uid() is
--      NULL → they return NULL / FALSE. Granting anon does not leak data;
--      it just lets policy expressions evaluate without 42501 when triggered
--      by any future anon-readable view or table.
--
--   2. Short-circuit the `gyms_select_own` policy with
--      `auth.uid() IS NOT NULL AND ...`. Anon doesn't own any gym row
--      anyway, so this returns FALSE without invoking the function — even
--      if a future migration revokes anon's EXECUTE again, this policy
--      keeps working.
-- ============================================================

-- ── 1. Grant EXECUTE on auth helpers to anon ─────────────────
-- All 7 helper functions referenced by RLS policies anywhere in the schema.
-- Each is SECURITY DEFINER and reads `profile_lookup` filtered by auth.uid().
-- For anon callers, auth.uid() is NULL → they return NULL / FALSE without
-- leaking any data. Granting EXECUTE here just lets policy expressions
-- evaluate without 42501 when ANY anon-reachable surface (gyms_public,
-- public RPCs that touch other tables, signup-time username availability
-- check on profiles, etc.) triggers RLS evaluation.
--
-- Why all of them, not just `current_gym_id`: Postgres evaluates every
-- permissive policy on a table even when the caller can't possibly match
-- any of them. A single throwing function in one policy fails the whole
-- query, so unblocking one helper while another stays revoked just shifts
-- the 42501 to a different function name (which is what happened with
-- `is_trainer_of` after the initial 4-function fix).
GRANT EXECUTE ON FUNCTION public.current_gym_id()      TO anon;
GRANT EXECUTE ON FUNCTION public.current_user_role()   TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin()            TO anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin()      TO anon;
GRANT EXECUTE ON FUNCTION public.is_trainer_of(UUID)         TO anon;
GRANT EXECUTE ON FUNCTION public.is_blocked(UUID, UUID)      TO anon;
GRANT EXECUTE ON FUNCTION public.is_blocked_pair(UUID, UUID) TO anon;

-- ── 2. Defensive short-circuit on gyms_select_own ────────────
DROP POLICY IF EXISTS "gyms_select_own" ON public.gyms;

CREATE POLICY "gyms_select_own" ON public.gyms
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND id = public.current_gym_id()
  );

NOTIFY pgrst, 'reload schema';
