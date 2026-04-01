-- Fix CRITICAL security issue: claim_member_invite accepted arbitrary profile_id,
-- allowing anyone to reassign any user to a different gym.
-- Now enforces that the caller can only claim invites for themselves.

CREATE OR REPLACE FUNCTION claim_member_invite(p_invite_code TEXT, p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
  inv RECORD;
BEGIN
  -- Security check: only allow claiming for yourself
  IF p_profile_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: can only claim invites for yourself';
  END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
