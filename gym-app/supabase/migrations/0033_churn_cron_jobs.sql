-- =============================================================
-- CRON JOBS — Automated churn scoring & calibration
-- Migration: 0033_churn_cron_jobs.sql
--
-- Uses pg_cron + pg_net (both available on Supabase hosted)
-- to trigger edge functions on a schedule.
-- Reads credentials from Supabase Vault (encrypted secrets).
--
-- PREREQUISITE: Run these in the SQL editor first:
--   SELECT vault.create_secret('<your-supabase-url>', 'supabase_url', 'Project URL');
--   SELECT vault.create_secret('<your-service-role-key>', 'service_role_key', 'Service role key');
--
-- compute-churn-scores: runs daily at 2:00 AM UTC
-- calibrate-churn-weights: runs weekly on Sundays at 3:00 AM UTC
-- =============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Daily churn score computation (2:00 AM UTC) ──────────────
SELECT cron.schedule(
  'compute-churn-scores-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url    := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/compute-churn-scores',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body   := '{}'::jsonb
  );
  $$
);

-- ── Weekly weight calibration (Sunday 3:00 AM UTC) ───────────
SELECT cron.schedule(
  'calibrate-churn-weights-weekly',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url    := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/calibrate-churn-weights',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body   := '{}'::jsonb
  );
  $$
);
