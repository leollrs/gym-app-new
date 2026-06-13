-- =============================================================
-- 0544_platform_notify_fixes.sql
--
-- Platform-audit notification fixes (PLATFORM_AUDIT_2026-06-11 P2-4 / P2-9
-- producer half / crash-alert gap / realtime badge dependency):
--
--   1. P2-4 — cards notifications invisible. notify_gym_card_delivery +
--      print_cards_on_session_complete (latest defs: 0463:681 / 0463:768)
--      INSERT into notifications WITHOUT `audience`. The admin inbox filters
--      audience IN ('admin','super_admin') and NULL is treated as
--      member-facing, so every "cards on the way" / "member earned a card"
--      heads-up was filtered out of the admin inbox and leaked to the member
--      bell. Recreated VERBATIM except the INSERT gains
--      audience = 'admin'::user_role (same fix pattern as 0503).
--      + bounded backfill (7 days) so the latest batch surfaces immediately.
--
--   2. Producer deep-link rot — three admin producers link
--      '/admin/members/<uuid>', a route that doesn't exist (only
--      /admin/members). Recreated VERBATIM except data.route:
--        * fire_admin_churn_tier_crossing (0412:265, route at :302)
--        * fire_admin_new_member          (0445:51,  route at :78)
--        * fire_admin_low_attendance      (0445:152, route at :177)
--      The member id stays in data (member_profile_id / member_id) so a
--      future member-detail deep link can be wired without another migration.
--
--   3. Crash alerts: in-app only + primary-role only. 0517's
--      notify_super_admins_on_crash inserts notifications directly (no push
--      — the founder learns about white-screens whenever he next opens the
--      platform inbox) and targets role = 'super_admin' only (misses
--      additional_roles super admins). Rewritten to deliver through
--      _notify_push (0440, latest body 0538) — in-app row + native push,
--      EN+ES — keeping the per-admin/per-message-hash/per-hour dedup key,
--      and to target primary OR additional super_admins.
--
--   4. Realtime: the platform badge + alerts page subscribe to
--      postgres_changes on notifications, but no migration ever added the
--      table to the supabase_realtime publication — live updates currently
--      depend on someone having clicked it in the dashboard. Guarded ADD.
--
-- Idempotent: CREATE OR REPLACE + guarded publication ADD + bounded
-- backfills keyed on dedup_key prefixes. Apply manually.
-- =============================================================

-- ===========================================================================
-- 1a. notify_gym_card_delivery — verbatim from 0463:681 EXCEPT the
--     notifications INSERT now sets audience = 'admin'::user_role.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.notify_gym_card_delivery(p_gym_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count    INT;
  v_date     TIMESTAMPTZ;
  v_admin    RECORD;
  v_notified INT := 0;
  v_title    TEXT;
  v_body     TEXT;
  v_datestr  TEXT;
BEGIN
  -- Authorization unchanged: only super_admin (primary OR additional)
  -- triggers a cross-gym platform notification.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND (
        role = 'super_admin'
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT COUNT(*), MIN(expected_delivery_at)
    INTO v_count, v_date
    FROM print_cards
   WHERE gym_id = p_gym_id
     AND status = 'printed'
     AND delivery_fulfilled_by = 'platform'
     AND expected_delivery_at >= date_trunc('day', now());

  IF v_count = 0 OR v_date IS NULL THEN
    RETURN 0;
  END IF;

  v_datestr := to_char(v_date, 'FMMon FMDD');

  -- Recipient fan-out: include additional-role admins so a member-as-admin
  -- still receives delivery notifications.
  FOR v_admin IN
    SELECT id, COALESCE(preferred_language, 'en') AS lang
      FROM profiles
     WHERE gym_id = p_gym_id
       AND (
         role IN ('admin', 'super_admin')
         OR 'admin'::user_role       = ANY(additional_roles)
         OR 'super_admin'::user_role = ANY(additional_roles)
       )
  LOOP
    IF v_admin.lang = 'es' THEN
      v_title := '📦 Tarjetas en camino';
      v_body  := v_count || ' tarjetas llegan el ' || v_datestr || ' — tenlas listas para entregar.';
    ELSE
      v_title := '📦 Cards on the way';
      v_body  := v_count || ' cards arriving ' || v_datestr || ' — have them ready to hand out.';
    END IF;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, data, audience, dedup_key)
    VALUES (
      v_admin.id, p_gym_id, 'admin_message'::notification_type,
      v_title, v_body,
      jsonb_build_object('route', '/admin/print-cards', 'count', v_count, 'deliver_at', v_date),
      'admin'::user_role,
      'card_delivery:' || v_admin.id::text || ':' || p_gym_id::text || ':' || to_char(v_date, 'YYYY-MM-DD')
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

    v_notified := v_notified + 1;
  END LOOP;

  RETURN v_notified;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_gym_card_delivery(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.notify_gym_card_delivery(UUID) TO authenticated;

-- ===========================================================================
-- 1b. print_cards_on_session_complete — verbatim from 0463:768 EXCEPT the
--     notifications INSERT now sets audience = 'admin'::user_role.
--     (Trigger on workout_sessions from 0432 is untouched — replacing the
--     function body is enough.)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.print_cards_on_session_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id    UUID;
  v_role      TEXT;
  v_status    TEXT;
  v_name      TEXT;
  v_count     INT;
  v_milestone INT;
  v_enabled   BOOLEAN;
  v_occasion  card_occasion;
  v_headline  TEXT;
  v_subline   TEXT;
  v_label_en  TEXT;
  v_label_es  TEXT;
  v_card_id   UUID;
  v_admin     RECORD;
  v_title     TEXT;
  v_body      TEXT;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  IF COALESCE(NEW.completed_at, NEW.started_at) < now() - INTERVAL '12 hours' THEN
    RETURN NEW;
  END IF;

  SELECT p.gym_id, p.role, p.membership_status, p.full_name
    INTO v_gym_id, v_role, v_status, v_name
    FROM profiles p WHERE p.id = NEW.profile_id;

  IF v_gym_id IS NULL OR v_role <> 'member' OR v_status <> 'active' THEN
    RETURN NEW;
  END IF;

  BEGIN

  SELECT COUNT(*) INTO v_count
    FROM workout_sessions
   WHERE profile_id = NEW.profile_id AND status = 'completed';

  IF v_count = 1 THEN
    IF COALESCE((SELECT enable_welcome FROM gym_card_settings WHERE gym_id = v_gym_id), TRUE) THEN
      v_occasion := 'welcome';
      v_headline := 'You showed up.';
      v_subline  := 'That was the hard part.';
      v_label_en := 'their first workout';
      v_label_es := 'su primer entrenamiento';
    END IF;
  ELSIF v_count IN (100, 250, 500) THEN
    v_milestone := v_count;
    SELECT CASE v_milestone
             WHEN 100 THEN COALESCE(enable_milestone_100, TRUE)
             WHEN 250 THEN COALESCE(enable_milestone_250, TRUE)
             WHEN 500 THEN COALESCE(enable_milestone_500, TRUE)
           END
      INTO v_enabled FROM gym_card_settings WHERE gym_id = v_gym_id;
    IF COALESCE(v_enabled, TRUE) THEN
      v_occasion := ('milestone_' || v_milestone)::card_occasion;
      v_headline := v_milestone || ' workouts logged';
      v_subline  := CASE v_milestone
        WHEN 100 THEN 'Triple digits. The work shows.'
        WHEN 250 THEN 'Quarter-thousand sessions. Rare company.'
        WHEN 500 THEN 'Five hundred. We''re honored you train here.'
      END;
      v_label_en := v_milestone || ' workouts';
      v_label_es := v_milestone || ' entrenamientos';
    END IF;
  END IF;

  IF v_occasion IS NULL THEN RETURN NEW; END IF;

  v_card_id := enqueue_print_card(
    NEW.profile_id, v_gym_id, v_occasion, v_headline, v_subline,
    CASE WHEN v_milestone IS NOT NULL
      THEN jsonb_build_object('milestone_n', v_milestone)
      ELSE '{}'::jsonb END
  );

  IF v_card_id IS NULL THEN RETURN NEW; END IF;

  -- Recipient fan-out: include additional-role admins.
  FOR v_admin IN
    SELECT id, COALESCE(preferred_language, 'en') AS lang
      FROM profiles
     WHERE gym_id = v_gym_id
       AND (
         role IN ('admin', 'super_admin')
         OR 'admin'::user_role       = ANY(additional_roles)
         OR 'super_admin'::user_role = ANY(additional_roles)
       )
  LOOP
    IF v_admin.lang = 'es' THEN
      v_title := '🎁 ' || COALESCE(v_name, 'Un miembro') || ' ganó una tarjeta';
      v_body  := COALESCE(v_name, 'Un miembro') || ' alcanzó ' || v_label_es
                 || ' hoy — imprímela y entrégala mientras está en el gym.';
    ELSE
      v_title := '🎁 ' || COALESCE(v_name, 'A member') || ' earned a card';
      v_body  := COALESCE(v_name, 'A member') || ' hit ' || v_label_en
                 || ' today — print it and hand it over while they''re here.';
    END IF;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, data, audience, dedup_key)
    VALUES (
      v_admin.id, v_gym_id, 'admin_message'::notification_type,
      v_title, v_body,
      jsonb_build_object('route', '/admin/print-cards', 'occasion', v_occasion,
                         'member_id', NEW.profile_id, 'card_id', v_card_id),
      'admin'::user_role,
      'card_earned:' || v_admin.id::text || ':' || NEW.profile_id::text || ':' || v_occasion::text
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END LOOP;

  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

-- ── 1c. Bounded backfill (0503 pattern): surface the card notifications
-- already created invisible (audience NULL) in the last 7 days — one print
-- cycle — so the most recent batch shows up in admin inboxes immediately.
UPDATE notifications
SET    audience = 'admin'::user_role
WHERE  type = 'admin_message'
  AND  audience IS NULL
  AND  (dedup_key LIKE 'card_delivery:%' OR dedup_key LIKE 'card_earned:%')
  AND  created_at > NOW() - INTERVAL '7 days';

-- ===========================================================================
-- 2a. fire_admin_churn_tier_crossing — verbatim from 0412:265 EXCEPT
--     data.route '/admin/members/<uuid>' → '/admin/members' (route exists).
--     (Trigger on churn_risk_scores from 0412 is untouched.)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fire_admin_churn_tier_crossing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_crossed BOOLEAN := FALSE;
BEGIN
  IF NEW.risk_tier IS DISTINCT FROM 'critical' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_crossed := TRUE;
  ELSIF TG_OP = 'UPDATE' AND OLD.risk_tier IS DISTINCT FROM 'critical' THEN
    v_crossed := TRUE;
  END IF;

  IF NOT v_crossed THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Un miembro')
    INTO v_name
  FROM profiles
  WHERE id = NEW.profile_id;

  PERFORM public._fan_out_admin_notification(
    NEW.gym_id,
    'member_churn_alert'::notification_type,
    v_name || ' bajó a riesgo crítico',
    'Score ' || NEW.score::text
      || '. Ayer estaba en ' || COALESCE(OLD.risk_tier, 'sin clasificar')
      || '. Considera una llamada hoy.',
    jsonb_build_object(
      'route', '/admin/members',
      'member_profile_id', NEW.profile_id,
      'score', NEW.score,
      'prev_tier', OLD.risk_tier,
      'new_tier', NEW.risk_tier
    ),
    'admin_churncrit_' || NEW.profile_id::text || '_' || CURRENT_DATE::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_churn_tier_crossing failed for profile %: %', NEW.profile_id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_admin_churn_tier_crossing() FROM PUBLIC;

-- ===========================================================================
-- 2b. fire_admin_new_member — verbatim from 0445:51 EXCEPT data.route.
--     (Trigger on profiles from 0445 is untouched.)
-- ===========================================================================
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
    jsonb_build_object('route', '/admin/members', 'member_id', NEW.id),
    'newmember_' || NEW.id::text || '_' || NEW.gym_id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_new_member failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 2c. fire_admin_low_attendance — verbatim from 0445:152 EXCEPT data.route.
--     (Trigger on member_weekly_attendance_flags from 0445 is untouched.)
-- ===========================================================================
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
    jsonb_build_object('route', '/admin/members', 'member_id', NEW.profile_id),
    'lowattend_' || NEW.profile_id::text || '_' || NEW.week_start::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_low_attendance failed (%): %', NEW.profile_id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 3. notify_super_admins_on_crash — rewrite of 0517.
--    Changes vs 0517:
--      * Delivery via _notify_push (0440 signature, 0538 body): inserts the
--        in-app row (with audience = the p_audience arg) AND fires a native
--        push through send-push-user — so a white-screen crash reaches the
--        founder's phone instead of waiting in an unopened inbox.
--      * Recipients: primary super_admins OR additional-roles super_admins
--        (additional_roles is user_role[], 0332).
--      * Bilingual titles/bodies (the body is gym · page — message, which is
--        locale-neutral data; only the title differs).
--    Preserved from 0517:
--      * react_crash-only scope.
--      * Per-admin / per-message-hash / per-hour dedup — passed as p_dedup,
--        where _notify_push's ON CONFLICT (dedup_key) DO NOTHING + row-count
--        check also guarantees a dup never re-pushes.
--      * Outer exception guard: alerting must never break error logging
--        (_notify_push additionally guards itself per recipient).
--    Note: notifications.gym_id is NOT NULL and _notify_push no-ops on a
--    NULL gym, so we pass COALESCE(admin's gym, crashing user's gym). A
--    super admin with no gym_id only misses the alert when the crash also
--    has no gym context — same rows 0517 could never insert anyway.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.notify_super_admins_on_crash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin    RECORD;
  v_gym_name TEXT;
  v_body     TEXT;
  v_dedup    TEXT;
BEGIN
  IF NEW.type IS DISTINCT FROM 'react_crash' THEN
    RETURN NEW;
  END IF;

  -- Gym context for the alert body (nullable — platform-level crashes have no gym).
  SELECT name INTO v_gym_name FROM public.gyms WHERE id = NEW.gym_id;

  v_body := COALESCE(NULLIF(v_gym_name, ''), 'Plataforma')
            || ' · ' || COALESCE(NULLIF(NEW.page, ''), '—')
            || ' — ' || left(COALESCE(NEW.message, 'Error'), 140);

  FOR v_admin IN
    SELECT id, gym_id
    FROM public.profiles
    WHERE role = 'super_admin'
       OR 'super_admin'::user_role = ANY(additional_roles)
  LOOP
    -- One alert per admin / per message / per hour (0517's throttle, kept).
    v_dedup := 'crash:' || v_admin.id::text
               || ':' || left(md5(COALESCE(NEW.message, '')), 10)
               || ':' || to_char(now(), 'YYYYMMDDHH24');

    PERFORM public._notify_push(
      v_admin.id,
      COALESCE(v_admin.gym_id, NEW.gym_id),
      'super_admin'::user_role,
      'system_alert'::notification_type,
      'App crash',
      v_body,
      'Fallo en la app',
      v_body,
      jsonb_build_object(
        'route',        '/platform/error-logs',
        'error_log_id', NEW.id,
        'error_type',   NEW.type,
        'page',         NEW.page,
        'gym_id',       NEW.gym_id
      ),
      v_dedup
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let alerting break error logging.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_super_admins_on_crash ON public.error_logs;

CREATE TRIGGER trg_notify_super_admins_on_crash
AFTER INSERT ON public.error_logs
FOR EACH ROW
EXECUTE FUNCTION public.notify_super_admins_on_crash();

-- ===========================================================================
-- 4. Realtime: add notifications to the supabase_realtime publication.
--    The platform badge (AuthContext 'unread-notif-badge') and the alerts
--    page channel both subscribe to postgres_changes on notifications, but
--    no migration ever published the table — live updates only worked if
--    the table had been added by hand in the dashboard. Guarded so re-runs
--    (or an already-published table) are no-ops. RLS still gates events:
--    subscribers only receive rows their SELECT policy allows.
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
