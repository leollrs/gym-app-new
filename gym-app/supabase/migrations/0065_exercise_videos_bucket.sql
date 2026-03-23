-- Create exercise-videos storage bucket (private — access via signed URLs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('exercise-videos', 'exercise-videos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Super admins can upload videos
CREATE POLICY "exercise_videos_super_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'exercise-videos'
    AND public.is_super_admin()
  );

-- Super admins can update/replace videos
CREATE POLICY "exercise_videos_super_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'exercise-videos'
    AND public.is_super_admin()
  );

-- Super admins can delete videos
CREATE POLICY "exercise_videos_super_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'exercise-videos'
    AND public.is_super_admin()
  );

-- All authenticated users can read exercise videos (required for createSignedUrl)
CREATE POLICY "exercise_videos_authenticated_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'exercise-videos');
