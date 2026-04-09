-- =============================================================
-- 0265 — Security fixes batch
--
-- 1. Cross-gym privilege escalation in claim_redemption
--    Admin from Gym A could claim redemptions belonging to Gym B.
--    Fix: verify admin's gym_id matches the redemption's gym_id.
--
-- 2. Missing SET search_path = public on 5 SECURITY DEFINER functions:
--    - admin_create_invite_code
--    - complete_referral_deferred
--    - choose_referral_reward
--    - claim_invite_code
--    - add_reward_points_checked
--
-- 3. Revoke execute on complete_referral_deferred from public
--    (internal function, should only be callable by other DB functions)
--
-- 4. Fix get_team_leaderboard referencing non-existent columns
--    display_name and avatar_url on profile_lookup (which only has
--    id, gym_id, role). Join profiles instead.
--
-- 5. Fix get_gym_points missing SET search_path = public
-- =============================================================


-- ── 1. claim_redemption — add gym boundary check ─────────────

CREATE OR REPLACE FUNCTION public.claim_redemption(
  p_redemption_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id    UUID;
  v_admin_role  TEXT;
  v_admin_gym   UUID;
  v_redemption  RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is admin or trainer and get their gym
  SELECT role, gym_id INTO v_admin_role, v_admin_gym FROM profiles WHERE id = v_admin_id;
  IF v_admin_role NOT IN ('admin', 'super_admin', 'trainer') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Get the redemption
  SELECT * INTO v_redemption
    FROM reward_redemptions
   WHERE id = p_redemption_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;

  -- Gym boundary check: admin can only claim redemptions from their own gym
  IF v_redemption.gym_id != v_admin_gym THEN
    RAISE EXCEPTION 'Redemption does not belong to your gym';
  END IF;

  IF v_redemption.status = 'claimed' THEN
    RAISE EXCEPTION 'Already claimed';
  END IF;

  IF v_redemption.status = 'cancelled' THEN
    RAISE EXCEPTION 'Redemption was cancelled';
  END IF;

  -- Now deduct points
  UPDATE reward_points
  SET total_points = total_points - v_redemption.points_spent,
      last_updated = NOW()
  WHERE profile_id = v_redemption.profile_id;

  -- Log the deduction
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (v_redemption.profile_id, v_redemption.gym_id, 'redemption',
    -v_redemption.points_spent, 'Redeemed: ' || v_redemption.reward_name, NOW());

  -- Mark as claimed
  UPDATE reward_redemptions
  SET status = 'claimed', claimed_at = NOW()
  WHERE id = p_redemption_id;

  RETURN json_build_object(
    'success', true,
    'redemption_id', p_redemption_id,
    'points_deducted', v_redemption.points_spent
  );
END;
$$;


-- ── 2a. admin_create_invite_code — add SET search_path ───────

CREATE OR REPLACE FUNCTION public.admin_create_invite_code(
  p_gym_id            UUID,
  p_member_name       TEXT,
  p_phone             TEXT DEFAULT NULL,
  p_email             TEXT DEFAULT NULL,
  p_role              TEXT DEFAULT 'member',
  p_referral_code_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_id UUID;
  v_expires TIMESTAMPTZ;
  v_attempts INT := 0;
BEGIN
  -- Admin check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  -- Force member role (security)
  IF p_role != 'member' AND p_role != 'trainer' THEN
    p_role := 'member';
  END IF;

  v_expires := now() + interval '30 days';

  -- Generate unique code with retry
  LOOP
    v_code := public.generate_invite_code();
    v_attempts := v_attempts + 1;

    BEGIN
      INSERT INTO gym_invites (gym_id, created_by, invite_code, member_name, phone, email, role, expires_at, referral_code_id)
      VALUES (p_gym_id, auth.uid(), v_code, p_member_name, p_phone, p_email, p_role, v_expires, p_referral_code_id)
      RETURNING id INTO v_id;

      RETURN jsonb_build_object(
        'id', v_id,
        'invite_code', v_code,
        'member_name', p_member_name,
        'expires_at', v_expires,
        'referral_code_id', p_referral_code_id
      );
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 10 THEN
        RAISE EXCEPTION 'Failed to generate unique invite code after 10 attempts';
      END IF;
    END;
  END LOOP;
END;
$$;


-- ── 2b. complete_referral_deferred — add SET search_path ─────

CREATE OR REPLACE FUNCTION public.complete_referral_deferred(p_referral_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref RECORD;
  gym_config JSONB;
  monthly_cap INTEGER;
  referrer_monthly_count INTEGER;
  referred_account_age INTERVAL;
  v_deadline TIMESTAMPTZ;
  v_referrer_reward_id UUID;
  v_referred_reward_id UUID;
  v_choice_days INT;
BEGIN
  -- Get the referral (must be pending)
  SELECT * INTO ref FROM referrals WHERE id = p_referral_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Referral not found or not pending');
  END IF;

  -- Block self-referral
  IF ref.referrer_id = ref.referred_id THEN
    UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
    RETURN jsonb_build_object('error', 'Self-referral blocked');
  END IF;

  -- Block circular referrals
  IF EXISTS (
    SELECT 1 FROM referrals
    WHERE referrer_id = ref.referred_id AND referred_id = ref.referrer_id
      AND gym_id = ref.gym_id AND status = 'completed'
  ) THEN
    UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
    RETURN jsonb_build_object('error', 'Circular referral blocked');
  END IF;

  -- Check account age
  SELECT (now() - created_at) INTO referred_account_age
  FROM profiles WHERE id = ref.referred_id;
  IF referred_account_age < interval '5 minutes' THEN
    RETURN jsonb_build_object('error', 'Account too new');
  END IF;

  -- Get gym config
  SELECT referral_config INTO gym_config FROM gyms WHERE id = ref.gym_id;
  IF gym_config IS NULL OR NOT (gym_config->>'enabled')::boolean THEN
    RETURN jsonb_build_object('error', 'Referral program not enabled');
  END IF;

  -- Monthly cap
  monthly_cap := (gym_config->>'max_referrals_per_month')::integer;
  IF monthly_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO referrer_monthly_count
    FROM referrals
    WHERE referrer_id = ref.referrer_id AND gym_id = ref.gym_id
      AND status = 'completed' AND completed_at >= date_trunc('month', now());
    IF referrer_monthly_count >= monthly_cap THEN
      UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
      RETURN jsonb_build_object('error', 'Monthly cap reached');
    END IF;
  END IF;

  -- Check no existing rewards for this referred user
  IF EXISTS (
    SELECT 1 FROM referral_rewards
    WHERE referral_id IN (
      SELECT id FROM referrals WHERE referred_id = ref.referred_id AND gym_id = ref.gym_id
    )
  ) THEN
    UPDATE referrals SET status = 'rejected' WHERE id = p_referral_id;
    RETURN jsonb_build_object('error', 'Rewards already granted');
  END IF;

  -- Calculate deadline
  v_choice_days := COALESCE((gym_config->>'reward_choice_days')::int, 7);
  v_deadline := now() + (v_choice_days || ' days')::interval;

  -- Mark referral completed
  UPDATE referrals SET status = 'completed', completed_at = now() WHERE id = p_referral_id;

  -- Increment uses count
  IF ref.referral_code_id IS NOT NULL THEN
    UPDATE referral_codes SET uses_count = uses_count + 1 WHERE id = ref.referral_code_id;
  END IF;

  -- Insert pending reward for referrer
  INSERT INTO referral_rewards (referral_id, profile_id, gym_id, reward_type, reward_value, choice_status, choice_deadline)
  VALUES (p_referral_id, ref.referrer_id, ref.gym_id, 'pending_choice', '{}', 'pending', v_deadline)
  RETURNING id INTO v_referrer_reward_id;

  -- Insert pending reward for referred
  INSERT INTO referral_rewards (referral_id, profile_id, gym_id, reward_type, reward_value, choice_status, choice_deadline)
  VALUES (p_referral_id, ref.referred_id, ref.gym_id, 'pending_choice', '{}', 'pending', v_deadline)
  RETURNING id INTO v_referred_reward_id;

  -- Notify referrer
  INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key)
  VALUES (
    ref.referrer_id, ref.gym_id, 'friend_activity',
    'Your friend joined!',
    'Pick your referral reward',
    jsonb_build_object('action', 'choose_referral_reward', 'reward_id', v_referrer_reward_id),
    'ref-choice-' || p_referral_id || '-' || ref.referrer_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'referrer_reward_id', v_referrer_reward_id,
    'referred_reward_id', v_referred_reward_id
  );
END;
$$;


-- ── 2c. choose_referral_reward — add SET search_path ─────────

CREATE OR REPLACE FUNCTION public.choose_referral_reward(
  p_reward_id      UUID,
  p_gym_reward_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward RECORD;
  v_gym_reward RECORD;
BEGIN
  -- Must be the reward owner
  SELECT * INTO v_reward FROM referral_rewards
  WHERE id = p_reward_id AND profile_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Reward not found');
  END IF;

  IF v_reward.choice_status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Reward already chosen');
  END IF;

  -- Validate gym reward exists and is active
  SELECT * INTO v_gym_reward FROM gym_rewards
  WHERE id = p_gym_reward_id AND gym_id = v_reward.gym_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid reward option');
  END IF;

  -- Update with choice
  UPDATE referral_rewards
  SET reward_type = v_gym_reward.reward_type,
      reward_value = jsonb_build_object(
        'gym_reward_id', v_gym_reward.id,
        'name', v_gym_reward.name,
        'emoji', v_gym_reward.emoji_icon,
        'type', v_gym_reward.reward_type,
        'points', v_gym_reward.cost_points
      ),
      choice_status = 'chosen',
      chosen_at = now(),
      gym_reward_id = v_gym_reward.id
  WHERE id = p_reward_id;

  -- If reward is points-based, credit the points
  IF v_gym_reward.reward_type = 'points' OR v_gym_reward.cost_points > 0 THEN
    PERFORM public.add_reward_points(
      auth.uid(),
      v_reward.gym_id,
      'referral',
      v_gym_reward.cost_points,
      'Referral reward: ' || v_gym_reward.name
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reward_name', v_gym_reward.name,
    'reward_type', v_gym_reward.reward_type
  );
END;
$$;


-- ── 2d. claim_invite_code — add SET search_path ──────────────

CREATE OR REPLACE FUNCTION public.claim_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite RECORD;
  v_uid UUID;
  v_code TEXT;
  v_existing_gym UUID;
  v_referrer_id UUID;
  v_referral_id UUID;
  v_deferred_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Normalize code
  v_code := upper(trim(replace(p_invite_code, '-', '')));

  -- Lookup invite
  SELECT * INTO v_invite FROM gym_invites
  WHERE invite_code = v_code OR upper(trim(replace(invite_code, '-', ''))) = v_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
  END IF;

  IF v_invite.used_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_USED');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPIRED');
  END IF;

  -- Check if user is already in a different gym
  SELECT gym_id INTO v_existing_gym FROM profiles WHERE id = v_uid;
  IF v_existing_gym IS NOT NULL AND v_existing_gym != v_invite.gym_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  -- Mark invite as used
  UPDATE gym_invites SET used_by = v_uid, used_at = now() WHERE id = v_invite.id;

  -- Update profile — always force role to 'member' (security fix 0198)
  UPDATE profiles
  SET gym_id = v_invite.gym_id,
      role = 'member',
      membership_status = 'active',
      full_name = COALESCE(NULLIF(full_name, ''), v_invite.member_name, full_name)
  WHERE id = v_uid;

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
        v_deferred_result := public.complete_referral_deferred(v_referral_id);
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


-- ── 2e. add_reward_points_checked — add SET search_path ──────

CREATE OR REPLACE FUNCTION public.add_reward_points_checked(
  p_user_id     UUID,
  p_gym_id      UUID,
  p_action      TEXT,
  p_points      INT,
  p_description TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_checkin_points TIMESTAMPTZ;
BEGIN
  -- For check_in actions, enforce 24-hour limit
  IF p_action = 'check_in' THEN
    SELECT MAX(created_at) INTO v_last_checkin_points
    FROM reward_points_log
    WHERE profile_id = p_user_id
      AND action = 'check_in'
      AND created_at > now() - interval '24 hours';

    IF v_last_checkin_points IS NOT NULL THEN
      -- Already awarded check-in points in last 24h, skip
      RETURN 0;
    END IF;
  END IF;

  -- Delegate to existing add_reward_points
  RETURN add_reward_points(p_user_id, p_gym_id, p_action, p_points, p_description);
END;
$$;


-- ── 3. Revoke execute on complete_referral_deferred from public ──

REVOKE EXECUTE ON FUNCTION public.complete_referral_deferred(UUID) FROM authenticated, anon, public;


-- ── 4. Fix get_team_leaderboard — join profiles instead of profile_lookup ──

CREATE OR REPLACE FUNCTION public.get_team_leaderboard(p_challenge_id UUID)
RETURNS TABLE (
  team_id      UUID,
  team_name    TEXT,
  captain_id   UUID,
  team_score   NUMERIC,
  member_count BIGINT,
  members      JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is in the same gym as the challenge
  IF NOT EXISTS (
    SELECT 1 FROM challenges c
    WHERE c.id = p_challenge_id
      AND c.gym_id = current_gym_id()
  ) THEN
    RAISE EXCEPTION 'Challenge not found in your gym';
  END IF;

  RETURN QUERY
  SELECT
    ct.id                                          AS team_id,
    ct.name                                        AS team_name,
    ct.captain_id                                  AS captain_id,
    COALESCE(SUM(cp.score), 0)                     AS team_score,
    COUNT(cp.id)                                   AS member_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'profile_id', cp.profile_id,
          'display_name', p.full_name,
          'avatar_url', p.avatar_url,
          'score', cp.score
        )
        ORDER BY cp.score DESC
      ) FILTER (WHERE cp.id IS NOT NULL),
      '[]'::jsonb
    )                                              AS members
  FROM challenge_teams ct
  LEFT JOIN challenge_participants cp ON cp.team_id = ct.id
  LEFT JOIN profiles p ON p.id = cp.profile_id
  WHERE ct.challenge_id = p_challenge_id
  GROUP BY ct.id, ct.name, ct.captain_id
  ORDER BY team_score DESC;
END;
$$;


-- ── 5. Fix get_gym_points — add SET search_path ──────────────

CREATE OR REPLACE FUNCTION public.get_gym_points(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  cfg RECORD;
BEGIN
  SELECT * INTO cfg FROM gym_points_config WHERE gym_id = p_gym_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'workout_base', 50,
      'pr_hit', 20,
      'pr_max_per_session', 5,
      'check_in', 20,
      'first_weekly', 25,
      'streak_7', 200,
      'streak_30', 1000
    );
  END IF;
  RETURN jsonb_build_object(
    'workout_base', cfg.workout_base,
    'pr_hit', cfg.pr_hit,
    'pr_max_per_session', cfg.pr_max_per_session,
    'check_in', cfg.check_in,
    'first_weekly', cfg.first_weekly,
    'streak_7', cfg.streak_7,
    'streak_30', cfg.streak_30
  );
END;
$$;


-- ── Reload PostgREST schema cache ────────────────────────────
NOTIFY pgrst, 'reload schema';
