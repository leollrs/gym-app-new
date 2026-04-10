-- ============================================================
-- 0311: Fix reward redemption scan — admin can't read redemptions
--
-- Problem: Admin scanning a reward QR gets "Redemption not found"
-- because reward_redemptions has no admin SELECT policy, and the
-- scan handler was doing a pre-check SELECT before calling the
-- SECURITY DEFINER claim_redemption RPC.
--
-- Fix:
--   1. Add admin/trainer SELECT policy on reward_redemptions
--   2. Update claim_redemption to return reward_name in response
-- ============================================================

-- 1. Admin/trainer can read redemptions for their gym
DROP POLICY IF EXISTS "Admins can read gym redemptions" ON reward_redemptions;

CREATE POLICY "Admins can read gym redemptions" ON reward_redemptions
  FOR SELECT
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- 2. Update claim_redemption to return reward_name
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
    'reward_name', v_redemption.reward_name,
    'points_deducted', v_redemption.points_spent
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_redemption(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
