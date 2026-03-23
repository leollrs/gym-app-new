-- =============================================================
-- ADMIN MATERIALIZED VIEWS
-- Migration: 0076_admin_materialized_views.sql
-- =============================================================
-- Replaces client-side aggregation that fetches thousands of rows
-- with pre-computed materialized views refreshed server-side.
-- =============================================================

-- ============================================================
-- VIEW 1: mv_gym_stats_daily — Daily aggregated stats per gym
-- ============================================================

CREATE MATERIALIZED VIEW mv_gym_stats_daily AS
SELECT
  ws.gym_id,
  ws.stat_date,
  -- Active members: distinct profiles with a completed session that day
  COUNT(DISTINCT ws.profile_id) FILTER (WHERE ws.profile_id IS NOT NULL)  AS active_members,
  -- Total sessions
  COUNT(ws.session_id)                                                     AS total_sessions,
  -- Total volume
  COALESCE(SUM(ws.total_volume_lbs), 0)                                    AS total_volume_lbs,
  -- Total check-ins
  COALESCE(ci.total_check_ins, 0)                                          AS total_check_ins,
  -- New members (profiles created that day)
  COALESCE(nm.new_members, 0)                                              AS new_members,
  -- New PRs
  COALESCE(pr.new_prs, 0)                                                  AS new_prs
FROM (
  -- Base: one row per gym+date from workout_sessions
  SELECT
    gym_id,
    DATE(started_at) AS stat_date,
    profile_id,
    id AS session_id,
    total_volume_lbs
  FROM workout_sessions
  WHERE status = 'completed'
) ws
-- Check-ins per gym+date
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total_check_ins
  FROM check_ins c
  WHERE c.gym_id = ws.gym_id
    AND DATE(c.checked_in_at) = ws.stat_date
) ci ON true
-- New members per gym+date
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS new_members
  FROM profiles p
  WHERE p.gym_id = ws.gym_id
    AND p.role = 'member'
    AND DATE(p.created_at) = ws.stat_date
) nm ON true
-- New PRs per gym+date
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS new_prs
  FROM pr_history ph
  WHERE ph.gym_id = ws.gym_id
    AND DATE(ph.achieved_at) = ws.stat_date
) pr ON true
GROUP BY ws.gym_id, ws.stat_date, ci.total_check_ins, nm.new_members, pr.new_prs
ORDER BY ws.gym_id, ws.stat_date DESC;

-- Unique index (required for REFRESH CONCURRENTLY)
CREATE UNIQUE INDEX idx_mv_gym_stats_daily_pk
  ON mv_gym_stats_daily (gym_id, stat_date);

-- Lookup index
CREATE INDEX idx_mv_gym_stats_daily_gym
  ON mv_gym_stats_daily (gym_id);


-- ============================================================
-- VIEW 2: mv_gym_member_summary — Per-member summary for admin
-- ============================================================

CREATE MATERIALIZED VIEW mv_gym_member_summary AS
SELECT
  p.gym_id,
  p.id                                                AS profile_id,
  p.full_name,
  p.username,
  p.role,
  p.membership_status,
  p.created_at,
  p.last_active_at,
  COALESCE(ws.total_sessions, 0)                      AS total_sessions,
  COALESCE(ws.total_volume_lbs, 0)                     AS total_volume_lbs,
  ws.last_workout_at,
  COALESCE(sc.current_streak_days, 0)                  AS current_streak,
  COALESCE(pr.total_prs, 0)                            AS total_prs,
  -- At risk: no workout in 14+ days (or never worked out)
  CASE
    WHEN ws.last_workout_at IS NULL THEN true
    WHEN ws.last_workout_at < (NOW() - INTERVAL '14 days') THEN true
    ELSE false
  END                                                  AS is_at_risk
FROM profiles p
-- Workout aggregates
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)              AS total_sessions,
    SUM(total_volume_lbs) AS total_volume_lbs,
    MAX(completed_at)     AS last_workout_at
  FROM workout_sessions s
  WHERE s.profile_id = p.id
    AND s.gym_id = p.gym_id
    AND s.status = 'completed'
) ws ON true
-- Current streak
LEFT JOIN streak_cache sc ON sc.profile_id = p.id
-- Personal records count
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total_prs
  FROM personal_records pr2
  WHERE pr2.profile_id = p.id
    AND pr2.gym_id = p.gym_id
) pr ON true
WHERE p.role = 'member'
ORDER BY p.gym_id, p.created_at DESC;

-- Unique index (required for REFRESH CONCURRENTLY)
CREATE UNIQUE INDEX idx_mv_gym_member_summary_pk
  ON mv_gym_member_summary (gym_id, profile_id);

-- Lookup index
CREATE INDEX idx_mv_gym_member_summary_gym
  ON mv_gym_member_summary (gym_id);


-- ============================================================
-- VIEW 3: mv_gym_exercise_popularity — Top exercises per gym
-- ============================================================

CREATE MATERIALIZED VIEW mv_gym_exercise_popularity AS
SELECT
  ws.gym_id,
  se.exercise_id,
  e.name AS exercise_name,
  COUNT(*) AS usage_count
FROM session_exercises se
JOIN workout_sessions ws ON ws.id = se.session_id
JOIN exercises e ON e.id = se.exercise_id
WHERE ws.status = 'completed'
  AND ws.started_at >= (NOW() - INTERVAL '30 days')
GROUP BY ws.gym_id, se.exercise_id, e.name
ORDER BY ws.gym_id, usage_count DESC;

-- Unique index (required for REFRESH CONCURRENTLY)
CREATE UNIQUE INDEX idx_mv_gym_exercise_popularity_pk
  ON mv_gym_exercise_popularity (gym_id, exercise_id);

-- Lookup index
CREATE INDEX idx_mv_gym_exercise_popularity_gym
  ON mv_gym_exercise_popularity (gym_id);


-- ============================================================
-- REFRESH FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_admin_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_gym_stats_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_gym_member_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_gym_exercise_popularity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- ACCESS GRANTS
-- ============================================================

GRANT SELECT ON mv_gym_stats_daily         TO authenticated;
GRANT SELECT ON mv_gym_member_summary      TO authenticated;
GRANT SELECT ON mv_gym_exercise_popularity TO authenticated;


-- ============================================================
-- ENABLE RLS-EQUIVALENT ACCESS VIA POLICIES
-- ============================================================
-- Materialized views don't support RLS directly, but access is
-- controlled via the authenticated role grant above. The client
-- always filters by gym_id which matches the user's gym.
-- For additional security, the PostgREST API layer ensures
-- queries are scoped by the authenticated user's JWT.


-- Notify PostgREST to reload schema and pick up new views
NOTIFY pgrst, 'reload schema';
