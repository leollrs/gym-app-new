-- 0572_trainer_body_measurements_edit.sql
-- Let a trainer record/edit a client's body measurements — but only when the
-- member has allowed it. Members keep full control via a per-account toggle.
--
-- Safe to re-run.

-- Member opt-in flag. Default TRUE: a client who has a trainer expects the
-- trainer to be able to log measurements; the member can switch it off from
-- their privacy settings at any time.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allow_trainer_measurements BOOLEAN NOT NULL DEFAULT true;

-- Trainer write access to a CONSENTING client's measurements. RLS is permissive,
-- so these policies simply OR with the existing member-owns + trainer-reads ones.
DROP POLICY IF EXISTS body_measurements_trainer_insert ON public.body_measurements;
CREATE POLICY body_measurements_trainer_insert ON public.body_measurements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_trainer_of(profile_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = body_measurements.profile_id
        AND p.allow_trainer_measurements
    )
  );

DROP POLICY IF EXISTS body_measurements_trainer_update ON public.body_measurements;
CREATE POLICY body_measurements_trainer_update ON public.body_measurements
  FOR UPDATE TO authenticated
  USING (
    public.is_trainer_of(profile_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = body_measurements.profile_id
        AND p.allow_trainer_measurements
    )
  )
  WITH CHECK (
    public.is_trainer_of(profile_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = body_measurements.profile_id
        AND p.allow_trainer_measurements
    )
  );
