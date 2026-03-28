-- Add skip_suggestion_date to profiles for persisting "skip today's suggestion" across sessions
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS skip_suggestion_date DATE;
