-- 0501_trainer_automations.sql
-- ---------------------------------------------------------------------------
-- #7 — Trainer automation / autoflows, framed as retention + progress-tracking
-- (NOT remote coaching). A trainer turns on rules like:
--   • inactivity     — a client hasn't completed a workout in N days
--   • missed_checkin — a client with an assigned check-in hasn't filled it this week
-- and the daily cron fires a NOTIFICATION. Action is either:
--   • notify_trainer — alert the trainer so they reach out (default; fits PR's
--                      in-person culture), or
--   • nudge_member   — a gentle push to the member directly.
--
-- Anti-spam: notifications go through public._notify_push (0440), and the
-- dedup_key carries the ISO week, so a client triggers AT MOST ONE alert per
-- rule per week even though the cron runs daily. No separate event-log table
-- needed — _notify_push's dedup_key unique index is the guard.
--
-- DEPENDS ON 0440 (_notify_push), 0500 (checkin_assignments/_responses),
-- trainer_clients. Apply after those.
-- ---------------------------------------------------------------------------

-- Trainer-facing alert type. ADDED here, only REFERENCED inside a function body
-- below (never executed during this migration) — safe on PG15 (0442 precedent).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trainer_alert';

CREATE TABLE IF NOT EXISTS public.trainer_automations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  trainer_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('inactivity','missed_checkin')),
  threshold_days SMALLINT NOT NULL DEFAULT 7 CHECK (threshold_days BETWEEN 1 AND 60),
  action        TEXT NOT NULL DEFAULT 'notify_trainer' CHECK (action IN ('notify_trainer','nudge_member')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trainer_automations_trainer_idx
  ON public.trainer_automations (trainer_id) WHERE is_active;

ALTER TABLE public.trainer_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ta_owner_all" ON public.trainer_automations;
CREATE POLICY "ta_owner_all" ON public.trainer_automations
  FOR ALL TO authenticated
  USING (trainer_id = auth.uid() OR (gym_id = public.current_gym_id() AND public.is_admin()))
  WITH CHECK (trainer_id = auth.uid() OR (gym_id = public.current_gym_id() AND public.is_admin()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_automations TO authenticated;

-- ── Evaluation function ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_trainer_automations()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule   RECORD;
  v_client RECORD;
  v_week   TEXT := to_char(CURRENT_DATE, 'IYYY"-W"IW');
  v_period DATE := date_trunc('week', CURRENT_DATE)::date;  -- Monday
  v_dow    INT  := EXTRACT(ISODOW FROM CURRENT_DATE);       -- 1=Mon..7=Sun
  v_name   TEXT;
  v_t_en   TEXT; v_t_es TEXT; v_b_en TEXT; v_b_es TEXT;
  v_fire   BOOLEAN;
BEGIN
  FOR v_rule IN
    SELECT * FROM trainer_automations WHERE is_active = true
  LOOP
    -- Each rule applies to all of that trainer's ACTIVE clients in the gym.
    FOR v_client IN
      SELECT tc.client_id, p.full_name, p.created_at
      FROM trainer_clients tc
      JOIN profiles p ON p.id = tc.client_id
      WHERE tc.trainer_id = v_rule.trainer_id
        AND tc.gym_id = v_rule.gym_id
        AND tc.is_active = true
    LOOP
      v_fire := false;

      IF v_rule.trigger_type = 'inactivity' THEN
        -- Skip brand-new clients (no fair window yet).
        IF v_client.created_at <= now() - (v_rule.threshold_days || ' days')::interval THEN
          v_fire := NOT EXISTS (
            SELECT 1 FROM workout_sessions ws
            WHERE ws.profile_id = v_client.client_id
              AND ws.status = 'completed'
              AND ws.completed_at >= now() - (v_rule.threshold_days || ' days')::interval
          );
        END IF;

      ELSIF v_rule.trigger_type = 'missed_checkin' THEN
        -- Only late in the week (Thu+), only if they actually have an assigned
        -- check-in, and only if no response exists for this week's period.
        IF v_dow >= 4 THEN
          v_fire := EXISTS (
              SELECT 1 FROM checkin_assignments ca
              WHERE ca.profile_id = v_client.client_id AND ca.active = true
            )
            AND NOT EXISTS (
              SELECT 1 FROM checkin_responses cr
              JOIN checkin_assignments ca2 ON ca2.template_id = cr.template_id AND ca2.active = true
              WHERE cr.profile_id = v_client.client_id
                AND ca2.profile_id = v_client.client_id
                AND cr.period_start = v_period
            );
        END IF;
      END IF;

      CONTINUE WHEN NOT v_fire;

      v_name := COALESCE(NULLIF(split_part(v_client.full_name, ' ', 1), ''), 'Your client');

      IF v_rule.action = 'nudge_member' THEN
        IF v_rule.trigger_type = 'inactivity' THEN
          v_t_en := 'We miss you 💪';  v_t_es := 'Te extrañamos 💪';
          v_b_en := 'Ready for your next workout? Your coach is rooting for you.';
          v_b_es := '¿Listo para tu próximo entrenamiento? Tu entrenador te apoya.';
        ELSE
          v_t_en := 'Quick check-in 📋'; v_t_es := 'Check-in rápido 📋';
          v_b_en := 'Don''t forget this week''s check-in — it helps your coach help you.';
          v_b_es := 'No olvides tu check-in de esta semana — ayuda a tu entrenador a apoyarte.';
        END IF;
        PERFORM public._notify_push(
          v_client.client_id, v_rule.gym_id, 'member'::user_role, 'announcement'::notification_type,
          v_t_en, v_b_en, v_t_es, v_b_es,
          jsonb_build_object('route', '/dashboard', 'source', 'automation'),
          'autonudge_' || v_rule.id::text || '_' || v_client.client_id::text || '_' || v_week
        );
      ELSE
        -- notify_trainer
        IF v_rule.trigger_type = 'inactivity' THEN
          v_t_en := v_name || ' has gone quiet';
          v_t_es := v_name || ' está inactivo';
          v_b_en := 'No workouts in ' || v_rule.threshold_days || ' days. A quick message could bring them back.';
          v_b_es := 'Sin entrenamientos en ' || v_rule.threshold_days || ' días. Un mensaje podría traerlo de vuelta.';
        ELSE
          v_t_en := v_name || ' missed their check-in';
          v_t_es := v_name || ' no hizo su check-in';
          v_b_en := 'No check-in logged this week.';
          v_b_es := 'No registró check-in esta semana.';
        END IF;
        PERFORM public._notify_push(
          v_rule.trainer_id, v_rule.gym_id, 'trainer'::user_role, 'trainer_alert'::notification_type,
          v_t_en, v_b_en, v_t_es, v_b_es,
          jsonb_build_object('route', '/trainer/clients/' || v_client.client_id::text, 'source', 'automation'),
          'autoalert_' || v_rule.id::text || '_' || v_client.client_id::text || '_' || v_week
        );
      END IF;
    END LOOP;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'run_trainer_automations failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_trainer_automations() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_trainer_automations() TO service_role;

-- Schedule: daily at 18:00 UTC (afternoon in the Americas). Dedup_key carries
-- the ISO week, so at most one alert per client per rule per week.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trainer-automations') THEN
      PERFORM cron.unschedule('trainer-automations');
    END IF;
    PERFORM cron.schedule(
      'trainer-automations',
      '0 18 * * *',
      $cron$ SELECT public.run_trainer_automations(); $cron$
    );
  ELSE
    RAISE NOTICE '[0501] pg_cron not installed — schedule run_trainer_automations() manually (daily 18:00 UTC).';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
