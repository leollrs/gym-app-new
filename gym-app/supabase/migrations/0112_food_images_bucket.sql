-- Create public storage bucket for food/meal reference images
INSERT INTO storage.buckets (id, name, public)
VALUES ('food-images', 'food-images', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read food images (public reference images, no auth needed)
CREATE POLICY "food_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'food-images');

-- Only admin/super_admin can upload
CREATE POLICY "food_images_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'food-images'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('super_admin')
    )
  );

-- Only admin/super_admin can update
CREATE POLICY "food_images_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'food-images'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('super_admin')
    )
  )
  WITH CHECK (
    bucket_id = 'food-images'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('super_admin')
    )
  );

-- Only admin/super_admin can delete
CREATE POLICY "food_images_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'food-images'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('super_admin')
    )
  );
