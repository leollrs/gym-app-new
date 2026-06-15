-- 0577_trainer_edit_disliked_foods.sql
-- Let a trainer manage their client's "foods to avoid" (disliked_foods) so the
-- nutrition-preferences editor can write all three lists (allergies + diets via
-- member_onboarding in 0575, plus avoid here). Same coaching-scope model:
-- writes restricted to the trainer's own clients.
--
-- Safe to re-run.

DROP POLICY IF EXISTS disliked_foods_trainer_write ON public.disliked_foods;
CREATE POLICY disliked_foods_trainer_write ON public.disliked_foods
  FOR ALL TO authenticated
  USING (public.is_trainer_of(profile_id))
  WITH CHECK (public.is_trainer_of(profile_id));
