-- Re-schedule the scheduled-reminders edge function to run hourly so each
-- check can gate itself on the member's local time (instead of relying on
-- 3 fixed UTC ticks per day, which made smart timing impossible across
-- timezones and prevented rest-day acknowledgements from firing).
--
-- Quiet hours (10pm–7am local) are still enforced inside sendPush() in the
-- edge function — pushes are skipped, but the in-app notification row is
-- still inserted, so nothing fires while members are asleep.

-- Drop the 3 old fixed-UTC schedules introduced in migration 0280.
SELECT cron.unschedule('scheduled-reminders-morning')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-reminders-morning');
SELECT cron.unschedule('scheduled-reminders-afternoon') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-reminders-afternoon');
SELECT cron.unschedule('scheduled-reminders-evening')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-reminders-evening');

-- One hourly job. The edge function fans out across active gyms and per-member
-- local-hour gates (8–10am, 11am–1pm, 4–6pm, 7–9pm) decide which check runs.
SELECT cron.schedule(
  'scheduled-reminders-hourly',
  '0 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/scheduled-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );$$
);
