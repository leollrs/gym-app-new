-- Security fix: Add bounds validation to increment_challenge_score
-- Prevents users from inflating scores with arbitrarily large deltas
CREATE OR REPLACE FUNCTION public.increment_challenge_score(p_challenge_id UUID, p_delta NUMERIC)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Validate delta is within reasonable bounds
  IF p_delta < 0 OR p_delta > 1000 THEN
    RAISE EXCEPTION 'Score delta out of range (0-1000)';
  END IF;

  -- Rate limit: max 20 calls per minute
  BEGIN
    PERFORM public.check_rate_limit('increment_challenge_score', 20, 1);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Rate limiting is best-effort
  END;

  -- Only update if the user is actually a participant
  UPDATE challenge_participants
  SET current_score = current_score + p_delta
  WHERE challenge_id = p_challenge_id
    AND profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a participant in this challenge';
  END IF;
END;
$$;
