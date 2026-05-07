-- 0324 — Streak overhaul: weekly target + check-in counting + day-shift forgiveness
--
-- Changes the streak model from "consecutive training days with rest-day
-- protection" to "consecutive training days with weekly-target forgiveness":
--
--   • A check-in OR a workout session OR a cardio session counts as a
--     "training day" (was: workout/cardio only). Check-ins are now eligible
--     to maintain the streak — this is the user's "double safety net" so
--     even if they forget to log the workout, the QR check-in covers it.
--
--   • Weekly target = the count of `preferred_training_days` on the user's
--     profile (default 3 if unset). If the user hits their weekly target,
--     missed days WITHIN that week don't break the streak — even if those
--     missed days were "scheduled" days. They just shifted the day.
--
--   • Rest days, gym-closed days, and specific closure dates are still
--     protected (don't add, don't break) — same as before, but now the
--     "weekly forgiveness" runs FIRST, so a met-target week protects every
--     day in it regardless of schedule.
--
--   • Any single update path (workout, cardio, check-in) calls one shared
--     function `apply_training_day_to_streak(profile, gym, activity_date)`.
--     Eliminates the duplicated streak math across complete_workout +
--     log_cardio_session + (new) check-in trigger.

-- ─────────────────────────────────────────────────────────────────────────
-- Helper: count training days (workouts + cardio + check-ins) in [start,end]
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION count_training_days_in_range(
  p_profile_id UUID,
  p_start DATE,
  p_end DATE
) RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT d)::INT FROM (
    SELECT (completed_at AT TIME ZONE 'UTC')::DATE AS d
      FROM workout_sessions
     WHERE profile_id = p_profile_id
       AND status = 'completed'
       AND (completed_at AT TIME ZONE 'UTC')::DATE BETWEEN p_start AND p_end
    UNION
    SELECT (started_at AT TIME ZONE 'UTC')::DATE
      FROM cardio_sessions
     WHERE profile_id = p_profile_id
       AND (started_at AT TIME ZONE 'UTC')::DATE BETWEEN p_start AND p_end
    UNION
    SELECT (checked_in_at AT TIME ZONE 'UTC')::DATE
      FROM check_ins
     WHERE profile_id = p_profile_id
       AND (checked_in_at AT TIME ZONE 'UTC')::DATE BETWEEN p_start AND p_end
  ) AS days;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Core streak update — single source of truth used by every activity path.
-- Returns the updated current_streak_days.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_training_day_to_streak(
  p_profile_id   UUID,
  p_gym_id       UUID,
  p_activity_date DATE DEFAULT CURRENT_DATE
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      RECORD;
  v_new_streak    INT := 1;
  v_new_longest   INT := 1;
  v_training_days TEXT[];
  v_weekly_target INT;
  v_training_dow  INT[] := '{}';
  v_gym_closed_dows INT[] := '{}';
  v_closure_dates DATE[] := '{}';
  v_gap_date      DATE;
  v_gap_dow       INT;
  v_gap_week_start DATE;
  v_gap_week_end  DATE;
  v_week_count    INT;
  v_streak_broken BOOLEAN := FALSE;
BEGIN
  -- Load existing streak
  SELECT current_streak_days, longest_streak_days, last_activity_date, streak_broken_at
    INTO v_existing
    FROM streak_cache
   WHERE profile_id = p_profile_id;

  -- First-ever activity
  IF NOT FOUND THEN
    INSERT INTO streak_cache (
      profile_id, gym_id,
      current_streak_days, longest_streak_days,
      last_activity_date, streak_broken_at
    ) VALUES (p_profile_id, p_gym_id, 1, 1, p_activity_date, NULL);
    RETURN 1;
  END IF;

  -- Same day — streak unchanged
  IF v_existing.last_activity_date = p_activity_date THEN
    RETURN v_existing.current_streak_days;
  END IF;

  -- Backdated activity (older than last_activity_date) — don't touch streak.
  -- Used by future log_backdated_workout RPC; matches user requirement that
  -- backdated logs don't grant streak credit.
  IF p_activity_date < v_existing.last_activity_date THEN
    RETURN v_existing.current_streak_days;
  END IF;

  -- Consecutive day — simple increment
  IF v_existing.last_activity_date = p_activity_date - 1 THEN
    v_new_streak  := v_existing.current_streak_days + 1;
    v_new_longest := GREATEST(v_new_streak, v_existing.longest_streak_days);
    UPDATE streak_cache SET
      current_streak_days = v_new_streak,
      longest_streak_days = v_new_longest,
      last_activity_date  = p_activity_date,
      streak_broken_at    = NULL,
      updated_at          = NOW()
    WHERE profile_id = p_profile_id;
    RETURN v_new_streak;
  END IF;

  -- Gap > 1 day — apply weekly target forgiveness, then per-day protections.

  -- 1. Resolve weekly target from preferred_training_days
  SELECT preferred_training_days INTO v_training_days
    FROM profiles WHERE id = p_profile_id;

  v_weekly_target := COALESCE(array_length(v_training_days, 1), 3);
  IF v_weekly_target < 1 THEN v_weekly_target := 3; END IF;

  -- Convert training day names to DOW numbers (0=Sun..6=Sat)
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

  -- 2. Gym closed DOW + closure dates in range
  SELECT COALESCE(ARRAY(
    SELECT day_of_week FROM gym_hours
    WHERE gym_id = p_gym_id AND is_closed = TRUE
  ), '{}') INTO v_gym_closed_dows;

  SELECT COALESCE(ARRAY(
    SELECT closure_date FROM gym_closures
    WHERE gym_id = p_gym_id
      AND closure_date > v_existing.last_activity_date
      AND closure_date < p_activity_date
    UNION
    SELECT date FROM gym_holidays
    WHERE gym_id = p_gym_id
      AND date > v_existing.last_activity_date
      AND date < p_activity_date
      AND is_closed = TRUE
  ), '{}') INTO v_closure_dates;

  -- 3. Walk through each gap day. For each unprotected missed training day,
  --    check if its WEEK met the weekly target; if so, forgive it. Every
  --    protected day (closure / rest / gym-closed / weekly-forgiven) adds
  --    to the streak window so the displayed number reflects total days
  --    in the active streak, not just days the user trained.
  v_gap_date := v_existing.last_activity_date + 1;

  WHILE v_gap_date < p_activity_date AND NOT v_streak_broken LOOP
    v_gap_dow := EXTRACT(DOW FROM v_gap_date)::INT;

    IF v_gap_date = ANY(v_closure_dates) THEN
      NULL; -- protected
    ELSIF v_gap_dow = ANY(v_gym_closed_dows) THEN
      NULL; -- protected
    ELSIF array_length(v_training_dow, 1) > 0 AND NOT (v_gap_dow = ANY(v_training_dow)) THEN
      NULL; -- protected (scheduled rest day)
    ELSE
      v_gap_week_start := v_gap_date - EXTRACT(DOW FROM v_gap_date)::INT;
      v_gap_week_end   := v_gap_week_start + 6;
      v_week_count := count_training_days_in_range(
        p_profile_id, v_gap_week_start, v_gap_week_end
      );
      IF p_activity_date BETWEEN v_gap_week_start AND v_gap_week_end THEN
        v_week_count := v_week_count + 1;
      END IF;
      IF v_week_count >= v_weekly_target THEN
        NULL; -- weekly forgiveness
      ELSE
        v_streak_broken := TRUE;
      END IF;
    END IF;

    v_gap_date := v_gap_date + 1;
  END LOOP;

  IF v_streak_broken THEN
    v_new_streak  := 1;
    v_new_longest := v_existing.longest_streak_days;
  ELSE
    -- Add the full gap (every protected day) plus today. Display reflects
    -- total days in the active streak window, not just trained days.
    v_new_streak  := v_existing.current_streak_days + (p_activity_date - v_existing.last_activity_date);
    v_new_longest := GREATEST(v_new_streak, v_existing.longest_streak_days);
  END IF;

  UPDATE streak_cache SET
    current_streak_days = v_new_streak,
    longest_streak_days = v_new_longest,
    last_activity_date  = p_activity_date,
    streak_broken_at    = CASE WHEN v_streak_broken THEN NOW() ELSE NULL END,
    updated_at          = NOW()
  WHERE profile_id = p_profile_id;

  RETURN v_new_streak;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: apply streak update whenever a check-in is inserted.
-- Workouts and cardio are still updated inline by their RPCs; this is the
-- new path that treats check-ins as streak-eligible activities.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_check_in_apply_streak()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM apply_training_day_to_streak(
    NEW.profile_id,
    NEW.gym_id,
    (NEW.checked_in_at AT TIME ZONE 'UTC')::DATE
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_in_streak_trigger ON check_ins;
CREATE TRIGGER check_in_streak_trigger
  AFTER INSERT ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION trg_check_in_apply_streak();

-- ─────────────────────────────────────────────────────────────────────────
-- Update the daily cron to use the same weekly-target forgiveness logic.
-- (Replaces the old freeze-based protection — weekly target is a more
-- intuitive, less gameable mechanic than monthly freeze counts.)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_daily_streaks()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_training_days TEXT[];
  v_training_dow  INT[];
  v_gym_closed_dows INT[];
  v_closure_dates DATE[];
  v_gap_date      DATE;
  v_gap_dow       INT;
  v_gap_week_start DATE;
  v_gap_week_end  DATE;
  v_week_count    INT;
  v_weekly_target INT;
  v_streak_broken BOOLEAN;
  v_today         DATE := CURRENT_DATE;
  v_yesterday     DATE := CURRENT_DATE - 1;
  v_broken_count  INT := 0;
  v_protected_count INT := 0;
BEGIN
  FOR v_user IN
    SELECT sc.profile_id, sc.gym_id, sc.current_streak_days, sc.last_activity_date,
           p.preferred_training_days
    FROM streak_cache sc
    JOIN profiles p ON p.id = sc.profile_id
    WHERE sc.current_streak_days > 0
      AND sc.last_activity_date < v_yesterday
  LOOP
    v_training_days := v_user.preferred_training_days;
    v_weekly_target := COALESCE(array_length(v_training_days, 1), 3);
    IF v_weekly_target < 1 THEN v_weekly_target := 3; END IF;

    v_training_dow := '{}';
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

    SELECT COALESCE(ARRAY(
      SELECT day_of_week FROM gym_hours
      WHERE gym_id = v_user.gym_id AND is_closed = TRUE
    ), '{}') INTO v_gym_closed_dows;

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

    v_streak_broken := FALSE;
    v_gap_date := v_user.last_activity_date + 1;

    WHILE v_gap_date < v_today AND NOT v_streak_broken LOOP
      v_gap_dow := EXTRACT(DOW FROM v_gap_date)::INT;

      IF v_gap_date = ANY(v_closure_dates) THEN
        NULL;
      ELSIF v_gap_dow = ANY(v_gym_closed_dows) THEN
        NULL;
      ELSIF array_length(v_training_dow, 1) > 0 AND NOT (v_gap_dow = ANY(v_training_dow)) THEN
        NULL;
      ELSE
        v_gap_week_start := v_gap_date - EXTRACT(DOW FROM v_gap_date)::INT;
        v_gap_week_end   := v_gap_week_start + 6;
        v_week_count := count_training_days_in_range(
          v_user.profile_id,
          v_gap_week_start,
          v_gap_week_end
        );
        IF v_week_count >= v_weekly_target THEN
          NULL;
        ELSE
          v_streak_broken := TRUE;
        END IF;
      END IF;

      v_gap_date := v_gap_date + 1;
    END LOOP;

    IF v_streak_broken THEN
      UPDATE streak_cache SET
        current_streak_days = 0,
        streak_broken_at    = NOW(),
        updated_at          = NOW()
      WHERE profile_id = v_user.profile_id;
      v_broken_count := v_broken_count + 1;
    ELSE
      -- All gap days protected — advance the streak by every protected day
      -- and move last_activity_date forward to yesterday so tomorrow's run
      -- doesn't reprocess the same gap.
      UPDATE streak_cache SET
        current_streak_days = v_user.current_streak_days + (v_yesterday - v_user.last_activity_date),
        longest_streak_days = GREATEST(
          longest_streak_days,
          v_user.current_streak_days + (v_yesterday - v_user.last_activity_date)
        ),
        last_activity_date  = v_yesterday,
        updated_at          = NOW()
      WHERE profile_id = v_user.profile_id;
      v_protected_count := v_protected_count + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'streaks_broken', v_broken_count,
    'users_protected', v_protected_count,
    'checked_at', NOW()
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- log_backdated_workout — insert a workout for a past date WITHOUT updating
-- the streak (anti-cheat) and WITHOUT awarding XP. Used by the "log past
-- workout" UI when the user forgot to log a session in real time.
--
-- Streak protection: apply_training_day_to_streak already no-ops when
-- p_activity_date < last_activity_date, but this RPC also skips the call
-- entirely so even gap-filling backdates don't extend the streak window.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_backdated_workout(p_payload JSON)
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
  v_ex               JSON;
  v_set              JSON;
  v_se_id            UUID;
  v_set_number       INT;
  v_weight           NUMERIC;
  v_reps             INT;
  v_estimated_1rm    NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN RAISE EXCEPTION 'Profile not found or missing gym_id'; END IF;

  v_routine_id       := (p_payload->>'routine_id')::UUID;
  v_routine_name     := p_payload->>'routine_name';
  v_started_at       := (p_payload->>'started_at')::TIMESTAMPTZ;
  v_completed_at     := (p_payload->>'completed_at')::TIMESTAMPTZ;
  v_duration_seconds := COALESCE((p_payload->>'duration_seconds')::INT, 0);
  v_total_volume     := COALESCE((p_payload->>'total_volume_lbs')::NUMERIC, 0);
  v_completed_sets   := COALESCE((p_payload->>'completed_sets')::INT, 0);

  IF v_completed_at >= NOW() THEN
    RAISE EXCEPTION 'Backdated workout must be in the past';
  END IF;
  IF v_completed_at < NOW() - INTERVAL '90 days' THEN
    RAISE EXCEPTION 'Cannot backdate more than 90 days';
  END IF;

  INSERT INTO workout_sessions (
    profile_id, gym_id, routine_id, name, status,
    started_at, completed_at, duration_seconds, total_volume_lbs
  ) VALUES (
    v_user_id, v_gym_id, v_routine_id, v_routine_name, 'completed',
    v_started_at, v_completed_at, v_duration_seconds, v_total_volume
  )
  RETURNING id INTO v_session_id;

  IF p_payload->'exercises' IS NOT NULL THEN
    FOR v_ex IN SELECT * FROM json_array_elements(p_payload->'exercises')
    LOOP
      INSERT INTO session_exercises (session_id, exercise_id, snapshot_name, position)
      VALUES (
        v_session_id, v_ex->>'exercise_id', v_ex->>'name',
        (v_ex->>'position')::INT
      ) RETURNING id INTO v_se_id;

      v_set_number := 0;
      IF v_ex->'sets' IS NOT NULL THEN
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
            is_completed, is_pr, estimated_1rm
          ) VALUES (
            v_se_id, v_set_number, v_weight, v_reps,
            TRUE, FALSE, v_estimated_1rm
          );
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- DELIBERATELY NOT updating streak_cache or awarding XP/points.
  -- Backdated workouts contribute to volume / PR history / activity log
  -- only — they don't grant streak credit (anti-cheat).

  RETURN json_build_object(
    'session_id', v_session_id,
    'backdated', TRUE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION log_backdated_workout(JSON) TO authenticated;

NOTIFY pgrst, 'reload schema';
