-- ============================================================
-- 0375 — Force class-images bucket public + ensure SELECT policy
-- ============================================================
-- The admin Classes page renders <img> directly off
-- supabase.storage.from('class-images').getPublicUrl(image_path).
-- That URL only resolves if the bucket has `public = true`.
--
-- Migration 0207 *intended* to make the bucket public but used
-- `INSERT ... ON CONFLICT (id) DO NOTHING`, which silently skipped
-- the update when the row already existed (the bucket was created
-- ad-hoc earlier in the project's history with public = false).
-- The result: every signed/public URL request returns 400.
--
-- Fix: idempotently flip the bucket public, normalize the size limit
-- + allowed MIME types, and re-assert the public-read SELECT policy
-- in case 0359/0360-era audits dropped it.
-- ============================================================

UPDATE storage.buckets
   SET public = TRUE,
       file_size_limit = COALESCE(file_size_limit, 5242880),
       allowed_mime_types = COALESCE(allowed_mime_types, ARRAY['image/jpeg','image/png','image/webp'])
 WHERE id = 'class-images';

-- Ensure the bucket exists at all — defensive for fresh projects that
-- somehow never ran 0207.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('class-images', 'class-images', TRUE, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Re-assert public SELECT policy (idempotent — drops first if present).
DROP POLICY IF EXISTS "class_images_select" ON storage.objects;
CREATE POLICY "class_images_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'class-images');

-- Re-assert admin INSERT policy in case it was dropped.
DROP POLICY IF EXISTS "class_images_insert" ON storage.objects;
CREATE POLICY "class_images_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'class-images'
    AND public.is_admin()
  );

-- Admins can also UPDATE (replace upload) and DELETE their gym's class images.
-- This was missing — uploads with upsert = true would fail and re-uploaded
-- images couldn't replace the existing object.
DROP POLICY IF EXISTS "class_images_update" ON storage.objects;
CREATE POLICY "class_images_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'class-images' AND public.is_admin());

DROP POLICY IF EXISTS "class_images_delete" ON storage.objects;
CREATE POLICY "class_images_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'class-images' AND public.is_admin());
