-- ══════════════════════════════════════════════════════════════════════
-- Security fix: SET search_path = public on 10 functions flagged
-- by the Supabase Security Advisor.
--
-- Without an explicit search_path, a malicious actor could create
-- objects in a schema that shadows public tables, potentially
-- hijacking queries inside these functions.
--
-- Functions fixed:
--   1.  check_invite_claim_rate()                     (trigger, 0118)
--   2.  admin_redeem_voucher(TEXT, UUID)               (json,    0229)
--   3.  generate_invite_code()                         (text,    0107)
--   4.  checkin_date(TIMESTAMPTZ)                      (date,    0213)
--   5.  update_gym_rewards_updated_at()                (trigger, 0187)
--   6.  generate_qr_payload()                          (trigger, 0084)
--   7.  update_email_template_updated_at()             (trigger, 0190)
--   8.  cleanup_old_rate_limits()                      (void,    0090)
--   9.  prevent_invite_reclaim()                       (trigger, 0119)
--  10.  check_referral_rate_limit()                    (trigger, 0117)
-- ══════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.check_invite_claim_rate()
  SET search_path = public;

ALTER FUNCTION public.admin_redeem_voucher(TEXT, UUID)
  SET search_path = public;

ALTER FUNCTION public.generate_invite_code()
  SET search_path = public;

ALTER FUNCTION public.checkin_date(TIMESTAMPTZ)
  SET search_path = public;

ALTER FUNCTION public.update_gym_rewards_updated_at()
  SET search_path = public;

ALTER FUNCTION public.generate_qr_payload()
  SET search_path = public;

ALTER FUNCTION public.update_email_template_updated_at()
  SET search_path = public;

ALTER FUNCTION public.cleanup_old_rate_limits()
  SET search_path = public;

ALTER FUNCTION public.prevent_invite_reclaim()
  SET search_path = public;

ALTER FUNCTION public.check_referral_rate_limit()
  SET search_path = public;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
