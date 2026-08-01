-- ============================================================
-- 0662 — "Active clients" on a public profile means ACCEPTED clients
-- ============================================================
-- get_trainer_public_stats counted every trainer_clients row with is_active,
-- which after 0657 includes rows the member has not answered yet. The public
-- profile therefore inflated the count with pending requests — and since a
-- trainer can create those unilaterally, the number was self-issued.
--
-- Regenerated from 0525 with one clause added; diff it against that file.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_trainer_public_stats(p_trainer_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_gym UUID;
  v_trainer_gym UUID;
  v_clients INT;
  v_sessions INT;
BEGIN
  SELECT gym_id INTO v_caller_gym FROM profiles WHERE id = auth.uid();
  SELECT gym_id INTO v_trainer_gym FROM profiles WHERE id = p_trainer_id;
  IF v_caller_gym IS NULL OR v_trainer_gym IS NULL OR v_caller_gym != v_trainer_gym THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

  SELECT COUNT(*)::int INTO v_clients
  FROM trainer_clients
  WHERE trainer_id = p_trainer_id
    AND is_active = TRUE
    -- ACCEPTED only. Without this the tile counted people who had merely been
    -- ASKED, so a trainer with 3 clients and 6 outstanding requests advertised
    -- 9 — on a public profile, where the number is a credential. A request is
    -- not a client until the member says so; that is the whole point of 0657.
    AND status = 'active';

  SELECT COUNT(*)::int INTO v_sessions
  FROM trainer_sessions
  WHERE trainer_id = p_trainer_id AND status = 'completed';

  RETURN json_build_object(
    'client_count', v_clients,
    'completed_sessions', v_sessions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_trainer_public_stats(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.get_trainer_public_stats(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_trainer_public_stats(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
