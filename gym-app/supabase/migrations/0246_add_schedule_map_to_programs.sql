-- Add schedule_map JSONB to generated_programs.
-- Stores the DOW-to-routine-index mapping so the display layer
-- knows which template day goes on which calendar day.
-- Example:
-- {
--   "routine_day_map": [{"routine_index":0,"day_of_week":5}, ...],
--   "start_dow": 5,
--   "week1_dows": [5, 6],
--   "wrapped_dows": [1, 2, 3]
-- }
ALTER TABLE generated_programs
  ADD COLUMN IF NOT EXISTS schedule_map JSONB DEFAULT NULL;
