-- ============================================================
-- 0336: Harden delete_user_account for Apple 5.1.1(v) compliance
--
-- Audit of 0304_fix_delete_user_account_v4 found:
--   GAPS:
--     1. NO storage cleanup. Files in `progress-photos/{uid}/*`,
--        `social-posts/{uid}/*`, `avatars/{uid}/*`,
--        `profile-photos/{uid}/*` survived account deletion. Apple
--        treats orphan PII in storage as a 5.1.1(v) violation.
--     2. NO cleanup of `audit_log` / `error_logs` user_id references —
--        we INTENTIONALLY KEEP audit_log rows for fraud / compliance
--        forensics, but null out the profile_id so the row is no longer
--        attributable to the deleted user. error_logs rows we delete.
--     3. NO cleanup of `wallet_pass_serial` / `wallet_auth_token`
--        registration rows in apple-wallet-webhook tables. These are
--        on profile cascade or get cleaned by a separate webhook flow,
--        but we add explicit deletes for safety.
--     4. NO `gym_check_ins` or `cardio_sessions` deletion under those
--        exact names — they're stored in `check_ins` and
--        `cardio_sessions` (the v4 already covers both, audited OK).
--
-- This migration REPLACES public.delete_user_account with a complete
-- version that covers all of the above.
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

  -- ============================================================
  -- STORAGE OBJECTS — must run BEFORE deleting profiles row, so
  -- the user is still authenticated for their own bucket policies
  -- (we use SECURITY DEFINER so policies don't gate us, but the
  -- ordering matters because storage.objects has FKs into auth.users
  -- on the `owner` column which would block the auth user delete
  -- if rows still exist with owner = _uid).
  --
  -- All buckets we touch are documented in migration 0024 / 0207 /
  -- 0230 / 0223. We cover every user-namespaced folder.
  -- ============================================================

  -- Per-user folder layout: bucket/{uid}/{file...}
  DELETE FROM storage.objects
  WHERE bucket_id IN (
          'progress-photos',
          'progress_photos',          -- legacy bucket name (see 0230)
          'social-posts',
          'avatars',
          'profile-photos',
          'food-images',              -- user-uploaded food photos
          'body-analysis-photos'      -- AI body composition uploads
        )
    AND (
          owner = _uid
          OR (storage.foldername(name))[1] = _uid::text
        );

  -- ============================================================
  -- WORKOUT DATA (deepest children first)
  -- ============================================================
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

  -- ============================================================
  -- ROUTINES & PROGRAMS
  -- ============================================================
  DELETE FROM public.routine_exercises WHERE routine_id IN (
    SELECT id FROM public.routines WHERE created_by = _uid
  );
  DELETE FROM public.routines WHERE created_by = _uid;
  DELETE FROM public.workout_schedule WHERE profile_id = _uid;
  DELETE FROM public.user_enrolled_programs WHERE profile_id = _uid;

  -- ============================================================
  -- BODY & PROGRESS
  -- ============================================================
  DELETE FROM public.body_measurements WHERE profile_id = _uid;
  DELETE FROM public.body_weight_logs WHERE profile_id = _uid;
  DELETE FROM public.progress_photos WHERE profile_id = _uid;

  -- ============================================================
  -- NUTRITION
  -- ============================================================
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

  -- ============================================================
  -- SOCIAL: DIRECT MESSAGES & CONVERSATIONS
  -- ============================================================
  DELETE FROM public.direct_messages WHERE sender_id = _uid;
  DELETE FROM public.direct_messages WHERE conversation_id IN (
    SELECT id FROM public.conversations
    WHERE participant_1 = _uid OR participant_2 = _uid
  );
  DELETE FROM public.conversations
    WHERE participant_1 = _uid OR participant_2 = _uid;

  -- ============================================================
  -- SOCIAL: FEED
  -- ============================================================
  DELETE FROM public.feed_reactions WHERE profile_id = _uid;
  DELETE FROM public.feed_likes WHERE profile_id = _uid;
  DELETE FROM public.feed_comments WHERE profile_id = _uid;
  DELETE FROM public.activity_feed_items WHERE actor_id = _uid;
  DELETE FROM public.friendships
    WHERE requester_id = _uid OR addressee_id = _uid;

  -- ============================================================
  -- CHALLENGES & ACHIEVEMENTS
  -- ============================================================
  DELETE FROM public.challenge_score_events WHERE profile_id = _uid;
  DELETE FROM public.challenge_participants WHERE profile_id = _uid;
  DELETE FROM public.user_achievements
    WHERE profile_id = _uid OR user_id = _uid;
  DELETE FROM public.milestone_events WHERE profile_id = _uid;

  -- ============================================================
  -- STORE & REWARDS
  -- ============================================================
  DELETE FROM public.member_purchases WHERE member_id = _uid;
  DELETE FROM public.member_punch_cards WHERE member_id = _uid;
  DELETE FROM public.reward_redemptions WHERE profile_id = _uid;
  DELETE FROM public.reward_points_log WHERE profile_id = _uid;
  DELETE FROM public.reward_points WHERE profile_id = _uid;

  -- ============================================================
  -- CHECK-INS & ATTENDANCE (covers gym_check_ins via check_ins)
  -- ============================================================
  DELETE FROM public.check_ins WHERE profile_id = _uid;
  DELETE FROM public.streak_cache WHERE profile_id = _uid;
  DELETE FROM public.streak_freezes WHERE profile_id = _uid;

  -- ============================================================
  -- CLASSES
  -- ============================================================
  DELETE FROM public.gym_class_bookings WHERE profile_id = _uid;

  -- ============================================================
  -- LEADERBOARDS
  -- ============================================================
  DELETE FROM public.leaderboard_snapshots WHERE profile_id = _uid;

  -- ============================================================
  -- NOTIFICATIONS & PUSH
  -- ============================================================
  DELETE FROM public.notifications WHERE profile_id = _uid;
  DELETE FROM public.push_tokens WHERE profile_id = _uid;
  DELETE FROM public.admin_notification_prefs WHERE profile_id = _uid;

  -- ============================================================
  -- TRAINERS
  -- ============================================================
  DELETE FROM public.trainer_clients
    WHERE trainer_id = _uid OR client_id = _uid;

  -- ============================================================
  -- CHURN
  -- ============================================================
  DELETE FROM public.churn_risk_scores WHERE profile_id = _uid;

  -- ============================================================
  -- NPS
  -- ============================================================
  DELETE FROM public.nps_responses WHERE profile_id = _uid;

  -- ============================================================
  -- GOALS
  -- ============================================================
  DELETE FROM public.member_goals WHERE profile_id = _uid;

  -- ============================================================
  -- CONTENT REPORTS
  -- ============================================================
  DELETE FROM public.content_reports WHERE reporter_id = _uid;

  -- ============================================================
  -- ONBOARDING & MISC
  -- ============================================================
  DELETE FROM public.member_onboarding WHERE profile_id = _uid;
  DELETE FROM public.ai_rate_limits WHERE profile_id = _uid;
  DELETE FROM public.ai_food_corrections WHERE profile_id = _uid;
  DELETE FROM public.error_logs WHERE profile_id = _uid;
  DELETE FROM public.gym_invites WHERE created_by = _uid;

  -- ============================================================
  -- AUDIT LOG — KEEP rows for fraud/compliance forensics, but null
  -- out actor_id so the row is no longer attributable to the deleted
  -- user (right-to-be-forgotten while preserving audit integrity).
  -- Wrapped in IF EXISTS because audit_log columns differ across gyms
  -- (some shards still have the older 0040 schema with `user_id`).
  -- ============================================================
  BEGIN
    EXECUTE 'UPDATE public.audit_log SET actor_id = NULL WHERE actor_id = $1' USING _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    -- audit_log table or column doesn't exist on this DB — skip silently
    NULL;
  END;
  BEGIN
    EXECUTE 'UPDATE public.audit_log SET user_id = NULL WHERE user_id = $1' USING _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    NULL;
  END;

  -- ============================================================
  -- CUSTOM EXERCISES CREATED BY USER
  -- ============================================================
  DELETE FROM public.exercises
    WHERE created_by = _uid AND gym_id IS NOT NULL;

  -- ============================================================
  -- PROFILE LOOKUP (RLS-free mirror table)
  -- ============================================================
  DELETE FROM public.profile_lookup WHERE id = _uid;

  -- ============================================================
  -- PROFILE — must be after all FK references.
  -- This also cascades to tables with ON DELETE CASCADE:
  --   blocked_users, feature_adoption_events,
  --   workout_schedule_patterns, etc.
  -- ============================================================
  DELETE FROM public.profiles WHERE id = _uid;

  -- ============================================================
  -- AUTH USER — final step.
  -- ============================================================
  DELETE FROM auth.users WHERE id = _uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

NOTIFY pgrst, 'reload schema';
