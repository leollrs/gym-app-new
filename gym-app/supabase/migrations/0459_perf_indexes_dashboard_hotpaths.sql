-- Performance indexes for the two hottest hot-path queries surfaced by the
-- full-codebase performance audit.
--
-- NOTE: three other indexes the audit proposed already exist and are NOT
-- recreated here:
--   • milestone_events(gym_id, created_at DESC)  → idx_milestone_gym_created (0088)
--   • routine_exercises(routine_id, position)     → idx_routine_exercises_routine (0001)
--   • feed_comments(feed_item_id, is_deleted)     → composite index (0078) already
--     serves get_feed_enrichment's active-comment count.

-- 1. get_dashboard_data "sessions" block (runs on every Dashboard mount) filters
--    profile_id + status='completed' and ORDERs BY completed_at DESC. The only
--    profile index is idx_sessions_profile(profile_id, started_at DESC) — wrong
--    sort column and no status predicate, so it can't serve the ORDER BY cleanly.
CREATE INDEX IF NOT EXISTS idx_sessions_profile_completed
  ON public.workout_sessions (profile_id, completed_at DESC)
  WHERE status = 'completed';

-- 2. get_dashboard_data "program" block:
--      WHERE profile_id = _uid AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1
--    generated_programs has NO index at all today → full scan on every dashboard load.
CREATE INDEX IF NOT EXISTS idx_generated_programs_profile
  ON public.generated_programs (profile_id, created_at DESC);
