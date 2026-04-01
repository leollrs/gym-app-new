-- ══════════════════════════════════════════════════════════════════════
-- MEMBER INVITE SYSTEM
-- Gym staff pre-creates member entries, generates invite codes.
-- Members use invite codes during signup to link accounts.
-- ══════════════════════════════════════════════════════════════════════

-- 1. Member invites table
CREATE TABLE IF NOT EXISTS member_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),  -- admin who created it
  invite_code TEXT UNIQUE NOT NULL,
  invite_url TEXT,  -- full link like https://tugympr.app/invite/CODE

  -- Pre-filled member info (optional, transferred to profile on claim)
  member_name TEXT,
  member_email TEXT,
  member_phone TEXT,

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired', 'revoked')),
  claimed_by UUID REFERENCES profiles(id),  -- profile that used this invite
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '90 days'),

  -- Optional: link to referral (if the invite was created alongside a referral)
  referral_code TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Registration mode on gyms table
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS registration_mode TEXT DEFAULT 'both'
  CHECK (registration_mode IN ('invite_only', 'gym_code', 'both'));

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_member_invites_code ON member_invites(invite_code);
CREATE INDEX IF NOT EXISTS idx_member_invites_gym ON member_invites(gym_id, status);
CREATE INDEX IF NOT EXISTS idx_member_invites_claimed_by ON member_invites(claimed_by);

-- 4. RLS
ALTER TABLE member_invites ENABLE ROW LEVEL SECURITY;

-- Admins can do everything for their gym
CREATE POLICY "Admins can manage invites" ON member_invites FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND gym_id = member_invites.gym_id AND role IN ('admin', 'super_admin', 'trainer'))
);

-- Authenticated users can look up invites by code (needed during signup)
CREATE POLICY "Authenticated can look up invite by code" ON member_invites FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can update their own claimed invite (to set claimed status)
CREATE POLICY "Users can claim invites" ON member_invites FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (claimed_by = auth.uid() OR claimed_by IS NULL);

-- 5. Function to generate invite code
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
BEGIN
  LOOP
    -- Format: TGP-XXXX (4 alphanumeric chars)
    new_code := 'TGP-' || upper(substr(md5(random()::text), 1, 4));
    -- Check uniqueness
    IF NOT EXISTS (SELECT 1 FROM member_invites WHERE invite_code = new_code) THEN
      RETURN new_code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 6. Function to claim an invite during signup
CREATE OR REPLACE FUNCTION claim_member_invite(p_invite_code TEXT, p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
  inv RECORD;
BEGIN
  -- Find the invite
  SELECT * INTO inv FROM member_invites
  WHERE invite_code = upper(trim(p_invite_code))
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired');
  END IF;

  -- Mark as claimed
  UPDATE member_invites
  SET status = 'claimed', claimed_by = p_profile_id, claimed_at = now()
  WHERE id = inv.id;

  -- Link the profile to the gym
  UPDATE profiles
  SET gym_id = inv.gym_id,
      full_name = COALESCE(NULLIF(trim(inv.member_name), ''), full_name),
      phone = COALESCE(NULLIF(trim(inv.member_phone), ''), phone)
  WHERE id = p_profile_id;

  RETURN jsonb_build_object(
    'success', true,
    'gym_id', inv.gym_id,
    'member_name', inv.member_name,
    'member_phone', inv.member_phone
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Security: rate limit invite claims (max 5 attempts per user per hour)
CREATE OR REPLACE FUNCTION check_invite_claim_rate()
RETURNS TRIGGER AS $$
DECLARE
  recent_claims INTEGER;
BEGIN
  SELECT COUNT(*) INTO recent_claims
  FROM member_invites
  WHERE claimed_by = NEW.claimed_by
    AND claimed_at > now() - interval '1 hour';

  IF recent_claims >= 5 THEN
    RAISE EXCEPTION 'Too many invite claim attempts. Try again later.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invite_claim_rate ON member_invites;
CREATE TRIGGER trg_invite_claim_rate
  BEFORE UPDATE ON member_invites
  FOR EACH ROW
  WHEN (NEW.status = 'claimed' AND OLD.status = 'pending')
  EXECUTE FUNCTION check_invite_claim_rate();
