-- ============================================================
-- Challenge Prizes table
-- ============================================================
CREATE TABLE IF NOT EXISTS challenge_prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  placement INT NOT NULL,           -- 1, 2, or 3
  reward_type TEXT NOT NULL,        -- 'points', 'product', 'custom'
  reward_label TEXT NOT NULL,       -- "500 pts", "Free Smoothie", etc.
  points_awarded INT DEFAULT 0,
  product_id UUID REFERENCES gym_products(id), -- if reward is a product
  qr_code TEXT UNIQUE,             -- 12-char code for product/custom prizes
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired')),
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_challenge_prizes_challenge ON challenge_prizes(challenge_id);
CREATE INDEX idx_challenge_prizes_profile ON challenge_prizes(profile_id, status);
CREATE INDEX idx_challenge_prizes_gym ON challenge_prizes(gym_id, created_at DESC);
CREATE INDEX idx_challenge_prizes_qr ON challenge_prizes(qr_code) WHERE qr_code IS NOT NULL;

-- Prevent duplicate awards: one prize per challenge per placement
CREATE UNIQUE INDEX idx_challenge_prizes_dedup
  ON challenge_prizes(challenge_id, placement);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE challenge_prizes ENABLE ROW LEVEL SECURITY;

-- Members can see their own prizes
CREATE POLICY "member_read_own_prizes" ON challenge_prizes
  FOR SELECT USING (profile_id = auth.uid());

-- Admins can read all prizes for their gym
CREATE POLICY "admin_read_gym_prizes" ON challenge_prizes
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

-- Admins can update prizes (for redemption)
CREATE POLICY "admin_update_gym_prizes" ON challenge_prizes
  FOR UPDATE USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

-- Super admins can do everything
CREATE POLICY "super_admin_all_prizes" ON challenge_prizes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- ============================================================
-- RPC: award_challenge_prizes
-- ============================================================
CREATE OR REPLACE FUNCTION award_challenge_prizes(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge RECORD;
  v_caller_gym UUID;
  v_caller_role TEXT;
  v_rewards JSONB;
  v_participants RECORD;
  v_top3 UUID[];
  v_result JSONB := '[]'::JSONB;
  v_reward JSONB;
  v_place INT;
  v_points INT;
  v_prize TEXT;
  v_product_id UUID;
  v_reward_type TEXT;
  v_reward_label TEXT;
  v_qr TEXT;
  v_prize_id UUID;
  v_row RECORD;
BEGIN
  -- Verify caller is admin
  SELECT gym_id, role INTO v_caller_gym, v_caller_role
  FROM profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can award prizes';
  END IF;

  -- Get the challenge
  SELECT * INTO v_challenge
  FROM challenges WHERE id = p_challenge_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  IF v_challenge.gym_id != v_caller_gym AND v_caller_role != 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized for this gym';
  END IF;

  -- Check if prizes already awarded
  IF EXISTS (SELECT 1 FROM challenge_prizes WHERE challenge_id = p_challenge_id) THEN
    RAISE EXCEPTION 'Prizes have already been awarded for this challenge';
  END IF;

  -- Parse rewards JSON
  BEGIN
    v_rewards := v_challenge.reward_description::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_rewards := NULL;
  END;

  IF v_rewards IS NULL OR jsonb_array_length(v_rewards) = 0 THEN
    RAISE EXCEPTION 'No rewards configured for this challenge';
  END IF;

  -- Get top 3 participants by score
  FOR v_row IN
    SELECT cp.profile_id, cp.score
    FROM challenge_participants cp
    WHERE cp.challenge_id = p_challenge_id
    ORDER BY cp.score DESC
    LIMIT 3
  LOOP
    v_place := array_length(v_top3, 1);
    IF v_place IS NULL THEN v_place := 0; END IF;
    v_place := v_place + 1;
    v_top3 := array_append(v_top3, v_row.profile_id);

    -- Get reward config for this placement (0-indexed in JSON array)
    IF v_place <= jsonb_array_length(v_rewards) THEN
      v_reward := v_rewards->(v_place - 1);
    ELSE
      CONTINUE;
    END IF;

    v_points := COALESCE((v_reward->>'points')::INT, 0);
    v_prize := v_reward->>'prize';
    v_product_id := NULLIF(v_reward->>'product_id', '')::UUID;

    -- Determine reward type and label
    IF v_product_id IS NOT NULL THEN
      v_reward_type := 'product';
      v_reward_label := COALESCE(v_prize, 'Product prize');
      IF v_points > 0 THEN
        v_reward_label := v_points || ' pts + ' || v_reward_label;
      END IF;
    ELSIF v_prize IS NOT NULL AND v_prize != '' THEN
      v_reward_type := 'custom';
      v_reward_label := v_prize;
      IF v_points > 0 THEN
        v_reward_label := v_points || ' pts + ' || v_reward_label;
      END IF;
    ELSE
      v_reward_type := 'points';
      v_reward_label := v_points || ' pts';
    END IF;

    -- Generate QR code for product/custom prizes
    v_qr := NULL;
    IF v_reward_type IN ('product', 'custom') THEN
      v_qr := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    END IF;

    -- Award points if specified
    IF v_points > 0 THEN
      -- Add to reward_points
      UPDATE reward_points
      SET total_points = total_points + v_points,
          lifetime_points = lifetime_points + v_points,
          updated_at = NOW()
      WHERE profile_id = v_row.profile_id;

      -- If no row existed, insert one
      IF NOT FOUND THEN
        INSERT INTO reward_points (profile_id, total_points, lifetime_points)
        VALUES (v_row.profile_id, v_points, v_points);
      END IF;

      -- Log the points
      INSERT INTO reward_points_log (profile_id, points, action, description)
      VALUES (
        v_row.profile_id,
        v_points,
        'challenge_completed',
        'Challenge prize: ' || v_challenge.name || ' (' || v_place || CASE v_place WHEN 1 THEN 'st' WHEN 2 THEN 'nd' ELSE 'rd' END || ' place)'
      );
    END IF;

    -- Insert challenge prize row
    INSERT INTO challenge_prizes (
      gym_id, challenge_id, profile_id, placement,
      reward_type, reward_label, points_awarded,
      product_id, qr_code, status
    ) VALUES (
      v_challenge.gym_id, p_challenge_id, v_row.profile_id, v_place,
      v_reward_type, v_reward_label, v_points,
      v_product_id, v_qr, 'pending'
    )
    RETURNING id INTO v_prize_id;

    v_result := v_result || jsonb_build_object(
      'prize_id', v_prize_id,
      'profile_id', v_row.profile_id,
      'placement', v_place,
      'reward_type', v_reward_type,
      'reward_label', v_reward_label,
      'points_awarded', v_points,
      'qr_code', v_qr
    );
  END LOOP;

  RETURN v_result;
END;
$$;

-- ============================================================
-- RPC: redeem_challenge_prize
-- ============================================================
CREATE OR REPLACE FUNCTION redeem_challenge_prize(p_prize_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prize RECORD;
  v_caller_gym UUID;
  v_caller_role TEXT;
BEGIN
  -- Verify caller is admin
  SELECT gym_id, role INTO v_caller_gym, v_caller_role
  FROM profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can redeem prizes';
  END IF;

  -- Get the prize
  SELECT * INTO v_prize
  FROM challenge_prizes WHERE id = p_prize_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found';
  END IF;

  IF v_prize.gym_id != v_caller_gym AND v_caller_role != 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized for this gym';
  END IF;

  IF v_prize.status != 'pending' THEN
    RAISE EXCEPTION 'Prize has already been %', v_prize.status;
  END IF;

  -- Mark as redeemed
  UPDATE challenge_prizes
  SET status = 'redeemed', redeemed_at = NOW()
  WHERE id = p_prize_id;

  RETURN jsonb_build_object(
    'id', v_prize.id,
    'challenge_id', v_prize.challenge_id,
    'profile_id', v_prize.profile_id,
    'placement', v_prize.placement,
    'reward_type', v_prize.reward_type,
    'reward_label', v_prize.reward_label,
    'status', 'redeemed',
    'redeemed_at', NOW()
  );
END;
$$;
