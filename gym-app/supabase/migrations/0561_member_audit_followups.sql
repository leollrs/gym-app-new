-- ============================================================
-- 0561 — Member audit 2026-06-13 follow-ups
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor.
--
-- Two small additive columns surfaced by the final member-side audit:
--   1. workout_sessions.rating — the post-workout "how did it feel?" 1-5
--      rating is collected in the finish-summary modal but was never
--      persisted (the value was dropped on save).
--   2. gyms.support_email — white-label support address. The member Support
--      page falls back to the platform email until a gym sets its own;
--      AuthContext already reads this column into gymConfig.supportEmail.
--
-- Both are additive, nullable, and backward-compatible — no backfill needed,
-- safe to apply while the app is live.

ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS rating SMALLINT
  CONSTRAINT workout_sessions_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);

COMMENT ON COLUMN public.workout_sessions.rating IS
  'Post-workout subjective effort/feel rating 1-5 (1 = struggled, 5 = on fire), set from the finish-summary modal. Nullable.';

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS support_email TEXT;

COMMENT ON COLUMN public.gyms.support_email IS
  'White-label support contact email shown on the member Support page. NULL → app uses the platform default support address.';
