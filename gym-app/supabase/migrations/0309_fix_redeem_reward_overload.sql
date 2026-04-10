-- ============================================================
-- 0309: Fix redeem_reward function — drop stale overloads
--
-- Problem: 400 Bad Request when calling redeem_reward RPC.
-- Likely multiple overloads in the live DB.
--
-- Fix: Drop all possible signatures and recreate canonical one.
-- ============================================================

DROP FUNCTION IF EXISTS public.redeem_reward(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.redeem_reward(TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.redeem_reward(UUID, TEXT, INT);

-- Recreate canonical version (from 0287)
CREATE OR REPLACE FUNCTION public.redeem_reward(
  p_reward_id   TEXT,
  p_reward_name TEXT,
  p_cost        INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_gym_id      UUID;
  v_total       INT;
  v_held        INT;
  v_available   INT;
  v_redeem_id   UUID;
  v_actual_cost INT;
  v_reward_found BOOLEAN := FALSE;
BEGIN
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid reward cost';
  END IF;

  -- Server-side cost lookup from gym_rewards catalog
  BEGIN
    SELECT cost_points INTO v_actual_cost
      FROM gym_rewards
     WHERE id = p_reward_id::uuid
       AND is_active = true;
    IF FOUND THEN v_reward_found := TRUE; END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT cost_points INTO v_actual_cost
      FROM gym_rewards
     WHERE reward_type = p_reward_id
       AND is_active = true
     LIMIT 1;
    IF FOUND THEN v_reward_found := TRUE; END IF;
  END;

  IF v_reward_found THEN
    IF v_actual_cost != p_cost THEN
      RAISE EXCEPTION 'Cost mismatch: client sent %, catalog requires %', p_cost, v_actual_cost;
    END IF;
    p_cost := v_actual_cost;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Check available points (total minus held)
  SELECT COALESCE(total_points, 0) INTO v_total
    FROM reward_points WHERE profile_id = v_user_id;

  SELECT COALESCE(SUM(points_spent), 0) INTO v_held
    FROM reward_redemptions
   WHERE profile_id = v_user_id
     AND status = 'pending';

  v_available := v_total - v_held;

  IF v_available < p_cost THEN
    RAISE EXCEPTION 'Insufficient points: have %, need %', v_available, p_cost;
  END IF;

  -- Create redemption record (pending until staff confirms)
  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (v_user_id, v_gym_id, p_reward_id, p_reward_name, p_cost, 'pending')
  RETURNING id INTO v_redeem_id;

  RETURN json_build_object(
    'success', true,
    'redemption_id', v_redeem_id,
    'points_remaining', v_available - p_cost
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_reward(TEXT, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
