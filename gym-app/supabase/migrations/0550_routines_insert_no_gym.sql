-- ============================================================
-- 0550 — routines INSERT: don't reject members without a gym
-- ============================================================
-- Found live (2026-06-12): a member going through onboarding hit
-- "[reject] new row violates row-level security policy for table
-- routines". Root cause: routines_insert_own (0002) checks
--
--     gym_id = public.current_gym_id()
--
-- and the onboarding plan preload (step 6) inserts the auto-generated
-- routines BEFORE the finish-step gym gate — so a member who skipped
-- the invite code (or whose claim hadn't landed yet) inserts
-- gym_id NULL while current_gym_id() is also NULL. In SQL
-- NULL = NULL is not TRUE, so the policy rejects every routine for
-- every gym-less member — onboarding preview, WorkoutBuilder,
-- QuickStart, all of it.
--
-- Fix: IS NOT DISTINCT FROM — identical behavior for gym members
-- (their routines stay pinned to their own gym), and a gym-less
-- member may own personal routines with gym_id NULL. Every reader
-- of these rows is creator-keyed (routines_select_own,
-- routines_trainer_read 0381, routine_exercises_access), so
-- NULL-gym routines stay fully functional after the member later
-- joins a gym at the finish gate.
-- ============================================================

DROP POLICY IF EXISTS "routines_insert_own" ON public.routines;
CREATE POLICY "routines_insert_own" ON public.routines
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND gym_id IS NOT DISTINCT FROM public.current_gym_id()
  );

COMMENT ON POLICY "routines_insert_own" ON public.routines IS
  'Members insert their own routines. gym_id must match their profile gym — including both NULL (gym-less member creating personal routines, e.g. onboarding plan preview before the invite-code finish gate).';

NOTIFY pgrst, 'reload schema';
