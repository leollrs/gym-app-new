-- =============================================================
-- MEMBERSHIP STATUS HISTORY — append-only audit log
-- Migration: 0405_membership_status_history.sql
--
-- WHY THIS EXISTS
-- ---------------
-- profiles.membership_status only stores the CURRENT state, plus a
-- single `membership_status_updated_at` timestamp for the latest
-- change. That is fine for "is this member active right now?", but
-- it cannot answer the questions retention analysis actually needs:
--
--   • Did this member cancel and then reactivate? When?
--   • How many members bounced cancelled → active → cancelled in
--     the last 90 days? (the leaky-bucket signature)
--   • What was the median time-to-reactivation by cancellation
--     reason category?
--   • Cohort survival curves: of members who became active in
--     month N, what fraction were still active at month N+3?
--
-- Migration 0404's get_retention_effectiveness currently approximates
-- a "return" with a fragile heuristic:
--     p.membership_status = 'active'
--     AND p.membership_status_updated_at > cancellation_reasons.recorded_at
-- That only catches members whose LATEST status flip happened to
-- land on 'active' after their LATEST cancellation row. Any member
-- who has cancelled a second time after reactivating is invisible
-- to that query — exactly the cohort we most want to study.
--
-- This table is the fix: append-only, every transition recorded,
-- with the admin who made it and the reason text at the time.
--
-- USAGE EXAMPLE
-- -------------
-- Members who cancelled and then reactivated in the last 90 days:
--
--   WITH cancels AS (
--     SELECT profile_id, MAX(changed_at) AS cancelled_at
--     FROM membership_status_history
--     WHERE gym_id = $1
--       AND new_status = 'cancelled'
--       AND changed_at >= NOW() - INTERVAL '180 days'
--     GROUP BY profile_id
--   ),
--   reactivations AS (
--     SELECT h.profile_id, MIN(h.changed_at) AS reactivated_at
--     FROM membership_status_history h
--     JOIN cancels c
--       ON c.profile_id = h.profile_id
--      AND h.changed_at > c.cancelled_at
--     WHERE h.gym_id = $1
--       AND h.new_status = 'active'
--       AND h.changed_at >= NOW() - INTERVAL '90 days'
--     GROUP BY h.profile_id
--   )
--   SELECT * FROM reactivations;
-- =============================================================

-- ── Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id)     ON DELETE CASCADE,
  old_status  membership_status,                       -- NULL for the initial backfill row
  new_status  membership_status NOT NULL,
  reason      TEXT,                                    -- snapshot of profiles.membership_status_reason at change time
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL  -- auth.uid() when changed by a logged-in admin; NULL for cron/service-role writes
);

-- ── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_msh_profile_changed_at
  ON membership_status_history (profile_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_msh_gym_changed_at
  ON membership_status_history (gym_id, changed_at DESC);

-- ── RLS ─────────────────────────────────────────────────────
-- Read-only for gym staff. No INSERT/UPDATE/DELETE policy — the
-- only writer is the SECURITY DEFINER trigger below, which bypasses
-- RLS by design. This makes the table effectively append-only from
-- the application's perspective.
ALTER TABLE membership_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "msh_read_staff"
  ON membership_status_history
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- ── Trigger function ────────────────────────────────────────
-- Fires from the AFTER UPDATE trigger below. SECURITY DEFINER so it
-- can insert into membership_status_history regardless of who made
-- the underlying profile UPDATE (admins via the dashboard, cron via
-- service role, etc.). The trigger's WHEN clause guarantees we are
-- only invoked on an actual status transition.
CREATE OR REPLACE FUNCTION log_membership_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO membership_status_history (
    profile_id,
    gym_id,
    old_status,
    new_status,
    reason,
    changed_by
  ) VALUES (
    NEW.id,
    NEW.gym_id,
    OLD.membership_status,
    NEW.membership_status,
    NEW.membership_status_reason,
    auth.uid()   -- NULL when invoked from cron / service-role contexts
  );
  RETURN NEW;
END;
$$;

-- Defensive — the function is only meant to be invoked by the
-- trigger, never called directly by clients.
REVOKE EXECUTE ON FUNCTION log_membership_status_change() FROM PUBLIC;

-- ── Trigger ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_log_membership_status_change ON profiles;

CREATE TRIGGER trg_log_membership_status_change
  AFTER UPDATE OF membership_status ON profiles
  FOR EACH ROW
  WHEN (OLD.membership_status IS DISTINCT FROM NEW.membership_status)
  EXECUTE FUNCTION log_membership_status_change();

-- ── Backfill ────────────────────────────────────────────────
-- One baseline row per existing profile capturing their CURRENT
-- membership_status with old_status = NULL. Gives every historical
-- analysis a starting point so a member who has been 'active' since
-- signup still appears in survival curves. Uses
-- membership_status_updated_at when present, falling back to
-- created_at, so the baseline timestamp is as accurate as possible.
INSERT INTO membership_status_history (
  profile_id,
  gym_id,
  old_status,
  new_status,
  reason,
  changed_at,
  changed_by
)
SELECT
  p.id,
  p.gym_id,
  NULL::membership_status,
  p.membership_status,
  p.membership_status_reason,
  COALESCE(p.membership_status_updated_at, p.created_at),
  NULL
FROM profiles p
WHERE p.gym_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM membership_status_history h
    WHERE h.profile_id = p.id
  );

-- =============================================================
-- INTEGRATION NEEDED (follow-up, not in this migration)
-- -------------------------------------------------------------
-- get_retention_effectiveness in 0404_retention_effectiveness.sql
-- still uses the fragile heuristic
--     p.membership_status_updated_at > cr.recorded_at
-- for both `totals.returns_30d` and `winback_by_category.returned`.
--
-- Once this table has accumulated real transitions (or immediately,
-- thanks to the backfill above), 0404 should be updated to detect
-- a "return" as:
--     EXISTS (
--       SELECT 1 FROM membership_status_history h
--       WHERE h.profile_id = cr.profile_id
--         AND h.new_status = 'active'
--         AND h.changed_at > cr.recorded_at
--         AND h.changed_at >= NOW() - INTERVAL '30 days'
--     )
-- That correctly counts members who cancelled, reactivated, and
-- (possibly) cancelled again — the leaky-bucket cohort that the
-- current heuristic silently drops.
--
-- Tracked as a follow-up migration; do not modify 0404 here.
-- =============================================================
