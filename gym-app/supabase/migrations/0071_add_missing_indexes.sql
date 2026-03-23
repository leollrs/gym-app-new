-- Add missing indexes for common query patterns that will degrade at scale

-- workout_sessions(profile_id, status) — used on Dashboard, ActiveSession, Leaderboard
CREATE INDEX IF NOT EXISTS idx_sessions_profile_status
  ON workout_sessions (profile_id, status);

-- notifications(profile_id, read_at) — used for unread count queries
CREATE INDEX IF NOT EXISTS idx_notifications_profile_read
  ON notifications (profile_id, read_at);

-- feed_comments(feed_item_id, is_deleted) — used when loading comment counts
CREATE INDEX IF NOT EXISTS idx_feed_comments_item
  ON feed_comments (feed_item_id, is_deleted);

-- challenge_participants(gym_id) — used when loading all participants for a gym's challenges
CREATE INDEX IF NOT EXISTS idx_challenge_participants_gym
  ON challenge_participants (gym_id);

-- session_drafts(profile_id, routine_id) — used for draft lookups during active sessions
CREATE INDEX IF NOT EXISTS idx_session_drafts_profile_routine
  ON session_drafts (profile_id, routine_id);

NOTIFY pgrst, 'reload schema';
