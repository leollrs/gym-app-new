-- =============================================================
-- SECURITY FIX: redeem_reward - server-side cost validation
-- Migration: 0201_security_fix_redeem_reward.sql
--
-- Problem: redeem_reward trusts client-sent p_cost, allowing
-- attackers to redeem rewards for 0 or negative points.
--
-- Fix: 1) Validate p_cost > 0
--      2) Look up actual cost from gym_rewards table and
--         override client-sent value when it differs.
-- =============================================================

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
  v_user_id    UUID;
  v_gym_id     UUID;
  v_current    INT;
  v_redeem_id  UUID;
BEGIN
  -- Validate cost is positive
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid reward cost';
  END IF;

  -- If gym_rewards table exists, validate cost matches the catalog
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gym_rewards') THEN
    DECLARE v_actual_cost INT;
    BEGIN
      SELECT points_cost INTO v_actual_cost FROM gym_rewards WHERE id = p_reward_id::uuid;
      IF v_actual_cost IS NOT NULL AND v_actual_cost != p_cost THEN
        p_cost := v_actual_cost;  -- Use server-side cost
      END IF;
    END;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Get current points
  SELECT total_points INTO v_current
    FROM reward_points
   WHERE profile_id = v_user_id;

  IF v_current IS NULL OR v_current < p_cost THEN
    RAISE EXCEPTION 'Insufficient points';
  END IF;

  -- 1. Insert redemption record
  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (v_user_id, v_gym_id, p_reward_id, p_reward_name, p_cost, 'pending')
  RETURNING id INTO v_redeem_id;

  -- 2. Deduct points
  UPDATE reward_points
  SET total_points = total_points - p_cost,
      last_updated = NOW()
  WHERE profile_id = v_user_id;

  -- 3. Log the deduction
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (v_user_id, v_gym_id, 'redemption', -p_cost, 'Redeemed: ' || p_reward_name, NOW());

  RETURN json_build_object(
    'redemption_id', v_redeem_id,
    'points_spent', p_cost,
    'remaining_points', v_current - p_cost
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
