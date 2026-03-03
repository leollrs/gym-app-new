-- =============================================================
-- FIX: Replace FOR ALL USING (...) policies on routine_exercises,
-- session_exercises, and session_sets with explicit INSERT WITH CHECK
-- policies. Supabase/PostgREST does not reliably inherit the USING
-- clause as WITH CHECK for INSERT when using FOR ALL.
-- Migration: 0007_fix_insert_rls.sql
-- =============================================================

-- ── routine_exercises ────────────────────────────────────────

DROP POLICY IF EXISTS "routine_exercises_access" ON routine_exercises;

CREATE POLICY "routine_exercises_select" ON routine_exercises
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM routines r
      WHERE r.id = routine_id
        AND (r.created_by = auth.uid() OR (r.gym_id = public.current_gym_id() AND r.is_public))
    )
  );

CREATE POLICY "routine_exercises_insert" ON routine_exercises
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM routines r
      WHERE r.id = routine_id
        AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "routine_exercises_update" ON routine_exercises
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM routines r
      WHERE r.id = routine_id
        AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "routine_exercises_delete" ON routine_exercises
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM routines r
      WHERE r.id = routine_id
        AND r.created_by = auth.uid()
    )
  );

-- ── session_exercises ────────────────────────────────────────

DROP POLICY IF EXISTS "session_exercises_access" ON session_exercises;

CREATE POLICY "session_exercises_select" ON session_exercises
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workout_sessions ws
      WHERE ws.id = session_id
        AND (ws.profile_id = auth.uid() OR public.is_trainer_of(ws.profile_id) OR public.is_admin())
    )
  );

CREATE POLICY "session_exercises_insert" ON session_exercises
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_sessions ws
      WHERE ws.id = session_id
        AND ws.profile_id = auth.uid()
    )
  );

CREATE POLICY "session_exercises_delete" ON session_exercises
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workout_sessions ws
      WHERE ws.id = session_id
        AND ws.profile_id = auth.uid()
    )
  );

-- ── session_sets ─────────────────────────────────────────────

DROP POLICY IF EXISTS "session_sets_access" ON session_sets;

CREATE POLICY "session_sets_select" ON session_sets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM session_exercises se
      JOIN workout_sessions ws ON ws.id = se.session_id
      WHERE se.id = session_exercise_id
        AND (ws.profile_id = auth.uid() OR public.is_trainer_of(ws.profile_id) OR public.is_admin())
    )
  );

CREATE POLICY "session_sets_insert" ON session_sets
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM session_exercises se
      JOIN workout_sessions ws ON ws.id = se.session_id
      WHERE se.id = session_exercise_id
        AND ws.profile_id = auth.uid()
    )
  );

CREATE POLICY "session_sets_delete" ON session_sets
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM session_exercises se
      JOIN workout_sessions ws ON ws.id = se.session_id
      WHERE se.id = session_exercise_id
        AND ws.profile_id = auth.uid()
    )
  );
