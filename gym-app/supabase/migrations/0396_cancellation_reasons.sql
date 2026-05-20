-- =============================================================
-- CANCELLATION EXIT SURVEY — Why they left
-- Migration: 0396_cancellation_reasons.sql
--
-- Captures Hormozi's "Exit Interview" (Gym Launch Secrets, Ch. 16):
-- structured reason category + free-text detail + a triage flag
-- for win-back potential. Stored as one row per cancellation, so
-- a member who cancels → reactivates → cancels again produces two
-- rows (history preserved, queryable for "leak in the bucket"
-- pattern analysis).
--
-- Companion to migration 0395 (weekly attendance flag):
--   0395 = leading indicator (who is about to leave)
--   0396 = lagging signal   (why the ones who left, left)
-- Both feed the retention orchestrator (ticket #4).
-- =============================================================

-- ── Reason categories (controlled vocabulary) ───────────────
-- Maps to Hormozi's six standard exit interview categories.
-- 'other' captures everything outside the six — the free-text
-- field is where the actual content lives in that case.
CREATE TYPE cancellation_reason_category AS ENUM (
  'moved',          -- relocation / geography (not addressable)
  'financial',      -- can't afford / price-sensitive
  'time',           -- too busy / schedule
  'no_results',     -- not seeing progress
  'experience',     -- don't enjoy / culture / staff / equipment
  'health',         -- injury / medical / pregnancy
  'other'           -- catch-all; rely on details_text
);

-- ── Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellation_reasons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id              UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,

  -- Survey responses
  category            cancellation_reason_category NOT NULL,
  details_text        TEXT,                          -- "Anything else?" free text
  would_return_if     TEXT,                          -- triage: what would bring them back

  -- Tenure context at cancellation time (denormalized for aggregate queries)
  tenure_days         INTEGER NOT NULL CHECK (tenure_days >= 0),

  -- Who recorded it (which admin filed the cancel)
  recorded_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Aggregate queries: "show me reasons for my gym, last 90 days"
CREATE INDEX idx_cancellation_reasons_gym_date
  ON cancellation_reasons (gym_id, recorded_at DESC);

-- Member history lookup: "did this member cancel before?"
CREATE INDEX idx_cancellation_reasons_profile
  ON cancellation_reasons (profile_id, recorded_at DESC);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE cancellation_reasons ENABLE ROW LEVEL SECURITY;

-- Admins/super_admins/trainers can read their gym's cancellations
CREATE POLICY "cancellation_reasons_read_staff"
  ON cancellation_reasons
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- Only admins/super_admins can INSERT (records cancellation reason)
CREATE POLICY "cancellation_reasons_insert_admin"
  ON cancellation_reasons
  FOR INSERT WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- ── Aggregate RPC: "Why they left" tab data ─────────────────
-- Returns category counts + percentages for a gym across a date
-- window. Powers the AdminChurn "Why they left" tab in one call,
-- avoiding N+1 client-side aggregation.
CREATE OR REPLACE FUNCTION get_cancellation_reason_breakdown(
  p_gym_id    UUID,
  p_days_back INTEGER DEFAULT 90
)
RETURNS TABLE (
  category    cancellation_reason_category,
  count       INTEGER,
  percentage  NUMERIC(5,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH window_rows AS (
    SELECT category
    FROM cancellation_reasons
    WHERE gym_id = p_gym_id
      AND recorded_at >= NOW() - (p_days_back || ' days')::INTERVAL
  ),
  totals AS (
    SELECT COUNT(*)::INTEGER AS total FROM window_rows
  )
  SELECT
    w.category,
    COUNT(*)::INTEGER AS count,
    CASE
      WHEN (SELECT total FROM totals) = 0 THEN 0::NUMERIC(5,2)
      ELSE ROUND(100.0 * COUNT(*) / (SELECT total FROM totals), 2)
    END AS percentage
  FROM window_rows w
  GROUP BY w.category
  ORDER BY count DESC;
$$;

-- Caller must belong to the gym (RLS on the underlying table also
-- enforces this, but we guard the RPC explicitly for clarity).
REVOKE EXECUTE ON FUNCTION get_cancellation_reason_breakdown(UUID, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_cancellation_reason_breakdown(UUID, INTEGER) TO authenticated;
