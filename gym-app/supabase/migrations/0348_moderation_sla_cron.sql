-- ============================================================
-- 0348 — Schedule the moderation 24h SLA monitor (hourly)
-- ============================================================
-- Apple Guideline 1.2 / Google Play UGC compliance.
--
-- Calls the `check-moderation-sla` edge function once per hour. The
-- function checks for content_reports rows that have been in 'pending'
-- status for >24h and emails support@tugympr.com if any are found.
--
-- Requires:
--   - extension `pg_cron`     (present — used in 0033, 0177, 0263, 0280)
--   - extension `pg_net`      (present — used in 0086, 0177, 0280)
--   - app.settings.supabase_url   (DB-level setting)
--   - app.settings.service_role_key (DB-level setting)
--
-- If pg_cron / pg_net are NOT enabled in this Supabase project for some
-- reason, this migration will surface an error on the cron.schedule call.
-- The fallback is to schedule the function manually via the Supabase
-- Dashboard → Edge Functions → Cron at `0 * * * *` (hourly), pointing at
--   POST {SUPABASE_URL}/functions/v1/check-moderation-sla
-- with an Authorization: Bearer <service-role-key> header.
-- ============================================================

-- Idempotent: drop any existing job with this name before re-scheduling.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('moderation-sla-hourly')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'moderation-sla-hourly'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.schedule(
      'moderation-sla-hourly',
      '0 * * * *',
      $cron$
        SELECT net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/check-moderation-sla',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron or pg_net not available — schedule check-moderation-sla manually via Supabase Dashboard (hourly: 0 * * * *).';
  END IF;
END $$;
