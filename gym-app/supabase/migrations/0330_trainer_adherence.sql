-- =============================================================
-- TRAINER PLAN ADHERENCE — per-client weekly completion stats
-- Migration: 0330_trainer_adherence.sql
--
-- Schema notes (verified against existing migrations):
--   * `trainer_clients` (0001) maps trainer_id → client_id with is_active flag.
--   * `trainer_workout_plans` (0036) stores per-client custom plans with
--     duration_weeks SMALLINT and weeks JSONB ({"1":[{name,exercises:[...]}]}).
--     There is no top-level `training_days_per_week` column — we infer planned
--     sessions from the JSON week structure (length of week 1's day array)
--     and fall back to `member_onboarding.training_days_per_week`.
--   * `workout_sessions` (0001) has profile_id (NOT user_id), status enum
--     (`completed`/`in_progress`), started_at and completed_at columns.
--   * `member_onboarding` (0001) holds training_days_per_week (INT, 1–7) keyed
--     by profile_id. Joined with LEFT JOIN since older profiles may not have
--     completed onboarding.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_trainer_adherence(
  p_trainer_id UUID,
  p_week_start DATE DEFAULT (date_trunc('week', now() AT TIME ZONE 'UTC')::date)
)
RETURNS TABLE (
  client_id        UUID,
  client_name      TEXT,
  client_avatar    TEXT,
  client_username  TEXT,
  plan_id          UUID,
  plan_name        TEXT,
  planned_count    INT,
  completed_count  INT,
  last_session_at  TIMESTAMPTZ,
  status           TEXT  -- 'on_track' | 'at_risk' | 'behind' | 'inactive'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH assigned AS (
    SELECT
      tc.client_id,
      twp.id   AS plan_id,
      twp.name AS plan_name,
      -- Planned sessions per week:
      -- 1) length of plan.weeks->'1' if defined (jsonb array)
      -- 2) else fall back to member_onboarding.training_days_per_week
      -- 3) else default to 3
      COALESCE(
        NULLIF(
          jsonb_array_length(
            CASE
              WHEN jsonb_typeof(twp.weeks -> '1') = 'array' THEN twp.weeks -> '1'
              ELSE '[]'::jsonb
            END
          ),
          0
        ),
        NULLIF(mo.training_days_per_week, 0),
        3
      )::int AS planned_count
    FROM trainer_clients tc
    LEFT JOIN trainer_workout_plans twp
      ON twp.client_id  = tc.client_id
     AND twp.trainer_id = tc.trainer_id
     AND twp.is_active  = TRUE
    LEFT JOIN member_onboarding mo ON mo.profile_id = tc.client_id
    WHERE tc.trainer_id = p_trainer_id
      AND tc.is_active  = TRUE
  ),
  done AS (
    SELECT
      ws.profile_id   AS client_id,
      COUNT(*)::int   AS completed,
      MAX(COALESCE(ws.completed_at, ws.started_at)) AS last_at
    FROM workout_sessions ws
    WHERE ws.profile_id IN (SELECT a.client_id FROM assigned a)
      AND ws.status      = 'completed'
      AND ws.started_at >= p_week_start
      AND ws.started_at <  (p_week_start + INTERVAL '7 days')
    GROUP BY ws.profile_id
  ),
  last_seen AS (
    -- Fall back to last completed session of all time for "inactive" detection
    SELECT
      ws.profile_id AS client_id,
      MAX(COALESCE(ws.completed_at, ws.started_at)) AS last_at
    FROM workout_sessions ws
    WHERE ws.profile_id IN (SELECT a.client_id FROM assigned a)
      AND ws.status = 'completed'
    GROUP BY ws.profile_id
  )
  SELECT
    a.client_id,
    COALESCE(p.full_name, p.username, 'Client') AS client_name,
    p.avatar_url                                AS client_avatar,
    p.username                                  AS client_username,
    a.plan_id,
    a.plan_name,
    a.planned_count,
    COALESCE(d.completed, 0)::int               AS completed_count,
    COALESCE(d.last_at, ls.last_at)             AS last_session_at,
    CASE
      -- Inactive: no completed session in 7+ days (or ever)
      WHEN COALESCE(ls.last_at, '1970-01-01'::timestamptz)
           < (now() - INTERVAL '7 days') THEN 'inactive'
      -- On track: ≥80% of planned sessions this week
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) >= 0.8 THEN 'on_track'
      -- At risk: 50–79% completion
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) >= 0.5 THEN 'at_risk'
      -- Behind: <50% (and active in the last 7 days)
      ELSE 'behind'
    END AS status
  FROM assigned a
  JOIN profiles  p  ON p.id = a.client_id
  LEFT JOIN done       d  ON d.client_id = a.client_id
  LEFT JOIN last_seen  ls ON ls.client_id = a.client_id
  ORDER BY
    CASE
      WHEN COALESCE(ls.last_at, '1970-01-01'::timestamptz)
           < (now() - INTERVAL '7 days') THEN 0     -- inactive first
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) < 0.5 THEN 1
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) < 0.8 THEN 2
      ELSE 3
    END,
    client_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_trainer_adherence(UUID, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_trainer_adherence(UUID, DATE) IS
  'Per-client plan adherence for the current (or specified) week. Planned count
   inferred from trainer_workout_plans.weeks length, falling back to
   member_onboarding.training_days_per_week, then 3. Status: on_track ≥80%,
   at_risk 50–79%, behind <50% (active), inactive (no completed session in 7d).';
