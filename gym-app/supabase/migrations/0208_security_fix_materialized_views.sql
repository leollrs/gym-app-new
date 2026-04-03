-- =============================================================
-- SECURITY FIX: Materialized View Access Control
-- Migration: 0208_security_fix_materialized_views.sql
-- =============================================================
-- Materialized views do not support RLS, so the SELECT grants
-- in 0076_admin_materialized_views.sql allow any authenticated
-- user to query any gym's data. This migration revokes direct
-- access and exposes gym-scoped wrapper functions that enforce
-- ownership via public.current_gym_id().
-- =============================================================

-- Revoke direct access to materialized views
REVOKE SELECT ON mv_gym_stats_daily FROM authenticated;
REVOKE SELECT ON mv_gym_member_summary FROM authenticated;
REVOKE SELECT ON mv_gym_exercise_popularity FROM authenticated;

-- Create gym-scoped wrapper functions
CREATE OR REPLACE FUNCTION get_gym_stats_daily(p_gym_id UUID, p_start DATE DEFAULT CURRENT_DATE - 30, p_end DATE DEFAULT CURRENT_DATE)
RETURNS SETOF mv_gym_stats_daily
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM mv_gym_stats_daily
  WHERE gym_id = p_gym_id AND p_gym_id = public.current_gym_id()
  AND stat_date BETWEEN p_start AND p_end
  ORDER BY stat_date DESC;
$$;

CREATE OR REPLACE FUNCTION get_gym_member_summary(p_gym_id UUID)
RETURNS SETOF mv_gym_member_summary
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM mv_gym_member_summary
  WHERE gym_id = p_gym_id AND p_gym_id = public.current_gym_id();
$$;

CREATE OR REPLACE FUNCTION get_gym_exercise_popularity(p_gym_id UUID)
RETURNS SETOF mv_gym_exercise_popularity
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM mv_gym_exercise_popularity
  WHERE gym_id = p_gym_id AND p_gym_id = public.current_gym_id();
$$;

GRANT EXECUTE ON FUNCTION get_gym_stats_daily(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_gym_member_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_gym_exercise_popularity(UUID) TO authenticated;
