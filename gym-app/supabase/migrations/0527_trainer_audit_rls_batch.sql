-- ============================================================
-- 0527 — Trainer-audit RLS batch (5-agent audit, 2026-06-11)
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor (after 0526).
--
-- Fixes the "worked as admin, dead as trainer" family found by the
-- trainer-side audit:
--   1. personal_records had NO trainer SELECT policy (0039 fixed pr_history
--      only) → Home "Last PR", ClientDetail PR list + PR timeline were empty
--      for every real trainer.
--   2. member_goals had NO trainer SELECT policy → PlanBuilder's goal-aware
--      generation was always goal-blind.
--   3. gym_program_enrollments had no trainer DELETE → "Remove program" left
--      the client enrolled forever.
--   4. blocked_users had no UPDATE policy → re-blocking via upsert errored
--      (member + trainer side share this latent bug).
--   5. session_drafts was never added to the realtime publication → the
--      "live now" pills and the trainer live-session view never updated.
--   6. get_friend_feed was friends-only → a trainer's social feed was
--      permanently empty (trainers have no friends flow). Adds a
--      trainer-of-record arm so trainers see their ACTIVE clients' items;
--      member results are unchanged (is_trainer_of is FALSE for them).
-- ============================================================

-- ── 1. Trainers can read their clients' PRs ─────────────────────────────
DROP POLICY IF EXISTS "pr_select_trainer" ON personal_records;
CREATE POLICY "pr_select_trainer" ON personal_records
  FOR SELECT USING (public.is_trainer_of(profile_id));

-- ── 2. Trainers can read their clients' goals ───────────────────────────
DROP POLICY IF EXISTS "member_goals_trainer_read" ON member_goals;
CREATE POLICY "member_goals_trainer_read" ON member_goals
  FOR SELECT USING (public.is_trainer_of(profile_id));

-- ── 3. Trainers can remove their clients' program enrollments ───────────
DROP POLICY IF EXISTS "gpe_delete_trainer" ON gym_program_enrollments;
CREATE POLICY "gpe_delete_trainer" ON gym_program_enrollments
  FOR DELETE USING (public.is_trainer_of(profile_id));

-- ── 4. Re-block upsert needs an UPDATE arm on own block rows ────────────
DROP POLICY IF EXISTS "blocked_users_update_own" ON blocked_users;
CREATE POLICY "blocked_users_update_own" ON blocked_users
  FOR UPDATE USING (blocker_id = auth.uid())
  WITH CHECK (blocker_id = auth.uid());

-- ── 5. session_drafts → realtime publication (idempotent) ───────────────
-- Subscribers still pass SELECT RLS (drafts_trainer_read, 0380), so a
-- trainer only receives events for assigned clients' drafts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'session_drafts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_drafts;
  END IF;
END $$;

-- ── 6. get_friend_feed: + trainer-of-record arm ──────────────────────────
-- Exact copy of the 0338 definition with ONE new OR arm in the visibility
-- predicate. Block filter still applies to trainers.
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
        -- Trainer-of-record sees ACTIVE clients' activity (is_trainer_of
        -- checks the live trainer_clients link for auth.uid()).
        OR public.is_trainer_of(afi.actor_id)
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

NOTIFY pgrst, 'reload schema';
