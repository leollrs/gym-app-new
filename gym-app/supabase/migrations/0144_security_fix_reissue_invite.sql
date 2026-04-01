-- Fix HIGH security issue: admin_reissue_member_invite used p_admin_id parameter
-- instead of auth.uid(), allowing admin impersonation.
-- Now uses auth.uid() for all identity checks and audit fields.

CREATE OR REPLACE FUNCTION admin_reissue_member_invite(
  p_admin_id UUID,            -- kept for backward compat; ignored in favour of auth.uid()
  p_old_profile_id UUID,
  p_gym_id UUID,
  p_member_name TEXT DEFAULT NULL,
  p_member_phone TEXT DEFAULT NULL,
  p_member_email TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  _caller_id UUID := auth.uid();
  admin_role TEXT;
  new_code TEXT;
  new_invite_id UUID;
BEGIN
  -- Verify the *actual* caller is admin/owner of this gym
  SELECT role INTO admin_role FROM profiles
  WHERE id = _caller_id AND gym_id = p_gym_id;

  IF admin_role IS NULL OR admin_role NOT IN ('admin', 'super_admin') THEN
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

  -- Create new invite (created_by = actual caller, not the parameter)
  INSERT INTO member_invites (
    gym_id, created_by, invite_code,
    member_name, member_email, member_phone,
    invite_url, status
  ) VALUES (
    p_gym_id, _caller_id, new_code,
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
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
