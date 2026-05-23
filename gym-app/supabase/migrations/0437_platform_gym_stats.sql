-- =============================================================
-- 0437_platform_gym_stats.sql
--
-- Scalability fix for the platform dashboards. GymHealth and PlatformAnalytics
-- were loading EVERY member / session / check-in / churn row across ALL gyms
-- into the browser and aggregating client-side — fine for 2 gyms, a crash
-- waiting to happen at "hella gyms". This RPC does the aggregation server-side
-- and returns ONE ROW PER GYM (a few dozen rows), so the client payload grows
-- with gym count, not member count.
--
-- (A bare .limit() on the client would have been worse than the bug — it would
-- silently truncate and make the totals wrong. Aggregating in SQL keeps the
-- numbers exact while staying tiny over the wire.)
--
-- Companion RPCs for the two things that aren't a per-gym snapshot:
--   platform_member_growth(gym, weeks)   — weekly new-member counts (chart)
--   platform_churn_signals(gym)          — top churn signals + totals
-- Both are scope-aware (pass a gym id to focus one, NULL for all gyms).
--
-- super_admin only (platform pattern, 0424).
-- =============================================================

-- ── Per-gym snapshot aggregates ─────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_gym_stats()
RETURNS TABLE (
  gym_id          UUID,
  member_count    INT,
  onboarded_count INT,
  active_30d      INT,   -- members with last_active_at in 30d
  checkedin_30d   INT,   -- distinct members with a check-in in 30d
  sessions_30d    INT,   -- completed sessions in 30d
  new_30d         INT,   -- members created in 30d
  churn_critical  INT,
  churn_high      INT,
  churn_count     INT,
  avg_churn_score NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_30d TIMESTAMPTZ := now() - INTERVAL '30 days';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  WITH mem AS (
    SELECT p.gym_id,
      COUNT(*)::INT                                                       AS member_count,
      COUNT(*) FILTER (WHERE p.is_onboarded)::INT                         AS onboarded_count,
      COUNT(*) FILTER (WHERE p.last_active_at >= v_30d)::INT              AS active_30d,
      COUNT(*) FILTER (WHERE p.created_at >= v_30d)::INT                  AS new_30d
    FROM profiles p
    WHERE p.role = 'member' AND p.imported_archived = FALSE
    GROUP BY p.gym_id
  ),
  ci AS (
    SELECT gym_id, COUNT(DISTINCT profile_id)::INT AS checkedin_30d
    FROM check_ins WHERE checked_in_at >= v_30d
    GROUP BY gym_id
  ),
  ws AS (
    SELECT gym_id, COUNT(*)::INT AS sessions_30d
    FROM workout_sessions WHERE status = 'completed' AND started_at >= v_30d
    GROUP BY gym_id
  ),
  churn AS (
    SELECT gym_id,
      COUNT(*) FILTER (WHERE risk_tier = 'critical')::INT AS churn_critical,
      COUNT(*) FILTER (WHERE risk_tier = 'high')::INT     AS churn_high,
      COUNT(*)::INT                                       AS churn_count,
      ROUND(AVG(score)::numeric, 1)                       AS avg_churn_score
    FROM churn_risk_scores
    GROUP BY gym_id
  )
  SELECT
    g.id,
    COALESCE(mem.member_count, 0),
    COALESCE(mem.onboarded_count, 0),
    COALESCE(mem.active_30d, 0),
    COALESCE(ci.checkedin_30d, 0),
    COALESCE(ws.sessions_30d, 0),
    COALESCE(mem.new_30d, 0),
    COALESCE(churn.churn_critical, 0),
    COALESCE(churn.churn_high, 0),
    COALESCE(churn.churn_count, 0),
    COALESCE(churn.avg_churn_score, 0)
  FROM gyms g
  LEFT JOIN mem   ON mem.gym_id   = g.id
  LEFT JOIN ci    ON ci.gym_id    = g.id
  LEFT JOIN ws    ON ws.gym_id    = g.id
  LEFT JOIN churn ON churn.gym_id = g.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_gym_stats() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_gym_stats() TO authenticated;

-- ── Weekly member growth (scope-aware) ──────────────────────
CREATE OR REPLACE FUNCTION public.platform_member_growth(p_gym_id UUID DEFAULT NULL, p_weeks INT DEFAULT 13)
RETURNS TABLE (week_start DATE, new_members INT)
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
  WITH weeks AS (
    SELECT generate_series(
      date_trunc('week', now()) - ((p_weeks - 1) || ' weeks')::interval,
      date_trunc('week', now()),
      INTERVAL '1 week'
    ) AS wk
  ),
  joined AS (
    SELECT date_trunc('week', created_at) AS wk, COUNT(*)::INT AS n
    FROM profiles
    WHERE role = 'member' AND imported_archived = FALSE
      AND created_at >= date_trunc('week', now()) - ((p_weeks) || ' weeks')::interval
      AND (p_gym_id IS NULL OR gym_id = p_gym_id)
    GROUP BY 1
  )
  SELECT w.wk::date, COALESCE(j.n, 0)
  FROM weeks w
  LEFT JOIN joined j ON j.wk = w.wk
  ORDER BY w.wk;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_member_growth(UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_member_growth(UUID, INT) TO authenticated;

-- ── Churn signals + totals (scope-aware) ────────────────────
CREATE OR REPLACE FUNCTION public.platform_churn_signals(p_gym_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_at_risk INT;
  v_avg_score     NUMERIC;
  v_signals       jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE risk_tier IN ('critical', 'high')),
    ROUND(AVG(score)::numeric, 1)
  INTO v_total_at_risk, v_avg_score
  FROM churn_risk_scores
  WHERE (p_gym_id IS NULL OR gym_id = p_gym_id);

  -- Top signals among at-risk members, with the gym most affected by each.
  WITH sig AS (
    SELECT
      unnest(COALESCE(key_signals, '{}'::text[])) AS signal,
      gym_id
    FROM churn_risk_scores
    WHERE risk_tier IN ('critical', 'high')
      AND (p_gym_id IS NULL OR gym_id = p_gym_id)
  ),
  by_signal AS (
    SELECT signal, COUNT(*)::INT AS occurrences
    FROM sig GROUP BY signal
  ),
  top_gym AS (
    SELECT DISTINCT ON (s.signal) s.signal, g.name AS gym_name
    FROM sig s JOIN gyms g ON g.id = s.gym_id
    GROUP BY s.signal, g.name
    ORDER BY s.signal, COUNT(*) DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('signal', b.signal, 'occurrences', b.occurrences, 'gym', tg.gym_name)
    ORDER BY b.occurrences DESC
  ), '[]'::jsonb)
  INTO v_signals
  FROM by_signal b
  LEFT JOIN top_gym tg ON tg.signal = b.signal;

  RETURN jsonb_build_object(
    'total_at_risk', COALESCE(v_total_at_risk, 0),
    'avg_score', COALESCE(v_avg_score, 0),
    'signals', v_signals
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_churn_signals(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_churn_signals(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
