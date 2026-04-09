-- Schedule the reminder edge function to run 3x daily
-- Morning (1 PM UTC = 8 AM EST): workout reminders
-- Afternoon (9 PM UTC = 4 PM EST): streak + nutrition reminders
-- Evening (1 AM UTC = 8 PM EST): reengagement + weight log

SELECT cron.schedule(
  'scheduled-reminders-morning',
  '0 13 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/scheduled-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );$$
);

SELECT cron.schedule(
  'scheduled-reminders-afternoon',
  '0 21 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/scheduled-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );$$
);

SELECT cron.schedule(
  'scheduled-reminders-evening',
  '0 1 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/scheduled-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );$$
);
