-- ============================================================================
-- 0589 — super_admin can upload/replace ANY gym's logo            (audit: completeness-7)
-- ============================================================================
-- The gym-logos bucket policies (0024 / 0487) scope INSERT + UPDATE to the
-- caller's OWN gym_id, so the platform branding editor could only READ logos,
-- not upload one for another gym. Onboarding a gym end-to-end (which lives on
-- the platform side: Import + Diagnostic) needs the operator to set the logo.
-- Add cross-gym super_admin write policies (no folder scope — super_admin may
-- write any gym's folder). The per-gym admin policies are left intact.
-- ============================================================================

DROP POLICY IF EXISTS "gym_logos_super_admin_insert" ON storage.objects;
CREATE POLICY "gym_logos_super_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gym-logos' AND public.is_super_admin());

DROP POLICY IF EXISTS "gym_logos_super_admin_update" ON storage.objects;
CREATE POLICY "gym_logos_super_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'gym-logos' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'gym-logos' AND public.is_super_admin());

NOTIFY pgrst, 'reload schema';
