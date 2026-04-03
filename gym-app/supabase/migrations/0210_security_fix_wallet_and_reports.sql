-- ============================================================
-- 0210 — Security fixes: wallet pass tables + content_reports
-- ============================================================
-- Fix 1: wallet_pass_registrations & wallet_pass_update_log had
--         RLS disabled (0085), exposing device tokens to any
--         authenticated user.  Enable RLS with no policies so
--         only the service_role key can access them.
--
-- Fix 2: content_reports INSERT policy ("Members can report
--         content" from 0038) did not validate gym_id, allowing
--         a user to file a report under a gym they don't belong to.
--
-- Fix 3: staff_view_reports / staff_update_reports (0151) lacked
--         gym_id scoping, letting any admin see/update reports
--         from every gym.
-- ============================================================

-- Fix 1: Enable RLS on wallet pass tables and deny access (service role only)
ALTER TABLE IF EXISTS wallet_pass_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wallet_pass_update_log ENABLE ROW LEVEL SECURITY;
-- No policies = service_role only access (which is the intent per the original comment)

-- Fix 2: content_reports INSERT should validate gym_id
DROP POLICY IF EXISTS "users_create_reports" ON content_reports;
DROP POLICY IF EXISTS "Members can report content" ON content_reports;
CREATE POLICY "users_create_reports" ON content_reports FOR INSERT
  WITH CHECK (
    reporter_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );

-- Fix 3: content_reports staff policies should scope by gym
DROP POLICY IF EXISTS "staff_view_reports" ON content_reports;
DROP POLICY IF EXISTS "staff_update_reports" ON content_reports;

CREATE POLICY "staff_view_reports" ON content_reports FOR SELECT
  USING (
    reporter_id = auth.uid()
    OR (
      EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
      AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    )
  );

CREATE POLICY "staff_update_reports" ON content_reports FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );
