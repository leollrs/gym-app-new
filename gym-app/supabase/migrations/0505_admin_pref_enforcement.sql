-- =============================================================
-- MAKE THE ADMIN NOTIFICATION PREFERENCES ACTUALLY WORK
-- Migration: 0505_admin_pref_enforcement.sql
--
-- Until now admin_notification_prefs (0165) was write-only decoration:
-- the Preferencias page saved toggles, but NO producer ever read the
-- table, the event_type names didn't match real notification types, and
-- several listed events had no producer. This migration:
--   1. Re-seeds the catalog so event_type === the real notification_type
--      string (so producers can check prefs with zero mapping).
--   2. Adds admin_pref_allows() — default-ON (a missing row never silences).
--   3. Wires the on/off check into the two fan-out helpers
--      (_fan_out_admin_notification, _notify_gym_admins) and the standalone
--      owner morning-queue push — covering every admin producer.
--   4. Clears the old stale rows so the new canonical defaults re-seed.
-- Channels (in-app vs push) are NOT gated here — on/off only by design.
-- =============================================================

-- ── 1. Pref gate: default TRUE so a missing row never suppresses ─────────
CREATE OR REPLACE FUNCTION public.admin_pref_allows(p_profile_id UUID, p_event_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM admin_notification_prefs
     WHERE profile_id = p_profile_id AND event_type = p_event_type
     LIMIT 1),
    TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.admin_pref_allows(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 2. Canonical seed (event_type = real notification_type) ─────────────
CREATE OR REPLACE FUNCTION public.get_admin_notification_prefs()
RETURNS SETOF admin_notification_prefs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  v_count INTEGER;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  SELECT COUNT(*) INTO v_count FROM admin_notification_prefs WHERE profile_id = uid;

  IF v_count = 0 THEN
    INSERT INTO admin_notification_prefs (profile_id, gym_id, event_type, enabled) VALUES
      (uid, my_gym, 'new_member_joined',       true),
      (uid, my_gym, 'referral_redeemed',       true),
      (uid, my_gym, 'trainer_added',           false),
      (uid, my_gym, 'member_churn_alert',      true),
      (uid, my_gym, 'low_attendance_alert',    true),
      (uid, my_gym, 'admin_message',           true),
      (uid, my_gym, 'password_reset_request',  true),
      (uid, my_gym, 'moderation_flagged',      true),
      (uid, my_gym, 'nps_response',            true),
      (uid, my_gym, 'class_waitlist_full',     false),
      (uid, my_gym, 'daily_digest',            true)
    ON CONFLICT (profile_id, event_type) DO NOTHING;
  END IF;

  RETURN QUERY SELECT * FROM admin_notification_prefs WHERE profile_id = uid ORDER BY event_type;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_notification_prefs() TO authenticated;

-- ── 3a. Fan-out helper (0496) + pref gate ───────────────────────────────
CREATE OR REPLACE FUNCTION public._fan_out_admin_notification(
  p_gym_id     UUID,
  p_type       notification_type,
  p_title      TEXT,
  p_body       TEXT,
  p_data       JSONB,
  p_dedup_root TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  IF p_gym_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_admin IN
    SELECT id
    FROM profiles
    WHERE gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  LOOP
    IF NOT public.admin_pref_allows(v_admin.id, p_type::text) THEN
      CONTINUE;
    END IF;
    INSERT INTO notifications (
      profile_id, gym_id, type, title, body, data, dedup_key, audience
    )
    VALUES (
      v_admin.id,
      p_gym_id,
      p_type,
      p_title,
      p_body,
      p_data,
      p_dedup_root || '_' || v_admin.id::text,
      'admin'::user_role
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
    DO NOTHING;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._fan_out_admin_notification(
  UUID, notification_type, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC;

-- ── 3b. Bilingual fan-out helper (0463) + pref gate ─────────────────────
CREATE OR REPLACE FUNCTION public._notify_gym_admins(
  p_gym_id     UUID,
  p_type       notification_type,
  p_title_en   TEXT,
  p_body_en    TEXT,
  p_title_es   TEXT,
  p_body_es    TEXT,
  p_data       JSONB,
  p_dedup_root TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
BEGIN
  IF p_gym_id IS NULL THEN RETURN; END IF;
  FOR a IN
    SELECT id FROM profiles
    WHERE gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  LOOP
    IF NOT public.admin_pref_allows(a.id, p_type::text) THEN
      CONTINUE;
    END IF;
    PERFORM public._notify_push(
      a.id, p_gym_id, 'admin'::user_role, p_type,
      p_title_en, p_body_en, p_title_es, p_body_es, p_data,
      p_dedup_root || '_' || a.id::text
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_gym_admins(UUID,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

-- ── 3c. Owner morning-queue push (0503) + pref gate ─────────────────────
CREATE OR REPLACE FUNCTION send_owner_morning_queue_push()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url        TEXT;
  v_key        TEXT;
  v_today      TEXT := TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_pushes     INTEGER := 0;
  v_have_vault BOOLEAN;
  v_title      TEXT;
  v_body       TEXT;
  v_dedup      TEXT;
  v_req_id     BIGINT;
  r            RECORD;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  v_have_vault := (v_url IS NOT NULL AND v_key IS NOT NULL);
  IF NOT v_have_vault THEN
    RAISE LOG 'send_owner_morning_queue_push: vault secrets missing, skipping push delivery';
  END IF;

  FOR r IN
    WITH gym_counts AS (
      SELECT
        q.gym_id,
        COUNT(*)::INTEGER AS pending_count
      FROM owner_queue_items q
      WHERE q.status = 'pending'
        AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())
      GROUP BY q.gym_id
      HAVING COUNT(*) > 0
    )
    SELECT
      p.id                                       AS admin_id,
      p.gym_id                                   AS gym_id,
      COALESCE(p.preferred_language, 'en')       AS lang,
      gc.pending_count                           AS pending_count
    FROM gym_counts gc
    JOIN profiles p ON p.gym_id = gc.gym_id
    WHERE p.role IN ('admin', 'super_admin')
       OR 'admin'::user_role       = ANY(p.additional_roles)
       OR 'super_admin'::user_role = ANY(p.additional_roles)
  LOOP
    IF NOT public.admin_pref_allows(r.admin_id, 'admin_message') THEN
      CONTINUE;
    END IF;

    IF r.lang = 'es' THEN
      IF r.pending_count = 1 THEN
        v_title := r.pending_count || ' conversación esperando';
      ELSE
        v_title := r.pending_count || ' conversaciones esperando';
      END IF;
      v_body := 'Tu cola de retención está lista cuando tomes café.';
    ELSE
      IF r.pending_count = 1 THEN
        v_title := r.pending_count || ' conversation waiting';
      ELSE
        v_title := r.pending_count || ' conversations waiting';
      END IF;
      v_body := 'Your retention queue is ready when you have coffee.';
    END IF;

    v_dedup := 'morning_queue_' || r.admin_id::TEXT || '_' || v_today;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key, audience)
    VALUES (
      r.admin_id,
      r.gym_id,
      'admin_message'::notification_type,
      v_title,
      v_body,
      v_dedup,
      'admin'::user_role
    )
    ON CONFLICT DO NOTHING;

    IF v_have_vault THEN
      SELECT net.http_post(
        url     := v_url || '/functions/v1/send-push-user',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_key,
          'Content-Type',  'application/json'
        ),
        body    := jsonb_build_object(
          'profile_id',        r.admin_id,
          'gym_id',            r.gym_id,
          'title',             v_title,
          'body',              v_body,
          'data',              jsonb_build_object('route', '/admin', 'type', 'morning_queue'),
          'notification_type', 'admin_message'
        )
      ) INTO v_req_id;
    END IF;

    v_pushes := v_pushes + 1;
  END LOOP;

  RETURN v_pushes;
END;
$$;

REVOKE EXECUTE ON FUNCTION send_owner_morning_queue_push() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION send_owner_morning_queue_push() TO service_role;

-- ── 4. Clear stale decorative rows → canonical defaults re-seed on load ──
DELETE FROM admin_notification_prefs;

NOTIFY pgrst, 'reload schema';
