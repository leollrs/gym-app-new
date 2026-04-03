-- =============================================================
-- SECURITY FIX: Strict gym boundary enforcement on leaderboard RPCs
-- Migration: 0204_security_fix_leaderboard_gym_boundary.sql
--
-- Five leaderboard RPCs from 0088 accept any p_gym_id without
-- a strict gym boundary check. Migration 0143 added a check but
-- allowed super_admin bypass. This migration enforces a strict
-- boundary with no bypass:
--
--   IF p_gym_id != public.current_gym_id() THEN
--     RAISE EXCEPTION 'Forbidden: gym boundary violation';
--   END IF;
--
-- Functions patched:
--   1. get_leaderboard_most_improved
--   2. get_leaderboard_consistency
--   3. get_leaderboard_checkins
--   4. get_leaderboard_newcomers
--   5. get_milestone_feed
--
-- Skipped (already have gym boundary check from 0098):
--   - get_leaderboard_volume
--   - get_leaderboard_prs
-- =============================================================

-- ── 1. get_leaderboard_most_improved ──────────────────────────

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
  -- Gym boundary check
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

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

-- ── 2. get_leaderboard_consistency ────────────────────────────

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
  -- Gym boundary check
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

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

-- ── 3. get_leaderboard_checkins ───────────────────────────────

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
  -- Gym boundary check
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

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

-- ── 4. get_leaderboard_newcomers ──────────────────────────────

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
  -- Gym boundary check
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

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

-- ── 5. get_milestone_feed ─────────────────────────────────────

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
  -- Gym boundary check
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

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

NOTIFY pgrst, 'reload schema';
