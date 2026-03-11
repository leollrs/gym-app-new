-- =============================================================
-- FIX: Allow public reads on gyms table
-- Migration: 0005_fix_gyms_rls.sql
-- =============================================================
-- The signup flow needs to look up a gym by slug BEFORE the user
-- is authenticated. The original policy blocked this because
-- auth.uid() returns NULL for unauthenticated requests.
--
-- Gym slugs/names are public-facing info (like a landing page URL)
-- so allowing anon reads on active gyms is safe and correct.
-- All sensitive member data remains protected by other policies.
-- =============================================================

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "gyms_select" ON gyms;

-- Allow anyone (anon or authenticated) to read active gyms.
-- Admins (super_admin) can also see inactive gyms.
CREATE POLICY "gyms_select" ON gyms
  FOR SELECT USING (
    is_active = TRUE
    OR public.current_user_role() = 'super_admin'
  );
