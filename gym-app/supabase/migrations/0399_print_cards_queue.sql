-- =============================================================
-- PRINT CARDS QUEUE — the analog witnessing touch
-- Migration: 0399_print_cards_queue.sql
--
-- The physical card the owner prints at the gym, signs by hand, and
-- delivers in person on the member's next visit. This is the analog
-- delivery vehicle for the witnessing thesis — software remembers
-- the occasion, the owner provides the human acknowledgment.
--
-- Why print-at-gym, not Lob mail:
--   PR gym economics (per memory): $50/mo memberships, ~$500 LTV,
--   <1% revenue ceiling for retention spend = ~$5–10/yr/member max.
--   Lob mail at ~$3/card × 5 cards/yr = $15 = 3% revenue. Dead on
--   arrival. Avery 8371 business-card cardstock prints 10 cards
--   per $0.70 sheet = ~$0.07/card on the owner's existing printer.
--
-- The owner does the labor. Software just remembers who and why.
--
-- Generation triggers (this migration):
--   * Returning member  — came back after 14+ days silent
--   * Workout milestone — first session, 25th, 100th, 500th
--
-- Manual enqueueing also supported (owner clicks "Send card" on a
-- member's profile, picks an occasion, custom note).
-- =============================================================

-- ── Occasion vocabulary ─────────────────────────────────────
CREATE TYPE card_occasion AS ENUM (
  'welcome',           -- first session ever
  'milestone_25',      -- 25th workout
  'milestone_100',     -- 100th workout
  'milestone_500',     -- 500th workout
  'first_pr',          -- first PR (reserved for future trigger)
  'returning',         -- came back after 14+ days silent
  'birthday',          -- reserved (needs profile.date_of_birth)
  'custom'             -- owner-authored ad-hoc
);

-- ── Queue table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS print_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,

  occasion        card_occasion NOT NULL,
  -- Free-form payload for occasion specifics:
  --   { "milestone_n": 25, "absence_days": 17, "custom_text": "..." }
  occasion_data   JSONB NOT NULL DEFAULT '{}',

  -- The headline line on the card (denormalized so the print view
  -- doesn't recompute it for every render). Generated at enqueue time.
  headline        TEXT NOT NULL,
  -- Optional secondary line ("Your 25th workout — Apr 14")
  subline         TEXT,
  -- Optional owner-authored handwritten content (in case they want a
  -- pre-printed message instead of leaving the white space blank)
  printed_note    TEXT,

  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','printed','delivered','expired','dismissed')),

  printed_at      TIMESTAMPTZ,
  printed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  delivered_at    TIMESTAMPTZ,
  delivered_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cards expire if unprinted — keeps the queue from accumulating
  -- stale occasions. 30 days is generous; owner does weekly batches.
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX idx_print_cards_gym_status
  ON print_cards (gym_id, status, created_at DESC);

CREATE INDEX idx_print_cards_profile
  ON print_cards (profile_id, created_at DESC);

-- Dedup guard: only one pending card per (profile, occasion) at a time.
-- For occasion='milestone_25' we never want two of those queued. Custom
-- cards bypass this (they have varying occasion_data).
CREATE UNIQUE INDEX idx_print_cards_pending_per_occasion
  ON print_cards (profile_id, occasion)
  WHERE status = 'pending' AND occasion <> 'custom';

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE print_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "print_cards_read_staff"
  ON print_cards FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

CREATE POLICY "print_cards_update_staff"
  ON print_cards FOR UPDATE USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- Admin/super_admin can also manually enqueue (owner clicks "send card"
-- on a member). Trainer can't — keeps the print queue's tone owned by
-- ownership voice.
CREATE POLICY "print_cards_insert_admin"
  ON print_cards FOR INSERT WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- ── Enqueue helper RPC (used by cron + manual UI button) ────
-- SECURITY DEFINER so the cron (postgres role) can call it the same
-- way the UI can. The unique index handles dedup; this returns NULL
-- when the dedup index blocks a duplicate.
CREATE OR REPLACE FUNCTION enqueue_print_card(
  p_profile_id    UUID,
  p_gym_id        UUID,
  p_occasion      card_occasion,
  p_headline      TEXT,
  p_subline       TEXT DEFAULT NULL,
  p_occasion_data JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
BEGIN
  INSERT INTO print_cards (profile_id, gym_id, occasion, headline, subline, occasion_data)
  VALUES (p_profile_id, p_gym_id, p_occasion, p_headline, p_subline, COALESCE(p_occasion_data, '{}'::JSONB))
  ON CONFLICT DO NOTHING       -- dedup index handles same-occasion duplicates
  RETURNING id INTO v_card_id;

  RETURN v_card_id;  -- NULL when a pending duplicate already exists
END;
$$;

REVOKE EXECUTE ON FUNCTION enqueue_print_card(UUID, UUID, card_occasion, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION enqueue_print_card(UUID, UUID, card_occasion, TEXT, TEXT, JSONB)
  TO authenticated, service_role;

-- ── Daily card generation cron ──────────────────────────────
-- Detects high-signal moments in the last 24 hours and enqueues the
-- corresponding card. Idempotent thanks to the dedup index — re-runs
-- don't duplicate cards already queued.
--
-- Returns counts so the cron log shows what happened.
CREATE OR REPLACE FUNCTION generate_print_cards_daily()
RETURNS TABLE (
  welcome_cards     INTEGER,
  milestone_cards   INTEGER,
  returning_cards   INTEGER,
  cards_expired     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_welcome   INTEGER := 0;
  v_milestone INTEGER := 0;
  v_returning INTEGER := 0;
  v_expired   INTEGER := 0;
BEGIN
  -- ── Auto-expire stale pending cards ──
  UPDATE print_cards
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at <= NOW();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- ── Welcome cards: members whose FIRST completed workout was today ──
  -- "First ever" detection: only one completed session for this profile
  -- AND it landed in the last 24h.
  WITH first_workouts AS (
    SELECT
      ws.profile_id,
      p.gym_id,
      MIN(ws.completed_at) AS first_completed_at,
      COUNT(*)             AS total_sessions
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.status = 'completed'
      AND p.role = 'member'
      AND p.membership_status = 'active'
    GROUP BY ws.profile_id, p.gym_id
    HAVING COUNT(*) = 1
       AND MIN(ws.completed_at) >= NOW() - INTERVAL '24 hours'
  ),
  welcome_ins AS (
    SELECT enqueue_print_card(
      fw.profile_id,
      fw.gym_id,
      'welcome'::card_occasion,
      'Welcome to the gym',
      'Your first workout is on the board.',
      '{}'::JSONB
    ) AS card_id
    FROM first_workouts fw
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_welcome
  FROM welcome_ins;

  -- ── Milestone cards: 25 / 100 / 500 completed workouts ──
  -- Detection: the COUNT crossed the threshold within the last 24h.
  -- We compare today's count to yesterday's count by looking at
  -- whether the threshold sits BETWEEN them.
  WITH session_counts AS (
    SELECT
      ws.profile_id,
      p.gym_id,
      COUNT(*) FILTER (WHERE ws.completed_at <= NOW() - INTERVAL '24 hours') AS prior_count,
      COUNT(*) AS current_count
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.status = 'completed'
      AND p.role = 'member'
      AND p.membership_status = 'active'
    GROUP BY ws.profile_id, p.gym_id
  ),
  crossings AS (
    SELECT
      sc.profile_id,
      sc.gym_id,
      CASE
        WHEN sc.prior_count < 25  AND sc.current_count >= 25  THEN 25
        WHEN sc.prior_count < 100 AND sc.current_count >= 100 THEN 100
        WHEN sc.prior_count < 500 AND sc.current_count >= 500 THEN 500
        ELSE NULL
      END AS milestone_n
    FROM session_counts sc
  ),
  milestone_ins AS (
    SELECT enqueue_print_card(
      c.profile_id,
      c.gym_id,
      CASE c.milestone_n
        WHEN 25  THEN 'milestone_25'
        WHEN 100 THEN 'milestone_100'
        WHEN 500 THEN 'milestone_500'
      END::card_occasion,
      CONCAT(c.milestone_n, ' workouts logged'),
      'I see the work you''re putting in.',
      jsonb_build_object('milestone_n', c.milestone_n)
    ) AS card_id
    FROM crossings c
    WHERE c.milestone_n IS NOT NULL
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_milestone
  FROM milestone_ins;

  -- ── Returning member cards: came back after 14+ days silent ──
  -- Detection: latest completed workout was in the last 24h, AND the
  -- session before that was >=14 days earlier.
  WITH ranked_sessions AS (
    SELECT
      ws.profile_id,
      p.gym_id,
      ws.completed_at,
      ROW_NUMBER() OVER (PARTITION BY ws.profile_id ORDER BY ws.completed_at DESC) AS rn
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.status = 'completed'
      AND p.role = 'member'
      AND p.membership_status = 'active'
  ),
  per_member AS (
    SELECT
      profile_id,
      gym_id,
      MAX(completed_at) FILTER (WHERE rn = 1) AS last_completed,
      MAX(completed_at) FILTER (WHERE rn = 2) AS prev_completed
    FROM ranked_sessions
    WHERE rn <= 2
    GROUP BY profile_id, gym_id
  ),
  returnees AS (
    SELECT
      pm.profile_id,
      pm.gym_id,
      EXTRACT(DAY FROM (pm.last_completed - pm.prev_completed))::INT AS absence_days
    FROM per_member pm
    WHERE pm.last_completed >= NOW() - INTERVAL '24 hours'
      AND pm.prev_completed IS NOT NULL
      AND pm.last_completed - pm.prev_completed >= INTERVAL '14 days'
  ),
  returning_ins AS (
    SELECT enqueue_print_card(
      r.profile_id,
      r.gym_id,
      'returning'::card_occasion,
      'Welcome back',
      CONCAT('Good to see you after ', r.absence_days, ' days.'),
      jsonb_build_object('absence_days', r.absence_days)
    ) AS card_id
    FROM returnees r
  )
  SELECT COUNT(*) FILTER (WHERE card_id IS NOT NULL)::INTEGER
    INTO v_returning
  FROM returning_ins;

  RETURN QUERY SELECT v_welcome, v_milestone, v_returning, v_expired;
END;
$$;

REVOKE EXECUTE ON FUNCTION generate_print_cards_daily() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_print_cards_daily() TO service_role;

-- ── Cron: 04:00 UTC daily (= 00:00 AST in Puerto Rico) ──────
-- Runs before the orchestrator (09:00 UTC) so today's milestone/return
-- cards are queued when the owner opens the morning queue.
SELECT cron.schedule(
  'generate-print-cards',
  '0 4 * * *',
  $$ SELECT generate_print_cards_daily(); $$
);
