-- =============================================================
-- Custom exercises: allow members to create their own exercises
-- and save exercises created by friends.
-- Migration: 0010_custom_exercises.sql
-- =============================================================

-- 1. Track who created each custom exercise
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 2. Drop the admin-only INSERT policy; allow any member to insert
--    a custom exercise for their gym, as themselves
DROP POLICY IF EXISTS "exercises_insert_admin" ON exercises;

CREATE POLICY "exercises_insert_member" ON exercises
  FOR INSERT WITH CHECK (
    gym_id     = public.current_gym_id()
    AND created_by = auth.uid()
  );

-- 3. Creators can update / delete their own exercises
CREATE POLICY "exercises_update_own" ON exercises
  FOR UPDATE USING (
    created_by = auth.uid()
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "exercises_delete_own" ON exercises
  FOR DELETE USING (
    created_by = auth.uid()
    AND gym_id = public.current_gym_id()
  );

-- =============================================================
-- user_saved_exercises: personal exercise bookmarks
-- Saving a friend's exercise adds it to your "Mine" tab
-- =============================================================
CREATE TABLE IF NOT EXISTS user_saved_exercises (
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, exercise_id)
);

ALTER TABLE user_saved_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_saved_exercises_own" ON user_saved_exercises
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
