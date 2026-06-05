-- 0521_fix_challenge_score_rpc_guard.sql
-- Let members score challenges through the sanctioned RPCs again.
--
-- BUG: guard_challenge_score_update() (0028) blocks ANY change to
-- challenge_participants.score unless public.is_admin(). But the only paths
-- that update a member's score are the SECURITY DEFINER RPCs
-- increment_challenge_score() / set_challenge_score() (0261), called from the
-- client when a workout is finished. SECURITY DEFINER does NOT make is_admin()
-- true — auth.uid() still resolves to the calling MEMBER — so the guard fired
-- inside the RPC and every score update raised:
--     P0001  "Challenge scores cannot be modified directly"
-- i.e. challenge scoring has been silently broken for non-admins (visible now
-- as a console error on the /rpc/increment_challenge_score call after a finish).
--
-- FIX: the two RPCs are the trusted, validated path (they update only the
-- caller's own participant row — WHERE profile_id = auth.uid() — and cap the
-- delta/score and rate-limit). Let them set a TRANSACTION-LOCAL GUC that the
-- guard honours, in addition to is_admin(). A direct PATCH on
-- challenge_participants (or any other path) never sets the GUC, so the guard
-- still blocks tampering — PostgREST runs each request in its own transaction
-- and gives clients no way to set the GUC outside these functions.

-- ── 1. Guard: allow when the trusted-writer GUC is set, or admin ─────────────
CREATE OR REPLACE FUNCTION public.guard_challenge_score_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.score IS DISTINCT FROM OLD.score
     AND current_setting('app.allow_challenge_score_write', true) IS DISTINCT FROM '1'
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Challenge scores cannot be modified directly';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. increment_challenge_score — set the bypass GUC before updating ────────
CREATE OR REPLACE FUNCTION public.increment_challenge_score(
  p_participant_id UUID,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'p_delta must be greater than 0';
  END IF;

  IF p_delta > 100000 THEN
    RAISE EXCEPTION 'p_delta exceeds maximum allowed value';
  END IF;

  -- Rate limit: max 20 calls per minute (best-effort)
  BEGIN
    PERFORM public.check_rate_limit('increment_challenge_score', 20, 1);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Authorise this transaction's score write for the guard trigger. Local to
  -- the transaction (auto-reset at commit), so it never leaks across the pool.
  PERFORM set_config('app.allow_challenge_score_write', '1', true);

  UPDATE challenge_participants
  SET score = COALESCE(score, 0) + p_delta
  WHERE id = p_participant_id
    AND profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a participant in this challenge';
  END IF;
END;
$$;

-- ── 3. set_challenge_score — same bypass before the absolute set ─────────────
CREATE OR REPLACE FUNCTION public.set_challenge_score(
  p_participant_id UUID,
  p_score NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_score < 0 THEN
    RAISE EXCEPTION 'Score cannot be negative';
  END IF;

  IF p_score > 10000 THEN
    RAISE EXCEPTION 'Score exceeds maximum allowed value';
  END IF;

  PERFORM set_config('app.allow_challenge_score_write', '1', true);

  UPDATE challenge_participants
  SET score = p_score
  WHERE id = p_participant_id
    AND profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a participant in this challenge';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
