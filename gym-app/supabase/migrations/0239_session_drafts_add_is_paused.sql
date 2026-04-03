-- Add is_paused column to session_drafts so pause state survives app backgrounding/kill.
ALTER TABLE session_drafts ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE;
