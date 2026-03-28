-- =============================================================
-- LOCK DOWN GYMS TABLE — Restrict anonymous access
-- Migration: 0110_lock_down_gyms_table.sql
-- =============================================================
-- VULNERABILITY: The gyms table is fully readable by anonymous
-- (unauthenticated) users via the permissive "gyms_select" policy
-- from migration 0005. Anyone can enumerate all gyms and read
-- sensitive columns: subscription_tier, pricing, QR settings, etc.
--
-- FIX:
--   1. Drop the overly permissive SELECT policy.
--   2. Add a restrictive policy for authenticated users (own gym).
--   3. Add a minimal anonymous policy limited to active gyms only
--      (needed for signup/onboarding slug lookup).
--   4. Create a security-barrier view "gyms_public" that exposes
--      only id, name, slug, and is_active — the frontend signup
--      flow should migrate to use this view instead of the raw
--      gyms table for unauthenticated lookups.
-- =============================================================

-- ── 1. Drop the permissive anonymous SELECT policy ─────────────
DROP POLICY IF EXISTS "gyms_select" ON gyms;

-- ── 2. Authenticated users: can read their own gym ─────────────
--    Members, trainers, admins see their own gym's full row.
--    Super admins can see all gyms (handled by gyms_manage_super_admin FOR ALL).
CREATE POLICY "gyms_select_own" ON gyms
  FOR SELECT USING (
    id = public.current_gym_id()
  );

-- ── 3. Authenticated users: can read any active gym by slug ────
--    This supports the signup/onboarding flow where a newly
--    authenticated user looks up a gym by slug before their
--    profile (and thus current_gym_id()) is set.
CREATE POLICY "gyms_select_active_authenticated" ON gyms
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND is_active = TRUE
  );

-- ── 4. Anonymous users: can read active gyms only ──────────────
--    Needed for the signup page where the user enters a gym slug
--    before they have an account. This still exposes all columns
--    to anon, which is why we also provide the restricted view.
--    NOTE: The frontend should be migrated to use gyms_public view
--    for anonymous lookups to minimise data exposure.
CREATE POLICY "gyms_select_anon_active" ON gyms
  FOR SELECT USING (
    auth.uid() IS NULL
    AND is_active = TRUE
  );

-- ── 5. Security-barrier view: gyms_public ──────────────────────
--    Exposes only the minimal columns the signup flow needs.
--    Since Supabase RLS operates at row level (not column level),
--    this view is the proper way to restrict which columns
--    anonymous users can access.
--
--    SECURITY_BARRIER prevents the optimizer from pushing user-
--    supplied filter predicates below the view, which could
--    otherwise leak data from hidden columns via timing or
--    error-based side channels.
CREATE OR REPLACE VIEW public.gyms_public
  WITH (security_barrier = true)
AS
  SELECT id, name, slug, is_active
  FROM public.gyms
  WHERE is_active = TRUE;

-- Grant anonymous and authenticated roles access to the view
GRANT SELECT ON public.gyms_public TO anon;
GRANT SELECT ON public.gyms_public TO authenticated;

-- ── Done ────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
