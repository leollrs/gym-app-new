-- =============================================================
-- Migration 0177: Daily streak check cron job
--
-- Runs check_daily_streaks() every day at 5:30 AM UTC.
-- Uses direct pg_cron RPC call (no edge function needed).
-- =============================================================

SELECT cron.schedule(
  'daily-streak-check',
  '30 5 * * *',
  $$ SELECT check_daily_streaks(); $$
);
