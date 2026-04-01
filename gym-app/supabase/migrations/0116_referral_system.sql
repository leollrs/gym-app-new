-- ══════════════════════════════════════════════════════════════════════
-- REFERRAL SYSTEM + FRIEND LINKS
-- ══════════════════════════════════════════════════════════════════════

-- 1. Friend code on profiles (for add-friend-via-link)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS friend_code TEXT UNIQUE;

-- Generate friend codes for existing users who don't have one
UPDATE profiles
SET friend_code = substr(md5(random()::text || id::text), 1, 8)
WHERE friend_code IS NULL;

-- 2. Referral codes (one per member per gym)
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  uses_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id, gym_id)
);

-- 3. Referrals (tracks who referred whom)
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  referral_code_id UUID REFERENCES referral_codes(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'rejected')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(referred_id, gym_id)
);

-- 4. Referral rewards earned
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('points', 'discount', 'free_month', 'custom')),
  reward_value JSONB NOT NULL DEFAULT '{}',
  claimed BOOLEAN DEFAULT false,
  seen BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Referral program config on gyms table
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS referral_config JSONB DEFAULT '{
  "enabled": false,
  "referrer_reward": { "type": "points", "points": 5000, "label": "5,000 Points" },
  "referred_reward": { "type": "points", "points": 2000, "label": "2,000 Points" },
  "max_referrals_per_month": null,
  "require_admin_approval": false
}'::jsonb;

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_referral_codes_profile_gym ON referral_codes(profile_id, gym_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, gym_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id, gym_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_profile ON referral_rewards(profile_id, seen);
CREATE INDEX IF NOT EXISTS idx_profiles_friend_code ON profiles(friend_code);

-- 7. RLS policies
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

-- Referral codes: users can read their own, anyone can look up by code
CREATE POLICY "Users can read own referral codes" ON referral_codes FOR SELECT USING (auth.uid() = profile_id);
CREATE POLICY "Users can insert own referral codes" ON referral_codes FOR INSERT WITH CHECK (auth.uid() = profile_id);
CREATE POLICY "Anyone can look up referral code" ON referral_codes FOR SELECT USING (true);

-- Referrals: users can see referrals they're involved in
CREATE POLICY "Users can see own referrals" ON referrals FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "Users can create referrals" ON referrals FOR INSERT WITH CHECK (auth.uid() = referred_id);
CREATE POLICY "Admins can update referrals" ON referrals FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND gym_id = referrals.gym_id AND role IN ('admin', 'super_admin'))
);

-- Referral rewards: users can see and update their own
CREATE POLICY "Users can see own rewards" ON referral_rewards FOR SELECT USING (auth.uid() = profile_id);
CREATE POLICY "Users can update own reward seen status" ON referral_rewards FOR UPDATE USING (auth.uid() = profile_id);

-- 8. Function to auto-generate referral code for a user
CREATE OR REPLACE FUNCTION generate_referral_code(p_profile_id UUID, p_gym_id UUID)
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
  gym_short TEXT;
BEGIN
  -- Get gym short name (first 4 chars uppercased)
  SELECT upper(substr(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 1, 4))
  INTO gym_short FROM gyms WHERE id = p_gym_id;

  -- Generate unique code
  LOOP
    new_code := 'REF-' || COALESCE(gym_short, 'GYM') || '-' || upper(substr(md5(random()::text), 1, 4));
    BEGIN
      INSERT INTO referral_codes (profile_id, gym_id, code)
      VALUES (p_profile_id, p_gym_id, new_code)
      ON CONFLICT (profile_id, gym_id) DO NOTHING;

      IF FOUND THEN
        RETURN new_code;
      ELSE
        -- Already exists for this user+gym, return existing
        SELECT code INTO new_code FROM referral_codes WHERE profile_id = p_profile_id AND gym_id = p_gym_id;
        RETURN new_code;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Code collision, try again
      CONTINUE;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Function to complete a referral and grant rewards
--    Note: rewards are stored in referral_rewards table only.
--    The app reads from referral_rewards to display and apply rewards.
CREATE OR REPLACE FUNCTION complete_referral(p_referral_id UUID)
RETURNS VOID AS $$
DECLARE
  ref RECORD;
  gym_config JSONB;
  referrer_reward JSONB;
  referred_reward JSONB;
BEGIN
  SELECT * INTO ref FROM referrals WHERE id = p_referral_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  SELECT referral_config INTO gym_config FROM gyms WHERE id = ref.gym_id;
  IF gym_config IS NULL OR NOT (gym_config->>'enabled')::boolean THEN RETURN; END IF;

  referrer_reward := gym_config->'referrer_reward';
  referred_reward := gym_config->'referred_reward';

  -- Mark referral as completed
  UPDATE referrals SET status = 'completed', completed_at = now() WHERE id = p_referral_id;

  -- Increment uses count on referral code
  UPDATE referral_codes SET uses_count = uses_count + 1 WHERE id = ref.referral_code_id;

  -- Grant reward to referrer
  INSERT INTO referral_rewards (referral_id, profile_id, gym_id, reward_type, reward_value)
  VALUES (p_referral_id, ref.referrer_id, ref.gym_id, referrer_reward->>'type', referrer_reward);

  -- Grant reward to referred
  INSERT INTO referral_rewards (referral_id, profile_id, gym_id, reward_type, reward_value)
  VALUES (p_referral_id, ref.referred_id, ref.gym_id, referred_reward->>'type', referred_reward);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
