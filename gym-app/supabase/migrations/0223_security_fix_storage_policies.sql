-- ==========================================================================
-- 0223_security_fix_storage_policies.sql
-- Fix storage security issues:
--   1. social_posts INSERT — add folder scoping so users can only upload
--      to their own uid/ folder (prevents impersonation uploads).
--   2. profile-photos bucket — make private (was public = true).
--   3. Bucket name mismatch — client code references both 'progress_photos'
--      (underscore, original bucket from 0024) and 'progress-photos' (hyphen).
--      Create the hyphenated bucket with identical settings and RLS policies
--      so both names resolve correctly.
-- ==========================================================================

-- =========================================================
-- 1. social_posts INSERT — add folder scoping
--    Old policy only checked bucket_id + auth.uid() IS NOT NULL,
--    which let any authenticated user upload to any folder.
--    New policy requires the first folder segment = the user's uid.
-- =========================================================

DROP POLICY IF EXISTS "social_posts_insert" ON storage.objects;

CREATE POLICY "social_posts_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'social-posts'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================================================
-- 2. profile-photos — make bucket private
--    Profile photos should require authentication to view.
--    The SELECT policy already restricts to bucket_id only,
--    but with public = true Supabase serves files without
--    any policy check.  Setting public = false forces all
--    access through RLS (or signed URLs).
-- =========================================================

UPDATE storage.buckets
SET public = false
WHERE id = 'profile-photos';

-- Replace the open SELECT policy with an authenticated-only one.
-- Previously any anonymous request could read because the bucket
-- was public.  Now only authenticated users can read.

DROP POLICY IF EXISTS "profile_photos_select" ON storage.objects;

CREATE POLICY "profile_photos_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'profile-photos');

-- =========================================================
-- 3. Bucket name mismatch: progress_photos vs progress-photos
--    Migration 0024 created the bucket as 'progress_photos'.
--    Several client files (BodyMetrics.jsx, ProgressBody.jsx,
--    MonthlyProgressReport.jsx, PlatformSettings.jsx) reference
--    'progress-photos' for storage operations.
--
--    Fix: create the hyphenated bucket if it doesn't exist,
--    with the same settings (private, image-only, 5 MB limit),
--    and mirror the RLS policies from the underscore bucket.
--
--    NOTE: Both buckets will coexist.  Existing photos stored
--    under 'progress_photos' remain accessible.  New uploads
--    from client code that uses 'progress-photos' will land in
--    the new bucket.  A future cleanup migration should unify
--    client code to one name and drop the other bucket.
-- =========================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'progress-photos',
  'progress-photos',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Owner can upload to their own folder
DROP POLICY IF EXISTS "progress_photos_hyphen_owner_insert" ON storage.objects;
CREATE POLICY "progress_photos_hyphen_owner_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can view their own photos
DROP POLICY IF EXISTS "progress_photos_hyphen_owner_select" ON storage.objects;
CREATE POLICY "progress_photos_hyphen_owner_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can delete their own photos
DROP POLICY IF EXISTS "progress_photos_hyphen_owner_delete" ON storage.objects;
CREATE POLICY "progress_photos_hyphen_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
