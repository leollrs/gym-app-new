-- Security fix: claim_invite_code must not copy the invite's role into the profile.
-- Previously, claiming a trainer-role invite promoted the user to trainer,
-- bypassing the guard_profile_update trigger (function runs as SECURITY DEFINER).
-- Now the role is always set to 'member'. Trainer promotion must be a separate
-- admin action.

CREATE OR REPLACE FUNCTION public.claim_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_clean   TEXT;
  v_invite  RECORD;
  v_uid     UUID;
BEGIN
  -- Must be authenticated
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- Strip whitespace and dashes, uppercase for case-insensitive match
  v_clean := upper(regexp_replace(p_invite_code, '[\s\-]', '', 'g'));

  -- Look up the invite
  SELECT *
    INTO v_invite
    FROM gym_invites
   WHERE upper(invite_code) = v_clean;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code not found');
  END IF;

  -- Already used?
  IF v_invite.used_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code has already been used');
  END IF;

  -- Expired?
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code has expired');
  END IF;

  -- Check if user already belongs to a different gym
  IF EXISTS (
    SELECT 1 FROM profiles
     WHERE id = v_uid
       AND gym_id IS NOT NULL
       AND gym_id <> v_invite.gym_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already belong to a different gym');
  END IF;

  -- ── Claim the invite ──────────────────────────────────────────────
  UPDATE gym_invites
     SET used_by = v_uid,
         used_at = NOW()
   WHERE id = v_invite.id;

  -- Copy member_name to profile if profile full_name is empty
  -- SECURITY FIX: always set role = 'member' regardless of invite role
  UPDATE profiles
     SET full_name = v_invite.member_name,
         gym_id    = v_invite.gym_id,
         role      = 'member',
         membership_status = 'active'
   WHERE id = v_uid
     AND (full_name IS NULL OR full_name = '');

  -- If full_name was already set, still ensure gym_id/role/status are updated
  -- SECURITY FIX: always set role = 'member' regardless of invite role
  UPDATE profiles
     SET gym_id    = v_invite.gym_id,
         role      = 'member',
         membership_status = 'active'
   WHERE id = v_uid
     AND full_name IS NOT NULL
     AND full_name <> '';

  RETURN jsonb_build_object(
    'success',     true,
    'gym_id',      v_invite.gym_id,
    'role',        v_invite.role,
    'member_name', v_invite.member_name
  );
END;
$$;
