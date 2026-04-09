-- SECURITY FIX: server-side PR verification in complete_workout
--
-- Problem 1 (S3): complete_workout blindly accepted client-submitted
--   session_prs without checking whether the new value actually exceeds
--   the member's existing record. A malicious client could fake PRs at
--   will, poisoning personal_records and earning unlimited PR XP.
--
-- Problem 2 (S3-bounds): per-set weight/reps were not validated, allowing
--   absurd values (negative weight, 9999 reps) to persist in session_sets
--   and skew 1RM estimates / volume totals.
--
-- Fix:
--   • Before inserting each PR entry, query personal_records for the
--     current best estimated_1rm for that user+exercise. Only proceed if
--     the new estimated_1rm strictly exceeds the stored value (or no
--     record exists yet).
--   • Validate per-set weight (0–2000 lbs) and reps (0–500) before
--     inserting into session_sets.
-- ================================================================

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
  v_pr_count         INT := 0;
  v_existing_1rm     NUMERIC;   -- NEW: current best 1RM for this exercise
  v_verified_prs     INT := 0;  -- NEW: count of PRs that passed verification

  -- streak
  v_existing_streak  RECORD;
  v_new_streak       INT := 1;
  v_new_longest      INT := 1;
  v_day_gap          INT;
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

  -- XP (from gym config)
  v_xp_earned        INT := 0;
  v_week_start       TIMESTAMPTZ;
  v_week_count       INT;
  v_points_cfg       JSONB;
  v_cfg_workout_xp   INT;
  v_cfg_pr_xp        INT;
  v_cfg_pr_max       INT;
  v_cfg_weekly_xp    INT;
  v_cfg_streak7_xp   INT;
  v_cfg_streak30_xp  INT;

  -- feed
  v_exercises_with_sets INT := 0;
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

  -- ── Load gym-specific point values ─────────────────────────────────────────
  v_points_cfg     := get_gym_points(v_gym_id);
  v_cfg_workout_xp := (v_points_cfg->>'workout_base')::INT;
  v_cfg_pr_xp      := (v_points_cfg->>'pr_hit')::INT;
  v_cfg_pr_max     := (v_points_cfg->>'pr_max_per_session')::INT;
  v_cfg_weekly_xp  := (v_points_cfg->>'first_weekly')::INT;
  v_cfg_streak7_xp := (v_points_cfg->>'streak_7')::INT;
  v_cfg_streak30_xp:= (v_points_cfg->>'streak_30')::INT;

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

      -- ── Per-set bounds validation (S3) ──────────────────────────────────────
      IF v_weight < 0 OR v_weight > 2000 THEN
        RAISE EXCEPTION 'Invalid weight for set % of exercise %: must be 0–2000 lbs',
          v_set_number, v_ex->>'name';
      END IF;
      IF v_reps < 0 OR v_reps > 500 THEN
        RAISE EXCEPTION 'Invalid reps for set % of exercise %: must be 0–500',
          v_set_number, v_ex->>'name';
      END IF;

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

  -- ── 4. PRs — server-side verification before upsert ───────────────────────
  -- Only accept a PR if the new estimated_1rm strictly exceeds the member's
  -- current best. This prevents clients from faking PRs.
  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;

      -- Bounds check the PR values as well
      IF v_weight IS NULL OR v_weight <= 0 OR v_weight > 2000 THEN
        CONTINUE; -- skip invalid PR entries silently
      END IF;
      IF v_reps IS NULL OR v_reps <= 0 OR v_reps > 500 THEN
        CONTINUE; -- skip invalid PR entries silently
      END IF;

      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

      -- Fetch the member's current best estimated_1rm for this exercise
      SELECT estimated_1rm
        INTO v_existing_1rm
        FROM personal_records
       WHERE profile_id = v_user_id
         AND exercise_id = (v_pr->>'exercise_id')::TEXT;

      -- Only proceed if no existing record OR new 1RM truly beats the old one
      IF NOT FOUND OR v_estimated_1rm > COALESCE(v_existing_1rm, 0) THEN
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

        v_verified_prs := v_verified_prs + 1;
      END IF;
      -- If the submitted PR does not beat the existing record, skip it silently.
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

  -- Only post PR feed items for verified PRs (those that passed server check)
  IF v_verified_prs > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;
      IF v_weight IS NULL OR v_weight <= 0 OR v_weight > 2000 THEN CONTINUE; END IF;
      IF v_reps IS NULL OR v_reps <= 0 OR v_reps > 500 THEN CONTINUE; END IF;
      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

      -- Only post feed item if this specific PR actually beat the stored record.
      -- Re-query to confirm (the upsert above only ran when the check passed).
      SELECT estimated_1rm INTO v_existing_1rm
        FROM personal_records
       WHERE profile_id = v_user_id
         AND exercise_id = (v_pr->>'exercise_id')::TEXT
         AND session_id  = v_session_id;

      IF FOUND THEN
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
      END IF;
    END LOOP;
  END IF;

  -- ── 6. Smart streak calculation (rest days + closures + freezes) ───────────
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
      v_streak_broken_at := NULL;

    ELSIF v_existing_streak.last_activity_date = v_today - 1 THEN
      v_new_streak  := v_existing_streak.current_streak_days + 1;
      v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
      v_streak_broken_at := NULL;

    ELSE
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

      v_streak_broken := FALSE;
      v_gap_date := v_existing_streak.last_activity_date + 1;

      WHILE v_gap_date < v_today AND NOT v_streak_broken LOOP
        v_gap_dow := EXTRACT(DOW FROM v_gap_date)::INT;

        IF v_gap_date = ANY(v_closure_dates) THEN
          NULL;
        ELSIF v_gap_dow = ANY(v_gym_closed_dows) THEN
          NULL;
        ELSIF array_length(v_training_dow, 1) > 0 AND NOT (v_gap_dow = ANY(v_training_dow)) THEN
          NULL;
        ELSE
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

  -- ── 7. Update profile last_active_at ───────────────────────────────────────
  UPDATE profiles SET last_active_at = v_now WHERE id = v_user_id;

  -- ── 8. Award XP (using gym-specific config) ───────────────────────────────
  v_xp_earned := v_xp_earned + v_cfg_workout_xp;
  PERFORM add_reward_points(v_user_id, v_gym_id, 'workout_completed', v_cfg_workout_xp,
    'Completed ' || v_routine_name);

  -- PR XP — only for verified PRs, capped at pr_max_per_session
  IF v_verified_prs > 0 THEN
    v_pr_count := 0;
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      EXIT WHEN v_pr_count >= v_cfg_pr_max;
      -- Only award XP for entries that passed the server-side check
      SELECT 1 INTO v_existing_1rm  -- reuse variable as existence flag
        FROM personal_records
       WHERE profile_id = v_user_id
         AND exercise_id = (v_pr->>'exercise_id')::TEXT
         AND session_id  = v_session_id;
      IF FOUND THEN
        v_pr_count  := v_pr_count + 1;
        v_xp_earned := v_xp_earned + v_cfg_pr_xp;
        PERFORM add_reward_points(v_user_id, v_gym_id, 'pr_hit', v_cfg_pr_xp,
          'New PR: ' || (v_pr->>'exercise_name'));
      END IF;
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
    v_xp_earned := v_xp_earned + v_cfg_weekly_xp;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'first_weekly_workout', v_cfg_weekly_xp,
      'First workout this week');
  END IF;

  -- ── 10. Streak milestones ─────────────────────────────────────────────────
  IF v_new_streak = 7 THEN
    v_xp_earned := v_xp_earned + v_cfg_streak7_xp;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_7', v_cfg_streak7_xp, '7-day streak!');
  ELSIF v_new_streak = 30 THEN
    v_xp_earned := v_xp_earned + v_cfg_streak30_xp;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_30', v_cfg_streak30_xp, '30-day streak!');
  END IF;

  -- ── 11. Delete session draft ──────────────────────────────────────────────
  DELETE FROM session_drafts
   WHERE profile_id = v_user_id
     AND routine_id = v_routine_id;

  -- ── 12. Return summary ────────────────────────────────────────────────────
  RETURN json_build_object(
    'session_id',    v_session_id,
    'xp_earned',     v_xp_earned,
    'streak',        v_new_streak,
    'verified_prs',  v_verified_prs
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
