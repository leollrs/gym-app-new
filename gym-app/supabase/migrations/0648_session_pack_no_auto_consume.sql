-- ============================================================
-- 0648 — Auto-attendance must not consume a prepaid pack session
-- ============================================================
-- TrainerCalendar (client) + scheduled-reminders (edge) auto-mark a past
-- session 'completed' when the client logged ANY workout within ~±90 min. That
-- status→completed transition fires fire_session_pack_usage (0534), which burns
-- one of the client's prepaid pack sessions — on a HEURISTIC. A client who
-- no-shows a booked PT slot but does a solo gym workout nearby wrongly loses a
-- session they paid for.
--
-- Fix: a per-session `auto_marked` flag. Auto-detection sets it TRUE; the pack
-- trigger only consumes/restores on a *confirmed* completion (completed AND NOT
-- auto_marked). So auto-detect still records attendance (the trainer's
-- convenience), but a pack session is billed only when the trainer explicitly
-- confirms (which clears auto_marked). For monthly-fee clients there's no pack,
-- so the trigger no-ops regardless.
--
-- Additive + idempotent. No edge deploy needed for this migration itself.
-- ============================================================

ALTER TABLE public.trainer_sessions
  ADD COLUMN IF NOT EXISTS auto_marked BOOLEAN NOT NULL DEFAULT false;

-- ── Pack usage trigger: gate consume/restore on CONFIRMED completion ────────
CREATE OR REPLACE FUNCTION public.fire_session_pack_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack      RECORD;
  v_remaining INT;
  v_client    TEXT;
  v_trainer   TEXT;
  v_consume   BOOLEAN := FALSE;
  v_restore   BOOLEAN := FALSE;
BEGIN
  -- "Confirmed completed" = completed AND NOT auto_marked. An auto-detected
  -- attendance (auto_marked = true) is NOT confirmed and never touches a pack;
  -- the trainer confirming it (auto_marked → false) is what bills the session.
  IF TG_OP = 'INSERT' THEN
    v_consume := (NEW.status = 'completed' AND NEW.auto_marked IS NOT TRUE);
  ELSE
    v_consume := (NEW.status = 'completed' AND NEW.auto_marked IS NOT TRUE)
                 AND NOT (OLD.status = 'completed' AND OLD.auto_marked IS NOT TRUE);
    v_restore := (OLD.status = 'completed' AND OLD.auto_marked IS NOT TRUE)
                 AND NOT (NEW.status = 'completed' AND NEW.auto_marked IS NOT TRUE);
  END IF;

  -- ── A. Session transitioned INTO a confirmed completion → consume one ──
  IF v_consume THEN

    SELECT * INTO v_pack FROM session_packs
    WHERE trainer_id = NEW.trainer_id AND client_id = NEW.client_id AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN RETURN NEW; END IF; -- no active pack: nothing to do

    v_remaining := v_pack.sessions_total - (v_pack.sessions_used + 1);

    UPDATE session_packs
    SET sessions_used = v_pack.sessions_used + 1,
        is_active     = (v_remaining > 0)
    WHERE id = v_pack.id;

    SELECT COALESCE(NULLIF(full_name, ''), 'Tu cliente')   INTO v_client  FROM profiles WHERE id = NEW.client_id;
    SELECT COALESCE(NULLIF(full_name, ''), 'tu entrenador') INTO v_trainer FROM profiles WHERE id = NEW.trainer_id;

    IF v_remaining <= 0 THEN
      PERFORM public._notify_pack_event(
        NEW.trainer_id, NEW.gym_id, 'trainer'::user_role, 'pack_exhausted'::notification_type,
        'Pack finished: ' || v_client,
        v_client || ' used the last session of their ' || v_pack.sessions_total || '-session pack. Time to renew.',
        'Paquete terminado: ' || v_client,
        v_client || ' usó la última sesión de su paquete de ' || v_pack.sessions_total || '. Hora de renovar.',
        jsonb_build_object('route', '/trainer/payments', 'client_id', NEW.client_id, 'pack_id', v_pack.id),
        'pack_exhausted_' || v_pack.id::text
      );
    ELSIF v_remaining = 1 THEN
      PERFORM public._notify_pack_event(
        NEW.trainer_id, NEW.gym_id, 'trainer'::user_role, 'pack_low'::notification_type,
        v_client || ' has 1 session left',
        'Their ' || v_pack.sessions_total || '-session pack is almost done. Good moment to offer the next one.',
        'A ' || v_client || ' le queda 1 sesión',
        'Su paquete de ' || v_pack.sessions_total || ' está por terminarse. Buen momento para ofrecerle el próximo.',
        jsonb_build_object('route', '/trainer/payments', 'client_id', NEW.client_id, 'pack_id', v_pack.id),
        'pack_low_t_' || v_pack.id::text
      );
      PERFORM public._notify_pack_event(
        NEW.client_id, NEW.gym_id, 'member'::user_role, 'pack_low'::notification_type,
        'You have 1 session left with ' || v_trainer,
        'Your session pack is almost done — talk to ' || v_trainer || ' to keep going.',
        'Te queda 1 sesión con ' || v_trainer,
        'Tu paquete de sesiones está por terminarse — habla con ' || v_trainer || ' para seguir.',
        jsonb_build_object('trainer_id', NEW.trainer_id, 'pack_id', v_pack.id),
        'pack_low_m_' || v_pack.id::text
      );
    END IF;

  -- ── B. Session reverted OUT of a confirmed completion → give the session back ──
  ELSIF v_restore THEN

    SELECT * INTO v_pack FROM session_packs
    WHERE trainer_id = NEW.trainer_id AND client_id = NEW.client_id
      AND is_active = true AND sessions_used > 0
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      SELECT * INTO v_pack FROM session_packs
      WHERE trainer_id = NEW.trainer_id AND client_id = NEW.client_id
        AND is_active = false AND sessions_used > 0
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE;
      IF NOT FOUND THEN RETURN NEW; END IF;
    END IF;

    UPDATE session_packs
    SET sessions_used = greatest(0, v_pack.sessions_used - 1),
        is_active     = true
    WHERE id = v_pack.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_session_pack_usage failed for session %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Fire on auto_marked too, so a trainer confirming an auto-marked session
-- (auto_marked true → false) bills the pack session.
DROP TRIGGER IF EXISTS trg_session_pack_usage ON trainer_sessions;
CREATE TRIGGER trg_session_pack_usage
  AFTER INSERT OR UPDATE OF status, auto_marked ON trainer_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fire_session_pack_usage();

NOTIFY pgrst, 'reload schema';
