-- =============================================================
-- Gym Health Scores — materialized view computing a composite
-- health score (0-100) per gym for super-admin analytics.
-- Aggregates retention, engagement, check-ins, onboarding,
-- churn risk, and growth into a single actionable metric.
-- =============================================================

-- ── Materialized View ──────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_gym_health_scores AS
WITH gym_members AS (
  SELECT
    g.id                AS gym_id,
    g.name              AS gym_name,
    g.is_active,
    g.created_at        AS gym_created_at,
    COUNT(p.id)         AS member_count,
    COUNT(p.id) FILTER (
      WHERE p.last_active_at >= now() - INTERVAL '30 days'
    )                   AS active_30d,
    COUNT(p.id) FILTER (
      WHERE p.is_onboarded = TRUE
    )                   AS onboarded_count,
    COUNT(p.id) FILTER (
      WHERE p.created_at >= now() - INTERVAL '30 days'
    )                   AS new_members_30d
  FROM gyms g
  LEFT JOIN profiles p ON p.gym_id = g.id AND p.role = 'member'
  GROUP BY g.id, g.name, g.is_active, g.created_at
),
gym_sessions AS (
  SELECT
    ws.gym_id,
    COUNT(*)            AS sessions_30d
  FROM workout_sessions ws
  WHERE ws.status = 'completed'
    AND ws.started_at >= now() - INTERVAL '30 days'
  GROUP BY ws.gym_id
),
gym_checkins AS (
  SELECT
    ci.gym_id,
    COUNT(DISTINCT ci.profile_id) AS members_checked_in_30d,
    COUNT(*)                      AS checkins_30d
  FROM check_ins ci
  WHERE ci.checked_in_at >= now() - INTERVAL '30 days'
  GROUP BY ci.gym_id
),
gym_churn AS (
  SELECT
    cr.gym_id,
    AVG(cr.score)       AS avg_churn_score
  FROM churn_risk_scores cr
  GROUP BY cr.gym_id
)
SELECT
  gm.gym_id,
  gm.gym_name,
  gm.is_active,
  gm.gym_created_at,
  gm.member_count,
  gm.active_30d,
  gm.onboarded_count,
  gm.new_members_30d,
  COALESCE(gs.sessions_30d, 0)              AS sessions_30d,
  COALESCE(gc.checkins_30d, 0)              AS checkins_30d,
  COALESCE(gc.members_checked_in_30d, 0)    AS members_checked_in_30d,
  ROUND(COALESCE(gch.avg_churn_score, 0), 1) AS avg_churn_score,

  -- ── Component scores ─────────────────────────────────────
  -- 1. Retention (25%): active 30d / total members
  CASE WHEN gm.member_count > 0
    THEN ROUND((gm.active_30d::NUMERIC / gm.member_count) * 100, 1)
    ELSE 0
  END AS member_retention_pct,

  -- 2. Engagement (20%): avg sessions per member last 30d, capped at 12
  CASE WHEN gm.member_count > 0
    THEN ROUND(LEAST(COALESCE(gs.sessions_30d, 0)::NUMERIC / gm.member_count, 12) / 12 * 100, 1)
    ELSE 0
  END AS engagement_score,

  -- 3. Check-in rate (15%): members who checked in / total
  CASE WHEN gm.member_count > 0
    THEN ROUND((COALESCE(gc.members_checked_in_30d, 0)::NUMERIC / gm.member_count) * 100, 1)
    ELSE 0
  END AS checkin_score,

  -- 4. Onboarding (15%): onboarded / total
  CASE WHEN gm.member_count > 0
    THEN ROUND((gm.onboarded_count::NUMERIC / gm.member_count) * 100, 1)
    ELSE 0
  END AS onboarding_score,

  -- 5. Churn risk (15%): inverted (100 - avg churn score)
  ROUND(GREATEST(100 - COALESCE(gch.avg_churn_score, 0), 0), 1) AS churn_health_score,

  -- 6. Growth (10%): new members / total, capped at 30%
  CASE WHEN gm.member_count > 0
    THEN ROUND(LEAST(gm.new_members_30d::NUMERIC / gm.member_count, 0.3) / 0.3 * 100, 1)
    ELSE 0
  END AS growth_score,

  -- ── Composite health score (0-100) ───────────────────────
  ROUND(
    (
      -- Retention 25%
      CASE WHEN gm.member_count > 0
        THEN (gm.active_30d::NUMERIC / gm.member_count) * 0.25
        ELSE 0
      END
      +
      -- Engagement 20%
      CASE WHEN gm.member_count > 0
        THEN (LEAST(COALESCE(gs.sessions_30d, 0)::NUMERIC / gm.member_count, 12) / 12) * 0.20
        ELSE 0
      END
      +
      -- Check-in rate 15%
      CASE WHEN gm.member_count > 0
        THEN (COALESCE(gc.members_checked_in_30d, 0)::NUMERIC / gm.member_count) * 0.15
        ELSE 0
      END
      +
      -- Onboarding 15%
      CASE WHEN gm.member_count > 0
        THEN (gm.onboarded_count::NUMERIC / gm.member_count) * 0.15
        ELSE 0
      END
      +
      -- Churn health 15%
      (GREATEST(100 - COALESCE(gch.avg_churn_score, 0), 0) / 100) * 0.15
      +
      -- Growth 10%
      CASE WHEN gm.member_count > 0
        THEN (LEAST(gm.new_members_30d::NUMERIC / gm.member_count, 0.3) / 0.3) * 0.10
        ELSE 0
      END
    ) * 100
  , 1) AS health_score,

  -- ── Health tier ──────────────────────────────────────────
  CASE
    WHEN ROUND(
      (
        CASE WHEN gm.member_count > 0
          THEN (gm.active_30d::NUMERIC / gm.member_count) * 0.25
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(COALESCE(gs.sessions_30d, 0)::NUMERIC / gm.member_count, 12) / 12) * 0.20
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (COALESCE(gc.members_checked_in_30d, 0)::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (gm.onboarded_count::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        (GREATEST(100 - COALESCE(gch.avg_churn_score, 0), 0) / 100) * 0.15
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(gm.new_members_30d::NUMERIC / gm.member_count, 0.3) / 0.3) * 0.10
          ELSE 0
        END
      ) * 100
    , 1) >= 80 THEN 'thriving'
    WHEN ROUND(
      (
        CASE WHEN gm.member_count > 0
          THEN (gm.active_30d::NUMERIC / gm.member_count) * 0.25
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(COALESCE(gs.sessions_30d, 0)::NUMERIC / gm.member_count, 12) / 12) * 0.20
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (COALESCE(gc.members_checked_in_30d, 0)::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (gm.onboarded_count::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        (GREATEST(100 - COALESCE(gch.avg_churn_score, 0), 0) / 100) * 0.15
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(gm.new_members_30d::NUMERIC / gm.member_count, 0.3) / 0.3) * 0.10
          ELSE 0
        END
      ) * 100
    , 1) >= 60 THEN 'healthy'
    WHEN ROUND(
      (
        CASE WHEN gm.member_count > 0
          THEN (gm.active_30d::NUMERIC / gm.member_count) * 0.25
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(COALESCE(gs.sessions_30d, 0)::NUMERIC / gm.member_count, 12) / 12) * 0.20
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (COALESCE(gc.members_checked_in_30d, 0)::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (gm.onboarded_count::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        (GREATEST(100 - COALESCE(gch.avg_churn_score, 0), 0) / 100) * 0.15
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(gm.new_members_30d::NUMERIC / gm.member_count, 0.3) / 0.3) * 0.10
          ELSE 0
        END
      ) * 100
    , 1) >= 40 THEN 'moderate'
    WHEN ROUND(
      (
        CASE WHEN gm.member_count > 0
          THEN (gm.active_30d::NUMERIC / gm.member_count) * 0.25
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(COALESCE(gs.sessions_30d, 0)::NUMERIC / gm.member_count, 12) / 12) * 0.20
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (COALESCE(gc.members_checked_in_30d, 0)::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        CASE WHEN gm.member_count > 0
          THEN (gm.onboarded_count::NUMERIC / gm.member_count) * 0.15
          ELSE 0
        END
        +
        (GREATEST(100 - COALESCE(gch.avg_churn_score, 0), 0) / 100) * 0.15
        +
        CASE WHEN gm.member_count > 0
          THEN (LEAST(gm.new_members_30d::NUMERIC / gm.member_count, 0.3) / 0.3) * 0.10
          ELSE 0
        END
      ) * 100
    , 1) >= 20 THEN 'at_risk'
    ELSE 'critical'
  END AS health_tier

FROM gym_members gm
LEFT JOIN gym_sessions gs   ON gs.gym_id = gm.gym_id
LEFT JOIN gym_checkins gc   ON gc.gym_id = gm.gym_id
LEFT JOIN gym_churn    gch  ON gch.gym_id = gm.gym_id;

-- ── Unique index on gym_id ─────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_gym_health_scores_gym_id
  ON mv_gym_health_scores (gym_id);

COMMENT ON MATERIALIZED VIEW mv_gym_health_scores IS
  'Composite gym health score (0-100) aggregating retention, engagement, check-ins, onboarding, churn risk, and growth. Refresh via refresh_gym_health_scores().';

-- ── Refresh function ───────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_gym_health_scores()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_gym_health_scores;
END;
$$;

COMMENT ON FUNCTION refresh_gym_health_scores() IS
  'Refreshes mv_gym_health_scores concurrently. Safe to call from cron or admin UI.';
