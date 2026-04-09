-- Fix gym_rewards and referral_milestones RLS to include super_admin

-- Drop existing policies
DROP POLICY IF EXISTS gym_rewards_admin_all ON gym_rewards;
DROP POLICY IF EXISTS referral_milestones_admin_all ON referral_milestones;

-- Recreate with super_admin included
CREATE POLICY gym_rewards_admin_all ON gym_rewards
  FOR ALL
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY referral_milestones_admin_all ON referral_milestones
  FOR ALL
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

NOTIFY pgrst, 'reload schema';
