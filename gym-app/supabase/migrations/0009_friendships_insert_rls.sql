-- =============================================================
-- FIX: Replace FOR ALL USING on friendships with explicit
-- per-operation policies so INSERT works via PostgREST.
-- Migration: 0009_friendships_insert_rls.sql
-- =============================================================

DROP POLICY IF EXISTS "friendships_access" ON friendships;

-- Either party can read their own friendships within the gym
CREATE POLICY "friendships_select" ON friendships
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  );

-- You can only send friend requests as yourself, within your gym
CREATE POLICY "friendships_insert" ON friendships
  FOR INSERT WITH CHECK (
    requester_id = auth.uid()
    AND gym_id   = public.current_gym_id()
  );

-- Either party can update the friendship status (accept / block)
CREATE POLICY "friendships_update" ON friendships
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  );

-- Either party can remove the friendship
CREATE POLICY "friendships_delete" ON friendships
  FOR DELETE USING (
    gym_id = public.current_gym_id()
    AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  );
