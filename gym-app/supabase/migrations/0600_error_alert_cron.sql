-- ============================================================
-- 0600 — Push alerting for error_logs (every 15 min)
-- ============================================================
-- Turns the PULL-based error_logs table into a PUSH alert. Calls the
-- `check-error-alerts` edge function every 15 minutes; that function emails
-- the platform owner when there's an app crash or an error spike since its
-- last run. Companion to the in-app super-admin crash notification (0517) —
-- this is the channel that reaches you when the app is NOT open.
--
-- Mirrors 0348 (moderation SLA cron). Requires pg_cron + pg_net and the
--   app.settings.supabase_url / app.settings.service_role_key DB settings
-- that the existing crons already rely on.
-- ============================================================

-- ── Watermark / cooldown state for the alerter ──
-- One row per alert stream. The edge function reads last_run_at to build a
-- contiguous (no-overlap, no-gap) window and last_alert_sent_at to throttle.
CREATE TABLE IF NOT EXISTS public.ops_alert_state (
  key                TEXT PRIMARY KEY,
  last_run_at        TIMESTAMPTZ,
  last_alert_sent_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service role (used by the edge function) bypasses RLS. Lock the table down so
-- nothing else can read/write it; expose read-only to super admins for the
-- Operations page if it ever wants to surface "last alert sent at".
ALTER TABLE public.ops_alert_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_read_alert_state" ON public.ops_alert_state;
CREATE POLICY "super_admin_read_alert_state" ON public.ops_alert_state FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- Seed the row so the first run has a sane window start (now()).
INSERT INTO public.ops_alert_state (key, last_run_at)
VALUES ('error-alerts', now())
ON CONFLICT (key) DO NOTHING;

-- Supports the alerter's created_at-range scan (existing indexes are all
-- (type|gym|profile, created_at) composites, which don't serve a bare range).
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs(created_at DESC);

-- ── Schedule (idempotent) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('error-alerts-15min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'error-alerts-15min');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.schedule(
      'error-alerts-15min',
      '*/15 * * * *',
      $cron$
        SELECT net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/check-error-alerts',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron or pg_net not available — schedule check-error-alerts manually via Supabase Dashboard (every 15 min: */15 * * * *).';
  END IF;
END $$;
