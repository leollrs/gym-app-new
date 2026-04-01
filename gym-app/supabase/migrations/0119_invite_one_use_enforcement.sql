-- ══════════════════════════════════════════════════════════════════════
-- INVITE CODE: STRICT ONE-USE ENFORCEMENT
-- Once claimed, an invite code is permanently dead.
-- Only gym admin can reissue a new code (by creating a new invite).
-- ══════════════════════════════════════════════════════════════════════

-- 1. CONSTRAINT: An invite can only be claimed by one profile
--    (claimed_by can only be set once — prevents any race condition)
ALTER TABLE member_invites DROP CONSTRAINT IF EXISTS one_claim_per_invite;
ALTER TABLE member_invites ADD CONSTRAINT one_claim_per_invite UNIQUE (claimed_by);
-- Note: NULL values don't conflict, so unclaimed invites are fine.
-- Once claimed_by is set, no other invite can have the same claimed_by.

-- 2. CONSTRAINT: A profile can only claim one invite per gym
--    (prevents a user from using multiple invite codes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_invite_per_profile_per_gym
  ON member_invites (claimed_by, gym_id)
  WHERE claimed_by IS NOT NULL;

-- 3. Trigger: prevent re-claiming an already claimed invite
CREATE OR REPLACE FUNCTION prevent_invite_reclaim()
RETURNS TRIGGER AS $$
BEGIN
  -- If the invite was already claimed, block any status change back to pending
  IF OLD.status = 'claimed' AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'Cannot reactivate a claimed invite. Create a new invite instead.';
  END IF;

  -- If claimed, prevent changing claimed_by
  IF OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS DISTINCT FROM OLD.claimed_by THEN
    RAISE EXCEPTION 'Cannot reassign a claimed invite to a different user.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_invite_reclaim ON member_invites;
CREATE TRIGGER trg_prevent_invite_reclaim
  BEFORE UPDATE ON member_invites
  FOR EACH ROW
  EXECUTE FUNCTION prevent_invite_reclaim();

-- 4. Function for admin to handle "lost account" scenario:
--    Terminates the old account's gym link and creates a fresh invite.
--    The old profile data stays (for records) but is unlinked from the gym.
CREATE OR REPLACE FUNCTION admin_reissue_member_invite(
  p_admin_id UUID,
  p_old_profile_id UUID,
  p_gym_id UUID,
  p_member_name TEXT DEFAULT NULL,
  p_member_phone TEXT DEFAULT NULL,
  p_member_email TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  admin_role TEXT;
  new_code TEXT;
  new_invite_id UUID;
BEGIN
  -- Verify caller is admin/owner of this gym
  SELECT role INTO admin_role FROM profiles
  WHERE id = p_admin_id AND gym_id = p_gym_id;

  IF admin_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only gym admins can reissue invites';
  END IF;

  -- Unlink the old profile from the gym (don't delete — preserve history)
  UPDATE profiles
  SET gym_id = NULL
  WHERE id = p_old_profile_id AND gym_id = p_gym_id;

  -- Expire any existing pending invites for this member info
  UPDATE member_invites
  SET status = 'expired'
  WHERE gym_id = p_gym_id
    AND status = 'pending'
    AND (member_email = p_member_email OR member_phone = p_member_phone);

  -- Generate a new invite code
  new_code := (SELECT generate_invite_code());

  -- Create new invite
  INSERT INTO member_invites (
    gym_id, created_by, invite_code,
    member_name, member_email, member_phone,
    invite_url, status
  ) VALUES (
    p_gym_id, p_admin_id, new_code,
    COALESCE(p_member_name, (SELECT full_name FROM profiles WHERE id = p_old_profile_id)),
    p_member_email,
    p_member_phone,
    'https://tugympr.app/invite/' || new_code,
    'pending'
  )
  RETURNING id INTO new_invite_id;

  RETURN jsonb_build_object(
    'success', true,
    'new_invite_id', new_invite_id,
    'new_code', new_code,
    'old_profile_unlinked', true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
