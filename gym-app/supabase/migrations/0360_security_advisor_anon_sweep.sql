-- ============================================================================
-- 0360 — Supabase Security Advisor: anon EXECUTE sweep + bucket lockdown
-- ============================================================================
-- Follow-up to 0359. The first pass only fixed `admin_*` SECURITY DEFINER
-- functions; the linter was still showing ~250 warnings, dominated by
-- `anon_security_definer_function_executable` on every other RPC in the
-- public schema (member actions, leaderboards, friend feed, etc.).
--
-- This migration does two things:
--
--   1. Sweeps every SECURITY DEFINER function in `public` that is currently
--      executable by `anon` and revokes the grant. The default Postgres
--      behaviour is `GRANT EXECUTE ... TO PUBLIC` on function creation —
--      which is what's leaking these to anon — so we revoke from PUBLIC
--      AND anon, then re-grant to authenticated + service_role so the
--      app and edge functions keep working.
--
--      Allowlist (functions that legitimately need anon access — verified
--      against Signup.jsx and migrations 0306/0313):
--        • lookup_invite_by_code         — pre-auth invite lookup
--        • lookup_gym_invite_by_code     — pre-auth gym invite lookup
--        • lookup_referral_code          — pre-auth referral lookup
--
--      Triggers continue to fire regardless of EXECUTE grants (Postgres
--      invokes trigger functions internally), so revoking from anon does
--      not affect any BEFORE/AFTER trigger in the schema.
--
--   2. Drops the broad `storage.objects` SELECT policy on three public
--      buckets (`food-images`, `program-images`, `exercise-videos`) that
--      only use `getPublicUrl` from clients (verified by grep). Public
--      bucket URLs work without a SELECT policy; the policy was only
--      enabling `.list()` on the bucket — which nothing uses.
--
--      Buckets explicitly NOT touched (their SELECT policies are still
--      load-bearing):
--        • class-images   — TrainerClasses.jsx uses `createSignedUrl`
--        • social-posts   — SocialFeed.jsx uses `createSignedUrl`
--      `createSignedUrl` requires SELECT on the underlying object row;
--      dropping the policy would break those flows.
-- ============================================================================


-- ── 1. Sweep anon EXECUTE on SECURITY DEFINER functions in public ──────────

DO $$
DECLARE
  fn RECORD;
  allowlist TEXT[] := ARRAY[
    'lookup_invite_by_code',
    'lookup_gym_invite_by_code',
    'lookup_referral_code'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = TRUE
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname <> ALL(allowlist)
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
      fn.proname, fn.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
      fn.proname, fn.args
    );
  END LOOP;
END $$;


-- ── 2. Drop broad SELECT policies on public buckets that don't need them ────
-- These three buckets serve content via getPublicUrl only; no client code
-- calls .list() or createSignedUrl on them.

DROP POLICY IF EXISTS "food_images_public_read"             ON storage.objects;
DROP POLICY IF EXISTS "program_images_select"               ON storage.objects;
DROP POLICY IF EXISTS "exercise_videos_authenticated_select" ON storage.objects;


-- Reload PostgREST schema cache so the EXECUTE revocations take effect
-- immediately (otherwise PostgREST would keep using its cached privilege map).
NOTIFY pgrst, 'reload schema';
