-- 0574_custom_meals_private_db.sql
-- Private custom-meal database. Trainers AND members can add their own dishes
-- (name + macros) to use when building / customizing meal plans. Each creator
-- sees only their own meals; the super-admin sees ALL of them (the founder's
-- private library of user-submitted meals). Meals are copied BY VALUE into plan
-- JSON, so clients viewing an assigned plan never need to read this table.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.custom_meals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id      uuid REFERENCES public.gyms(id) ON DELETE SET NULL,
  name        text NOT NULL,
  name_es     text,
  calories    numeric NOT NULL DEFAULT 0,
  protein_g   numeric NOT NULL DEFAULT 0,
  carbs_g     numeric NOT NULL DEFAULT 0,
  fat_g       numeric NOT NULL DEFAULT 0,
  category    text DEFAULT 'custom',
  slot_type   text,              -- breakfast | lunch | snack | dinner | NULL
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_meals_creator ON public.custom_meals(created_by);

ALTER TABLE public.custom_meals ENABLE ROW LEVEL SECURITY;

-- Creator has full access to their own meals.
DROP POLICY IF EXISTS custom_meals_owner ON public.custom_meals;
CREATE POLICY custom_meals_owner ON public.custom_meals
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Super-admin can read EVERY custom meal (the private founder-only library).
DROP POLICY IF EXISTS custom_meals_superadmin_read ON public.custom_meals;
CREATE POLICY custom_meals_superadmin_read ON public.custom_meals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));
