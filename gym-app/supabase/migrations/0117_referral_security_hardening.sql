-- ══════════════════════════════════════════════════════════════════════
-- REFERRAL SYSTEM SECURITY HARDENING
-- Prevents self-referral, enforces monthly caps, rate limits,
-- blocks circular referrals, and restricts reward manipulation.
-- ══════════════════════════════════════════════════════════════════════

-- 1. CONSTRAINT: Cannot refer yourself
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS no_self_referral;
ALTER TABLE referrals ADD CONSTRAINT no_self_referral CHECK (referrer_id != referred_id);

-- 2. CONSTRAINT: Account must exist before being referred (prevents ghost accounts)
--    (Already enforced by FK, but add created_at tracking for age checks)

-- 3. Drop overly permissive RLS policies and replace with tighter ones
DROP POLICY IF EXISTS "Anyone can look up referral code" ON referral_codes;
DROP POLICY IF EXISTS "Users can read own referral codes" ON referral_codes;
DROP POLICY IF EXISTS "Users can insert own referral codes" ON referral_codes;
DROP POLICY IF EXISTS "Users can see own referrals" ON referrals;
DROP POLICY IF EXISTS "Users can create referrals" ON referrals;
DROP POLICY IF EXISTS "Admins can update referrals" ON referrals;
DROP POLICY IF EXISTS "Users can see own rewards" ON referral_rewards;
DROP POLICY IF EXISTS "Users can update own reward seen status" ON referral_rewards;

-- Referral codes: authenticated users can look up any code (needed for validation at signup)
-- but can only INSERT their own
CREATE POLICY "Authenticated can read referral codes"
  ON referral_codes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own referral codes"
  ON referral_codes FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

-- Users cannot UPDATE or DELETE referral codes
-- (only the generate_referral_code function can, via SECURITY DEFINER)

-- Referrals: users see their own, can only insert as the referred person
CREATE POLICY "Users can see own referrals"
  ON referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- Admins can see all referrals for their gym
CREATE POLICY "Admins can see gym referrals"
  ON referrals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND gym_id = referrals.gym_id
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Users can create referrals for themselves only"
  ON referrals FOR INSERT
  WITH CHECK (
    auth.uid() = referred_id
    AND referrer_id != referred_id  -- no self-referral via RLS too
  );

CREATE POLICY "Admins can update referrals in their gym"
  ON referrals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND gym_id = referrals.gym_id
        AND role IN ('admin', 'super_admin')
    )
  );

-- Referral rewards: read own, update ONLY the 'seen' field
CREATE POLICY "Users can see own rewards"
  ON referral_rewards FOR SELECT
  USING (auth.uid() = profile_id);

-- Admins can see all rewards for their gym
CREATE POLICY "Admins can see gym rewards"
  ON referral_rewards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND gym_id = referral_rewards.gym_id
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Users can mark own rewards as seen"
  ON referral_rewards FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (
    auth.uid() = profile_id
    -- Only allow updating 'seen' and 'claimed' to true, nothing else
    -- (enforced at app level, but RLS ensures ownership)
  );

-- No INSERT policy for referral_rewards — only the complete_referral function can insert
-- No DELETE policy for any referral table — rewards cannot be deleted by users

-- 4. Replace complete_referral with hardened version
CREATE OR REPLACE FUNCTION complete_referral(p_referral_id UUID)
RETURNS VOID AS $$
DECLARE
  ref RECORD;
  gym_config JSONB;
  referrer_reward JSONB;
  referred_reward JSONB;
  monthly_cap INTEGER;
  referrer_monthly_count INTEGER;
  referred_account_age INTERVAL;
BEGIN
  -- Get the referral (must be pending)
  SELECT * INTO ref FROM referrals WHERE id = p_referral_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE NOTICE 'Referral % not found or not pending', p_referral_id;
    RETURN;
  END IF;

  -- SECURITY: Block self-referral (belt + suspenders with the CHECK constraint)
  IF ref.referrer_id = ref.referred_id THEN
    RAISE NOTICE 'Self-referral blocked for %', ref.referrer_id;
    UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
    RETURN;
  END IF;

  -- SECURITY: Block circular referrals (A referred B, now B tries to refer A)
  IF EXISTS (
    SELECT 1 FROM referrals
    WHERE referrer_id = ref.referred_id
      AND referred_id = ref.referrer_id
      AND gym_id = ref.gym_id
      AND status = 'completed'
  ) THEN
    RAISE NOTICE 'Circular referral blocked: % <-> %', ref.referrer_id, ref.referred_id;
    UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
    RETURN;
  END IF;

  -- SECURITY: Check referred account is at least 5 minutes old (prevents bot spam)
  SELECT (now() - created_at) INTO referred_account_age
  FROM profiles WHERE id = ref.referred_id;
  IF referred_account_age < interval '5 minutes' THEN
    RAISE NOTICE 'Account too new for referral: %', ref.referred_id;
    RETURN; -- Don't reject, just delay — will be retried
  END IF;

  -- Get gym config
  SELECT referral_config INTO gym_config FROM gyms WHERE id = ref.gym_id;
  IF gym_config IS NULL OR NOT (gym_config->>'enabled')::boolean THEN
    RAISE NOTICE 'Referral program not enabled for gym %', ref.gym_id;
    RETURN;
  END IF;

  -- SECURITY: Enforce monthly cap for the referrer
  monthly_cap := (gym_config->>'max_referrals_per_month')::integer;
  IF monthly_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO referrer_monthly_count
    FROM referrals
    WHERE referrer_id = ref.referrer_id
      AND gym_id = ref.gym_id
      AND status = 'completed'
      AND completed_at >= date_trunc('month', now());

    IF referrer_monthly_count >= monthly_cap THEN
      RAISE NOTICE 'Monthly cap (%) reached for referrer %', monthly_cap, ref.referrer_id;
      UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
      RETURN;
    END IF;
  END IF;

  -- SECURITY: Check referrer hasn't already been rewarded for this same referred person
  --           (UNIQUE constraint on referred_id+gym_id handles this, but double check)
  IF EXISTS (
    SELECT 1 FROM referral_rewards
    WHERE referral_id IN (
      SELECT id FROM referrals
      WHERE referred_id = ref.referred_id AND gym_id = ref.gym_id
    )
  ) THEN
    RAISE NOTICE 'Rewards already granted for referred user %', ref.referred_id;
    UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
    RETURN;
  END IF;

  referrer_reward := gym_config->'referrer_reward';
  referred_reward := gym_config->'referred_reward';

  -- Mark referral as completed
  UPDATE referrals SET status = 'completed', completed_at = now() WHERE id = p_referral_id;

  -- Increment uses count on referral code
  IF ref.referral_code_id IS NOT NULL THEN
    UPDATE referral_codes SET uses_count = uses_count + 1 WHERE id = ref.referral_code_id;
  END IF;

  -- Grant reward to referrer
  INSERT INTO referral_rewards (referral_id, profile_id, gym_id, reward_type, reward_value)
  VALUES (p_referral_id, ref.referrer_id, ref.gym_id, referrer_reward->>'type', referrer_reward);

  -- Grant reward to referred
  INSERT INTO referral_rewards (referral_id, profile_id, gym_id, reward_type, reward_value)
  VALUES (p_referral_id, ref.referred_id, ref.gym_id, referred_reward->>'type', referred_reward);

  RAISE NOTICE 'Referral % completed successfully', p_referral_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Rate-limit referral code generation (one per user per gym, already enforced by UNIQUE)
--    But also add a trigger to prevent rapid-fire referral creation

CREATE OR REPLACE FUNCTION check_referral_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  -- Max 3 referral records per referred user per day (prevents spam signups)
  SELECT COUNT(*) INTO recent_count
  FROM referrals
  WHERE referred_id = NEW.referred_id
    AND created_at > now() - interval '24 hours';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many referral attempts in 24 hours';
  END IF;

  -- Ensure referrer and referred are not the same person
  IF NEW.referrer_id = NEW.referred_id THEN
    RAISE EXCEPTION 'Self-referral is not allowed';
  END IF;

  -- Ensure referrer belongs to the same gym
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = NEW.referrer_id AND gym_id = NEW.gym_id
  ) THEN
    RAISE EXCEPTION 'Referrer does not belong to this gym';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_referral_rate_limit ON referrals;
CREATE TRIGGER trg_referral_rate_limit
  BEFORE INSERT ON referrals
  FOR EACH ROW
  EXECUTE FUNCTION check_referral_rate_limit();

-- 6. Prevent users from calling complete_referral directly via RPC
--    by adding caller validation
CREATE OR REPLACE FUNCTION safe_complete_referral(p_referral_id UUID)
RETURNS VOID AS $$
DECLARE
  ref RECORD;
  caller_role TEXT;
BEGIN
  -- Get the referral
  SELECT * INTO ref FROM referrals WHERE id = p_referral_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Only the referred user (during signup) or an admin of the gym can complete
  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid() AND gym_id = ref.gym_id;

  IF auth.uid() != ref.referred_id AND caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: only the referred user or gym admin can complete a referral';
  END IF;

  -- Delegate to the actual function
  PERFORM complete_referral(p_referral_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
