-- =============================================================
-- UGC moderation: block-user RLS hardening (App Store 1.2 / Play UGC)
-- Migration: 0312_user_blocks_rls.sql
--
-- The `blocked_users` table already exists (migration 0272). It has the
-- correct shape (blocker_id, blocked_id, unique + check, RLS for owner).
-- This migration adds:
--   1. A `public.is_blocked(p_viewer, p_target)` helper that checks
--      the relationship in BOTH directions (mutual hide).
--   2. Targeted RLS hardening on direct_messages, friendships, and
--      feed_comments so a blocker cannot receive new messages, get
--      friend requests, or see fresh comments from a blocked user
--      (and vice-versa).
--
-- Choice rationale: we update the EXISTING RLS policies rather than
-- introduce filtered views. Two reasons:
--   - The feed already filters client-side via `blocked_users`, plus
--     `get_friend_feed` is `SECURITY DEFINER` and we'd lose RLS leverage
--     anyway — server-side hide of the feed is handled in the next
--     migration via `hidden_posts`.
--   - DM / friendship are write-paths where RLS is the right place to
--     stop a blocked user from creating new rows targeted at the
--     blocker. Touching ~3 policies is fewer changes than wrapping each
--     table in a new view + retraining all clients.
-- =============================================================

-- ── Helper: bidirectional block check ───────────────────────────
CREATE OR REPLACE FUNCTION public.is_blocked(p_viewer UUID, p_target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = p_viewer AND blocked_id = p_target)
       OR (blocker_id = p_target AND blocked_id = p_viewer)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_blocked(UUID, UUID) TO authenticated;

-- ── direct_messages: prevent sending to/from a blocked user ────
DROP POLICY IF EXISTS "messages_insert" ON direct_messages;
CREATE POLICY "messages_insert" ON direct_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND public.is_blocked(
          auth.uid(),
          CASE WHEN c.participant_1 = auth.uid() THEN c.participant_2 ELSE c.participant_1 END
        )
    )
  );

-- ── friendships: prevent sending requests to a blocked user
-- (also prevents a blocked user requesting back) ────────────────
DROP POLICY IF EXISTS "friendships_insert" ON friendships;
CREATE POLICY "friendships_insert" ON friendships FOR INSERT
  WITH CHECK (
    requester_id = auth.uid()
    AND NOT public.is_blocked(auth.uid(), addressee_id)
  );

-- ── feed_comments: prevent commenting on posts authored by someone
-- you blocked, and prevent blocked users from commenting on yours.
-- Mirrors the "no interaction either direction" contract. ───────
DROP POLICY IF EXISTS "feed_comments_insert" ON feed_comments;
CREATE POLICY "feed_comments_insert" ON feed_comments
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM activity_feed_items f
      WHERE f.id = feed_item_id
        AND f.gym_id = public.current_gym_id()
        AND NOT public.is_blocked(auth.uid(), f.actor_id)
    )
  );
