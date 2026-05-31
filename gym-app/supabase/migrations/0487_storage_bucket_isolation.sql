-- 0487_storage_bucket_isolation.sql
--
-- Storage audit (2026-05-30). The sensitive buckets (progress-photos,
-- body-analysis-photos, member-checkin-photos) were already private + properly
-- scoped. This migration fixes three issues on the rest:
--
-- 🟠 F1  social-posts was a PUBLIC bucket holding member-generated content,
--        readable by anyone on the internet (no auth) and across gyms. The app
--        already reads it via createSignedUrl (SocialFeed.jsx) and stores the
--        path (not a public URL) in the DB, so it does NOT need to be public.
--        -> flip to private. Reads keep working; the public flag doesn't affect
--        the INSERT RLS so uploads are unchanged.
--
-- 🟢 F2  avatars + profile-photos are low-sensitivity 256px, EXIF-stripped
--        avatar thumbnails rendered all over the app (feed, leaderboard, lists)
--        for many users. They were private but the frontend reads them via
--        getPublicUrl -> the URLs 403'd and photo avatars silently didn't
--        render. Decision (pragmatic, industry-standard for avatars): make these
--        two buckets PUBLIC so getPublicUrl works. Public buckets allow direct
--        object GET by exact URL but do NOT allow anon directory listing, and
--        write access stays gated by the existing owner/admin INSERT policies.
--
-- 🟡 F3  gym_logos_admin_update lacked the foldername=gym_id scope that the
--        upload and delete policies both have -> an admin of gym A could
--        overwrite (deface) gym B's logo. -> add the same gym-scope to UPDATE
--        (both USING and WITH CHECK so a logo can't be moved into another gym).
--
-- All changes are on storage (buckets/objects) only. No app deploy required.

-- ── F1: social-posts → private ─────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'social-posts';

-- ── F2: avatars + profile-photos → public (fixes getPublicUrl display) ──────
UPDATE storage.buckets SET public = true  WHERE id IN ('avatars', 'profile-photos');

-- ── F3: add gym-scope to gym_logos UPDATE ──────────────────────────────────
DROP POLICY IF EXISTS "gym_logos_admin_update" ON storage.objects;
CREATE POLICY "gym_logos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'gym-logos'
    AND (storage.foldername(name))[1] = (
      SELECT (p.gym_id)::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  )
  WITH CHECK (
    bucket_id = 'gym-logos'
    AND (storage.foldername(name))[1] = (
      SELECT (p.gym_id)::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])
    )
  );

-- ── VERIFY after applying ──────────────────────────────────────────────────
-- 1. Bucket visibility flipped:
--    SELECT id, public FROM storage.buckets
--    WHERE id IN ('social-posts','avatars','profile-photos') ORDER BY id;
--    -- expect: avatars=t, profile-photos=t, social-posts=f
-- 2. gym_logos UPDATE now gym-scoped:
--    SELECT policyname, qual FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects'
--      AND policyname='gym_logos_admin_update';
-- 3. Smoke: a member's photo avatar now renders in feed/leaderboard; social
--    feed still shows existing post images (signed URLs); a gym admin can still
--    update their own gym logo.
