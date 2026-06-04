-- ============================================================
-- 0512 — Per-slot trainer on class schedules
-- ============================================================
-- Adds gym_class_schedules.trainer_id so each recurring/one-off time
-- slot can record WHO teaches it. This unlocks per-trainer class
-- analytics ("does this class do better with trainer X at 9am vs
-- trainer Y at noon?"). Bookings + schedules previously had no teacher
-- record, so trainer-level performance was impossible to compute.
--
-- ON DELETE SET NULL: removing a trainer profile just unsets the slot's
-- teacher; the schedule row and its bookings are untouched.
--
-- No new RLS needed — the existing gym_class_schedules admin policy
-- ("FOR ALL USING is_admin()") already covers inserting/updating this
-- column; the frontend only writes it for admins.
-- ============================================================

ALTER TABLE gym_class_schedules
  ADD COLUMN IF NOT EXISTS trainer_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_class_schedules_trainer
  ON gym_class_schedules(trainer_id) WHERE trainer_id IS NOT NULL;

COMMENT ON COLUMN gym_class_schedules.trainer_id IS
  'Trainer/instructor who teaches this specific time slot. NULL = unassigned. Powers per-trainer class analytics.';
