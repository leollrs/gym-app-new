-- ============================================================
-- 0203: Security fix - NPS and class admin policies
-- Fix 1: nps_surveys FOR ALL policy allows any member to manage surveys
-- Fix 2: nps_responses SELECT allows any member to read all responses
-- Fix 3: gym_classes/schedules/bookings admin policies missing gym_id boundary
-- ============================================================

-- Fix 1: nps_surveys - FOR ALL policy allows any member to manage surveys
-- Should be admin-only
DROP POLICY IF EXISTS "Admins can manage surveys for their gym" ON nps_surveys;
CREATE POLICY "Admins can manage surveys for their gym" ON nps_surveys
  FOR ALL USING (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
  );

-- Fix 2: nps_responses SELECT - any member can read all responses, should be admin+own
DROP POLICY IF EXISTS "Admins can read all responses for their gym" ON nps_responses;
CREATE POLICY "staff_read_nps_responses" ON nps_responses
  FOR SELECT USING (
    profile_id = auth.uid()
    OR (
      gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    )
  );

-- Fix 3: gym_classes_admin missing gym_id boundary
DROP POLICY IF EXISTS "gym_classes_admin" ON gym_classes;
CREATE POLICY "gym_classes_admin" ON gym_classes
  FOR ALL USING (
    public.is_admin()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "gym_class_schedules_admin" ON gym_class_schedules;
CREATE POLICY "gym_class_schedules_admin" ON gym_class_schedules
  FOR ALL USING (
    public.is_admin()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "bookings_admin" ON gym_class_bookings;
CREATE POLICY "bookings_admin" ON gym_class_bookings
  FOR ALL USING (
    public.is_admin()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );
