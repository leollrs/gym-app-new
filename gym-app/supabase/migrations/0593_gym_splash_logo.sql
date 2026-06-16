-- 0593_gym_splash_logo.sql
-- Per-gym "launch logo" — a TRANSPARENT (backgroundless) logo shown ONLY on the
-- cold-launch splash animation. The gym's regular logo (gym-logos bucket) often
-- has a solid background that looks boxy on the dark splash; this lets the gym
-- upload a clean transparent mark just for the splash. Used by the code-default
-- animation when there's no splash video; falls back to the regular logo.
--
-- Mirrors 0581 (splash-videos): a PUBLIC bucket → STABLE public URL
-- (getPublicUrl) so the existing storage CacheFirst service-worker rule caches
-- it and LaunchSplash can read it directly on cold start (no signing round-trip).
-- Writes are scoped to the gym's own folder ({gym_id}/...) and gated to admins.
--
-- Safe to re-run.

ALTER TABLE public.gym_branding
  ADD COLUMN IF NOT EXISTS splash_logo_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('splash-logos', 'splash-logos', true, 2097152, ARRAY['image/png', 'image/webp', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Public read (resolved via getPublicUrl).
DROP POLICY IF EXISTS "splash_logos_public_read" ON storage.objects;
CREATE POLICY "splash_logos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'splash-logos');

-- Admins may write only into their OWN gym's folder (first path segment = gym_id).
DROP POLICY IF EXISTS "splash_logos_admin_insert" ON storage.objects;
CREATE POLICY "splash_logos_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'splash-logos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  );

DROP POLICY IF EXISTS "splash_logos_admin_update" ON storage.objects;
CREATE POLICY "splash_logos_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'splash-logos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  )
  WITH CHECK (
    bucket_id = 'splash-logos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "splash_logos_admin_delete" ON storage.objects;
CREATE POLICY "splash_logos_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'splash-logos'
    AND (storage.foldername(name))[1] = (SELECT p.gym_id::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  );
