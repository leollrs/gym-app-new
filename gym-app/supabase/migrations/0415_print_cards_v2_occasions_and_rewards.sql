-- =============================================================
-- 0415 — Print cards v2: new occasion vocabulary + reward attachment
--
-- Locks in the final 11-occasion set after the retention design
-- review:
--
--   welcome           (kept)   first completed workout
--   habit_9in6        NEW      9 workouts in trailing 42 days
--   tenure_30         NEW      30 days at the gym
--   tenure_90         NEW      90 days — past the churn cliff
--   tenure_365        NEW      1 year anniversary
--   milestone_100     (kept)   100 lifetime workouts
--   milestone_250     NEW      250 lifetime workouts
--   milestone_500     (kept)   500 lifetime workouts (folded card)
--   returning         (kept)   came back after 21+ days silent
--   birthday          (kept)   DOB within next 3 days
--   custom            (kept)   owner-authored
--
-- Dropped from rotation (enum values kept for historical rows):
--   milestone_25  — too low, devalued the system
--   first_pr      — noisy on new accounts (every lift is a PR)
--
-- Also adds reward-attachment columns: each card optionally carries
-- a QR + label that redeems a tangible reward (cup, smoothie, free
-- month) at the front desk. Owner approves the attachment per card
-- in the admin UI; the existing earned_rewards + claim_redemption
-- pipeline does the redemption work.
--
-- Per-gym tunables live in `gym_card_settings` so each owner can
-- ease/tighten thresholds without code changes.
-- =============================================================

-- ── 1. New enum values ─────────────────────────────────────
-- Note: Postgres 12+ permits ADD VALUE inside a transaction as
-- long as the new value isn't *referenced at execution time* in
-- the same transaction. CREATE FUNCTION below contains string
-- literals like 'habit_9in6'::card_occasion in its body — those
-- are evaluated when the cron RUNS, not at function creation,
-- so we're safe to put everything in one migration.
ALTER TYPE card_occasion ADD VALUE IF NOT EXISTS 'habit_9in6';
ALTER TYPE card_occasion ADD VALUE IF NOT EXISTS 'tenure_30';
ALTER TYPE card_occasion ADD VALUE IF NOT EXISTS 'tenure_90';
ALTER TYPE card_occasion ADD VALUE IF NOT EXISTS 'tenure_365';
ALTER TYPE card_occasion ADD VALUE IF NOT EXISTS 'milestone_250';

-- ── 2. Reward attachment columns on print_cards ────────────
ALTER TABLE print_cards
  ADD COLUMN IF NOT EXISTS reward_id        UUID REFERENCES earned_rewards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reward_qr_code   TEXT,
  ADD COLUMN IF NOT EXISTS reward_label     TEXT;

COMMENT ON COLUMN print_cards.reward_id IS
  'Optional reward linked to this card. When set, the printed card includes a QR (reward_qr_code) and label (reward_label) the member can present to the front desk for redemption.';

CREATE INDEX IF NOT EXISTS idx_print_cards_reward
  ON print_cards (reward_id)
  WHERE reward_id IS NOT NULL;

-- ── 3. Per-gym card settings ───────────────────────────────
-- Owners tune thresholds + define which occasions get a default
-- reward attached. The default just pre-fills the admin's "attach
-- reward?" dropdown; explicit admin approval is always required.
CREATE TABLE IF NOT EXISTS gym_card_settings (
  gym_id                    UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
  -- JSONB shape: { "habit_9in6": "cup", "tenure_90": "smoothie", ... }
  -- Values are short string keys the admin UI maps to actual reward
  -- definitions (e.g. "cup" → an earned_rewards template).
  default_rewards           JSONB NOT NULL DEFAULT '{}'::JSONB,
  habit_window_days         INT  NOT NULL DEFAULT 42,
  habit_target_count        INT  NOT NULL DEFAULT 9,
  habit_dedup_days          INT  NOT NULL DEFAULT 90,
  returning_silence_days    INT  NOT NULL DEFAULT 21,
  birthday_lookahead_days   INT  NOT NULL DEFAULT 3,
  enable_welcome            BOOLEAN NOT NULL DEFAULT TRUE,
  enable_habit_9in6         BOOLEAN NOT NULL DEFAULT TRUE,
  enable_tenure_30          BOOLEAN NOT NULL DEFAULT TRUE,
  enable_tenure_90          BOOLEAN NOT NULL DEFAULT TRUE,
  enable_tenure_365         BOOLEAN NOT NULL DEFAULT TRUE,
  enable_milestone_100      BOOLEAN NOT NULL DEFAULT TRUE,
  enable_milestone_250      BOOLEAN NOT NULL DEFAULT TRUE,
  enable_milestone_500      BOOLEAN NOT NULL DEFAULT TRUE,
  enable_returning          BOOLEAN NOT NULL DEFAULT TRUE,
  enable_birthday           BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gym_card_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gym_card_settings_admin_all" ON gym_card_settings
  FOR ALL TO authenticated
  USING (
    gym_id IN (SELECT gym_id FROM profiles
               WHERE id = auth.uid()
                 AND role IN ('admin', 'super_admin'))
  )
  WITH CHECK (
    gym_id IN (SELECT gym_id FROM profiles
               WHERE id = auth.uid()
                 AND role IN ('admin', 'super_admin'))
  );

-- Helper: get effective settings (row if exists, defaults otherwise)
CREATE OR REPLACE FUNCTION public.get_gym_card_settings(p_gym_id UUID)
RETURNS gym_card_settings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r gym_card_settings;
BEGIN
  SELECT * INTO r FROM gym_card_settings WHERE gym_id = p_gym_id;
  IF NOT FOUND THEN
    r.gym_id := p_gym_id;
    r.default_rewards := '{}'::JSONB;
    r.habit_window_days := 42;
    r.habit_target_count := 9;
    r.habit_dedup_days := 90;
    r.returning_silence_days := 21;
    r.birthday_lookahead_days := 3;
    r.enable_welcome := TRUE;
    r.enable_habit_9in6 := TRUE;
    r.enable_tenure_30 := TRUE;
    r.enable_tenure_90 := TRUE;
    r.enable_tenure_365 := TRUE;
    r.enable_milestone_100 := TRUE;
    r.enable_milestone_250 := TRUE;
    r.enable_milestone_500 := TRUE;
    r.enable_returning := TRUE;
    r.enable_birthday := TRUE;
  END IF;
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_gym_card_settings(UUID) TO authenticated;

-- ── 4. Rewrite the daily generator with the new occasion set ──
-- Returns counts per category so the cron log shows what happened.
-- All triggers are dedup'd via the existing
-- idx_print_cards_pending_per_occasion (one pending card per
-- (profile, occasion)) EXCEPT habit_9in6 which uses a separate
-- time-window dedup (last 90 days of any-status habit card).
--
-- The DROP is required because the 0399 version returned 4 columns
-- and this one returns 7 — Postgres won't let CREATE OR REPLACE
-- change a function's return type. Existing cron schedule reattaches
-- automatically since it's pinned to the function name, not the OID.
DROP FUNCTION IF EXISTS generate_print_cards_daily();

CREATE OR REPLACE FUNCTION generate_print_cards_daily()
RETURNS TABLE (
  welcome_cards      INTEGER,
  habit_cards        INTEGER,
  tenure_cards       INTEGER,
  milestone_cards    INTEGER,
  returning_cards    INTEGER,
  birthday_cards     INTEGER,
  cards_expired      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_welcome   INTEGER := 0;
  v_habit     INTEGER := 0;
  v_tenure    INTEGER := 0;
  v_milestone INTEGER := 0;
  v_returning INTEGER := 0;
  v_birthday  INTEGER := 0;
  v_expired   INTEGER := 0;
BEGIN
  -- Expire stale pending cards
  UPDATE print_cards SET status = 'expired'
   WHERE status = 'pending' AND expires_at <= NOW();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- ── welcome: first ever completed workout in last 24h ──
  WITH first_workouts AS (
    SELECT ws.profile_id, p.gym_id
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    LEFT JOIN gym_card_settings s ON s.gym_id = p.gym_id
    WHERE ws.status = 'completed'
      AND p.role = 'member' AND p.membership_status = 'active'
      AND COALESCE(s.enable_welcome, TRUE) = TRUE
    GROUP BY ws.profile_id, p.gym_id
    HAVING COUNT(*) = 1
       AND MIN(ws.completed_at) >= NOW() - INTERVAL '24 hours'
  ),
  welcome_ins AS (
    SELECT enqueue_print_card(
      fw.profile_id, fw.gym_id, 'welcome'::card_occasion,
      'You showed up.',
      'That was the hard part.',
      '{}'::JSONB
    ) AS card_id FROM first_workouts fw
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_welcome FROM welcome_ins;

  -- ── habit_9in6: 9 completed sessions in trailing 42 days ──
  -- Dedup against ANY status (pending/printed/delivered) in the last
  -- 90 days so members don't repeatedly get this card every time their
  -- rolling window crosses the threshold.
  WITH eligible AS (
    SELECT
      ws.profile_id,
      p.gym_id,
      COUNT(*)::INT AS recent_count,
      COALESCE(s.habit_target_count, 9)  AS target,
      COALESCE(s.habit_dedup_days, 90)   AS dedup_days
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    LEFT JOIN gym_card_settings s ON s.gym_id = p.gym_id
    WHERE ws.status = 'completed'
      AND ws.completed_at >= NOW() - (COALESCE(s.habit_window_days, 42) || ' days')::INTERVAL
      AND p.role = 'member' AND p.membership_status = 'active'
      AND COALESCE(s.enable_habit_9in6, TRUE) = TRUE
    GROUP BY ws.profile_id, p.gym_id, s.habit_target_count, s.habit_dedup_days
  ),
  habit_ready AS (
    SELECT e.profile_id, e.gym_id, e.recent_count
    FROM eligible e
    WHERE e.recent_count >= e.target
      AND NOT EXISTS (
        SELECT 1 FROM print_cards pc
        WHERE pc.profile_id = e.profile_id
          AND pc.occasion = 'habit_9in6'::card_occasion
          AND pc.created_at >= NOW() - (e.dedup_days || ' days')::INTERVAL
      )
  ),
  habit_ins AS (
    SELECT enqueue_print_card(
      hr.profile_id, hr.gym_id, 'habit_9in6'::card_occasion,
      'You''re building the habit.',
      'Nine sessions in six weeks — keep going.',
      jsonb_build_object('window_count', hr.recent_count)
    ) AS card_id FROM habit_ready hr
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_habit FROM habit_ins;

  -- ── tenure_30 / tenure_90 / tenure_365 ──
  -- Fires on the exact day-N anniversary of profile.created_at.
  WITH tenure_hits AS (
    SELECT
      p.id AS profile_id,
      p.gym_id,
      (CURRENT_DATE - p.created_at::DATE)::INT AS days_in,
      CASE (CURRENT_DATE - p.created_at::DATE)::INT
        WHEN 30  THEN 'tenure_30'
        WHEN 90  THEN 'tenure_90'
        WHEN 365 THEN 'tenure_365'
      END AS occ
    FROM profiles p
    LEFT JOIN gym_card_settings s ON s.gym_id = p.gym_id
    WHERE p.role = 'member' AND p.membership_status = 'active'
      AND (CURRENT_DATE - p.created_at::DATE)::INT IN (30, 90, 365)
      AND CASE (CURRENT_DATE - p.created_at::DATE)::INT
        WHEN 30  THEN COALESCE(s.enable_tenure_30, TRUE)
        WHEN 90  THEN COALESCE(s.enable_tenure_90, TRUE)
        WHEN 365 THEN COALESCE(s.enable_tenure_365, TRUE)
      END = TRUE
  ),
  tenure_ins AS (
    SELECT enqueue_print_card(
      th.profile_id, th.gym_id, th.occ::card_occasion,
      CASE th.occ
        WHEN 'tenure_30'  THEN 'One month in.'
        WHEN 'tenure_90'  THEN 'Ninety days strong.'
        WHEN 'tenure_365' THEN 'One year here.'
      END,
      CASE th.occ
        WHEN 'tenure_30'  THEN 'Past the trial-period brain — you''re a regular now.'
        WHEN 'tenure_90'  THEN 'You''re past the cliff. This is your gym.'
        WHEN 'tenure_365' THEN 'Twelve months of showing up. Few do this.'
      END,
      jsonb_build_object('tenure_days', th.days_in)
    ) AS card_id FROM tenure_hits th
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_tenure FROM tenure_ins;

  -- ── milestone_100 / 250 / 500 crossings in last 24h ──
  -- Detection: compare today's count vs the count 24h ago, see if a
  -- threshold sits between them.
  WITH session_counts AS (
    SELECT
      ws.profile_id, p.gym_id,
      COUNT(*) FILTER (WHERE ws.completed_at <= NOW() - INTERVAL '24 hours') AS prior_count,
      COUNT(*) AS current_count
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.status = 'completed'
      AND p.role = 'member' AND p.membership_status = 'active'
    GROUP BY ws.profile_id, p.gym_id
  ),
  crossings AS (
    SELECT
      sc.profile_id, sc.gym_id,
      s_settings.enable_milestone_100, s_settings.enable_milestone_250, s_settings.enable_milestone_500,
      CASE
        WHEN sc.prior_count < 100 AND sc.current_count >= 100 THEN 100
        WHEN sc.prior_count < 250 AND sc.current_count >= 250 THEN 250
        WHEN sc.prior_count < 500 AND sc.current_count >= 500 THEN 500
      END AS milestone_n
    FROM session_counts sc
    LEFT JOIN gym_card_settings s_settings ON s_settings.gym_id = sc.gym_id
  ),
  crossings_enabled AS (
    SELECT * FROM crossings c
    WHERE c.milestone_n IS NOT NULL
      AND CASE c.milestone_n
        WHEN 100 THEN COALESCE(c.enable_milestone_100, TRUE)
        WHEN 250 THEN COALESCE(c.enable_milestone_250, TRUE)
        WHEN 500 THEN COALESCE(c.enable_milestone_500, TRUE)
      END = TRUE
  ),
  milestone_ins AS (
    SELECT enqueue_print_card(
      c.profile_id, c.gym_id,
      CASE c.milestone_n
        WHEN 100 THEN 'milestone_100'
        WHEN 250 THEN 'milestone_250'
        WHEN 500 THEN 'milestone_500'
      END::card_occasion,
      (c.milestone_n || ' workouts logged'),
      CASE c.milestone_n
        WHEN 100 THEN 'Triple digits. The work shows.'
        WHEN 250 THEN 'Quarter-thousand sessions. Rare company.'
        WHEN 500 THEN 'Five hundred. We''re honored you train here.'
      END,
      jsonb_build_object('milestone_n', c.milestone_n)
    ) AS card_id FROM crossings_enabled c
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_milestone FROM milestone_ins;

  -- ── returning: came back after N silent days ──
  WITH ranked_sessions AS (
    SELECT
      ws.profile_id, p.gym_id, ws.completed_at,
      COALESCE(s.returning_silence_days, 21) AS silence_threshold,
      COALESCE(s.enable_returning, TRUE)     AS enable_returning,
      ROW_NUMBER() OVER (PARTITION BY ws.profile_id ORDER BY ws.completed_at DESC) AS rn
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    LEFT JOIN gym_card_settings s ON s.gym_id = p.gym_id
    WHERE ws.status = 'completed'
      AND p.role = 'member' AND p.membership_status = 'active'
  ),
  per_member AS (
    SELECT
      profile_id, gym_id, silence_threshold, enable_returning,
      MAX(completed_at) FILTER (WHERE rn = 1) AS last_completed,
      MAX(completed_at) FILTER (WHERE rn = 2) AS prev_completed
    FROM ranked_sessions WHERE rn <= 2
    GROUP BY profile_id, gym_id, silence_threshold, enable_returning
  ),
  returnees AS (
    SELECT
      pm.profile_id, pm.gym_id,
      (pm.last_completed::DATE - pm.prev_completed::DATE)::INT AS absence_days
    FROM per_member pm
    WHERE pm.enable_returning = TRUE
      AND pm.last_completed >= NOW() - INTERVAL '24 hours'
      AND pm.prev_completed IS NOT NULL
      AND pm.last_completed - pm.prev_completed >= (pm.silence_threshold || ' days')::INTERVAL
  ),
  returning_ins AS (
    SELECT enqueue_print_card(
      r.profile_id, r.gym_id, 'returning'::card_occasion,
      'Good to see you back.',
      CONCAT('It''s been ', r.absence_days, ' days. No pressure — just glad you''re here.'),
      jsonb_build_object('absence_days', r.absence_days)
    ) AS card_id FROM returnees r
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_returning FROM returning_ins;

  -- ── birthday: DOB within next N days ──
  WITH upcoming_birthdays AS (
    SELECT
      p.id AS profile_id, p.gym_id,
      MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                EXTRACT(MONTH FROM p.date_of_birth)::INT,
                EXTRACT(DAY FROM p.date_of_birth)::INT) AS bd_this_year,
      COALESCE(s.birthday_lookahead_days, 3) AS lookahead
    FROM profiles p
    LEFT JOIN gym_card_settings s ON s.gym_id = p.gym_id
    WHERE p.role = 'member' AND p.membership_status = 'active'
      AND p.date_of_birth IS NOT NULL
      AND COALESCE(s.enable_birthday, TRUE) = TRUE
  ),
  birthday_ready AS (
    SELECT * FROM upcoming_birthdays ub
    WHERE ub.bd_this_year >= CURRENT_DATE
      AND ub.bd_this_year - CURRENT_DATE BETWEEN 0 AND ub.lookahead
  ),
  birthday_ins AS (
    SELECT enqueue_print_card(
      br.profile_id, br.gym_id, 'birthday'::card_occasion,
      'Happy birthday.',
      'On the house today. Take it easy.',
      jsonb_build_object('birthday_date', br.bd_this_year)
    ) AS card_id FROM birthday_ready br
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_birthday FROM birthday_ins;

  RETURN QUERY SELECT v_welcome, v_habit, v_tenure, v_milestone,
                       v_returning, v_birthday, v_expired;
END;
$$;

REVOKE EXECUTE ON FUNCTION generate_print_cards_daily() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_print_cards_daily() TO service_role;

-- ── 5. Reward attachment RPC (admin approval workflow) ──
-- Admin reviews a pending card → clicks "Attach reward" → picks a
-- reward template → this RPC creates an earned_rewards row tied to
-- the member + links it back to the card so the printed QR resolves
-- to a real redemption. The QR + label denormalized onto the card
-- row so PrintCardsView doesn't need to join at print time.
CREATE OR REPLACE FUNCTION public.attach_reward_to_print_card(
  p_card_id        UUID,
  p_reward_label   TEXT,
  p_reward_emoji   TEXT DEFAULT NULL,
  p_expires_in_days INT DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card       print_cards%ROWTYPE;
  v_caller_id  UUID;
  v_caller_role TEXT;
  v_reward_id  UUID;
  v_qr_code    TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can attach rewards to print cards';
  END IF;

  SELECT * INTO v_card FROM print_cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found';
  END IF;

  -- Caller must belong to the same gym as the card
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id AND gym_id = v_card.gym_id
  ) THEN
    RAISE EXCEPTION 'Card belongs to a different gym';
  END IF;

  IF v_card.reward_id IS NOT NULL THEN
    RAISE EXCEPTION 'Card already has a reward attached';
  END IF;

  -- Create the earned reward (reuses the existing redemption pipeline)
  -- qr_code is the short code the scanner uses (earned-reward:<code>)
  v_qr_code := encode(gen_random_bytes(8), 'hex');

  INSERT INTO earned_rewards (
    gym_id, profile_id, reward_label, reward_emoji,
    qr_code, source, status, expires_at
  )
  VALUES (
    v_card.gym_id, v_card.profile_id, p_reward_label, p_reward_emoji,
    v_qr_code, 'print_card', 'pending',
    NOW() + (p_expires_in_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_reward_id;

  -- Link reward back onto the card + denormalize for print rendering
  UPDATE print_cards
     SET reward_id      = v_reward_id,
         reward_qr_code = v_qr_code,
         reward_label   = p_reward_label
   WHERE id = p_card_id;

  RETURN json_build_object(
    'success', true,
    'card_id', p_card_id,
    'reward_id', v_reward_id,
    'qr_code', v_qr_code,
    'expires_at', NOW() + (p_expires_in_days || ' days')::INTERVAL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_reward_to_print_card(UUID, TEXT, TEXT, INT)
  TO authenticated;

-- ── 6. Inverse: detach reward (admin made a mistake) ──
CREATE OR REPLACE FUNCTION public.detach_reward_from_print_card(p_card_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card       print_cards%ROWTYPE;
  v_caller_id  UUID;
  v_caller_role TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can modify print cards';
  END IF;

  SELECT * INTO v_card FROM print_cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id AND gym_id = v_card.gym_id
  ) THEN
    RAISE EXCEPTION 'Card belongs to a different gym';
  END IF;

  -- Cancel the earned reward if it's still pending (don't yank a
  -- reward the member already redeemed)
  IF v_card.reward_id IS NOT NULL THEN
    UPDATE earned_rewards
       SET status = 'cancelled'
     WHERE id = v_card.reward_id AND status = 'pending';
  END IF;

  UPDATE print_cards
     SET reward_id      = NULL,
         reward_qr_code = NULL,
         reward_label   = NULL
   WHERE id = p_card_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.detach_reward_from_print_card(UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
