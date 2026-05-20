-- =============================================================
-- RETENTION ORCHESTRATOR — the brain of the retention machine
-- Migration: 0398_retention_orchestrator.sql
--
-- Daily cron that reads existing signals (churn_risk_scores +
-- member_weekly_attendance_flags + workout activity) and produces:
--
--   1. member_outreach_state  — per-member "where they stand" snapshot
--   2. owner_queue_items      — "talk to this person today" cards
--
-- Crucially: this orchestrator DOES NOT auto-send retention
-- messages. The retention thesis (manufactured witnessing at scale)
-- depends on real owner attention being the product — auto-sending
-- "we miss you!" texts disguised as the owner would collapse that.
-- The orchestrator prompts the owner. The owner delivers the touch.
--
-- Auto-touches (streak nudges, celebrations) are programmed-everyone
-- moments and ship in a separate migration. Not retention touches.
--
-- Segmentation (anchored to churn_risk_scores.risk_tier + the new
-- weekly attendance flag — both already populated by daily crons):
--
--   critical : risk_tier='critical' OR (attendance flagged AND >=14d silent)
--   at_risk  : risk_tier='high'     OR attendance flagged this week
--   cooling  : risk_tier='medium'   OR last session 7..13 days ago
--   healthy  : everything else with recent activity
--   churned  : membership_status IN ('cancelled','banned')
--
-- Cadence (how often a member gets queued for owner action):
--
--   critical : every 1 day,  queue items expire after 3 days
--   at_risk  : every 7 days, queue items expire after 7 days
--   cooling  : every 14 days, queue items expire after 14 days
--   healthy  : no queue entry (auto-touch handled elsewhere)
--   churned  : no queue entry (win-back flow handles)
-- =============================================================

-- ── Per-member state ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_outreach_state (
  profile_id      UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,

  segment         TEXT NOT NULL CHECK (segment IN ('healthy','cooling','at_risk','critical','churned')),
  top_signal      TEXT,            -- e.g. 'recency','frequency_drop','streak_broken'
  signal_label    TEXT,            -- human-readable: "No visit in 14 days"

  last_queued_at  TIMESTAMPTZ,     -- when we last produced a queue card for this member
  next_due_at     TIMESTAMPTZ,     -- when this member is next eligible for queuing

  -- Diagnostic snapshot — what made us pick this segment today
  metrics         JSONB NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outreach_state_gym_segment
  ON member_outreach_state(gym_id, segment, next_due_at);

ALTER TABLE member_outreach_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach_state_read_staff"
  ON member_outreach_state
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- ── Owner action queue ──────────────────────────────────────
-- Each row is a "talk to this person today" prompt. Lives short
-- (expires_at) so the queue never accumulates ghosts.
CREATE TABLE IF NOT EXISTS owner_queue_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,

  segment           TEXT NOT NULL CHECK (segment IN ('cooling','at_risk','critical')),
  top_signal        TEXT,
  reason            TEXT NOT NULL,     -- "Hasn't trained in 11 days. Hit deadlift PR Apr 4."
  suggested_action  TEXT NOT NULL CHECK (suggested_action IN ('call','message','in_person')),

  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','done','dismissed','snoozed','expired')),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_outcome  TEXT CHECK (resolved_outcome IN ('reached_out','no_response','returned','lost')),
  resolved_note     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  snoozed_until     TIMESTAMPTZ
);

-- Owner morning queue: "show me today's pending cards for my gym, by urgency"
CREATE INDEX idx_owner_queue_gym_status
  ON owner_queue_items (gym_id, status, segment, created_at DESC);

-- Per-member lookup (history + dedup checks)
CREATE INDEX idx_owner_queue_profile
  ON owner_queue_items (profile_id, created_at DESC);

-- Dedup guarantee: only one pending card per member at a time.
-- The orchestrator relies on this — re-runs during the day must not
-- pile up cards. Partial unique index on status='pending'.
CREATE UNIQUE INDEX idx_owner_queue_one_pending_per_member
  ON owner_queue_items (profile_id)
  WHERE status = 'pending';

ALTER TABLE owner_queue_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_queue_read_staff"
  ON owner_queue_items
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- Admins/trainers can resolve cards (status, outcome, note).
-- This is the owner doing their morning queue work.
CREATE POLICY "owner_queue_update_staff"
  ON owner_queue_items
  FOR UPDATE USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- ── Cadence helper ──────────────────────────────────────────
-- Pure function — returns the cadence interval in days for a segment.
-- Centralized so segmentation and expiry calc both call it.
CREATE OR REPLACE FUNCTION outreach_cadence_days(p_segment TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_segment
    WHEN 'critical' THEN 1
    WHEN 'at_risk'  THEN 7
    WHEN 'cooling'  THEN 14
    ELSE NULL
  END;
$$;

-- ── The orchestrator itself ─────────────────────────────────
-- Idempotent: re-runs in the same day are safe.
--
-- Structured as four separate statements (not one giant CTE) because
-- Postgres CTE snapshot rules mean a write CTE's effects are invisible
-- to sibling write CTEs on the same table. If the upsert and the
-- next_due_at bump live in the same statement, first-time members
-- never get their next_due_at set. Splitting fixes that cleanly.
CREATE OR REPLACE FUNCTION run_retention_orchestrator()
RETURNS TABLE (
  evaluated      INTEGER,
  critical       INTEGER,
  at_risk        INTEGER,
  cooling        INTEGER,
  healthy        INTEGER,
  churned        INTEGER,
  cards_inserted INTEGER,
  cards_expired  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evaluated      INTEGER := 0;
  v_critical       INTEGER := 0;
  v_at_risk        INTEGER := 0;
  v_cooling        INTEGER := 0;
  v_healthy        INTEGER := 0;
  v_churned        INTEGER := 0;
  v_cards_inserted INTEGER := 0;
  v_cards_expired  INTEGER := 0;
BEGIN
  -- ── 1. Auto-expire stale pending cards ──
  UPDATE owner_queue_items
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at <= NOW();
  GET DIAGNOSTICS v_cards_expired = ROW_COUNT;

  -- ── 2. UPSERT segmentation into member_outreach_state ──
  WITH active_members AS (
    SELECT p.id AS profile_id, p.gym_id, p.membership_status
    FROM profiles p
    WHERE p.role = 'member' AND p.gym_id IS NOT NULL
  ),
  latest_churn AS (
    SELECT DISTINCT ON (profile_id)
      profile_id, risk_tier, score, key_signals, signals
    FROM churn_risk_scores
    ORDER BY profile_id, computed_at DESC
  ),
  latest_attendance AS (
    SELECT DISTINCT ON (profile_id)
      profile_id, flagged, sessions_count, week_start
    FROM member_weekly_attendance_flags
    ORDER BY profile_id, week_start DESC
  ),
  last_session AS (
    SELECT profile_id, MAX(completed_at) AS last_completed_at
    FROM workout_sessions
    WHERE status = 'completed'
    GROUP BY profile_id
  ),
  scored AS (
    SELECT
      am.profile_id,
      am.gym_id,
      am.membership_status,
      COALESCE(lc.risk_tier, 'low')                AS risk_tier,
      COALESCE(lc.score, 0)                        AS score,
      lc.key_signals,
      lc.signals,
      COALESCE(la.flagged, FALSE)                  AS flagged_this_week,
      COALESCE(la.sessions_count, 0)               AS week_sessions,
      ls.last_completed_at,
      CASE
        WHEN ls.last_completed_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NOW() - ls.last_completed_at)) / 86400
      END AS days_since_session
    FROM active_members am
    LEFT JOIN latest_churn      lc ON lc.profile_id = am.profile_id
    LEFT JOIN latest_attendance la ON la.profile_id = am.profile_id
    LEFT JOIN last_session      ls ON ls.profile_id = am.profile_id
  ),
  segmented AS (
    SELECT
      s.*,
      CASE
        WHEN s.membership_status IN ('cancelled','banned')                                THEN 'churned'
        WHEN s.risk_tier = 'critical'
          OR (s.flagged_this_week AND COALESCE(s.days_since_session, 999) >= 14)          THEN 'critical'
        WHEN s.risk_tier = 'high'   OR s.flagged_this_week                                THEN 'at_risk'
        WHEN s.risk_tier = 'medium' OR COALESCE(s.days_since_session, 0) BETWEEN 7 AND 13 THEN 'cooling'
        ELSE 'healthy'
      END AS segment,
      COALESCE(
        (s.key_signals)[1],
        CASE
          WHEN s.flagged_this_week                                THEN 'low_attendance'
          WHEN COALESCE(s.days_since_session, 0) >= 14            THEN 'absent'
          WHEN COALESCE(s.days_since_session, 0) BETWEEN 7 AND 13 THEN 'cooling'
          ELSE NULL
        END
      ) AS top_signal
    FROM scored s
  )
  INSERT INTO member_outreach_state
    (profile_id, gym_id, segment, top_signal, signal_label, metrics, updated_at)
  SELECT
    sg.profile_id,
    sg.gym_id,
    sg.segment,
    sg.top_signal,
    COALESCE((sg.signals -> sg.top_signal ->> 'label'), sg.top_signal) AS signal_label,
    jsonb_build_object(
      'risk_tier',          sg.risk_tier,
      'score',              sg.score,
      'flagged_this_week',  sg.flagged_this_week,
      'week_sessions',      sg.week_sessions,
      'days_since_session', sg.days_since_session
    ),
    NOW()
  FROM segmented sg
  ON CONFLICT (profile_id) DO UPDATE SET
    gym_id       = EXCLUDED.gym_id,
    segment      = EXCLUDED.segment,
    top_signal   = EXCLUDED.top_signal,
    signal_label = EXCLUDED.signal_label,
    metrics      = EXCLUDED.metrics,
    updated_at   = NOW();
    -- Intentionally NOT overwriting last_queued_at / next_due_at —
    -- those are owned by the queue-insert step below.

  -- ── 3. Counts per segment (read from the now-fresh state table) ──
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'critical')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'at_risk')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'cooling')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'healthy')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'churned')::INTEGER
  INTO v_evaluated, v_critical, v_at_risk, v_cooling, v_healthy, v_churned
  FROM member_outreach_state;

  -- ── 4. Insert queue cards AND bump next_due_at, in one CTE ──
  -- A single statement is correct here because the INSERT writes to
  -- owner_queue_items and the UPDATE writes to member_outreach_state
  -- (different tables — no snapshot collision). The UPDATE's FROM
  -- clause references the INSERT's RETURNING via a data-modifying CTE.
  WITH due AS (
    SELECT
      ms.profile_id,
      ms.gym_id,
      ms.segment,
      ms.top_signal,
      ms.signal_label,
      ms.metrics
    FROM member_outreach_state ms
    WHERE ms.segment IN ('critical','at_risk','cooling')
      AND (ms.next_due_at IS NULL OR ms.next_due_at <= NOW())
      AND NOT EXISTS (
        SELECT 1 FROM owner_queue_items q
        WHERE q.profile_id = ms.profile_id
          AND q.status = 'pending'
      )
  ),
  inserted AS (
    INSERT INTO owner_queue_items
      (profile_id, gym_id, segment, top_signal, reason, suggested_action, expires_at)
    SELECT
      d.profile_id,
      d.gym_id,
      d.segment,
      d.top_signal,
      -- Reason: factual, owner-readable. Pieces are NULL when they
      -- don't apply; CONCAT_WS skips NULLs; the outer COALESCE
      -- guarantees a non-empty string when every piece is NULL
      -- (e.g. a cooling member with no obvious signals).
      COALESCE(
        NULLIF(CONCAT_WS(' · ',
          CASE
            WHEN (d.metrics ->> 'days_since_session') IS NULL THEN 'Never trained'
            WHEN (d.metrics ->> 'days_since_session')::NUMERIC >= 14
              THEN CONCAT((d.metrics ->> 'days_since_session')::NUMERIC::INT, 'd silent')
            WHEN (d.metrics ->> 'days_since_session')::NUMERIC >= 7
              THEN CONCAT((d.metrics ->> 'days_since_session')::NUMERIC::INT, 'd quiet')
            ELSE NULL
          END,
          CASE
            WHEN (d.metrics ->> 'flagged_this_week')::BOOLEAN
              THEN CONCAT((d.metrics ->> 'week_sessions'), ' sessions this week')
            ELSE NULL
          END,
          d.signal_label
        ), ''),
        'Check in (' || d.segment || ')'
      ) AS reason,
      CASE d.segment
        WHEN 'critical' THEN 'call'
        ELSE 'message'
      END AS suggested_action,
      NOW() + (outreach_cadence_days(d.segment) || ' days')::INTERVAL AS expires_at
    FROM due d
    RETURNING profile_id, segment
  )
  UPDATE member_outreach_state ms
  SET
    last_queued_at = NOW(),
    next_due_at    = NOW() + (outreach_cadence_days(i.segment) || ' days')::INTERVAL
  FROM inserted i
  WHERE ms.profile_id = i.profile_id;

  GET DIAGNOSTICS v_cards_inserted = ROW_COUNT;

  RETURN QUERY SELECT
    v_evaluated, v_critical, v_at_risk, v_cooling, v_healthy, v_churned,
    v_cards_inserted, v_cards_expired;
END;
$$;

-- ── Lock down execution ─────────────────────────────────────
REVOKE EXECUTE ON FUNCTION run_retention_orchestrator()    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION run_retention_orchestrator()    TO service_role;
REVOKE EXECUTE ON FUNCTION outreach_cadence_days(TEXT)     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION outreach_cadence_days(TEXT)     TO service_role, authenticated;

-- ── Daily cron: 09:00 UTC (= 05:00 AST in Puerto Rico) ──────
-- Runs after the existing compute-churn-scores cron (02:00 UTC) so
-- the orchestrator reads today's freshest scores. Owner opens the
-- queue around 07:00 AST to find their morning conversations ready.
SELECT cron.schedule(
  'run-retention-orchestrator',
  '0 9 * * *',
  $$ SELECT run_retention_orchestrator(); $$
);
