-- 0213: Security fix — SET search_path on SECURITY DEFINER functions + check-in deduplication
--
-- SECURITY DEFINER functions without an explicit search_path can be tricked
-- into resolving unqualified table names via a malicious schema on the
-- caller's search_path.  Adding  SET search_path = public  pins resolution
-- to the public schema.

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 1: check_rate_limit — add SET search_path = public  (from 0109)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action TEXT,
  p_max_calls INT DEFAULT 10,
  p_window_minutes INT DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT COUNT(*) INTO v_count
    FROM rpc_rate_limits
   WHERE user_id = v_uid
     AND action  = p_action
     AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  IF v_count >= p_max_calls THEN
    RETURN false;
  END IF;

  INSERT INTO rpc_rate_limits (user_id, action) VALUES (v_uid, p_action);
  RETURN true;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 2: cleanup_rpc_rate_limits — add SET search_path = public  (from 0109)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_rpc_rate_limits()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rpc_rate_limits
   WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 3: claim_invite_code — add SET search_path = public  (from 0108)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.claim_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 4: admin_create_invite_code — add SET search_path = public  (from 0108)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_create_invite_code(
  p_gym_id      UUID,
  p_member_name TEXT,
  p_phone       TEXT DEFAULT NULL,
  p_email       TEXT DEFAULT NULL,
  p_role        TEXT DEFAULT 'member'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 5: Check-in deduplication — prevent multiple check-ins per day
-- ═══════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS check_ins_one_per_day
  ON check_ins (profile_id, (checked_in_at::date));
