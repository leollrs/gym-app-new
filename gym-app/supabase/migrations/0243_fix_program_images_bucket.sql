-- ==========================================================================
-- 0243_fix_program_images_bucket.sql
-- Fix program template images returning 400 errors.
--
-- Issues:
--   1. The program-images bucket's allowed_mime_types did not include
--      image/avif, so .avif uploads were rejected with 400.
--      Templates strong-curves.avif, women_ppl.avif, strong-curves-adv.avif,
--      hourglass.avif, bikini-prep.avif all need AVIF support.
--   2. Ensure the bucket exists and is public (idempotent).
--   3. Ensure the public SELECT policy exists (idempotent).
--
-- After running this migration, upload the program template images to the
-- program-images bucket at the root level (e.g. starting-strength.jpg,
-- ppl.jpg, strong-curves.avif, etc.).
-- ==========================================================================

-- =========================================================
-- 1. Ensure bucket exists with correct settings
-- =========================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'program-images',
  'program-images',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp','image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/avif'];

-- =========================================================
-- 2. Ensure public SELECT policy exists (anyone can view)
-- =========================================================
DROP POLICY IF EXISTS "program_images_select" ON storage.objects;
CREATE POLICY "program_images_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'program-images');

-- =========================================================
-- 3. Ensure admin INSERT policy exists
-- =========================================================
DROP POLICY IF EXISTS "program_images_insert" ON storage.objects;
CREATE POLICY "program_images_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'program-images'
    AND public.is_admin()
  );

-- =========================================================
-- 4. Add admin UPDATE policy (for replacing images)
-- =========================================================
DROP POLICY IF EXISTS "program_images_update" ON storage.objects;
CREATE POLICY "program_images_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'program-images'
    AND public.is_admin()
  );

-- =========================================================
-- 5. Add admin DELETE policy
-- =========================================================
DROP POLICY IF EXISTS "program_images_delete" ON storage.objects;
CREATE POLICY "program_images_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'program-images'
    AND public.is_admin()
  );
