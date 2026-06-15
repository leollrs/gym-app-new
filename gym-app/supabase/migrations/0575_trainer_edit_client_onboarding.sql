-- 0575_trainer_edit_client_onboarding.sql
-- Let a trainer edit their client's onboarding (used here for nutrition
-- preferences: food_allergies + dietary_restrictions). Trainers already READ
-- member_onboarding (onboarding_trainer_read, 0002) to auto-generate programs;
-- this adds matching WRITE access scoped to the trainer's own clients.
--
-- Safe to re-run.

DROP POLICY IF EXISTS onboarding_trainer_update ON public.member_onboarding;
CREATE POLICY onboarding_trainer_update ON public.member_onboarding
  FOR UPDATE TO authenticated
  USING (public.is_trainer_of(profile_id))
  WITH CHECK (public.is_trainer_of(profile_id));
