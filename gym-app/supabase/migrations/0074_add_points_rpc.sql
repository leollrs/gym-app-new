-- Replace the 3-round-trip addPoints pattern (insert log → fetch total → upsert total)
-- with a single RPC call that does everything server-side.

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
BEGIN
  IF p_user_id IS NULL OR p_points IS NULL OR p_points = 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- 1. Insert log entry
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (p_user_id, p_gym_id, p_action, p_points, p_description, NOW());

  -- 2. Upsert totals in one atomic operation
  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
  VALUES (p_user_id, p_gym_id, p_points, p_points, NOW())
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points + p_points,
    lifetime_points = reward_points.lifetime_points + p_points,
    last_updated    = NOW()
  RETURNING total_points, lifetime_points INTO new_total, new_lifetime;

  RETURN json_build_object('total_points', new_total, 'lifetime_points', new_lifetime);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_reward_points(UUID, UUID, TEXT, INT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
