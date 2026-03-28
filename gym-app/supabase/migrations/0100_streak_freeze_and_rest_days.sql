-- ============================================================
-- Streak freeze system (Duolingo-style)
-- 1 freeze per month, resets on the 1st. Saves streak once.
-- Rest days and gym closed days are "safe" — don't break streak.
-- ============================================================

-- Add freeze tracking to streak_cache
ALTER TABLE streak_cache
  ADD COLUMN IF NOT EXISTS streak_freeze_used BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS streak_freeze_reset_at DATE NOT NULL DEFAULT DATE_TRUNC('month', CURRENT_DATE)::date;
