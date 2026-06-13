-- ============================================================
-- 0538 — Notification helpers: localize by preferred_language
-- ============================================================
-- _notify_push (0440), _notify_trainer (0439) and _notify_member (0530)
-- pick ES vs EN copy from profiles.language — a column NO migration in this
-- repo ever creates and the app NEVER writes. The app's real language column
-- is profiles.preferred_language (0058, written by every language picker).
-- Net effect today: language is NULL for everyone → every trigger-produced
-- notification/push goes out in English, including to Spanish-first PR users.
--
-- Fix: read COALESCE(NULLIF(preferred_language, ''), language, 'en') in all
-- three helpers (preferred_language is NOT NULL DEFAULT 'en' per 0058, so the
-- NULLIF only guards a stray empty string — same pattern as 0533). Also
-- defensively create the legacy column (IF NOT EXISTS) so the COALESCE can
-- never 42703 on a fresh database. Bodies are otherwise verbatim copies of
-- the latest definitions.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT;

-- ── 1. _notify_push (generic, used by 0440/0443/0501/0532/0537…) ─────────
CREATE OR REPLACE FUNCTION public._notify_push(
  p_profile_id UUID,
  p_gym_id     UUID,
  p_audience   user_role,
  p_type       notification_type,
  p_title_en   TEXT,
  p_body_en    TEXT,
  p_title_es   TEXT,
  p_body_es    TEXT,
  p_data       JSONB,
  p_dedup      TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang  TEXT;
  v_title TEXT;
  v_body  TEXT;
  v_url   TEXT;
  v_key   TEXT;
  v_req   BIGINT;
  v_rows  INTEGER := 0;
BEGIN
  IF p_profile_id IS NULL OR p_gym_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(preferred_language, ''), language, 'en') INTO v_lang FROM profiles WHERE id = p_profile_id;
  IF v_lang IS NULL THEN v_lang := 'en'; END IF;

  IF v_lang LIKE 'es%' THEN
    v_title := p_title_es; v_body := p_body_es;
  ELSE
    v_title := p_title_en; v_body := p_body_en;
  END IF;

  INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key, audience)
  VALUES (p_profile_id, p_gym_id, p_type, v_title, v_body, p_data, p_dedup, p_audience)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN; -- duplicate; don't double-push
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG '_notify_push: vault secrets not configured, in-app only for %', p_profile_id;
    RETURN;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push-user',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id',        p_profile_id,
      'gym_id',            p_gym_id,
      'title',             v_title,
      'body',              v_body,
      'data',              p_data,
      'notification_type', p_type::text
    )
  ) INTO v_req;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG '_notify_push failed for %: %', p_profile_id, SQLERRM;
END;
$$;

-- ── 2. _notify_trainer (0439) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_trainer(
  p_trainer_id UUID,
  p_gym_id     UUID,
  p_type       notification_type,
  p_title_en   TEXT,
  p_body_en    TEXT,
  p_title_es   TEXT,
  p_body_es    TEXT,
  p_data       JSONB,
  p_dedup      TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang  TEXT;
  v_title TEXT;
  v_body  TEXT;
  v_url   TEXT;
  v_key   TEXT;
  v_req   BIGINT;
  v_rows  INTEGER := 0;
BEGIN
  IF p_trainer_id IS NULL OR p_gym_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(preferred_language, ''), language, 'en') INTO v_lang FROM profiles WHERE id = p_trainer_id;
  IF v_lang IS NULL THEN v_lang := 'en'; END IF;

  IF v_lang LIKE 'es%' THEN
    v_title := p_title_es; v_body := p_body_es;
  ELSE
    v_title := p_title_en; v_body := p_body_en;
  END IF;

  -- In-app row (skip silently on dedup collision)
  INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key, audience)
  VALUES (p_trainer_id, p_gym_id, p_type, v_title, v_body, p_data, p_dedup, 'trainer'::user_role)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN; -- duplicate; don't double-push
  END IF;

  -- Native push (best-effort). send-push-user enforces quiet hours + tokens.
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG '_notify_trainer: vault secrets not configured, in-app only for %', p_trainer_id;
    RETURN;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push-user',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id',        p_trainer_id,
      'gym_id',            p_gym_id,
      'title',             v_title,
      'body',              v_body,
      'data',              p_data,
      'notification_type', p_type::text
    )
  ) INTO v_req;
END;
$$;

-- ── 3. _notify_member (0530) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_member(
  p_member_id UUID,
  p_gym_id    UUID,
  p_type      notification_type,
  p_title_en  TEXT,
  p_body_en   TEXT,
  p_title_es  TEXT,
  p_body_es   TEXT,
  p_data      JSONB,
  p_dedup     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang  TEXT;
  v_title TEXT;
  v_body  TEXT;
  v_url   TEXT;
  v_key   TEXT;
  v_req   BIGINT;
  v_rows  INTEGER := 0;
BEGIN
  IF p_member_id IS NULL OR p_gym_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(preferred_language, ''), language, 'en') INTO v_lang FROM profiles WHERE id = p_member_id;
  IF v_lang IS NULL THEN v_lang := 'en'; END IF;

  IF v_lang LIKE 'es%' THEN
    v_title := p_title_es; v_body := p_body_es;
  ELSE
    v_title := p_title_en; v_body := p_body_en;
  END IF;

  INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key, audience)
  VALUES (p_member_id, p_gym_id, p_type, v_title, v_body, p_data, p_dedup, 'member'::user_role)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN; -- duplicate; don't double-push
  END IF;

  -- Native push (best-effort). send-push-user enforces quiet hours + tokens.
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG '_notify_member: vault secrets not configured, in-app only for %', p_member_id;
    RETURN;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push-user',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id',        p_member_id,
      'gym_id',            p_gym_id,
      'title',             v_title,
      'body',              v_body,
      'data',              p_data,
      'notification_type', p_type::text
    )
  ) INTO v_req;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_member(UUID,UUID,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
