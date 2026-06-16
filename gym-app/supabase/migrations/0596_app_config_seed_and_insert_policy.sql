-- ============================================================
-- 0596 — app_config row re-seed + INSERT RLS policy (version-gate self-heal)
-- ============================================================
-- Symptom: the platform System tab's "App Version Gate" save reported a fake
-- green "Saved ✓" but the version never actually changed. Root cause: the
-- client did `UPDATE app_config ... WHERE id = 1`, which returns {error:null}
-- even when it touches ZERO rows — i.e. when the singleton row id=1 is missing
-- (a fresh project where 0393's INSERT never ran) or an UPDATE-only RLS policy
-- silently filters it out. The UI then painted success over a no-op.
--
-- The client fix switches that write to an UPSERT (onConflict:'id') with a
-- 0-row guard, so a missing row self-heals on first save. But UPSERT needs an
-- INSERT path through RLS, and 0393 only ever granted UPDATE to super-admins —
-- so the self-healing INSERT would be silently blocked. This migration adds
-- the matching INSERT policy and re-asserts the seed row.
--
-- Scope: 0393 owns the table, the UPDATE policy, the audit trigger, and
-- get_app_version(); assume it is applied. This migration ONLY:
--   1. ensures row id=1 exists (idempotent, no-op if 0393 already seeded it),
--   2. adds a super-admin INSERT policy locked to id=1 (the CHECK enforces the
--      single-row invariant the table's `CHECK (id = 1)` already implies).
-- ============================================================

-- 1. Re-seed the singleton row. ON CONFLICT keeps any existing values
--    (does NOT clobber a real version an admin already set).
INSERT INTO app_config (id, min_required_version, latest_version)
VALUES (1, '1.0.0', '1.0.0')
ON CONFLICT (id) DO NOTHING;

-- 2. INSERT policy so the client UPSERT can create the row if it is ever
--    missing. Locked to id=1 + super-admin only, matching the UPDATE policy's
--    blast-radius reasoning in 0393 (a version bump locks everyone out).
DROP POLICY IF EXISTS "app_config_insert_super_admin" ON app_config;
CREATE POLICY "app_config_insert_super_admin"
  ON app_config FOR INSERT
  TO authenticated
  WITH CHECK (id = 1 AND public.is_super_admin());

NOTIFY pgrst, 'reload schema';
