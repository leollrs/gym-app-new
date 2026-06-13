-- =============================================================
-- 0553_gym_info_push_and_trainer_photo_visibility.sql
--
-- 1) Members get a push (in-app row + native push via _notify_push,
--    bilingual, deduped) when their gym:
--      • updates opening hours        (gym_hours UPDATE, real changes only)
--      • adds an upcoming closure     (gym_closures INSERT, future dates)
--      • publishes a new class        (gym_classes INSERT, active)
--    Loops are bounded (active, non-imported members, LIMIT 1000) and the
--    hours dedup key collapses the 7-row day-grid save into ONE push per
--    member per day. Every trigger swallows its own errors — notifying can
--    never break the admin's write.
--
-- 2) Trainer photo visibility: trainers already edit their avatar in
--    TrainerProfile; this adds the "can the gym see my photo?" choice.
--    New profiles.trainer_photo_visible (default TRUE) + get_gym_trainers /
--    get_trainer_public_profile now mask the PHOTO when it's off (design /
--    color avatars are not personal photos and stay visible; a hidden photo
--    falls back to the initials avatar in the UI).
-- =============================================================

-- ───────────────────────────────────────────────────────────────
-- 1a. Gym hours changed → push members (one per member per day)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_members_on_hours_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN
    SELECT id FROM profiles
    WHERE gym_id = NEW.gym_id
      AND role = 'member'
      AND COALESCE(membership_status, 'active') = 'active'
      AND COALESCE(imported_archived, FALSE) = FALSE
    LIMIT 1000
  LOOP
    PERFORM public._notify_push(
      m.id,
      NEW.gym_id,
      'member'::user_role,
      'announcement'::notification_type,
      'Schedule updated',
      'Your gym updated its opening hours. Check the new schedule.',
      'Horario actualizado',
      'Tu gimnasio actualizó su horario de apertura. Revisa el nuevo horario.',
      jsonb_build_object('route', '/my-gym'),
      -- collapses the day-grid save (7 row updates) into one push/member/day
      'gymhours:' || NEW.gym_id::text || ':' || to_char(now(), 'YYYYMMDD') || ':' || m.id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- notifying must never break the hours save
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_hours_change ON gym_hours;
CREATE TRIGGER trg_notify_hours_change
  AFTER UPDATE ON gym_hours
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.notify_members_on_hours_change();

-- ───────────────────────────────────────────────────────────────
-- 1b. Upcoming closure / special hours added → push members
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_members_on_closure()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  v_date    TEXT;
  v_label   TEXT;
  v_body_en TEXT;
  v_body_es TEXT;
BEGIN
  -- Only announce future closures; backfilled history is silent.
  IF NEW.closure_date < CURRENT_DATE THEN
    RETURN NEW;
  END IF;

  v_date  := to_char(NEW.closure_date, 'DD/MM');
  v_label := COALESCE(NULLIF(NEW.name, ''), NULLIF(NEW.reason, ''), '');

  -- 0516: is_closed FALSE means special hours instead of a full closure.
  IF COALESCE(NEW.is_closed, TRUE) THEN
    v_body_en := 'Your gym will be closed on ' || v_date
                 || CASE WHEN v_label <> '' THEN ' — ' || v_label ELSE '' END || '.';
    v_body_es := 'Tu gimnasio estará cerrado el ' || v_date
                 || CASE WHEN v_label <> '' THEN ' — ' || v_label ELSE '' END || '.';
  ELSE
    v_body_en := 'Special hours on ' || v_date
                 || COALESCE(': ' || NEW.open_time || '–' || NEW.close_time, '')
                 || CASE WHEN v_label <> '' THEN ' — ' || v_label ELSE '' END || '.';
    v_body_es := 'Horario especial el ' || v_date
                 || COALESCE(': ' || NEW.open_time || '–' || NEW.close_time, '')
                 || CASE WHEN v_label <> '' THEN ' — ' || v_label ELSE '' END || '.';
  END IF;

  FOR m IN
    SELECT id FROM profiles
    WHERE gym_id = NEW.gym_id
      AND role = 'member'
      AND COALESCE(membership_status, 'active') = 'active'
      AND COALESCE(imported_archived, FALSE) = FALSE
    LIMIT 1000
  LOOP
    PERFORM public._notify_push(
      m.id,
      NEW.gym_id,
      'member'::user_role,
      'announcement'::notification_type,
      'Upcoming closure', v_body_en,
      'Cierre próximo',   v_body_es,
      jsonb_build_object('route', '/my-gym', 'closure_id', NEW.id),
      'closure:' || NEW.id::text || ':' || m.id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_closure ON gym_closures;
CREATE TRIGGER trg_notify_closure
  AFTER INSERT ON gym_closures
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_members_on_closure();

-- ───────────────────────────────────────────────────────────────
-- 1c. New class published → push members
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_members_on_new_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
BEGIN
  IF COALESCE(NEW.is_active, TRUE) = FALSE THEN
    RETURN NEW;
  END IF;

  FOR m IN
    SELECT id FROM profiles
    WHERE gym_id = NEW.gym_id
      AND role = 'member'
      AND COALESCE(membership_status, 'active') = 'active'
      AND COALESCE(imported_archived, FALSE) = FALSE
    LIMIT 1000
  LOOP
    PERFORM public._notify_push(
      m.id,
      NEW.gym_id,
      'member'::user_role,
      'announcement'::notification_type,
      'New class: ' || NEW.name,
      'Bookings are open — grab your spot.',
      'Nueva clase: ' || COALESCE(NULLIF(NEW.name_es, ''), NEW.name),
      'Ya puedes reservar tu cupo.',
      jsonb_build_object('route', '/classes', 'class_id', NEW.id),
      'newclass:' || NEW.id::text || ':' || m.id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_class ON gym_classes;
CREATE TRIGGER trg_notify_new_class
  AFTER INSERT ON gym_classes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_members_on_new_class();

-- ───────────────────────────────────────────────────────────────
-- 2a. Trainer photo visibility flag
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trainer_photo_visible BOOLEAN NOT NULL DEFAULT TRUE;

-- ───────────────────────────────────────────────────────────────
-- 2b. get_gym_trainers — mask the PHOTO when the trainer opted out.
--     Verbatim from 0391 except the avatar projection. Design/color
--     avatars stay (not personal photos); a hidden photo nulls
--     avatar_url + flips type so UserAvatar falls back to initials.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_gym_trainers()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    UUID := auth.uid();
  _gym_id UUID;
  _result JSON;
BEGIN
  SELECT gym_id INTO _gym_id FROM profiles WHERE id = _uid;
  IF _gym_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(json_agg(t ORDER BY t.full_name), '[]'::json)
    INTO _result
  FROM (
    SELECT p.id, p.full_name, p.username,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) THEN p.avatar_url END AS avatar_url,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) THEN p.avatar_type
                WHEN p.avatar_type = 'photo' THEN NULL
                ELSE p.avatar_type END AS avatar_type,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) THEN p.avatar_value
                WHEN p.avatar_type = 'photo' THEN NULL
                ELSE p.avatar_value END AS avatar_value,
           p.trainer_tagline, p.trainer_years_exp
      FROM profiles p
     WHERE p.gym_id = _gym_id
       AND (p.role = 'trainer' OR 'trainer' = ANY(p.additional_roles))
       AND COALESCE(p.trainer_directory_visible, TRUE) = TRUE
     LIMIT 50
  ) t;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_gym_trainers() TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2c. get_trainer_public_profile — same photo masking. Verbatim from
--     0391 otherwise (incl. the field list and same-gym enforcement).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trainer_public_profile(p_trainer_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    UUID := auth.uid();
  _gym_id UUID;
  _result JSON;
BEGIN
  SELECT gym_id INTO _gym_id FROM profiles WHERE id = _uid;
  IF _gym_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(t) INTO _result
  FROM (
    SELECT p.id, p.full_name, p.username,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) OR p.id = _uid THEN p.avatar_url END AS avatar_url,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) OR p.id = _uid THEN p.avatar_type
                WHEN p.avatar_type = 'photo' THEN NULL
                ELSE p.avatar_type END AS avatar_type,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) OR p.id = _uid THEN p.avatar_value
                WHEN p.avatar_type = 'photo' THEN NULL
                ELSE p.avatar_value END AS avatar_value,
           p.bio,
           p.trainer_tagline, p.trainer_cover_url, p.trainer_years_exp,
           p.trainer_location, p.trainer_pronouns, p.trainer_specialties,
           p.trainer_credentials, p.trainer_services, p.trainer_availability,
           p.trainer_verified, p.trainer_directory_visible,
           p.phone_number, p.gym_id, p.role
      FROM profiles p
     WHERE p.id = p_trainer_id
       AND p.gym_id = _gym_id
       AND (p.role = 'trainer' OR 'trainer' = ANY(p.additional_roles))
  ) t;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trainer_public_profile(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
