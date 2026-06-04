-- 0517_notify_super_admins_on_crash.sql
--
-- When the app's React ErrorBoundary catches a crash, the client writes a row
-- into error_logs (type = 'react_crash'). This trigger fans that out into an
-- in-app notification for every super admin so the platform owner is alerted
-- the moment a user hits the "Hubo un error" screen — without polling the
-- Errors page.
--
-- Notes:
--   * SECURITY DEFINER so it can read profiles + insert notifications for a
--     DIFFERENT profile_id (the crashing user can't, by RLS — only the DB can).
--   * Throttled via dedup_key: at most one alert per super admin, per unique
--     error message, per hour. Prevents a crash loop from flooding the inbox.
--   * Wrapped in an exception guard: notification failure must NEVER roll back
--     the original error_logs insert (error logging has to stay reliable).
--   * Scoped to 'react_crash' only — the white-screen crashes the user cares
--     about — not the noisier js_error / network_error / slow_api stream.

CREATE OR REPLACE FUNCTION public.notify_super_admins_on_crash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin    RECORD;
  v_gym_name TEXT;
  v_title    TEXT;
  v_body     TEXT;
  v_dedup    TEXT;
BEGIN
  IF NEW.type IS DISTINCT FROM 'react_crash' THEN
    RETURN NEW;
  END IF;

  -- Gym context for the alert body (nullable — platform-level crashes have no gym).
  SELECT name INTO v_gym_name FROM public.gyms WHERE id = NEW.gym_id;

  v_title := 'Fallo en la app';
  v_body  := COALESCE(NULLIF(v_gym_name, ''), 'Plataforma')
             || ' · ' || COALESCE(NULLIF(NEW.page, ''), '—')
             || ' — ' || left(COALESCE(NEW.message, 'Error'), 140);

  FOR v_admin IN
    SELECT id, gym_id FROM public.profiles WHERE role = 'super_admin'
  LOOP
    -- One alert per admin / per message / per hour.
    v_dedup := 'crash:' || v_admin.id::text
               || ':' || left(md5(COALESCE(NEW.message, '')), 10)
               || ':' || to_char(now(), 'YYYYMMDDHH24');

    INSERT INTO public.notifications
      (profile_id, gym_id, type, title, body, data, audience, dedup_key)
    VALUES (
      v_admin.id,
      v_admin.gym_id,
      'system_alert',
      v_title,
      v_body,
      jsonb_build_object(
        'route',        '/platform/error-logs',
        'error_log_id', NEW.id,
        'error_type',   NEW.type,
        'page',         NEW.page,
        'gym_id',       NEW.gym_id
      ),
      'super_admin',
      v_dedup
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let alerting break error logging.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_super_admins_on_crash ON public.error_logs;

CREATE TRIGGER trg_notify_super_admins_on_crash
AFTER INSERT ON public.error_logs
FOR EACH ROW
EXECUTE FUNCTION public.notify_super_admins_on_crash();
