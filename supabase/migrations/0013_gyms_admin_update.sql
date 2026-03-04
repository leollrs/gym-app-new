-- Allow gym admins to update their own gym settings
-- (name, open_time, close_time, open_days)
-- super_admin is already covered by gyms_manage_super_admin (FOR ALL)

CREATE POLICY "gyms_update_admin" ON gyms
  FOR UPDATE USING (
    id = public.current_gym_id()
    AND public.is_admin()
  );
