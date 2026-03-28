-- Rate-limit brute-force attempts on claim_invite_code()
-- and restrict admin invite creation to super_admins

-- ── 1. Attempt-logging table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invite_claim_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_code TEXT NOT NULL,
  success        BOOLEAN NOT NULL DEFAULT false,
  attempted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hint        TEXT
);

CREATE INDEX idx_invite_claim_attempts_user_recent
  ON public.invite_claim_attempts (user_id, attempted_at DESC);

-- ── 2. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.invite_claim_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own attempt rows"
  ON public.invite_claim_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── 3. claim_invite_code() — now with rate limiting + logging ───────
CREATE OR REPLACE FUNCTION public.claim_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_clean        TEXT;
  v_invite       RECORD;
  v_uid          UUID;
  v_fail_count   INT;
  v_result       JSONB;
BEGIN
  -- Must be authenticated
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- Strip whitespace and dashes, uppercase for case-insensitive match
  v_clean := upper(regexp_replace(p_invite_code, '[\s\-]', '', 'g'));

  -- ── Rate-limit check ────────────────────────────────────────────
  SELECT count(*)
    INTO v_fail_count
    FROM public.invite_claim_attempts
   WHERE user_id = v_uid
     AND success = false
     AND attempted_at > now() - INTERVAL '15 minutes';

  IF v_fail_count >= 5 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Too many attempts. Try again in 15 minutes.'
    );
  END IF;

  -- Look up the invite
  SELECT *
    INTO v_invite
    FROM gym_invites
   WHERE upper(invite_code) = v_clean;

  IF NOT FOUND THEN
    -- Log failed attempt
    INSERT INTO public.invite_claim_attempts (user_id, attempted_code, success)
    VALUES (v_uid, v_clean, false);

    RETURN jsonb_build_object('success', false, 'error', 'Invite code not found');
  END IF;

  -- Already used?
  IF v_invite.used_by IS NOT NULL THEN
    INSERT INTO public.invite_claim_attempts (user_id, attempted_code, success)
    VALUES (v_uid, v_clean, false);

    RETURN jsonb_build_object('success', false, 'error', 'Invite code has already been used');
  END IF;

  -- Expired?
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < NOW() THEN
    INSERT INTO public.invite_claim_attempts (user_id, attempted_code, success)
    VALUES (v_uid, v_clean, false);

    RETURN jsonb_build_object('success', false, 'error', 'Invite code has expired');
  END IF;

  -- Check if user already belongs to a different gym
  IF EXISTS (
    SELECT 1 FROM profiles
     WHERE id = v_uid
       AND gym_id IS NOT NULL
       AND gym_id <> v_invite.gym_id
  ) THEN
    INSERT INTO public.invite_claim_attempts (user_id, attempted_code, success)
    VALUES (v_uid, v_clean, false);

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

  -- Log successful attempt
  INSERT INTO public.invite_claim_attempts (user_id, attempted_code, success)
  VALUES (v_uid, v_clean, true);

  RETURN jsonb_build_object(
    'success',     true,
    'gym_id',      v_invite.gym_id,
    'role',        v_invite.role,
    'member_name', v_invite.member_name
  );
END;
$$;

-- ── 4. admin_create_invite_code() — restrict admin role invites ─────
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
  v_code         TEXT;
  v_exists       BOOLEAN;
  v_attempt      INT := 0;
  v_id           UUID;
  v_expires      TIMESTAMPTZ;
  v_caller_role  TEXT;
BEGIN
  -- Only admins may call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  -- Restrict creating admin invites to super_admins only
  IF p_role = 'admin' THEN
    SELECT role INTO v_caller_role
      FROM profiles
     WHERE id = auth.uid();

    IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
      RAISE EXCEPTION 'Permission denied: only super_admin can create admin invites';
    END IF;
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
