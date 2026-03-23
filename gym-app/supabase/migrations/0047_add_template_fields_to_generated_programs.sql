-- Add template tracking fields to generated_programs
-- These allow us to track which program template a user enrolled in
ALTER TABLE generated_programs
  ADD COLUMN IF NOT EXISTS template_id TEXT,
  ADD COLUMN IF NOT EXISTS template_weeks JSONB;
