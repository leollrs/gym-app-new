-- =============================================================
-- get_recent_exercise_ids — distinct exercise ids the calling
-- member has COMPLETED in the last N days. Powers the "Recent"
-- chip on the Exercise Library (a primary 'Main' nav tab, so a
-- hot path). The page used to pull every completed session in the
-- window WITH its nested session_exercises → session_sets just to
-- flatten the blob down to a Set of exercise ids on the client —
-- a large nested JSON payload fetched on every mount to extract a
-- handful of ids.
--
-- This RPC does the distinct-extraction in Postgres and returns
-- only the ids. SECURITY DEFINER bypasses RLS; the body scopes
-- every read to auth.uid() and guards p_profile_id to equal the
-- caller, so there is no cross-member leak. Index-assisted by
-- idx_session_exercises_session (session_id) +
-- idx_session_sets_exercise (session_exercise_id).
--
-- is_completed is NOT NULL DEFAULT FALSE, so `ss.is_completed`
-- exactly matches the old client predicate `is_completed !== false`.
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_recent_exercise_ids(p_profile_id uuid, p_days int DEFAULT 30)
RETURNS TABLE(exercise_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT se.exercise_id
    FROM session_exercises se
    JOIN workout_sessions s ON s.id = se.session_id
   WHERE s.profile_id = auth.uid()
     AND p_profile_id = auth.uid()          -- caller may only query their own history
     AND s.status = 'completed'
     AND s.completed_at >= now() - make_interval(days => GREATEST(p_days, 0))
     AND EXISTS (
       SELECT 1 FROM session_sets ss
        WHERE ss.session_exercise_id = se.id
          AND ss.is_completed
     );
$$;

GRANT EXECUTE ON FUNCTION public.get_recent_exercise_ids(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_recent_exercise_ids(uuid, int) IS
  'Distinct exercise ids the calling member completed in the last p_days days
   (default 30), computed server-side instead of fetching nested
   sessions→exercises→sets to the client. Scoped to auth.uid(); p_profile_id
   must equal the caller. Used by the Exercise Library "Recent" chip.';
