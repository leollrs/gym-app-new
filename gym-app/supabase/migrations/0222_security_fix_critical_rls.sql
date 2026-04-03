-- ============================================================
-- 0222 — Critical RLS policy fixes: gym boundaries, anon leaks,
--        function search_path hardening
-- ============================================================

-- ============================================================
-- 1. conversations INSERT — restrict participant forging
--    Old policy allowed participant_1 = auth.uid() OR participant_2 = auth.uid(),
--    meaning a user could set the OTHER participant to anyone cross-gym.
--    Fix: creator must always be participant_1, and both participants
--    must belong to the same gym.
-- ============================================================
DROP POLICY IF EXISTS "conversations_insert" ON conversations;

CREATE POLICY "conversations_insert" ON conversations FOR INSERT
  WITH CHECK (
    participant_1 = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup p1
      JOIN public.profile_lookup p2 ON p2.id = participant_2
      WHERE p1.id = auth.uid()
        AND p1.gym_id = p2.gym_id
    )
  );

-- ============================================================
-- 2. conversations SELECT/UPDATE/DELETE — add gym boundary
--    Old policies only checked participant matching, not gym.
--    Fix: keep participant check AND require user's gym_id matches.
-- ============================================================
DROP POLICY IF EXISTS "conversations_select" ON conversations;
DROP POLICY IF EXISTS "conversations_update" ON conversations;
DROP POLICY IF EXISTS "conversations_delete" ON conversations;

CREATE POLICY "conversations_select" ON conversations FOR SELECT
  USING (
    (participant_1 = auth.uid() OR participant_2 = auth.uid())
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "conversations_update" ON conversations FOR UPDATE
  USING (
    (participant_1 = auth.uid() OR participant_2 = auth.uid())
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "conversations_delete" ON conversations FOR DELETE
  USING (
    (participant_1 = auth.uid() OR participant_2 = auth.uid())
    AND gym_id = public.current_gym_id()
  );

-- ============================================================
-- 3. direct_messages — add gym boundary
--    Old policies only checked conversation ownership via subquery
--    on conversations but without gym scoping.
--    Fix: add gym boundary by requiring the conversation belongs
--    to the caller's gym.
-- ============================================================
DROP POLICY IF EXISTS "messages_select" ON direct_messages;
DROP POLICY IF EXISTS "messages_insert" ON direct_messages;
DROP POLICY IF EXISTS "messages_update" ON direct_messages;
DROP POLICY IF EXISTS "messages_delete" ON direct_messages;

CREATE POLICY "messages_select" ON direct_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE (participant_1 = auth.uid() OR participant_2 = auth.uid())
        AND gym_id = public.current_gym_id()
    )
  );

CREATE POLICY "messages_insert" ON direct_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE (participant_1 = auth.uid() OR participant_2 = auth.uid())
        AND gym_id = public.current_gym_id()
    )
  );

CREATE POLICY "messages_update" ON direct_messages FOR UPDATE
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE (participant_1 = auth.uid() OR participant_2 = auth.uid())
        AND gym_id = public.current_gym_id()
    )
  );

CREATE POLICY "messages_delete" ON direct_messages FOR DELETE
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE (participant_1 = auth.uid() OR participant_2 = auth.uid())
        AND gym_id = public.current_gym_id()
    )
  );

-- ============================================================
-- 4. password_reset_requests — fix anon SELECT USING(true)
--    Old policy "anon_read_own_reset_request" let anyone read ALL
--    reset tokens. Fix: revoke SELECT from anon entirely; the
--    reset-password edge function uses service role for lookups.
-- ============================================================
DROP POLICY IF EXISTS "anon_read_own_reset_request" ON password_reset_requests;

-- No replacement SELECT policy for anon — service role handles lookups.

-- ============================================================
-- 5. error_logs INSERT — fix WITH CHECK(true)
--    Old policy "anyone_insert_errors" allowed any user including
--    anon to insert arbitrary rows.
--    Fix: require authenticated user and profile_id must match.
-- ============================================================
DROP POLICY IF EXISTS "anyone_insert_errors" ON error_logs;

CREATE POLICY "authenticated_insert_own_errors" ON error_logs FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND profile_id = auth.uid()
  );

-- ============================================================
-- 6. gym_closures SELECT — fix USING(true) cross-gym leak
--    Old policy "Users can read gym closures" exposed all gyms'
--    closure dates to any authenticated user.
--    Fix: scope to user's own gym.
-- ============================================================
DROP POLICY IF EXISTS "Users can read gym closures" ON gym_closures;

CREATE POLICY "Users can read gym closures" ON gym_closures FOR SELECT
  USING (gym_id = public.current_gym_id());

-- ============================================================
-- 7. referral_codes SELECT — add gym boundary
--    Old policy "Authenticated can read referral codes" allowed all
--    authenticated users to read all codes across all gyms.
--    Fix: scope to user's own gym OR user's own codes.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can read referral codes" ON referral_codes;

CREATE POLICY "Authenticated can read referral codes" ON referral_codes FOR SELECT
  USING (
    gym_id = public.current_gym_id()
    OR profile_id = auth.uid()
  );

-- ============================================================
-- 8. admin_audit_log INSERT — add gym boundary
--    Old policy "admin_insert_audit_log" (from 0209) only checks
--    is_admin() with no gym check, allowing an admin to insert
--    audit entries for other gyms.
--    Fix: require gym_id matches current gym.
-- ============================================================
DROP POLICY IF EXISTS "admin_insert_audit_log" ON admin_audit_log;

CREATE POLICY "admin_insert_audit_log" ON admin_audit_log FOR INSERT
  WITH CHECK (
    public.is_admin()
    AND gym_id = public.current_gym_id()
  );

-- ============================================================
-- 9. feed_comments INSERT — add gym boundary
--    Old policy "feed_comments_insert_own" only checks
--    profile_id = auth.uid(), allowing a user to comment on
--    feed items in other gyms.
--    Fix: verify the feed item belongs to the user's gym.
-- ============================================================
DROP POLICY IF EXISTS "feed_comments_insert_own" ON feed_comments;

CREATE POLICY "feed_comments_insert_own" ON feed_comments FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM activity_feed_items fi
      WHERE fi.id = feed_item_id
        AND fi.gym_id = public.current_gym_id()
    )
  );

-- ============================================================
-- 10. complete_referral — revoke direct access
--     Only safe_complete_referral should be callable by
--     authenticated users (it adds caller validation).
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.complete_referral(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_referral(UUID) FROM public;

-- ============================================================
-- 11. Early helper functions — ensure search_path is set
--     These were originally defined in 0002 and redefined in 0062
--     to use profile_lookup. They already have SET search_path = public.
--     Re-assert with ALTER FUNCTION to guarantee the setting persists
--     even if an intermediate migration accidentally dropped it.
-- ============================================================
ALTER FUNCTION public.current_gym_id() SET search_path = public;
ALTER FUNCTION public.current_user_role() SET search_path = public;
ALTER FUNCTION public.is_admin() SET search_path = public;
ALTER FUNCTION public.is_super_admin() SET search_path = public;
