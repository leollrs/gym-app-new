-- ============================================================
-- 0341 — delete_user_account_admin(p_user_id uuid)
--
-- Service-role-only variant of delete_user_account() for use by
-- the confirm-account-deletion edge function. The user-facing
-- delete_user_account() (0339) uses auth.uid() and works only
-- for the currently authenticated user. The web deletion flow
-- (Play Store policy: "no login required") needs to delete a
-- user identified by token, not by JWT, so this variant takes
-- the user_id as a parameter and is callable only by the
-- service role.
--
-- SECURITY:
--   - SECURITY DEFINER (runs as the function owner)
--   - Permission GRANTed ONLY to service_role
--   - REVOKED from public, anon, authenticated
--   - The edge function authenticates the request via the
--     account_deletion_requests row (token_hash + status check
--     + TTL) BEFORE invoking this RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_user_account_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  -- Sanity check: target user must exist in auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- ============================================================
  -- STORAGE OBJECTS — must run BEFORE deleting profiles row.
  -- ============================================================
  DELETE FROM storage.objects
  WHERE bucket_id IN (
          'progress-photos',
          'progress_photos',
          'social-posts',
          'avatars',
          'profile-photos',
          'food-images',
          'body-analysis-photos'
        )
    AND (
          owner = p_user_id
          OR (storage.foldername(name))[1] = p_user_id::text
        );

  -- ============================================================
  -- WORKOUT DATA
  -- ============================================================
  DELETE FROM public.session_sets WHERE session_exercise_id IN (
    SELECT id FROM public.session_exercises WHERE session_id IN (
      SELECT id FROM public.workout_sessions WHERE profile_id = p_user_id
    )
  );
  DELETE FROM public.session_exercises WHERE session_id IN (
    SELECT id FROM public.workout_sessions WHERE profile_id = p_user_id
  );
  DELETE FROM public.workout_sessions WHERE profile_id = p_user_id;
  DELETE FROM public.session_drafts WHERE profile_id = p_user_id;
  DELETE FROM public.personal_records WHERE profile_id = p_user_id;
  DELETE FROM public.pr_history WHERE profile_id = p_user_id;
  DELETE FROM public.overload_suggestions WHERE profile_id = p_user_id;
  DELETE FROM public.cardio_sessions WHERE profile_id = p_user_id;

  -- ============================================================
  -- ROUTINES & PROGRAMS
  -- ============================================================
  DELETE FROM public.routine_exercises WHERE routine_id IN (
    SELECT id FROM public.routines WHERE created_by = p_user_id
  );
  DELETE FROM public.routines WHERE created_by = p_user_id;
  DELETE FROM public.workout_schedule WHERE profile_id = p_user_id;
  DELETE FROM public.user_enrolled_programs WHERE profile_id = p_user_id;

  -- ============================================================
  -- BODY & PROGRESS
  -- ============================================================
  DELETE FROM public.body_measurements WHERE profile_id = p_user_id;
  DELETE FROM public.body_weight_logs WHERE profile_id = p_user_id;
  DELETE FROM public.progress_photos WHERE profile_id = p_user_id;

  -- ============================================================
  -- NUTRITION
  -- ============================================================
  DELETE FROM public.food_logs WHERE profile_id = p_user_id;
  DELETE FROM public.favorite_foods WHERE profile_id = p_user_id;
  DELETE FROM public.saved_meal_items WHERE meal_id IN (
    SELECT id FROM public.saved_meals WHERE profile_id = p_user_id
  );
  DELETE FROM public.saved_meals WHERE profile_id = p_user_id;
  DELETE FROM public.nutrition_targets WHERE profile_id = p_user_id;
  DELETE FROM public.nutrition_checkins WHERE profile_id = p_user_id;
  DELETE FROM public.disliked_foods WHERE profile_id = p_user_id;
  DELETE FROM public.generated_meal_plans WHERE profile_id = p_user_id;

  -- ============================================================
  -- SOCIAL: DM & FEED
  -- ============================================================
  DELETE FROM public.direct_messages WHERE sender_id = p_user_id;
  DELETE FROM public.direct_messages WHERE conversation_id IN (
    SELECT id FROM public.conversations
    WHERE participant_1 = p_user_id OR participant_2 = p_user_id
  );
  DELETE FROM public.conversations
    WHERE participant_1 = p_user_id OR participant_2 = p_user_id;

  DELETE FROM public.feed_reactions WHERE profile_id = p_user_id;
  DELETE FROM public.feed_likes WHERE profile_id = p_user_id;
  DELETE FROM public.feed_comments WHERE profile_id = p_user_id;
  DELETE FROM public.activity_feed_items WHERE actor_id = p_user_id;
  DELETE FROM public.friendships
    WHERE requester_id = p_user_id OR addressee_id = p_user_id;

  -- ============================================================
  -- CHALLENGES, ACHIEVEMENTS, REWARDS, CHECK-INS, CLASSES
  -- ============================================================
  DELETE FROM public.challenge_score_events WHERE profile_id = p_user_id;
  DELETE FROM public.challenge_participants WHERE profile_id = p_user_id;
  DELETE FROM public.user_achievements
    WHERE profile_id = p_user_id OR user_id = p_user_id;
  DELETE FROM public.milestone_events WHERE profile_id = p_user_id;
  DELETE FROM public.member_purchases WHERE member_id = p_user_id;
  DELETE FROM public.member_punch_cards WHERE member_id = p_user_id;
  DELETE FROM public.reward_redemptions WHERE profile_id = p_user_id;
  DELETE FROM public.reward_points_log WHERE profile_id = p_user_id;
  DELETE FROM public.reward_points WHERE profile_id = p_user_id;
  DELETE FROM public.check_ins WHERE profile_id = p_user_id;
  DELETE FROM public.streak_cache WHERE profile_id = p_user_id;
  DELETE FROM public.streak_freezes WHERE profile_id = p_user_id;
  DELETE FROM public.gym_class_bookings WHERE profile_id = p_user_id;
  DELETE FROM public.leaderboard_snapshots WHERE profile_id = p_user_id;
  DELETE FROM public.notifications WHERE profile_id = p_user_id;
  DELETE FROM public.push_tokens WHERE profile_id = p_user_id;
  DELETE FROM public.admin_notification_prefs WHERE profile_id = p_user_id;
  DELETE FROM public.trainer_clients
    WHERE trainer_id = p_user_id OR client_id = p_user_id;
  DELETE FROM public.churn_risk_scores WHERE profile_id = p_user_id;
  DELETE FROM public.nps_responses WHERE profile_id = p_user_id;
  DELETE FROM public.member_goals WHERE profile_id = p_user_id;
  DELETE FROM public.content_reports WHERE reporter_id = p_user_id;
  DELETE FROM public.member_onboarding WHERE profile_id = p_user_id;
  DELETE FROM public.ai_rate_limits WHERE profile_id = p_user_id;
  DELETE FROM public.ai_food_corrections WHERE profile_id = p_user_id;
  DELETE FROM public.error_logs WHERE profile_id = p_user_id;

  -- ============================================================
  -- ANONYMIZE ADMIN/TRAINER-ATTRIBUTED ROWS
  -- ============================================================
  BEGIN
    UPDATE public.gym_invites SET created_by = NULL WHERE created_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.gym_invites SET used_by = NULL WHERE used_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.member_invites SET created_by = NULL WHERE created_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.member_invites SET claimed_by = NULL WHERE claimed_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.member_purchases SET recorded_by = NULL WHERE recorded_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.kpi_targets SET created_by = NULL WHERE created_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.nps_surveys SET created_by = NULL WHERE created_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.password_reset_requests SET approved_by = NULL WHERE approved_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.gym_closures SET created_by = NULL WHERE created_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.member_segments SET created_by = NULL WHERE created_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.platform_config SET updated_by = NULL WHERE updated_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.sms_messages SET sent_by = NULL WHERE sent_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.sms_messages SET admin_id = NULL WHERE admin_id = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.feed_posts SET deleted_by = NULL WHERE deleted_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.feed_comments SET deleted_by = NULL WHERE deleted_by = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.friend_challenges SET winner_id = NULL WHERE winner_id = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.challenge_teams SET captain_id = NULL WHERE captain_id = p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;

  -- ============================================================
  -- AUDIT LOG ANONYMIZATION
  -- ============================================================
  BEGIN
    EXECUTE 'UPDATE public.audit_log SET actor_id = NULL WHERE actor_id = $1' USING p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
  BEGIN
    EXECUTE 'UPDATE public.audit_log SET user_id = NULL WHERE user_id = $1' USING p_user_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;

  -- ============================================================
  -- CUSTOM EXERCISES, PROFILE LOOKUP
  -- ============================================================
  DELETE FROM public.exercises
    WHERE created_by = p_user_id AND gym_id IS NOT NULL;
  DELETE FROM public.profile_lookup WHERE id = p_user_id;

  -- ============================================================
  -- PROFILE then AUTH USER
  -- ============================================================
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_user_account_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account_admin(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
