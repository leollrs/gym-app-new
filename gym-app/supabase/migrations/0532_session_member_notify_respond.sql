-- ============================================================
-- 0532 — Member-side session lifecycle: book notify + respond + evening nudge
-- ============================================================
-- Trainer audit 2026-06-11 (GAPS "no member notification on book" + market
-- feature #2 "pre-session reminders w/ confirm / can't-make-it"):
--
--   (a) AFTER INSERT trigger on trainer_sessions → notify the MEMBER that a
--       session was booked for them. Skipped for from_schedule rows — the
--       set_client_schedule materializer (0452/0529) writes ~8 weeks of rows
--       at once and sends its own single summary, so per-row pushes would be
--       spam. Manual recurring batches (recurrence_group) dedup to ONE
--       notification via the dedup key.
--
--   (b) client_respond_session(p_session_id, p_response, p_note) RPC —
--       the member confirms ('scheduled' → 'confirmed') or declines
--       (status kept; the trainer gets a 'session_declined' notification).
--
--   (c) Daily evening-before reminder: 22:00 UTC (= 6:00 pm in Puerto Rico,
--       no DST) pg_cron job pings the MEMBER about tomorrow's
--       scheduled/confirmed sessions with a "¿confirmas?" nudge that deep
--       links to the trainer's public profile (where the confirm/decline
--       buttons live).
--
-- notifications.type is the `notification_type` ENUM (no CHECK constraint) —
-- extended below with the two new values. As in 0440, the new enum values are
-- only ever CAST AT RUNTIME (inside function bodies), never at migration
-- time, so adding them and defining the producers in one migration is safe.
--
-- Patterns mirrored: _notify_push helper + runtime enum casts (0440), trigger
-- shape w/ logged exception swallow (0443), guarded cron registration (0501).
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS / ADD VALUE IF NOT
-- EXISTS / unschedule-then-schedule.
-- ============================================================

-- New notification types (member 'session_booked', trainer 'session_declined').
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_booked';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_declined';

-- ── (a) AFTER INSERT → notify the member ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_session_booked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz      TEXT;
  v_time    TEXT;
  v_trainer TEXT;
BEGIN
  -- Materialized weekly-schedule rows send their own one-shot summary
  -- (0529) — notifying each of the ~8 generated rows would be spam.
  IF NEW.from_schedule THEN
    RETURN NEW;
  END IF;
  -- Back-logged past sessions / rows created directly as completed,
  -- cancelled or no-show aren't "your trainer booked you" events.
  IF NEW.status NOT IN ('scheduled', 'confirmed') OR NEW.scheduled_at <= now() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = NEW.gym_id;
  v_time := to_char(NEW.scheduled_at AT TIME ZONE COALESCE(v_tz, 'America/Puerto_Rico'), 'Mon DD HH24:MI');

  SELECT COALESCE(NULLIF(full_name, ''), 'your trainer') INTO v_trainer FROM profiles WHERE id = NEW.trainer_id;

  -- Dedup on the recurrence group when present: a manual recurring batch
  -- (weekly ×8) collapses to a single notification for the series start.
  PERFORM public._notify_push(
    NEW.client_id, NEW.gym_id, 'member'::user_role, 'session_booked'::notification_type,
    'New session booked',
    v_trainer || ' booked a session with you: ' || v_time || '.',
    'Nueva sesión agendada',
    v_trainer || ' agendó una sesión contigo: ' || v_time || '.',
    jsonb_build_object('route', '/trainers/' || NEW.trainer_id::text, 'session_id', NEW.id, 'type', 'session_booked'),
    'sess_booked_' || COALESCE(NEW.recurrence_group::text, NEW.id::text)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_session_booked failed (session %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_booked ON trainer_sessions;
CREATE TRIGGER trg_session_booked
  AFTER INSERT ON trainer_sessions
  FOR EACH ROW EXECUTE FUNCTION fire_session_booked();

-- ── (b) client_respond_session — member confirm / can't-make-it ───────────
CREATE OR REPLACE FUNCTION public.client_respond_session(
  p_session_id UUID,
  p_response   TEXT,
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_session trainer_sessions%ROWTYPE;
  v_tz      TEXT;
  v_time    TEXT;
  v_member  TEXT;
  v_note    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_response NOT IN ('confirm', 'decline') THEN
    RAISE EXCEPTION 'invalid_response';
  END IF;

  SELECT * INTO v_session FROM trainer_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;
  -- Caller must be the session's client — this is the member-facing surface.
  IF v_session.client_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_session';
  END IF;

  IF p_response = 'confirm' THEN
    -- Only 'scheduled' sessions can be confirmed; anything else is a no-op
    -- that reports the current status back (e.g. double-tap, already
    -- cancelled by the trainer meanwhile).
    UPDATE trainer_sessions
       SET status = 'confirmed', updated_at = now()
     WHERE id = p_session_id AND status = 'scheduled';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'status', v_session.status);
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 'confirmed');
  END IF;

  -- decline: status is KEPT (the trainer decides whether to cancel/move) —
  -- the trainer just gets notified the member can't make it.
  SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = v_session.gym_id;
  v_time := to_char(v_session.scheduled_at AT TIME ZONE COALESCE(v_tz, 'America/Puerto_Rico'), 'Mon DD HH24:MI');
  SELECT COALESCE(NULLIF(full_name, ''), 'Your client') INTO v_member FROM profiles WHERE id = v_uid;
  v_note := NULLIF(left(trim(COALESCE(p_note, '')), 200), '');

  PERFORM public._notify_push(
    v_session.trainer_id, v_session.gym_id, 'trainer'::user_role, 'session_declined'::notification_type,
    'Client can''t make it',
    v_member || ' can''t make the session on ' || v_time || '.'
      || CASE WHEN v_note IS NOT NULL THEN ' — "' || v_note || '"' ELSE '' END,
    'No puede asistir',
    v_member || ' no puede asistir el ' || v_time || '.'
      || CASE WHEN v_note IS NOT NULL THEN ' — "' || v_note || '"' ELSE '' END,
    jsonb_build_object('route', '/trainer/calendar', 'session_id', v_session.id, 'type', 'session_declined'),
    'sess_declined_' || v_session.id::text
  );
  RETURN jsonb_build_object('ok', true, 'status', v_session.status, 'declined', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_respond_session(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_respond_session(UUID, TEXT, TEXT) TO authenticated;

-- ── (c) Evening-before reminder → member ("¿confirmas?") ──────────────────
CREATE OR REPLACE FUNCTION public.send_evening_session_reminders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s         RECORD;
  v_tz      TEXT;
  v_time    TEXT;
  v_trainer TEXT;
BEGIN
  FOR s IN
    SELECT ts.id, ts.gym_id, ts.trainer_id, ts.client_id, ts.scheduled_at,
           g.timezone AS gym_tz
    FROM trainer_sessions ts
    JOIN gyms g ON g.id = ts.gym_id
    WHERE ts.send_reminder = TRUE
      AND ts.status IN ('scheduled', 'confirmed')
      -- "tomorrow" in each gym's own timezone (PR has no DST)
      AND (ts.scheduled_at AT TIME ZONE COALESCE(g.timezone, 'America/Puerto_Rico'))::date
          = ((now() AT TIME ZONE COALESCE(g.timezone, 'America/Puerto_Rico'))::date + 1)
  LOOP
    v_tz   := COALESCE(s.gym_tz, 'America/Puerto_Rico');
    v_time := to_char(s.scheduled_at AT TIME ZONE v_tz, 'HH24:MI');

    SELECT COALESCE(NULLIF(full_name, ''), 'your trainer') INTO v_trainer FROM profiles WHERE id = s.trainer_id;

    -- Routes to the trainer's public profile — that's where the member's
    -- Confirmar / No puedo buttons live.
    PERFORM public._notify_push(
      s.client_id, s.gym_id, 'member'::user_role, 'session_reminder'::notification_type,
      'Session tomorrow',
      'Session tomorrow at ' || v_time || ' with ' || v_trainer || ' — can you make it?',
      'Sesión mañana',
      'Sesión mañana a las ' || v_time || ' con ' || v_trainer || ' — ¿confirmas?',
      jsonb_build_object('route', '/trainers/' || s.trainer_id::text, 'session_id', s.id, 'type', 'session_reminder'),
      'session_evening_' || s.id::text
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'send_evening_session_reminders failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_evening_session_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.send_evening_session_reminders() TO service_role;

-- Daily at 22:00 UTC = 6:00 pm America/Puerto_Rico (UTC-4, no DST).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-evening-session-reminders') THEN
      PERFORM cron.unschedule('send-evening-session-reminders');
    END IF;
    PERFORM cron.schedule(
      'send-evening-session-reminders',
      '0 22 * * *',
      $cron$ SELECT public.send_evening_session_reminders(); $cron$
    );
  ELSE
    RAISE NOTICE '[0532] pg_cron not installed — schedule send_evening_session_reminders() manually (daily 22:00 UTC).';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
