-- Security fix: create missing storage buckets and enforce file_size_limit / allowed_mime_types on all buckets

-- ============================================================
-- 1. Create missing buckets
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('social-posts', 'social-posts', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('class-images', 'class-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('program-images', 'program-images', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Enforce file size limits and allowed MIME types
-- ============================================================

-- Image buckets: 5 MB, jpeg/png/webp only
UPDATE storage.buckets
SET file_size_limit   = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id IN (
  'avatars',
  'gym-logos',
  'social-posts',
  'class-images',
  'profile-photos',
  'program-images',
  'food-images',
  'progress_photos'
);

-- Video bucket: 100 MB, mp4/webm/quicktime
UPDATE storage.buckets
SET file_size_limit   = 104857600,
    allowed_mime_types = ARRAY['video/mp4','video/webm','video/quicktime']
WHERE id = 'exercise-videos';

-- ============================================================
-- 3. RLS policies for new buckets
--    DROP IF EXISTS first, so migration is re-runnable.
-- ============================================================

-- ---------- social-posts ----------
-- Authenticated users can upload
DROP POLICY IF EXISTS "social_posts_insert" ON storage.objects;
CREATE POLICY "social_posts_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'social-posts'
    AND auth.uid() IS NOT NULL
  );

-- Public read
DROP POLICY IF EXISTS "social_posts_select" ON storage.objects;
CREATE POLICY "social_posts_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'social-posts');

-- Owner can delete (objects stored under uid/ folder)
DROP POLICY IF EXISTS "social_posts_delete" ON storage.objects;
CREATE POLICY "social_posts_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'social-posts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- class-images ----------
-- Admin-only upload
DROP POLICY IF EXISTS "class_images_insert" ON storage.objects;
CREATE POLICY "class_images_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'class-images'
    AND public.is_admin()
  );

-- Public read
DROP POLICY IF EXISTS "class_images_select" ON storage.objects;
CREATE POLICY "class_images_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'class-images');

-- ---------- profile-photos ----------
-- Owner can upload to their own folder
DROP POLICY IF EXISTS "profile_photos_insert" ON storage.objects;
CREATE POLICY "profile_photos_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read
DROP POLICY IF EXISTS "profile_photos_select" ON storage.objects;
CREATE POLICY "profile_photos_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-photos');

-- ---------- program-images ----------
-- Admin-only upload
DROP POLICY IF EXISTS "program_images_insert" ON storage.objects;
CREATE POLICY "program_images_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'program-images'
    AND public.is_admin()
  );

-- Public read
DROP POLICY IF EXISTS "program_images_select" ON storage.objects;
CREATE POLICY "program_images_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'program-images');
