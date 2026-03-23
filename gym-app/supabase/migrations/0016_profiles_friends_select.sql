-- Allow users to see profiles of their accepted friends.
-- The existing profiles_select policy (gym_id = current_gym_id()) blocks
-- cross-lookup when friend profiles have a different or null gym_id.
-- This policy grants SELECT on any profile you have an accepted friendship with.

CREATE POLICY "profiles_friends_select" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = profiles.id)
          OR
          (f.addressee_id = auth.uid() AND f.requester_id = profiles.id)
        )
    )
  );
