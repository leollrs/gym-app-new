-- =============================================================
-- 0433_platform_gym_activity_pulse.sql
--
-- Member-activity tracking for the platform console. The platform already
-- tracks admin engagement (admin_presence) and system health, but nothing
-- watched MEMBER activity per gym — the leading indicator of gym churn.
-- These two RPCs fill that:
--
--   platform_gym_activity_pulse(window_days) — per gym, member activity in
--     the current window vs the immediately-preceding window of equal length,
--     plus the true last-activity timestamp. Powers the "Gyms going quiet"
--     watchlist on the Gym Health page (rank by decline / silence).
--
--   gym_activity_daily(gym, days) — per-gym daily check-in + completed-workout
--     counts, bucketed in the gym's local timezone. Powers the activity trend
--     chart on the gym detail Activity tab.
--
-- Both are super_admin-only (platform pattern, 0424). They aggregate
-- server-side (GROUP BY) so the client doesn't pull every row. The
-- last-activity MAX scans the full table per gym — fine at current scale;
-- revisit with a per-gym rollup table if check_ins/workout_sessions grow huge.
-- =============================================================

-- ── Cross-gym activity pulse (current vs prior window) ──────
CREATE OR REPLACE FUNCTION public.platform_gym_activity_pulse(p_window_days INT DEFAULT 14)
RETURNS TABLE (
  gym_id          UUID,
  gym_name        TEXT,
  cur_checkins    BIGINT,
  prior_checkins  BIGINT,
  cur_workouts    BIGINT,
  prior_workouts  BIGINT,
  last_activity   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur   TIMESTAMPTZ := now() - make_interval(days => p_window_days);
  v_prior TIMESTAMPTZ := now() - make_interval(days => p_window_days * 2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  WITH ci AS (
    SELECT c.gym_id,
      COUNT(*) FILTER (WHERE c.checked_in_at >= v_cur)                                  AS cur_n,
      COUNT(*) FILTER (WHERE c.checked_in_at >= v_prior AND c.checked_in_at < v_cur)     AS prior_n
    FROM check_ins c
    WHERE c.checked_in_at >= v_prior
    GROUP BY c.gym_id
  ),
  ws AS (
    SELECT s.gym_id,
      COUNT(*) FILTER (WHERE s.started_at >= v_cur)                                 AS cur_n,
      COUNT(*) FILTER (WHERE s.started_at >= v_prior AND s.started_at < v_cur)       AS prior_n
    FROM workout_sessions s
    WHERE s.status = 'completed' AND s.started_at >= v_prior
    GROUP BY s.gym_id
  ),
  last_ci AS (SELECT gym_id, MAX(checked_in_at) AS m FROM check_ins GROUP BY gym_id),
  last_ws AS (SELECT gym_id, MAX(started_at) AS m FROM workout_sessions WHERE status = 'completed' GROUP BY gym_id)
  SELECT
    g.id,
    g.name,
    COALESCE(ci.cur_n, 0),
    COALESCE(ci.prior_n, 0),
    COALESCE(ws.cur_n, 0),
    COALESCE(ws.prior_n, 0),
    GREATEST(lci.m, lws.m)
  FROM gyms g
  LEFT JOIN ci      ON ci.gym_id  = g.id
  LEFT JOIN ws      ON ws.gym_id  = g.id
  LEFT JOIN last_ci lci ON lci.gym_id = g.id
  LEFT JOIN last_ws lws ON lws.gym_id = g.id
  WHERE g.is_active = TRUE
  ORDER BY g.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_gym_activity_pulse(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_gym_activity_pulse(INT) TO authenticated;

-- ── Per-gym daily activity series (gym-local day buckets) ───
CREATE OR REPLACE FUNCTION public.gym_activity_daily(p_gym_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE (
  day       DATE,
  checkins  BIGINT,
  workouts  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz    TEXT;
  v_since TIMESTAMPTZ := now() - make_interval(days => p_days);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = p_gym_id;
  v_tz := COALESCE(v_tz, 'America/Puerto_Rico');

  RETURN QUERY
  SELECT
    gs::date,
    COALESCE(c.n, 0),
    COALESCE(w.n, 0)
  FROM generate_series(
    (timezone(v_tz, now())::date - (p_days - 1)),
    (timezone(v_tz, now())::date),
    INTERVAL '1 day'
  ) gs
  LEFT JOIN (
    SELECT (timezone(v_tz, checked_in_at))::date AS dd, COUNT(*) AS n
    FROM check_ins
    WHERE gym_id = p_gym_id AND checked_in_at >= v_since
    GROUP BY 1
  ) c ON c.dd = gs::date
  LEFT JOIN (
    SELECT (timezone(v_tz, started_at))::date AS dd, COUNT(*) AS n
    FROM workout_sessions
    WHERE gym_id = p_gym_id AND status = 'completed' AND started_at >= v_since
    GROUP BY 1
  ) w ON w.dd = gs::date
  ORDER BY gs::date;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gym_activity_daily(UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.gym_activity_daily(UUID, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
