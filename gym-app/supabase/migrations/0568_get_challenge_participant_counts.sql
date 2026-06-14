-- =============================================================
-- get_challenge_participant_counts — per-challenge VISIBLE
-- participant counts for one gym, in a single aggregate.
--
-- The member Challenges list used to pull EVERY participant row
-- for the whole gym (challenge_participants WHERE gym_id, capped
-- at .limit(500)) and reduce to per-challenge counts on the client,
-- excluding leaderboard-hidden members. Past 500 rows (challenges ×
-- members) the cap silently UNDER-counted AND could drop the
-- caller's own join row, corrupting the Join/Leave button state.
--
-- This RPC computes the counts server-side (GROUP BY challenge_id),
-- counting only participants whose profile is leaderboard-visible
-- (leaderboard_visible IS NOT FALSE) — matching the client's
-- fetchMemberProfiles visibility filter exactly.
--
-- SECURITY DEFINER bypasses RLS; the body scopes to the caller's
-- OWN gym (p_gym_id must equal the caller's gym_id) so a member
-- cannot probe another gym's challenge counts.
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_challenge_participant_counts(p_gym_id uuid)
RETURNS TABLE(challenge_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.challenge_id, COUNT(*)::bigint AS cnt
    FROM challenge_participants cp
    JOIN profiles p ON p.id = cp.profile_id
   WHERE cp.gym_id = p_gym_id
     AND p.gym_id = p_gym_id
     AND p.leaderboard_visible IS NOT FALSE
     AND p_gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid())
   GROUP BY cp.challenge_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_challenge_participant_counts(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_challenge_participant_counts(uuid) IS
  'Per-challenge count of leaderboard-visible participants for the caller''s gym,
   computed server-side instead of fetching all gym participant rows (capped at
   500) to the client. Scoped to the caller''s own gym. Used by the member
   Challenges list card counts.';
