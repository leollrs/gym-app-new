-- Fix: restrict gym-logos bucket listing to prevent anonymous enumeration of gym UUIDs
-- The original "gym_logos_public_read" policy (migration 0024) allows anyone — including
-- anonymous/unauthenticated users — to SELECT on storage.objects for gym-logos.
-- In Supabase Storage, a SELECT policy controls both individual file reads AND bucket
-- listing. This means anonymous users can list the bucket contents and discover gym UUIDs.
--
-- Solution:
--   1. Drop the overly permissive public read policy.
--   2. Make the bucket NOT public (disables unauthenticated direct URL access).
--   3. Add an authenticated-only SELECT policy so logged-in users can still read logos.
--      Logos are scoped to the user's own gym via the folder path matching their gym_id.
--   4. Keep the existing admin upload + update policies (from 0024) untouched.

-- Step 1: Drop the overly permissive public read policy
DROP POLICY IF EXISTS "gym_logos_public_read" ON storage.objects;

-- Step 2: Make the bucket private so unauthenticated direct-URL access is blocked.
-- Authenticated reads will still work via Supabase client (which attaches the JWT).
UPDATE storage.buckets
SET public = false
WHERE id = 'gym-logos';

-- Step 3: Authenticated users can read (download) logos belonging to their own gym.
-- The folder structure is: gym-logos/{gym_id}/logo.png
CREATE POLICY "gym_logos_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'gym-logos'
    AND (storage.foldername(name))[1] = (
      SELECT gym_id::text FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

-- Step 4: Allow admin/super_admin to delete logos for their own gym
CREATE POLICY "gym_logos_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'gym-logos'
    AND (storage.foldername(name))[1] = (
      SELECT gym_id::text FROM profiles WHERE id = auth.uid() LIMIT 1
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );
