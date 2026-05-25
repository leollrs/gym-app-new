-- ============================================================
-- 0448 — Unschedule the dead 0280 reminder crons
-- ============================================================
-- 0280 registered three jobs (scheduled-reminders-morning / -afternoon /
-- -evening) whose command used current_setting('app.settings.supabase_url'),
-- a DB param that was never set on this project — so every tick errored 42704.
-- They were superseded by the manually-configured `scheduled-reminders-hourly`
-- job (see 0356). This removes the zombies so they stop spamming cron error
-- logs. Idempotent + safe: only unschedules what's actually present, and never
-- touches `scheduled-reminders-hourly` (the working one).
-- ============================================================

DO $$
DECLARE
  j TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[0448] pg_cron not installed — nothing to do.';
    RETURN;
  END IF;

  FOREACH j IN ARRAY ARRAY[
    'scheduled-reminders-morning',
    'scheduled-reminders-afternoon',
    'scheduled-reminders-evening'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
      RAISE NOTICE '[0448] unscheduled dead cron %', j;
    END IF;
  END LOOP;
END $$;
