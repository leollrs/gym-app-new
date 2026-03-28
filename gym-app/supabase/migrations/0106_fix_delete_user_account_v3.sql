-- Fix delete_user_account: add all new tables created since migration 0073
-- Deletes ALL user data in dependency order, then removes the auth user.

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

  -- ── Workout data ──
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

  -- ── Routines & programs ──
  DELETE FROM public.routine_exercises WHERE routine_id IN (
    SELECT id FROM public.routines WHERE created_by = _uid
  );
  DELETE FROM public.routines WHERE created_by = _uid;
  DELETE FROM public.workout_schedule WHERE profile_id = _uid;
  DELETE FROM public.generated_programs WHERE profile_id = _uid;

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

  -- ── Social ──
  DELETE FROM public.feed_reactions WHERE profile_id = _uid;
  DELETE FROM public.feed_likes WHERE profile_id = _uid;
  DELETE FROM public.feed_comments WHERE profile_id = _uid;
  DELETE FROM public.activity_feed_items WHERE actor_id = _uid;
  DELETE FROM public.friendships WHERE requester_id = _uid OR addressee_id = _uid;

  -- ── Challenges & achievements ──
  DELETE FROM public.challenge_participants WHERE profile_id = _uid;
  DELETE FROM public.user_achievements WHERE user_id = _uid;

  -- ── Store & rewards ──
  DELETE FROM public.member_purchases WHERE member_id = _uid;
  DELETE FROM public.member_punch_cards WHERE member_id = _uid;
  DELETE FROM public.reward_redemptions WHERE profile_id = _uid;

  -- ── Check-ins & attendance ──
  DELETE FROM public.check_ins WHERE profile_id = _uid;

  -- ── Notifications & push ──
  DELETE FROM public.notifications WHERE profile_id = _uid;
  DELETE FROM public.push_tokens WHERE profile_id = _uid;

  -- ── Onboarding & misc ──
  DELETE FROM public.member_onboarding WHERE profile_id = _uid;
  DELETE FROM public.streak_cache WHERE profile_id = _uid;
  DELETE FROM public.ai_rate_limits WHERE profile_id = _uid;
  DELETE FROM public.ai_food_corrections WHERE profile_id = _uid;
  DELETE FROM public.error_logs WHERE profile_id = _uid;

  -- ── Custom exercises created by user ──
  DELETE FROM public.exercises WHERE created_by = _uid AND gym_id IS NOT NULL;

  -- ── Profile (must be after all FK references) ──
  DELETE FROM public.profiles WHERE id = _uid;

  -- ── Auth user ──
  DELETE FROM auth.users WHERE id = _uid;
END;
$$;

NOTIFY pgrst, 'reload schema';
