-- =============================================================
-- REWARD REDEMPTIONS
-- Migration: 0089_reward_redemptions.sql
--
-- Creates the reward_redemptions table and an atomic RPC
-- for redeeming rewards (deduct points + log + record).
-- =============================================================

-- ── 1. Redemptions table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS reward_redemptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    reward_id       TEXT NOT NULL,
    reward_name     TEXT NOT NULL,
    points_spent    INT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'claimed', 'expired'
    claimed_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redemptions_profile
  ON reward_redemptions(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_redemptions_gym
  ON reward_redemptions(gym_id, created_at DESC);

ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read own redemptions"
  ON reward_redemptions FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Members can insert own redemptions"
  ON reward_redemptions FOR INSERT
  WITH CHECK (profile_id = auth.uid());

-- ── 2. Atomic redeem RPC ────────────────────────────────────

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

GRANT EXECUTE ON FUNCTION public.redeem_reward(TEXT, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
