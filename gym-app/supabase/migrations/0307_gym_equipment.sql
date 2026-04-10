-- ============================================================
-- 0307: Gym equipment configuration
--
-- Stores which equipment each gym has available.
-- Used in onboarding to auto-select equipment for new members.
-- ============================================================

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS available_equipment TEXT[] DEFAULT ARRAY['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight'];

NOTIFY pgrst, 'reload schema';
