-- ============================================================
-- 0447 — Unify lifecycle in-app text and push text
-- ============================================================
-- The daily cron (run_lifecycle_messages_daily, 0420) writes the in-app
-- notification from the COMPLETE hardcoded templates (2-arg lifecycle_template)
-- and logs a lifecycle_message_log row with variant_label = NULL. The push
-- trigger (fire_lifecycle_push, 0411) then RE-RENDERS from the table-driven
-- 3-arg lifecycle_template (message_templates), which:
--   • can return DIFFERENT text than the in-app notification, and
--   • returns NOTHING for steps that only exist in the hardcoded set
--     (the "gap fill" steps 0420 added) → those steps push nothing.
--
-- Fix: the push reuses the EXACT title/body the cron already rendered into the
-- in-app notifications row (matched on the same dedup_key the cron uses,
-- 'lifecycle_<step>_<profile>'). That makes push == in-app by construction and
-- closes the gap-step miss. The previous template resolution is kept ONLY as a
-- fallback for rows with no in-app notification (e.g. a manual log insert).
--
-- Only the new path's text is already first-name-substituted; the fallback path
-- still substitutes {{first_name}}. DEPENDS ON 0446 (3-arg template signature).
-- ============================================================

CREATE OR REPLACE FUNCTION fire_lifecycle_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url        TEXT;
  v_key        TEXT;
  v_full       TEXT;
  v_lang       TEXT;
  v_title      TEXT;
  v_body       TEXT;
  v_first      TEXT;
  v_req_id     BIGINT;
  v_from_inapp BOOLEAN := FALSE;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'fire_lifecycle_push: vault secrets not configured, skipping push for %', NEW.id;
    RETURN NEW;
  END IF;

  SELECT p.full_name, COALESCE(p.preferred_language, 'en')
    INTO v_full, v_lang
  FROM profiles p WHERE p.id = NEW.profile_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- ── Single source of truth ──────────────────────────────────────────────
  -- Reuse the exact text the daily cron already rendered into the in-app
  -- notification for this step. Guarantees push == in-app and covers every
  -- step the in-app covers (no gap-step misses). The stored row already has
  -- {{first_name}} substituted, so we DON'T re-substitute on this path.
  SELECT n.title, n.body
    INTO v_title, v_body
  FROM notifications n
  WHERE n.profile_id = NEW.profile_id
    AND n.dedup_key  = 'lifecycle_' || NEW.step_key || '_' || NEW.profile_id::text
  ORDER BY n.created_at DESC
  LIMIT 1;

  IF v_title IS NOT NULL THEN
    v_from_inapp := TRUE;
  END IF;

  -- ── Fallback: no in-app row (e.g. a manual log insert) ──────────────────
  -- Resolve via the recorded variant, then the lookup function. Unchanged
  -- behavior from 0411 — only reached when the in-app lookup above misses.
  IF v_title IS NULL AND NEW.variant_label IS NOT NULL THEN
    SELECT mt.title, mt.body
      INTO v_title, v_body
    FROM message_templates mt
    WHERE mt.kind          = 'lifecycle'
      AND mt.step_key      = NEW.step_key
      AND mt.variant_label = NEW.variant_label
      AND mt.enabled
      AND (mt.language = v_lang OR mt.language = 'en')
      AND (mt.gym_id   = NEW.gym_id OR mt.gym_id IS NULL)
    ORDER BY
      (mt.gym_id   = NEW.gym_id) DESC,
      (mt.language = v_lang)     DESC
    LIMIT 1;
  END IF;

  IF v_title IS NULL THEN
    SELECT title, body INTO v_title, v_body
    FROM lifecycle_template(NEW.step_key, v_lang, NEW.gym_id);
  END IF;

  IF v_title IS NULL THEN
    RAISE LOG 'fire_lifecycle_push: no template for step % / lang % / gym % / variant %',
              NEW.step_key, v_lang, NEW.gym_id, NEW.variant_label;
    RETURN NEW;
  END IF;

  -- Only the fallback (template) path carries raw {{first_name}} placeholders.
  IF NOT v_from_inapp THEN
    v_first := COALESCE(NULLIF(SPLIT_PART(v_full, ' ', 1), ''), '');
    v_title := REPLACE(v_title, '{{first_name}}', v_first);
    v_body  := REPLACE(v_body,  '{{first_name}}', v_first);
  END IF;

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
                              'route',          '/notifications',
                              'type',           'system',
                              'lifecycle_step', NEW.step_key,
                              'variant_label',  NEW.variant_label
                           ),
      'notification_type', 'system'
    )
  ) INTO v_req_id;

  UPDATE lifecycle_message_log
  SET push_request_id = v_req_id,
      push_queued_at  = NOW()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
