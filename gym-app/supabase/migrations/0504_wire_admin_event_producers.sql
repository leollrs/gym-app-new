-- =============================================================
-- WIRE THE 3 PREVIOUSLY-DEAD ADMIN NOTIFICATION SURFACES
-- Migration: 0504_wire_admin_event_producers.sql
--
-- The admin inbox declared these types (TYPE_META) but nothing ever
-- produced them, so the Miembros + Informes tabs could never fill:
--   1. referral_redeemed  → a referral completes        → /admin/referrals (Miembros)
--   2. trainer_added      → someone becomes a trainer    → /admin/trainers  (Miembros)
--   3. daily_digest       → weekly owner "week at a glance" → /admin       (Informes)
--
-- All fan out via _notify_gym_admins (0445, multi-role-aware since 0463):
-- one in-app row per admin/super_admin (audience='admin') + bilingual EN/ES
-- + best-effort push. Each wrapped so a notify failure never blocks the
-- underlying write. Enum values referral_redeemed/trainer_added/daily_digest
-- already exist (0334).
-- =============================================================

-- ── 1. Referral redeemed → gym admins ────────────────────────────────────
-- Referrals reach 'completed' via several RPCs (0116/0117/0253/0314) that do
-- UPDATE referrals SET status='completed'. Fire on that transition.
CREATE OR REPLACE FUNCTION public.fire_admin_referral_redeemed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer TEXT;
  v_referred TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF NEW.gym_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Un miembro') INTO v_referrer FROM profiles WHERE id = NEW.referrer_id;
  SELECT COALESCE(NULLIF(full_name, ''), 'un amigo')   INTO v_referred FROM profiles WHERE id = NEW.referred_id;

  PERFORM public._notify_gym_admins(
    NEW.gym_id,
    'referral_redeemed'::notification_type,
    'Referral redeemed',
    v_referrer || ' referred ' || v_referred || ' — the referral just completed.',
    'Referido completado',
    v_referrer || ' refirió a ' || v_referred || ' — el referido se acaba de completar.',
    jsonb_build_object('route', '/admin/referrals', 'referral_id', NEW.id,
                       'referrer_id', NEW.referrer_id, 'referred_id', NEW.referred_id),
    'admin_referral_' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_referral_redeemed failed for referral %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_admin_referral_redeemed() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_admin_referral_redeemed ON referrals;
CREATE TRIGGER trg_admin_referral_redeemed
  AFTER INSERT OR UPDATE OF status ON referrals
  FOR EACH ROW EXECUTE FUNCTION fire_admin_referral_redeemed();

-- ── 2. Trainer added → gym admins ────────────────────────────────────────
-- Promotion (0489) sets primary role='trainer' for plain members, OR adds
-- 'trainer' to additional_roles for higher-role users. Catch BOTH paths,
-- firing only on the transition into trainerhood.
CREATE OR REPLACE FUNCTION public.fire_admin_trainer_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now  BOOLEAN;
  v_was  BOOLEAN;
  v_name TEXT;
BEGIN
  IF NEW.gym_id IS NULL THEN RETURN NEW; END IF;

  v_now := (NEW.role = 'trainer'
            OR 'trainer'::user_role = ANY(COALESCE(NEW.additional_roles, '{}'::user_role[])));
  IF NOT v_now THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    v_was := (OLD.role = 'trainer'
              OR 'trainer'::user_role = ANY(COALESCE(OLD.additional_roles, '{}'::user_role[])));
    IF v_was THEN RETURN NEW; END IF;  -- already a trainer; not a new transition
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Un miembro') INTO v_name FROM profiles WHERE id = NEW.id;

  PERFORM public._notify_gym_admins(
    NEW.gym_id,
    'trainer_added'::notification_type,
    'New trainer added',
    v_name || ' is now a trainer at your gym.',
    'Nuevo entrenador',
    v_name || ' ahora es entrenador en tu gimnasio.',
    jsonb_build_object('route', '/admin/trainers', 'trainer_id', NEW.id),
    'admin_trainer_added_' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_admin_trainer_added failed for profile %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_admin_trainer_added() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_admin_trainer_added ON profiles;
CREATE TRIGGER trg_admin_trainer_added
  AFTER INSERT OR UPDATE OF role, additional_roles ON profiles
  FOR EACH ROW EXECUTE FUNCTION fire_admin_trainer_added();

-- ── 3. Weekly owner report → Informes (daily_digest type) ────────────────
-- "Your week at a glance": new members + check-ins (last 7d) + standing
-- at-risk headcount (same definition as 0502 / loadScores.js). One per gym
-- per ISO week. Skips gyms with nothing worth reporting.
CREATE OR REPLACE FUNCTION public.run_admin_weekly_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      RECORD;
  v_week TEXT := to_char(date_trunc('week', now()), 'IYYY-IW');
BEGIN
  FOR r IN
    SELECT
      g.id AS gym_id,
      (SELECT count(*) FROM profiles p
         WHERE p.gym_id = g.id AND p.role = 'member' AND p.imported_archived = FALSE
           AND p.created_at >= now() - INTERVAL '7 days')                       AS new_members,
      (SELECT count(*) FROM check_ins ci
         WHERE ci.gym_id = g.id AND ci.checked_in_at >= now() - INTERVAL '7 days') AS checkins,
      (SELECT count(*) FROM (
         SELECT
           (COALESCE(p.last_active_at >= now() - INTERVAL '30 days', FALSE)
            OR EXISTS (SELECT 1 FROM check_ins ci WHERE ci.profile_id = p.id AND ci.checked_in_at >= now() - INTERVAL '30 days')
            OR EXISTS (SELECT 1 FROM workout_sessions ws WHERE ws.profile_id = p.id AND ws.started_at >= now() - INTERVAL '30 days')
           ) AS recently_active,
           COALESCE((SELECT s.score FROM churn_risk_scores s
                     WHERE s.profile_id = p.id AND s.computed_at >= now() - INTERVAL '7 days'
                     ORDER BY s.computed_at DESC LIMIT 1), 0) AS score
         FROM profiles p
         WHERE p.gym_id = g.id AND p.role = 'member' AND p.imported_archived = FALSE
           AND p.membership_status NOT IN ('cancelled', 'banned', 'deactivated')
       ) m WHERE m.recently_active = FALSE OR m.score >= 55)                    AS at_risk
    FROM gyms g
  LOOP
    CONTINUE WHEN COALESCE(r.new_members, 0) = 0
             AND COALESCE(r.checkins, 0) = 0
             AND COALESCE(r.at_risk, 0) = 0;
    BEGIN
      PERFORM public._notify_gym_admins(
        r.gym_id,
        'daily_digest'::notification_type,
        'Your week at a glance',
        r.new_members || ' new members · ' || r.checkins || ' check-ins · ' || r.at_risk || ' at risk. Tap for your dashboard.',
        'Tu semana de un vistazo',
        r.new_members || ' miembros nuevos · ' || r.checkins || ' check-ins · ' || r.at_risk || ' en riesgo. Toca para ver tu panel.',
        jsonb_build_object('route', '/admin', 'new_members', r.new_members,
                           'checkins', r.checkins, 'at_risk', r.at_risk),
        'admin_weekly_report_' || r.gym_id::text || '_' || v_week
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'run_admin_weekly_report: gym % failed: %', r.gym_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.run_admin_weekly_report() FROM PUBLIC, anon, authenticated;

-- ── Schedule the weekly report: Mondays 14:00 UTC (= 10:00 AST) ──────────
DO $$
BEGIN
  PERFORM cron.unschedule('admin-weekly-report');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'admin-weekly-report',
  '0 14 * * 1',
  $$ SELECT public.run_admin_weekly_report(); $$
);

NOTIFY pgrst, 'reload schema';
