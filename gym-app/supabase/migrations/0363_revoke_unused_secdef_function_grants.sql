-- ============================================================================
-- 0363 — Revoke EXECUTE on SECURITY DEFINER functions not reachable from
-- the client, edge functions, or RLS policies.
-- ============================================================================
-- Strategy: a function in `public` only needs `EXECUTE` granted to
-- `authenticated` if one of these is true:
--   (a) The client (or an edge function with anon JWT) calls it via
--       `supabase.rpc(...)`, OR
--   (b) An RLS policy expression invokes it (the policy evaluates as
--       the calling user, so the caller needs EXECUTE), OR
--   (c) It's a trigger function (those bypass GRANT entirely — already
--       revoked in 0362, so they're filtered out here too).
--
-- This migration revokes EXECUTE from PUBLIC/anon/authenticated for every
-- SECURITY DEFINER function in `public` that does NOT match (a), (b),
-- or (c).
--
--   • The exemption list below was generated from `git grep` of every
--     `supabase.rpc(...)` call in `gym-app/src/` and
--     `gym-app/supabase/functions/`. 82 RPC names total.
--   • RLS-policy reachability is checked dynamically against
--     `pg_policies` — any function whose name appears inside a policy's
--     `qual` (USING) or `with_check` clause is left alone.
--   • Trigger functions (`prorettype = trigger`) are skipped — already
--     handled by 0362.
--
-- Functions called only from inside other SECURITY DEFINER functions in
-- `public` continue to work: those callers run as their own owner
-- (postgres), which retains `EXECUTE` on every function in the schema.
--
-- Rollback: if any function turns out to be REST-reachable in a way the
-- grep missed, re-grant with:
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated;
-- ============================================================================

DO $$
DECLARE
  fn        RECORD;
  in_policy BOOLEAN;
  -- 82 RPCs grepped from the JS/TS client + edge functions on 2026-05-04.
  -- Keep this in sync if a new RPC is added that's only invoked client-side.
  exempt    TEXT[] := ARRAY[
    'ack_session_cue',
    'add_reward_points',
    'add_reward_points_checked',
    'admin_approve_password_reset',
    'admin_bulk_freeze',
    'admin_create_gym_member',
    'admin_create_invite_code',
    'admin_delete_challenge',
    'admin_delete_class',
    'admin_delete_gym_member',
    'admin_deny_password_reset',
    'admin_generate_password_reset',
    'admin_get_member_email',
    'admin_get_or_create_voucher',
    'admin_gift_reward',
    'admin_heartbeat',
    'admin_redeem_voucher',
    'admin_update_member_email',
    'award_challenge_prizes',
    'book_class',
    'broadcast_notification',
    'cancel_class_booking',
    'cancel_redemption',
    'check_and_increment_gym_usage',
    'checkin_class',
    'choose_referral_reward',
    'claim_invite_code',
    'claim_member_invite',
    'claim_redemption',
    'complete_workout_v2',
    'compute_churn_scores',
    'create_password_reset_request',
    'delete_own_account',
    'delete_user_account',
    'delete_user_account_admin',
    'demote_trainer_atomically',
    'generate_referral_code',
    'get_admin_notification_prefs',
    'get_auth_context',
    'get_challenge_suggestion',
    'get_dashboard_data',
    'get_effective_roles',
    'get_feed_enrichment',
    'get_friend_feed',
    'get_friend_streaks',
    'get_leaderboard_checkins',
    'get_leaderboard_consistency',
    'get_leaderboard_most_improved',
    'get_leaderboard_newcomers',
    'get_leaderboard_prs',
    'get_leaderboard_volume',
    'get_milestone_feed',
    'get_nps_stats',
    'get_or_create_conversation',
    'get_profile_preview',
    'get_team_leaderboard',
    'get_trainer_adherence',
    'get_trainer_review_summary',
    'increment_challenge_score',
    'increment_failed_reset_attempts',
    'increment_sms_usage',
    'link_class_workout',
    'log_admin_action',
    'log_backdated_workout',
    'log_cardio_session',
    'lookup_gym_invite_by_code',
    'lookup_invite_by_code',
    'lookup_referral_code',
    'moderation_check_dm',
    'pause_gym',
    'platform_create_gym',
    'record_gym_purchase',
    'redeem_reward',
    'register_referral',
    'restore_deleted_session',
    'safe_complete_referral',
    'set_challenge_score',
    'soft_delete_workout_session',
    'toggle_recurring_class',
    'trainer_assign_program',
    'trainer_send_cue',
    'unpause_gym'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'                              -- functions only, not procedures
      AND p.prosecdef = TRUE                           -- SECURITY DEFINER only
      AND p.prorettype <> 'pg_catalog.trigger'::regtype  -- skip trigger functions (handled by 0362)
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname <> ALL(exempt)
  LOOP
    -- Check if this function name appears in any RLS policy expression.
    -- A simple substring match on `qual` / `with_check` is good enough to
    -- catch `func_name(` references; false positives just mean we leave
    -- a function callable that we could have revoked, which is harmless.
    SELECT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          COALESCE(qual, '')       LIKE '%' || fn.proname || '(%' OR
          COALESCE(with_check, '') LIKE '%' || fn.proname || '(%'
        )
    ) INTO in_policy;

    IF NOT in_policy THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
        fn.proname, fn.args
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
