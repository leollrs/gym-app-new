-- ============================================================================
-- 0590 — platform_cost_summary RPC                              (audit: completeness-6)
-- ============================================================================
-- PlatformAnalytics shows REVENUE (MRR) but never COST, so there's no margin
-- view anywhere — a real gap for a cash-tight founder watching Twilio/Supabase
-- spend. This returns the cheap, readily-summable fleet cost signals (SMS this
-- month + MRR + counts) in one call so a "Costs & margin" panel can show the
-- variable-cost-vs-revenue picture. (Per-gym storage/DB estimates stay in
-- GymOps; aggregating super_admin_compute_gym_costs across the fleet is heavy
-- and deferred.)
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
  SELECT COALESCE(SUM(messages_sent), 0) INTO v_sms
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
