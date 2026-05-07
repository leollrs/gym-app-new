-- ============================================================================
-- 0364 — Convert admin-only views to security_invoker mode
-- ============================================================================
-- Supabase Security Advisor flags four `security_definer_view` ERRORs.
-- This migration fixes three of them by switching the views to
-- `security_invoker = true`, which makes the view's underlying queries
-- run as the calling user (subject to RLS) instead of the view owner.
--
-- Why this is safe for these three:
--   • v_admin_engagement
--   • v_cross_gym_onboarding
--   • v_gym_feature_adoption
--
-- Each is only read via a SECURITY DEFINER wrapper RPC
-- (`get_admin_engagement`, `get_cross_gym_onboarding`). The wrapper
-- function still runs as `postgres`, so when it queries the view, the
-- view evaluates as `postgres` too and bypasses RLS — same behaviour
-- as before. No client or edge function reads these views directly
-- (verified by `git grep`).
--
-- The fourth flagged view, `public.gym_member_profiles_safe`, is
-- explicitly designed to be SECURITY DEFINER per migration 0289:
--   • profiles_select RLS was tightened so regular members can only
--     see their own row.
--   • The view deliberately bypasses that to expose a PII-safe column
--     subset of other same-gym members (gym boundary enforced inline
--     via the WHERE clause).
--   • 13 call sites across Messages, SocialFeed, ExerciseLibrary, and
--     trainer pages depend on this behaviour.
--
-- Flipping `gym_member_profiles_safe` to security_invoker would break
-- friend pickers, the social feed, message recipient lists, trainer
-- client lookups, and more. The lint will keep firing on it; that's
-- the cost of the design and is documented in 0289.
-- ============================================================================

ALTER VIEW public.v_admin_engagement     SET (security_invoker = true);
ALTER VIEW public.v_cross_gym_onboarding SET (security_invoker = true);
ALTER VIEW public.v_gym_feature_adoption SET (security_invoker = true);

NOTIFY pgrst, 'reload schema';
