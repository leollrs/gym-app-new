-- =============================================================
-- UGC moderation: per-user "hide this post" (App Store 1.2 / Play UGC)
-- Migration: 0313_hidden_posts.sql
--
-- Stores which feed items a viewer has chosen to hide from their own
-- feed. We do NOT FK feed_item_id because the feed mixes several
-- item types (activity_feed_items today, future types tomorrow). The
-- viewer's profile FK has `ON DELETE CASCADE`, which removes the row
-- automatically when an account is deleted — so we don't need to
-- touch the `delete_user_account_admin` cascade.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.hidden_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feed_item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, feed_item_id)
);

CREATE INDEX IF NOT EXISTS idx_hidden_posts_profile ON public.hidden_posts(profile_id);

ALTER TABLE public.hidden_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hidden_posts_select_own" ON public.hidden_posts
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "hidden_posts_insert_own" ON public.hidden_posts
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "hidden_posts_delete_own" ON public.hidden_posts
  FOR DELETE USING (profile_id = auth.uid());
