-- Social feed improvements: user posts, milestone reactions
-- Adds columns for user-created posts to activity_feed_items

ALTER TABLE activity_feed_items ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE activity_feed_items ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE activity_feed_items ADD COLUMN IF NOT EXISTS post_type TEXT DEFAULT 'auto'; -- 'auto' or 'user'

-- Milestone reactions table
CREATE TABLE IF NOT EXISTS milestone_reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  milestone_id UUID NOT NULL REFERENCES milestone_events(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(milestone_id, profile_id)
);

-- RLS for milestone_reactions
ALTER TABLE milestone_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view milestone reactions in their gym"
  ON milestone_reactions FOR SELECT
  USING (true);

CREATE POLICY "Members can insert their own reactions"
  ON milestone_reactions FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Members can delete their own reactions"
  ON milestone_reactions FOR DELETE
  USING (profile_id = auth.uid());

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_milestone_reactions_milestone ON milestone_reactions(milestone_id);
CREATE INDEX IF NOT EXISTS idx_milestone_reactions_profile ON milestone_reactions(profile_id);

-- Index for feed ranking queries
CREATE INDEX IF NOT EXISTS idx_activity_feed_items_post_type ON activity_feed_items(post_type);
