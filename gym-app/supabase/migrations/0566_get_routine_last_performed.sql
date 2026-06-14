-- =============================================================
-- get_routine_last_performed — last-performed date per routine.
--
-- The Workouts page (useRoutines.fetchRoutines) needs the most
-- recent completed_at per routine_id to show a "last performed"
-- label on each routine card. It used to do this by SELECTing the
-- member's ENTIRE completed-session history (no LIMIT) and folding
-- it down on the client — a daily lifter accumulates 700+ rows
-- over two years, all fetched on every Workouts-page load just to
-- derive one date per routine.
--
-- This RPC pushes the aggregation into Postgres: one small row per
-- routine (routine_id, MAX(completed_at)), GROUP BY routine_id.
-- Index-assisted by idx_sessions_profile_status_completed (0539)
-- and the partial idx_sessions_profile_completed (0459), both of
-- which lead with (profile_id, … , completed_at DESC).
--
-- SECURITY DEFINER bypasses RLS, so the body itself scopes every
-- read to the caller: profile_id = auth.uid(). The p_profile_id
-- argument exists to match the call site's intent but is GUARDED —
-- it must equal the caller, otherwise the query returns nothing.
-- No cross-member history leak. A trainer/admin needing another
-- member's data would use a separate, role-checked RPC.
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_routine_last_performed(p_profile_id uuid)
RETURNS TABLE(routine_id uuid, last_performed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ws.routine_id, MAX(ws.completed_at) AS last_performed_at
    FROM workout_sessions ws
   WHERE ws.profile_id = auth.uid()
     AND p_profile_id = auth.uid()        -- caller may only query their own history
     AND ws.status = 'completed'
     AND ws.routine_id IS NOT NULL
   GROUP BY ws.routine_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_routine_last_performed(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_routine_last_performed(uuid) IS
  'Most-recent completed_at per routine for the calling member, computed
   server-side (GROUP BY routine_id) instead of fetching the full session
   history to the client. Scoped to auth.uid(); p_profile_id must equal the
   caller or the result is empty. Used by useRoutines.fetchRoutines.';
