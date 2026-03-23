-- Add onboarding preference columns that were missing from profiles.
-- preferred_training_days stores English day names e.g. ['Monday','Wednesday','Friday']
-- preferred_training_time stores 'morning' | 'afternoon' | 'evening'
-- workout_buddy_username stores the username of a user's training partner (nullable)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_training_days  TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS preferred_training_time  TEXT,
  ADD COLUMN IF NOT EXISTS workout_buddy_username   TEXT;
