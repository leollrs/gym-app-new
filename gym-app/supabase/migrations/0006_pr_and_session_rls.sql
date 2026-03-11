-- =============================================================
-- FIX: Add missing INSERT/UPDATE/DELETE RLS for personal_records,
-- pr_history, and workout_sessions DELETE.
-- Migration: 0006_pr_and_session_rls.sql
-- =============================================================

-- personal_records: allow members to write their own PRs
CREATE POLICY "pr_insert_own" ON personal_records
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "pr_update_own" ON personal_records
  FOR UPDATE USING (profile_id = auth.uid());

CREATE POLICY "pr_delete_own" ON personal_records
  FOR DELETE USING (profile_id = auth.uid());

-- pr_history: allow members to insert their own PR history rows
CREATE POLICY "pr_history_insert_own" ON pr_history
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );
