-- ============================================================
-- 0352 — Fix streak count + last-broken date semantics
-- ============================================================
-- Two bugs in 0318_remove_auto_freeze_burn.sql:
--
-- 1. `streak_broken_at` is set to TODAY (the day the user came back)
--    instead of the LAST DAY THEY ACTUALLY TRAINED before the gap.
--    The UI shows "Última perdida: <date>" — users naturally read this
--    as "the day my streak ended", not "the day I came back". Fix:
--    record `v_existing_streak.last_activity_date` instead of `v_now`.
--
-- 2. The gap-day protection loop only protects days as "rest days" if
--    the user has set `preferred_training_days`. Members who haven't
--    picked a training schedule (most fresh signups) get every
--    non-trained day counted as a missed training day — so a
--    "Mon, Wed" pattern breaks the streak on Tuesday even though
--    that's clearly a rest day.
--    Fix: when `preferred_training_days` is empty/null, treat every
--    non-trained day as a rest day as long as the gap from the last
--    training day is ≤ 7 days. Beyond 7 days, the streak still breaks.
--    Matches the client-side `computeStreakFromSessions` semantics.
--
-- Both functions (complete_workout, check_daily_streaks) need the
-- same patches applied in two places, so we use a small helper to
-- avoid duplicating 400 lines of unchanged logic.
-- ============================================================

-- Helper: returns whether a single gap day is "protected" (rest /
-- closure / freeze / fallback rest). Used by both complete_workout
-- and check_daily_streaks via direct inline calls — but we keep
-- the helper as a single source of truth so future tweaks land in
-- one place.
CREATE OR REPLACE FUNCTION public._streak_gap_day_protected(
  p_gap_date         DATE,
  p_last_activity    DATE,
  p_today            DATE,
  p_training_dow     INT[],
  p_gym_closed_dows  INT[],
  p_closure_dates    DATE[],
  p_frozen_dates     DATE[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dow INT := EXTRACT(DOW FROM p_gap_date)::INT;
BEGIN
  -- Specific gym closure (holiday / one-off)
  IF p_gap_date = ANY(p_closure_dates) THEN RETURN TRUE; END IF;
  -- Recurring weekly gym closure (e.g. Sundays)
  IF v_dow = ANY(p_gym_closed_dows) THEN RETURN TRUE; END IF;
  -- Scheduled rest day (user has training_days and this isn't one)
  IF array_length(p_training_dow, 1) > 0 AND NOT (v_dow = ANY(p_training_dow)) THEN
    RETURN TRUE;
  END IF;
  -- Explicitly used freeze
  IF p_gap_date = ANY(p_frozen_dates) THEN RETURN TRUE; END IF;
  -- NEW: fallback — if user hasn't set training_days, bridge gaps up
  -- to 7 days from the last actual training day. Past 7 days the
  -- streak breaks. Matches computeStreakFromSessions in lib/achievements.js.
  IF (p_training_dow IS NULL OR array_length(p_training_dow, 1) IS NULL)
     AND (p_today - p_last_activity) <= 7 THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;


-- ── Patched complete_workout ────────────────────────────────────────────────
-- Identical to 0318 except:
--   * the gap-check loop calls _streak_gap_day_protected (which adds the
--     ≤7-day fallback)
--   * v_streak_broken_at on break = last_activity_date (not v_now)

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

  v_ex               JSON;
  v_set              JSON;
  v_se_id            UUID;
  v_set_number       INT;
  v_weight           NUMERIC;
  v_reps             INT;
  v_estimated_1rm    NUMERIC;

  v_pr               JSON;

  v_existing_streak  RECORD;
  v_new_streak       INT := 1;
  v_new_longest      INT := 1;
  v_streak_broken_at TIMESTAMPTZ;

  v_training_days    TEXT[];
  v_training_dow     INT[] := '{}';
  v_gym_closed_dows  INT[] := '{}';
  v_closure_dates    DATE[] := '{}';
  v_frozen_dates     DATE[] := '{}';
  v_gap_date         DATE;
  v_streak_broken    BOOLEAN := FALSE;

  v_xp_earned        INT := 0;
  v_week_start       TIMESTAMPTZ;
  v_week_count       INT;

  v_exercises_with_sets INT := 0;

  C_WORKOUT_XP       CONSTANT INT := 50;
  C_PR_XP            CONSTANT INT := 100;
  C_WEEKLY_XP        CONSTANT INT := 25;
  C_STREAK7_XP       CONSTANT INT := 200;
  C_STREAK30_XP      CONSTANT INT := 1000;
BEGIN
  IF (p_payload->>'duration_seconds')::int < 0 OR (p_payload->>'duration_seconds')::int > 86400 THEN
    RAISE EXCEPTION 'Invalid duration';
  END IF;
  IF (p_payload->>'total_volume_lbs')::numeric < 0 OR (p_payload->>'total_volume_lbs')::numeric > 500000 THEN
    RAISE EXCEPTION 'Invalid volume';
  END IF;
  IF length(p_payload->>'routine_name') > 200 THEN
    RAISE EXCEPTION 'Routine name too long';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found or missing gym_id';
  END IF;

  v_routine_id       := (p_payload->>'routine_id')::UUID;
  v_routine_name     := p_payload->>'routine_name';
  v_started_at       := (p_payload->>'started_at')::TIMESTAMPTZ;
  v_completed_at     := (p_payload->>'completed_at')::TIMESTAMPTZ;
  v_duration_seconds := (p_payload->>'duration_seconds')::INT;
  v_total_volume     := (p_payload->>'total_volume_lbs')::NUMERIC;
  v_completed_sets   := (p_payload->>'completed_sets')::INT;

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

  INSERT INTO workout_sessions (
    profile_id, gym_id, routine_id, name, status,
    started_at, completed_at, duration_seconds, total_volume_lbs
  ) VALUES (
    v_user_id, v_gym_id, v_routine_id, v_routine_name, 'completed',
    v_started_at, v_completed_at, v_duration_seconds, v_total_volume
  )
  RETURNING id INTO v_session_id;

  FOR v_ex IN SELECT * FROM json_array_elements(p_payload->'exercises')
  LOOP
    INSERT INTO session_exercises (session_id, exercise_id, snapshot_name, position)
    VALUES (v_session_id, v_ex->>'exercise_id', v_ex->>'name', (v_ex->>'position')::INT)
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
        suggested_weight_lbs, suggested_reps, rpe, notes
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

  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;
      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

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

  -- ── Streak calculation ───────────────────────────────────────────────────
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
    IF v_existing_streak.last_activity_date = v_today THEN
      v_new_streak  := v_existing_streak.current_streak_days;
      v_new_longest := v_existing_streak.longest_streak_days;
      v_streak_broken_at := v_existing_streak.streak_broken_at;

    ELSIF v_existing_streak.last_activity_date = v_today - 1 THEN
      v_new_streak  := v_existing_streak.current_streak_days + 1;
      v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
      v_streak_broken_at := NULL;

    ELSE
      SELECT preferred_training_days INTO v_training_days FROM profiles WHERE id = v_user_id;

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
        WHERE gym_id = v_gym_id AND is_closed = TRUE
      ), '{}') INTO v_gym_closed_dows;

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

      SELECT COALESCE(ARRAY(
        SELECT UNNEST(frozen_dates)
          FROM streak_freezes
         WHERE profile_id = v_user_id
           AND frozen_dates IS NOT NULL
      ), '{}') INTO v_frozen_dates;

      v_streak_broken := FALSE;
      v_gap_date := v_existing_streak.last_activity_date + 1;

      WHILE v_gap_date < v_today AND NOT v_streak_broken LOOP
        IF NOT public._streak_gap_day_protected(
          v_gap_date,
          v_existing_streak.last_activity_date,
          v_today,
          v_training_dow,
          v_gym_closed_dows,
          v_closure_dates,
          v_frozen_dates
        ) THEN
          v_streak_broken := TRUE;
        END IF;
        v_gap_date := v_gap_date + 1;
      END LOOP;

      IF v_streak_broken THEN
        v_new_streak  := 1;
        v_new_longest := v_existing_streak.longest_streak_days;
        -- CHANGED: record the LAST training day before the gap, not v_now.
        -- "Última perdida" should answer "when did my streak end?" — that's
        -- the last day they actually trained.
        v_streak_broken_at := v_existing_streak.last_activity_date::TIMESTAMPTZ;
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

  UPDATE profiles SET last_active_at = v_now WHERE id = v_user_id;

  v_xp_earned := v_xp_earned + C_WORKOUT_XP;
  PERFORM add_reward_points(v_user_id, v_gym_id, 'workout_completed', C_WORKOUT_XP,
    'Completed ' || v_routine_name);

  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_xp_earned := v_xp_earned + C_PR_XP;
      PERFORM add_reward_points(v_user_id, v_gym_id, 'pr_hit', C_PR_XP,
        'New PR: ' || (v_pr->>'exercise_name'));
    END LOOP;
  END IF;

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

  IF v_new_streak = 7 THEN
    v_xp_earned := v_xp_earned + C_STREAK7_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_7', C_STREAK7_XP, '7-day streak!');
  ELSIF v_new_streak = 30 THEN
    v_xp_earned := v_xp_earned + C_STREAK30_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_30', C_STREAK30_XP, '30-day streak!');
  END IF;

  DELETE FROM session_drafts
   WHERE profile_id = v_user_id
     AND routine_id = v_routine_id;

  RETURN json_build_object(
    'session_id', v_session_id,
    'xp_earned',  v_xp_earned,
    'streak',     v_new_streak
  );
END;
$$;


-- ── Patched check_daily_streaks ─────────────────────────────────────────────
-- Same patches: fallback rest-day window + record last_activity_date as
-- streak_broken_at instead of now().

CREATE OR REPLACE FUNCTION public.check_daily_streaks()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user            RECORD;
  v_training_dow    INT[];
  v_gym_closed_dows INT[];
  v_closure_dates   DATE[];
  v_frozen_dates    DATE[];
  v_gap_date        DATE;
  v_streak_broken   BOOLEAN;
  v_last_protected_date DATE;
  v_today           DATE := CURRENT_DATE;
  v_yesterday       DATE := CURRENT_DATE - 1;
  v_broken_count    INT := 0;
  v_skipped_count   INT := 0;
BEGIN
  FOR v_user IN
    SELECT sc.profile_id, sc.gym_id, sc.current_streak_days, sc.last_activity_date,
           p.preferred_training_days
    FROM streak_cache sc
    JOIN profiles p ON p.id = sc.profile_id
    WHERE sc.current_streak_days > 0
      AND sc.last_activity_date < v_yesterday
  LOOP
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

    SELECT COALESCE(ARRAY(
      SELECT UNNEST(frozen_dates)
        FROM streak_freezes
       WHERE profile_id = v_user.profile_id
         AND frozen_dates IS NOT NULL
    ), '{}') INTO v_frozen_dates;

    v_streak_broken       := FALSE;
    v_last_protected_date := v_user.last_activity_date;
    v_gap_date            := v_user.last_activity_date + 1;

    WHILE v_gap_date < v_today AND NOT v_streak_broken LOOP
      IF public._streak_gap_day_protected(
        v_gap_date,
        v_user.last_activity_date,
        v_today,
        v_training_dow,
        v_gym_closed_dows,
        v_closure_dates,
        v_frozen_dates
      ) THEN
        v_last_protected_date := v_gap_date;
      ELSE
        v_streak_broken := TRUE;
      END IF;
      v_gap_date := v_gap_date + 1;
    END LOOP;

    IF v_streak_broken THEN
      UPDATE streak_cache SET
        current_streak_days = 0,
        -- CHANGED: record last training day before the gap, not now()
        streak_broken_at    = v_user.last_activity_date::TIMESTAMPTZ,
        updated_at          = now()
      WHERE profile_id = v_user.profile_id;
      v_broken_count := v_broken_count + 1;
    ELSE
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
    'streaks_broken',  v_broken_count,
    'users_protected', v_skipped_count,
    'checked_at',      now()
  );
END;
$$;

-- ── Backfill: clear stale streak_broken_at for active streaks ─────────────
-- Before this migration, streak_broken_at was sometimes set to "today"
-- when a user came back from a gap. After the patch, "today" still refers
-- to the new fix-day's start, but rows already in the table can have
-- streak_broken_at populated even though current_streak_days > 0 — which
-- looks wrong on the UI ("Última perdida: today" while the streak counter
-- reads ≥1 day). For any user whose streak is currently active (trained
-- within the last day), null out the stale broken_at.
UPDATE streak_cache
   SET streak_broken_at = NULL,
       updated_at       = NOW()
 WHERE current_streak_days >= 1
   AND last_activity_date >= CURRENT_DATE - 1
   AND streak_broken_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
