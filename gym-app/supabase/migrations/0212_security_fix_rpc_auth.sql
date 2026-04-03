-- =============================================================
-- SECURITY FIX: Add missing authorization checks to RPCs
-- Migration: 0212_security_fix_rpc_auth.sql
--
-- Fixes:
--   1. increment_sms_usage  - was callable by any authenticated user
--   2. notify_wallet_pass_update - was callable for any profile
--   3. generate_referral_code - was callable for other users
--   4. get_profile_preview  - used profiles (RLS) instead of profile_lookup
-- =============================================================

-- ── 1. increment_sms_usage: admin only ──────────────────────

CREATE OR REPLACE FUNCTION public.increment_sms_usage(
  p_gym_id UUID,
  p_direction TEXT,
  p_segments INTEGER DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can increment SMS usage';
  END IF;

  INSERT INTO sms_usage_monthly (gym_id, month, messages_sent, messages_received, segments_sent)
  VALUES (
    p_gym_id, v_month,
    CASE WHEN p_direction = 'sent' THEN 1 ELSE 0 END,
    CASE WHEN p_direction = 'received' THEN 1 ELSE 0 END,
    CASE WHEN p_direction = 'sent' THEN p_segments ELSE 0 END
  )
  ON CONFLICT (gym_id, month) DO UPDATE SET
    messages_sent = sms_usage_monthly.messages_sent + CASE WHEN p_direction = 'sent' THEN 1 ELSE 0 END,
    messages_received = sms_usage_monthly.messages_received + CASE WHEN p_direction = 'received' THEN 1 ELSE 0 END,
    segments_sent = sms_usage_monthly.segments_sent + CASE WHEN p_direction = 'sent' THEN p_segments ELSE 0 END,
    updated_at = NOW();
END;
$$;

-- ── 2. notify_wallet_pass_update: self only or admin ────────

CREATE OR REPLACE FUNCTION public.notify_wallet_pass_update(
  p_profile_id UUID,
  p_reason     TEXT DEFAULT 'punch_card_update'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_profile_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Bump pass data timestamp FIRST -- before any push is sent.
  -- This ensures the webhook can answer "what changed?" correctly
  -- even if the device queries before push-wallet-update finishes.
  UPDATE profiles
  SET pass_data_updated_at = NOW()
  WHERE id = p_profile_id;

  -- Log the update request
  INSERT INTO wallet_pass_update_log (profile_id, reason)
  VALUES (p_profile_id, p_reason);

  -- pg_notify as fallback
  PERFORM pg_notify('wallet_pass_update', json_build_object(
    'profile_id', p_profile_id,
    'reason', p_reason
  )::text);
END;
$$;

-- ── 3. generate_referral_code: self only ────────────────────

CREATE OR REPLACE FUNCTION generate_referral_code(p_profile_id UUID, p_gym_id UUID)
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
  gym_short TEXT;
BEGIN
  IF p_profile_id != auth.uid() THEN
    RAISE EXCEPTION 'Can only generate own referral code';
  END IF;

  -- Get gym short name (first 4 chars uppercased)
  SELECT upper(substr(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 1, 4))
  INTO gym_short FROM gyms WHERE id = p_gym_id;

  -- Generate unique code
  LOOP
    new_code := 'REF-' || COALESCE(gym_short, 'GYM') || '-' || upper(substr(md5(random()::text), 1, 4));
    BEGIN
      INSERT INTO referral_codes (profile_id, gym_id, code)
      VALUES (p_profile_id, p_gym_id, new_code)
      ON CONFLICT (profile_id, gym_id) DO NOTHING;

      IF FOUND THEN
        RETURN new_code;
      ELSE
        -- Already exists for this user+gym, return existing
        SELECT code INTO new_code FROM referral_codes WHERE profile_id = p_profile_id AND gym_id = p_gym_id;
        RETURN new_code;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Code collision, try again
      CONTINUE;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. get_profile_preview: same gym via profile_lookup ─────

CREATE OR REPLACE FUNCTION public.get_profile_preview(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid       UUID;
  my_gym    UUID;
  their_gym UUID;
  result    JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Use profile_lookup (no RLS) instead of profiles to avoid recursion
  SELECT gym_id INTO my_gym FROM profile_lookup WHERE id = uid;
  SELECT gym_id INTO their_gym FROM profile_lookup WHERE id = p_user_id;

  -- Enforce same-gym boundary
  IF my_gym IS NULL OR their_gym IS NULL OR my_gym != their_gym THEN
    RAISE EXCEPTION 'User not in your gym';
  END IF;

  SELECT json_build_object(
    'profile', (
      SELECT json_build_object(
        'id',           p.id,
        'username',     p.username,
        'full_name',    p.full_name,
        'avatar_url',   p.avatar_url,
        'avatar_type',  p.avatar_type,
        'avatar_value', p.avatar_value,
        'created_at',   p.created_at,
        'fitness_level', mo.fitness_level,
        'goal',         mo.primary_goal
      )
      FROM profiles p
      LEFT JOIN member_onboarding mo ON mo.profile_id = p.id
      WHERE p.id = p_user_id
    ),
    'workouts', (
      SELECT COUNT(*)::INT FROM workout_sessions WHERE profile_id = p_user_id
    ),
    'prs', (
      SELECT COUNT(*)::INT FROM personal_records WHERE profile_id = p_user_id
    ),
    'streak', (
      SELECT COALESCE(current_streak_days, 0)
      FROM streak_cache WHERE profile_id = p_user_id
    ),
    'latest_achievement', (
      SELECT achievement_key
      FROM user_achievements
      WHERE profile_id = p_user_id OR user_id = p_user_id
      ORDER BY unlocked_at DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
