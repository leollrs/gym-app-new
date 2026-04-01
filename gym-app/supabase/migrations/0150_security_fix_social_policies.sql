-- ============================================================
-- 0150 — Security fix: enforce gym boundaries on social policies
-- ============================================================
-- Fixes two MEDIUM security issues:
-- 1. milestone_reactions SELECT used USING(true) — no gym boundary
-- 2. friend_challenges INSERT had no gym boundary check

-- 1. milestone_reactions: restrict SELECT to same gym
DROP POLICY IF EXISTS "Members can view milestone reactions in their gym" ON milestone_reactions;

CREATE POLICY "milestone_reactions_select_same_gym" ON milestone_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM milestone_events me
      JOIN profiles p ON p.id = me.profile_id
      WHERE me.id = milestone_reactions.milestone_id
      AND p.gym_id = public.current_gym_id()
    )
  );

-- 2. friend_challenges: restrict INSERT to same gym for both participants
DROP POLICY IF EXISTS "Users can create friend challenges" ON friend_challenges;

CREATE POLICY "friend_challenges_insert_same_gym" ON friend_challenges
  FOR INSERT WITH CHECK (
    auth.uid() = challenger_id
    AND gym_id = public.current_gym_id()
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = challenged_id AND gym_id = public.current_gym_id()
    )
  );
