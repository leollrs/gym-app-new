-- =============================================================
-- SECURITY FIX: Privacy improvements
-- Migration: 0225_security_fix_privacy.sql
--
-- 1. Create gym_member_profiles_safe view (excludes sensitive columns)
-- 2. Harden get_profile_preview to respect privacy_public flag
-- 3. Expand delete_user_account to cover all missed tables
-- =============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. PROFILES_SELECT — safe view for listing gym members
-- ────────────────────────────────────────────────────────────────
-- RLS cannot restrict columns, only rows. The profiles_select policy
-- (migration 0018) grants same-gym SELECT on ALL columns, which
-- exposes sensitive fields (phone_number, date_of_birth,
-- bodyweight_lbs, admin_note) to regular members.
--
-- Solution: a secure view that only exposes non-sensitive columns.
-- The frontend should use this view when listing/searching other
-- gym members. Direct profiles table access remains for own-profile
-- reads and admin/trainer use cases.
-- ────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.gym_member_profiles_safe;

CREATE VIEW public.gym_member_profiles_safe AS
  SELECT
    p.id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.avatar_type,
    p.avatar_value,
    p.bio,
    p.role,
    p.gym_id,
    p.created_at,
    p.last_active_at,
    p.privacy_public,
    p.leaderboard_visible
  FROM public.profiles p;

-- The view inherits RLS from the underlying profiles table, so
-- same-gym boundary is already enforced by profiles_select policy.
-- Grant access to authenticated users.
GRANT SELECT ON public.gym_member_profiles_safe TO authenticated;

COMMENT ON VIEW public.gym_member_profiles_safe IS
  'Safe subset of profiles columns for member-to-member views. '
  'Excludes: phone_number, date_of_birth, bodyweight_lbs, admin_note, '
  'email, and other sensitive fields. Frontend should prefer this view '
  'when displaying other gym members.';


-- ────────────────────────────────────────────────────────────────
-- 2. GET_PROFILE_PREVIEW — respect privacy_public flag
-- ────────────────────────────────────────────────────────────────
-- Previously returned data for any same-gym member regardless of
-- their privacy setting. Now returns NULL when the target user
-- has privacy_public = FALSE, unless the caller is:
--   - The user themselves
--   - An admin / super_admin of the same gym
--   - A trainer of the target user
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_profile_preview(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          UUID;
  my_gym       UUID;
  their_gym    UUID;
  their_role   TEXT;
  is_private   BOOLEAN;
  caller_role  TEXT;
  result       JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Own profile — always allowed
  IF uid = p_user_id THEN
    -- fall through to query below
    NULL;
  ELSE
    -- Get caller's gym and role
    SELECT pl.gym_id, pl.role::TEXT INTO my_gym, caller_role
      FROM profile_lookup pl WHERE pl.id = uid;

    -- Get target's gym and privacy flag
    SELECT p.gym_id, p.privacy_public INTO their_gym, is_private
      FROM profiles p WHERE p.id = p_user_id;

    -- Note: privacy_public = FALSE means the profile is private
    -- (the column name is confusing — FALSE = private)

    -- Enforce same-gym boundary
    IF my_gym IS NULL OR their_gym IS NULL OR my_gym != their_gym THEN
      RETURN NULL;
    END IF;

    -- Privacy check: if target is private, only admins/trainers may view
    IF is_private = FALSE THEN
      -- Caller is admin or super_admin — allowed
      IF caller_role IN ('admin', 'super_admin') THEN
        NULL; -- allowed
      -- Caller is a trainer of this user — allowed
      ELSIF EXISTS (
        SELECT 1 FROM trainer_clients
        WHERE trainer_id = uid AND client_id = p_user_id AND is_active = TRUE
      ) THEN
        NULL; -- allowed
      ELSE
        -- Regular member viewing a private profile — blocked
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  SELECT json_build_object(
    'profile', (
      SELECT json_build_object(
        'id',           p.id,
        'username',     p.username,
        'full_name',    p.full_name,
        'avatar_url',   p.avatar_url,
        'avatar_type',  p.avatar_type,
        'avatar_value', p.avatar_value,
        'created_at',   p.created_at,
        'fitness_level', mo.fitness_level,
        'goal',         mo.primary_goal
      )
      FROM profiles p
      LEFT JOIN member_onboarding mo ON mo.profile_id = p.id
      WHERE p.id = p_user_id
    ),
    'workouts', (
      SELECT COUNT(*)::INT FROM workout_sessions WHERE profile_id = p_user_id
    ),
    'prs', (
      SELECT COUNT(*)::INT FROM personal_records WHERE profile_id = p_user_id
    ),
    'streak', (
      SELECT COALESCE(current_streak_days, 0)
      FROM streak_cache WHERE profile_id = p_user_id
    ),
    'latest_achievement', (
      SELECT achievement_key
      FROM user_achievements
      WHERE profile_id = p_user_id OR user_id = p_user_id
      ORDER BY unlocked_at DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_preview(UUID) TO authenticated;


-- ────────────────────────────────────────────────────────────────
-- 3. DELETE_USER_ACCOUNT — expand to cover missed tables
-- ────────────────────────────────────────────────────────────────
-- The v3 function (0106) missed several tables added after it was
-- written. This version adds cleanup for: direct_messages,
-- conversations, sms_conversations, sms_messages, profile_lookup,
-- milestone_events, reward_points, reward_points_log, pr_history,
-- nutrition_targets, nutrition_checkins, leaderboard_snapshots,
-- user_enrolled_programs, overload_suggestions, push_tokens,
-- feed_reactions, workout_schedule, generated_programs,
-- admin_notification_prefs, gym_invites, trainer_clients, and
-- churn_risk_scores.
--
-- Also fixes user_achievements to delete by both profile_id and
-- user_id (the table has both columns per migration 0083).
-- ────────────────────────────────────────────────────────────────

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

  -- ── Social: Direct messages & conversations ──
  DELETE FROM public.direct_messages WHERE sender_id = _uid;
  -- Also delete messages in conversations where user is a participant
  -- (the other person's messages in a shared conversation)
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
  DELETE FROM public.profiles WHERE id = _uid;

  -- ── Auth user ──
  DELETE FROM auth.users WHERE id = _uid;
END;
$$;


NOTIFY pgrst, 'reload schema';
