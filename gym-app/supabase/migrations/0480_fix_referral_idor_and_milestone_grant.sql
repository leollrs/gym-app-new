-- 0480_fix_referral_idor_and_milestone_grant.sql
--
-- Closes a live referral-fraud chain found auditing function bodies + grants
-- against production on 2026-05-30.
--
-- CHAIN:
--   1) register_referral(p_code, p_referred_id) is granted to `authenticated`
--      but NEVER checks p_referred_id against auth.uid(). A member can call
--      register_referral(own_code, <any victim_id>) to:
--        (a) insert an ACCEPTED friendship attacker<->victim with no consent
--            (bypasses the friend-request flow -> unlocks friends-only DM and
--             friend-only feed to a non-consenting member), and
--        (b) auto-complete the referral (when the gym doesn't require admin
--            approval), inflating the attacker's completed-referral COUNT.
--   2) check_referral_milestones(p_referrer_id) carries PUBLIC/anon EXECUTE and
--      has no caller authz; it mints milestone rewards based on the completed
--      count -> the payoff for the inflated count in step 1.
--
-- FIX 1: register_referral enforces p_referred_id = auth.uid() (the legit caller
--        is the referred user registering themselves at signup).
-- FIX 2: revoke check_referral_milestones from anon/authenticated/PUBLIC; it is
--        an internal helper invoked by complete_referral (service_role-locked).
--
-- complete_referral / complete_referral_deferred were verified {postgres,
-- service_role} only — correctly locked, left unchanged.

-- ── FIX 1: register_referral self-only guard ───────────────────────────────
-- Body reproduced verbatim from live (pg_get_functiondef) with a single added
-- guard immediately after BEGIN.
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
  -- SECURITY: callers may only register a referral for THEMSELVES. Without
  -- this, any authenticated member could force accepted friendships and
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
    UPDATE referrals
    SET status = 'completed', completed_at = now()
    WHERE id = v_referral_id AND status = 'pending';

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

-- ── FIX 2: lock down the milestone-minting helper ──────────────────────────
REVOKE EXECUTE ON FUNCTION public.check_referral_milestones(uuid)
  FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
