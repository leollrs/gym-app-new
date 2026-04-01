-- Track whether user has completed the app tour (persists across reinstalls)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_seen_tour BOOLEAN NOT NULL DEFAULT false;
