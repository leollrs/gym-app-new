-- ============================================================
-- 0389 — Leaderboards: always include the requesting user
-- ============================================================
-- Symptom from the field: a member completes a workout but never sees
-- themselves on Volume / Workouts / Most Improved / PRs / Check-ins /
-- Consistency / Newcomers leaderboards. Only their friend appears.
--
-- Root cause: every leaderboard RPC filters by `p.leaderboard_visible
-- = TRUE`. When a member has the privacy toggle off (or it was set to
-- FALSE by some past migration / admin action), their own row is
-- removed from results — including their own view.
--
-- Fix: include `auth.uid()` regardless of the flag, so a user always
-- sees themselves on their own leaderboard view while other members
-- with `leaderboard_visible = FALSE` still stay hidden from everyone
-- (including each other).
--
-- Pattern: every `AND p.leaderboard_visible = TRUE` becomes
-- `AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())`.
--
-- Function bodies are otherwise unchanged from the latest definitions
-- (most-improved and check-ins from 0329, the rest from 0224).
-- ============================================================

-- ── get_leaderboard_volume ──────────────────────────────────────
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
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    p_limit := 20;
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
        AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
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
        AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
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

-- ── get_leaderboard_prs ─────────────────────────────────────────
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
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    p_limit := 20;
  END IF;

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
      AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
      AND (p_start_date IS NULL OR ph.achieved_at >= p_start_date)
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    GROUP BY ph.profile_id, p.full_name, p.avatar_url, mo.fitness_level
    ORDER BY score DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── get_leaderboard_most_improved ───────────────────────────────
-- Body from 0329 (delta-based score) with visibility loosened.
CREATE OR REPLACE FUNCTION public.get_leaderboard_most_improved(
  p_gym_id  UUID,
  p_metric  TEXT DEFAULT 'volume',
  p_period  TEXT DEFAULT 'monthly',
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
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

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
        ROUND(combined.current_value - combined.previous_value)::int AS score
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
          AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
          AND ws.started_at >= v_prev_start
          AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
        GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ) combined
      WHERE combined.current_value > combined.previous_value
      ORDER BY (combined.current_value - combined.previous_value) DESC
      LIMIT p_limit
    ) t;
  ELSE
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        combined.id,
        combined.name,
        combined.avatar,
        combined.tier,
        combined.current_value,
        combined.previous_value,
        (combined.current_value - combined.previous_value)::int AS score
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
          AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
          AND ws.started_at >= v_prev_start
          AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
        GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ) combined
      WHERE combined.current_value > combined.previous_value
      ORDER BY (combined.current_value - combined.previous_value) DESC
      LIMIT p_limit
    ) t;
  END IF;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── get_leaderboard_consistency ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_leaderboard_consistency(
  p_gym_id  UUID,
  p_period  TEXT DEFAULT 'monthly',
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
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
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
      AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
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

-- ── get_leaderboard_checkins ────────────────────────────────────
-- Body from 0329 (workout-sessions UNION check-ins) with visibility loosened.
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
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      attendance.profile_id AS id,
      p.full_name AS name,
      p.avatar_url AS avatar,
      attendance.day_count::int AS score,
      mo.fitness_level AS tier
    FROM (
      SELECT profile_id, COUNT(DISTINCT day) AS day_count
      FROM (
        SELECT ci.profile_id, DATE(ci.checked_in_at) AS day
        FROM check_ins ci
        WHERE ci.gym_id = p_gym_id
          AND (p_start_date IS NULL OR ci.checked_in_at >= p_start_date)
        UNION ALL
        SELECT ws.profile_id, DATE(ws.completed_at) AS day
        FROM workout_sessions ws
        WHERE ws.gym_id = p_gym_id
          AND ws.status = 'completed'
          AND ws.completed_at IS NOT NULL
          AND (p_start_date IS NULL OR ws.completed_at >= p_start_date)
      ) combined
      GROUP BY profile_id
    ) attendance
    JOIN profiles p ON p.id = attendance.profile_id
    LEFT JOIN member_onboarding mo ON mo.profile_id = attendance.profile_id
    WHERE (p.leaderboard_visible = TRUE OR p.id = auth.uid())
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    ORDER BY attendance.day_count DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── get_leaderboard_newcomers ───────────────────────────────────
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
  result   JSON;
  v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '60 days';
BEGIN
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
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
        AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
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
        AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
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

-- ── get_milestone_feed ──────────────────────────────────────────
-- Same loosening for the milestone feed used on the Leaderboard page.
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
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
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
      AND (p.leaderboard_visible = TRUE OR p.id = auth.uid())
    ORDER BY me.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

NOTIFY pgrst, 'reload schema';
