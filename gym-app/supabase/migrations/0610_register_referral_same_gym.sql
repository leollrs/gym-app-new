-- 0610 — register_referral: require referrer and referred in the SAME gym (Audit P1)
-- ============================================================
-- register_referral() looked up the referral code and the REFERRED user's gym,
-- but never checked the REFERRER's gym. Referral rewards are funded by the
-- referred member's gym's referral_config, so a code belonging to Gym A's member
-- used by someone signing up to Gym B created a Gym-B referral and paid the
-- Gym-A referrer out of Gym B's economy — cross-gym points farming.
--
-- Fix: after resolving both gyms, reject when they differ (CROSS_GYM). Body is
-- reproduced verbatim from 0610's predecessor 0601 (the live definition) with
-- only the new v_referrer_gym declaration + same-gym guard added.

CREATE OR REPLACE FUNCTION public.register_referral(p_code text, p_referred_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code_row         referral_codes;
  v_referred_gym     UUID;
  v_referrer_gym     UUID;
  v_referrer_name    TEXT;
  v_referral_id      UUID;
  v_require_approval BOOLEAN;
BEGIN
  -- SECURITY (0480 FIX 1): callers may only register a referral for THEMSELVES.
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

  -- SECURITY (0610): referrer and referred must be in the SAME gym. Rewards are
  -- funded by the referred member's gym's referral_config, so a code from
  -- another gym must not fund a cross-gym referrer.
  SELECT gym_id INTO v_referrer_gym FROM profiles WHERE id = v_code_row.profile_id;
  IF v_referrer_gym IS NULL OR v_referrer_gym IS DISTINCT FROM v_referred_gym THEN
    RETURN json_build_object('success', false, 'error', 'CROSS_GYM');
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
    -- Award points/rewards to BOTH parties + run milestone checks via the single
    -- writer complete_referral() (flips status itself, no-ops if already done).
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
