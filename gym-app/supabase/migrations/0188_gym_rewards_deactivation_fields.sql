-- Add deactivation tracking to gym_rewards
ALTER TABLE gym_rewards
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_note TEXT;
