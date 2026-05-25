-- ============================================================
-- 0443 — Trainer Tier-2 notifications
-- ============================================================
-- Adds the trainer-facing producers for client activity + session changes,
-- using types the trainer inbox already renders (0334 + TrainerNotifications):
--
--   client_pr             ← personal_records INSERT            → client's trainer(s)
--   client_workout_logged ← workout_sessions status→completed  → client's trainer(s)
--   session_rescheduled   ← trainer_sessions time change OR cancellation → trainer + client
--
-- In-app + push, bilingual, via _notify_push (0440). Trainer(s) for a client
-- are the active rows in trainer_clients. EXCEPTION-wrapped so a notification
-- failure never rolls back the workout/PR/session write.
--
-- NOTE: client_workout_logged fires on EVERY completed client workout — for a
-- trainer with many active clients this can be chatty. Easy to disable later
-- (drop trg_trainer_client_workout). Kept because it was explicitly requested.
--
-- DEPENDS ON 0440 (_notify_push). Apply after 0440.
-- ============================================================

-- ── client_pr: a client hit a personal record → their trainer(s) ──────────
CREATE OR REPLACE FUNCTION public.fire_trainer_client_pr()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_tr   RECORD;
BEGIN
  SELECT COALESCE(NULLIF(full_name, ''), 'Your client') INTO v_name
  FROM profiles WHERE id = NEW.profile_id;

  FOR v_tr IN
    SELECT trainer_id FROM trainer_clients
    WHERE client_id = NEW.profile_id AND is_active = TRUE
  LOOP
    PERFORM public._notify_push(
      v_tr.trainer_id, NEW.gym_id, 'trainer'::user_role, 'client_pr'::notification_type,
      v_name || ' hit a new PR 🏆',
      v_name || ' just set a new personal record (' || NEW.weight::text || ' x ' || NEW.reps::text || '). Nice coaching.',
      v_name || ' logró un nuevo récord 🏆',
      v_name || ' acaba de marcar un récord personal (' || NEW.weight::text || ' x ' || NEW.reps::text || '). Buen trabajo.',
      jsonb_build_object('route', '/trainer/clients/' || NEW.profile_id::text, 'client_id', NEW.profile_id),
      'trainer_clientpr_' || NEW.id::text || '_' || v_tr.trainer_id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_client_pr failed (pr %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_client_pr ON personal_records;
CREATE TRIGGER trg_trainer_client_pr
  AFTER INSERT ON personal_records
  FOR EACH ROW EXECUTE FUNCTION fire_trainer_client_pr();

-- ── client_workout_logged: a client completed a workout → their trainer(s) ─
CREATE OR REPLACE FUNCTION public.fire_trainer_client_workout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_tr   RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'completed' THEN
    RETURN NEW; -- already counted
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Your client') INTO v_name
  FROM profiles WHERE id = NEW.profile_id;

  FOR v_tr IN
    SELECT trainer_id FROM trainer_clients
    WHERE client_id = NEW.profile_id AND is_active = TRUE
  LOOP
    PERFORM public._notify_push(
      v_tr.trainer_id, NEW.gym_id, 'trainer'::user_role, 'client_workout_logged'::notification_type,
      v_name || ' completed a workout',
      v_name || ' just finished a session. Their numbers are updated.',
      v_name || ' completó un entrenamiento',
      v_name || ' acaba de terminar una sesión. Sus datos están actualizados.',
      jsonb_build_object('route', '/trainer/clients/' || NEW.profile_id::text, 'client_id', NEW.profile_id, 'session_id', NEW.id),
      'trainer_clientwo_' || NEW.id::text || '_' || v_tr.trainer_id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_client_workout failed (session %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_client_workout ON workout_sessions;
CREATE TRIGGER trg_trainer_client_workout
  AFTER INSERT OR UPDATE OF status ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION fire_trainer_client_workout();

-- ── session_rescheduled / cancelled → trainer + client ────────────────────
CREATE OR REPLACE FUNCTION public.fire_session_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz       TEXT;
  v_time     TEXT;
  v_client   TEXT;
  v_trainer  TEXT;
  v_kind     TEXT;  -- 'reschedule' | 'cancel'
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    v_kind := 'cancel';
  ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
        AND NEW.status NOT IN ('cancelled', 'completed', 'no_show') THEN
    v_kind := 'reschedule';
  ELSE
    RETURN NEW;
  END IF;

  SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = NEW.gym_id;
  v_time := to_char(NEW.scheduled_at AT TIME ZONE v_tz, 'Mon DD HH24:MI');

  SELECT COALESCE(NULLIF(full_name, ''), 'your client')  INTO v_client  FROM profiles WHERE id = NEW.client_id;
  SELECT COALESCE(NULLIF(full_name, ''), 'your trainer') INTO v_trainer FROM profiles WHERE id = NEW.trainer_id;

  IF v_kind = 'cancel' THEN
    -- client
    PERFORM public._notify_push(
      NEW.client_id, NEW.gym_id, 'member'::user_role, 'session_rescheduled'::notification_type,
      'Session cancelled',
      'Your session with ' || v_trainer || ' was cancelled.',
      'Sesión cancelada',
      'Tu sesión con ' || v_trainer || ' fue cancelada.',
      jsonb_build_object('route', '/', 'session_id', NEW.id, 'kind', 'cancel'),
      'sess_cancel_' || NEW.id::text || '_client'
    );
    -- trainer
    PERFORM public._notify_push(
      NEW.trainer_id, NEW.gym_id, 'trainer'::user_role, 'session_rescheduled'::notification_type,
      'Session cancelled',
      'Your session with ' || v_client || ' was cancelled.',
      'Sesión cancelada',
      'Tu sesión con ' || v_client || ' fue cancelada.',
      jsonb_build_object('route', '/trainer/calendar', 'session_id', NEW.id, 'kind', 'cancel'),
      'sess_cancel_' || NEW.id::text || '_trainer'
    );
  ELSE
    -- reschedule: dedup includes the new time so each move re-notifies
    PERFORM public._notify_push(
      NEW.client_id, NEW.gym_id, 'member'::user_role, 'session_rescheduled'::notification_type,
      'Session moved',
      'Your session with ' || v_trainer || ' is now ' || v_time || '.',
      'Sesión reprogramada',
      'Tu sesión con ' || v_trainer || ' ahora es el ' || v_time || '.',
      jsonb_build_object('route', '/', 'session_id', NEW.id, 'kind', 'reschedule'),
      'sess_resched_' || NEW.id::text || '_' || extract(epoch FROM NEW.scheduled_at)::bigint::text || '_client'
    );
    PERFORM public._notify_push(
      NEW.trainer_id, NEW.gym_id, 'trainer'::user_role, 'session_rescheduled'::notification_type,
      'Session moved',
      'Your session with ' || v_client || ' is now ' || v_time || '.',
      'Sesión reprogramada',
      'Tu sesión con ' || v_client || ' ahora es el ' || v_time || '.',
      jsonb_build_object('route', '/trainer/calendar', 'session_id', NEW.id, 'kind', 'reschedule'),
      'sess_resched_' || NEW.id::text || '_' || extract(epoch FROM NEW.scheduled_at)::bigint::text || '_trainer'
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_session_changed failed (session %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_changed ON trainer_sessions;
CREATE TRIGGER trg_session_changed
  AFTER UPDATE OF status, scheduled_at ON trainer_sessions
  FOR EACH ROW EXECUTE FUNCTION fire_session_changed();

NOTIFY pgrst, 'reload schema';
