-- ============================================================
-- 0151 — Security fixes: misc policy hardening
-- ============================================================
-- 1. content_reports: include super_admin in admin policies
-- 2. audit_log: restrict INSERT to admin/service role
-- 3. increment_sms_usage: require admin caller
-- ============================================================

-- ── 1. content_reports — staff (admin + super_admin) policies ──

DROP POLICY IF EXISTS "Admins can view gym reports" ON content_reports;
CREATE POLICY "staff_view_reports" ON content_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Admins can update reports" ON content_reports;
CREATE POLICY "staff_update_reports" ON content_reports
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

-- ── 2. audit_log — restrict INSERT to admins ──────────────────

DROP POLICY IF EXISTS "authenticated can insert audit_log" ON audit_log;
CREATE POLICY "admin_insert_audit_log" ON audit_log
  FOR INSERT WITH CHECK (public.is_admin());

-- ── 3. increment_sms_usage — require admin caller ─────────────

CREATE OR REPLACE FUNCTION public.increment_sms_usage(
  p_gym_id UUID,
  p_direction TEXT,
  p_segments INTEGER DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  -- Only admins or super_admins may call this function
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin role required';
  END IF;

  INSERT INTO sms_usage_monthly (gym_id, month, messages_sent, messages_received, segments_sent)
  VALUES (
    p_gym_id, v_month,
    CASE WHEN p_direction = 'sent' THEN 1 ELSE 0 END,
    CASE WHEN p_direction = 'received' THEN 1 ELSE 0 END,
    CASE WHEN p_direction = 'sent' THEN p_segments ELSE 0 END
  )
  ON CONFLICT (gym_id, month) DO UPDATE SET
    messages_sent = sms_usage_monthly.messages_sent + CASE WHEN p_direction = 'sent' THEN 1 ELSE 0 END,
    messages_received = sms_usage_monthly.messages_received + CASE WHEN p_direction = 'received' THEN 1 ELSE 0 END,
    segments_sent = sms_usage_monthly.segments_sent + CASE WHEN p_direction = 'sent' THEN p_segments ELSE 0 END,
    updated_at = NOW();
END;
$$;
