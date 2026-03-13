-- =============================================================
-- TRAINER FEATURES
-- Migration: 0029_trainer_features.sql
-- Adds: assigned_program_id column on profiles,
--        trainer_clients RLS for notes upsert,
--        trainer access to body metrics
-- =============================================================

-- ============================================================
-- 1. ADD assigned_program_id TO PROFILES
--    Trainers assign gym programs to clients via this column.
--    Code already references it but column was never created.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'assigned_program_id'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN assigned_program_id UUID REFERENCES public.gym_programs(id) ON DELETE SET NULL;

    CREATE INDEX idx_profiles_assigned_program ON public.profiles(assigned_program_id)
      WHERE assigned_program_id IS NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 2. TRAINER_CLIENTS — allow trainers to INSERT (for notes)
--    Existing RLS only allows trainer_id = auth.uid() for ALL,
--    but the upsert from notes needs explicit INSERT permission.
-- ============================================================

-- Drop and recreate to be explicit about each operation
DROP POLICY IF EXISTS "trainer_clients_trainer" ON trainer_clients;

-- Trainers can read their own client relationships
CREATE POLICY "trainer_clients_select_trainer" ON trainer_clients
  FOR SELECT USING (
    trainer_id = auth.uid() OR client_id = auth.uid()
  );

-- Trainers can create new client relationships (for notes)
CREATE POLICY "trainer_clients_insert_trainer" ON trainer_clients
  FOR INSERT WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );

-- Trainers can update their own client records (notes, is_active)
CREATE POLICY "trainer_clients_update_trainer" ON trainer_clients
  FOR UPDATE USING (
    trainer_id = auth.uid()
  );

-- Trainers can delete their own client relationships
CREATE POLICY "trainer_clients_delete_trainer" ON trainer_clients
  FOR DELETE USING (
    trainer_id = auth.uid()
  );

-- ============================================================
-- 3. BODY METRICS — trainers can view client data
--    The is_trainer_of() function exists but policies may not
--    include it for body_weight_logs and body_measurements.
--    Ensure trainer read access is in place.
-- ============================================================

-- body_weight_logs: trainer can read their clients' logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'body_weight_logs'
      AND policyname = 'body_weight_logs_trainer_read'
  ) THEN
    CREATE POLICY "body_weight_logs_trainer_read" ON body_weight_logs
      FOR SELECT USING (
        public.is_trainer_of(profile_id)
      );
  END IF;
END $$;

-- body_measurements: trainer can read their clients' measurements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'body_measurements'
      AND policyname = 'body_measurements_trainer_read'
  ) THEN
    CREATE POLICY "body_measurements_trainer_read" ON body_measurements
      FOR SELECT USING (
        public.is_trainer_of(profile_id)
      );
  END IF;
END $$;

-- ============================================================
-- 4. PROFILES — trainers can update assigned_program_id
--    for members in their gym
-- ============================================================

DROP POLICY IF EXISTS "profiles_trainer_assign_program" ON profiles;

CREATE POLICY "profiles_trainer_assign_program" ON profiles
  FOR UPDATE USING (
    -- The trainer must be in the same gym
    gym_id = public.current_gym_id()
    -- And the current user must be a trainer
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'trainer'
        AND p.gym_id = public.current_gym_id()
    )
  )
  WITH CHECK (
    gym_id = public.current_gym_id()
  );
