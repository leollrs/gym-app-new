-- 0329_inclusive_improved_and_checkins.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Two leaderboard fixes for gyms that don't have 2 weeks of history yet, or
-- whose members work out via the app without explicit QR/GPS check-ins:
--
--  1. get_leaderboard_most_improved
--     OLD behaviour: filtered out everyone with `previous_value = 0`. New
--     gyms / new members had no baseline, so "Most Improved" was always empty
--     even when this week was very active. The score was a percentage which
--     blew up to 7-figure numbers when the divisor was 1 (GREATEST(prev, 1)).
--
--     NEW behaviour: include anyone whose current period activity is greater
--     than the previous period. Score is the absolute delta (lbs lifted or
--     sessions completed), not a percentage. Newcomers count fully — a user
--     who lifted 7,610 lbs this week with no baseline scores 7610 (raw),
--     not 761,000 (a meaningless %). The client renders the score with the
--     metric's unit (e.g. "+7,610 lbs", "+4 sessions").
--
--  2. get_leaderboard_checkins
--     OLD behaviour: counted only rows in the `check_ins` table (QR scans,
--     GPS auto-checkins, manual button). Members who completed a workout via
--     the app but never explicitly checked in showed 0 — even though the
--     workout itself implies they were at the gym.
--
--     NEW behaviour: count distinct calendar days from `check_ins` UNION
--     completed `workout_sessions`. Working out IS attendance. Score = total
--     unique days the member was at the gym in the period.
-- ─────────────────────────────────────────────────────────────────────────────

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
        -- Score is the absolute delta (lbs gained), not a percentage.
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
          AND p.leaderboard_visible = TRUE
          AND ws.started_at >= v_prev_start
          AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
        GROUP BY ws.profile_id, p.full_name, p.avatar_url, mo.fitness_level
      ) combined
      WHERE combined.current_value > combined.previous_value  -- must have actually grown
      ORDER BY (combined.current_value - combined.previous_value) DESC
      LIMIT p_limit
    ) t;
  ELSE
    -- workouts metric — sessions completed, delta-based score
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
          AND p.leaderboard_visible = TRUE
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


-- ─────────────────────────────────────────────────────────────────────────────
-- Inclusive check-ins: count distinct days from check_ins ∪ completed workouts
-- ─────────────────────────────────────────────────────────────────────────────

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
      -- Combine explicit check-ins and completed workouts, keeping only the
      -- distinct calendar day per member so a member who both checks in
      -- AND finishes a workout on the same day counts once.
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
    WHERE p.leaderboard_visible = TRUE
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    ORDER BY attendance.day_count DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_most_improved(UUID, TEXT, TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_checkins(UUID, TIMESTAMPTZ, TEXT, INT) TO authenticated;
