-- =============================================================
-- FIX: Replace FOR ALL USING on feed_likes with explicit
-- SELECT / INSERT / DELETE policies so INSERT works reliably
-- via PostgREST / Supabase JS client.
-- Migration: 0008_feed_social_rls.sql
-- =============================================================

DROP POLICY IF EXISTS "feed_likes_gym" ON feed_likes;

-- Anyone in the gym can read likes on visible feed items
CREATE POLICY "feed_likes_select" ON feed_likes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM activity_feed_items f
      WHERE f.id = feed_item_id
        AND f.gym_id = public.current_gym_id()
    )
  );

-- Members can like any public feed item in their gym
CREATE POLICY "feed_likes_insert" ON feed_likes
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM activity_feed_items f
      WHERE f.id = feed_item_id
        AND f.gym_id = public.current_gym_id()
    )
  );

-- Members can only remove their own likes
CREATE POLICY "feed_likes_delete" ON feed_likes
  FOR DELETE USING (profile_id = auth.uid());

-- =============================================================
-- Ensure feed_comments INSERT works (profile_id = auth.uid()
-- is already a WITH CHECK, but re-stating for clarity)
-- =============================================================
DROP POLICY IF EXISTS "feed_comments_insert_own" ON feed_comments;

CREATE POLICY "feed_comments_insert" ON feed_comments
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM activity_feed_items f
      WHERE f.id = feed_item_id
        AND f.gym_id = public.current_gym_id()
    )
  );
