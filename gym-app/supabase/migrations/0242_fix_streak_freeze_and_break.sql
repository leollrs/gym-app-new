-- =============================================================
-- Migration 0242: Fix streak freeze activation & streak breaking
--
-- Two bugs:
--
-- 1. complete_workout (0238) regressed the smart streak logic
--    from 0175. When gap > 1 day it naively resets streak to 1
--    instead of checking rest days, gym closures, and freezes.
--    FIX: Restore the full gap-day walk with freeze logic.
--
-- 2. check_daily_streaks (0232) never advances last_activity_date
--    after applying freezes, causing reprocessing of already-frozen
--    days on subsequent runs. Also doesn't skip already-frozen dates.
--    FIX: Track highest frozen date and update last_activity_date
--    when all gap days are protected. Skip dates already in frozen_dates.
-- =============================================================


-- ── FIX 1: complete_workout — restore smart streak with freezes ─────────────

CREATE OR REPLACE FUNCTION public.complete_workout(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          UUID;
  v_gym_id           UUID;
  v_session_id       UUID;
  v_routine_id       UUID;
  v_routine_name     TEXT;
  v_started_at       TIMESTAMPTZ;
  v_completed_at     TIMESTAMPTZ;
  v_duration_seconds INT;
  v_total_volume     NUMERIC;
  v_completed_sets   INT;
  v_now              TIMESTAMPTZ := NOW();
  v_today            DATE := CURRENT_DATE;

  -- exercise iteration
  v_ex               JSON;
  v_set              JSON;
  v_se_id            UUID;
  v_set_number       INT;
  v_weight           NUMERIC;
  v_reps             INT;
  v_estimated_1rm    NUMERIC;

  -- PR iteration
  v_pr               JSON;

  -- streak
  v_existing_streak  RECORD;
  v_new_streak       INT := 1;
  v_new_longest      INT := 1;
  v_day_gap          INT;
  v_streak_broken_at TIMESTAMPTZ;

  -- smart streak variables (restored from 0175)
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
  v_week_start       TIMESTAMPTZ;
  v_week_count       INT;

  -- feed
  v_exercises_with_sets INT := 0;

  -- constants
  C_WORKOUT_XP       CONSTANT INT := 50;
  C_PR_XP            CONSTANT INT := 100;
  C_WEEKLY_XP        CONSTANT INT := 25;
  C_STREAK7_XP       CONSTANT INT := 200;
  C_STREAK30_XP      CONSTANT INT := 1000;
BEGIN
  -- ── Input bounds validation ────────────────────────────────────────────────
  IF (p_payload->>'duration_seconds')::int < 0 OR (p_payload->>'duration_seconds')::int > 86400 THEN
    RAISE EXCEPTION 'Invalid duration';
  END IF;
  IF (p_payload->>'total_volume_lbs')::numeric < 0 OR (p_payload->>'total_volume_lbs')::numeric > 500000 THEN
    RAISE EXCEPTION 'Invalid volume';
  END IF;
  IF length(p_payload->>'routine_name') > 200 THEN
    RAISE EXCEPTION 'Routine name too long';
  END IF;

  -- ── 0. Auth & profile ──────────────────────────────────────────────────────
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

  -- ── Parse payload ──────────────────────────────────────────────────────────
  v_routine_id       := (p_payload->>'routine_id')::UUID;
  v_routine_name     := p_payload->>'routine_name';
  v_started_at       := (p_payload->>'started_at')::TIMESTAMPTZ;
  v_completed_at     := (p_payload->>'completed_at')::TIMESTAMPTZ;
  v_duration_seconds := (p_payload->>'duration_seconds')::INT;
  v_total_volume     := (p_payload->>'total_volume_lbs')::NUMERIC;
  v_completed_sets   := (p_payload->>'completed_sets')::INT;

  -- Security: validate inputs
  IF v_completed_at < v_started_at THEN
    RAISE EXCEPTION 'completed_at cannot be before started_at';
  END IF;
  IF v_duration_seconds IS NOT NULL AND v_duration_seconds <= 0 THEN
    RAISE EXCEPTION 'duration_seconds must be positive';
  END IF;
  IF v_total_volume IS NOT NULL AND v_total_volume < 0 THEN
    RAISE EXCEPTION 'total_volume cannot be negative';
  END IF;
  IF json_array_length(p_payload->'exercises') > 100 THEN
    RAISE EXCEPTION 'Too many exercises in payload';
  END IF;

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
    -- NOTE: exercise_id is TEXT, not UUID (exercises table uses text PKs like 'ex_bbr')
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
        TRUE, COALESCE((v_set->>'is_pr')::BOOLEAN, FALSE), v_estimated_1rm,
        (v_ex->>'suggested_weight')::NUMERIC,
        (v_ex->>'suggested_reps')::INT,
        (v_set->>'rpe')::NUMERIC,
        v_set->>'notes'
      );
    END LOOP;
  END LOOP;

  -- ── 4. PRs — upsert personal_records + insert pr_history ──────────────────
  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;
      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

      -- NOTE: exercise_id is TEXT, not UUID
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
    END LOOP;
  END IF;

  -- ── 5. Activity feed items ─────────────────────────────────────────────────
  INSERT INTO activity_feed_items (gym_id, actor_id, type, is_public, data)
  VALUES (
    v_gym_id, v_user_id, 'workout_completed', TRUE,
    json_build_object(
      'session_id', v_session_id,
      'routine_name', v_routine_name,
      'duration_seconds', v_duration_seconds,
      'total_volume_lbs', v_total_volume,
      'set_count', v_completed_sets,
      'exercise_count', v_exercises_with_sets
    )::JSONB
  );

  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;
      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

      INSERT INTO activity_feed_items (gym_id, actor_id, type, is_public, data)
      VALUES (
        v_gym_id, v_user_id, 'pr_hit', TRUE,
        json_build_object(
          'exercise_name', v_pr->>'exercise_name',
          'weight_lbs', v_weight,
          'reps', v_reps,
          'estimated_1rm', v_estimated_1rm
        )::JSONB
      );
    END LOOP;
  END IF;

  -- ── 6. Smart streak calculation (rest days + closures + freezes) ───────────
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
  ELSE
    -- Same day workout — streak unchanged
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
            -- Use a freeze (skip if this date was already frozen by the cron)
            IF NOT (v_gap_date = ANY(COALESCE(
              (SELECT frozen_dates FROM streak_freezes WHERE id = v_freeze_id), '{}'
            ))) THEN
              UPDATE streak_freezes
                 SET used_count = used_count + 1,
                     frozen_dates = array_append(COALESCE(frozen_dates, '{}'), v_gap_date)
               WHERE id = v_freeze_id;
            END IF;
          ELSE
            -- No freeze available — streak breaks
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

  -- ── 7. Update profile last_active_at ───────────────────────────────────────
  UPDATE profiles SET last_active_at = v_now WHERE id = v_user_id;

  -- ── 8. Award XP ───────────────────────────────────────────────────────────
  v_xp_earned := v_xp_earned + C_WORKOUT_XP;
  PERFORM add_reward_points(v_user_id, v_gym_id, 'workout_completed', C_WORKOUT_XP,
    'Completed ' || v_routine_name);

  -- PR XP
  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_xp_earned := v_xp_earned + C_PR_XP;
      PERFORM add_reward_points(v_user_id, v_gym_id, 'pr_hit', C_PR_XP,
        'New PR: ' || (v_pr->>'exercise_name'));
    END LOOP;
  END IF;

  -- ── 9. First weekly workout bonus ─────────────────────────────────────────
  v_week_start := date_trunc('week', v_now);
  SELECT COUNT(*) INTO v_week_count
    FROM workout_sessions
   WHERE profile_id = v_user_id
     AND status = 'completed'
     AND completed_at >= v_week_start;

  IF v_week_count = 1 THEN
    v_xp_earned := v_xp_earned + C_WEEKLY_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'first_weekly_workout', C_WEEKLY_XP,
      'First workout this week');
  END IF;

  -- ── 10. Streak milestones ─────────────────────────────────────────────────
  IF v_new_streak = 7 THEN
    v_xp_earned := v_xp_earned + C_STREAK7_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_7', C_STREAK7_XP, '7-day streak!');
  ELSIF v_new_streak = 30 THEN
    v_xp_earned := v_xp_earned + C_STREAK30_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_30', C_STREAK30_XP, '30-day streak!');
  END IF;

  -- ── 11. Delete session draft ──────────────────────────────────────────────
  DELETE FROM session_drafts
   WHERE profile_id = v_user_id
     AND routine_id = v_routine_id;

  -- ── 12. Return summary ────────────────────────────────────────────────────
  RETURN json_build_object(
    'session_id', v_session_id,
    'xp_earned',  v_xp_earned,
    'streak',     v_new_streak
  );
END;
$$;


-- ── FIX 2: check_daily_streaks — advance last_activity_date, skip dupes ─────

CREATE OR REPLACE FUNCTION check_daily_streaks()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        RECORD;
  v_training_dow INT[];
  v_gym_closed_dows INT[];
  v_closure_dates DATE[];
  v_existing_frozen DATE[];
  v_gap_date    DATE;
  v_gap_dow     INT;
  v_freeze_month TEXT;
  v_freeze_id   UUID;
  v_freeze_used INT;
  v_freeze_max  INT;
  v_streak_broken BOOLEAN;
  v_last_protected_date DATE;
  v_today       DATE := CURRENT_DATE;
  v_yesterday   DATE := CURRENT_DATE - 1;
  v_broken_count INT := 0;
  v_frozen_count INT := 0;
  v_skipped_count INT := 0;
BEGIN
  -- Process all users with an active streak whose last activity is more than 1 day ago
  FOR v_user IN
    SELECT sc.profile_id, sc.gym_id, sc.current_streak_days, sc.last_activity_date,
           p.preferred_training_days
    FROM streak_cache sc
    JOIN profiles p ON p.id = sc.profile_id
    WHERE sc.current_streak_days > 0
      AND sc.last_activity_date < v_yesterday
  LOOP
    -- Convert training day names to dow numbers
    v_training_dow := '{}';
    IF v_user.preferred_training_days IS NOT NULL AND array_length(v_user.preferred_training_days, 1) > 0 THEN
      SELECT ARRAY(
        SELECT CASE day
          WHEN 'Sunday' THEN 0 WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
          WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5
          WHEN 'Saturday' THEN 6
        END
        FROM unnest(v_user.preferred_training_days) AS day
      ) INTO v_training_dow;
    END IF;

    -- Get gym recurring closed days
    SELECT COALESCE(ARRAY(
      SELECT day_of_week FROM gym_hours
      WHERE gym_id = v_user.gym_id AND is_closed = TRUE
    ), '{}') INTO v_gym_closed_dows;

    -- Get specific closure dates in the gap range
    SELECT COALESCE(ARRAY(
      SELECT closure_date FROM gym_closures
      WHERE gym_id = v_user.gym_id
        AND closure_date > v_user.last_activity_date
        AND closure_date < v_today
      UNION
      SELECT date FROM gym_holidays
      WHERE gym_id = v_user.gym_id
        AND date > v_user.last_activity_date
        AND date < v_today
        AND is_closed = TRUE
    ), '{}') INTO v_closure_dates;

    -- Walk through each gap day
    v_streak_broken := FALSE;
    v_last_protected_date := v_user.last_activity_date;
    v_gap_date := v_user.last_activity_date + 1;

    WHILE v_gap_date < v_today AND NOT v_streak_broken LOOP
      v_gap_dow := EXTRACT(DOW FROM v_gap_date)::INT;

      IF v_gap_date = ANY(v_closure_dates) THEN
        -- Specific closure — protected
        v_last_protected_date := v_gap_date;
      ELSIF v_gap_dow = ANY(v_gym_closed_dows) THEN
        -- Recurring gym closed day — protected
        v_last_protected_date := v_gap_date;
      ELSIF array_length(v_training_dow, 1) > 0 AND NOT (v_gap_dow = ANY(v_training_dow)) THEN
        -- Rest day — protected
        v_last_protected_date := v_gap_date;
      ELSE
        -- Unprotected missed training day — try freeze
        v_freeze_month := to_char(v_gap_date, 'YYYY-MM');

        SELECT id, used_count, max_allowed, COALESCE(frozen_dates, '{}')
          INTO v_freeze_id, v_freeze_used, v_freeze_max, v_existing_frozen
          FROM streak_freezes
         WHERE profile_id = v_user.profile_id AND month = v_freeze_month;

        IF NOT FOUND THEN
          -- Auto-create freeze row for this month and use 1
          INSERT INTO streak_freezes (profile_id, month, used_count, max_allowed, frozen_dates)
          VALUES (v_user.profile_id, v_freeze_month, 1, 2, ARRAY[v_gap_date]);
          v_frozen_count := v_frozen_count + 1;
          v_last_protected_date := v_gap_date;
        ELSIF v_gap_date = ANY(v_existing_frozen) THEN
          -- Already frozen by a previous run or by complete_workout — skip
          v_last_protected_date := v_gap_date;
        ELSIF v_freeze_used < v_freeze_max THEN
          -- Use a freeze
          UPDATE streak_freezes
             SET used_count = used_count + 1,
                 frozen_dates = array_append(COALESCE(frozen_dates, '{}'), v_gap_date)
           WHERE id = v_freeze_id;
          v_frozen_count := v_frozen_count + 1;
          v_last_protected_date := v_gap_date;
        ELSE
          -- No freeze available — streak breaks
          v_streak_broken := TRUE;
        END IF;
      END IF;

      v_gap_date := v_gap_date + 1;
    END LOOP;

    IF v_streak_broken THEN
      UPDATE streak_cache SET
        current_streak_days = 0,
        streak_broken_at    = now(),
        updated_at          = now()
      WHERE profile_id = v_user.profile_id;
      v_broken_count := v_broken_count + 1;
    ELSE
      -- All gap days were protected — advance last_activity_date so we don't
      -- reprocess these same days tomorrow. The streak count stays the same
      -- (user didn't actually work out), but the window moves forward.
      IF v_last_protected_date > v_user.last_activity_date THEN
        UPDATE streak_cache SET
          last_activity_date = v_last_protected_date,
          updated_at         = now()
        WHERE profile_id = v_user.profile_id;
      END IF;
      v_skipped_count := v_skipped_count + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'streaks_broken', v_broken_count,
    'freezes_applied', v_frozen_count,
    'users_protected', v_skipped_count,
    'checked_at', now()
  );
END;
$$;


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
