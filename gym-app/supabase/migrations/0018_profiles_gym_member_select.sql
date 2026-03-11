-- Fix profiles_select RLS policy to ensure gym members can discover each other.
-- The original policy (gym_id = current_gym_id()) fails when current_gym_id()
-- returns NULL, causing search to return nothing and only profiles_friends_select
-- (accepted friends) to match. Adding id = auth.uid() as a fallback ensures a
-- user can always at minimum see their own profile, and the gym_id check covers
-- all same-gym members.

DROP POLICY IF EXISTS "profiles_select" ON profiles;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR gym_id = public.current_gym_id()
  );
