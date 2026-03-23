-- Security hardening migration: fix permissive RLS policies and add missing ones

-- ============================================================
-- 1. Fix exercise_substitutions: replace USING(TRUE) with gym-scoped policy
-- ============================================================
DROP POLICY IF EXISTS "substitutions_select" ON exercise_substitutions;

CREATE POLICY "substitutions_select" ON exercise_substitutions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM exercises e
      WHERE e.id = exercise_substitutions.exercise_id
        AND (e.gym_id IS NULL OR e.gym_id = public.current_gym_id())
    )
  );

-- Add missing INSERT policy (admin/trainer only, scoped to gym exercises)
CREATE POLICY "substitutions_insert_admin" ON exercise_substitutions
  FOR INSERT WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM exercises e
      WHERE e.id = exercise_substitutions.exercise_id
        AND (e.gym_id IS NULL OR e.gym_id = public.current_gym_id())
    )
  );

-- Add missing UPDATE policy
CREATE POLICY "substitutions_update_admin" ON exercise_substitutions
  FOR UPDATE USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM exercises e
      WHERE e.id = exercise_substitutions.exercise_id
        AND (e.gym_id IS NULL OR e.gym_id = public.current_gym_id())
    )
  );

-- Add missing DELETE policy
CREATE POLICY "substitutions_delete_admin" ON exercise_substitutions
  FOR DELETE USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM exercises e
      WHERE e.id = exercise_substitutions.exercise_id
        AND (e.gym_id IS NULL OR e.gym_id = public.current_gym_id())
    )
  );

-- ============================================================
-- 2. Add missing DELETE policies for tables that need them
-- ============================================================

-- personal_records: users can delete their own PRs
CREATE POLICY "personal_records_delete_own" ON personal_records
  FOR DELETE USING (profile_id = auth.uid());

-- pr_history: users can delete their own PR history
CREATE POLICY "pr_history_delete_own" ON pr_history
  FOR DELETE USING (profile_id = auth.uid());

-- overload_suggestions: users can delete/update their own suggestions
CREATE POLICY "overload_suggestions_delete_own" ON overload_suggestions
  FOR DELETE USING (profile_id = auth.uid());

CREATE POLICY "overload_suggestions_update_own" ON overload_suggestions
  FOR UPDATE USING (profile_id = auth.uid());

NOTIFY pgrst, 'reload schema';
