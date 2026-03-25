-- RPC to increment a challenge participant's score (bypasses the guard trigger)
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
  UPDATE challenge_participants
  SET score = COALESCE(score, 0) + p_delta
  WHERE id = p_participant_id
    AND profile_id = auth.uid();
END;
$$;
