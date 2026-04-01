-- ══════════════════════════════════════════════════════════════════════
-- FIX: Add SET search_path = public to all SECURITY DEFINER functions
--
-- SECURITY DEFINER functions execute with the privileges of the
-- function owner. Without an explicit search_path, a malicious user
-- could create objects in a schema that shadows public tables,
-- potentially hijacking queries inside these privileged functions.
-- ══════════════════════════════════════════════════════════════════════

-- From 0116_referral_system.sql
ALTER FUNCTION public.generate_referral_code(UUID, UUID) SET search_path = public;

-- From 0117_referral_security_hardening.sql (replaced version of complete_referral)
ALTER FUNCTION public.complete_referral(UUID) SET search_path = public;
ALTER FUNCTION public.safe_complete_referral(UUID) SET search_path = public;

-- From 0118_member_invite_system.sql
ALTER FUNCTION public.claim_member_invite(TEXT, UUID) SET search_path = public;

-- From 0119_invite_one_use_enforcement.sql
ALTER FUNCTION public.admin_reissue_member_invite(UUID, UUID, UUID, TEXT, TEXT, TEXT) SET search_path = public;
