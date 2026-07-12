-- 0607 — Performance indexes for AdminRevenue / AdminStore hot queries
-- ============================================================
-- Audit-2 (Phase A + C):
--   • reward_points_log had NO gym_id index (only idx_reward_points_log_profile
--     on profile_id), so AdminRevenue's per-gym points query sequential-scanned
--     the entire fleet-wide, fastest-growing table on every load.
--   • member_purchases had no (gym_id, created_at) index — the closest index
--     idx_member_purchases_gym_member buries created_at behind member_id, so the
--     gym + date-sorted revenue query couldn't use it.
--
-- Plain CREATE INDEX (not CONCURRENTLY): Supabase migrations run inside a
-- transaction, which CONCURRENTLY forbids. These tables are small pre-launch, so
-- the build is fast and the brief write-lock is negligible — building the index
-- now, before the tables grow, is exactly the right time.

CREATE INDEX IF NOT EXISTS idx_reward_points_log_gym_created
  ON reward_points_log (gym_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_purchases_gym_created
  ON member_purchases (gym_id, created_at DESC);
