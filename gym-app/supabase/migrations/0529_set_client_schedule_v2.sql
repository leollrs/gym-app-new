-- 0529_set_client_schedule_v2.sql
-- ---------------------------------------------------------------------------
-- ROOT CAUSE (audit P0-3, 0452:62–84): re-saving a client's weekly schedule
-- destroyed session history. The old set_client_schedule DELETEd every
-- from_schedule row with scheduled_at >= date_trunc('day', now()) — UTC
-- midnight is 8pm PR the day BEFORE, and there was NO status filter. So a
-- re-save: (a) wiped today's already-COMPLETED sessions (deflating
-- attended_with_trainer, the money overview and the attendance calendar),
-- (b) resurrected CANCELLED / no_show future sessions as fresh 'scheduled'
-- rows, and (c) discarded any calendar edits (moved time, notes, attached
-- workout, 'confirmed'). The materialization also had no duplicate guard
-- against kept/manual rows, and NOTHING extended the 8-week horizon — on
-- week 9 the calendar silently emptied.
--
-- v2 changes:
--   • DELETE only FUTURE (scheduled_at >= now(), PR-correct since now() is
--     absolute) from_schedule rows whose status = 'scheduled'. Completed,
--     cancelled, no_show and confirmed rows all survive a re-save.
--     ('confirmed' means the trainer customized/locked that occurrence —
--     treat it as a manual edit, never regenerate over it.)
--   • Materialization INSERT gains a NOT EXISTS guard on
--     (trainer_id, client_id, scheduled_at) so surviving + manual rows are
--     never duplicated (a kept cancelled row also stays cancelled — it is
--     NOT resurrected, the guard blocks a fresh insert at that timestamp).
--   • Notifies the member (type 'schedule_updated', audience 'member',
--     route '/trainers/<trainer_id>') — only when the template actually
--     changed (before/after slot comparison).
--   • NEW extend_trainer_schedule_materialization(): weekly pg_cron job that
--     tops every standing schedule back up to 8 weeks of future sessions
--     (same guard / timezone math), fixing the week-9 decay.
--   • NEW check_client_session_conflict(): returns OTHER-trainer overlapping
--     sessions for a client so the calendar can warn before double-booking.
-- Timezone: America/Puerto_Rico (UTC-4, no DST) — same wall-clock math as 0452.
-- ---------------------------------------------------------------------------

-- notifications.type is the notification_type ENUM (no CHECK constraint on the
-- table) — extend it. Safe in-transaction: the new value is only referenced
-- inside function bodies here, never evaluated during this migration.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'schedule_updated';

-- ── set_client_schedule v2 ──────────────────────────────────────────────────
-- Same signature + RETURNS VOID as 0452 (client code only reads { error }).
-- p_slots = [{ "day_of_week":1, "start_time":"09:00", "duration_mins":60 }, …]
-- (multiple rows per day_of_week are supported — UNIQUE is on day + time).
CREATE OR REPLACE FUNCTION public.set_client_schedule(p_client_id UUID, p_slots JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid      UUID := auth.uid();
  v_gym    UUID;
  v_before JSONB;
  v_after  JSONB;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  -- Schedule is the trainer's own arrangement; require an active trainer link.
  SELECT gym_id INTO v_gym FROM trainer_clients
    WHERE trainer_id = uid AND client_id = p_client_id AND is_active = true LIMIT 1;
  IF v_gym IS NULL THEN
    SELECT gym_id INTO v_gym FROM profiles WHERE id = p_client_id;
  END IF;

  -- Snapshot the old template (normalized) for the changed? check below.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day_of_week', day_of_week,
           'start_time', to_char(start_time, 'HH24:MI'),
           'duration_mins', duration_mins
         ) ORDER BY day_of_week, start_time), '[]'::jsonb)
    INTO v_before
    FROM trainer_client_schedule
   WHERE trainer_id = uid AND client_id = p_client_id;

  -- Clear ONLY future, still-pristine schedule-generated sessions.
  -- status filter: completed/cancelled/no_show keep their history;
  -- 'confirmed' = the trainer customized that occurrence — keep it too.
  DELETE FROM trainer_sessions
    WHERE trainer_id = uid AND client_id = p_client_id
      AND from_schedule = true
      AND status = 'scheduled'
      AND scheduled_at >= now();
  DELETE FROM trainer_client_schedule WHERE trainer_id = uid AND client_id = p_client_id;

  -- Insert the new template.
  INSERT INTO trainer_client_schedule (trainer_id, client_id, gym_id, day_of_week, start_time, duration_mins)
  SELECT uid, p_client_id, v_gym,
         (s->>'day_of_week')::int,
         (s->>'start_time')::time,
         COALESCE((s->>'duration_mins')::int, 60)
  FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) s
  ON CONFLICT (trainer_id, client_id, day_of_week, start_time) DO NOTHING;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day_of_week', day_of_week,
           'start_time', to_char(start_time, 'HH24:MI'),
           'duration_mins', duration_mins
         ) ORDER BY day_of_week, start_time), '[]'::jsonb)
    INTO v_after
    FROM trainer_client_schedule
   WHERE trainer_id = uid AND client_id = p_client_id;

  -- Materialize the next 8 weeks onto the calendar. NOT EXISTS guard:
  -- surviving rows (completed / cancelled / no_show / confirmed) and manual
  -- sessions at the same timestamp are never duplicated or resurrected.
  INSERT INTO trainer_sessions (gym_id, trainer_id, client_id, title, scheduled_at, duration_mins, status, from_schedule)
  SELECT v_gym, uid, p_client_id, 'Entrenamiento',
         ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico'),
         sch.duration_mins, 'scheduled', true
  FROM trainer_client_schedule sch
  CROSS JOIN generate_series(date_trunc('day', now())::date, (now() + interval '8 weeks')::date, '1 day') d
  WHERE sch.trainer_id = uid AND sch.client_id = p_client_id
    AND EXTRACT(dow FROM d) = sch.day_of_week
    AND ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico') >= now()
    AND NOT EXISTS (
      SELECT 1 FROM trainer_sessions ts
       WHERE ts.trainer_id = uid
         AND ts.client_id  = p_client_id
         AND ts.scheduled_at = ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico')
    );

  -- Tell the member their standing schedule changed (skip no-op re-saves).
  IF v_after IS DISTINCT FROM v_before THEN
    PERFORM public._notify_push(
      p_client_id, v_gym, 'member'::user_role, 'schedule_updated'::notification_type,
      'Schedule updated',
      'Your trainer updated your weekly schedule.',
      'Horario actualizado',
      'Tu entrenador actualizó tu horario semanal',
      jsonb_build_object('route', '/trainers/' || uid::text, 'type', 'schedule_updated', 'trainer_id', uid),
      'schedule_updated_' || p_client_id::text || '_' || uid::text || '_' || floor(extract(epoch FROM now()))::bigint::text
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_client_schedule(UUID, JSONB) TO authenticated;

-- ── extend_trainer_schedule_materialization ────────────────────────────────
-- Cron worker: for every standing schedule row (with a still-active trainer
-- link), insert any missing trainer_sessions out to 8 weeks ahead. Same
-- NOT EXISTS guard + PR wall-clock math as set_client_schedule, so completed/
-- cancelled/confirmed/manual rows are never touched or duplicated. Without
-- this, the 8-week horizon from the last manual save silently decays to zero.
CREATE OR REPLACE FUNCTION public.extend_trainer_schedule_materialization()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO trainer_sessions (gym_id, trainer_id, client_id, title, scheduled_at, duration_mins, status, from_schedule)
  SELECT sch.gym_id, sch.trainer_id, sch.client_id, 'Entrenamiento',
         ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico'),
         sch.duration_mins, 'scheduled', true
  FROM trainer_client_schedule sch
  CROSS JOIN generate_series(date_trunc('day', now())::date, (now() + interval '8 weeks')::date, '1 day') d
  WHERE EXTRACT(dow FROM d) = sch.day_of_week
    AND ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico') >= now()
    -- Only extend pairs that are still an active coaching relationship.
    AND EXISTS (
      SELECT 1 FROM trainer_clients tc
       WHERE tc.trainer_id = sch.trainer_id
         AND tc.client_id  = sch.client_id
         AND tc.is_active  = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM trainer_sessions ts
       WHERE ts.trainer_id = sch.trainer_id
         AND ts.client_id  = sch.client_id
         AND ts.scheduled_at = ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico')
    );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'extend_trainer_schedule_materialization failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.extend_trainer_schedule_materialization() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.extend_trainer_schedule_materialization() TO service_role;

-- Weekly, Monday 07:00 UTC (3:00 AM PR). Guard against duplicate job names
-- (same pattern as 0501).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'extend-trainer-schedules') THEN
      PERFORM cron.unschedule('extend-trainer-schedules');
    END IF;
    PERFORM cron.schedule(
      'extend-trainer-schedules',
      '0 7 * * 1',
      $cron$ SELECT public.extend_trainer_schedule_materialization(); $cron$
    );
  ELSE
    RAISE NOTICE '[0529] pg_cron not installed — schedule extend_trainer_schedule_materialization() manually (weekly).';
  END IF;
END $$;

-- ── check_client_session_conflict ──────────────────────────────────────────
-- OTHER-trainer overlapping sessions (status scheduled/confirmed) for a
-- client, so the calendar can warn before double-booking a shared client.
-- Caller must be a trainer/staff of the client (_can_manage_client) or the
-- client themself. "Other" = any trainer that isn't the caller.
CREATE OR REPLACE FUNCTION public.check_client_session_conflict(
  p_client_id        UUID,
  p_start            TIMESTAMPTZ,
  p_duration_mins    INT,
  p_exclude_session  UUID DEFAULT NULL
)
RETURNS TABLE(trainer_name TEXT, scheduled_at TIMESTAMPTZ, duration_mins INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF uid <> p_client_id AND NOT public._can_manage_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT p.full_name,
         ts.scheduled_at,
         ts.duration_mins::int
    FROM trainer_sessions ts
    JOIN profiles p ON p.id = ts.trainer_id
   WHERE ts.client_id = p_client_id
     AND ts.trainer_id <> uid
     AND ts.status IN ('scheduled', 'confirmed')
     AND (p_exclude_session IS NULL OR ts.id <> p_exclude_session)
     AND ts.scheduled_at < p_start + make_interval(mins => GREATEST(COALESCE(p_duration_mins, 60), 1))
     AND ts.scheduled_at + make_interval(mins => ts.duration_mins::int) > p_start
   ORDER BY ts.scheduled_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_client_session_conflict(UUID, TIMESTAMPTZ, INT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
