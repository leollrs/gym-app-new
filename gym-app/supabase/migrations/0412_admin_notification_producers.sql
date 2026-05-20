-- =============================================================
-- 0412 — Admin notification inbox producers
--
-- Until now /admin/notifications has been empty in every gym
-- because no code anywhere INSERTs into `notifications` with
-- `audience='admin'`. The 12 admin-only notification types
-- defined in migration 0334 were all orphans — schema declared,
-- never produced.
--
-- This migration wires the four highest-leverage producers:
--
--   1. nps_response          — detractor (score 1-2 on the 1-5
--                              scale, see 0373). Witness moment:
--                              the owner should reach out today.
--   2. moderation_flagged    — new pending content_reports row
--                              (member-reported UGC or auto-flag
--                              from 0345's pre-publish trigger).
--   3. password_reset_request — new pending password_reset_requests
--                               row needing admin approval.
--   4. member_churn_alert     — member just crossed INTO 'critical'
--                               risk tier (they got worse since the
--                               last score). NOT a steady-state count
--                               — MorningQueuePanel covers state. This
--                               is the EVENT of degradation, fired
--                               once per crossing per day.
--
-- Each event fans out one notification per admin in the gym so
-- multi-admin gyms all triage. Dedup key includes the admin_id so
-- fan-out can't collide on the global UNIQUE INDEX from 0155.
--
-- Skipped intentionally:
--   - low_attendance_alert                     — MorningQueuePanel
--     (0398) already surfaces these via the orchestrator.
--   - daily_digest                             — already emailed.
--   - new_member_joined, trainer_added,
--     referral_redeemed, class_waitlist_full    — low signal or
--     too noisy without per-admin throttling. Add later if owners
--     ask for them.
--   - system_alert                             — only fires on
--     infra incidents, no application-level producer needed.
--
-- All triggers wrap their work in EXCEPTION blocks so a notif
-- failure can never block the underlying INSERT (NPS response,
-- content report, password reset request all must succeed even
-- if the notification fan-out has a bug).
-- =============================================================

-- ── Helper: fan out one notification per admin in the gym ────
-- Setting audience='admin' covers regular admins. Super-admins'
-- inbox query (useSupabaseQuery.js:280-282) already matches
-- IN ('admin','super_admin'), so they see these rows too.
CREATE OR REPLACE FUNCTION public._fan_out_admin_notification(
  p_gym_id     UUID,
  p_type       notification_type,
  p_title      TEXT,
  p_body       TEXT,
  p_data       JSONB,
  p_dedup_root TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  IF p_gym_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_admin IN
    SELECT id
    FROM profiles
    WHERE gym_id = p_gym_id
      AND role IN ('admin', 'super_admin')
  LOOP
    INSERT INTO notifications (
      profile_id, gym_id, type, title, body, data, dedup_key, audience
    )
    VALUES (
      v_admin.id,
      p_gym_id,
      p_type,
      p_title,
      p_body,
      p_data,
      p_dedup_root || '_' || v_admin.id::text,
      'admin'::user_role
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
    DO NOTHING;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._fan_out_admin_notification(
  UUID, notification_type, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC;

-- ── 1. NPS detractor → admin alert ───────────────────────────
-- Member app uses 1-5 scale (see 0373). Detractor = score 1 or 2.
-- score = -1 is the "dismissed survey" sentinel — skip it.
CREATE OR REPLACE FUNCTION public.fire_admin_nps_detractor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_body TEXT;
BEGIN
  IF NEW.score IS NULL OR NEW.score < 1 OR NEW.score > 2 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(SPLIT_PART(full_name, ' ', 1), ''), 'Un miembro')
    INTO v_name
  FROM profiles
  WHERE id = NEW.profile_id;

  v_body := 'Score ' || NEW.score::text || '/5. '
         || COALESCE(
              NULLIF(NEW.feedback, ''),
              'Sin comentario. Considera una conversación rápida.'
            );

  PERFORM public._fan_out_admin_notification(
    NEW.gym_id,
    'nps_response'::notification_type,
    v_name || ' dejó una respuesta de NPS baja',
    v_body,
    jsonb_build_object(
      'route', '/admin/nps',
      'response_id', NEW.id,
      'member_profile_id', NEW.profile_id,
      'score', NEW.score
    ),
    'admin_nps_' || NEW.id::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_nps_detractor failed for response %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_admin_nps_detractor() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_admin_nps_detractor ON nps_responses;
CREATE TRIGGER trg_admin_nps_detractor
  AFTER INSERT ON nps_responses
  FOR EACH ROW
  EXECUTE FUNCTION fire_admin_nps_detractor();

-- ── 2. Content report → moderation alert ─────────────────────
-- Fires for every new content_reports row (manual member-flag
-- via Report-button AND auto-flag from the pre-publish moderation
-- trigger in 0345 / 0355 / etc.). Status guard keeps us from
-- firing on admin-side UPDATEs that flip status to reviewed.
CREATE OR REPLACE FUNCTION public.fire_admin_moderation_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  PERFORM public._fan_out_admin_notification(
    NEW.gym_id,
    'moderation_flagged'::notification_type,
    'Contenido reportado para revisión',
    'Motivo: ' || COALESCE(NEW.reason, 'inappropriate')
      || '. Revísalo en Moderación.',
    jsonb_build_object(
      'route', '/admin/moderation',
      'report_id', NEW.id,
      'feed_item_id', NEW.feed_item_id,
      'reason', NEW.reason
    ),
    'admin_modflag_' || NEW.id::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_moderation_flag failed for report %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_admin_moderation_flag() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_admin_moderation_flag ON content_reports;
CREATE TRIGGER trg_admin_moderation_flag
  AFTER INSERT ON content_reports
  FOR EACH ROW
  EXECUTE FUNCTION fire_admin_moderation_flag();

-- ── 3. Password reset request → security alert ───────────────
-- Requests expire in 15 min (per 0114), so this is genuinely
-- time-sensitive. Route to /admin where AdminOverview hosts
-- PasswordResetApprovalModal.
CREATE OR REPLACE FUNCTION public.fire_admin_password_reset_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' OR NEW.gym_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NEW.email)
    INTO v_name
  FROM profiles
  WHERE id = NEW.profile_id;

  PERFORM public._fan_out_admin_notification(
    NEW.gym_id,
    'password_reset_request'::notification_type,
    'Solicitud de cambio de contraseña',
    COALESCE(v_name, NEW.email)
      || ' está esperando aprobación. Expira en 15 minutos.',
    jsonb_build_object(
      'route', '/admin',
      'request_id', NEW.id,
      'email', NEW.email
    ),
    'admin_pwdreset_' || NEW.id::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_password_reset_request failed for request %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_admin_password_reset_request() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_admin_password_reset_request ON password_reset_requests;
CREATE TRIGGER trg_admin_password_reset_request
  AFTER INSERT ON password_reset_requests
  FOR EACH ROW
  EXECUTE FUNCTION fire_admin_password_reset_request();

-- ── 4. Churn tier crossing into 'critical' → risk alert ──────
-- The daily churn-scoring RPC (0079) UPSERTs into churn_risk_scores
-- with ON CONFLICT DO UPDATE, so a member's row is INSERTed once
-- (first scoring) and then UPDATEd on every subsequent run. We want
-- to fire on the *crossing* event:
--   - INSERT where NEW.risk_tier = 'critical'  (first score, hot)
--   - UPDATE where NEW.risk_tier = 'critical'
--                  AND OLD.risk_tier IS DISTINCT FROM 'critical'
--
-- Dedup key carries the date so a same-day re-run of the cron can't
-- spam the inbox if the tier toggles back and forth.
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
      'route', '/admin/members/' || NEW.profile_id::text,
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

DROP TRIGGER IF EXISTS trg_admin_churn_tier_crossing ON churn_risk_scores;
CREATE TRIGGER trg_admin_churn_tier_crossing
  AFTER INSERT OR UPDATE OF risk_tier, score ON churn_risk_scores
  FOR EACH ROW
  EXECUTE FUNCTION fire_admin_churn_tier_crossing();

NOTIFY pgrst, 'reload schema';
