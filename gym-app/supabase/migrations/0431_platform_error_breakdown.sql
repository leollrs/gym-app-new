-- =============================================================
-- 0431_platform_error_breakdown.sql
--
-- Per-gym error breakdown + spike detection for the platform Error Logs
-- console. The page already lets the super-admin filter to one gym at a
-- time; this RPC powers the "which gyms are having issues right now" panel
-- that ranks gyms by error volume and flags any whose rate has spiked vs
-- the previous equal-length window.
--
-- Returns, per gym with at least one error in the current window:
--   current_count — errors in [now - window, now], honoring the type filter
--   crash_count   — react_crash + auth_error in the same window (the "real
--                   pain" subset surfaced in the page's Critical tile)
--   prior_count   — errors in the immediately-preceding window of equal
--                   length (0 for the 'all' range), so the client can flag a
--                   spike (current materially higher than prior).
--
-- super_admin only, matching the rest of the platform RPCs (0424).
-- =============================================================

CREATE OR REPLACE FUNCTION public.platform_error_breakdown(
  p_range TEXT DEFAULT '7d',   -- '24h' | '7d' | '30d' | 'all'
  p_type  TEXT DEFAULT 'all'   -- 'all' or a specific error_logs.type
)
RETURNS TABLE (
  gym_id        UUID,
  gym_name      TEXT,
  current_count BIGINT,
  crash_count   BIGINT,
  prior_count   BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window      INTERVAL;
  v_cur_start   TIMESTAMPTZ;
  v_prior_start TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  v_window := CASE p_range
    WHEN '24h' THEN INTERVAL '24 hours'
    WHEN '7d'  THEN INTERVAL '7 days'
    WHEN '30d' THEN INTERVAL '30 days'
    ELSE NULL                -- 'all' → no lower bound, no prior comparison
  END;

  IF v_window IS NULL THEN
    v_cur_start   := '-infinity'::timestamptz;
    v_prior_start := '-infinity'::timestamptz;
  ELSE
    v_cur_start   := now() - v_window;
    v_prior_start := now() - (v_window * 2);
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.name,
    COUNT(*) FILTER (
      WHERE el.created_at >= v_cur_start
        AND (p_type = 'all' OR el.type = p_type)
    )::BIGINT,
    COUNT(*) FILTER (
      WHERE el.created_at >= v_cur_start
        AND el.type IN ('react_crash', 'auth_error')
    )::BIGINT,
    CASE WHEN v_window IS NULL THEN 0::BIGINT
      ELSE COUNT(*) FILTER (
        WHERE el.created_at >= v_prior_start
          AND el.created_at <  v_cur_start
          AND (p_type = 'all' OR el.type = p_type)
      )::BIGINT
    END
  FROM error_logs el
  JOIN gyms g ON g.id = el.gym_id
  WHERE el.gym_id IS NOT NULL
    AND (v_window IS NULL OR el.created_at >= v_prior_start)
  GROUP BY g.id, g.name
  HAVING COUNT(*) FILTER (
    WHERE el.created_at >= v_cur_start
      AND (p_type = 'all' OR el.type = p_type)
  ) > 0
  ORDER BY 3 DESC, 4 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_error_breakdown(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_error_breakdown(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
