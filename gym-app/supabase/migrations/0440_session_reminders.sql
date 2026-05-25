-- ============================================================
-- 0440 — Trainer/client session reminders (server cron)
-- ============================================================
-- Replaces the old CLIENT-SIDE reminder in TrainerCalendar.jsx, which was
-- doubly broken: it inserted type 'session_reminder' (never added to the
-- notification_type enum → enum violation) into a 'scheduled_at' column that
-- doesn't exist on notifications → every insert silently errored. No reminder
-- was ever delivered.
--
-- This does it server-side like the workout reminders: a pg_cron job runs every
-- 15 min and, for any session starting within the next ~60 min (status
-- scheduled/confirmed, send_reminder = true), sends a reminder to BOTH the
-- client and the trainer. Dedup keys (one per session per recipient) guarantee
-- exactly one reminder each even though the window overlaps across ticks.
--
-- Delivery: in-app row + native push via send-push-user (quiet hours + tokens
-- handled there). Bilingual by each recipient's own profiles.language. Times
-- are rendered in the gym's timezone.
--
-- Patterns mirrored: pg_net push + vault secrets (0409), cron registration
-- (0406). The 'session_reminder' enum value is only ever cast at RUNTIME (inside
-- function bodies / the cron job), never at migration time, so adding it and
-- defining the producers in one migration is safe on PG15.
-- ============================================================

-- New notification type for session reminders (member + trainer inboxes).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_reminder';

-- ── Generalized helper: localized insert (any audience) + push ────────────
-- Like _notify_trainer (0439) but with an explicit audience, so it can target
-- the client (audience 'member') or the trainer (audience 'trainer').
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

  SELECT COALESCE(language, 'en') INTO v_lang FROM profiles WHERE id = p_profile_id;
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

REVOKE EXECUTE ON FUNCTION public._notify_push(UUID,UUID,user_role,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

-- ── Cron producer: remind upcoming sessions (client + trainer) ────────────
CREATE OR REPLACE FUNCTION public.send_session_reminders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s          RECORD;
  v_tz       TEXT;
  v_time     TEXT;
  v_client   TEXT;
  v_trainer  TEXT;
BEGIN
  FOR s IN
    SELECT ts.id, ts.gym_id, ts.trainer_id, ts.client_id, ts.scheduled_at,
           g.timezone AS gym_tz
    FROM trainer_sessions ts
    JOIN gyms g ON g.id = ts.gym_id
    WHERE ts.send_reminder = TRUE
      AND ts.status IN ('scheduled', 'confirmed')
      AND ts.scheduled_at > now()
      AND ts.scheduled_at <= now() + interval '60 minutes'
  LOOP
    v_tz   := COALESCE(s.gym_tz, 'America/Puerto_Rico');
    v_time := to_char(s.scheduled_at AT TIME ZONE v_tz, 'HH24:MI');

    SELECT COALESCE(NULLIF(full_name, ''), 'your client')  INTO v_client  FROM profiles WHERE id = s.client_id;
    SELECT COALESCE(NULLIF(full_name, ''), 'your trainer') INTO v_trainer FROM profiles WHERE id = s.trainer_id;

    -- Client reminder (member inbox)
    PERFORM public._notify_push(
      s.client_id, s.gym_id, 'member'::user_role, 'session_reminder'::notification_type,
      'Upcoming session',
      'Your session with ' || v_trainer || ' is at ' || v_time || '. See you soon.',
      'Sesión próxima',
      'Tu sesión con ' || v_trainer || ' es a las ' || v_time || '. Nos vemos.',
      jsonb_build_object('route', '/', 'session_id', s.id, 'type', 'session_reminder'),
      'session_reminder_' || s.id::text || '_client'
    );

    -- Trainer reminder (trainer inbox)
    PERFORM public._notify_push(
      s.trainer_id, s.gym_id, 'trainer'::user_role, 'session_reminder'::notification_type,
      'Upcoming session',
      'Session with ' || v_client || ' at ' || v_time || '.',
      'Sesión próxima',
      'Sesión con ' || v_client || ' a las ' || v_time || '.',
      jsonb_build_object('route', '/trainer/calendar', 'session_id', s.id, 'type', 'session_reminder'),
      'session_reminder_' || s.id::text || '_trainer'
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'send_session_reminders failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_session_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.send_session_reminders() TO service_role;

-- Every 15 minutes. Dedup keys make the overlapping 60-min window fire once.
SELECT cron.schedule(
  'send-session-reminders',
  '*/15 * * * *',
  $$ SELECT public.send_session_reminders(); $$
);

NOTIFY pgrst, 'reload schema';
