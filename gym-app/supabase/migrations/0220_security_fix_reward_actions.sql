-- SECURITY FIX: add missing reward actions to add_reward_points whitelist
-- The 'daily_challenge' and 'challenge_joined' actions were used in app code
-- but not present in the server-side CASE whitelist, causing them to be
-- rejected with "Unknown reward action".
-- Also documents that daily_challenge_completions is a known table used
-- alongside this function.
-- This migration runs AFTER 0219 which revoked EXECUTE from authenticated;
-- the whitelist remains important for internal validation.
-- ================================================================

CREATE OR REPLACE FUNCTION public.add_reward_points(
  p_user_id     UUID,
  p_gym_id      UUID,
  p_action      TEXT,
  p_points      INT,
  p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_total    INT;
  new_lifetime INT;
  v_expected   INT;
BEGIN
  -- ── Authorization ────────────────────────────────────────────
  -- Only the owner of the points (or an admin) may call this.
  IF p_user_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: can only add points for yourself';
  END IF;

  -- Gym boundary: p_gym_id must be the caller's gym unless super_admin.
  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: gym_id does not match your gym';
  END IF;
  -- ── End Authorization ────────────────────────────────────────

  IF p_user_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- Server-side points map — must match POINTS_MAP in rewardsEngine.js
  -- The client-sent p_points is IGNORED; we use the canonical value.
  v_expected := CASE p_action
    WHEN 'workout_completed'    THEN 50
    WHEN 'pr_hit'               THEN 100
    WHEN 'check_in'             THEN 20
    WHEN 'streak_day'           THEN LEAST(p_points, 200) -- streak_day is variable but capped
    WHEN 'challenge_completed'  THEN 500
    WHEN 'achievement_unlocked' THEN 75
    WHEN 'weight_logged'        THEN 10
    WHEN 'first_weekly_workout' THEN 25
    WHEN 'streak_7'             THEN 200
    WHEN 'streak_30'            THEN 1000
    WHEN 'daily_challenge'      THEN 25
    WHEN 'challenge_joined'     THEN 25
    ELSE NULL
  END;

  -- Reject unknown actions
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'Unknown reward action: %', p_action;
  END IF;

  -- 1. Insert log entry
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (p_user_id, p_gym_id, p_action, v_expected, p_description, NOW());

  -- 2. Upsert totals in one atomic operation
  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
  VALUES (p_user_id, p_gym_id, v_expected, v_expected, NOW())
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points + v_expected,
    lifetime_points = reward_points.lifetime_points + v_expected,
    last_updated    = NOW()
  RETURNING total_points, lifetime_points INTO new_total, new_lifetime;

  RETURN json_build_object('total_points', new_total, 'lifetime_points', new_lifetime);
END;
$$;

NOTIFY pgrst, 'reload schema';
