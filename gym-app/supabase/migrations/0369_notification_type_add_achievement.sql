-- ============================================================
-- 0369 — Add 'achievement' to notification_type enum
-- ============================================================
-- Field-reported bug (May 2026 gym test): post-workout achievement
-- unlock fires a yellow Capacitor toast:
--
--   [reject] invalid input value for enum notification_type: "achievement"
--
-- The notification_type enum was created in 0001 and extended in 0271
-- + 0334 with several values, but never with 'achievement'. The client
-- (`SessionSummary.jsx:342`) inserts notifications with that exact
-- type when a badge is unlocked at the end of a session, distinct from
-- the existing 'milestone' type which is used for count-based hits.
--
-- Fix: add 'achievement' so the insert succeeds.
-- ============================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'achievement';

NOTIFY pgrst, 'reload schema';
