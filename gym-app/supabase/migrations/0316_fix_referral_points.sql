-- Fix referral points: add points_awarded column and auto-award points on completion
-- Issue: UI queries referrals.points_awarded but column didn't exist,
-- and complete_referral() never called add_reward_points()

-- 1. Add the missing column
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS points_awarded INTEGER DEFAULT 0;

-- 2. Update complete_referral to also award points to both referrer and referred
CREATE OR REPLACE FUNCTION public.complete_referral(p_referral_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref         RECORD;
  v_gym_config  RECORD;
  v_points      INTEGER;
BEGIN
  SELECT * INTO v_ref FROM referrals WHERE id = p_referral_id;
  IF NOT FOUND OR v_ref.status = 'completed' THEN RETURN; END IF;

  -- Mark as completed
  UPDATE referrals SET status = 'completed', completed_at = NOW() WHERE id = p_referral_id;

  -- Look up gym referral config for point values
  SELECT
    COALESCE((config->>'referrer_points')::int, 500) AS referrer_points,
    COALESCE((config->>'referred_points')::int, 250) AS referred_points
  INTO v_gym_config
  FROM gym_referral_config
  WHERE gym_id = v_ref.gym_id;

  -- Default points if no config
  IF NOT FOUND THEN
    v_gym_config.referrer_points := 500;
    v_gym_config.referred_points := 250;
  END IF;

  -- Award points to referrer
  IF v_gym_config.referrer_points > 0 THEN
    PERFORM public.add_reward_points(
      v_ref.referrer_id,
      v_ref.gym_id,
      'referral',
      v_gym_config.referrer_points,
      'Referral reward: referred a new member'
    );
  END IF;

  -- Award points to referred member
  IF v_gym_config.referred_points > 0 AND v_ref.referred_id IS NOT NULL THEN
    PERFORM public.add_reward_points(
      v_ref.referred_id,
      v_ref.gym_id,
      'referral',
      v_gym_config.referred_points,
      'Referral reward: joined via referral'
    );
  END IF;

  -- Track total points on the referral record
  UPDATE referrals
  SET points_awarded = COALESCE(v_gym_config.referrer_points, 0) + COALESCE(v_gym_config.referred_points, 0)
  WHERE id = p_referral_id;
END;
$$;

-- 3. Backfill: complete any pending referrals where the referred user has already onboarded
-- (These were created but never completed because the old function didn't award points)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT ref.id
    FROM referrals ref
    JOIN profiles p ON p.id = ref.referred_id
    WHERE ref.status = 'pending'
      AND p.is_onboarded = true
  LOOP
    PERFORM public.complete_referral(r.id);
  END LOOP;
END;
$$;
