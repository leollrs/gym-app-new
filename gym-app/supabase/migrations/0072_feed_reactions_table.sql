-- The app code references feed_reactions with a reaction_type column,
-- but only feed_likes (no reaction_type) exists. Create the feed_reactions
-- table to support emoji reactions in SocialFeed.

CREATE TABLE IF NOT EXISTS feed_reactions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_item_id  UUID NOT NULL REFERENCES activity_feed_items(id) ON DELETE CASCADE,
    profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL DEFAULT 'like',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT feed_reactions_unique UNIQUE (feed_item_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_reactions_item ON feed_reactions(feed_item_id);

-- Migrate existing likes into the new reactions table
INSERT INTO feed_reactions (id, feed_item_id, profile_id, reaction_type, created_at)
SELECT id, feed_item_id, profile_id, 'like', created_at
FROM feed_likes
ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE feed_reactions ENABLE ROW LEVEL SECURITY;

-- RLS: anyone in the same gym can see reactions
CREATE POLICY "feed_reactions_select" ON feed_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM activity_feed_items afi
      WHERE afi.id = feed_reactions.feed_item_id
        AND afi.gym_id = public.current_gym_id()
    )
  );

-- RLS: users can insert their own reactions
CREATE POLICY "feed_reactions_insert" ON feed_reactions
  FOR INSERT WITH CHECK (profile_id = auth.uid());

-- RLS: users can delete their own reactions
CREATE POLICY "feed_reactions_delete" ON feed_reactions
  FOR DELETE USING (profile_id = auth.uid());

NOTIFY pgrst, 'reload schema';
