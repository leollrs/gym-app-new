-- ============================================================
-- 0475 — Policy correctness fixes + missing WITH CHECK clauses
-- ============================================================
-- Cleanup pass over issues found in the live RLS policy dump (3of7,
-- 2026-05-30). Each is independent; all are safe, non-breaking tightenings
-- or repairs of live drift.
-- ============================================================

-- ── 1. challenge_teams_update: live policy has a typo (LIVE DRIFT) ──
-- The migration 0261 created this policy correctly as
--   EXISTS (... WHERE cp.team_id = challenge_teams.id AND cp.profile_id = auth.uid())
-- but the LIVE policy dump shows the predicate degraded to
--   (cp.team_id = cp.id)
-- which compares challenge_participants.team_id to challenge_participants.id
-- — never true for a real team, so NOBODY can update a team (fail-closed,
-- so not a security hole, but team editing is silently broken). Re-assert
-- the correct definition from 0261.
DROP POLICY IF EXISTS "challenge_teams_update" ON public.challenge_teams;
CREATE POLICY "challenge_teams_update" ON public.challenge_teams
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM challenge_participants cp
      WHERE cp.team_id = challenge_teams.id
        AND cp.profile_id = auth.uid()
    )
  );

-- ── 2. member_invites "Users can claim invites": USING too broad ──
-- Live: FOR UPDATE USING (auth.role() = 'authenticated')
--               WITH CHECK ((claimed_by = auth.uid()) OR (claimed_by IS NULL))
-- The USING lets any authenticated user target ANY invite row. Tighten the
-- USING so a caller can only touch an invite that is still unclaimed or
-- already theirs; force the resulting row to belong to the caller. This
-- preserves the legitimate "claim an open invite" flow while preventing a
-- user from altering invites that belong to someone else.
DROP POLICY IF EXISTS "Users can claim invites" ON public.member_invites;
CREATE POLICY "Users can claim invites" ON public.member_invites
  FOR UPDATE
  USING (
    (auth.role() = 'authenticated'::text)
    AND (claimed_by IS NULL OR claimed_by = auth.uid())
  )
  WITH CHECK (claimed_by = auth.uid());

-- ── 3. gym_classes "trainer_update_assigned_classes": add WITH CHECK ──
-- Live: FOR UPDATE USING (trainer_id = auth.uid())  -- no WITH CHECK.
-- Without WITH CHECK a trainer editing their class could change gym_id (or
-- reassign trainer_id away) on the row. Add a WITH CHECK that pins both the
-- gym boundary and continued trainer ownership.
DROP POLICY IF EXISTS "trainer_update_assigned_classes" ON public.gym_classes;
CREATE POLICY "trainer_update_assigned_classes" ON public.gym_classes
  FOR UPDATE
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid() AND gym_id = public.current_gym_id());

-- ── 4. activity_feed_items "feed_update_own": add WITH CHECK ──
-- Live: FOR UPDATE USING ((actor_id = auth.uid())
--                         OR ((gym_id = current_gym_id()) AND is_admin()))
--       -- no WITH CHECK, so the post owner could move a row to another gym
--       -- or reassign actor_id. Mirror the USING into a WITH CHECK.
DROP POLICY IF EXISTS "feed_update_own" ON public.activity_feed_items;
CREATE POLICY "feed_update_own" ON public.activity_feed_items
  FOR UPDATE
  USING (
    (actor_id = auth.uid())
    OR ((gym_id = public.current_gym_id()) AND public.is_admin())
  )
  WITH CHECK (
    (actor_id = auth.uid() AND gym_id = public.current_gym_id())
    OR ((gym_id = public.current_gym_id()) AND public.is_admin())
  );

NOTIFY pgrst, 'reload schema';
