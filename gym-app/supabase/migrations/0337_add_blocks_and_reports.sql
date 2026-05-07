-- ============================================================
-- 20260429000001 — UGC moderation: extend content_reports + blocks
-- ============================================================
-- Apple Guideline 1.2 / Google Play UGC compliance.
--
-- Existing tables (kept and extended):
--   - public.content_reports  (created in 0038, extended in 0134/0156/0210)
--   - public.blocked_users    (created in 0272)
--
-- This migration EXTENDS them — it does NOT recreate or drop them —
-- so the AdminModeration UI keeps working unchanged. We only:
--   1) widen the allowed `reason` enum (Apple's required reasons set),
--   2) widen `content_type` to allow 'message' and 'profile',
--   3) make `feed_item_id` nullable (it isn't a valid FK for messages),
--   4) ensure `details` text exists for free-form reporter comments,
--   5) add a self-block guard on blocked_users + helper RPC.
-- ============================================================

-- 1) Widen allowed reasons. Existing rows with 'inappropriate' / 'spam' /
--    'harassment' / 'other' remain valid. New keys map cleanly to Apple's
--    required categories.
ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reason_check;

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reason_check
  CHECK (reason IN (
    'spam',
    'inappropriate',
    'harassment',
    'hate_speech',
    'nudity',
    'violence',
    'dangerous',
    'other'
  ));

-- 2) Widen allowed content types so messages and profiles can be reported.
ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_content_type_check;

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('activity', 'comment', 'message', 'profile'));

-- 3) feed_item_id is required by the original schema but doesn't apply to
--    DMs / profiles / comments. Drop the NOT NULL so non-activity reports
--    can be inserted. (content_id is the canonical pointer per migration 0134.)
ALTER TABLE public.content_reports
  ALTER COLUMN feed_item_id DROP NOT NULL;

-- 4) Free-form reporter details (already added in 0134, but be defensive).
ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS details TEXT;

-- 5) blocked_users: defensive guards. The CHECK + UNIQUE in 0272 already
--    prevent self-blocks and duplicates; nothing else needed schema-wise.
--    Add an index on (blocked_id, blocker_id) for the "is X blocked by me"
--    fast path used by the client helper.
CREATE INDEX IF NOT EXISTS idx_blocked_users_pair
  ON public.blocked_users(blocker_id, blocked_id);

-- 6) RPC: bulk fetch the caller's blocked-user ids (used by SocialFeed +
--    Messages to filter the query at the data layer).
CREATE OR REPLACE FUNCTION public.get_my_blocked_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT blocked_id
  FROM public.blocked_users
  WHERE blocker_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_blocked_user_ids() TO authenticated;
