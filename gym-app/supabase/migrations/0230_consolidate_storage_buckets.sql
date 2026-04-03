-- ==========================================================================
-- 0230_consolidate_storage_buckets.sql
-- Consolidate dual storage bucket names: progress_photos vs progress-photos
--
-- History:
--   - Migration 0024 created bucket 'progress_photos' (underscore) with RLS.
--   - Frontend code evolved to use 'progress-photos' (hyphen) for all
--     storage operations (upload, createSignedUrl, remove).
--   - Migration 0223 noticed the mismatch and created a second bucket
--     'progress-photos' with mirrored RLS policies, leaving both active.
--   - This left data split across two buckets with unclear coverage.
--
-- Resolution:
--   - Canonical bucket: 'progress-photos' (hyphen) — matches all frontend
--     storage calls in BodyMetrics.jsx, ProgressBody.jsx,
--     MonthlyProgressReport.jsx, TrainerClientDetail.jsx, and the
--     STORAGE_BUCKETS list in PlatformSettings.jsx.
--   - The 'progress_photos' underscore bucket is the old/unused one.
--   - NOTE: The database TABLE is still named 'progress_photos' (underscore)
--     which is correct — table names use underscores per Postgres convention
--     and are unrelated to storage bucket names.
--
-- This migration:
--   1. Ensures 'progress-photos' bucket has the best settings and policies.
--   2. Copies any missing policies from the underscore bucket.
--   3. Drops the underscore bucket ONLY if it has no objects remaining.
--   4. Cleans up orphaned RLS policies that reference the old bucket.
-- ==========================================================================

-- =========================================================
-- 1. Ensure canonical bucket 'progress-photos' has proper settings
--    (file_size_limit, allowed_mime_types, private).
--    Migration 0223 already created it, but be safe.
-- =========================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'progress-photos',
  'progress-photos',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

-- =========================================================
-- 2. Ensure RLS policies on 'progress-photos' are complete.
--    Re-create all three owner policies (idempotent via DROP IF EXISTS).
--    These mirror the original 0024 policies for 'progress_photos'.
-- =========================================================

-- Owner INSERT
DROP POLICY IF EXISTS "progress_photos_hyphen_owner_insert" ON storage.objects;
CREATE POLICY "progress_photos_hyphen_owner_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner SELECT
DROP POLICY IF EXISTS "progress_photos_hyphen_owner_select" ON storage.objects;
CREATE POLICY "progress_photos_hyphen_owner_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner DELETE
DROP POLICY IF EXISTS "progress_photos_hyphen_owner_delete" ON storage.objects;
CREATE POLICY "progress_photos_hyphen_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================================================
-- 3. Drop orphaned RLS policies that reference the old
--    'progress_photos' (underscore) bucket on storage.objects.
--    These policies are useless once the bucket is removed
--    and would be confusing if left behind.
-- =========================================================

DROP POLICY IF EXISTS "progress_photos_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "progress_photos_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "progress_photos_owner_delete" ON storage.objects;

-- =========================================================
-- 4. Safely drop the old 'progress_photos' (underscore) bucket.
--    Only delete the bucket row if NO objects remain in it.
--    If objects exist, the DELETE is a no-op and a NOTICE is raised
--    so the operator knows manual data migration is needed.
-- =========================================================

DO $$
DECLARE
  _obj_count integer;
BEGIN
  -- Check if the old bucket even exists
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'progress_photos') THEN
    RAISE NOTICE '[0230] Bucket "progress_photos" does not exist — nothing to drop.';
    RETURN;
  END IF;

  SELECT count(*) INTO _obj_count
  FROM storage.objects
  WHERE bucket_id = 'progress_photos';

  IF _obj_count = 0 THEN
    DELETE FROM storage.buckets WHERE id = 'progress_photos';
    RAISE NOTICE '[0230] Dropped empty bucket "progress_photos" — consolidated to "progress-photos".';
  ELSE
    -- !! MANUAL ACTION REQUIRED !!
    -- Objects exist in the old bucket.  They must be migrated to
    -- 'progress-photos' before the old bucket can be removed.
    -- Steps:
    --   1. For each object in storage.objects WHERE bucket_id = 'progress_photos':
    --      a. Download the file via supabase.storage.from('progress_photos').download(name)
    --      b. Upload to supabase.storage.from('progress-photos').upload(name, file)
    --      c. Verify the progress_photos DB table row already points to the
    --         same storage_path (it should — paths are relative to the bucket).
    --   2. After migration, run:
    --      DELETE FROM storage.objects WHERE bucket_id = 'progress_photos';
    --      DELETE FROM storage.buckets WHERE id = 'progress_photos';
    RAISE WARNING '[0230] Bucket "progress_photos" still contains % object(s). '
                  'Manual data migration to "progress-photos" is required before '
                  'this bucket can be dropped. See migration comments for steps.',
                  _obj_count;
  END IF;
END;
$$;
