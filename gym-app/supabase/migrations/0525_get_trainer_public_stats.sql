-- ============================================================
-- 0525 — get_trainer_public_stats(): trainer profile stats for members
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor (after 0524).
--
-- PublicTrainerProfile showed "Active clients" and "Sessions" counted via
-- direct reads of trainer_clients / trainer_sessions — tables members can't
-- read (policies 0029 / 0035-0211: trainer/client/admin only). Every member
-- saw 0 / 0 on the personal-training upsell page; admins testing saw real
-- numbers, masking it. The client now calls this RPC (and HIDES the tiles
-- if it's missing, so applying this turns the stats on).
--
-- SECURITY: definer-read but tightly scoped — only aggregate COUNTS for a
-- trainer in the CALLER'S OWN gym; no row data, no PII, anon revoked.
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
  WHERE trainer_id = p_trainer_id AND is_active = TRUE;

  SELECT COUNT(*)::int INTO v_sessions
  FROM trainer_sessions
  WHERE trainer_id = p_trainer_id AND status = 'completed';

  RETURN json_build_object(
    'client_count', v_clients,
    'completed_sessions', v_sessions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_trainer_public_stats(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trainer_public_stats(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
