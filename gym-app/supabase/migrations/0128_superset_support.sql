-- Add superset/circuit grouping columns to routine_exercises
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS group_type TEXT CHECK (group_type IN ('superset', 'circuit'));
