-- Allow trainers to view and insert program enrollments for their assigned clients
-- Required for the trainer "Assign to Client" flow in Program Library

CREATE POLICY "gpe_select_trainer" ON gym_program_enrollments
  FOR SELECT USING (
    public.is_trainer_of(profile_id)
  );

CREATE POLICY "gpe_insert_trainer" ON gym_program_enrollments
  FOR INSERT WITH CHECK (
    public.is_trainer_of(profile_id)
    AND gym_id = public.current_gym_id()
  );
