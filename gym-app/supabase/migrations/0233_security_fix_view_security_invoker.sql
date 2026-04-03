-- ══════════════════════════════════════════════════════════════════════
-- Security fix: Set security_invoker = on for all views
--
-- Supabase Security Advisor flagged 4 views as SECURITY DEFINER.
-- Without security_invoker, views execute with the permissions of
-- the view creator (typically a superuser), bypassing RLS on the
-- underlying tables. Setting security_invoker = on ensures the
-- querying user's RLS policies are enforced.
-- ══════════════════════════════════════════════════════════════════════

ALTER VIEW public.v_gym_feed SET (security_invoker = on);
ALTER VIEW public.gym_member_profiles_safe SET (security_invoker = on);
ALTER VIEW public.gyms_public SET (security_invoker = on);
ALTER VIEW public.v_active_members_this_month SET (security_invoker = on);

NOTIFY pgrst, 'reload schema';
