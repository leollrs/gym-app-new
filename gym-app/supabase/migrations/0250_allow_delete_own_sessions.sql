-- Allow members to delete their own workout sessions
CREATE POLICY "sessions_delete_own" ON workout_sessions
  FOR DELETE USING (profile_id = auth.uid());
