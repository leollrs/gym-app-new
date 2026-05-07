-- ============================================================
-- 0325 — Admin-controlled "featured" reward flag
-- ============================================================
-- Adds is_featured to gym_rewards so the admin can pick which reward
-- shows in the customer-facing Featured tile. If no reward is featured,
-- the customer-facing UI omits the featured tile entirely.
-- Only one row per gym should be featured at a time; the partial unique
-- index enforces that without forbidding multiple non-featured rows.

ALTER TABLE gym_rewards
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS gym_rewards_one_featured_per_gym
  ON gym_rewards(gym_id)
  WHERE is_featured = true;
