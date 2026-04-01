-- Add health_sync_enabled flag to profiles so connection state persists across devices
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS health_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;
