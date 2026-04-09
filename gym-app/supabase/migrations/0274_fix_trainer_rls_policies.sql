-- Fix trainer_clients RLS (migration 0029 may not have applied properly)
-- Re-create all trainer_clients policies

DROP POLICY IF EXISTS "trainer_clients_trainer" ON trainer_clients;
DROP POLICY IF EXISTS "trainer_clients_select_trainer" ON trainer_clients;
DROP POLICY IF EXISTS "trainer_clients_insert_trainer" ON trainer_clients;
DROP POLICY IF EXISTS "trainer_clients_update_trainer" ON trainer_clients;
DROP POLICY IF EXISTS "trainer_clients_delete_trainer" ON trainer_clients;

-- Trainers can read their own client relationships
CREATE POLICY "trainer_clients_select_trainer" ON trainer_clients
  FOR SELECT USING (
    trainer_id = auth.uid() OR client_id = auth.uid()
  );

-- Trainers can create new client relationships
CREATE POLICY "trainer_clients_insert_trainer" ON trainer_clients
  FOR INSERT WITH CHECK (
    trainer_id = auth.uid()
  );

-- Trainers can update their own client records
CREATE POLICY "trainer_clients_update_trainer" ON trainer_clients
  FOR UPDATE USING (
    trainer_id = auth.uid()
  );

-- Trainers can delete their own client relationships
CREATE POLICY "trainer_clients_delete_trainer" ON trainer_clients
  FOR DELETE USING (
    trainer_id = auth.uid()
  );

-- Admin can also manage trainer_clients
DROP POLICY IF EXISTS "trainer_clients_admin" ON trainer_clients;
CREATE POLICY "trainer_clients_admin" ON trainer_clients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
        AND p.gym_id = trainer_clients.gym_id
    )
  );

-- Fix gym_class_schedules 403 for trainers
DROP POLICY IF EXISTS "class_schedules_trainer_select" ON gym_class_schedules;
CREATE POLICY "class_schedules_trainer_select" ON gym_class_schedules
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

-- Fix gym_workouts_of_the_day 403
DROP POLICY IF EXISTS "wod_gym_read" ON gym_workouts_of_the_day;
CREATE POLICY "wod_gym_read" ON gym_workouts_of_the_day
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

-- Fix nps_surveys 403 for trainers
DROP POLICY IF EXISTS "nps_trainer_read" ON nps_surveys;
CREATE POLICY "nps_trainer_read" ON nps_surveys
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

NOTIFY pgrst, 'reload schema';
