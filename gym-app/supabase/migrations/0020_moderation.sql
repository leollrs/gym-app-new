-- Moderation columns: soft-delete + report counts on feed tables

-- ── activity_feed_items: soft-delete ──────────────────────
ALTER TABLE activity_feed_items
  ADD COLUMN IF NOT EXISTS is_deleted       BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by       UUID      REFERENCES profiles(id);

-- ── Report counts ──────────────────────────────────────────
ALTER TABLE activity_feed_items
  ADD COLUMN IF NOT EXISTS reported_count   INT       NOT NULL DEFAULT 0;

ALTER TABLE feed_comments
  ADD COLUMN IF NOT EXISTS reported_count   INT       NOT NULL DEFAULT 0;

-- ── RLS: admins can soft-delete feed items in their gym ────
-- activity_feed_items already has RLS enabled; add an update
-- policy scoped to the moderation columns.
CREATE POLICY "feed_items_update_admin_moderation" ON activity_feed_items
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  )
  WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );
