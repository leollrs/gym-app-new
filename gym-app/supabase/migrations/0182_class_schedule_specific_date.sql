-- Allow class schedules to be either recurring (day_of_week) or one-off (specific_date)
-- When specific_date is set, the slot is for that exact date only.
-- When specific_date is NULL, day_of_week is used for weekly recurrence.

ALTER TABLE gym_class_schedules
  ADD COLUMN IF NOT EXISTS specific_date DATE;

-- Make day_of_week nullable so one-off slots don't need a dummy value
ALTER TABLE gym_class_schedules
  ALTER COLUMN day_of_week DROP NOT NULL;

-- Ensure each slot is either recurring OR specific-date, not both
ALTER TABLE gym_class_schedules
  ADD CONSTRAINT chk_schedule_type CHECK (
    (specific_date IS NOT NULL AND day_of_week IS NULL)
    OR (specific_date IS NULL AND day_of_week IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_class_schedules_specific_date
  ON gym_class_schedules(specific_date)
  WHERE specific_date IS NOT NULL;

COMMENT ON COLUMN gym_class_schedules.specific_date IS 'When set, this is a one-off class on this exact date. When NULL, uses day_of_week for weekly recurrence.';
