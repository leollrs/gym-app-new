-- Fix admin notification INSERT policy (0214 was marked applied but never ran)
-- Also fix the profile_lookup reference - use profiles directly

DROP POLICY IF EXISTS "notifications_insert_admin" ON notifications;

CREATE POLICY "notifications_insert_admin" ON notifications
  FOR INSERT WITH CHECK (
    -- Admin/trainer can insert notifications for members in their gym
    EXISTS (
      SELECT 1 FROM profiles caller
      WHERE caller.id = auth.uid()
        AND caller.role IN ('admin', 'super_admin', 'trainer')
    )
    AND EXISTS (
      SELECT 1 FROM profiles target
      WHERE target.id = profile_id
        AND target.gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
