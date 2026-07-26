-- ============================================================
-- 0645 — Shared trainer MEAL plans: assign one plan to many members
-- ============================================================
-- Mirror of 0644 (workout plans) for trainer_meal_plans: a junction so a
-- trainer can share one meal plan with several clients and edit it once. As
-- with 0644, client_id stays the legacy "primary" assignee (kept in sync to
-- assignedIds[0]); the junction carries the full set. A member sees the plan
-- via client_id OR the junction.
--
-- Extra vs 0644: the junction-insert trigger also syncs the new member's
-- nutrition_targets from the plan's macro targets (parity with 0537's
-- fire_sync_targets_from_meal_plan, which only covered client_id).
--
-- Additive + idempotent. Touches RLS on a live member-facing table
-- (trainer_meal_plans) — TEST ON STAGING before prod.
-- DEPENDS ON 0537 (_notify_push, meal_plan_assigned enum, nutrition_targets).
-- ============================================================

-- ── 1. Junction table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trainer_meal_plan_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES public.trainer_meal_plans(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_tmpm_plan   ON public.trainer_meal_plan_members(plan_id);
CREATE INDEX IF NOT EXISTS idx_tmpm_member ON public.trainer_meal_plan_members(member_id);

ALTER TABLE public.trainer_meal_plan_members ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS on the junction ─────────────────────────────────
-- SECURITY DEFINER helpers break the parent↔junction policy recursion (42P17) —
-- see 0644 for the full rationale.
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

DROP POLICY IF EXISTS "tmpm_member_select" ON public.trainer_meal_plan_members;
CREATE POLICY "tmpm_member_select" ON public.trainer_meal_plan_members
  FOR SELECT TO authenticated
  USING (member_id = auth.uid());

DROP POLICY IF EXISTS "tmpm_trainer_all" ON public.trainer_meal_plan_members;
CREATE POLICY "tmpm_trainer_all" ON public.trainer_meal_plan_members
  FOR ALL TO authenticated
  USING (public._trainer_owns_meal_plan(plan_id))
  WITH CHECK (public._trainer_owns_meal_plan(plan_id) AND public._can_manage_client(member_id));

DROP POLICY IF EXISTS "tmpm_admin_select" ON public.trainer_meal_plan_members;
CREATE POLICY "tmpm_admin_select" ON public.trainer_meal_plan_members
  FOR SELECT TO authenticated
  USING (public._admin_reads_meal_plan(plan_id));

-- ── 3. Members can read meal plans shared with them via the junction ───────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_meal_plans'
      AND policyname = 'trainer_meal_plans_member_select'
  ) THEN
    CREATE POLICY "trainer_meal_plans_member_select" ON public.trainer_meal_plans
      FOR SELECT TO authenticated
      USING (
        id IN (SELECT plan_id FROM public.trainer_meal_plan_members WHERE member_id = auth.uid())
      );
  END IF;
END $$;

-- ── 4. Junction insert → notify the new member + sync their macro targets ──
CREATE OR REPLACE FUNCTION public.fire_member_meal_plan_shared()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan    RECORD;
  v_trainer TEXT;
BEGIN
  SELECT id, name, gym_id, trainer_id, is_active, client_id,
         target_calories, target_protein_g, target_carbs_g, target_fat_g
    INTO v_plan
  FROM trainer_meal_plans WHERE id = NEW.plan_id;

  -- Only for a live plan; never the trainer; skip the primary (0537 handles them).
  IF v_plan.is_active IS NOT TRUE
     OR NEW.member_id = v_plan.trainer_id
     OR NEW.member_id = v_plan.client_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULL) INTO v_trainer
  FROM profiles WHERE id = v_plan.trainer_id;

  PERFORM public._notify_push(
    NEW.member_id, v_plan.gym_id, 'member'::user_role, 'meal_plan_assigned'::notification_type,
    'New meal plan from your coach',
    COALESCE(v_trainer, 'Your coach') || ' assigned you a meal plan: ' || v_plan.name || '. Check it out in Nutrition.',
    'Tu coach te asignó un plan de comidas',
    COALESCE(v_trainer, 'Tu coach') || ' te asignó un plan de comidas: ' || v_plan.name || '. Míralo en Nutrición.',
    jsonb_build_object('route', '/nutrition', 'meal_plan_id', v_plan.id, 'trainer_id', v_plan.trainer_id),
    'meal_plan_assigned_' || v_plan.id::text || '_' || NEW.member_id::text || '_' || to_char(now(), 'YYYYMMDD')
  );

  -- Sync the member's macro targets from the plan (parity with 0537). Skip when
  -- the trainer set none. Member can still edit their targets later.
  IF v_plan.target_calories IS NOT NULL OR v_plan.target_protein_g IS NOT NULL
     OR v_plan.target_carbs_g IS NOT NULL OR v_plan.target_fat_g IS NOT NULL THEN
    INSERT INTO nutrition_targets (
      profile_id, gym_id, daily_calories, daily_protein_g, daily_carbs_g, daily_fat_g,
      calculation_method, updated_at
    )
    VALUES (
      NEW.member_id, v_plan.gym_id, v_plan.target_calories, v_plan.target_protein_g,
      v_plan.target_carbs_g, v_plan.target_fat_g, 'trainer_plan', now()
    )
    ON CONFLICT (profile_id) DO UPDATE SET
      daily_calories     = COALESCE(EXCLUDED.daily_calories,  nutrition_targets.daily_calories),
      daily_protein_g    = COALESCE(EXCLUDED.daily_protein_g, nutrition_targets.daily_protein_g),
      daily_carbs_g      = COALESCE(EXCLUDED.daily_carbs_g,   nutrition_targets.daily_carbs_g),
      daily_fat_g        = COALESCE(EXCLUDED.daily_fat_g,     nutrition_targets.daily_fat_g),
      calculation_method = 'trainer_plan',
      updated_at         = now();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_meal_plan_shared failed (plan %, member %): %', NEW.plan_id, NEW.member_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_meal_plan_shared_ins ON public.trainer_meal_plan_members;
CREATE TRIGGER trg_member_meal_plan_shared_ins
  AFTER INSERT ON public.trainer_meal_plan_members
  FOR EACH ROW EXECUTE FUNCTION public.fire_member_meal_plan_shared();

NOTIFY pgrst, 'reload schema';
