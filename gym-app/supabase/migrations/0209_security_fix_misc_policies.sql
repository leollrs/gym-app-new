-- ============================================================
-- 0209 — Security fixes for miscellaneous RLS policies
-- ============================================================

-- Fix 1: gym_rewards excludes super_admin (0187_gym_rewards.sql)
-- Original policy only checks role = 'admin', missing 'super_admin'
DROP POLICY IF EXISTS "gym_rewards_admin_all" ON gym_rewards;
CREATE POLICY "gym_rewards_admin_all" ON gym_rewards FOR ALL
  USING (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
  );

-- Fix 2: email_templates excludes super_admin (0190_email_templates.sql)
-- Original policies only check role = 'admin', missing 'super_admin'
-- Table is gym_email_templates (not email_templates)
DROP POLICY IF EXISTS "email_templates_insert" ON gym_email_templates;
DROP POLICY IF EXISTS "email_templates_update" ON gym_email_templates;
DROP POLICY IF EXISTS "email_templates_delete" ON gym_email_templates;

CREATE POLICY "email_templates_insert" ON gym_email_templates FOR INSERT
  WITH CHECK (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
  );
CREATE POLICY "email_templates_update" ON gym_email_templates FOR UPDATE
  USING (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
  );
CREATE POLICY "email_templates_delete" ON gym_email_templates FOR DELETE
  USING (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
  );

-- Fix 3: audit_log INSERT allows any authenticated user (log poisoning)
-- Original policy "audit_insert_auth" only checks actor_id = auth.uid()
-- Any authenticated user could insert fake audit entries
DROP POLICY IF EXISTS "audit_insert_auth" ON admin_audit_log;
CREATE POLICY "admin_insert_audit_log" ON admin_audit_log FOR INSERT
  WITH CHECK (public.is_admin());

-- Fix 4: ai_rate_limits FOR ALL allows users to delete own rate limit records
-- Original policy "Users manage own rate limits" uses FOR ALL,
-- letting users DELETE their own rate-limit rows to bypass limits
DROP POLICY IF EXISTS "Users manage own rate limits" ON ai_rate_limits;
CREATE POLICY "ai_rate_limits_select" ON ai_rate_limits FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "ai_rate_limits_insert" ON ai_rate_limits FOR INSERT WITH CHECK (profile_id = auth.uid());
-- No DELETE or UPDATE policy - only service role / cron can clean up

-- Fix 5: admin_presence readable by non-admin gym members
-- Original policy "Admins can see presence for their gym" only checks
-- gym membership, not admin/trainer role
DROP POLICY IF EXISTS "Admins can see presence for their gym" ON admin_presence;
CREATE POLICY "staff_see_presence" ON admin_presence FOR SELECT
  USING (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role IN ('admin', 'super_admin', 'trainer'))
  );
