-- 0328_user_post_feed_type.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds 'user_post' to the feed_item_type enum.
--
-- Context: SocialFeed and three Share sheets (ShareSheet, ShareAchievementSheet,
-- ShareCardioSheet) have been inserting into activity_feed_items with
-- type = 'user_post' since the social-posts feature shipped, but no migration
-- ever extended the enum (which only contained workout_completed, pr_hit,
-- challenge_joined, challenge_won, achievement_unlocked, check_in,
-- program_started, cardio_completed). Every post insert was silently failing
-- with Postgres 22P02 (invalid enum value), and the client silently swallowed
-- the error — making "Post" buttons appear non-functional and the friend feed
-- empty (because no posts ever made it into the table).
--
-- This migration unblocks user posts. The accompanying client patch surfaces
-- insert errors via toast so future schema drift fails loudly.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE feed_item_type ADD VALUE IF NOT EXISTS 'user_post';
