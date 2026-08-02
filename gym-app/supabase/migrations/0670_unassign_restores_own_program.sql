-- 0670_unassign_restores_own_program.sql
-- purpose: 0669 stops the coach's plan but never gives the member their own
--          program back — it leaves them with NOTHING.
--
-- Adoption expires the member's previous program and records it, with its
-- original expires_at, in the adopted program's
-- `schedule_map.superseded_programs` (src/lib/trainerPlanAdoption.js). The
-- client-side release path reads that and restores it. 0669's server-side stop
-- did not: it expired the adopted row, deleted the week and cleared the marker,
-- and stopped there.
--
-- Result on the member's phone when a trainer unassigns: no program, empty week
-- strip, their own program still expired, no notification, and no undo — the
-- "Back to my program" button lives inside the active-program card, which is
-- gone by then. The data was always recoverable; nothing offered it.
--
-- Also restores preferred_training_days, which adoption realigns to the plan's
-- days (the rest-day protection in complete_workout / check_daily_streaks reads
-- only that column, so leaving it aligned to a plan they no longer follow keeps
-- breaking their streak).

CREATE OR REPLACE FUNCTION public.stop_member_adopted_plan(
  p_member_id UUID,
  p_plan_id   UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map        JSONB;
  v_restore    JSONB;
  v_days       INT[];
  r            RECORD;
BEGIN
  IF p_member_id IS NULL OR p_plan_id IS NULL THEN RETURN; END IF;

  -- Still assigned by the OTHER store? Then this was not a revocation.
  IF EXISTS (
    SELECT 1 FROM trainer_plan_members
     WHERE plan_id = p_plan_id AND member_id = p_member_id
  ) OR EXISTS (
    SELECT 1 FROM trainer_workout_plans
     WHERE id = p_plan_id AND client_id = p_member_id
  ) THEN
    RETURN;
  END IF;

  -- The adopted program's own record of what it replaced.
  SELECT schedule_map INTO v_map
    FROM generated_programs
   WHERE profile_id = p_member_id
     AND expires_at > now()
     AND schedule_map ->> 'trainer_plan_id' = p_plan_id::text
   ORDER BY created_at DESC
   LIMIT 1;

  UPDATE generated_programs
     SET expires_at = now()
   WHERE profile_id = p_member_id
     AND expires_at > now()
     AND schedule_map ->> 'trainer_plan_id' = p_plan_id::text;

  DELETE FROM workout_schedule
   WHERE profile_id = p_member_id
     AND routine_id IN (
       SELECT (jsonb_array_elements_text(COALESCE(gp.schedule_map -> 'routine_ids', '[]'::jsonb)))::uuid
         FROM generated_programs gp
        WHERE gp.profile_id = p_member_id
          AND gp.schedule_map ->> 'trainer_plan_id' = p_plan_id::text
     );

  -- ── Give the member their own program back ──────────────────────────────
  v_restore := COALESCE(v_map -> 'superseded_programs', '[]'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(v_restore) AS e(v) LOOP
    IF (r.v ->> 'id') IS NOT NULL AND (r.v ->> 'expires_at') IS NOT NULL THEN
      UPDATE generated_programs
         SET expires_at = (r.v ->> 'expires_at')::timestamptz
       WHERE id = (r.v ->> 'id')::uuid
         AND profile_id = p_member_id;
    END IF;
  END LOOP;

  -- …and re-seed the week from whichever program is live now. Only when it
  -- actually carries routine ids: a gym-template enrolment has none, and
  -- wiping without being able to rebuild is how the member ends up with an
  -- active program and zero scheduled days.
  FOR r IN
    SELECT gp.gym_id, gp.schedule_map AS m
      FROM generated_programs gp
     WHERE gp.profile_id = p_member_id
       AND gp.expires_at > now()
     ORDER BY gp.created_at DESC
     LIMIT 1
  LOOP
    IF jsonb_array_length(COALESCE(r.m -> 'routine_ids_a', r.m -> 'routine_ids', '[]'::jsonb)) > 0
       AND jsonb_array_length(COALESCE(r.m -> 'routine_day_map', '[]'::jsonb)) > 0 THEN
      DELETE FROM workout_schedule WHERE profile_id = p_member_id;
      INSERT INTO workout_schedule (profile_id, gym_id, day_of_week, routine_id, updated_at)
      SELECT p_member_id,
             r.gym_id,
             (d.v ->> 'day_of_week')::int,
             (COALESCE(r.m -> 'routine_ids_a', r.m -> 'routine_ids') ->> ((d.v ->> 'routine_index')::int))::uuid,
             now()
        FROM jsonb_array_elements(r.m -> 'routine_day_map') AS d(v)
       WHERE (COALESCE(r.m -> 'routine_ids_a', r.m -> 'routine_ids') ->> ((d.v ->> 'routine_index')::int)) IS NOT NULL
      ON CONFLICT (profile_id, day_of_week) DO UPDATE
        SET routine_id = EXCLUDED.routine_id, updated_at = now();
    END IF;
  END LOOP;

  -- Training days back to whatever they were before adoption.
  v_days := CASE
    WHEN jsonb_typeof(v_map -> 'superseded_training_days') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(v_map -> 'superseded_training_days')::int)
    ELSE NULL
  END;

  UPDATE profiles
     SET active_trainer_plan_id = NULL,
         preferred_training_days = COALESCE(v_days, preferred_training_days)
   WHERE id = p_member_id
     AND (active_trainer_plan_id = p_plan_id OR active_trainer_plan_id IS NULL);
END;
$$;

-- AUTHORIZATION. 0669 left this on `REVOKE … FROM PUBLIC` alone. On a standard
-- Supabase project `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO authenticated`
-- creates a DIRECT grant, which a revoke from PUBLIC does not remove — so any
-- member could have called this with someone else's id and wiped their program.
-- Lock it to the triggers that own it: no role may execute it directly.
REVOKE ALL ON FUNCTION public.stop_member_adopted_plan(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stop_member_adopted_plan(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.stop_member_adopted_plan(UUID, UUID) FROM authenticated;

NOTIFY pgrst, 'reload schema';
