-- ============================================================
-- 0370 — Earned rewards (claimable rewards for members)
-- ============================================================
-- Adds a unified system for non-points-purchased rewards that
-- members "earn" via:
--   • birthday (gyms.birthday_reward_id from gym_rewards catalog)
--   • referral milestones (referral_milestones.reward_id)
--   • manual admin grants (future use)
--
-- Earned rewards are inserted in 'pending' status and surfaced on
-- the member Rewards page as claimable. When the member taps
-- Claim, a QR code is generated; an admin scans the QR (or marks
-- redeemed manually) to flip status → 'redeemed'.
--
-- Schema additions:
--   gyms.birthday_reward_id  UUID  — optional reward from catalog
--                                    awarded alongside (or instead of) points
--   earned_rewards           TABLE — claimable reward inbox per member
-- ============================================================

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS birthday_reward_id UUID REFERENCES public.gym_rewards(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.gyms.birthday_reward_id IS
  'Optional gym_rewards FK. When set, process_birthdays() also creates an earned_rewards row claimable in-app.';

-- ============================================================
-- earned_rewards table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.earned_rewards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reward_id     UUID REFERENCES public.gym_rewards(id) ON DELETE SET NULL,
  reward_label  TEXT NOT NULL,
  reward_label_es TEXT,
  reward_emoji  TEXT,
  source        TEXT NOT NULL CHECK (source IN ('birthday','referral_milestone','manual_grant')),
  source_id     UUID,                       -- referral_milestones.id when source='referral_milestone'
  dedup_key     TEXT,                       -- prevents duplicate awards (e.g. birthday_<profile>_<year>)
  qr_code       TEXT,                       -- generated when member claims
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','redeemed','expired')),
  redeemed_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earned_rewards_profile_status
  ON public.earned_rewards(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_earned_rewards_gym_created
  ON public.earned_rewards(gym_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_earned_rewards_qr
  ON public.earned_rewards(qr_code) WHERE qr_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_earned_rewards_dedup
  ON public.earned_rewards(dedup_key) WHERE dedup_key IS NOT NULL;

ALTER TABLE public.earned_rewards ENABLE ROW LEVEL SECURITY;

-- Members can read their own earned rewards
DROP POLICY IF EXISTS earned_rewards_member_select ON public.earned_rewards;
CREATE POLICY earned_rewards_member_select ON public.earned_rewards
  FOR SELECT USING (profile_id = auth.uid());

-- Members can update their own earned rewards (only to set qr_code on claim).
-- Tightened with WITH CHECK so a member can't flip status / change reward_id.
DROP POLICY IF EXISTS earned_rewards_member_update_qr ON public.earned_rewards;
CREATE POLICY earned_rewards_member_update_qr ON public.earned_rewards
  FOR UPDATE USING (profile_id = auth.uid())
  WITH CHECK (
    profile_id = auth.uid()
    AND status = 'pending'
  );

-- Admins of the gym have full read/update
DROP POLICY IF EXISTS earned_rewards_admin_all ON public.earned_rewards;
CREATE POLICY earned_rewards_admin_all ON public.earned_rewards
  FOR ALL
  USING (
    gym_id IN (
      SELECT p.gym_id FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
    )
  );

-- ============================================================
-- award_earned_reward(profile_id, reward_id, source, source_id, dedup_key)
-- Helper called from process_birthdays / referral milestone hook.
-- Idempotent on dedup_key.
-- ============================================================
CREATE OR REPLACE FUNCTION public.award_earned_reward(
  p_profile_id  UUID,
  p_reward_id   UUID,
  p_source      TEXT,
  p_source_id   UUID DEFAULT NULL,
  p_dedup_key   TEXT DEFAULT NULL,
  p_expires_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id  UUID;
  v_label   TEXT;
  v_label_es TEXT;
  v_emoji   TEXT;
  v_id      UUID;
BEGIN
  IF p_reward_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT gr.gym_id, gr.name, gr.name_es, gr.emoji_icon
    INTO v_gym_id, v_label, v_label_es, v_emoji
    FROM public.gym_rewards gr
   WHERE gr.id = p_reward_id;

  IF v_gym_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Idempotent insert keyed by dedup_key
  INSERT INTO public.earned_rewards
    (gym_id, profile_id, reward_id, reward_label, reward_label_es, reward_emoji,
     source, source_id, dedup_key, expires_at)
  VALUES
    (v_gym_id, p_profile_id, p_reward_id, v_label, v_label_es, v_emoji,
     p_source, p_source_id, p_dedup_key, p_expires_at)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_earned_reward(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- claim_earned_reward(p_id) — member generates QR for in-gym redemption
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_earned_reward(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_row    RECORD;
  v_qr     TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.earned_rewards WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Earned reward not found';
  END IF;

  IF v_row.profile_id != v_caller THEN
    RAISE EXCEPTION 'Not your reward';
  END IF;

  IF v_row.status != 'pending' THEN
    RAISE EXCEPTION 'Reward already %', v_row.status;
  END IF;

  -- If already has a qr_code, return it (idempotent)
  IF v_row.qr_code IS NOT NULL THEN
    RETURN json_build_object('id', v_row.id, 'qr_code', v_row.qr_code);
  END IF;

  v_qr := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));

  UPDATE public.earned_rewards
     SET qr_code = v_qr
   WHERE id = p_id;

  RETURN json_build_object('id', p_id, 'qr_code', v_qr);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_earned_reward(UUID) TO authenticated;

-- ============================================================
-- redeem_earned_reward(p_id) — admin marks redeemed
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_earned_reward(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     RECORD;
  v_admin_gym UUID;
  v_role    TEXT;
BEGIN
  SELECT gym_id, role INTO v_admin_gym, v_role
    FROM public.profiles WHERE id = auth.uid();

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_row FROM public.earned_rewards WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Earned reward not found';
  END IF;

  IF v_row.gym_id != v_admin_gym AND v_role != 'super_admin' THEN
    RAISE EXCEPTION 'Wrong gym';
  END IF;

  IF v_row.status != 'pending' THEN
    RAISE EXCEPTION 'Already %', v_row.status;
  END IF;

  UPDATE public.earned_rewards
     SET status = 'redeemed', redeemed_at = NOW()
   WHERE id = p_id;

  RETURN json_build_object('id', p_id, 'status', 'redeemed', 'redeemed_at', NOW());
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_earned_reward(UUID) TO authenticated;

-- ============================================================
-- Patch process_birthdays() to award an earned_reward when
-- birthday_reward_id is configured on the gym.
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_birthdays()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row              RECORD;
  _now              TIMESTAMPTZ := NOW();
  _today            DATE := _now::date;
  _current_year     INT  := EXTRACT(YEAR FROM _today)::int;
  _processed_count  INT  := 0;
  _points_awarded   INT  := 0;
  _rewards_awarded  INT  := 0;
  _gym_enabled      BOOLEAN;
  _gym_points       INT;
  _gym_message      TEXT;
  _gym_name         TEXT;
  _gym_reward_id    UUID;
  _notif_title      TEXT;
  _notif_body       TEXT;
  _dedup_key        TEXT;
  _earned_id        UUID;
BEGIN
  FOR _row IN
    SELECT p.id, p.gym_id, p.full_name, p.preferred_language, p.date_of_birth
      FROM profiles p
     WHERE p.date_of_birth IS NOT NULL
       AND EXTRACT(MONTH FROM p.date_of_birth)::int = EXTRACT(MONTH FROM _today)::int
       AND EXTRACT(DAY   FROM p.date_of_birth)::int = EXTRACT(DAY   FROM _today)::int
       AND (p.birthday_celebrated_year IS NULL OR p.birthday_celebrated_year < _current_year)
       AND p.is_onboarded = true
       AND p.gym_id IS NOT NULL
  LOOP
    SELECT g.birthday_rewards_enabled, g.birthday_reward_points, g.birthday_reward_message,
           g.name, g.birthday_reward_id
      INTO _gym_enabled, _gym_points, _gym_message, _gym_name, _gym_reward_id
      FROM gyms g
     WHERE g.id = _row.gym_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Build notification copy (unchanged from previous version)
    IF _row.preferred_language = 'es' THEN
      _notif_title := '🎉 ¡Feliz cumpleaños!';
      IF _gym_message IS NOT NULL AND length(trim(_gym_message)) > 0 THEN
        _notif_body := _gym_message;
      ELSIF _gym_enabled AND _gym_reward_id IS NOT NULL THEN
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' tiene un regalo especial para ti 🎂';
      ELSIF _gym_enabled AND _gym_points > 0 THEN
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' te regala ' || _gym_points || ' puntos por tu cumpleaños 🎂';
      ELSE
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' te desea un feliz cumpleaños 🎂';
      END IF;
    ELSE
      _notif_title := '🎉 Happy Birthday!';
      IF _gym_message IS NOT NULL AND length(trim(_gym_message)) > 0 THEN
        _notif_body := _gym_message;
      ELSIF _gym_enabled AND _gym_reward_id IS NOT NULL THEN
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' has a special gift for you 🎂';
      ELSIF _gym_enabled AND _gym_points > 0 THEN
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' just gifted you ' || _gym_points || ' points for your birthday 🎂';
      ELSE
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' wishes you a happy birthday 🎂';
      END IF;
    END IF;

    _dedup_key := 'birthday_' || _row.id::text || '_' || _current_year::text;

    -- Points portion (unchanged)
    IF _gym_enabled AND _gym_points > 0 THEN
      INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
      VALUES (_row.id, _row.gym_id, 'birthday_gift', _gym_points,
              'Birthday gift from ' || COALESCE(_gym_name, 'gym'), _now);

      INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
      VALUES (_row.id, _row.gym_id, _gym_points, _gym_points, _now)
      ON CONFLICT (profile_id) DO UPDATE SET
        total_points    = reward_points.total_points    + _gym_points,
        lifetime_points = reward_points.lifetime_points + _gym_points,
        last_updated    = _now;

      _points_awarded := _points_awarded + _gym_points;
    END IF;

    -- Custom reward portion (NEW). Idempotent on dedup_key 'birthday_<profile>_<year>'
    IF _gym_enabled AND _gym_reward_id IS NOT NULL THEN
      _earned_id := public.award_earned_reward(
        p_profile_id => _row.id,
        p_reward_id  => _gym_reward_id,
        p_source     => 'birthday',
        p_source_id  => NULL,
        p_dedup_key  => _dedup_key
      );
      IF _earned_id IS NOT NULL THEN
        _rewards_awarded := _rewards_awarded + 1;
      END IF;
    END IF;

    -- Notification (always fires on a birthday)
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key, created_at)
    VALUES (_row.id, _row.gym_id, 'birthday', _notif_title, _notif_body, _dedup_key, _now)
    ON CONFLICT (dedup_key) DO NOTHING;

    UPDATE profiles
       SET birthday_celebrated_year = _current_year
     WHERE id = _row.id;

    _processed_count := _processed_count + 1;
  END LOOP;

  RETURN json_build_object(
    'processed', _processed_count,
    'points_awarded', _points_awarded,
    'rewards_awarded', _rewards_awarded,
    'date', _today
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_birthdays() TO service_role;

-- ============================================================
-- check_referral_milestones(p_referrer_id)
-- Called by complete_referral after a referral status flips to
-- 'completed'. Awards earned_rewards for any referral_milestones
-- the user has now hit (active milestones only, idempotent).
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_referral_milestones(p_referrer_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id      UUID;
  v_count       INT;
  v_awarded     INT := 0;
  v_milestone   RECORD;
  v_dedup_key   TEXT;
  v_earned_id   UUID;
BEGIN
  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = p_referrer_id;
  IF v_gym_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Count completed referrals by this member at this gym
  SELECT COUNT(*) INTO v_count
    FROM referrals r
   WHERE r.referrer_id = p_referrer_id
     AND r.status = 'completed';

  FOR v_milestone IN
    SELECT id, referral_count, reward_id
      FROM referral_milestones
     WHERE gym_id = v_gym_id
       AND is_active = true
       AND referral_count <= v_count
  LOOP
    v_dedup_key := 'milestone_' || p_referrer_id::text || '_' || v_milestone.id::text;
    v_earned_id := public.award_earned_reward(
      p_profile_id => p_referrer_id,
      p_reward_id  => v_milestone.reward_id,
      p_source     => 'referral_milestone',
      p_source_id  => v_milestone.id,
      p_dedup_key  => v_dedup_key
    );
    IF v_earned_id IS NOT NULL THEN
      v_awarded := v_awarded + 1;
    END IF;
  END LOOP;

  RETURN v_awarded;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_referral_milestones(UUID) TO authenticated, service_role;

-- ============================================================
-- Patch complete_referral() to call check_referral_milestones
-- after marking the referral 'completed'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_referral(p_referral_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref         RECORD;
  v_gym_config  RECORD;
BEGIN
  SELECT * INTO v_ref FROM referrals WHERE id = p_referral_id;
  IF NOT FOUND OR v_ref.status = 'completed' THEN RETURN; END IF;

  UPDATE referrals SET status = 'completed', completed_at = NOW() WHERE id = p_referral_id;

  SELECT
    COALESCE((config->>'referrer_points')::int, 500) AS referrer_points,
    COALESCE((config->>'referred_points')::int, 250) AS referred_points
  INTO v_gym_config
  FROM gym_referral_config
  WHERE gym_id = v_ref.gym_id;

  IF NOT FOUND THEN
    v_gym_config.referrer_points := 500;
    v_gym_config.referred_points := 250;
  END IF;

  IF v_gym_config.referrer_points > 0 THEN
    PERFORM public.add_reward_points(
      v_ref.referrer_id,
      v_ref.gym_id,
      'referral',
      v_gym_config.referrer_points,
      'Referral reward: referred a new member'
    );
  END IF;

  IF v_gym_config.referred_points > 0 AND v_ref.referred_id IS NOT NULL THEN
    PERFORM public.add_reward_points(
      v_ref.referred_id,
      v_ref.gym_id,
      'referral',
      v_gym_config.referred_points,
      'Referral reward: joined via referral'
    );
  END IF;

  UPDATE referrals
  SET points_awarded = COALESCE(v_gym_config.referrer_points, 0) + COALESCE(v_gym_config.referred_points, 0)
  WHERE id = p_referral_id;

  -- NEW: check milestone thresholds and award earned_rewards
  PERFORM public.check_referral_milestones(v_ref.referrer_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
