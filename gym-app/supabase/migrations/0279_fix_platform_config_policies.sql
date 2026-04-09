-- Fix platform_config policies (0277 may have partially applied)
DROP POLICY IF EXISTS "super_admin_select_platform_config" ON platform_config;
DROP POLICY IF EXISTS "super_admin_all_platform_config" ON platform_config;

CREATE POLICY "super_admin_select_platform_config" ON platform_config
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "super_admin_all_platform_config" ON platform_config
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
