-- ============================================================
-- 0312: Harden claim_redemption + grant to authenticated
--
-- Ensures the claim_redemption RPC:
-- 1. Only works on pending redemptions
-- 2. Deducts points atomically
-- 3. Is accessible to admin/staff
-- Also adds admin check so only admin/trainer can claim.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_redemption(
  p_redemption_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_redemption  RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only admin/trainer/super_admin can claim redemptions
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'trainer', 'super_admin') THEN
    RAISE EXCEPTION 'Only staff can claim redemptions';
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

  IF v_redemption.status = 'cancelled' OR v_redemption.status = 'expired' THEN
    RAISE EXCEPTION 'Redemption was cancelled or expired';
  END IF;

  -- Deduct points
  UPDATE reward_points
  SET total_points = GREATEST(0, total_points - v_redemption.points_spent)
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

NOTIFY pgrst, 'reload schema';
