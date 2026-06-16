-- 0599_social_posts_select_gym_scope.sql
--
-- SECURITY FIX (cross-tenant exposure of social-feed photos).
--
-- The `social-posts` bucket is PRIVATE (public = false, served via signed URLs),
-- but its SELECT policy was `USING (bucket_id = 'social-posts')` with no
-- per-user scope. That let ANY authenticated user create a signed URL for — or
-- enumerate — EVERY member's social-feed photo across ALL gyms, defeating the
-- per-gym isolation the rest of the app enforces.
--
-- Upload path scheme is `{poster_uid}/{timestamp}.jpg` (see SocialFeed.jsx and
-- the `social_posts_insert` policy: foldername[1] = auth.uid()). So we can scope
-- read/sign access to exactly who is allowed to see a poster's feed content:
--   1. the owner (own photos), OR
--   2. a member of the SAME gym as the poster, OR
--   3. an accepted friend of the poster.
-- This matches what get_friend_feed already surfaces, so the feed keeps working.
--
-- Super-admin cross-gym moderation uses the service role (bypasses RLS), so it
-- is unaffected.
--
-- ⚠️ APPLY TO STAGING FIRST and verify: (a) your own post photos load, (b) a
-- friend's post photo loads, (c) a same-gym non-friend's post photo loads,
-- (d) a different-gym user's post photo does NOT load. Then apply to prod.
--
-- Safe to re-run.

DROP POLICY IF EXISTS "social_posts_select" ON storage.objects;

CREATE POLICY "social_posts_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'social-posts'
    AND (
      -- 1. Owner: the first path segment is the requester's own uid
      (storage.foldername(name))[1] = auth.uid()::text

      -- 2. Same gym as the poster
      OR EXISTS (
        SELECT 1
        FROM public.profiles me
        JOIN public.profiles them
          ON them.id::text = (storage.foldername(name))[1]
        WHERE me.id = auth.uid()
          AND me.gym_id IS NOT NULL
          AND me.gym_id = them.gym_id
      )

      -- 3. Accepted friend of the poster (either direction)
      OR EXISTS (
        SELECT 1
        FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.requester_id = auth.uid()
              AND f.addressee_id::text = (storage.foldername(name))[1])
            OR
            (f.addressee_id = auth.uid()
              AND f.requester_id::text = (storage.foldername(name))[1])
          )
      )
    )
  );

-- VERIFY after applying:
--   SELECT policyname, qual
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname = 'social_posts_select';
