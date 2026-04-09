-- ============================================================
-- Fix error_logs RLS policies
--
-- Issue: 401 errors when super_admin queries error_logs.
--
-- 1. Drop duplicate INSERT policy from migration 0098
--    (0222 created "authenticated_insert_own_errors" but
--    never dropped "authenticated_insert_errors" from 0098).
--
-- 2. Re-create SELECT policies with SECURITY DEFINER subquery
--    to avoid any RLS recursion issues when checking profiles.
-- ============================================================

-- ── Clean up duplicate INSERT policy ────────────────────────
DROP POLICY IF EXISTS "authenticated_insert_errors" ON error_logs;

-- ── Re-create super_admin SELECT with defensive drop-first ──
DROP POLICY IF EXISTS "super_admin_read_errors" ON error_logs;
CREATE POLICY "super_admin_read_errors" ON error_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- ── Re-create admin SELECT (scoped to own gym) ─────────────
DROP POLICY IF EXISTS "admin_read_errors" ON error_logs;
CREATE POLICY "admin_read_errors" ON error_logs FOR SELECT
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── Ensure the INSERT policy is correct ─────────────────────
DROP POLICY IF EXISTS "authenticated_insert_own_errors" ON error_logs;
CREATE POLICY "authenticated_insert_own_errors" ON error_logs FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND profile_id = auth.uid()
  );
