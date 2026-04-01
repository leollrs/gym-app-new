-- Security fix: wrap materialized views in RPCs with gym boundary enforcement
-- Materialized views don't support RLS, so we must control access via functions

REVOKE SELECT ON mv_gym_stats_daily FROM authenticated, anon;
REVOKE SELECT ON mv_gym_member_summary FROM authenticated, anon;
REVOKE SELECT ON mv_gym_exercise_popularity FROM authenticated, anon;

-- RPC for gym stats daily
CREATE OR REPLACE FUNCTION public.get_gym_stats_daily(p_gym_id UUID)
RETURNS SETOF mv_gym_stats_daily
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY SELECT * FROM mv_gym_stats_daily WHERE gym_id = p_gym_id;
END;
$$;

-- RPC for gym member summary
CREATE OR REPLACE FUNCTION public.get_gym_member_summary(p_gym_id UUID)
RETURNS SETOF mv_gym_member_summary
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY SELECT * FROM mv_gym_member_summary WHERE gym_id = p_gym_id;
END;
$$;

-- RPC for gym exercise popularity
CREATE OR REPLACE FUNCTION public.get_gym_exercise_popularity(p_gym_id UUID)
RETURNS SETOF mv_gym_exercise_popularity
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY SELECT * FROM mv_gym_exercise_popularity WHERE gym_id = p_gym_id;
END;
$$;

-- Also secure refresh function
CREATE OR REPLACE FUNCTION refresh_admin_views()
RETURNS void AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_gym_stats_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_gym_member_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_gym_exercise_popularity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_gym_stats_daily(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gym_member_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gym_exercise_popularity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_admin_views() TO authenticated;
