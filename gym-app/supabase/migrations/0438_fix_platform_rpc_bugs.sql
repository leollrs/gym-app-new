-- =============================================================
-- 0438_fix_platform_rpc_bugs.sql
--
-- Fixes three runtime bugs found via end-to-end testing as an actual
-- super_admin (they only surfaced for a real super_admin because the
-- permission check raised first for anon, masking the SQL). Build/lint and
-- the read-only audit couldn't catch these — they're execution-time SQL.
--
--   1. platform_gym_attention (0435) — "column reference gym_id is ambiguous":
--      the RETURNS TABLE OUT column `gym_id` collided with unqualified `gym_id`
--      column refs in the churn/adm/err/act CTEs. Fixed with
--      `#variable_conflict use_column`.
--   2. platform_gym_stats (0437) — same ambiguity in the ci/ws/churn CTEs.
--      Same fix.
--   3. platform_churn_signals (0437) — "COALESCE types text[] and jsonb cannot
--      be matched": churn_risk_scores.key_signals is text[], not jsonb. Use
--      unnest() over the array instead of jsonb_array_elements_text().
--
-- 0435/0437 are corrected in place too (for fresh installs); this migration
-- re-applies the corrected definitions to databases that already ran the
-- broken versions.
-- =============================================================

-- ── 1 · platform_gym_attention ─────────────────────────────
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
#variable_conflict use_column
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

-- ── 2 · platform_gym_stats ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_gym_stats()
RETURNS TABLE (
  gym_id          UUID,
  member_count    INT,
  onboarded_count INT,
  active_30d      INT,
  checkedin_30d   INT,
  sessions_30d    INT,
  new_30d         INT,
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
      COUNT(*)::INT                                          AS member_count,
      COUNT(*) FILTER (WHERE p.is_onboarded)::INT            AS onboarded_count,
      COUNT(*) FILTER (WHERE p.last_active_at >= v_30d)::INT AS active_30d,
      COUNT(*) FILTER (WHERE p.created_at >= v_30d)::INT     AS new_30d
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

-- ── 3 · platform_churn_signals ─────────────────────────────
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

NOTIFY pgrst, 'reload schema';
