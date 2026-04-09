-- Add recurrence_group to trainer_sessions for recurring session support
ALTER TABLE trainer_sessions ADD COLUMN IF NOT EXISTS recurrence_group UUID;
CREATE INDEX IF NOT EXISTS idx_trainer_sessions_recurrence ON trainer_sessions(recurrence_group) WHERE recurrence_group IS NOT NULL;

NOTIFY pgrst, 'reload schema';
