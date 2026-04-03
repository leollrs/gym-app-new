-- Add missing send_reminder column to trainer_sessions.
-- TrainerSchedule.jsx reads/writes this column for session reminder toggles.

ALTER TABLE trainer_sessions
  ADD COLUMN IF NOT EXISTS send_reminder BOOLEAN NOT NULL DEFAULT true;
