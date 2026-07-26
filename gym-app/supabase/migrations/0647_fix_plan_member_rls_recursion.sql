-- ============================================================
-- 0647 — Fix RLS recursion in the plan-member junctions (0644/0645)
-- ============================================================
-- 0644/0645 shipped junction policies whose staff rules referenced the parent
-- plan table with a plain sub-query, while the parent's *_member_select policy
-- references the junction. That mutual reference makes Postgres recurse on every
-- read of either table (ERRCODE 42P17 "infinite recursion detected in policy"),
-- which breaks the trainer plan list AND all member plan delivery.
--
-- The 0644/0645 files were corrected in place (SECURITY DEFINER helpers that
-- bypass the parent's RLS, the same pattern as _can_manage_client). This
-- migration re-applies that fix for any database where the ORIGINAL 0644/0645
-- were already applied — an in-place file edit never re-runs. Fully idempotent:
-- a no-op on a fresh DB that already carries the corrected 0644/0645.
--
-- Additive. Safe to re-run. DEPENDS ON 0644 + 0645 (+ _can_manage_client 0533/0640).
-- ============================================================

-- ── SECURITY DEFINER helpers (bypass parent RLS → break the cycle) ──────────
CREATE OR REPLACE FUNCTION public._trainer_owns_workout_plan(p_plan_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM trainer_workout_plans WHERE id = p_plan_id AND trainer_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public._admin_reads_workout_plan(p_plan_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM trainer_workout_plans p
    JOIN profiles me ON me.id = auth.uid()
    WHERE p.id = p_plan_id AND me.role IN ('admin', 'super_admin') AND me.gym_id = p.gym_id
  );
$$;
CREATE OR REPLACE FUNCTION public._trainer_owns_meal_plan(p_plan_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM trainer_meal_plans WHERE id = p_plan_id AND trainer_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public._admin_reads_meal_plan(p_plan_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM trainer_meal_plans p
    JOIN profiles me ON me.id = auth.uid()
    WHERE p.id = p_plan_id AND me.role IN ('admin', 'super_admin') AND me.gym_id = p.gym_id
  );
$$;

-- ── Workout junction: replace the recursive staff policies ─────────────────
DROP POLICY IF EXISTS "tpm_trainer_all" ON public.trainer_plan_members;
CREATE POLICY "tpm_trainer_all" ON public.trainer_plan_members
  FOR ALL TO authenticated
  USING (public._trainer_owns_workout_plan(plan_id))
  WITH CHECK (public._trainer_owns_workout_plan(plan_id) AND public._can_manage_client(member_id));

DROP POLICY IF EXISTS "tpm_admin_select" ON public.trainer_plan_members;
CREATE POLICY "tpm_admin_select" ON public.trainer_plan_members
  FOR SELECT TO authenticated
  USING (public._admin_reads_workout_plan(plan_id));

-- ── Meal junction: replace the recursive staff policies ────────────────────
DROP POLICY IF EXISTS "tmpm_trainer_all" ON public.trainer_meal_plan_members;
CREATE POLICY "tmpm_trainer_all" ON public.trainer_meal_plan_members
  FOR ALL TO authenticated
  USING (public._trainer_owns_meal_plan(plan_id))
  WITH CHECK (public._trainer_owns_meal_plan(plan_id) AND public._can_manage_client(member_id));

DROP POLICY IF EXISTS "tmpm_admin_select" ON public.trainer_meal_plan_members;
CREATE POLICY "tmpm_admin_select" ON public.trainer_meal_plan_members
  FOR SELECT TO authenticated
  USING (public._admin_reads_meal_plan(plan_id));

NOTIFY pgrst, 'reload schema';
