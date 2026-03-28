-- Invite codes: short human-readable codes for gym member onboarding
-- Extends gym_invites with invite_code, member_name, phone columns

-- ── 1. Add new columns ─────────────────────────────────────────────
ALTER TABLE gym_invites
  ADD COLUMN IF NOT EXISTS invite_code  TEXT,
  ADD COLUMN IF NOT EXISTS member_name  TEXT,
  ADD COLUMN IF NOT EXISTS phone        TEXT;

-- ── 2. Change default expires_at to 30 days ─────────────────────────
ALTER TABLE gym_invites
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days');

-- ── 3. Unique index on invite_code ──────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_invites_invite_code
  ON gym_invites (invite_code)
  WHERE invite_code IS NOT NULL;

-- ── 4. generate_invite_code() ───────────────────────────────────────
-- Returns a random 6-character alphanumeric code.
-- Charset excludes I, L, O, 0, 1 for readability.
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars  TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i      INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- ── 5. admin_create_invite_code() RPC ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_invite_code(
  p_gym_id      UUID,
  p_member_name TEXT,
  p_phone       TEXT DEFAULT NULL,
  p_email       TEXT DEFAULT NULL,
  p_role        TEXT DEFAULT 'member'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code    TEXT;
  v_exists  BOOLEAN;
  v_attempt INT := 0;
  v_id      UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  -- Only admins may call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  -- Generate a unique code with retry loop
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not generate a unique invite code after 10 attempts';
    END IF;

    v_code := public.generate_invite_code();

    SELECT EXISTS(
      SELECT 1 FROM gym_invites WHERE invite_code = v_code
    ) INTO v_exists;

    EXIT WHEN NOT v_exists;
  END LOOP;

  v_expires := NOW() + INTERVAL '30 days';

  INSERT INTO gym_invites (gym_id, created_by, email, invite_code, member_name, phone, role, expires_at)
  VALUES (p_gym_id, auth.uid(), p_email, v_code, p_member_name, p_phone, p_role, v_expires)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id',          v_id,
    'invite_code', v_code,
    'member_name', p_member_name,
    'expires_at',  v_expires
  );
END;
$$;

-- ── 6. claim_invite_code() RPC ──────────────────────────────────────
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
  UPDATE profiles
     SET full_name = v_invite.member_name,
         gym_id    = v_invite.gym_id,
         role      = v_invite.role,
         membership_status = 'active'
   WHERE id = v_uid
     AND (full_name IS NULL OR full_name = '');

  -- If full_name was already set, still ensure gym_id/role/status are updated
  UPDATE profiles
     SET gym_id    = v_invite.gym_id,
         role      = v_invite.role,
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

-- ── 7. Grant execute to authenticated role ──────────────────────────
GRANT EXECUTE ON FUNCTION public.admin_create_invite_code(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_invite_code(TEXT) TO authenticated;
