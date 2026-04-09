-- Ensure member SELECT policy exists for gym_rewards
-- (migration 0187 was marked applied but may not have run)

DROP POLICY IF EXISTS gym_rewards_member_select ON gym_rewards;

CREATE POLICY gym_rewards_member_select ON gym_rewards
  FOR SELECT
  USING (
    is_active = true
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
    )
  );

-- Also ensure reward_redemptions policies exist
DROP POLICY IF EXISTS "Members can read own redemptions" ON reward_redemptions;
DROP POLICY IF EXISTS "Members can insert own redemptions" ON reward_redemptions;

CREATE POLICY "Members can read own redemptions" ON reward_redemptions
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "Members can insert own redemptions" ON reward_redemptions
  FOR INSERT WITH CHECK (profile_id = auth.uid());

NOTIFY pgrst, 'reload schema';
