-- ============================================================
-- 0445 — Admin Tier-2 notifications
-- ============================================================
--   new_member_joined    ← a member joins the gym (profiles role='member' + gym_id set)
--   class_waitlist_full  ← a booking fills a class to capacity
--   low_attendance_alert ← member_weekly_attendance_flags.flagged flips true
--
-- Fans out to every admin + super_admin in the gym, in-app (audience 'admin')
-- + push, bilingual, via a small _notify_gym_admins helper over _notify_push
-- (the 0412 admin producers were ES-only + in-app-only; this is the upgrade).
-- DEPENDS ON 0440 (_notify_push). Apply after 0440.
-- ============================================================

-- ── Helper: fan out to all gym admins (bilingual + push) ──────────────────
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
    WHERE gym_id = p_gym_id AND role IN ('admin', 'super_admin')
  LOOP
    PERFORM public._notify_push(
      a.id, p_gym_id, 'admin'::user_role, p_type,
      p_title_en, p_body_en, p_title_es, p_body_es, p_data,
      p_dedup_root || '_' || a.id::text
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_gym_admins(UUID,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

-- ── 1. New member joined → gym admins ─────────────────────────────────────
-- Fires when a profile becomes a member of a gym: direct INSERT with gym_id,
-- OR a later gym_id assignment (claim_invite_code). Deduped per (profile, gym).
CREATE OR REPLACE FUNCTION public.fire_admin_new_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.role IS DISTINCT FROM 'member' OR NEW.gym_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.gym_id IS NOT DISTINCT FROM NEW.gym_id THEN
    RETURN NEW; -- gym didn't change
  END IF;
  IF NEW.import_batch_id IS NOT NULL THEN
    RETURN NEW; -- bulk CSV import (0421), not an organic join — don't spam admins
  END IF;

  v_name := COALESCE(NULLIF(NEW.full_name, ''), 'A new member');

  PERFORM public._notify_gym_admins(
    NEW.gym_id, 'new_member_joined'::notification_type,
    'New member joined 🎉',
    v_name || ' just joined your gym. Say welcome.',
    'Nuevo miembro 🎉',
    v_name || ' acaba de unirse a tu gimnasio. Dale la bienvenida.',
    jsonb_build_object('route', '/admin/members/' || NEW.id::text, 'member_id', NEW.id),
    'newmember_' || NEW.id::text || '_' || NEW.gym_id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_new_member failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_new_member ON profiles;
CREATE TRIGGER trg_admin_new_member
  AFTER INSERT OR UPDATE OF gym_id, role ON profiles
  FOR EACH ROW EXECUTE FUNCTION fire_admin_new_member();

-- ── 2. Class filled to capacity → gym admins ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_admin_class_full()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap    INTEGER;
  v_booked INTEGER;
  v_en     TEXT;
  v_es     TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.override_capacity, c.max_capacity, 30),
         COALESCE(NULLIF(c.name, ''), 'A class'),
         COALESCE(NULLIF(c.name_es, ''), NULLIF(c.name, ''), 'Una clase')
    INTO v_cap, v_en, v_es
  FROM gym_class_schedules s
  JOIN gym_classes c ON c.id = s.class_id
  WHERE s.id = NEW.schedule_id;

  IF v_cap IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_booked
  FROM gym_class_bookings
  WHERE schedule_id = NEW.schedule_id AND booking_date = NEW.booking_date AND status = 'confirmed';

  IF v_booked <> v_cap THEN
    RETURN NEW; -- only fire on the booking that exactly fills it
  END IF;

  PERFORM public._notify_gym_admins(
    NEW.gym_id, 'class_waitlist_full'::notification_type,
    v_en || ' is full',
    v_en || ' on ' || to_char(NEW.booking_date, 'Mon DD') || ' just hit capacity (' || v_cap || ').',
    v_es || ' está llena',
    v_es || ' del ' || to_char(NEW.booking_date, 'DD Mon') || ' llegó a su capacidad (' || v_cap || ').',
    jsonb_build_object('route', '/admin/classes', 'class_id', NEW.class_id, 'schedule_id', NEW.schedule_id, 'booking_date', NEW.booking_date),
    'classfull_' || NEW.schedule_id::text || '_' || NEW.booking_date::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_class_full failed (booking %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_class_full ON gym_class_bookings;
CREATE TRIGGER trg_admin_class_full
  AFTER INSERT ON gym_class_bookings
  FOR EACH ROW EXECUTE FUNCTION fire_admin_class_full();

-- ── 3. Low-attendance flag → gym admins ───────────────────────────────────
-- Rides the existing weekly flag computed by compute_weekly_attendance_flags
-- (0395). Fires once when a member's weekly flag flips to true.
CREATE OR REPLACE FUNCTION public.fire_admin_low_attendance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.flagged IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.flagged IS NOT DISTINCT FROM TRUE THEN
    RETURN NEW; -- already flagged
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'A member') INTO v_name
  FROM profiles WHERE id = NEW.profile_id;

  PERFORM public._notify_gym_admins(
    NEW.gym_id, 'low_attendance_alert'::notification_type,
    v_name || ' is slipping',
    v_name || ' has only ' || NEW.sessions_count || ' session(s) this week. A nudge could keep them.',
    v_name || ' se está enfriando',
    v_name || ' tiene solo ' || NEW.sessions_count || ' sesión(es) esta semana. Un mensaje podría retenerlo.',
    jsonb_build_object('route', '/admin/members/' || NEW.profile_id::text, 'member_id', NEW.profile_id),
    'lowattend_' || NEW.profile_id::text || '_' || NEW.week_start::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_low_attendance failed (%): %', NEW.profile_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_low_attendance ON member_weekly_attendance_flags;
CREATE TRIGGER trg_admin_low_attendance
  AFTER INSERT OR UPDATE OF flagged ON member_weekly_attendance_flags
  FOR EACH ROW EXECUTE FUNCTION fire_admin_low_attendance();

NOTIFY pgrst, 'reload schema';
