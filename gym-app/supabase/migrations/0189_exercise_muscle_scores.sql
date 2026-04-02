-- Add muscle scoring columns to exercises table
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS muscle_scores JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS movement_pattern TEXT;
