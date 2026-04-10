-- ============================================================
-- 0304: Fix delete_user_account — remove stale sms_messages ref
--
-- Problem: The live DB has a version of delete_user_account that
-- references "public.sms_essages" (typo for sms_messages), but
-- that table was dropped in migration 0231_remove_twilio_sms.
-- This causes account deletion to fail with:
--   relation "public.sms_essages" does not exist
--
-- Fix: Re-create the function with all current tables.
-- Tables with ON DELETE CASCADE on profiles(id) are handled
-- automatically and don't need explicit DELETE statements.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Workout data (deepest children first) ──
  DELETE FROM public.session_sets WHERE session_exercise_id IN (
    SELECT id FROM public.session_exercises WHERE session_id IN (
      SELECT id FROM public.workout_sessions WHERE profile_id = _uid
    )
  );
  DELETE FROM public.session_exercises WHERE session_id IN (
    SELECT id FROM public.workout_sessions WHERE profile_id = _uid
  );
  DELETE FROM public.workout_sessions WHERE profile_id = _uid;
  DELETE FROM public.session_drafts WHERE profile_id = _uid;
  DELETE FROM public.personal_records WHERE profile_id = _uid;
  DELETE FROM public.pr_history WHERE profile_id = _uid;
  DELETE FROM public.overload_suggestions WHERE profile_id = _uid;
  DELETE FROM public.cardio_sessions WHERE profile_id = _uid;

  -- ── Routines & programs ──
  DELETE FROM public.routine_exercises WHERE routine_id IN (
    SELECT id FROM public.routines WHERE created_by = _uid
  );
  DELETE FROM public.routines WHERE created_by = _uid;
  DELETE FROM public.workout_schedule WHERE profile_id = _uid;
  DELETE FROM public.user_enrolled_programs WHERE profile_id = _uid;

  -- ── Body & progress ──
  DELETE FROM public.body_measurements WHERE profile_id = _uid;
  DELETE FROM public.body_weight_logs WHERE profile_id = _uid;
  DELETE FROM public.progress_photos WHERE profile_id = _uid;

  -- ── Nutrition ──
  DELETE FROM public.food_logs WHERE profile_id = _uid;
  DELETE FROM public.favorite_foods WHERE profile_id = _uid;
  DELETE FROM public.saved_meal_items WHERE meal_id IN (
    SELECT id FROM public.saved_meals WHERE profile_id = _uid
  );
  DELETE FROM public.saved_meals WHERE profile_id = _uid;
  DELETE FROM public.nutrition_targets WHERE profile_id = _uid;
  DELETE FROM public.nutrition_checkins WHERE profile_id = _uid;
  DELETE FROM public.disliked_foods WHERE profile_id = _uid;
  DELETE FROM public.generated_meal_plans WHERE profile_id = _uid;

  -- ── Social: Direct messages & conversations ──
  DELETE FROM public.direct_messages WHERE sender_id = _uid;
  DELETE FROM public.direct_messages WHERE conversation_id IN (
    SELECT id FROM public.conversations
    WHERE participant_1 = _uid OR participant_2 = _uid
  );
  DELETE FROM public.conversations WHERE participant_1 = _uid OR participant_2 = _uid;

  -- ── Social: Feed ──
  DELETE FROM public.feed_reactions WHERE profile_id = _uid;
  DELETE FROM public.feed_likes WHERE profile_id = _uid;
  DELETE FROM public.feed_comments WHERE profile_id = _uid;
  DELETE FROM public.activity_feed_items WHERE actor_id = _uid;
  DELETE FROM public.friendships WHERE requester_id = _uid OR addressee_id = _uid;

  -- ── Challenges & achievements ──
  DELETE FROM public.challenge_score_events WHERE profile_id = _uid;
  DELETE FROM public.challenge_participants WHERE profile_id = _uid;
  DELETE FROM public.user_achievements WHERE profile_id = _uid OR user_id = _uid;
  DELETE FROM public.milestone_events WHERE profile_id = _uid;

  -- ── Store & rewards ──
  DELETE FROM public.member_purchases WHERE member_id = _uid;
  DELETE FROM public.member_punch_cards WHERE member_id = _uid;
  DELETE FROM public.reward_redemptions WHERE profile_id = _uid;
  DELETE FROM public.reward_points_log WHERE profile_id = _uid;
  DELETE FROM public.reward_points WHERE profile_id = _uid;

  -- ── Check-ins & attendance ──
  DELETE FROM public.check_ins WHERE profile_id = _uid;
  DELETE FROM public.streak_cache WHERE profile_id = _uid;
  DELETE FROM public.streak_freezes WHERE profile_id = _uid;

  -- ── Classes ──
  DELETE FROM public.gym_class_bookings WHERE profile_id = _uid;

  -- ── Leaderboards ──
  DELETE FROM public.leaderboard_snapshots WHERE profile_id = _uid;

  -- ── Notifications & push ──
  DELETE FROM public.notifications WHERE profile_id = _uid;
  DELETE FROM public.push_tokens WHERE profile_id = _uid;
  DELETE FROM public.admin_notification_prefs WHERE profile_id = _uid;

  -- ── Trainers ──
  DELETE FROM public.trainer_clients WHERE trainer_id = _uid OR client_id = _uid;

  -- ── Churn ──
  DELETE FROM public.churn_risk_scores WHERE profile_id = _uid;

  -- ── NPS ──
  DELETE FROM public.nps_responses WHERE profile_id = _uid;

  -- ── Goals ──
  DELETE FROM public.member_goals WHERE profile_id = _uid;

  -- ── Content reports ──
  DELETE FROM public.content_reports WHERE reporter_id = _uid;

  -- ── Onboarding & misc ──
  DELETE FROM public.member_onboarding WHERE profile_id = _uid;
  DELETE FROM public.ai_rate_limits WHERE profile_id = _uid;
  DELETE FROM public.ai_food_corrections WHERE profile_id = _uid;
  DELETE FROM public.error_logs WHERE profile_id = _uid;
  DELETE FROM public.gym_invites WHERE created_by = _uid;

  -- ── Custom exercises created by user ──
  DELETE FROM public.exercises WHERE created_by = _uid AND gym_id IS NOT NULL;

  -- ── Profile lookup (RLS-free mirror table) ──
  DELETE FROM public.profile_lookup WHERE id = _uid;

  -- ── Profile (must be after all FK references) ──
  -- This also cascades to tables with ON DELETE CASCADE:
  -- blocked_users, feature_adoption_events, workout_schedule_patterns, etc.
  DELETE FROM public.profiles WHERE id = _uid;

  -- ── Auth user ──
  DELETE FROM auth.users WHERE id = _uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

NOTIFY pgrst, 'reload schema';
