-- ============================================================================
-- 0594 — Fix platform_cost_summary: wrong SMS column name              (hotfix)
-- ============================================================================
-- 0590 summed sms_usage_monthly.messages_sent, but that table's column is
-- `count` (see 0257_readd_sms_simple). Every PlatformAnalytics load therefore
-- 400'd with: column "messages_sent" does not exist (42703), and the
-- "Costs & margin" FleetCostPanel silently hid itself.
--
-- CREATE OR REPLACE (forward-safe): fixes DBs where 0590 already applied AND
-- prod once it applies the 0585+ backlog (idempotent either way).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.platform_cost_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month       text := to_char(now(), 'YYYY-MM');
  v_sms         bigint;
  v_mrr         numeric;
  v_total_gyms  int;
  v_active_gyms int;
  v_members     bigint;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  -- sms_usage_monthly.count = per-recipient sends this month (incremented once
  -- per message by increment_sms_usage), NOT per broadcast.
  SELECT COALESCE(SUM(count), 0) INTO v_sms
    FROM sms_usage_monthly WHERE month = v_month;
  SELECT COALESCE(SUM(monthly_price), 0) INTO v_mrr
    FROM gyms WHERE is_active = true;
  SELECT COUNT(*) INTO v_total_gyms  FROM gyms;
  SELECT COUNT(*) INTO v_active_gyms FROM gyms WHERE is_active = true;
  SELECT COUNT(*) INTO v_members
    FROM profiles WHERE role = 'member' AND COALESCE(imported_archived, false) = false;
  RETURN jsonb_build_object(
    'month',          v_month,
    'sms_sent',       v_sms,
    'mrr',            v_mrr,
    'total_gyms',     v_total_gyms,
    'active_gyms',    v_active_gyms,
    'total_members',  v_members
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.platform_cost_summary() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_cost_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
