-- ============================================================
-- 0439 — Trainer notification producers (Tier 1)
-- ============================================================
-- The trainer inbox (TrainerNotifications.jsx) + badge (TrainerLayout.jsx)
-- read notifications WHERE profile_id = <trainer> AND audience = 'trainer'.
-- The 9 trainer notification_type values were added back in 0334 but NO
-- producer ever wrote them — trainers received nothing. This migration wires
-- the four event-driven ones that map cleanly to existing event tables and to
-- types the inbox already knows how to render:
--
--   new_client_assigned    ← trainer_clients INSERT (active)
--   client_no_show         ← trainer_sessions status → 'no_show'
--   client_adherence_drop  ← churn_risk_scores crosses INTO 'critical'
--   class_booking          ← gym_class_bookings INSERT (confirmed) for a
--                            class the trainer is assigned to
--
-- Each notification is inserted in-app (audience='trainer') AND pushed via
-- send-push-user. Copy is bilingual, chosen by the recipient trainer's
-- profiles.language (the 0412 admin producers were ES-only — done right here).
--
-- Patterns mirrored:
--   • insert + dedup + audience  → 0412_admin_notification_producers.sql
--   • pg_net push + vault secrets → 0409_milestone_push_cron.sql
-- Every producer is wrapped so a failure can NEVER roll back the underlying
-- write (a missed notification must not break a booking / churn run).
--
-- Session reminders (time-based cron) and "client confirmed/cancelled a
-- session" are intentionally NOT here — they need a new type + UI metadata
-- and/or a cron, and are a separate follow-up.
-- ============================================================

-- ── Shared helper: localized insert + push for ONE trainer ──
CREATE OR REPLACE FUNCTION public._notify_trainer(
  p_trainer_id UUID,
  p_gym_id     UUID,
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
  IF p_trainer_id IS NULL OR p_gym_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(language, 'en') INTO v_lang FROM profiles WHERE id = p_trainer_id;
  IF v_lang IS NULL THEN v_lang := 'en'; END IF;

  IF v_lang LIKE 'es%' THEN
    v_title := p_title_es; v_body := p_body_es;
  ELSE
    v_title := p_title_en; v_body := p_body_en;
  END IF;

  -- In-app row (skip silently on dedup collision)
  INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key, audience)
  VALUES (p_trainer_id, p_gym_id, p_type, v_title, v_body, p_data, p_dedup, 'trainer'::user_role)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN; -- duplicate; don't double-push
  END IF;

  -- Native push (best-effort). send-push-user enforces quiet hours + tokens.
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG '_notify_trainer: vault secrets not configured, in-app only for %', p_trainer_id;
    RETURN;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push-user',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id',        p_trainer_id,
      'gym_id',            p_gym_id,
      'title',             v_title,
      'body',              v_body,
      'data',              p_data,
      'notification_type', p_type::text
    )
  ) INTO v_req;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_trainer(UUID,UUID,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

-- ============================================================
-- 1. New client assigned → trainer
-- ============================================================
CREATE OR REPLACE FUNCTION public.fire_trainer_new_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'a new client') INTO v_name
  FROM profiles WHERE id = NEW.client_id;

  PERFORM public._notify_trainer(
    NEW.trainer_id, NEW.gym_id, 'new_client_assigned'::notification_type,
    'New client assigned',
    v_name || ' was assigned to you. Take a look at their profile and set them up.',
    'Nuevo cliente asignado',
    'Te asignaron a ' || COALESCE(NULLIF((SELECT full_name FROM profiles WHERE id = NEW.client_id), ''), 'un cliente nuevo')
      || '. Revisa su perfil y prepáralo.',
    jsonb_build_object('route', '/trainer/clients/' || NEW.client_id::text, 'client_id', NEW.client_id),
    'trainer_newclient_' || NEW.trainer_id::text || '_' || NEW.client_id::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_new_client failed for %/%: %', NEW.trainer_id, NEW.client_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_new_client ON trainer_clients;
CREATE TRIGGER trg_trainer_new_client
  AFTER INSERT ON trainer_clients
  FOR EACH ROW
  EXECUTE FUNCTION fire_trainer_new_client();

-- ============================================================
-- 2. Client marked no-show → trainer
--    Only when the no-show was NOT set by the trainer themselves
--    (e.g. set by an admin or an automated process) — otherwise it's
--    redundant noise for the person who just clicked the button.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fire_trainer_no_show()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'no_show' OR OLD.status IS NOT DISTINCT FROM 'no_show' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.trainer_id THEN
    RETURN NEW; -- trainer marked it themselves
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Your client') INTO v_name
  FROM profiles WHERE id = NEW.client_id;

  PERFORM public._notify_trainer(
    NEW.trainer_id, NEW.gym_id, 'client_no_show'::notification_type,
    v_name || ' missed a session',
    'Their ' || to_char(NEW.scheduled_at, 'Mon DD HH24:MI') || ' session was marked no-show. Might be worth a check-in.',
    COALESCE(NULLIF((SELECT full_name FROM profiles WHERE id = NEW.client_id), ''), 'Tu cliente') || ' faltó a una sesión',
    'La sesión del ' || to_char(NEW.scheduled_at, 'DD Mon HH24:MI') || ' se marcó como ausencia. Quizá valga la pena escribirle.',
    jsonb_build_object('route', '/trainer/clients/' || NEW.client_id::text, 'client_id', NEW.client_id, 'session_id', NEW.id),
    'trainer_noshow_' || NEW.id::text || '_' || NEW.trainer_id::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_no_show failed for session %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_no_show ON trainer_sessions;
CREATE TRIGGER trg_trainer_no_show
  AFTER UPDATE OF status ON trainer_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fire_trainer_no_show();

-- ============================================================
-- 3. Client crossed INTO critical churn → their assigned trainer(s)
--    Mirrors the admin churn alert (0412) but routes to each active
--    trainer of that client. One alert per client/trainer per day.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fire_trainer_client_at_risk()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name    TEXT;
  v_crossed BOOLEAN := FALSE;
  v_tr      RECORD;
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

  SELECT COALESCE(NULLIF(full_name, ''), 'A client') INTO v_name
  FROM profiles WHERE id = NEW.profile_id;

  FOR v_tr IN
    SELECT trainer_id FROM trainer_clients
    WHERE client_id = NEW.profile_id AND is_active = TRUE
  LOOP
    PERFORM public._notify_trainer(
      v_tr.trainer_id, NEW.gym_id, 'client_adherence_drop'::notification_type,
      v_name || ' is now at high risk',
      'Their churn risk just hit critical (score ' || NEW.score::text || '). A quick check-in today goes a long way.',
      COALESCE(NULLIF((SELECT full_name FROM profiles WHERE id = NEW.profile_id), ''), 'Un cliente') || ' está en riesgo alto',
      'Su riesgo de abandono pasó a crítico (score ' || NEW.score::text || '). Un mensaje hoy puede marcar la diferencia.',
      jsonb_build_object('route', '/trainer/clients/' || NEW.profile_id::text, 'client_id', NEW.profile_id, 'score', NEW.score),
      'trainer_churncrit_' || NEW.profile_id::text || '_' || v_tr.trainer_id::text || '_' || CURRENT_DATE::text
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_client_at_risk failed for profile %: %', NEW.profile_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_client_at_risk ON churn_risk_scores;
CREATE TRIGGER trg_trainer_client_at_risk
  AFTER INSERT OR UPDATE OF risk_tier, score ON churn_risk_scores
  FOR EACH ROW
  EXECUTE FUNCTION fire_trainer_client_at_risk();

-- ============================================================
-- 4. Member booked a class → assigned trainer(s)
--    Covers both the single gym_classes.trainer_id and the multi-trainer
--    gym_class_trainers junction. Confirmed bookings only (not waitlist).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fire_trainer_class_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member    TEXT;
  v_class_en  TEXT;
  v_class_es  TEXT;
  v_tr        UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'A member') INTO v_member
  FROM profiles WHERE id = NEW.profile_id;

  SELECT COALESCE(NULLIF(name, ''), 'your class'),
         COALESCE(NULLIF(name_es, ''), NULLIF(name, ''), 'tu clase')
    INTO v_class_en, v_class_es
  FROM gym_classes WHERE id = NEW.class_id;

  FOR v_tr IN
    SELECT trainer_id FROM gym_classes        WHERE id = NEW.class_id AND trainer_id IS NOT NULL
    UNION
    SELECT trainer_id FROM gym_class_trainers  WHERE class_id = NEW.class_id
  LOOP
    -- Don't notify a trainer about their own booking
    IF v_tr = NEW.profile_id THEN CONTINUE; END IF;

    PERFORM public._notify_trainer(
      v_tr, NEW.gym_id, 'class_booking'::notification_type,
      'New booking for ' || v_class_en,
      v_member || ' booked ' || v_class_en || ' on ' || to_char(NEW.booking_date, 'Mon DD') || '.',
      'Nueva reserva en ' || v_class_es,
      v_member || ' reservó ' || v_class_es || ' el ' || to_char(NEW.booking_date, 'DD Mon') || '.',
      jsonb_build_object('route', '/trainer/classes', 'class_id', NEW.class_id, 'booking_id', NEW.id, 'member_id', NEW.profile_id),
      'trainer_classbooking_' || NEW.id::text || '_' || v_tr::text
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_class_booking failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_class_booking ON gym_class_bookings;
CREATE TRIGGER trg_trainer_class_booking
  AFTER INSERT ON gym_class_bookings
  FOR EACH ROW
  EXECUTE FUNCTION fire_trainer_class_booking();

NOTIFY pgrst, 'reload schema';
