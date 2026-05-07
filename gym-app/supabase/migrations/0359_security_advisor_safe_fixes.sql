-- ============================================================================
-- 0359 — Supabase Security Advisor: safe, mechanical fixes
-- ============================================================================
-- Addresses three categories from the Supabase linter, scoped to changes
-- that are either pure defense-in-depth or do not affect any code path
-- exercised by the client (verified via `git grep`):
--
--   1. function_search_path_mutable (10 functions)
--      Adds `SET search_path = public` so a malicious actor can't shadow
--      `public.*` objects via `search_path` injection inside a SECURITY
--      DEFINER function.
--
--   2. materialized_view_in_api (mv_gym_health_scores)
--      Revokes SELECT from anon/authenticated. The MV is admin-internal
--      (refreshed by `refresh_gym_health_scores` and read by admin tooling
--      via the SECURITY DEFINER wrapper). No client code references it.
--
--   3. anon_security_definer_function_executable (all `admin_*` RPCs)
--      Revokes EXECUTE from anon on every SECURITY DEFINER function whose
--      name starts with `admin_`. Each of these already calls
--      `public.is_admin()` internally and raises on failure, so this is
--      defense-in-depth — anon callers were already getting errors, but
--      now they're rejected at the PostgREST layer instead of inside the
--      function body.
--
-- Skipped on purpose (need separate review):
--   • Moving `pg_net` out of `public` — touches every caller of
--     `net.http_post`; needs its own migration with a search-and-replace
--     audit.
--   • Dropping broad SELECT policies on `class-images`, `exercise-videos`,
--     `food-images`, `program-images`, `social-posts` — `createSignedUrl`
--     calls in TrainerClasses.jsx + SocialFeed.jsx require SELECT, so a
--     blanket policy drop would break the social feed and class images.
--   • Non-`admin_*` SECURITY DEFINER functions exposed to anon — some
--     (`lookup_invite_by_code`, `lookup_gym_invite_by_code`,
--     `lookup_referral_code`) are deliberately pre-auth (called from
--     Signup.jsx before signUp completes). Auditing the rest requires a
--     per-function pass.
-- ============================================================================


-- ── 1. SET search_path = public on flagged functions ────────────────────────
-- Uses a DO loop so that overloaded functions (admin_redeem_voucher has
-- two signatures live in prod) all get fixed without us having to enumerate
-- argument lists. `pg_get_function_identity_arguments` returns the canonical
-- form ALTER FUNCTION expects.

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        '_streak_gap_day_protected',
        'get_cross_gym_onboarding',
        'admin_redeem_voucher',
        'refresh_gym_health_scores',
        'touch_trainer_reviews',
        'auto_grant_member_role_on_promote',
        '_compute_churn_scores_guard',
        '_claim_redemption_admin_guard',
        'get_admin_engagement',
        'auto_grant_member_role'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public',
      fn.proname, fn.args
    );
  END LOOP;
END $$;


-- ── 2. Lock down mv_gym_health_scores ───────────────────────────────────────

REVOKE SELECT ON public.mv_gym_health_scores FROM anon, authenticated;


-- ── 3. Revoke EXECUTE from anon on every SECURITY DEFINER admin_* RPC ──────
-- All `admin_*` functions call `public.is_admin()` (or super_admin) internally
-- and raise on failure. Revoking from anon means PostgREST returns 403 before
-- the function body even runs.

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'admin\_%' ESCAPE '\'
      AND p.prosecdef = TRUE
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon',
      fn.proname, fn.args
    );
  END LOOP;
END $$;


-- Reload PostgREST schema cache so revocations take effect immediately.
NOTIFY pgrst, 'reload schema';
