-- 0535_classes_cotrainer_proposals.sql
-- ---------------------------------------------------------------------------
-- ROOT CAUSES FIXED (trainer audit 2026-06-11):
--
-- • P1-7 — co-trainers see an empty Classes page. The admin side assigns
--   multiple trainers per class through the gym_class_trainers junction
--   (source of truth per 0379), but ALL trainer-facing RLS from 0159 keys on
--   the single legacy gym_classes.trainer_id column. A trainer assigned only
--   via the junction can't read the class, its schedules, or its bookings.
--   Fix: every 0159 trainer policy (gym_classes read/update,
--   gym_class_schedules read/manage, gym_class_bookings read/update) now
--   grants access when the caller is the primary trainer_id OR has a
--   gym_class_trainers row. Originals read in full; names kept; semantics
--   only WIDENED (primary-trainer access unchanged). Per-slot
--   gym_class_schedules.trainer_id (0512) stays an analytics column —
--   teaching one slot does not grant class management.
--
-- • P2-10 — "Propose New Class" was a write-only black hole: the trainer's
--   proposal landed in admin_audit_log via log_admin_action and NO admin was
--   ever told. Admin consumer found: /admin/notifications
--   (AdminNotifications.jsx) reads notifications WHERE audience='admin' via
--   useNotifications(user.id,'admin') and navigates with data.route — so
--   rows inserted here ARE seen. notify_class_proposal() fans out one
--   notification per gym admin (multi-role aware, mirroring 0496), gated by
--   admin_pref_allows (0505, defaults TRUE for unknown types), localized by
--   each admin's profiles.preferred_language, and pushed natively via
--   _notify_push (0440). Route: /admin/classes.
--
-- notifications.type is the notification_type ENUM — 'class_proposal' added
-- below; only referenced at runtime inside the function body, so same-
-- transaction safe.
-- ---------------------------------------------------------------------------

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'class_proposal';

-- ── Helper: is the caller a trainer of this class? ─────────────────────────
-- SECURITY DEFINER so the policies below can consult gym_classes /
-- gym_class_trainers without tripping over their own RLS.
CREATE OR REPLACE FUNCTION public._is_class_trainer(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM gym_classes c
    WHERE c.id = p_class_id AND c.trainer_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM gym_class_trainers gct
    WHERE gct.class_id = p_class_id AND gct.trainer_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public._is_class_trainer(UUID) TO authenticated;

-- ── gym_classes: read + update for primary OR junction trainers ────────────
-- (0159: USING (trainer_id = auth.uid()) on both.)
DROP POLICY IF EXISTS "trainer_read_assigned_classes" ON public.gym_classes;
CREATE POLICY "trainer_read_assigned_classes" ON public.gym_classes
  FOR SELECT
  USING (trainer_id = auth.uid() OR public._is_class_trainer(id));

DROP POLICY IF EXISTS "trainer_update_assigned_classes" ON public.gym_classes;
CREATE POLICY "trainer_update_assigned_classes" ON public.gym_classes
  FOR UPDATE
  USING (trainer_id = auth.uid() OR public._is_class_trainer(id));

-- ── gym_class_schedules: read + manage ──────────────────────────────────────
-- (0159: class_id IN (SELECT id FROM gym_classes WHERE trainer_id = auth.uid()).)
DROP POLICY IF EXISTS "trainer_read_class_schedules" ON public.gym_class_schedules;
CREATE POLICY "trainer_read_class_schedules" ON public.gym_class_schedules
  FOR SELECT
  USING (public._is_class_trainer(class_id));

DROP POLICY IF EXISTS "trainer_manage_class_schedules" ON public.gym_class_schedules;
CREATE POLICY "trainer_manage_class_schedules" ON public.gym_class_schedules
  FOR ALL
  USING (public._is_class_trainer(class_id))
  WITH CHECK (public._is_class_trainer(class_id));

-- ── gym_class_bookings: read + update (mark attendance, promote waitlist) ──
DROP POLICY IF EXISTS "trainer_read_class_bookings" ON public.gym_class_bookings;
CREATE POLICY "trainer_read_class_bookings" ON public.gym_class_bookings
  FOR SELECT
  USING (public._is_class_trainer(class_id));

DROP POLICY IF EXISTS "trainer_update_class_bookings" ON public.gym_class_bookings;
CREATE POLICY "trainer_update_class_bookings" ON public.gym_class_bookings
  FOR UPDATE
  USING (public._is_class_trainer(class_id));

-- ── notify_class_proposal ───────────────────────────────────────────────────
-- Called by TrainerClasses right after log_admin_action('class_proposal',…)
-- succeeds. Fans out to every gym admin so the proposal stops being
-- write-only. Returns {'notified': n} for debuggability (client ignores it).
CREATE OR REPLACE FUNCTION public.notify_class_proposal(
  p_class_name TEXT,
  p_details    JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_gym    UUID;
  v_tname  TEXT;
  v_admin  RECORD;
  v_lang   TEXT;
  v_title  TEXT;
  v_body   TEXT;
  v_count  INT := 0;
  v_name   TEXT := COALESCE(NULLIF(trim(p_class_name), ''), 'Clase nueva');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT gym_id, COALESCE(NULLIF(full_name, ''), 'Un entrenador')
    INTO v_gym, v_tname
  FROM profiles
  WHERE id = v_uid
    AND (role::text IN ('trainer', 'admin', 'super_admin')
         OR 'trainer'::user_role = ANY(COALESCE(additional_roles, '{}'::user_role[])));
  IF v_gym IS NULL THEN RAISE EXCEPTION 'not authorized'; END IF;

  FOR v_admin IN
    SELECT id FROM profiles
    WHERE gym_id = v_gym
      AND id <> v_uid
      AND (role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(COALESCE(additional_roles, '{}'::user_role[]))
           OR 'super_admin'::user_role = ANY(COALESCE(additional_roles, '{}'::user_role[])))
  LOOP
    IF NOT public.admin_pref_allows(v_admin.id, 'class_proposal') THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(NULLIF(preferred_language, ''), 'en') INTO v_lang
    FROM profiles WHERE id = v_admin.id;

    IF v_lang LIKE 'es%' THEN
      v_title := 'Propuesta de clase nueva';
      v_body  := v_tname || ' propone "' || v_name || '". Revisa los detalles y créala desde Clases si te cuadra.';
    ELSE
      v_title := 'New class proposal';
      v_body  := v_tname || ' proposed "' || v_name || '". Review the details and create it from Classes if it fits.';
    END IF;

    PERFORM public._notify_push(
      v_admin.id, v_gym, 'admin'::user_role, 'class_proposal'::notification_type,
      v_title, v_body, v_title, v_body,
      jsonb_build_object(
        'route', '/admin/classes',
        'proposed_by', v_uid,
        'class_name', v_name,
        'details', COALESCE(p_details, '{}'::jsonb)
      ),
      'class_proposal_' || v_uid::text || '_' || md5(v_name) || '_' || to_char(now(), 'YYYY-MM-DD') || '_' || v_admin.id::text
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('notified', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_class_proposal(TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
