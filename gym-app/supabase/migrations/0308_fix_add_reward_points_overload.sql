-- ============================================================
-- 0308: Fix add_reward_points "not unique" error
--
-- Drop all overloaded versions of add_reward_points, then
-- recreate the single canonical version.
-- ============================================================

-- Drop all known signatures
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, TEXT, INTEGER);

-- Recreate the single canonical version
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
  v_points     INT;
BEGIN
  -- 1. Authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Authorization
  IF auth.uid() != p_user_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM profiles
      WHERE id      = auth.uid()
        AND gym_id  = p_gym_id
        AND role   IN ('admin', 'trainer', 'super_admin')
    ) THEN
      RAISE EXCEPTION 'Unauthorized: cannot award points to other users';
    END IF;
  END IF;

  -- 3. Input guard
  IF p_user_id IS NULL THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- 4. Server-side points whitelist (p_points is IGNORED except for streak_day)
  v_points := CASE p_action
    WHEN 'workout_completed'    THEN 50
    WHEN 'pr_hit'               THEN 20
    WHEN 'check_in'             THEN 20
    WHEN 'streak_day'           THEN LEAST(GREATEST(p_points, 20), 35)
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

  IF v_points IS NULL THEN
    RAISE EXCEPTION 'Unknown reward action: %', p_action;
  END IF;

  IF v_points <= 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- 5. Persist
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (p_user_id, p_gym_id, p_action, v_points, COALESCE(p_description, p_action), NOW());

  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
  VALUES (p_user_id, p_gym_id, v_points, v_points, NOW())
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points    + v_points,
    lifetime_points = reward_points.lifetime_points + v_points,
    last_updated    = NOW()
  RETURNING total_points, lifetime_points INTO new_total, new_lifetime;

  RETURN json_build_object('total_points', new_total, 'lifetime_points', new_lifetime);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_reward_points(UUID, UUID, TEXT, INT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
