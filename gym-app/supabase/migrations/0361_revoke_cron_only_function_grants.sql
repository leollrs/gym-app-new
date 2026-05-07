-- ============================================================================
-- 0361 — Revoke EXECUTE on cron-only SECURITY DEFINER functions
-- ============================================================================
-- After 0360, the Supabase linter is still flagging ~125 functions under
-- `authenticated_security_definer_function_executable` (lint 0029). Almost
-- all of those are the app's legitimate RPC surface (book_class,
-- complete_workout_v2, get_friend_feed, etc.) — they MUST be callable by
-- authenticated users, and they do their own `auth.uid()` + role checks
-- inside. There is no clean way to clear those warnings without breaking
-- the app or doing a per-function security-invoker rewrite.
--
-- This migration only touches functions that are:
--   • verified callable ONLY by pg_cron (greppped against client + edge)
--   • not referenced by any RLS policy or trigger
--
-- For these, dropping EXECUTE from PUBLIC/anon/authenticated is purely
-- additive security — pg_cron runs as the postgres role, which retains
-- ownership and isn't affected by these revocations.
--
-- Cron-only functions covered:
--   • check_daily_streaks        — scheduled in 0177
--   • cleanup_wallet_push_queue  — scheduled in 0237
--   • execute_drip_campaigns     — scheduled in 0263 / 0301
--   • process_birthdays          — scheduled in 0350
--   • cleanup_old_rate_limits    — scheduled cleanup (0090)
--   • refresh_gym_health_scores  — refresh job for mv_gym_health_scores
-- ============================================================================

DO $$
DECLARE
  fn RECORD;
  cron_only TEXT[] := ARRAY[
    'check_daily_streaks',
    'cleanup_wallet_push_queue',
    'execute_drip_campaigns',
    'process_birthdays',
    'cleanup_old_rate_limits',
    'refresh_gym_health_scores'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(cron_only)
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      fn.proname, fn.args
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
