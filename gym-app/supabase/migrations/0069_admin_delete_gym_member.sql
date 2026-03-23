-- Admin version of delete_user_account: super_admin can delete any member.
-- Uses IF EXISTS on each table to avoid failures if a table wasn't created.

DROP FUNCTION IF EXISTS admin_delete_gym_member(UUID);

CREATE OR REPLACE FUNCTION admin_delete_gym_member(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can delete members';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Cannot delete a super admin account';
  END IF;

  -- Session data (deepest children first)
  DELETE FROM session_sets WHERE session_exercise_id IN (
    SELECT id FROM session_exercises WHERE session_id IN (
      SELECT id FROM workout_sessions WHERE profile_id = p_user_id));
  DELETE FROM session_exercises WHERE session_id IN (
    SELECT id FROM workout_sessions WHERE profile_id = p_user_id);
  DELETE FROM workout_sessions       WHERE profile_id = p_user_id;

  -- Progress & metrics
  DELETE FROM personal_records       WHERE profile_id = p_user_id;
  DELETE FROM pr_history             WHERE profile_id = p_user_id;
  DELETE FROM body_weight_logs       WHERE profile_id = p_user_id;
  DELETE FROM body_measurements      WHERE profile_id = p_user_id;
  DELETE FROM progress_photos        WHERE profile_id = p_user_id;
  DELETE FROM overload_suggestions   WHERE profile_id = p_user_id;
  DELETE FROM streak_cache           WHERE profile_id = p_user_id;

  -- Onboarding & nutrition
  DELETE FROM member_onboarding      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_targets      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_checkins     WHERE profile_id = p_user_id;
  DELETE FROM check_ins              WHERE profile_id = p_user_id;

  -- Social
  DELETE FROM feed_likes             WHERE profile_id = p_user_id;
  DELETE FROM feed_comments          WHERE profile_id = p_user_id;
  DELETE FROM activity_feed_items    WHERE actor_id   = p_user_id;
  DELETE FROM friendships            WHERE requester_id = p_user_id OR addressee_id = p_user_id;

  -- Challenges & achievements
  DELETE FROM challenge_score_events WHERE profile_id = p_user_id;
  DELETE FROM challenge_participants WHERE profile_id = p_user_id;
  DELETE FROM user_achievements      WHERE profile_id = p_user_id;
  DELETE FROM user_enrolled_programs WHERE profile_id = p_user_id;

  -- Routines
  DELETE FROM routine_exercises      WHERE routine_id IN (
    SELECT id FROM routines WHERE created_by = p_user_id);
  DELETE FROM routines               WHERE created_by = p_user_id;

  -- Misc
  DELETE FROM notifications          WHERE profile_id = p_user_id;
  DELETE FROM trainer_clients        WHERE trainer_id = p_user_id OR client_id = p_user_id;
  DELETE FROM churn_risk_scores      WHERE profile_id = p_user_id;
  DELETE FROM leaderboard_snapshots  WHERE profile_id = p_user_id;
  DELETE FROM gym_invites            WHERE created_by = p_user_id;

  -- Profile and auth user
  DELETE FROM profiles               WHERE id = p_user_id;
  DELETE FROM auth.users             WHERE id = p_user_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
