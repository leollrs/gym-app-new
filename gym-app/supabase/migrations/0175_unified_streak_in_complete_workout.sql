-- =============================================================
-- Migration 0175: Unified streak logic in complete_workout RPC
--
-- Fixes:
-- 1. complete_workout now respects rest days, gym closures,
--    gym holidays, and auto-applies streak freezes.
-- 2. Adds frozen_dates column to streak_freezes for UI display.
-- 3. Single source of truth: streak_cache is authoritative.
-- =============================================================

-- Add frozen_dates array to streak_freezes for calendar display
ALTER TABLE streak_freezes
  ADD COLUMN IF NOT EXISTS frozen_dates DATE[] DEFAULT '{}';

-- ── Recreate complete_workout with smart streak logic ────────────────────────

CREATE OR REPLACE FUNCTION complete_workout(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_gym_id        UUID;
  v_routine_id    UUID;
  v_routine_name  TEXT;
  v_started_at    TIMESTAMPTZ;
  v_completed_at  TIMESTAMPTZ;
  v_now           TIMESTAMPTZ := now();
  v_today         DATE := CURRENT_DATE;
  v_duration_seconds INT;
  v_total_volume  NUMERIC;
  v_session_id    UUID;
  v_se_id         UUID;
  v_ex            JSON;
  v_set           JSON;
  v_pr            JSON;
  v_weight        NUMERIC;
  v_reps          INT;
  v_estimated_1rm NUMERIC;
  v_set_number    INT;
  v_exercises_with_sets INT := 0;
  v_total_sets    INT := 0;
  v_xp_earned     INT := 0;
  v_is_first_pr   BOOLEAN;
  -- Streak variables
  v_streak        INT := 0;
  v_new_streak    INT;
  v_new_longest   INT;
  v_existing_streak RECORD;
  v_day_gap       INT;
  v_streak_broken_at TIMESTAMPTZ;
  -- Smart streak variables
  v_training_days TEXT[];
  v_training_dow  INT[] := '{}';
  v_gym_closed_dows INT[] := '{}';
  v_closure_dates DATE[] := '{}';
  v_gap_date      DATE;
  v_gap_dow       INT;
  v_streak_broken BOOLEAN := FALSE;
  v_freeze_month  TEXT;
  v_freeze_used   INT;
  v_freeze_max    INT;
  v_freeze_id     UUID;
  v_day_name      TEXT;
  -- XP constants
  C_STREAK7_XP    CONSTANT INT := 200;
  C_STREAK30_XP   CONSTANT INT := 1000;
BEGIN
  -- Validate user
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get gym_id from profile
  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;

  -- Parse payload
  v_routine_id       := (p_payload->>'routine_id')::UUID;
  v_routine_name     := p_payload->>'routine_name';
  v_started_at       := (p_payload->>'started_at')::TIMESTAMPTZ;
  v_completed_at     := (p_payload->>'completed_at')::TIMESTAMPTZ;
  v_duration_seconds := (p_payload->>'duration_seconds')::INT;
  v_total_volume     := COALESCE((p_payload->>'total_volume_lbs')::NUMERIC, 0);

  -- ── 1. Insert workout_session ──────────────────────────────────────────────
  INSERT INTO workout_sessions (
    profile_id, gym_id, routine_id, name, status,
    started_at, completed_at, duration_seconds, total_volume_lbs
  ) VALUES (
    v_user_id, v_gym_id, v_routine_id, v_routine_name, 'completed',
    v_started_at, v_completed_at, v_duration_seconds, v_total_volume
  )
  RETURNING id INTO v_session_id;

  -- ── 2 & 3. Insert session_exercises + session_sets ─────────────────────────
  FOR v_ex IN SELECT * FROM json_array_elements(p_payload->'exercises')
  LOOP
    INSERT INTO session_exercises (
      session_id, exercise_id, snapshot_name, position
    ) VALUES (
      v_session_id,
      v_ex->>'exercise_id',
      v_ex->>'name',
      (v_ex->>'position')::INT
    )
    RETURNING id INTO v_se_id;

    v_exercises_with_sets := v_exercises_with_sets + 1;
    v_set_number := 0;

    FOR v_set IN SELECT * FROM json_array_elements(v_ex->'sets')
    LOOP
      v_set_number := v_set_number + 1;
      v_weight := COALESCE((v_set->>'weight')::NUMERIC, 0);
      v_reps   := COALESCE((v_set->>'reps')::INT, 0);
      v_estimated_1rm := CASE WHEN v_weight > 0 AND v_reps > 0
                              THEN v_weight * (1 + v_reps / 30.0)
                              ELSE 0 END;

      INSERT INTO session_sets (
        session_exercise_id, set_number, weight_lbs, reps,
        is_completed, is_pr, estimated_1rm,
        suggested_weight_lbs, suggested_reps,
        rpe, notes
      ) VALUES (
        v_se_id, v_set_number, v_weight, v_reps,
        TRUE,
        COALESCE((v_set->>'is_pr')::BOOLEAN, FALSE),
        v_estimated_1rm,
        (v_set->>'suggested_weight')::NUMERIC,
        (v_set->>'suggested_reps')::INT,
        (v_set->>'rpe')::SMALLINT,
        v_set->>'notes'
      );

      v_total_sets := v_total_sets + 1;
    END LOOP;
  END LOOP;

  -- ── 4. PRs — upsert personal_records + insert pr_history ──────────────────
  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;
      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

      SELECT NOT EXISTS(
        SELECT 1 FROM pr_history
        WHERE profile_id = v_user_id
          AND exercise_id = v_pr->>'exercise_id'
      ) INTO v_is_first_pr;

      INSERT INTO personal_records (
        profile_id, gym_id, exercise_id,
        weight_lbs, reps, estimated_1rm,
        achieved_at, session_id, updated_at
      ) VALUES (
        v_user_id, v_gym_id, v_pr->>'exercise_id',
        v_weight, v_reps, v_estimated_1rm,
        v_now, v_session_id, v_now
      )
      ON CONFLICT (profile_id, exercise_id) DO UPDATE SET
        weight_lbs    = EXCLUDED.weight_lbs,
        reps          = EXCLUDED.reps,
        estimated_1rm = EXCLUDED.estimated_1rm,
        achieved_at   = EXCLUDED.achieved_at,
        session_id    = EXCLUDED.session_id,
        updated_at    = EXCLUDED.updated_at;

      INSERT INTO pr_history (
        profile_id, gym_id, exercise_id,
        weight_lbs, reps, estimated_1rm,
        achieved_at, session_id
      ) VALUES (
        v_user_id, v_gym_id, v_pr->>'exercise_id',
        v_weight, v_reps, v_estimated_1rm,
        v_now, v_session_id
      );

      IF v_is_first_pr THEN
        INSERT INTO milestone_events (gym_id, profile_id, type, data)
        VALUES (v_gym_id, v_user_id, 'first_pr', jsonb_build_object(
          'exercise_name', v_pr->>'exercise_name',
          'weight_lbs', v_weight,
          'reps', v_reps
        ))
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  -- ── 5. XP calculation ─────────────────────────────────────────────────────
  v_xp_earned := 50 + (v_total_sets * 5);
  IF json_array_length(COALESCE(p_payload->'session_prs', '[]'::JSON)) > 0 THEN
    v_xp_earned := v_xp_earned + (json_array_length(p_payload->'session_prs') * 25);
  END IF;

  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points)
  VALUES (v_user_id, v_gym_id, v_xp_earned, v_xp_earned)
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points + v_xp_earned,
    lifetime_points = reward_points.lifetime_points + v_xp_earned,
    last_updated    = v_now;

  -- ── 6. Update last_active_at ──────────────────────────────────────────────
  UPDATE profiles SET last_active_at = v_now WHERE id = v_user_id;

  -- ── 7. Smart streak calculation ───────────────────────────────────────────
  -- Fetch existing streak data
  SELECT current_streak_days, longest_streak_days, last_activity_date, streak_broken_at
    INTO v_existing_streak
    FROM streak_cache
   WHERE profile_id = v_user_id;

  IF NOT FOUND THEN
    -- First ever workout
    v_new_streak  := 1;
    v_new_longest := 1;
    INSERT INTO streak_cache (
      profile_id, gym_id,
      current_streak_days, longest_streak_days,
      last_activity_date, streak_broken_at
    ) VALUES (
      v_user_id, v_gym_id, 1, 1, v_today, NULL
    );
    v_streak := 1;
  ELSE
    -- Same day workout — streak unchanged
    IF v_existing_streak.last_activity_date = v_today THEN
      v_streak := v_existing_streak.current_streak_days;
    -- Consecutive day — simple increment
    ELSIF v_existing_streak.last_activity_date = v_today - 1 THEN
      v_new_streak := v_existing_streak.current_streak_days + 1;
      v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
      UPDATE streak_cache SET
        current_streak_days = v_new_streak,
        longest_streak_days = v_new_longest,
        last_activity_date  = v_today,
        streak_broken_at    = NULL,
        updated_at          = v_now
      WHERE profile_id = v_user_id;
      v_streak := v_new_streak;
    ELSE
      -- Gap > 1 day — need to check protections for each gap day
      -- 1. Get user's training day names -> convert to dow numbers
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

      -- 2. Get gym recurring closed days (day_of_week where is_closed = true)
      SELECT COALESCE(ARRAY(
        SELECT day_of_week FROM gym_hours
        WHERE gym_id = v_gym_id AND is_closed = TRUE
      ), '{}') INTO v_gym_closed_dows;

      -- 3. Get specific closure dates (gym_closures + gym_holidays) in the gap range
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

        -- Check if this is a protected day
        IF v_gap_date = ANY(v_closure_dates) THEN
          -- Specific closure date — protected
          NULL;
        ELSIF v_gap_dow = ANY(v_gym_closed_dows) THEN
          -- Recurring gym closed day — protected
          NULL;
        ELSIF array_length(v_training_dow, 1) > 0 AND NOT (v_gap_dow = ANY(v_training_dow)) THEN
          -- User's rest day (not in their training schedule) — protected
          NULL;
        ELSE
          -- Unprotected missed training day — try to use a freeze
          v_freeze_month := to_char(v_gap_date, 'YYYY-MM');

          SELECT id, used_count, max_allowed
            INTO v_freeze_id, v_freeze_used, v_freeze_max
            FROM streak_freezes
           WHERE profile_id = v_user_id AND month = v_freeze_month;

          IF NOT FOUND THEN
            -- Create freeze row for this month and use 1
            INSERT INTO streak_freezes (profile_id, month, used_count, max_allowed, frozen_dates)
            VALUES (v_user_id, v_freeze_month, 1, 2, ARRAY[v_gap_date]);
          ELSIF v_freeze_used < v_freeze_max THEN
            -- Use a freeze
            UPDATE streak_freezes
               SET used_count = used_count + 1,
                   frozen_dates = array_append(COALESCE(frozen_dates, '{}'), v_gap_date)
             WHERE id = v_freeze_id;
          ELSE
            -- No freeze available — streak breaks
            v_streak_broken := TRUE;
          END IF;
        END IF;

        v_gap_date := v_gap_date + 1;
      END LOOP;

      IF v_streak_broken THEN
        v_new_streak := 1;
        v_new_longest := v_existing_streak.longest_streak_days;
        v_streak_broken_at := v_now;
      ELSE
        v_new_streak := v_existing_streak.current_streak_days + 1;
        v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
        v_streak_broken_at := NULL;
      END IF;

      UPDATE streak_cache SET
        current_streak_days = v_new_streak,
        longest_streak_days = v_new_longest,
        last_activity_date  = v_today,
        streak_broken_at    = v_streak_broken_at,
        updated_at          = v_now
      WHERE profile_id = v_user_id;
      v_streak := v_new_streak;
    END IF;
  END IF;

  -- ── 8. Streak milestone XP ────────────────────────────────────────────────
  IF v_streak = 7 THEN
    v_xp_earned := v_xp_earned + C_STREAK7_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_7', 200, '7-day streak!');
  ELSIF v_streak = 30 THEN
    v_xp_earned := v_xp_earned + C_STREAK30_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_30', 1000, '30-day streak!');
  END IF;

  RETURN json_build_object(
    'session_id', v_session_id,
    'xp_earned', v_xp_earned,
    'streak', v_streak,
    'exercises_logged', v_exercises_with_sets,
    'sets_logged', v_total_sets
  );
END;
$$;
