-- Add streak_broken_at to streak_cache so churn model can detect recently-lapsed streaks

ALTER TABLE streak_cache
  ADD COLUMN IF NOT EXISTS streak_broken_at TIMESTAMPTZ;
