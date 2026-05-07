-- ============================================================
-- 0351 — Make register_referral actually award points
-- ============================================================
-- Bug: 0314_register_referral_rpc.sql marks the referral as
-- 'completed' via a direct UPDATE statement, but never calls
-- public.complete_referral(). The points-awarding logic lives in
-- complete_referral (added in 0316_fix_referral_points.sql), so
-- referrals were ending in 'completed' status with zero points
-- credited to either the referrer or the referred member.
--
-- Fix: rewrite register_referral so that, when admin approval is
-- not required, it delegates to complete_referral instead of
-- flipping status manually. complete_referral already calls
-- add_reward_points for both parties and stamps points_awarded
-- on the referrals row.
--
-- Body otherwise identical to 0314 — only the auto-complete
-- branch changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_referral(
  p_code        TEXT,
  p_referred_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_row         referral_codes;
  v_referred_gym     UUID;
  v_referrer_name    TEXT;
  v_referral_id      UUID;
  v_require_approval BOOLEAN;
BEGIN
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

  -- Auto-complete the referral if the gym doesn't require admin approval.
  -- complete_referral() does the heavy lifting: it stamps status=completed,
  -- bumps uses_count on the referral_code, awards points to both parties
  -- via add_reward_points, and stamps points_awarded on the referral row.
  SELECT COALESCE((referral_config->>'require_admin_approval')::boolean, false)
  INTO v_require_approval
  FROM gyms
  WHERE id = v_referred_gym;

  IF NOT v_require_approval THEN
    PERFORM public.complete_referral(v_referral_id);
    UPDATE referral_codes
    SET uses_count = COALESCE(uses_count, 0) + 1
    WHERE id = v_code_row.id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'referrer_id', v_code_row.profile_id,
    'referrer_name', v_referrer_name,
    'referral_id', v_referral_id,
    'auto_completed', NOT v_require_approval
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_referral(TEXT, UUID) TO anon, authenticated;

-- Backfill: any referral currently sitting in 'completed' status with
-- points_awarded = 0 (the symptom of the old bug) gets re-processed.
-- complete_referral has an early-return for already-completed rows, so
-- we have to nudge them back to 'pending' first. Only touch rows that
-- the bug actually affected — points_awarded IS NULL or = 0.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM referrals
    WHERE status = 'completed'
      AND COALESCE(points_awarded, 0) = 0
  LOOP
    UPDATE referrals SET status = 'pending', completed_at = NULL WHERE id = r.id;
    PERFORM public.complete_referral(r.id);
  END LOOP;
END $$;
