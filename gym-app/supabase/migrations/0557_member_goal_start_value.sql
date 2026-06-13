-- =============================================================
-- 0557_member_goal_start_value.sql
--
-- The goal progress bar was direction-blind. It computed
-- current_value / target_value, which only works for goals that
-- count UP toward the target (lift_1rm, workout_count, volume,
-- streak). body_weight / body_fat goals start ABOVE the target and
-- move DOWN, so the ratio is >1 and clamps to 100% the whole time
-- (and body goals were also seeded current_value 0, so the bar
-- never moved at all).
--
-- The fix needs a baseline: where the member STARTED. Progress is
-- then distance covered, (start - current) / (start - target),
-- which is correct in both directions (cut or bulk). This column
-- stores that baseline; it is seeded at goal creation with the
-- member's current metric (latest weight / body-fat / 1RM) and, for
-- body goals created before any metric was logged, backfilled on the
-- first body-metric log (see lib/goalUpdater.js updateBodyMetricGoals).
--
-- Nullable on purpose: legacy goals have no baseline and the client
-- falls back to the old current/target formula for them.
-- =============================================================

ALTER TABLE member_goals ADD COLUMN IF NOT EXISTS start_value NUMERIC;

COMMENT ON COLUMN member_goals.start_value IS
  'Baseline metric captured when the goal was created (or first logged), used to render direction-aware progress: (start - current) / (start - target). NULL for legacy goals.';
