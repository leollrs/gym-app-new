-- =============================================================
-- 0554_new_challenge_instant_push.sql
--
-- Members get the "new challenge" push the moment an admin creates it,
-- with upcoming-aware copy — instead of waiting for the 15-min
-- run_challenge_lifecycle cron (0497), which also silently does nothing
-- if the pg_cron job was never installed.
--
--   • AFTER INSERT on challenges (status='active', not ended): broadcast
--     immediately. start_date in the future → "Upcoming challenge 🏆 —
--     starts DD/MM, join now"; already started → 0497's live copy.
--   • AFTER UPDATE OF status: covers draft → active publishes.
--   • Stamps challenges.new_broadcast_at so the 0497 cron sweep skips it;
--     the cron stays as a backstop for anything the trigger missed. Same
--     'chal_new_<id>_<member>' dedup key as 0497 — a race can never
--     double-push.
--   • Same audience rules as 0497 (members, non-staff) plus the 0553
--     guards (active membership, not imported-archived), LIMIT 1000,
--     EXCEPTION-swallowed so notifying can never break the admin's save.
-- =============================================================

CREATE OR REPLACE FUNCTION public.notify_members_on_new_challenge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  v_upcoming BOOLEAN;
  v_date     TEXT;
  v_body_en  TEXT;
  v_body_es  TEXT;
BEGIN
  -- Only freshly-published, not-yet-broadcast, not-yet-ended challenges.
  -- new_broadcast_at also breaks recursion from the stamp UPDATE below.
  IF NEW.status <> 'active'
     OR NEW.new_broadcast_at IS NOT NULL
     OR NEW.end_date <= now() THEN
    RETURN NEW;
  END IF;

  v_upcoming := NEW.start_date > now();
  v_date     := to_char(NEW.start_date, 'DD/MM');

  IF v_upcoming THEN
    v_body_en := '"' || NEW.name || '" starts ' || v_date || '. Join now and get ready!';
    v_body_es := '«' || NEW.name || '» comienza el ' || v_date || '. ¡Únete desde ya!';
  ELSE
    v_body_en := '"' || NEW.name || '" is open. Join and compete!';
    v_body_es := '«' || NEW.name || '» está abierto. ¡Únete y compite!';
  END IF;

  FOR m IN
    SELECT id FROM profiles
    WHERE gym_id = NEW.gym_id
      AND role = 'member'
      AND COALESCE(is_staff, FALSE) = FALSE
      AND COALESCE(membership_status, 'active') = 'active'
      AND COALESCE(imported_archived, FALSE) = FALSE
    LIMIT 1000
  LOOP
    PERFORM public._notify_push(
      m.id,
      NEW.gym_id,
      'member'::user_role,
      'challenge_update'::notification_type,
      CASE WHEN v_upcoming THEN 'Upcoming challenge 🏆' ELSE 'New challenge 🏆' END,
      v_body_en,
      CASE WHEN v_upcoming THEN 'Próximo reto 🏆' ELSE 'Nuevo reto 🏆' END,
      v_body_es,
      jsonb_build_object('route', '/challenges', 'challenge_id', NEW.id),
      'chal_new_' || NEW.id::text || '_' || m.id::text
    );
  END LOOP;

  UPDATE challenges SET new_broadcast_at = now() WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_members_on_new_challenge failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_members_on_new_challenge() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_notify_new_challenge_ins ON challenges;
CREATE TRIGGER trg_notify_new_challenge_ins
  AFTER INSERT ON challenges
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_members_on_new_challenge();

DROP TRIGGER IF EXISTS trg_notify_new_challenge_upd ON challenges;
CREATE TRIGGER trg_notify_new_challenge_upd
  AFTER UPDATE OF status ON challenges
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION public.notify_members_on_new_challenge();

NOTIFY pgrst, 'reload schema';
