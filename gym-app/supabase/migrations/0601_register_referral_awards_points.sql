-- 0601_register_referral_awards_points.sql
--
-- BUG: referral points never landed for the common "no admin approval" gym
-- config. register_referral() auto-completed the referral with a bare
--   UPDATE referrals SET status='completed'
-- which flips the status but awards NOTHING — no reward_points_log row, no
-- reward_points balance, no milestone check. So referrers/referred members got
-- zero points and the "historial" showed nothing.
--
-- HISTORY: 0351 had already fixed this by calling complete_referral() in the
-- auto-complete branch. 0480 (an IDOR/security hardening pass) reproduced the
-- function body "verbatim from live" and, in doing so, reintroduced the bare
-- UPDATE — silently reverting 0351. This migration restores the
-- complete_referral() call while KEEPING 0480's security guards intact.
--
-- complete_referral() (0372) is the single writer of referral rewards: it reads
-- gyms.referral_config, awards points OR a gym_reward to both parties, stamps
-- referrals.points_awarded, and runs check_referral_milestones(). It flips the
-- status to 'completed' itself and no-ops if already completed, so it is safe
-- and idempotent to call here.
--
-- Approval-required gyms are UNCHANGED: their referrals stay 'pending' and are
-- completed (and thus awarded) later via safe_complete_referral() — the admin
-- approve / referral-QR-scan path, which already calls complete_referral().

CREATE OR REPLACE FUNCTION public.register_referral(p_code text, p_referred_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code_row         referral_codes;
  v_referred_gym     UUID;
  v_referrer_name    TEXT;
  v_referral_id      UUID;
  v_require_approval BOOLEAN;
BEGIN
  -- SECURITY (0480 FIX 1): callers may only register a referral for THEMSELVES.
  -- Without this, any authenticated member could force accepted friendships and
  -- inflate another user's (or their own) completed-referral count.
  IF p_referred_id IS NULL OR p_referred_id <> auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- Look up referral code (case-insensitive)
  SELECT * INTO v_code_row
  FROM referral_codes
  WHERE upper(code) = upper(p_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_CODE');
  END IF;

  -- Get referred user's gym
  SELECT gym_id INTO v_referred_gym FROM profiles WHERE id = p_referred_id;

  IF v_referred_gym IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NO_GYM');
  END IF;

  -- Prevent self-referral
  IF v_code_row.profile_id = p_referred_id THEN
    RETURN json_build_object('success', false, 'error', 'SELF_REFERRAL');
  END IF;

  -- Get referrer name
  SELECT full_name INTO v_referrer_name FROM profiles WHERE id = v_code_row.profile_id;

  -- Create referral row (idempotent — UNIQUE(referred_id, gym_id))
  INSERT INTO referrals (referrer_id, referred_id, gym_id, referral_code_id, status)
  VALUES (v_code_row.profile_id, p_referred_id, v_referred_gym, v_code_row.id, 'pending')
  ON CONFLICT (referred_id, gym_id) DO NOTHING
  RETURNING id INTO v_referral_id;

  IF v_referral_id IS NULL THEN
    SELECT id INTO v_referral_id
    FROM referrals
    WHERE referred_id = p_referred_id AND gym_id = v_referred_gym;
  END IF;

  -- Create accepted friendship (bidirectional is implicit — either direction works).
  -- friendships has UNIQUE(requester_id, addressee_id). Try the canonical direction first.
  INSERT INTO friendships (gym_id, requester_id, addressee_id, status)
  VALUES (v_referred_gym, v_code_row.profile_id, p_referred_id, 'accepted')
  ON CONFLICT (requester_id, addressee_id) DO UPDATE
    SET status = 'accepted', updated_at = now();

  -- Also handle reverse direction if it already exists as pending
  UPDATE friendships
  SET status = 'accepted', updated_at = now()
  WHERE requester_id = p_referred_id
    AND addressee_id = v_code_row.profile_id
    AND status <> 'accepted';

  -- Auto-complete the referral if the gym doesn't require admin approval
  SELECT COALESCE((referral_config->>'require_admin_approval')::boolean, false)
  INTO v_require_approval
  FROM gyms
  WHERE id = v_referred_gym;

  IF NOT v_require_approval THEN
    -- THE FIX: award points/rewards to BOTH parties + run milestone checks.
    -- complete_referral() flips status to 'completed' itself (and no-ops if it
    -- already is), so the bare status UPDATE that used to live here — which
    -- marked completed WITHOUT awarding anything — is gone.
    PERFORM public.complete_referral(v_referral_id);

    UPDATE referral_codes
    SET uses_count = COALESCE(uses_count, 0) + 1
    WHERE id = v_code_row.id;
  END IF;

  RETURN json_build_object(
    'success',       true,
    'referral_id',   v_referral_id,
    'referrer_id',   v_code_row.profile_id,
    'referrer_name', COALESCE(v_referrer_name, 'Member'),
    'gym_id',        v_referred_gym,
    'auto_completed', NOT v_require_approval
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', 'UNKNOWN', 'detail', SQLERRM);
END;
$function$;

NOTIFY pgrst, 'reload schema';
