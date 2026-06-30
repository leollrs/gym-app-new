-- ============================================================
-- 0606 — Fix the error-alerts-15min cron (42704 every 15 min)
-- ============================================================
-- 0600 scheduled `error-alerts-15min` ('*/15 * * * *') with an INLINE command
-- that called current_setting('app.settings.supabase_url') /.service_role_key —
-- DB params that were never set on this project, so every 15-min tick errored:
--   42704  unrecognized configuration parameter "app.settings.supabase_url"
-- (the exact spam in cron's run history). Same broken pattern that 0446 fixed
-- for the moderation-SLA cron. Route this one through a SECURITY DEFINER wrapper
-- that reads the URL + key from Vault and SKIPS GRACEFULLY when they're not
-- configured — so it stops erroring whether or not Vault is set up yet.
--
-- NOTE: to make the alert actually fire (not just stop erroring), Vault must
-- hold the secrets `supabase_url` and `service_role_key` — the same two the
-- moderation cron (0446) already uses. If that one works, this one will too.
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_error_alert_check()
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
    RAISE LOG 'run_error_alert_check: vault secrets not configured, skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/check-error-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'run_error_alert_check failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_error_alert_check() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_error_alert_check() TO service_role;

-- Re-point the existing 15-min job at the working wrapper (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[0606] pg_cron not installed — nothing to do.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'error-alerts-15min') THEN
    PERFORM cron.unschedule('error-alerts-15min');
  END IF;
  PERFORM cron.schedule(
    'error-alerts-15min',
    '*/15 * * * *',
    $cron$ SELECT public.run_error_alert_check(); $cron$
  );
END $$;
