-- =============================================================
-- LIFECYCLE MESSAGES — push delivery layer (V2)
-- Migration: 0401_lifecycle_messages_push.sql
--
-- Adds native push notification delivery to the lifecycle engine
-- built in 0400. V1 inserted only in-app notification rows; V2
-- adds a Postgres AFTER INSERT trigger on lifecycle_message_log
-- that fires pg_net.http_post → send-push-user, so each scheduled
-- lifecycle moment actually arrives on the member's phone.
--
-- Pull-through architecture: every log row inserted = one push
-- queued. pg_net runs the HTTP call asynchronously, so trigger
-- execution stays fast and doesn't block the cron run.
--
-- PREREQUISITE — same secrets the churn cron (0033) already uses:
--   SELECT vault.create_secret('<your-supabase-url>',         'supabase_url',     'Project URL');
--   SELECT vault.create_secret('<your-service-role-key>',     'service_role_key', 'Service role key');
-- If they aren't configured, the trigger gracefully no-ops
-- (in-app notifications still flow; only push delivery is skipped).
-- =============================================================

-- Track when push was attempted so we can audit delivery later.
-- NULL = trigger never ran for this row (secrets missing, vault
-- error, etc); NOT NULL = pg_net.http_post returned an id.
ALTER TABLE lifecycle_message_log
  ADD COLUMN IF NOT EXISTS push_request_id BIGINT,
  ADD COLUMN IF NOT EXISTS push_queued_at  TIMESTAMPTZ;

-- ── Trigger function ────────────────────────────────────────
CREATE OR REPLACE FUNCTION fire_lifecycle_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     TEXT;
  v_key     TEXT;
  v_full    TEXT;
  v_lang    TEXT;
  v_title   TEXT;
  v_body    TEXT;
  v_first   TEXT;
  v_req_id  BIGINT;
BEGIN
  -- Pull vault secrets. If missing, in-app notification still landed
  -- via run_lifecycle_messages_daily() — we just skip the push.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'fire_lifecycle_push: vault secrets not configured, skipping push for %', NEW.id;
    RETURN NEW;
  END IF;

  -- Resolve recipient context.
  SELECT p.full_name, COALESCE(p.preferred_language, 'en')
    INTO v_full, v_lang
  FROM profiles p
  WHERE p.id = NEW.profile_id;

  -- Defensive: profile-row vanished (won't happen under normal use
  -- because of the FK CASCADE, but covers manual log inserts).
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Resolve template.
  SELECT title, body INTO v_title, v_body
  FROM lifecycle_template(NEW.step_key, v_lang);

  IF v_title IS NULL THEN
    RAISE LOG 'fire_lifecycle_push: no template for step % / lang %', NEW.step_key, v_lang;
    RETURN NEW;
  END IF;

  -- Interpolate {{first_name}}. Empty string when name is null —
  -- matches the in-app insert path in run_lifecycle_messages_daily.
  v_first := COALESCE(NULLIF(SPLIT_PART(v_full, ' ', 1), ''), '');
  v_title := REPLACE(v_title, '{{first_name}}', v_first);
  v_body  := REPLACE(v_body,  '{{first_name}}', v_first);

  -- Fire the push asynchronously via pg_net. The return value is the
  -- pg_net request id (BIGINT), not the HTTP response — pg_net handles
  -- the HTTP call in a background worker.
  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push-user',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id',        NEW.profile_id,
      'gym_id',            NEW.gym_id,
      'title',             v_title,
      'body',              v_body,
      'data',              jsonb_build_object(
                              'route', '/notifications',
                              'type',  'system',
                              'lifecycle_step', NEW.step_key
                           ),
      'notification_type', 'system'
    )
  ) INTO v_req_id;

  -- Stamp the log row so we can audit later. Use NEW.id since we
  -- just inserted this row.
  UPDATE lifecycle_message_log
  SET push_request_id = v_req_id,
      push_queued_at  = NOW()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Lock down execution
REVOKE EXECUTE ON FUNCTION fire_lifecycle_push() FROM PUBLIC;

-- ── Trigger ─────────────────────────────────────────────────
-- AFTER INSERT so the log row exists before the trigger UPDATE
-- stamps push_request_id. FOR EACH ROW because we need NEW.id.
DROP TRIGGER IF EXISTS trg_fire_lifecycle_push ON lifecycle_message_log;

CREATE TRIGGER trg_fire_lifecycle_push
  AFTER INSERT ON lifecycle_message_log
  FOR EACH ROW
  EXECUTE FUNCTION fire_lifecycle_push();
