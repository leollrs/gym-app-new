-- Add duration_weeks column so the display knows the actual program length
-- instead of hardcoding 6 weeks everywhere.
ALTER TABLE generated_programs
  ADD COLUMN IF NOT EXISTS duration_weeks INT NOT NULL DEFAULT 6;
