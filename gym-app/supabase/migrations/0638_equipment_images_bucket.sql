-- ==========================================================================
-- 0638_equipment_images_bucket.sql
-- Dedicated public bucket for equipment-station photos (Equipment page tiles).
--
-- Previously the Equipment page pointed at food-images/equipment/<slug>.jpg,
-- which mixed equipment photos into the food/meal bucket and 400'd because
-- nothing was uploaded there. Equipment now resolves via equipmentImageUrl()
-- against this dedicated bucket (src/lib/imageUrl.js), mirroring program-images.
--
-- After running this migration, upload the station photos to the
-- `equipment-images` bucket at the ROOT level, named `<slug>.jpg`, e.g.
-- treadmill.jpg, dumbbell-area.jpg, smith-machine.jpg, captains-chair.jpg,
-- hip-abduction-adduction.jpg, cable-station.jpg, … (slugs from data/equipmentStations.js).
-- Until a photo exists, the tile gracefully falls back to a representative
-- exercise's video first-frame.
-- ==========================================================================

-- =========================================================
-- 1. Ensure bucket exists with correct settings (idempotent)
-- =========================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'equipment-images',
  'equipment-images',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp','image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/avif'];

-- =========================================================
-- 2. Public SELECT policy (anyone can view — reference images, no auth)
-- =========================================================
DROP POLICY IF EXISTS "equipment_images_select" ON storage.objects;
CREATE POLICY "equipment_images_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'equipment-images');

-- =========================================================
-- 3. Admin INSERT policy
-- =========================================================
DROP POLICY IF EXISTS "equipment_images_insert" ON storage.objects;
CREATE POLICY "equipment_images_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'equipment-images'
    AND public.is_admin()
  );

-- =========================================================
-- 4. Admin UPDATE policy (for replacing images)
-- =========================================================
DROP POLICY IF EXISTS "equipment_images_update" ON storage.objects;
CREATE POLICY "equipment_images_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'equipment-images'
    AND public.is_admin()
  );

-- =========================================================
-- 5. Admin DELETE policy
-- =========================================================
DROP POLICY IF EXISTS "equipment_images_delete" ON storage.objects;
CREATE POLICY "equipment_images_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'equipment-images'
    AND public.is_admin()
  );
