-- ============================================================
-- 20260429000002 — Storage RLS hardening + server-side UGC block enforcement
-- ============================================================
-- Companion to 20260429000001 (UGC moderation tables/extensions).
-- This migration is fully idempotent and safe to re-run.
--
-- WHAT THIS DOES:
--
-- A. Storage hardening
--    1. avatars bucket -> private; folder-scoped INSERT/DELETE per uid;
--       SELECT remains broad-but-authenticated so the friend feed can
--       still render avatars without N x signed-URL round-trips.
--    2. social-posts bucket SELECT -> require authenticated role
--       (was open to anon since 0207). Folder-scoped INSERT already
--       fixed in 0223; we leave it intact.
--    3. body-analysis-photos bucket -> created (referenced by
--       0336_harden_delete_user_account.sql but never previously
--       provisioned). Private, 5 MB cap, owner-folder scoped.
--
-- B. Re-engagement push opt-in
--    4. profiles.notif_reengagement BOOLEAN DEFAULT false (Apple 4.5.4).
--
-- C. Block enforcement (server-side, not just client-side filtering)
--    5. get_or_create_conversation: refuse if either user has blocked
--       the other.
--    6. get_friend_feed / get_friend_streaks: filter out blocked actors.
--    7. direct_messages INSERT: block-aware via SECURITY DEFINER helper
--       _user_blocked_in_conversation(conv_id, sender) so the inline
--       expression stays cheap and readable.
--    8. friendships INSERT: refuse new requests when either side has
--       blocked the other.
--
-- WHY ONE MIGRATION:
--    These changes interlock — turning on block enforcement at the RPC
--    layer without also fixing the storage policies still leaks PII
--    (avatars, posts) for blocked users. Shipping them together keeps
--    behavior consistent across query paths.
-- ============================================================


-- =========================================================
-- 1. avatars bucket: lock down (was public = true since 0024)
-- =========================================================

UPDATE storage.buckets
SET public = false
WHERE id = 'avatars';

-- Drop the legacy open policies (idempotent).
DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_upload"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_authenticated_select" ON storage.objects;

-- INSERT: only into your own uid-prefixed folder.
CREATE POLICY "avatars_owner_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: only your own folder (clients overwrite on re-upload).
CREATE POLICY "avatars_owner_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: only your own folder.
CREATE POLICY "avatars_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: any authenticated user can fetch any avatar.
-- Rationale: friend feed, leaderboards, profile previews, DMs all
-- render avatars across users. Tightening to friend-only would
-- explode query cost and break anonymous-but-in-gym contexts
-- (challenges, leaderboards). Authenticated-only is the right
-- balance: blocks all anon reads (the actual leak risk).
CREATE POLICY "avatars_authenticated_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');


-- =========================================================
-- 2. social-posts bucket: tighten SELECT to authenticated
--    Was `USING (bucket_id = 'social-posts')` with no role check
--    (created in 0207). Folder-scoped INSERT from 0223 stays.
-- =========================================================

DROP POLICY IF EXISTS "social_posts_select" ON storage.objects;

CREATE POLICY "social_posts_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'social-posts');


-- =========================================================
-- 3. body-analysis-photos bucket: provision (was missing)
--    Referenced by 0336_harden_delete_user_account.sql cleanup but
--    never created. Private, 5 MB cap, image-only, owner-folder scoped.
-- =========================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'body-analysis-photos',
  'body-analysis-photos',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS "body_analysis_photos_owner_insert" ON storage.objects;
CREATE POLICY "body_analysis_photos_owner_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'body-analysis-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "body_analysis_photos_owner_select" ON storage.objects;
CREATE POLICY "body_analysis_photos_owner_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'body-analysis-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "body_analysis_photos_owner_delete" ON storage.objects;
CREATE POLICY "body_analysis_photos_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'body-analysis-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- =========================================================
-- 4. profiles.notif_reengagement (Apple 4.5.4 compliance)
--    Re-engagement / win-back / "we miss you" pushes require
--    explicit user opt-in. Default false; user toggles on in
--    settings. Edge functions (compute-churn-scores etc.) gate
--    on this flag before sending re-engagement push.
-- =========================================================

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS notif_reengagement BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE '[20260429000002] profiles table missing — skipping notif_reengagement';
END;
$$;

COMMENT ON COLUMN public.profiles.notif_reengagement IS
  'User opt-in for re-engagement / win-back push notifications. '
  'Default false per Apple Guideline 4.5.4 — re-engagement pushes '
  'require affirmative consent. Edge functions must check this flag.';


-- =========================================================
-- 5. get_or_create_conversation: block guard at top
--    Preserves all existing behavior from 0206 (gym scoping,
--    existing-conversation lookup, insert).
-- =========================================================

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid       UUID;
  my_gym    UUID;
  v_conv_id UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- BLOCK GUARD: refuse if either party has blocked the other.
  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = p_other_user AND blocked_id = uid)
       OR (blocker_id = uid          AND blocked_id = p_other_user)
  ) THEN
    RAISE EXCEPTION 'Cannot start conversation: user is blocked';
  END IF;

  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  -- Verify target user is in the same gym (preserved from 0206).
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_other_user AND gym_id = my_gym
  ) THEN
    RAISE EXCEPTION 'Cannot message users outside your gym';
  END IF;

  -- Check existing (either direction).
  SELECT id INTO v_conv_id FROM conversations
  WHERE (participant_1 = uid AND participant_2 = p_other_user)
     OR (participant_1 = p_other_user AND participant_2 = uid)
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN RETURN v_conv_id; END IF;

  -- Create new.
  INSERT INTO conversations (gym_id, participant_1, participant_2)
  VALUES (my_gym, uid, p_other_user)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID) TO authenticated;


-- =========================================================
-- 6. get_friend_feed: filter blocked actors
--    Re-creates the function from 0135 (avatar-aware version),
--    adding a NOT EXISTS clause against blocked_users. Owner items
--    are always included regardless (you can't block yourself).
-- =========================================================

CREATE OR REPLACE FUNCTION public.get_friend_feed(
  p_limit  INT         DEFAULT 30,
  p_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid    UUID;
  my_gym UUID;
  result JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;
  IF my_gym IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      afi.id,
      afi.gym_id,
      afi.actor_id,
      afi.type,
      afi.data,
      afi.is_public,
      afi.created_at,
      json_build_object(
        'full_name',    p.full_name,
        'username',     p.username,
        'avatar_url',   p.avatar_url,
        'avatar_type',  p.avatar_type,
        'avatar_value', p.avatar_value
      ) AS profiles
    FROM activity_feed_items afi
    JOIN profiles p ON p.id = afi.actor_id
    LEFT JOIN friendships f
      ON (
        (f.requester_id = uid AND f.addressee_id = afi.actor_id)
        OR
        (f.addressee_id = uid AND f.requester_id = afi.actor_id)
      )
      AND f.status = 'accepted'
    WHERE afi.gym_id = my_gym
      AND (
        afi.actor_id = uid
        OR f.id IS NOT NULL
      )
      AND (p_cursor IS NULL OR afi.created_at < p_cursor)
      -- BLOCK FILTER: hide items from anyone the caller blocked
      -- AND from anyone who blocked the caller.
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE (b.blocker_id = uid          AND b.blocked_id = afi.actor_id)
           OR (b.blocker_id = afi.actor_id AND b.blocked_id = uid)
      )
    ORDER BY afi.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_feed(INT, TIMESTAMPTZ) TO authenticated;


-- =========================================================
-- 6b. get_friend_streaks: filter blocked friends
-- =========================================================

CREATE OR REPLACE FUNCTION public.get_friend_streaks()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid    UUID;
  result JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      p.id,
      p.full_name  AS name,
      p.avatar_url,
      p.avatar_type,
      p.avatar_value,
      sc.current_streak_days AS streak
    FROM friendships f
    JOIN profiles p
      ON p.id = CASE
        WHEN f.requester_id = uid THEN f.addressee_id
        ELSE f.requester_id
      END
    JOIN streak_cache sc ON sc.profile_id = p.id
    WHERE (f.requester_id = uid OR f.addressee_id = uid)
      AND f.status = 'accepted'
      AND sc.current_streak_days > 0
      -- BLOCK FILTER: hide blocked friends from streaks rail.
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE (b.blocker_id = uid  AND b.blocked_id = p.id)
           OR (b.blocker_id = p.id AND b.blocked_id = uid)
      )
    ORDER BY sc.current_streak_days DESC
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_streaks() TO authenticated;

-- NOTE on get_feed_enrichment: that RPC takes an array of feed_item_ids
-- and returns reaction/comment counts. Since the upstream get_friend_feed
-- now filters out blocked actors, the IDs passed in will already exclude
-- blocked content — no change needed there.


-- =========================================================
-- 7. direct_messages INSERT: block-aware
--    Existing policy (from 0222) checks sender == auth.uid() and
--    that the conversation is in the caller's gym. We extend it
--    to also block sends when EITHER participant has blocked the other.
--
--    Helper SECURITY DEFINER function keeps the policy expression
--    clean and lets us reuse the check elsewhere if needed.
-- =========================================================

CREATE OR REPLACE FUNCTION public._user_blocked_in_conversation(
  _conv_id UUID,
  _sender  UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- True if any blocking relationship exists between the sender and
  -- the OTHER participant of the conversation.
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.blocked_users b
      ON (
           (b.blocker_id = c.participant_1 AND b.blocked_id = c.participant_2)
        OR (b.blocker_id = c.participant_2 AND b.blocked_id = c.participant_1)
      )
    WHERE c.id = _conv_id
      AND (_sender = c.participant_1 OR _sender = c.participant_2)
  );
$$;

GRANT EXECUTE ON FUNCTION public._user_blocked_in_conversation(UUID, UUID) TO authenticated;

-- Re-create the INSERT policy with the block check appended to WITH CHECK.
DROP POLICY IF EXISTS "messages_insert" ON public.direct_messages;

CREATE POLICY "messages_insert" ON public.direct_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND conversation_id IN (
      SELECT id FROM public.conversations
      WHERE (participant_1 = auth.uid() OR participant_2 = auth.uid())
        AND gym_id = public.current_gym_id()
    )
    AND NOT public._user_blocked_in_conversation(conversation_id, auth.uid())
  );


-- =========================================================
-- 8. friendships INSERT: block-aware
--    Existing policy (from 0028 / 0009) requires gym match and
--    requester_id = auth.uid(). We extend it to refuse the request
--    if either party has blocked the other.
-- =========================================================

DROP POLICY IF EXISTS "friendships_insert" ON public.friendships;

CREATE POLICY "friendships_insert" ON public.friendships
  FOR INSERT WITH CHECK (
    gym_id = public.current_gym_id()
    AND requester_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id = requester_id AND b.blocked_id = addressee_id)
         OR (b.blocker_id = addressee_id AND b.blocked_id = requester_id)
    )
  );


-- =========================================================
-- 9. Force PostgREST to reload its schema cache so the new RPC
--    signatures and policies are picked up immediately.
-- =========================================================

NOTIFY pgrst, 'reload schema';
