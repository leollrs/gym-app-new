-- =============================================================
-- 0680 — retention orchestrator: "never trained" is ACTIVATION, not churn
-- =============================================================
--
-- BUG (0398, running daily at 09:00 UTC since it shipped, never patched):
--
--   WHEN s.risk_tier = 'critical'
--     OR (s.flagged_this_week AND COALESCE(s.days_since_session, 999) >= 14)
--     THEN 'critical'
--
-- `days_since_session` is NULL when the member has NEVER completed a workout.
-- That COALESCE turns "I have no signal for this person" into "999 days
-- silent" — the most urgent value possible. So every never-trained member who
-- is also flagged for low attendance was classified `critical`, every day.
--
-- Observed on a 43-member gym: 37 critical cards, all with the identical
-- reason "Never trained · 0 sessions this week · Low attendance", while the
-- Overview's Retención card (client-side v3) reported exactly 1 member at
-- risk, and those same members' detail views read "Not enough data".
-- Three views of one dataset, contradicting each other on one screen.
--
-- This is the same over-flagging churn v3 was built to kill: the client's
-- estimateChurnScoreFallback returns `insufficient_data` for a never-active
-- member and explicitly refuses to call them critical. The server-side
-- orchestrator called them critical anyway.
--
-- FIX — three parts:
--
--   1. NULL means "no signal", not "999 days". Never-trained members are
--      classified BEFORE the churn branches, so the COALESCE is gone and
--      every member reaching the churn branches has trained at least once
--      (days_since_session guaranteed NOT NULL).
--
--   2. They get their own lane. A member who never started isn't leaving —
--      they never arrived. That's an ACTIVATION conversation ("you never got
--      going, can I help?"), not a retention one ("we're losing you"), and it
--      deserves its own segment, cadence and card copy.
--        - `activation` — never trained, joined within ACTIVATION_WINDOW days.
--                         Queued, 7-day cadence, suggested action = message.
--        - `dormant`    — never trained, joined longer ago. NOT queued: they
--                         are a bulk re-activation campaign (Outreach), not a
--                         daily one-to-one card. State is still recorded so
--                         that campaign can target them later.
--
--   3. Two audience corrections found alongside it:
--        - `active_members` never filtered `imported_archived`, so archived
--          CSV imports were segmented and queued even though the admin
--          Members roster excludes them — cards for people who aren't members.
--        - only 'cancelled'/'banned' were excluded. A `frozen` or
--          `deactivated` membership still generated "call them today" cards.
--          They now land in `paused` (recorded, never queued).
--
-- Includes a bounded one-time cleanup so the ~N wrong pending cards clear on
-- apply instead of lingering until they expire.
--
-- Idempotent. No RLS/policy DDL — the two ACCESS EXCLUSIVE windows are
-- metadata-only (CHECK added NOT VALID, validated separately under a weaker
-- lock), each guarded by its own lock_timeout per the live-app lock rule.
-- =============================================================

-- ── Tunable ──────────────────────────────────────────────────
-- Days after joining that a never-trained member is still worth a personal
-- activation nudge. Past this they're `dormant` (campaign, not a daily card).
-- Kept as a literal in the function below; documented here so it's findable.
--   ACTIVATION_WINDOW = 45 days

-- ── 1. Widen the segment CHECK on member_outreach_state ──────
-- Drops whatever CHECK currently constrains the column (discovered from
-- pg_constraint rather than assumed by name, so a differently-named
-- constraint can't survive and keep rejecting the new values).
DO $$
DECLARE
  r record;
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'member_outreach_state'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%segment%'
  LOOP
    EXECUTE format('ALTER TABLE public.member_outreach_state DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.member_outreach_state
    ADD CONSTRAINT member_outreach_state_segment_check
    CHECK (segment IN ('healthy','activation','dormant','paused','cooling','at_risk','critical','churned'))
    NOT VALID;
END $$;

-- Superset of the old constraint, so every existing row already satisfies it.
-- VALIDATE takes only SHARE UPDATE EXCLUSIVE — safe against a live app.
ALTER TABLE public.member_outreach_state
  VALIDATE CONSTRAINT member_outreach_state_segment_check;

-- ── 2. Widen the segment CHECK on owner_queue_items ──────────
-- Only `activation` is added here: `dormant`/`paused` are state-only and must
-- never produce a card.
DO $$
DECLARE
  r record;
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'owner_queue_items'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%segment%'
  LOOP
    EXECUTE format('ALTER TABLE public.owner_queue_items DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.owner_queue_items
    ADD CONSTRAINT owner_queue_items_segment_check
    CHECK (segment IN ('cooling','at_risk','critical','activation'))
    NOT VALID;
END $$;

ALTER TABLE public.owner_queue_items
  VALIDATE CONSTRAINT owner_queue_items_segment_check;

-- ── 3. Cadence for the new lane ──────────────────────────────
-- 7 days: frequent enough to catch someone in their first weeks, slow enough
-- that activation never dominates the daily queue.
-- `dormant`/`paused` return NULL (never queued) — same as `healthy`.
-- SET search_path is re-declared because CREATE OR REPLACE would otherwise
-- drop the pin applied by 0620_function_search_path_hardening.
CREATE OR REPLACE FUNCTION outreach_cadence_days(p_segment TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_segment
    WHEN 'critical'   THEN 1
    WHEN 'at_risk'    THEN 7
    WHEN 'activation' THEN 7
    WHEN 'cooling'    THEN 14
    ELSE NULL
  END;
$$;

-- ── 4. The orchestrator ──────────────────────────────────────
-- DROP + CREATE rather than REPLACE: the return signature gains the three new
-- segment counts. Safe — `run_retention_orchestrator` has exactly one caller,
-- the pg_cron entry 'run-retention-orchestrator', which resolves by name at
-- run time. Grants are re-applied below (DROP discards them).
DROP FUNCTION IF EXISTS run_retention_orchestrator();

CREATE FUNCTION run_retention_orchestrator()
RETURNS TABLE (
  evaluated      INTEGER,
  critical       INTEGER,
  at_risk        INTEGER,
  cooling        INTEGER,
  activation     INTEGER,
  dormant        INTEGER,
  paused         INTEGER,
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
  v_activation     INTEGER := 0;
  v_dormant        INTEGER := 0;
  v_paused         INTEGER := 0;
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
    SELECT
      p.id AS profile_id,
      p.gym_id,
      p.membership_status,
      -- Tenure drives activation-vs-dormant. membership_started_at is the
      -- real "joined the gym" date when set; created_at is the profile row.
      COALESCE(p.membership_started_at, p.created_at) AS joined_at
    FROM profiles p
    WHERE p.role = 'member'
      AND p.gym_id IS NOT NULL
      -- Archived CSV imports are excluded from the admin Members roster
      -- (memberQueries.fetchMembers / overviewQuery). Queueing cards for
      -- them produced conversations about people who aren't members.
      AND p.imported_archived = FALSE
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
        WHEN am.joined_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NOW() - am.joined_at)) / 86400
      END AS tenure_days,
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
        -- Not a conversation at all.
        WHEN s.membership_status IN ('cancelled','banned')      THEN 'churned'
        WHEN s.membership_status IN ('frozen','deactivated')    THEN 'paused'

        -- Never completed a workout. This is ACTIVATION, not churn — and a
        -- NULL days_since_session means "no signal", never "999 days silent".
        -- Classified here, ABOVE the churn branches, so a member with no
        -- training history can never be scored as leaving.
        WHEN s.last_completed_at IS NULL
          AND COALESCE(s.tenure_days, 0) <= 45                  THEN 'activation'
        WHEN s.last_completed_at IS NULL                        THEN 'dormant'

        -- Everything below has trained at least once, so days_since_session
        -- is guaranteed NOT NULL — no COALESCE, no NULL-as-urgency.
        WHEN s.risk_tier = 'critical'
          OR (s.flagged_this_week AND s.days_since_session >= 14) THEN 'critical'
        WHEN s.risk_tier = 'high'   OR s.flagged_this_week        THEN 'at_risk'
        WHEN s.risk_tier = 'medium'
          OR s.days_since_session BETWEEN 7 AND 13                THEN 'cooling'
        ELSE 'healthy'
      END AS segment,
      COALESCE(
        (s.key_signals)[1],
        CASE
          WHEN s.last_completed_at IS NULL                          THEN 'never_activated'
          WHEN s.flagged_this_week                                  THEN 'low_attendance'
          WHEN s.days_since_session >= 14                           THEN 'absent'
          WHEN s.days_since_session BETWEEN 7 AND 13                THEN 'cooling'
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
      'tenure_days',        sg.tenure_days,
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
    COUNT(*) FILTER (WHERE segment = 'activation')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'dormant')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'paused')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'healthy')::INTEGER,
    COUNT(*) FILTER (WHERE segment = 'churned')::INTEGER
  INTO v_evaluated, v_critical, v_at_risk, v_cooling,
       v_activation, v_dormant, v_paused, v_healthy, v_churned
  FROM member_outreach_state;

  -- ── 4. Insert queue cards AND bump next_due_at, in one CTE ──
  WITH due AS (
    SELECT
      ms.profile_id,
      ms.gym_id,
      ms.segment,
      ms.top_signal,
      ms.signal_label,
      ms.metrics
    FROM member_outreach_state ms
    WHERE ms.segment IN ('critical','at_risk','cooling','activation')
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
      -- Reason: factual, owner-readable. Pieces are NULL when they don't
      -- apply; CONCAT_WS skips NULLs; the outer COALESCE guarantees a
      -- non-empty string when every piece is NULL.
      CASE
        -- Activation cards carry tenure, NOT attendance flags. "0 sessions
        -- this week · Low attendance" is noise for someone who never started
        -- — it described the symptom as if it were the problem.
        WHEN d.segment = 'activation' THEN
          COALESCE(
            NULLIF(CONCAT_WS(' · ',
              'Never trained',
              CASE
                WHEN (d.metrics ->> 'tenure_days') IS NOT NULL
                  THEN CONCAT('Joined ', (d.metrics ->> 'tenure_days')::NUMERIC::INT, 'd ago')
                ELSE NULL
              END
            ), ''),
            'Never trained'
          )
        ELSE
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
          )
      END AS reason,
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
    v_evaluated, v_critical, v_at_risk, v_cooling,
    v_activation, v_dormant, v_paused, v_healthy, v_churned,
    v_cards_inserted, v_cards_expired;
END;
$$;

-- ── 5. Re-apply grants (DROP FUNCTION discarded them) ────────
REVOKE EXECUTE ON FUNCTION run_retention_orchestrator() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION run_retention_orchestrator() TO service_role;

REVOKE EXECUTE ON FUNCTION outreach_cadence_days(TEXT)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION outreach_cadence_days(TEXT)  TO service_role, authenticated;

-- ── 6. One-time cleanup of cards the old logic produced ──────
-- Expire pending cards for members who have never completed a workout. The
-- partial unique index (one pending card per member) would otherwise block
-- the corrected card from being created until these aged out on their own.
-- Marked 'expired', never deleted — the queue's history stays intact.
UPDATE owner_queue_items q
SET status = 'expired'
WHERE q.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM workout_sessions ws
    WHERE ws.profile_id = q.profile_id
      AND ws.status = 'completed'
  );

-- Clear next_due_at for those members so the next orchestrator run re-queues
-- them immediately in the correct lane instead of waiting out the old cadence.
UPDATE member_outreach_state ms
SET next_due_at = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM workout_sessions ws
  WHERE ws.profile_id = ms.profile_id
    AND ws.status = 'completed'
);

-- =============================================================
-- Rollback (manual):
--   The 0398 definitions of run_retention_orchestrator() and
--   outreach_cadence_days() can be re-applied verbatim, then:
--     ALTER TABLE member_outreach_state DROP CONSTRAINT member_outreach_state_segment_check;
--     ALTER TABLE owner_queue_items     DROP CONSTRAINT owner_queue_items_segment_check;
--   and re-add the original CHECK lists. Any rows already written with the
--   new segment values must be re-segmented first (or the narrower CHECK
--   will fail to validate).
-- =============================================================
