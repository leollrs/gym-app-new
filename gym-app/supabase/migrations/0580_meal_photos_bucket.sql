-- 0580_meal_photos_bucket.sql
-- A user-writable bucket for custom-meal photos (food-images is super-admin
-- only). Trainers + members can upload a photo for a meal they create; anyone
-- can read (public reference image). Uploads are scoped to the user's own
-- folder ({uid}/...). Also stores the resulting URL on custom_meals.
--
-- Safe to re-run.

INSERT INTO storage.buckets (id, name, public)
VALUES ('meal-photos', 'meal-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (resolved via getPublicUrl).
DROP POLICY IF EXISTS "meal_photos_public_read" ON storage.objects;
CREATE POLICY "meal_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'meal-photos');

-- Authenticated users may upload into their OWN folder (first path segment = uid).
DROP POLICY IF EXISTS "meal_photos_owner_insert" ON storage.objects;
CREATE POLICY "meal_photos_owner_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'meal-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "meal_photos_owner_update" ON storage.objects;
CREATE POLICY "meal_photos_owner_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'meal-photos' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'meal-photos' AND owner = auth.uid());

DROP POLICY IF EXISTS "meal_photos_owner_delete" ON storage.objects;
CREATE POLICY "meal_photos_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'meal-photos' AND owner = auth.uid());

-- Store the uploaded photo URL on the custom meal.
ALTER TABLE public.custom_meals
  ADD COLUMN IF NOT EXISTS image_url TEXT;
