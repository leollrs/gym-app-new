-- Security fix: validate p_delta in increment_challenge_score
-- Prevents negative deltas (score sabotage) and caps maximum per-call increment.
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
  -- Block non-positive deltas (no sabotage or no-ops)
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'p_delta must be greater than 0';
  END IF;

  -- Cap maximum delta per call to prevent abuse
  IF p_delta > 50 THEN
    RAISE EXCEPTION 'p_delta exceeds maximum allowed value of 50';
  END IF;

  UPDATE challenge_participants
  SET score = COALESCE(score, 0) + p_delta
  WHERE id = p_participant_id
    AND profile_id = auth.uid();
END;
$$;
