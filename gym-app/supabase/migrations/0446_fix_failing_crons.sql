-- ============================================================
-- 0446 — Fix two failing cron jobs
-- ============================================================
-- 1. run-lifecycle-messages  →  ERROR "function lifecycle_template(text,
--    character varying) is not unique". Two overloads coexist:
--      • lifecycle_template(TEXT, TEXT)            — 0420 (hardcoded, used by
--                                                    run_lifecycle_messages_daily)
--      • lifecycle_template(TEXT, TEXT, UUID=NULL) — 0411 A/B variants (used by
--                                                    fire_lifecycle_push, 3 args)
--    The 3-arg's DEFAULT NULL makes a 2-arg call match BOTH → ambiguous.
--    Fix: recreate the 3-arg WITHOUT the default. Both callers keep working
--    (the daily job's 2-arg call now resolves uniquely; the push trigger always
--    passes 3 args). No behavior/content change.
--
-- 2. moderation-sla-hourly  →  ERROR "unrecognized configuration parameter
--    app.settings.supabase_url". Same broken pattern as the old 0280 reminder
--    cron — current_setting() of a DB param that was never set. Fix: route the
--    cron through a SECURITY DEFINER wrapper that reads the URL + key from Vault
--    (the working pattern from 0409/0440).
-- ============================================================

-- ── 1. De-ambiguate lifecycle_template: drop the 3-arg default ────────────
DROP FUNCTION IF EXISTS public.lifecycle_template(TEXT, TEXT, UUID);

CREATE FUNCTION public.lifecycle_template(
  p_step_key TEXT,
  p_lang     TEXT,
  p_gym_id   UUID            -- was DEFAULT NULL (0411); default removed to end ambiguity
)
RETURNS TABLE (title TEXT, body TEXT, variant_label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title    TEXT;
  v_body     TEXT;
  v_label    TEXT;
  v_has_any  BOOLEAN := FALSE;
BEGIN
  -- Gym-specific lookup first. A disabled gym row means "opt out".
  IF p_gym_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM message_templates mt
      WHERE mt.gym_id   = p_gym_id
        AND mt.kind     = 'lifecycle'
        AND mt.step_key = p_step_key
        AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
    ) INTO v_has_any;

    IF v_has_any THEN
      IF EXISTS (
        SELECT 1 FROM message_templates mt
        WHERE mt.gym_id    = p_gym_id
          AND mt.kind      = 'lifecycle'
          AND mt.step_key  = p_step_key
          AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
          AND mt.enabled   = FALSE
      ) THEN
        RETURN;
      END IF;

      SELECT mt.title, mt.body, mt.variant_label
        INTO v_title, v_body, v_label
      FROM message_templates mt
      WHERE mt.gym_id    = p_gym_id
        AND mt.kind      = 'lifecycle'
        AND mt.step_key  = p_step_key
        AND mt.enabled
        AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
      ORDER BY
        (mt.language = COALESCE(p_lang, 'en')) DESC,
        random()
      LIMIT 1;

      IF v_title IS NOT NULL THEN
        RETURN QUERY SELECT v_title, v_body, v_label;
      END IF;
      RETURN;
    END IF;
  END IF;

  -- Fall back to global defaults.
  SELECT mt.title, mt.body, mt.variant_label
    INTO v_title, v_body, v_label
  FROM message_templates mt
  WHERE mt.gym_id IS NULL
    AND mt.kind     = 'lifecycle'
    AND mt.step_key = p_step_key
    AND mt.enabled
    AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
  ORDER BY
    (mt.language = COALESCE(p_lang, 'en')) DESC,
    random()
  LIMIT 1;

  IF v_title IS NOT NULL THEN
    RETURN QUERY SELECT v_title, v_body, v_label;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lifecycle_template(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.lifecycle_template(TEXT, TEXT, UUID) TO authenticated, service_role;

-- ── 2. Fix the moderation-SLA cron (Vault instead of current_setting) ─────
CREATE OR REPLACE FUNCTION public.run_moderation_sla_check()
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
    RAISE LOG 'run_moderation_sla_check: vault secrets not configured, skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/check-moderation-sla',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'run_moderation_sla_check failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_moderation_sla_check() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_moderation_sla_check() TO service_role;

-- Re-point the existing hourly job at the working wrapper.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'moderation-sla-hourly') THEN
    PERFORM cron.unschedule('moderation-sla-hourly');
  END IF;
  PERFORM cron.schedule(
    'moderation-sla-hourly',
    '0 * * * *',
    $cron$ SELECT public.run_moderation_sla_check(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
