-- Fix delete_user_account: was referencing non-existent feed_reactions table
-- and wrong column name (recipient_id instead of profile_id) on notifications.
-- This broken function causes "Database error querying schema" on PostgREST.

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

  -- Delete in dependency order (children first)
  DELETE FROM public.session_sets WHERE session_exercise_id IN (
    SELECT id FROM public.session_exercises WHERE session_id IN (
      SELECT id FROM public.workout_sessions WHERE profile_id = _uid
    )
  );
  DELETE FROM public.session_exercises WHERE session_id IN (
    SELECT id FROM public.workout_sessions WHERE profile_id = _uid
  );
  DELETE FROM public.workout_sessions WHERE profile_id = _uid;
  DELETE FROM public.personal_records WHERE profile_id = _uid;
  DELETE FROM public.body_metrics WHERE profile_id = _uid;
  DELETE FROM public.check_ins WHERE profile_id = _uid;
  DELETE FROM public.member_onboarding WHERE profile_id = _uid;
  DELETE FROM public.user_achievements WHERE user_id = _uid;
  DELETE FROM public.feed_reactions WHERE profile_id = _uid;
  DELETE FROM public.feed_likes WHERE profile_id = _uid;
  DELETE FROM public.feed_comments WHERE profile_id = _uid;
  DELETE FROM public.activity_feed_items WHERE actor_id = _uid;
  DELETE FROM public.friendships WHERE requester_id = _uid OR addressee_id = _uid;
  DELETE FROM public.challenge_participants WHERE profile_id = _uid;
  DELETE FROM public.routine_exercises WHERE routine_id IN (
    SELECT id FROM public.routines WHERE created_by = _uid
  );
  DELETE FROM public.routines WHERE created_by = _uid;
  DELETE FROM public.generated_programs WHERE profile_id = _uid;
  DELETE FROM public.session_drafts WHERE profile_id = _uid;
  DELETE FROM public.streak_cache WHERE profile_id = _uid;
  DELETE FROM public.notifications WHERE profile_id = _uid;
  DELETE FROM public.profiles WHERE id = _uid;

  -- Finally, remove the auth user
  DELETE FROM auth.users WHERE id = _uid;
END;
$$;

NOTIFY pgrst, 'reload schema';
