-- =============================================================
-- FIX: owner morning queue push lands invisible
-- Migration: 0503_fix_owner_morning_queue_audience.sql
--
-- BUG: send_owner_morning_queue_push() (0406) inserts its
-- "X conversations waiting" nudge into notifications WITHOUT setting
-- `audience`. The audience column defaults to NULL. The admin inbox
-- (useNotifications / AdminNotifications) filters audience IN
-- ('admin','super_admin'), so the nudge is filtered OUT — and because
-- NULL is treated as member-facing, it also leaks to the member bell.
-- Net effect: the daily owner nudge is created but never seen, while
-- owner_queue_items pile up and expire unactioned.
--
-- FIX (two changes, function recreated verbatim otherwise):
--   1. INSERT now sets audience = 'admin'.
--   2. Recipient filter also matches multi-role admins via
--      additional_roles (mirrors the 0496 _fan_out fix), so an
--      owner whose primary role isn't 'admin' still gets nudged.
--
-- Plus a bounded backfill so the last couple days of already-created
-- (invisible) nudges surface immediately instead of waiting for the
-- next 11:00 UTC run.
-- =============================================================

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
  -- Vault secrets. Missing = in-app notif still inserts, push skipped.
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
    -- Render localized copy. Plural EN at count=1, plural ES at count=1.
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

    -- In-app notification — NOW tagged audience='admin' so it shows in
    -- the admin inbox (and doesn't leak to the member bell).
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

    -- Push delivery via pg_net → send-push-user. No-op when vault
    -- secrets aren't configured (e.g. local dev).
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
          'data',              jsonb_build_object(
                                  'route', '/admin',
                                  'type',  'morning_queue'
                               ),
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

-- ── Backfill: surface the last 2 days of already-created (invisible) nudges ──
-- They were inserted with audience NULL; flip just the morning-queue ones so
-- the inbox reflects today's queue immediately instead of waiting for 11:00 UTC.
UPDATE notifications
SET    audience = 'admin'::user_role
WHERE  type = 'admin_message'
  AND  audience IS NULL
  AND  dedup_key LIKE 'morning_queue_%'
  AND  created_at > NOW() - INTERVAL '2 days';

NOTIFY pgrst, 'reload schema';
