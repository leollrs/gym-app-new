-- =============================================================
-- 0256 — Hold points until admin approves redemption
--
-- Problem: redeem_reward deducts points immediately on member
-- tap. If member loses the QR or closes the modal, they lose
-- points with no recourse. Points should only be deducted when
-- admin scans and approves.
--
-- Fix:
--   1. redeem_reward: don't deduct points. Instead, check
--      available = total_points - SUM(pending redemption costs).
--      Just create the pending record.
--   2. New claim_redemption RPC for admin to call when scanning.
--      This deducts points and sets status to 'claimed'.
--   3. cancel_redemption RPC for members to cancel pending ones.
-- =============================================================

-- ── 1. Updated redeem_reward — no point deduction ──────────

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
BEGIN
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid reward cost';
  END IF;

  -- Server-side cost validation if gym_rewards table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gym_rewards') THEN
    DECLARE v_actual_cost INT;
    BEGIN
      SELECT cost_points INTO v_actual_cost FROM gym_rewards WHERE id = p_reward_id::uuid;
      IF v_actual_cost IS NOT NULL AND v_actual_cost != p_cost THEN
        p_cost := v_actual_cost;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
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

  -- Get total points
  SELECT COALESCE(total_points, 0) INTO v_total
    FROM reward_points
   WHERE profile_id = v_user_id;

  -- Calculate points held by pending redemptions
  SELECT COALESCE(SUM(points_spent), 0) INTO v_held
    FROM reward_redemptions
   WHERE profile_id = v_user_id
     AND status = 'pending';

  v_available := v_total - v_held;

  IF v_available < p_cost THEN
    RAISE EXCEPTION 'Insufficient points';
  END IF;

  -- Create pending redemption (no point deduction yet)
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


-- ── 2. claim_redemption — admin approves, points deducted ──

CREATE OR REPLACE FUNCTION public.claim_redemption(
  p_redemption_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id    UUID;
  v_admin_role  TEXT;
  v_redemption  RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is admin or trainer
  SELECT role INTO v_admin_role FROM profiles WHERE id = v_admin_id;
  IF v_admin_role NOT IN ('admin', 'super_admin', 'trainer') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Get the redemption
  SELECT * INTO v_redemption
    FROM reward_redemptions
   WHERE id = p_redemption_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;

  IF v_redemption.status = 'claimed' THEN
    RAISE EXCEPTION 'Already claimed';
  END IF;

  IF v_redemption.status = 'cancelled' THEN
    RAISE EXCEPTION 'Redemption was cancelled';
  END IF;

  -- Now deduct points
  UPDATE reward_points
  SET total_points = total_points - v_redemption.points_spent,
      last_updated = NOW()
  WHERE profile_id = v_redemption.profile_id;

  -- Log the deduction
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (v_redemption.profile_id, v_redemption.gym_id, 'redemption',
    -v_redemption.points_spent, 'Redeemed: ' || v_redemption.reward_name, NOW());

  -- Mark as claimed
  UPDATE reward_redemptions
  SET status = 'claimed', claimed_at = NOW()
  WHERE id = p_redemption_id;

  RETURN json_build_object(
    'success', true,
    'redemption_id', p_redemption_id,
    'points_deducted', v_redemption.points_spent
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_redemption(UUID) TO authenticated;


-- ── 3. cancel_redemption — member cancels pending ──────────

CREATE OR REPLACE FUNCTION public.cancel_redemption(
  p_redemption_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_redemption  RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_redemption
    FROM reward_redemptions
   WHERE id = p_redemption_id
     AND profile_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;

  IF v_redemption.status != 'pending' THEN
    RAISE EXCEPTION 'Can only cancel pending redemptions';
  END IF;

  -- No points to refund — they were never deducted
  UPDATE reward_redemptions
  SET status = 'cancelled'
  WHERE id = p_redemption_id;

  RETURN json_build_object(
    'success', true,
    'redemption_id', p_redemption_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_redemption(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
