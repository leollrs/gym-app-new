-- =============================================================
-- 0288 — Per-IP rate limiting for invite code claims
--
-- Problem: The per-user rate limiting from 0108 was lost in later
-- overrides (0253, 0265). Additionally, per-user limits alone
-- don't prevent an attacker with multiple accounts from brute-
-- forcing invite codes.
--
-- Fix:
-- 1. Add ip_address column to invite_claim_attempts (indexed)
-- 2. Add optional p_client_ip parameter to claim_invite_code
-- 3. Restore per-user rate limiting (5 attempts / 15 min)
-- 4. Add per-IP rate limiting (20 attempts / 1 hour)
-- 5. Log IP on every attempt for audit trail
-- =============================================================


-- ── 1. Add ip_address column + index ─────────────────────────
ALTER TABLE public.invite_claim_attempts
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

CREATE INDEX IF NOT EXISTS idx_invite_claim_attempts_ip_recent
  ON public.invite_claim_attempts (ip_address, attempted_at DESC)
  WHERE ip_address IS NOT NULL;


-- ── 2. Recreate claim_invite_code with IP rate limiting ──────
-- Drop the old single-param version so we can create the new signature
-- (CREATE OR REPLACE won't work when adding parameters with defaults
--  if the old function has a different arity that conflicts on call)
DROP FUNCTION IF EXISTS public.claim_invite_code(TEXT);

CREATE OR REPLACE FUNCTION public.claim_invite_code(
  p_invite_code TEXT,
  p_client_ip   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite          RECORD;
  v_uid             UUID;
  v_code            TEXT;
  v_existing_gym    UUID;
  v_referrer_id     UUID;
  v_referral_id     UUID;
  v_deferred_result JSONB;
  v_fail_count_user INT;
  v_fail_count_ip   INT;
  v_clean_ip        TEXT;
BEGIN
  -- ── Auth check ────────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Sanitize IP (trim whitespace, limit length to prevent abuse)
  v_clean_ip := NULL;
  IF p_client_ip IS NOT NULL AND length(trim(p_client_ip)) > 0 THEN
    v_clean_ip := left(trim(p_client_ip), 45);  -- max IPv6 length
  END IF;

  -- ── Per-user rate limit: 5 failed attempts per 15 minutes ──
  SELECT count(*)
    INTO v_fail_count_user
    FROM invite_claim_attempts
   WHERE user_id = v_uid
     AND success = false
     AND attempted_at > now() - INTERVAL '15 minutes';

  IF v_fail_count_user >= 5 THEN
    -- Still log the blocked attempt for audit
    INSERT INTO invite_claim_attempts (user_id, attempted_code, success, ip_address)
    VALUES (v_uid, 'RATE_LIMITED', false, v_clean_ip);

    RETURN jsonb_build_object(
      'success', false,
      'error',   'RATE_LIMITED',
      'message', 'Too many attempts. Try again in 15 minutes.'
    );
  END IF;

  -- ── Per-IP rate limit: 20 failed attempts per hour ─────────
  IF v_clean_ip IS NOT NULL THEN
    SELECT count(*)
      INTO v_fail_count_ip
      FROM invite_claim_attempts
     WHERE ip_address = v_clean_ip
       AND success = false
       AND attempted_at > now() - INTERVAL '1 hour';

    IF v_fail_count_ip >= 20 THEN
      -- Log the blocked attempt
      INSERT INTO invite_claim_attempts (user_id, attempted_code, success, ip_address)
      VALUES (v_uid, 'RATE_LIMITED_IP', false, v_clean_ip);

      RETURN jsonb_build_object(
        'success', false,
        'error',   'RATE_LIMITED',
        'message', 'Too many attempts from this network. Try again later.'
      );
    END IF;
  END IF;

  -- ── Normalize code ────────────────────────────────────────
  v_code := upper(trim(replace(p_invite_code, '-', '')));

  -- ── Lookup invite ─────────────────────────────────────────
  SELECT * INTO v_invite FROM gym_invites
  WHERE invite_code = v_code OR upper(trim(replace(invite_code, '-', ''))) = v_code;

  IF NOT FOUND THEN
    INSERT INTO invite_claim_attempts (user_id, attempted_code, success, ip_address)
    VALUES (v_uid, v_code, false, v_clean_ip);

    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
  END IF;

  IF v_invite.used_by IS NOT NULL THEN
    INSERT INTO invite_claim_attempts (user_id, attempted_code, success, ip_address)
    VALUES (v_uid, v_code, false, v_clean_ip);

    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_USED');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    INSERT INTO invite_claim_attempts (user_id, attempted_code, success, ip_address)
    VALUES (v_uid, v_code, false, v_clean_ip);

    RETURN jsonb_build_object('success', false, 'error', 'EXPIRED');
  END IF;

  -- Check if user is already in a different gym
  SELECT gym_id INTO v_existing_gym FROM profiles WHERE id = v_uid;
  IF v_existing_gym IS NOT NULL AND v_existing_gym != v_invite.gym_id THEN
    INSERT INTO invite_claim_attempts (user_id, attempted_code, success, ip_address)
    VALUES (v_uid, v_code, false, v_clean_ip);

    RETURN jsonb_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  -- ── Claim the invite ──────────────────────────────────────
  UPDATE gym_invites SET used_by = v_uid, used_at = now() WHERE id = v_invite.id;

  -- Update profile — always force role to 'member' (security fix 0198)
  UPDATE profiles
  SET gym_id = v_invite.gym_id,
      role = 'member',
      membership_status = 'active',
      full_name = COALESCE(NULLIF(full_name, ''), v_invite.member_name, full_name)
  WHERE id = v_uid;

  -- Log successful attempt
  INSERT INTO invite_claim_attempts (user_id, attempted_code, success, ip_address)
  VALUES (v_uid, v_code, true, v_clean_ip);

  -- Auto-create referral if invite has a linked referral code
  v_deferred_result := NULL;
  IF v_invite.referral_code_id IS NOT NULL THEN
    SELECT profile_id INTO v_referrer_id
    FROM referral_codes WHERE id = v_invite.referral_code_id;

    IF v_referrer_id IS NOT NULL AND v_referrer_id != v_uid THEN
      INSERT INTO referrals (referrer_id, referred_id, gym_id, referral_code_id, status)
      VALUES (v_referrer_id, v_uid, v_invite.gym_id, v_invite.referral_code_id, 'pending')
      ON CONFLICT (referred_id, gym_id) DO NOTHING
      RETURNING id INTO v_referral_id;

      -- Complete with deferred reward choice
      IF v_referral_id IS NOT NULL THEN
        v_deferred_result := complete_referral_deferred(v_referral_id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'gym_id', v_invite.gym_id,
    'role', 'member',
    'member_name', v_invite.member_name,
    'has_referral', v_invite.referral_code_id IS NOT NULL AND v_deferred_result IS NOT NULL,
    'referred_reward_id', v_deferred_result->>'referred_reward_id'
  );
END;
$$;


-- ── 3. Grant execute on new signature ────────────────────────
GRANT EXECUTE ON FUNCTION public.claim_invite_code(TEXT, TEXT) TO authenticated;


-- ── 4. Reload PostgREST schema cache ────────────────────────
NOTIFY pgrst, 'reload schema';
