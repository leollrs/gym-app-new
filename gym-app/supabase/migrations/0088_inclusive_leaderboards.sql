-- =============================================================
-- INCLUSIVE LEADERBOARD REDESIGN
-- Migration: 0088_inclusive_leaderboards.sql
--
-- Adds: opt-out visibility, milestone events, tier filtering,
-- Most Improved / Consistency / Check-In / Newcomer boards.
-- =============================================================

-- ── 1. Opt-out visibility column ────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS leaderboard_visible BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 2. Milestone events table ───────────────────────────────

CREATE TABLE IF NOT EXISTS milestone_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,  -- 'workout_count', 'streak', 'first_pr', 'pr_count'
    data        JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestone_gym_created
  ON milestone_events(gym_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_milestone_profile
  ON milestone_events(profile_id, created_at DESC);

ALTER TABLE milestone_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read own gym milestones"
  ON milestone_events FOR SELECT
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid()));

-- ── 3. Modified: get_leaderboard_volume (add tier + visibility) ──

CREATE OR REPLACE FUNCTION public.get_leaderboard_volume(
  p_gym_id     UUID,
  p_metric     TEXT DEFAULT 'volume',
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_limit      INT DEFAULT 20,
  p_tier       TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF p_metric = 'volume' THEN
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        ws.profile_id AS id,
        p.full_name AS name,
        p.avatar_url AS avatar,
        ROUND(SUM(ws.total_volume_lbs)::numeric) AS score,
        mo.fitness_level AS tier
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      LEFT JOIN member_onboarding mo ON mo.profile_id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND p.leaderboard_visible = TRUE
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
        AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
      GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  ELSE
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        ws.profile_id AS id,
        p.full_name AS name,
        p.avatar_url AS avatar,
        COUNT(*)::int AS score,
        mo.fitness_level AS tier
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      LEFT JOIN member_onboarding mo ON mo.profile_id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND p.leaderboard_visible = TRUE
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
        AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
      GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  END IF;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── 4. Modified: get_leaderboard_prs (add tier + visibility) ──

CREATE OR REPLACE FUNCTION public.get_leaderboard_prs(
  p_gym_id     UUID,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_limit      INT DEFAULT 20,
  p_tier       TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      ph.profile_id AS id,
      p.full_name AS name,
      p.avatar_url AS avatar,
      COUNT(*)::int AS score,
      mo.fitness_level AS tier
    FROM pr_history ph
    JOIN profiles p ON p.id = ph.profile_id
    LEFT JOIN member_onboarding mo ON mo.profile_id = ph.profile_id
    WHERE ph.gym_id = p_gym_id
      AND p.leaderboard_visible = TRUE
      AND (p_start_date IS NULL OR ph.achieved_at >= p_start_date)
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    GROUP BY ph.profile_id, p.full_name, p.avatar_url, mo.fitness_level
    ORDER BY score DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── 5. New: get_leaderboard_most_improved ───────────────────

CREATE OR REPLACE FUNCTION public.get_leaderboard_most_improved(
  p_gym_id  UUID,
  p_metric  TEXT DEFAULT 'volume',   -- 'volume' or 'workouts'
  p_period  TEXT DEFAULT 'monthly',  -- 'weekly' or 'monthly'
  p_tier    TEXT DEFAULT NULL,
  p_limit   INT DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result       JSON;
  v_now        TIMESTAMPTZ := NOW();
  v_curr_start TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end   TIMESTAMPTZ;
BEGIN
  -- Calculate period boundaries
  IF p_period = 'weekly' THEN
    v_curr_start := v_now - INTERVAL '7 days';
    v_prev_start := v_now - INTERVAL '14 days';
    v_prev_end   := v_now - INTERVAL '7 days';
  ELSE
    v_curr_start := v_now - INTERVAL '30 days';
    v_prev_start := v_now - INTERVAL '60 days';
    v_prev_end   := v_now - INTERVAL '30 days';
  END IF;

  IF p_metric = 'volume' THEN
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        combined.id,
        combined.name,
        combined.avatar,
        combined.tier,
        combined.current_value,
        combined.previous_value,
        ROUND(((combined.current_value - combined.previous_value)
          / GREATEST(combined.previous_value, 1)) * 100) AS score
      FROM (
        SELECT
          ws.profile_id AS id,
          p.full_name AS name,
          p.avatar_url AS avatar,
          mo.fitness_level AS tier,
          COALESCE(SUM(CASE WHEN ws.started_at >= v_curr_start
            THEN ws.total_volume_lbs ELSE 0 END), 0) AS current_value,
          COALESCE(SUM(CASE WHEN ws.started_at >= v_prev_start AND ws.started_at < v_prev_end
            THEN ws.total_volume_lbs ELSE 0 END), 0) AS previous_value
        FROM workout_sessions ws
        JOIN profiles p ON p.id = ws.profile_id
        LEFT JOIN member_onboarding mo ON mo.profile_id = ws.profile_id
        WHERE ws.gym_id = p_gym_id
          AND ws.status = 'completed'
          AND p.leaderboard_visible = TRUE
          AND ws.started_at >= v_prev_start
          AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
        GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ) combined
      WHERE combined.previous_value > 0  -- must have activity in previous period
        AND combined.current_value > combined.previous_value  -- must have improved
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  ELSE
    -- workouts metric
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        combined.id,
        combined.name,
        combined.avatar,
        combined.tier,
        combined.current_value,
        combined.previous_value,
        ROUND(((combined.current_value - combined.previous_value)::numeric
          / GREATEST(combined.previous_value, 1)) * 100) AS score
      FROM (
        SELECT
          ws.profile_id AS id,
          p.full_name AS name,
          p.avatar_url AS avatar,
          mo.fitness_level AS tier,
          COUNT(CASE WHEN ws.started_at >= v_curr_start THEN 1 END)::numeric AS current_value,
          COUNT(CASE WHEN ws.started_at >= v_prev_start AND ws.started_at < v_prev_end THEN 1 END)::numeric AS previous_value
        FROM workout_sessions ws
        JOIN profiles p ON p.id = ws.profile_id
        LEFT JOIN member_onboarding mo ON mo.profile_id = ws.profile_id
        WHERE ws.gym_id = p_gym_id
          AND ws.status = 'completed'
          AND p.leaderboard_visible = TRUE
          AND ws.started_at >= v_prev_start
          AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
        GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ) combined
      WHERE combined.previous_value > 0
        AND combined.current_value > combined.previous_value
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  END IF;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── 6. New: get_leaderboard_consistency ─────────────────────

CREATE OR REPLACE FUNCTION public.get_leaderboard_consistency(
  p_gym_id  UUID,
  p_period  TEXT DEFAULT 'monthly',  -- 'weekly' or 'monthly'
  p_tier    TEXT DEFAULT NULL,
  p_limit   INT DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result       JSON;
  v_start_date TIMESTAMPTZ;
  v_days       INT;
BEGIN
  IF p_period = 'weekly' THEN
    v_start_date := NOW() - INTERVAL '7 days';
    v_days := 7;
  ELSE
    v_start_date := NOW() - INTERVAL '30 days';
    v_days := 30;
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      ws.profile_id AS id,
      p.full_name AS name,
      p.avatar_url AS avatar,
      mo.fitness_level AS tier,
      mo.training_days_per_week AS planned_days,
      COUNT(DISTINCT DATE(ws.started_at))::int AS actual_days,
      LEAST(
        ROUND(
          (COUNT(DISTINCT DATE(ws.started_at))::numeric
            / GREATEST(
                ROUND(mo.training_days_per_week * v_days / 7.0),
                1
              )) * 100
        ),
        100
      )::int AS score
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    JOIN member_onboarding mo ON mo.profile_id = ws.profile_id
    WHERE ws.gym_id = p_gym_id
      AND ws.status = 'completed'
      AND p.leaderboard_visible = TRUE
      AND ws.started_at >= v_start_date
      AND mo.training_days_per_week IS NOT NULL
      AND mo.training_days_per_week > 0
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level, mo.training_days_per_week
    ORDER BY score DESC, actual_days DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── 7. New: get_leaderboard_checkins ────────────────────────

CREATE OR REPLACE FUNCTION public.get_leaderboard_checkins(
  p_gym_id     UUID,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_tier       TEXT DEFAULT NULL,
  p_limit      INT DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      ci.profile_id AS id,
      p.full_name AS name,
      p.avatar_url AS avatar,
      COUNT(*)::int AS score,
      mo.fitness_level AS tier
    FROM check_ins ci
    JOIN profiles p ON p.id = ci.profile_id
    LEFT JOIN member_onboarding mo ON mo.profile_id = ci.profile_id
    WHERE ci.gym_id = p_gym_id
      AND p.leaderboard_visible = TRUE
      AND (p_start_date IS NULL OR ci.checked_in_at >= p_start_date)
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    GROUP BY ci.profile_id, p.full_name, p.avatar_url, mo.fitness_level
    ORDER BY score DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── 8. New: get_leaderboard_newcomers ───────────────────────
-- Same as volume/workouts but only members who joined within last 60 days

CREATE OR REPLACE FUNCTION public.get_leaderboard_newcomers(
  p_gym_id     UUID,
  p_metric     TEXT DEFAULT 'volume',
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_limit      INT DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result      JSON;
  v_cutoff    TIMESTAMPTZ := NOW() - INTERVAL '60 days';
BEGIN
  IF p_metric = 'volume' THEN
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        ws.profile_id AS id,
        p.full_name AS name,
        p.avatar_url AS avatar,
        ROUND(SUM(ws.total_volume_lbs)::numeric) AS score,
        mo.fitness_level AS tier
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      LEFT JOIN member_onboarding mo ON mo.profile_id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND p.leaderboard_visible = TRUE
        AND p.created_at >= v_cutoff
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
      GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  ELSE
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        ws.profile_id AS id,
        p.full_name AS name,
        p.avatar_url AS avatar,
        COUNT(*)::int AS score,
        mo.fitness_level AS tier
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      LEFT JOIN member_onboarding mo ON mo.profile_id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND p.leaderboard_visible = TRUE
        AND p.created_at >= v_cutoff
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
      GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  END IF;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── 9. New: get_milestone_feed ──────────────────────────────

CREATE OR REPLACE FUNCTION public.get_milestone_feed(
  p_gym_id UUID,
  p_limit  INT DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      me.id,
      me.profile_id,
      p.full_name AS name,
      p.avatar_url AS avatar,
      me.type,
      me.data,
      me.created_at
    FROM milestone_events me
    JOIN profiles p ON p.id = me.profile_id
    WHERE me.gym_id = p_gym_id
      AND p.leaderboard_visible = TRUE
    ORDER BY me.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── 10. Extend complete_workout to emit milestones ──────────

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

  -- XP
  v_xp_earned        INT := 0;
  v_week_start       TIMESTAMPTZ;
  v_week_count       INT;

  -- feed
  v_exercises_with_sets INT := 0;

  -- milestones
  v_total_workouts   INT;
  v_total_prs        INT;
  v_is_first_pr      BOOLEAN;

  -- constants
  C_WORKOUT_XP       CONSTANT INT := 50;
  C_PR_XP            CONSTANT INT := 100;
  C_WEEKLY_XP        CONSTANT INT := 25;
  C_STREAK7_XP       CONSTANT INT := 200;
  C_STREAK30_XP      CONSTANT INT := 1000;
BEGIN
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
      (v_ex->>'exercise_id')::UUID,
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

      -- Check if this is the user's first PR for this exercise
      SELECT NOT EXISTS(
        SELECT 1 FROM pr_history
        WHERE profile_id = v_user_id
          AND exercise_id = (v_pr->>'exercise_id')::UUID
      ) INTO v_is_first_pr;

      INSERT INTO personal_records (
        profile_id, gym_id, exercise_id,
        weight_lbs, reps, estimated_1rm,
        achieved_at, session_id, updated_at
      ) VALUES (
        v_user_id, v_gym_id, (v_pr->>'exercise_id')::UUID,
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
        v_user_id, v_gym_id, (v_pr->>'exercise_id')::UUID,
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
        ));
      END IF;
    END LOOP;

    -- Milestone: PR count thresholds
    SELECT COUNT(*) INTO v_total_prs FROM pr_history WHERE profile_id = v_user_id;
    IF v_total_prs IN (10, 25, 50, 100, 200, 500) THEN
      INSERT INTO milestone_events (gym_id, profile_id, type, data)
      VALUES (v_gym_id, v_user_id, 'pr_count', jsonb_build_object(
        'count', v_total_prs
      ));
    END IF;
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

  -- ── 6. Streak cache ───────────────────────────────────────────────────────
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
    v_day_gap := CASE
      WHEN v_existing_streak.last_activity_date IS NOT NULL
      THEN (v_today - v_existing_streak.last_activity_date)::INT
      ELSE 999
    END;

    IF v_day_gap <= 1 THEN
      v_new_streak := CASE
        WHEN v_day_gap = 0 THEN v_existing_streak.current_streak_days
        ELSE v_existing_streak.current_streak_days + 1
      END;
      v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
      v_streak_broken_at := NULL;
    ELSE
      v_new_streak := 1;
      v_new_longest := v_existing_streak.longest_streak_days;
      v_streak_broken_at := COALESCE(v_existing_streak.streak_broken_at, v_now);
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

  -- ── 10. Streak milestones (XP + milestone events) ─────────────────────────
  IF v_new_streak = 7 THEN
    v_xp_earned := v_xp_earned + C_STREAK7_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_7', C_STREAK7_XP, '7-day streak!');
    INSERT INTO milestone_events (gym_id, profile_id, type, data)
    VALUES (v_gym_id, v_user_id, 'streak', jsonb_build_object('days', 7));
  ELSIF v_new_streak = 14 THEN
    INSERT INTO milestone_events (gym_id, profile_id, type, data)
    VALUES (v_gym_id, v_user_id, 'streak', jsonb_build_object('days', 14));
  ELSIF v_new_streak = 30 THEN
    v_xp_earned := v_xp_earned + C_STREAK30_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_30', C_STREAK30_XP, '30-day streak!');
    INSERT INTO milestone_events (gym_id, profile_id, type, data)
    VALUES (v_gym_id, v_user_id, 'streak', jsonb_build_object('days', 30));
  ELSIF v_new_streak = 60 THEN
    INSERT INTO milestone_events (gym_id, profile_id, type, data)
    VALUES (v_gym_id, v_user_id, 'streak', jsonb_build_object('days', 60));
  ELSIF v_new_streak = 90 THEN
    INSERT INTO milestone_events (gym_id, profile_id, type, data)
    VALUES (v_gym_id, v_user_id, 'streak', jsonb_build_object('days', 90));
  ELSIF v_new_streak = 365 THEN
    INSERT INTO milestone_events (gym_id, profile_id, type, data)
    VALUES (v_gym_id, v_user_id, 'streak', jsonb_build_object('days', 365));
  END IF;

  -- ── 11. Workout count milestones ──────────────────────────────────────────
  SELECT COUNT(*) INTO v_total_workouts
    FROM workout_sessions
   WHERE profile_id = v_user_id AND status = 'completed';

  IF v_total_workouts IN (1, 10, 25, 50, 100, 200, 500, 1000) THEN
    INSERT INTO milestone_events (gym_id, profile_id, type, data)
    VALUES (v_gym_id, v_user_id, 'workout_count', jsonb_build_object(
      'count', v_total_workouts
    ));
  END IF;

  -- ── 12. Delete session draft ──────────────────────────────────────────────
  DELETE FROM session_drafts
   WHERE profile_id = v_user_id
     AND routine_id = v_routine_id;

  -- ── 13. Return summary ────────────────────────────────────────────────────
  RETURN json_build_object(
    'session_id', v_session_id,
    'xp_earned',  v_xp_earned,
    'streak',     v_new_streak
  );
END;
$$;

-- ── 11. Grants ──────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.get_leaderboard_volume(UUID, TEXT, TIMESTAMPTZ, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_prs(UUID, TIMESTAMPTZ, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_most_improved(UUID, TEXT, TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_consistency(UUID, TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_checkins(UUID, TIMESTAMPTZ, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_newcomers(UUID, TEXT, TIMESTAMPTZ, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_milestone_feed(UUID, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
