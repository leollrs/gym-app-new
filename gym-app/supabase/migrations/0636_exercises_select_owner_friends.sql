-- 0636_exercises_select_owner_friends.sql
-- ============================================================================
-- FIX: custom (member-authored) exercises leaked GYM-WIDE.
--
-- The old SELECT policy (0002) was:
--     gym_id IS NULL OR gym_id = public.current_gym_id()
-- i.e. ANY gym member could read EVERY exercise scoped to their gym — including
-- another member's personal "Mine" custom exercises. The exercise library's
-- All tab + search surfaced them, and a direct API query could read them too.
--
-- The client was tightened separately (only fetch own + friends' customs), but
-- that is not a security boundary. This migration is the server-side backstop.
--
-- NEW MODEL — a member may read an exercise when ANY holds:
--   • it's a GLOBAL exercise (gym_id IS NULL) — the shared library
--   • they OWN it (created_by = auth.uid())
--   • it has no personal owner (created_by IS NULL) — legacy gym exercise
--   • it's STAFF-AUTHORED in their gym (created_by is is_staff) — i.e. a real
--     "gym-provided" exercise from a trainer/admin (programs, WOD, challenges);
--     these stay gym-visible so nothing that references them breaks
--   • the creator is their FRIEND (accepted friendship) — the "Friends" tab
--   • they are the creator's TRAINER (is_trainer_of) — coach reviewing a client
--   • it's referenced in a ROUTINE they own or an assigned/public gym routine
--   • it's referenced in a workout SESSION they logged (history)
--
-- The ONLY behaviour that changes: member A's PERSONAL custom is no longer
-- readable by unrelated member B. Global + staff/gym + assigned + logged
-- exercises are all still readable, so workouts, programs, WOD, challenges,
-- PRs and history are unaffected.
--
-- Implemented as ONE SECURITY DEFINER function so the inner lookups
-- (profiles/friendships/routines/sessions) bypass their own RLS — this avoids
-- RLS recursion / "can't read the row I'm checking" false negatives. auth.uid()
-- still resolves to the CALLING user inside a SECURITY DEFINER function (it reads
-- the request JWT, not the role), exactly like the existing is_admin()/
-- current_gym_id() helpers.
--
-- ROLLBACK (revert to the pre-fix behaviour):
--   DROP POLICY IF EXISTS "exercises_select" ON exercises;
--   CREATE POLICY "exercises_select" ON exercises FOR SELECT
--     USING (gym_id IS NULL OR gym_id = public.current_gym_id());
--   DROP FUNCTION IF EXISTS public.can_read_exercise(text, uuid, uuid);
--
-- TEST BEFORE PROD (a wrong RLS policy hides exercises silently):
--   1. Member A + Member B, same gym, NOT friends: A creates a custom →
--      B must NOT see it in library All/search, and a direct select must return 0.
--   2. A + B friends: B sees it in the Friends tab.
--   3. A opens a routine/program that contains a custom exercise → it loads.
--   4. Start + log a session using a custom exercise → it loads in ActiveSession
--      and in workout history / PRs afterwards.
--   5. A trainer opens a client's routine + client detail → exercises load.
--   6. Gym WOD / a specific-lift challenge referencing a staff exercise renders.
--   7. Global library + search still list all global exercises.
-- ============================================================================

-- NOTE: exercises.id (and every exercise_id FK) is TEXT, not uuid — ids can be
-- static-library slugs too. Only gym_id / created_by are uuid.
CREATE OR REPLACE FUNCTION public.can_read_exercise(ex_id text, ex_gym uuid, ex_creator uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- global shared library
    ex_gym IS NULL
    -- my own custom
    OR ex_creator = auth.uid()
    -- legacy exercise with no personal owner, in my gym
    OR (ex_creator IS NULL AND ex_gym = public.current_gym_id())
    -- staff-authored (real gym-provided exercise) in my gym → gym-visible
    OR (ex_gym = public.current_gym_id() AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = ex_creator AND p.is_staff IS TRUE))
    -- a friend's personal custom (Friends tab)
    OR EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.status = 'accepted'
            AND ((f.requester_id = auth.uid() AND f.addressee_id = ex_creator)
              OR (f.addressee_id = auth.uid() AND f.requester_id = ex_creator)))
    -- I'm the creator's trainer (coach reviewing a client's custom)
    OR public.is_trainer_of(ex_creator)
    -- referenced in a routine I own, or a public gym routine in my gym
    OR EXISTS (
          SELECT 1 FROM routine_exercises re
          JOIN routines r ON r.id = re.routine_id
          WHERE re.exercise_id = ex_id
            AND (r.created_by = auth.uid()
              OR (r.gym_id = public.current_gym_id() AND r.is_public IS TRUE)))
    -- referenced in a workout session I logged (history / PRs)
    OR EXISTS (
          SELECT 1 FROM session_exercises se
          JOIN workout_sessions ws ON ws.id = se.session_id
          WHERE se.exercise_id = ex_id AND ws.profile_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.can_read_exercise(text, uuid, uuid) TO authenticated, anon;

-- Replace the gym-wide SELECT policy with the owner/friends/staff-scoped one.
-- (INSERT/UPDATE/DELETE own-row policies from 0010 are unchanged; the separate
-- super_admin read policy from 0042 remains and is OR-combined, so super admins
-- still read everything.)
DROP POLICY IF EXISTS "exercises_select" ON exercises;
CREATE POLICY "exercises_select" ON exercises
  FOR SELECT
  USING (public.can_read_exercise(id, gym_id, created_by));
