-- =============================================================
-- WEEKLY ATTENDANCE FLAG — Owner-facing retention signal
-- Migration: 0395_member_weekly_attendance.sql
--
-- Captures Hormozi's "≤2 sessions/week past day-14" leading
-- indicator (Gym Launch Secrets, Ch. 16 p. 195) as a weekly
-- snapshot. Distinct from the predictive `churn_risk_scores`
-- pipeline — this is a binary, owner-actionable flag intended
-- to power a "Today's conversations" morning queue and detect
-- multi-week absence streaks before cancellation.
--
-- Schedule: Mon 03:00 UTC (= Sun 23:00 AST in Puerto Rico,
-- which observes UTC-4 year-round with no DST). Snapshot is
-- taken AFTER the ISO week (Mon-Sun) ends.
-- =============================================================

-- ── Snapshot table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_weekly_attendance_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,

  -- ISO week boundaries (Monday-Sunday)
  week_start      DATE NOT NULL,
  week_end        DATE NOT NULL,

  -- Snapshot metrics for that week
  sessions_count  INTEGER NOT NULL CHECK (sessions_count >= 0),
  tenure_days     INTEGER NOT NULL CHECK (tenure_days >= 0),

  -- The flag itself: sessions ≤ 2 AND tenure ≥ 14
  flagged         BOOLEAN NOT NULL,

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per member per week. Re-runs UPSERT.
  UNIQUE (profile_id, week_start)
);

-- Owner morning queue: "show flagged members for my gym this week"
CREATE INDEX idx_weekly_attendance_gym_week_flagged
  ON member_weekly_attendance_flags (gym_id, week_start DESC)
  WHERE flagged = TRUE;

-- Streak lookup: "how many consecutive weeks has this member been flagged"
CREATE INDEX idx_weekly_attendance_profile_week
  ON member_weekly_attendance_flags (profile_id, week_start DESC);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE member_weekly_attendance_flags ENABLE ROW LEVEL SECURITY;

-- Mirrors churn_risk_scores policy: admins/super_admins/trainers
-- can read flags for their own gym. No write policies — only the
-- SECURITY DEFINER function (called by cron via service role) writes.
CREATE POLICY "weekly_attendance_flags_read_staff"
  ON member_weekly_attendance_flags
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- ── Compute function ────────────────────────────────────────
-- Snapshots one ISO week (Mon-Sun starting on p_week_start) for
-- every active member across all gyms. UPSERTs by (profile_id,
-- week_start) so re-runs are idempotent.
--
-- Flag rule (from Hormozi):
--   sessions_count <= 2 AND tenure_days >= 14
--
-- Tenure source: profiles.membership_started_at if set, else
-- profiles.created_at. This mirrors how AdminChurn computes tenure.
--
-- NOTE: Week boundaries are UTC. A workout completed Sunday 11:30 PM
-- in Puerto Rico (03:30 UTC Monday) lands in the *next* week's bucket.
-- This is acceptable for an owner-facing signal; not for accounting.
CREATE OR REPLACE FUNCTION compute_weekly_attendance_flags(p_week_start DATE)
RETURNS TABLE (total_members INTEGER, flagged_members INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_end DATE := p_week_start + INTERVAL '6 days';
  v_total INTEGER;
  v_flagged INTEGER;
BEGIN
  WITH session_counts AS (
    SELECT
      profile_id,
      COUNT(*)::INTEGER AS session_count
    FROM workout_sessions
    WHERE status = 'completed'
      AND completed_at >= (p_week_start::TIMESTAMP AT TIME ZONE 'UTC')
      AND completed_at <  ((v_week_end + INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'UTC')
    GROUP BY profile_id
  ),
  tenure AS (
    SELECT
      p.id,
      p.gym_id,
      COALESCE(
        p.membership_started_at,
        (p.created_at AT TIME ZONE 'UTC')::DATE
      ) AS member_since
    FROM profiles p
    WHERE p.role = 'member'
      AND p.membership_status = 'active'
  ),
  upserted AS (
    INSERT INTO member_weekly_attendance_flags
      (profile_id, gym_id, week_start, week_end, sessions_count, tenure_days, flagged)
    SELECT
      t.id,
      t.gym_id,
      p_week_start,
      v_week_end,
      COALESCE(s.session_count, 0),
      GREATEST(0, (p_week_start - t.member_since)::INTEGER),
      (
        COALESCE(s.session_count, 0) <= 2
        AND (p_week_start - t.member_since)::INTEGER >= 14
      )
    FROM tenure t
    LEFT JOIN session_counts s ON s.profile_id = t.id
    ON CONFLICT (profile_id, week_start) DO UPDATE SET
      sessions_count = EXCLUDED.sessions_count,
      tenure_days    = EXCLUDED.tenure_days,
      flagged        = EXCLUDED.flagged,
      computed_at    = NOW()
    RETURNING flagged
  )
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE flagged)::INTEGER
  INTO v_total, v_flagged
  FROM upserted;

  RETURN QUERY SELECT v_total, v_flagged;
END;
$$;

-- ── Backfill helper ─────────────────────────────────────────
-- Run after deploy (or any time) to populate historical weeks.
-- Defaults to 8 weeks back, which gives the owner queue immediate
-- streak signal on day one.
--
-- Usage:  SELECT * FROM backfill_weekly_attendance_flags(8);
CREATE OR REPLACE FUNCTION backfill_weekly_attendance_flags(p_weeks INTEGER DEFAULT 8)
RETURNS TABLE (week_start DATE, total_members INTEGER, flagged_members INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week DATE;
  v_result RECORD;
  i INTEGER;
BEGIN
  IF p_weeks < 1 OR p_weeks > 52 THEN
    RAISE EXCEPTION 'p_weeks must be between 1 and 52, got %', p_weeks;
  END IF;

  FOR i IN 1..p_weeks LOOP
    v_week := (date_trunc('week', CURRENT_DATE - (INTERVAL '7 days' * i)))::DATE;
    SELECT * INTO v_result FROM compute_weekly_attendance_flags(v_week);

    week_start      := v_week;
    total_members   := v_result.total_members;
    flagged_members := v_result.flagged_members;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Lock down execution — these run via cron (postgres role) or
-- service_role; not callable by authenticated/anon clients.
REVOKE EXECUTE ON FUNCTION compute_weekly_attendance_flags(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION backfill_weekly_attendance_flags(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION compute_weekly_attendance_flags(DATE)     TO service_role;
GRANT  EXECUTE ON FUNCTION backfill_weekly_attendance_flags(INTEGER) TO service_role;

-- ── Cron: Sunday 23:00 AST (= Monday 03:00 UTC) ─────────────
-- Snapshots the ISO week that just ended.
--
-- date_trunc('week', X) returns the Monday at 00:00. On Mon 03:00
-- UTC, CURRENT_DATE - 1 day = Sunday, and date_trunc('week', Sunday)
-- returns the Monday at the start of the week that just ended.
SELECT cron.schedule(
  'compute-weekly-attendance-flags',
  '0 3 * * 1',
  $$
  SELECT compute_weekly_attendance_flags(
    (date_trunc('week', CURRENT_DATE - INTERVAL '1 day'))::DATE
  );
  $$
);
