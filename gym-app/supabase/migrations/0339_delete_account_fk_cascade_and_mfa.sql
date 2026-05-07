-- ============================================================
-- 20260429000003 — delete_user_account FK cascade fix + MFA
-- ============================================================
-- Audit of 0336_harden_delete_user_account found that
-- delete_user_account() will FK-fail for any user who ever served
-- as admin/trainer because several columns reference profiles(id)
-- with NOT NULL and no ON DELETE clause. When we DELETE the row
-- from profiles at the end, Postgres aborts the transaction.
--
-- OFFENDERS (NOT NULL REFERENCES profiles(id) with no ON DELETE):
--   - member_purchases.recorded_by      (0081_gym_store_purchases)
--   - gym_invites.created_by            (0022_gym_invites)
--   - member_invites.created_by         (0118_member_invite_system)
--   - kpi_targets.created_by            (0171_kpi_targets)
--   - nps_surveys.created_by            (0169_nps_surveys)
--
-- Strategy:
--   1. ALTER each offender column to DROP NOT NULL so we can
--      anonymize-by-null (preserves the row, removes attribution).
--   2. CREATE OR REPLACE delete_user_account() — copies the full
--      0336 body, then adds explicit UPDATE … SET <col> = NULL
--      for each offender BEFORE the final DELETE FROM profiles.
--
-- Notes:
--   - Tables with NOT NULL + ON DELETE CASCADE (gym_programs.created_by,
--     challenges.created_by, announcements.created_by, etc.) do NOT
--     fail and CASCADE will delete the rows automatically. We do NOT
--     try to anonymize those — they're already handled.
--   - Each ALTER is wrapped in EXCEPTION to tolerate sharded DBs
--     where a table may not exist yet.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A. Drop NOT NULL on every actor column that would FK-fail
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.member_purchases ALTER COLUMN recorded_by DROP NOT NULL;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.gym_invites ALTER COLUMN created_by DROP NOT NULL;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.member_invites ALTER COLUMN created_by DROP NOT NULL;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.kpi_targets ALTER COLUMN created_by DROP NOT NULL;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.nps_surveys ALTER COLUMN created_by DROP NOT NULL;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- B. REPLACE delete_user_account() with FK-safe version
-- ─────────────────────────────────────────────────────────────
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
  -- STORAGE OBJECTS — must run BEFORE deleting profiles row.
  -- (Same as 0336 — see that migration for rationale.)
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
  -- CHECK-INS & ATTENDANCE
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

  -- ============================================================
  -- ANONYMIZE ADMIN/TRAINER-ATTRIBUTED ROWS
  --
  -- For columns where the user was the actor (created/recorded
  -- something) but the row is meaningful WITHOUT them, we null
  -- out the FK so the row survives. This is the right-to-be-
  -- forgotten approach: the user vanishes, the artifact remains.
  --
  -- Each block is wrapped in EXCEPTION so missing tables/columns
  -- (sharded DBs, legacy schemas) don't abort deletion.
  -- ============================================================

  -- gym_invites: created_by null-out preserves invite history
  -- (overrides the 0336 DELETE behavior so we keep audit trail).
  -- The DELETE in 0336 was safe because the column was NOT NULL,
  -- but with anonymization we can preserve the gym's invite log.
  BEGIN
    UPDATE public.gym_invites SET created_by = NULL WHERE created_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  BEGIN
    UPDATE public.gym_invites SET used_by = NULL WHERE used_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  -- member_invites: keep claim/issue history; just anonymize actor refs
  BEGIN
    UPDATE public.member_invites SET created_by = NULL WHERE created_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  BEGIN
    UPDATE public.member_invites SET claimed_by = NULL WHERE claimed_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  -- member_purchases: preserve gym sales history
  BEGIN
    UPDATE public.member_purchases SET recorded_by = NULL WHERE recorded_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  -- kpi_targets: preserve gym KPI configuration
  BEGIN
    UPDATE public.kpi_targets SET created_by = NULL WHERE created_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  -- nps_surveys: preserve survey configuration / response history
  BEGIN
    UPDATE public.nps_surveys SET created_by = NULL WHERE created_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  -- password_reset_requests: nullable already, but be explicit
  BEGIN
    UPDATE public.password_reset_requests SET approved_by = NULL WHERE approved_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  -- streak_cache / closures already covered above; nullable-by-default
  -- created_by columns elsewhere are best-effort:
  BEGIN
    UPDATE public.gym_closures SET created_by = NULL WHERE created_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  BEGIN
    UPDATE public.member_segments SET created_by = NULL WHERE created_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  BEGIN
    UPDATE public.platform_config SET updated_by = NULL WHERE updated_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  BEGIN
    UPDATE public.sms_messages SET sent_by = NULL WHERE sent_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  BEGIN
    UPDATE public.sms_messages SET admin_id = NULL WHERE admin_id = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  -- moderation actions: keep the moderated row but unattribute the moderator
  BEGIN
    UPDATE public.feed_posts SET deleted_by = NULL WHERE deleted_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  BEGIN
    UPDATE public.feed_comments SET deleted_by = NULL WHERE deleted_by = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  -- friend_challenges winner ref is nullable already; be safe
  BEGIN
    UPDATE public.friend_challenges SET winner_id = NULL WHERE winner_id = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;
  -- challenge teams captain
  BEGIN
    UPDATE public.challenge_teams SET captain_id = NULL WHERE captain_id = _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
  END;

  -- ============================================================
  -- AUDIT LOG — KEEP rows for fraud/compliance forensics, but null
  -- out actor_id so the row is no longer attributable. (Same as 0336.)
  -- ============================================================
  BEGIN
    EXECUTE 'UPDATE public.audit_log SET actor_id = NULL WHERE actor_id = $1' USING _uid;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
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
  -- Cascades ON DELETE CASCADE tables: gym_programs, challenges,
  -- announcements, blocked_users, etc. — those are intentionally
  -- destructive (the artifact is meaningless without its admin).
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
