-- =============================================================
-- Fix: Align user_achievements table with client-side key-based
-- achievement system. The code uses achievement_key (TEXT) but
-- the table only has achievement_id (UUID FK).
-- Migration: 0083_fix_user_achievements_schema.sql
-- =============================================================

-- Add columns the code expects
ALTER TABLE user_achievements
  ADD COLUMN IF NOT EXISTS achievement_key TEXT,
  ADD COLUMN IF NOT EXISTS earned_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- Populate user_id from profile_id for existing rows
UPDATE user_achievements SET user_id = profile_id WHERE user_id IS NULL;

-- Populate earned_at from unlocked_at for existing rows
UPDATE user_achievements SET earned_at = unlocked_at WHERE earned_at IS NULL;

-- Make achievement_id nullable (we use achievement_key now)
ALTER TABLE user_achievements ALTER COLUMN achievement_id DROP NOT NULL;

-- Add unique constraint for key-based upserts
ALTER TABLE user_achievements
  DROP CONSTRAINT IF EXISTS user_achievements_user_key_unique;
ALTER TABLE user_achievements
  ADD CONSTRAINT user_achievements_user_key_unique UNIQUE (user_id, achievement_key);

-- Index for key-based lookups
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_key
  ON user_achievements(user_id, achievement_key);

-- RLS policy for the code's user_id column
CREATE POLICY "user_achievements_own_read" ON user_achievements
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_achievements_own_insert" ON user_achievements
  FOR INSERT WITH CHECK (user_id = auth.uid());
