-- ============================================================================
-- 0421: CSV bulk-import pipeline for new-gym onboarding
--
-- Adds the schema needed to (a) absorb a gym's historical member roster as
-- pre-populated profiles + invite codes and (b) keep historical (already-
-- cancelled) members separate from live members so they feed retention
-- analytics without polluting live KPI dashboards.
--
-- Three pieces:
--
--   1. New columns on `profiles`:
--      - `imported_archived`: true for ex-members brought in as history-only
--         (never get an invite code, never appear in active rosters, but
--         their join/cancel dates feed the cohort/retention charts).
--      - `legacy_cancellation_date`: when the historical record shows the
--         member cancelled. Distinct from any future in-app cancel field so
--         the two never get conflated by the churn engine.
--      - `import_batch_id`: links back to the import batch for audit + the
--         ability to roll back a single batch without touching live signups.
--
--   2. New table `gym_import_batches` to audit every import (who, when,
--      from which file, how many rows succeeded / were archived / skipped).
--
--   3. RLS policies — super_admin only for now, since gym admins shouldn't
--      be able to wipe their own roster by accident.
-- ============================================================================

-- ── profiles: history-import columns ────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS imported_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_cancellation_date DATE,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

-- Index the archive flag because every live KPI query filters on it.
-- Partial index keeps it small — true rows are a minority and they're the
-- only ones we ever explicitly exclude.
CREATE INDEX IF NOT EXISTS idx_profiles_imported_archived
  ON profiles(gym_id)
  WHERE imported_archived = true;

-- Lookups by batch (for "show me everything that batch X created" + rollback)
CREATE INDEX IF NOT EXISTS idx_profiles_import_batch
  ON profiles(import_batch_id)
  WHERE import_batch_id IS NOT NULL;


-- ── gym_import_batches: per-import audit row ────────────────────────────────
CREATE TABLE IF NOT EXISTS gym_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  label TEXT,
  source_filename TEXT,
  row_count INT NOT NULL DEFAULT 0,
  imported_active_count INT NOT NULL DEFAULT 0,
  imported_archived_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  -- Sparse JSON array of per-row reasons for the rows that were skipped.
  -- Shape: [{ row_index: 4, reason: 'duplicate_phone', detail: '...' }, ...]
  -- Stored so the super-admin can audit why a CSV row didn't import without
  -- re-running the parse client-side.
  skip_reasons JSONB
);

CREATE INDEX IF NOT EXISTS idx_import_batches_gym
  ON gym_import_batches(gym_id, created_at DESC);

ALTER TABLE gym_import_batches ENABLE ROW LEVEL SECURITY;

-- Super-admin only. Gym admins don't run their own imports — this is a
-- vendor-managed onboarding step.
CREATE POLICY "Super admins manage import batches"
  ON gym_import_batches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Gym admins should be able to READ batch summaries for their gym (so we
-- can show "Last import: 187 members, 42 archived" on the gym detail UI),
-- but not modify them.
CREATE POLICY "Gym admins read their own batches"
  ON gym_import_batches FOR SELECT
  USING (
    gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'super_admin')
    )
  );


COMMENT ON COLUMN profiles.imported_archived IS
  'True for historical members imported via gym onboarding CSV (status=archived). They feed retention analytics but never appear in active rosters and never get invite codes.';

COMMENT ON COLUMN profiles.legacy_cancellation_date IS
  'Cancellation date carried over from the gym''s prior system during CSV import. Sparse — most legacy CSVs don''t have this field populated.';

COMMENT ON COLUMN profiles.import_batch_id IS
  'Links this profile to the gym_import_batches row that created it. Null for organically-signed-up members.';

COMMENT ON TABLE gym_import_batches IS
  'Audit row per CSV bulk-import. Lets super-admin trace where each historical member came from and roll back individual batches if needed.';
