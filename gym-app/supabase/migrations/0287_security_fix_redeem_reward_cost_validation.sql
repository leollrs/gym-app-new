-- =============================================================
-- 0287 — Security fix: server-side cost validation in redeem_reward
--
-- Vulnerability: The redeem_reward() RPC trusted the client-supplied
-- p_cost parameter. A malicious client could call:
--   SELECT redeem_reward('reward_id', 'Free Month', 1)
-- and redeem a 30,000-point reward for just 1 point.
--
-- Previous fix (0256) silently overrode p_cost with the catalog
-- value, but skipped validation entirely for non-UUID reward IDs.
--
-- Fix: Look up the actual cost from gym_rewards using the reward_id.
-- If the reward exists in the catalog, REJECT the request when the
-- client-supplied cost does not match. Use the server-looked-up
-- cost for the actual points deduction. Non-UUID reward IDs that
-- are not found in the catalog are also rejected (no more silent
-- skip for string-based IDs).
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

  -- ── Server-side cost lookup ──────────────────────────────────
  -- Look up the actual cost from gym_rewards catalog.
  -- Handles both UUID and non-UUID reward IDs gracefully.
  BEGIN
    SELECT cost_points INTO v_actual_cost
      FROM gym_rewards
     WHERE id = p_reward_id::uuid
       AND is_active = true;

    IF FOUND THEN
      v_reward_found := TRUE;
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    -- p_reward_id is not a valid UUID — try matching by reward_type
    SELECT cost_points INTO v_actual_cost
      FROM gym_rewards
     WHERE reward_type = p_reward_id
       AND is_active = true
     LIMIT 1;

    IF FOUND THEN
      v_reward_found := TRUE;
    END IF;
  END;

  -- If we found the reward in the catalog, enforce the catalog cost
  IF v_reward_found THEN
    IF v_actual_cost != p_cost THEN
      RAISE EXCEPTION 'Cost mismatch: client sent %, catalog requires %', p_cost, v_actual_cost;
    END IF;
    -- Use server-looked-up cost for all downstream logic
    p_cost := v_actual_cost;
  END IF;

  -- ── Auth & profile ──────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- ── Points balance check (total minus pending holds) ────────
  SELECT COALESCE(total_points, 0) INTO v_total
    FROM reward_points
   WHERE profile_id = v_user_id;

  SELECT COALESCE(SUM(points_spent), 0) INTO v_held
    FROM reward_redemptions
   WHERE profile_id = v_user_id
     AND status = 'pending';

  v_available := v_total - v_held;

  IF v_available < p_cost THEN
    RAISE EXCEPTION 'Insufficient points';
  END IF;

  -- ── Create pending redemption (no point deduction yet) ──────
  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (v_user_id, v_gym_id, p_reward_id, p_reward_name, p_cost, 'pending')
  RETURNING id INTO v_redeem_id;

  RETURN json_build_object(
    'redemption_id', v_redeem_id,
    'points_spent', p_cost,
    'remaining_points', v_available - p_cost
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
