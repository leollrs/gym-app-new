-- =============================================================
-- TRAINER READ ACCESS TO CLIENT ROUTINES
-- Migration: 0381_routines_trainer_read.sql
--
-- Why: with 0380 in place, trainers can see that a client is mid-workout
-- (session_drafts row), but the live-view page (TrainerLiveSession.jsx)
-- also needs to read the routine + its routine_exercises to render the
-- exercise list, current set, sets-completed counter, and "Up next" panel.
--
-- The existing `routines_select_own` policy only allows the routine's
-- creator (or public routines in the same gym) to read. A client's
-- private "Auto: …" routines aren't created by the trainer, so the
-- routine fetch returns [] → black screen.
--
-- This migration ADDS trainer-read SELECT policies on:
--   • routines           (read routines created by their assigned clients)
--   • routine_exercises  (read exercises of those routines)
--
-- Reads only. Writes (INSERT / UPDATE / DELETE) remain locked to the
-- routine owner via the existing `routines_*_own` policies.
-- =============================================================

DROP POLICY IF EXISTS "routines_trainer_read" ON public.routines;

CREATE POLICY "routines_trainer_read" ON public.routines
  FOR SELECT
  USING (public.is_trainer_of(created_by));

COMMENT ON POLICY "routines_trainer_read" ON public.routines IS
  'Lets a trainer SELECT routines created by their assigned clients (via trainer_clients.is_active = TRUE). Required for the live-session view to render the client''s exercise list. Read-only — writes still require routines_update_own / routines_delete_own.';

DROP POLICY IF EXISTS "routine_exercises_trainer_read" ON public.routine_exercises;

CREATE POLICY "routine_exercises_trainer_read" ON public.routine_exercises
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.routines r
      WHERE r.id = routine_exercises.routine_id
        AND public.is_trainer_of(r.created_by)
    )
  );

COMMENT ON POLICY "routine_exercises_trainer_read" ON public.routine_exercises IS
  'Lets a trainer SELECT routine_exercises rows belonging to a routine created by one of their assigned clients. Pairs with routines_trainer_read so the live-session view can show the full exercise list.';
