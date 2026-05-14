-- ============================================================
-- 0356 — scheduled-reminders hourly cron
-- REVISED 2026-05-14 — see memory: project_push_notification_issue
-- ============================================================
-- ⚠️  HISTORY: the original 0356 scheduled the cron with
--     current_setting('app.settings.supabase_url')
--     current_setting('app.settings.service_role_key')
--     Those DB-level params were never set on this project and CANNOT
--     be — `ALTER DATABASE ... SET` needs superuser, which Supabase
--     does not grant. Every hourly tick errored 42704 and no
--     server-side push notification ever fired.
--
-- The live cron is now configured MANUALLY with an inline function URL
-- + an `X-Cron-Secret` header (the `CRON_SECRET` value is an Edge
-- Function secret — it must NOT live in a committed migration file).
--
-- This migration is therefore intentionally a SAFE NO-OP. Its only job
-- is to make sure re-running migrations (fresh DB, `db reset`, etc.)
-- can NEVER overwrite the working cron with the broken definition
-- again. It must never `cron.unschedule` or `cron.schedule` anything.
--
-- ── Manual setup (run once, in the SQL editor, NOT as a migration) ──
--   1. Add an Edge Function secret `CRON_SECRET` (any long random
--      string): `supabase secrets set CRON_SECRET=<random>`
--   2. Schedule the job:
--        SELECT cron.schedule(
--          'scheduled-reminders-hourly', '0 * * * *',
--          $$SELECT net.http_post(
--            url := '<SUPABASE_URL>/functions/v1/scheduled-reminders',
--            headers := jsonb_build_object(
--              'X-Cron-Secret', '<CRON_SECRET>',
--              'Content-Type', 'application/json'),
--            body := '{}'::jsonb
--          );$$
--        );
--   3. The function must be deployed with `--no-verify-jwt` (it does
--      its own auth via the X-Cron-Secret / service-role check).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[0356] pg_cron not installed — nothing to do.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-reminders-hourly') THEN
    RAISE NOTICE '[0356] scheduled-reminders-hourly already scheduled — leaving it untouched (safe no-op).';
  ELSE
    RAISE NOTICE '[0356] scheduled-reminders-hourly is NOT scheduled. Configure it manually — see the header comment in this file (needs CRON_SECRET, cannot be committed).';
  END IF;
END $$;
