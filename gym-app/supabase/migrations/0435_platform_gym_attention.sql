-- =============================================================
-- 0435_platform_gym_attention.sql
--
-- One RPC that gathers, per active gym, every retention signal the platform
-- already computes — so the super-admin "Atención" board can show, at a
-- glance, "this gym has THIS problem and THAT problem" and fix it before it
-- becomes an issue. No new tracking; this just consolidates existing data
-- (profiles, churn_risk_scores, admin_presence, error_logs, gym_daily_activity)
-- into a single server-side aggregate so the board doesn't fan out a dozen
-- client queries. The client turns these raw numbers into the problem list +
-- suggested fixes.
--
-- super_admin only (platform pattern, 0424).
-- =============================================================

CREATE OR REPLACE FUNCTION public.platform_gym_attention()
RETURNS TABLE (
  gym_id           UUID,
  gym_name         TEXT,
  created_at       TIMESTAMPTZ,
  member_count     INT,
  onboarded_count  INT,
  active_30d       INT,
  churn_critical   INT,
  churn_high       INT,
  last_admin_seen  TIMESTAMPTZ,
  errors_7d        INT,
  cur_activity     INT,
  prior_activity   INT,
  last_activity    DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  WITH mem AS (
    SELECT p.gym_id,
      COUNT(*)::INT                                                              AS member_count,
      COUNT(*) FILTER (WHERE p.is_onboarded)::INT                                AS onboarded_count,
      COUNT(*) FILTER (WHERE p.last_active_at >= now() - INTERVAL '30 days')::INT AS active_30d
    FROM profiles p
    WHERE p.role = 'member' AND p.imported_archived = FALSE
    GROUP BY p.gym_id
  ),
  churn AS (
    SELECT gym_id,
      COUNT(*) FILTER (WHERE risk_tier = 'critical')::INT AS crit,
      COUNT(*) FILTER (WHERE risk_tier = 'high')::INT     AS high
    FROM churn_risk_scores
    GROUP BY gym_id
  ),
  adm AS (SELECT gym_id, MAX(last_seen_at) AS last_seen FROM admin_presence GROUP BY gym_id),
  err AS (
    SELECT gym_id, COUNT(*)::INT AS n
    FROM error_logs
    WHERE gym_id IS NOT NULL AND created_at >= now() - INTERVAL '7 days'
    GROUP BY gym_id
  ),
  act AS (
    SELECT gym_id,
      COALESCE(SUM(checkins + workouts) FILTER (WHERE activity_date >  CURRENT_DATE - 14), 0)::INT AS cur,
      COALESCE(SUM(checkins + workouts) FILTER (WHERE activity_date >  CURRENT_DATE - 28
                                                  AND activity_date <= CURRENT_DATE - 14), 0)::INT AS prior,
      MAX(activity_date) AS last_day
    FROM gym_daily_activity
    GROUP BY gym_id
  )
  SELECT
    g.id, g.name, g.created_at,
    COALESCE(mem.member_count, 0),
    COALESCE(mem.onboarded_count, 0),
    COALESCE(mem.active_30d, 0),
    COALESCE(churn.crit, 0),
    COALESCE(churn.high, 0),
    adm.last_seen,
    COALESCE(err.n, 0),
    COALESCE(act.cur, 0),
    COALESCE(act.prior, 0),
    act.last_day
  FROM gyms g
  LEFT JOIN mem   ON mem.gym_id   = g.id
  LEFT JOIN churn ON churn.gym_id = g.id
  LEFT JOIN adm   ON adm.gym_id   = g.id
  LEFT JOIN err   ON err.gym_id   = g.id
  LEFT JOIN act   ON act.gym_id   = g.id
  WHERE g.is_active = TRUE
  ORDER BY g.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_gym_attention() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_gym_attention() TO authenticated;

NOTIFY pgrst, 'reload schema';
