-- ============================================================
-- 0253 — Referral reward choice system
--        Both referrer and referred get to pick their reward
-- ============================================================

-- ── 1. Link invites to referrals ────────────────────────
ALTER TABLE gym_invites
  ADD COLUMN IF NOT EXISTS referral_code_id UUID REFERENCES referral_codes(id);

CREATE INDEX IF NOT EXISTS idx_gym_invites_referral_code
  ON gym_invites(referral_code_id) WHERE referral_code_id IS NOT NULL;

-- ── 2. Reward choice columns on referral_rewards ────────
ALTER TABLE referral_rewards
  ADD COLUMN IF NOT EXISTS choice_status TEXT DEFAULT 'auto_assigned',
  ADD COLUMN IF NOT EXISTS choice_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chosen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gym_reward_id UUID;

-- Add check constraint (drop old if exists to be safe)
DO $$
BEGIN
  ALTER TABLE referral_rewards DROP CONSTRAINT IF EXISTS referral_rewards_choice_status_check;
  ALTER TABLE referral_rewards ADD CONSTRAINT referral_rewards_choice_status_check
    CHECK (choice_status IN ('pending', 'chosen', 'auto_assigned'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Update reward_type constraint to allow 'pending_choice'
ALTER TABLE referral_rewards DROP CONSTRAINT IF EXISTS referral_rewards_reward_type_check;
ALTER TABLE referral_rewards ADD CONSTRAINT referral_rewards_reward_type_check
  CHECK (reward_type IN ('points', 'discount', 'free_month', 'custom', 'pending_choice'));

-- Backfill existing rewards
UPDATE referral_rewards SET choice_status = 'auto_assigned' WHERE choice_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_referral_rewards_pending_choice
  ON referral_rewards(choice_status, choice_deadline)
  WHERE choice_status = 'pending';

-- ── 3. Update admin_create_invite_code to accept referral ──

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

-- ── 4. complete_referral_deferred — creates pending reward choices ──

CREATE OR REPLACE FUNCTION public.complete_referral_deferred(p_referral_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

-- ── 5. choose_referral_reward — member picks their reward ──

CREATE OR REPLACE FUNCTION public.choose_referral_reward(
  p_reward_id      UUID,
  p_gym_reward_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

-- ── 6. Update claim_invite_code to auto-create referral ──

CREATE OR REPLACE FUNCTION public.claim_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
