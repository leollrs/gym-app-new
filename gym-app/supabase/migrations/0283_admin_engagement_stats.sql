-- =============================================================
-- Admin Engagement Stats — views for super-admin analytics on
-- admin activity patterns and cross-gym onboarding rates.
-- Pulls from admin_presence and profiles tables.
-- =============================================================

-- ── Admin engagement per gym (from admin_presence) ─────────
CREATE OR REPLACE VIEW v_admin_engagement AS
WITH presence_30d AS (
  SELECT
    ap.gym_id,
    ap.profile_id,
    ap.current_page,
    ap.last_seen_at,
    ap.last_seen_at::DATE AS seen_date
  FROM admin_presence ap
  WHERE ap.last_seen_at >= now() - INTERVAL '30 days'
),
session_counts AS (
  SELECT
    gym_id,
    COUNT(DISTINCT (profile_id, seen_date)) AS total_admin_sessions_30d,
    COUNT(DISTINCT profile_id)              AS unique_admins_active
  FROM presence_30d
  GROUP BY gym_id
),
page_usage AS (
  SELECT DISTINCT ON (gym_id)
    gym_id,
    current_page AS most_used_page
  FROM (
    SELECT
      gym_id,
      current_page,
      COUNT(*) AS page_count
    FROM presence_30d
    WHERE current_page IS NOT NULL
    GROUP BY gym_id, current_page
    ORDER BY gym_id, page_count DESC
  ) ranked
),
last_activity AS (
  SELECT
    gym_id,
    MAX(last_seen_at) AS last_admin_activity
  FROM admin_presence
  GROUP BY gym_id
)
SELECT
  sc.gym_id,
  sc.total_admin_sessions_30d,
  sc.unique_admins_active,
  ROUND(sc.total_admin_sessions_30d / 4.3, 1) AS avg_sessions_per_week,
  pu.most_used_page,
  la.last_admin_activity
FROM session_counts sc
LEFT JOIN page_usage    pu ON pu.gym_id = sc.gym_id
LEFT JOIN last_activity la ON la.gym_id = sc.gym_id;

COMMENT ON VIEW v_admin_engagement IS
  'Admin engagement metrics per gym: session counts, active admins, most-used pages, and recency. Based on admin_presence data from last 30 days.';

-- ── Cross-gym onboarding rates ─────────────────────────────
CREATE OR REPLACE VIEW v_cross_gym_onboarding AS
SELECT
  p.gym_id,
  COUNT(*)                                        AS total_members,
  COUNT(*) FILTER (WHERE p.is_onboarded = TRUE)   AS onboarded_count,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(
      COUNT(*) FILTER (WHERE p.is_onboarded = TRUE)::NUMERIC
      / COUNT(*) * 100
    , 1)
    ELSE 0
  END                                             AS onboarding_rate,
  ROUND(
    AVG(
      CASE
        WHEN p.is_onboarded = TRUE
         AND p.last_active_at IS NOT NULL
         AND p.last_active_at <= p.created_at + INTERVAL '7 days'
        THEN EXTRACT(EPOCH FROM (p.last_active_at - p.created_at)) / 86400.0
        ELSE NULL
      END
    )
  , 1)                                            AS avg_days_to_onboard
FROM profiles p
WHERE p.role = 'member'
GROUP BY p.gym_id;

COMMENT ON VIEW v_cross_gym_onboarding IS
  'Cross-gym onboarding funnel: total members, onboarded count, completion rate, and average days to onboard (using last_active_at within 7 days of signup as proxy).';

-- ── RLS note ───────────────────────────────────────────────
-- Views inherit RLS from underlying tables. Since admin_presence
-- and profiles already have RLS, these views are accessible only
-- to roles that can read those tables. For explicit super-admin
-- restriction, wrap in security-definer functions if needed.
--
-- Grant explicit access to super_admin via wrapper functions:

CREATE OR REPLACE FUNCTION get_admin_engagement()
RETURNS SETOF v_admin_engagement
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT * FROM v_admin_engagement;
$$;

CREATE OR REPLACE FUNCTION get_cross_gym_onboarding()
RETURNS SETOF v_cross_gym_onboarding
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT * FROM v_cross_gym_onboarding;
$$;

COMMENT ON FUNCTION get_admin_engagement() IS
  'Security-definer wrapper for v_admin_engagement. Bypasses RLS so super-admin can read cross-gym admin activity.';

COMMENT ON FUNCTION get_cross_gym_onboarding() IS
  'Security-definer wrapper for v_cross_gym_onboarding. Bypasses RLS so super-admin can read cross-gym onboarding rates.';
