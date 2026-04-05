-- ============================================================
-- 0252 — Allow admins to insert check-ins on behalf of members
--        (for physical QR scanner check-in flow)
-- ============================================================

CREATE POLICY "checkins_admin_insert" ON check_ins
  FOR INSERT TO authenticated
  WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- Also allow admin UPDATE (e.g. linking a session_id after the fact)
CREATE POLICY "checkins_admin_update" ON check_ins
  FOR UPDATE TO authenticated
  USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  )
  WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

NOTIFY pgrst, 'reload schema';
