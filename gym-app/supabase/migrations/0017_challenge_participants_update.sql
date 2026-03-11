-- Allow members to update their own challenge_participants row (score updates).
CREATE POLICY "challenge_participants_update_own" ON challenge_participants
  FOR UPDATE USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());
