-- =============================================================
-- Migration 0248: Cardio Sessions
--
-- Adds cardio tracking support:
-- 1. cardio_sessions table with RLS
-- 2. 'cardio_completed' feed_item_type enum value
-- 3. log_cardio_session RPC (insert + streak + XP + feed)
-- =============================================================


-- ── 1. Add 'cardio_completed' to feed_item_type enum ─────────────────────────

ALTER TYPE feed_item_type ADD VALUE IF NOT EXISTS 'cardio_completed';


-- ── 2. Create cardio_sessions table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cardio_sessions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id           UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    cardio_type      TEXT NOT NULL CHECK (cardio_type IN (
                       'running', 'cycling', 'rowing', 'elliptical',
                       'stair_climber', 'jump_rope', 'swimming',
                       'walking', 'hiit', 'other'
                     )),
    duration_seconds INT NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 86400),
    distance_km      NUMERIC(8,3),
    calories_burned  INT CHECK (calories_burned IS NULL OR calories_burned >= 0),
    avg_heart_rate   INT CHECK (avg_heart_rate IS NULL OR (avg_heart_rate >= 20 AND avg_heart_rate <= 250)),
    max_heart_rate   INT CHECK (max_heart_rate IS NULL OR (max_heart_rate >= 20 AND max_heart_rate <= 250)),
    intensity        TEXT CHECK (intensity IS NULL OR intensity IN ('easy', 'moderate', 'hard', 'max')),
    notes            TEXT,
    source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'health_kit', 'google_fit', 'watch')),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cardio_sessions_profile ON cardio_sessions(profile_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cardio_sessions_gym     ON cardio_sessions(gym_id, completed_at DESC);


-- ── 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE cardio_sessions ENABLE ROW LEVEL SECURITY;

-- Users can SELECT their own cardio sessions
CREATE POLICY cardio_sessions_select_own ON cardio_sessions
  FOR SELECT USING (profile_id = auth.uid());

-- Users can INSERT their own cardio sessions
CREATE POLICY cardio_sessions_insert_own ON cardio_sessions
  FOR INSERT WITH CHECK (profile_id = auth.uid());

-- Users can UPDATE their own cardio sessions
CREATE POLICY cardio_sessions_update_own ON cardio_sessions
  FOR UPDATE USING (profile_id = auth.uid());

-- Users can DELETE their own cardio sessions
CREATE POLICY cardio_sessions_delete_own ON cardio_sessions
  FOR DELETE USING (profile_id = auth.uid());

-- Admins and trainers can SELECT cardio sessions for their gym
CREATE POLICY cardio_sessions_select_gym_staff ON cardio_sessions
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.current_user_role() IN ('admin', 'trainer', 'super_admin')
  );


-- ── 4. log_cardio_session RPC ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_cardio_session(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          UUID;
  v_gym_id           UUID;
  v_session_id       UUID;
  v_cardio_type      TEXT;
  v_duration_seconds INT;
  v_now              TIMESTAMPTZ := NOW();
  v_today            DATE := CURRENT_DATE;

  -- streak
  v_existing_streak  RECORD;
  v_new_streak       INT := 1;
  v_new_longest      INT := 1;
  v_streak_broken_at TIMESTAMPTZ;

  -- smart streak variables
  v_training_days    TEXT[];
  v_training_dow     INT[] := '{}';
  v_gym_closed_dows  INT[] := '{}';
  v_closure_dates    DATE[] := '{}';
  v_gap_date         DATE;
  v_gap_dow          INT;
  v_streak_broken    BOOLEAN := FALSE;
  v_freeze_month     TEXT;
  v_freeze_used      INT;
  v_freeze_max       INT;
  v_freeze_id        UUID;

  -- XP
  v_xp_earned        INT := 0;
  C_CARDIO_XP        CONSTANT INT := 25;
BEGIN
  -- ── Auth & profile ─────────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gym_id INTO v_gym_id
    FROM profiles
   WHERE id = v_user_id;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found or missing gym_id';
  END IF;

  -- ── Parse & validate payload ───────────────────────────────────────────────
  v_cardio_type      := p_payload->>'cardio_type';
  v_duration_seconds := (p_payload->>'duration_seconds')::INT;

  IF v_cardio_type IS NULL OR v_cardio_type NOT IN (
    'running', 'cycling', 'rowing', 'elliptical',
    'stair_climber', 'jump_rope', 'swimming',
    'walking', 'hiit', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid cardio_type';
  END IF;

  IF v_duration_seconds IS NULL OR v_duration_seconds <= 0 OR v_duration_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid duration_seconds';
  END IF;

  -- ── 1. Insert cardio session ───────────────────────────────────────────────
  INSERT INTO cardio_sessions (
    profile_id, gym_id, cardio_type, duration_seconds,
    distance_km, calories_burned, avg_heart_rate, max_heart_rate,
    intensity, notes, source, started_at, completed_at
  ) VALUES (
    v_user_id,
    v_gym_id,
    v_cardio_type,
    v_duration_seconds,
    (p_payload->>'distance_km')::NUMERIC,
    (p_payload->>'calories_burned')::INT,
    (p_payload->>'avg_heart_rate')::INT,
    (p_payload->>'max_heart_rate')::INT,
    p_payload->>'intensity',
    p_payload->>'notes',
    COALESCE(p_payload->>'source', 'manual'),
    COALESCE((p_payload->>'started_at')::TIMESTAMPTZ, v_now),
    (p_payload->>'completed_at')::TIMESTAMPTZ
  )
  RETURNING id INTO v_session_id;

  -- ── 2. Smart streak calculation (same gap-day logic as complete_workout) ───
  SELECT current_streak_days, longest_streak_days, last_activity_date, streak_broken_at
    INTO v_existing_streak
    FROM streak_cache
   WHERE profile_id = v_user_id;

  IF NOT FOUND THEN
    v_new_streak  := 1;
    v_new_longest := 1;
    INSERT INTO streak_cache (
      profile_id, gym_id,
      current_streak_days, longest_streak_days,
      last_activity_date, streak_broken_at
    ) VALUES (
      v_user_id, v_gym_id, 1, 1, v_today, NULL
    );
  ELSE
    -- Same day — streak unchanged
    IF v_existing_streak.last_activity_date = v_today THEN
      v_new_streak  := v_existing_streak.current_streak_days;
      v_new_longest := v_existing_streak.longest_streak_days;
      v_streak_broken_at := NULL;

    -- Consecutive day — simple increment
    ELSIF v_existing_streak.last_activity_date = v_today - 1 THEN
      v_new_streak  := v_existing_streak.current_streak_days + 1;
      v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
      v_streak_broken_at := NULL;

    ELSE
      -- Gap > 1 day — walk each gap day checking protections + freezes

      -- 1. Get user's preferred training days -> convert to DOW numbers
      SELECT preferred_training_days INTO v_training_days
        FROM profiles WHERE id = v_user_id;

      IF v_training_days IS NOT NULL AND array_length(v_training_days, 1) > 0 THEN
        SELECT ARRAY(
          SELECT CASE day
            WHEN 'Sunday' THEN 0 WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
            WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5
            WHEN 'Saturday' THEN 6
          END
          FROM unnest(v_training_days) AS day
        ) INTO v_training_dow;
      END IF;

      -- 2. Get gym recurring closed days
      SELECT COALESCE(ARRAY(
        SELECT day_of_week FROM gym_hours
        WHERE gym_id = v_gym_id AND is_closed = TRUE
      ), '{}') INTO v_gym_closed_dows;

      -- 3. Get specific closure dates in the gap range
      SELECT COALESCE(ARRAY(
        SELECT closure_date FROM gym_closures
        WHERE gym_id = v_gym_id
          AND closure_date > v_existing_streak.last_activity_date
          AND closure_date < v_today
        UNION
        SELECT date FROM gym_holidays
        WHERE gym_id = v_gym_id
          AND date > v_existing_streak.last_activity_date
          AND date < v_today
          AND is_closed = TRUE
      ), '{}') INTO v_closure_dates;

      -- 4. Walk through each gap day
      v_streak_broken := FALSE;
      v_gap_date := v_existing_streak.last_activity_date + 1;

      WHILE v_gap_date < v_today AND NOT v_streak_broken LOOP
        v_gap_dow := EXTRACT(DOW FROM v_gap_date)::INT;

        IF v_gap_date = ANY(v_closure_dates) THEN
          NULL; -- Specific closure date — protected
        ELSIF v_gap_dow = ANY(v_gym_closed_dows) THEN
          NULL; -- Recurring gym closed day — protected
        ELSIF array_length(v_training_dow, 1) > 0 AND NOT (v_gap_dow = ANY(v_training_dow)) THEN
          NULL; -- User's rest day — protected
        ELSE
          -- Unprotected missed training day — try to use a freeze
          v_freeze_month := to_char(v_gap_date, 'YYYY-MM');

          SELECT id, used_count, max_allowed
            INTO v_freeze_id, v_freeze_used, v_freeze_max
            FROM streak_freezes
           WHERE profile_id = v_user_id AND month = v_freeze_month;

          IF NOT FOUND THEN
            INSERT INTO streak_freezes (profile_id, month, used_count, max_allowed, frozen_dates)
            VALUES (v_user_id, v_freeze_month, 1, 2, ARRAY[v_gap_date]);
          ELSIF v_freeze_used < v_freeze_max THEN
            IF NOT (v_gap_date = ANY(COALESCE(
              (SELECT frozen_dates FROM streak_freezes WHERE id = v_freeze_id), '{}'
            ))) THEN
              UPDATE streak_freezes
                 SET used_count = used_count + 1,
                     frozen_dates = array_append(COALESCE(frozen_dates, '{}'), v_gap_date)
               WHERE id = v_freeze_id;
            END IF;
          ELSE
            v_streak_broken := TRUE;
          END IF;
        END IF;

        v_gap_date := v_gap_date + 1;
      END LOOP;

      IF v_streak_broken THEN
        v_new_streak  := 1;
        v_new_longest := v_existing_streak.longest_streak_days;
        v_streak_broken_at := v_now;
      ELSE
        v_new_streak  := v_existing_streak.current_streak_days + 1;
        v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
        v_streak_broken_at := NULL;
      END IF;
    END IF;

    UPDATE streak_cache SET
      current_streak_days = v_new_streak,
      longest_streak_days = v_new_longest,
      last_activity_date  = v_today,
      streak_broken_at    = v_streak_broken_at,
      updated_at          = v_now
    WHERE profile_id = v_user_id;
  END IF;

  -- ── 3. Update profile last_active_at ───────────────────────────────────────
  UPDATE profiles SET last_active_at = v_now WHERE id = v_user_id;

  -- ── 4. Award XP ───────────────────────────────────────────────────────────
  v_xp_earned := C_CARDIO_XP;
  PERFORM add_reward_points(v_user_id, v_gym_id, 'cardio_completed', C_CARDIO_XP,
    'Cardio: ' || v_cardio_type || ' (' || (v_duration_seconds / 60) || ' min)');

  -- ── 5. Activity feed item ─────────────────────────────────────────────────
  INSERT INTO activity_feed_items (gym_id, actor_id, type, is_public, data)
  VALUES (
    v_gym_id, v_user_id, 'cardio_completed', TRUE,
    json_build_object(
      'session_id',       v_session_id,
      'cardio_type',      v_cardio_type,
      'duration_seconds', v_duration_seconds,
      'distance_km',      (p_payload->>'distance_km')::NUMERIC,
      'calories_burned',  (p_payload->>'calories_burned')::INT
    )::JSONB
  );

  -- ── 6. Return summary ─────────────────────────────────────────────────────
  RETURN json_build_object(
    'session_id', v_session_id,
    'xp_earned',  v_xp_earned,
    'streak',     v_new_streak
  );
END;
$$;


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
