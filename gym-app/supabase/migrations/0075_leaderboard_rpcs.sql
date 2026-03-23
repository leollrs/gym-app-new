-- Server-side aggregation RPCs for leaderboards.
-- Replaces client-side forEach loops that fetch all rows and aggregate in JS.

-- ── Volume / Workout Count leaderboard ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_leaderboard_volume(
  p_gym_id    UUID,
  p_metric    TEXT DEFAULT 'volume',   -- 'volume' or 'workouts'
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_limit     INT DEFAULT 20
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
        ROUND(SUM(ws.total_volume_lbs)::numeric) AS score
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
      GROUP BY ws.profile_id, p.full_name, p.avatar_url
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  ELSE
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        ws.profile_id AS id,
        p.full_name AS name,
        p.avatar_url AS avatar,
        COUNT(*)::int AS score
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
      GROUP BY ws.profile_id, p.full_name, p.avatar_url
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  END IF;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── PR Count leaderboard (admin) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_leaderboard_prs(
  p_gym_id     UUID,
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
  result JSON;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      ph.profile_id AS id,
      p.full_name AS name,
      COUNT(*)::int AS score
    FROM pr_history ph
    JOIN profiles p ON p.id = ph.profile_id
    WHERE ph.gym_id = p_gym_id
      AND (p_start_date IS NULL OR ph.achieved_at >= p_start_date)
    GROUP BY ph.profile_id, p.full_name
    ORDER BY score DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_volume(UUID, TEXT, TIMESTAMPTZ, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_prs(UUID, TIMESTAMPTZ, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
