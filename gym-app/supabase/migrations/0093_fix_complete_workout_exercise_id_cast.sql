-- Fix: exercise_id columns are TEXT, not UUID.
-- The complete_workout RPC was incorrectly casting exercise_id to UUID
-- which fails for TEXT-based exercise IDs like 'ex_sq', 'ex_bp', etc.

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
  v_streak        INT := 0;
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

      -- Check if this is the user's first PR for this exercise
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

      -- Milestone: first PR on this exercise
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

  -- Upsert reward_points
  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points)
  VALUES (v_user_id, v_gym_id, v_xp_earned, v_xp_earned)
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points + v_xp_earned,
    lifetime_points = reward_points.lifetime_points + v_xp_earned,
    last_updated    = v_now;

  -- ── 6. Update last_active_at ──────────────────────────────────────────────
  UPDATE profiles SET last_active_at = v_now WHERE id = v_user_id;

  -- ── 7. Calculate streak ───────────────────────────────────────────────────
  SELECT COALESCE(current_streak_days, 0) INTO v_streak
  FROM streak_cache WHERE profile_id = v_user_id;

  RETURN json_build_object(
    'session_id', v_session_id,
    'xp_earned', v_xp_earned,
    'streak', v_streak,
    'exercises_logged', v_exercises_with_sets,
    'sets_logged', v_total_sets
  );
END;
$$;
