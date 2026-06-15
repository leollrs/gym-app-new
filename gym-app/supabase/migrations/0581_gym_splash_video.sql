-- 0581_gym_splash_video.sql
-- Per-gym custom launch (splash) video. The gym admin uploads a short branded
-- intro clip; the app plays it on cold launch with the code-default animation
-- as the fallback (missing / slow to load / decode error → default).
--
-- Public bucket → STABLE public URL (getPublicUrl) so the existing storage
-- CacheFirst service-worker rule caches it after the first fetch → instant on
-- subsequent launches. Writes are scoped to the gym's own folder ({gym_id}/...)
-- and gated to admins of that gym (mirrors the gym-logos isolation policy).
--
-- Safe to re-run.

ALTER TABLE public.gym_branding
  ADD COLUMN IF NOT EXISTS splash_video_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('splash-videos', 'splash-videos', true, 8388608, ARRAY['video/mp4', 'video/webm', 'video/quicktime'])
ON CONFLICT (id) DO NOTHING;

-- Public read (resolved via getPublicUrl).
DROP POLICY IF EXISTS "splash_videos_public_read" ON storage.objects;
CREATE POLICY "splash_videos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'splash-videos');

-- Admins may write only into their OWN gym's folder (first path segment = gym_id).
DROP POLICY IF EXISTS "splash_videos_admin_insert" ON storage.objects;
CREATE POLICY "splash_videos_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'splash-videos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  );

DROP POLICY IF EXISTS "splash_videos_admin_update" ON storage.objects;
CREATE POLICY "splash_videos_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'splash-videos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  )
  WITH CHECK (
    bucket_id = 'splash-videos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "splash_videos_admin_delete" ON storage.objects;
CREATE POLICY "splash_videos_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'splash-videos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  );
