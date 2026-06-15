-- ============================================================
-- 0576 — Restore EXECUTE grants on client-called RPCs
-- ============================================================
-- Prod logs (2026-06-15) show a flood of:
--   42501 "permission denied for function get_dashboard_data"
--   42501 "permission denied for function get_gym_pulse"
--   42501 "permission denied for function get_friend_feed"
--   42501 "permission denied for function get_friend_streaks"
--
-- Root cause: migration 0363 (revoke_unused_secdef_function_grants) stripped
-- EXECUTE from `authenticated` on a broad set of SECURITY DEFINER functions.
-- Several of those are in fact the app's primary read RPCs. 0560 re-granted
-- get_dashboard_data + get_gym_pulse, and 0573 re-granted get_profile_preview /
-- get_feed_enrichment — but get_friend_feed and get_friend_streaks were never
-- restored anywhere, and the 0560+ backlog may not be applied to a given env.
--
-- This migration idempotently re-grants EXECUTE (all overloads) on every
-- client-facing read RPC, so the dashboard / feed / leaderboards / pulse stop
-- 42501-ing regardless of which earlier grant migrations have landed. These are
-- all SECURITY DEFINER with internal gym-boundary + auth.uid() checks, so
-- granting EXECUTE to authenticated is safe (the function bodies self-authorize).
--
-- NOTE: "permission denied for table profile_lookup" is NOT fixed here — that's
-- resolved by the SECURITY DEFINER RLS-helper grant restore in 0520/0522.
-- Apply the full pending migration backlog (0520, 0522, 0560, 0562, 0570–0573).
-- ============================================================

DO $$
DECLARE
  fn RECORD;
  client_rpcs TEXT[] := ARRAY[
    -- dashboard / home
    'get_dashboard_data', 'get_gym_pulse', 'get_auth_context',
    -- social
    'get_friend_feed', 'get_friend_streaks', 'get_feed_enrichment',
    'get_profile_preview', 'get_milestone_feed',
    -- leaderboards
    'get_leaderboard_volume', 'get_leaderboard_prs', 'get_leaderboard_most_improved',
    'get_leaderboard_consistency', 'get_leaderboard_checkins', 'get_leaderboard_newcomers',
    'get_leaderboard_streaks', 'get_team_leaderboard'
  ];
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(client_rpcs)
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
      fn.proname, fn.args
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
