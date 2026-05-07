-- ============================================================
-- 0379 — Multi-trainer per class
-- ============================================================
-- Until now `gym_classes.trainer_id` was a single FK, so every class
-- had exactly one assigned trainer. Admin asked for multiple trainers
-- per class (think: a HIIT slot taught jointly, or a class that rotates
-- between two coaches). This migration introduces a junction table.
--
-- We KEEP `gym_classes.trainer_id` populated with the first selected
-- trainer (by created_at) so existing read paths that join on it
-- (member side, analytics, dashboard) continue to work without a
-- coordinated rewrite. The junction is the source of truth for the
-- full set of assigned trainers.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gym_class_trainers (
  class_id   UUID NOT NULL REFERENCES public.gym_classes(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  gym_id     UUID NOT NULL REFERENCES public.gyms(id)        ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (class_id, trainer_id)
);

CREATE INDEX IF NOT EXISTS gym_class_trainers_class_id_idx   ON public.gym_class_trainers(class_id);
CREATE INDEX IF NOT EXISTS gym_class_trainers_trainer_id_idx ON public.gym_class_trainers(trainer_id);
CREATE INDEX IF NOT EXISTS gym_class_trainers_gym_id_idx     ON public.gym_class_trainers(gym_id);

ALTER TABLE public.gym_class_trainers ENABLE ROW LEVEL SECURITY;

-- Anyone in the same gym can read trainer assignments (members need
-- this so the Classes page can show "taught by X & Y").
DROP POLICY IF EXISTS "gct_select_same_gym" ON public.gym_class_trainers;
CREATE POLICY "gct_select_same_gym" ON public.gym_class_trainers
  FOR SELECT USING (
    gym_id IN (SELECT gym_id FROM public.profiles WHERE id = auth.uid())
  );

-- Only admins/super_admins/trainers in the gym can mutate.
DROP POLICY IF EXISTS "gct_write_admin_trainer" ON public.gym_class_trainers;
CREATE POLICY "gct_write_admin_trainer" ON public.gym_class_trainers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('admin','super_admin','trainer')
         AND (p.gym_id = public.gym_class_trainers.gym_id OR p.role = 'super_admin')
    )
  );

-- Backfill: migrate existing single-trainer assignments into the junction.
INSERT INTO public.gym_class_trainers (class_id, trainer_id, gym_id)
SELECT id, trainer_id, gym_id
  FROM public.gym_classes
 WHERE trainer_id IS NOT NULL
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
