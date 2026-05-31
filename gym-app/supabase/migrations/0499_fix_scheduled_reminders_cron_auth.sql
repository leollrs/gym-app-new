-- ============================================================
-- 0499 — Fix scheduled-reminders cron auth (the NO_AUTH_HEADER 401)
-- ============================================================
-- ROOT CAUSE (confirmed via net._http_response log, 2026-05-31):
-- The `scheduled-reminders-hourly` cron was set up MANUALLY (see 0356 header)
-- to call the scheduled-reminders edge function with ONLY an `X-Cron-Secret`
-- header and NO `Authorization` header. The function is deployed with the
-- DEFAULT verify_jwt = ON, so the Supabase platform GATEWAY rejects the request
-- BEFORE the function runs:
--     {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
-- Result: workout reminders / streak alerts / nutrition nudges / re-engagement
-- (the entire scheduled-reminders category) have NEVER fired server-side.
--
-- This is a SEPARATE bug from the stale Vault service_role_key (which 401'd the
-- Authorization-based crons — milestones, session reminders, admin notifs, etc.
-- — fixed by updating the Vault secret). This migration fixes the SECOND bug.
--
-- FIX: re-point the cron to call the function with
--     Authorization: Bearer <vault service_role_key>
-- which is exactly how every WORKING cron does it (0033 churn, 0446 moderation,
-- 0440 _notify_push, etc.). The edge function ALREADY accepts a service-role
-- bearer token (scheduled-reminders/index.ts: `serviceRoleOk`), and a valid
-- service_role JWT passes the gateway's verify_jwt — so:
--   • NO edge-function redeploy is needed.
--   • NO CRON_SECRET / --no-verify-jwt dependency remains.
--   • It starts working on the next hourly tick AS SOON AS the Vault key is
--     correct (the same key fix that unblocks every other cron).
--
-- Pattern mirrors 0446 exactly: a SECURITY DEFINER wrapper reads the URL + key
-- from Vault at runtime (no secret committed to git) and does the http_post,
-- EXCEPTION-wrapped so a transient failure can't crash the cron tick.
--
-- Idempotent + safe to re-run. If pg_cron isn't installed it's a no-op.
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_scheduled_reminders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'run_scheduled_reminders: vault secrets not configured, skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/scheduled-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'run_scheduled_reminders failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_scheduled_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_scheduled_reminders() TO service_role;

-- Re-point the existing hourly job at the working wrapper. Keeps the original
-- '0 * * * *' schedule; drops the broken X-Cron-Secret-only invocation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[0499] pg_cron not installed — nothing to schedule.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-reminders-hourly') THEN
    PERFORM cron.unschedule('scheduled-reminders-hourly');
  END IF;

  PERFORM cron.schedule(
    'scheduled-reminders-hourly',
    '0 * * * *',
    $cron$ SELECT public.run_scheduled_reminders(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
