-- =============================================================
-- OWNER MORNING QUEUE PUSH — 7am Puerto Rico nudge
-- Migration: 0406_owner_morning_queue_push.sql
--
-- The retention thesis: software is the memory prosthetic that
-- makes owner attention possible at scale. The orchestrator
-- (migration 0398) produces the daily queue of "today's
-- conversations." This migration is what makes the owner actually
-- OPEN it.
--
-- Daily 11:00 UTC (= 07:00 AST) push to every admin/super_admin
-- whose gym has pending queue items:
--   "5 conversations waiting"
--   "Your retention queue is ready when you have coffee."
--
-- Tap → /admin (back to the queue overview).
--
-- PREREQUISITE — same vault secrets the lifecycle push (0401)
-- and churn cron (0033) already use:
--   SELECT vault.create_secret('<supabase-url>',     'supabase_url',     'Project URL');
--   SELECT vault.create_secret('<service-role-key>', 'service_role_key', 'Service role key');
-- If missing, the function logs and no-ops on push delivery
-- (in-app notifications still flow).
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

  -- One row per (admin, their gym's pending count). Pending = status
  -- 'pending' and not currently snoozed. We loop because each admin
  -- gets their own dedup_key + push body — set-based would still
  -- need per-row pg_net.http_post calls.
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

    -- In-app notification. dedup_key unique partial index (migration
    -- 0155) makes ON CONFLICT DO NOTHING idempotent across cron retries.
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    VALUES (
      r.admin_id,
      r.gym_id,
      'admin_message'::notification_type,
      v_title,
      v_body,
      v_dedup
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

-- ── Lock down execution ─────────────────────────────────────
REVOKE EXECUTE ON FUNCTION send_owner_morning_queue_push() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION send_owner_morning_queue_push() TO service_role;

-- ── Daily cron: 11:00 UTC (= 07:00 AST in Puerto Rico) ──────
-- Owner's coffee time. The retention orchestrator runs at 09:00 UTC
-- (migration 0398), so by 11:00 UTC the queue is fresh and waiting.
SELECT cron.schedule(
  'send-owner-morning-queue-push',
  '0 11 * * *',
  $$ SELECT send_owner_morning_queue_push(); $$
);

-- =============================================================
-- INTEGRATION NEEDED
-- =============================================================
-- • Bilingual copy (EN + ES) is hardcoded inside the function —
--   no translation file edits needed for this migration.
-- • Push payload uses route '/admin' + type 'morning_queue'. The
--   client's push tap handler must already route 'admin_message'
--   pushes to the admin overview; if not, add a case for
--   data.type === 'morning_queue' → navigate('/admin').
-- • Vault secrets 'supabase_url' and 'service_role_key' must be
--   configured (same secrets already required by 0033 and 0401).
--   When missing the function still inserts in-app notifications
--   and just skips native push.
-- • Confirm the send-push-user edge function accepts
--   notification_type='admin_message' and does not filter it out
--   under any quiet-hours or preference logic for admin recipients.
-- =============================================================
