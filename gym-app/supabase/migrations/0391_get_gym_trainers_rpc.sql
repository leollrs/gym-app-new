-- ============================================================
-- 0391 — get_gym_trainers() RPC for the MyGym trainer directory
-- ============================================================
-- The MyGym "Trainers at your gym" list was querying `profiles`
-- directly from the client. That fought three things at once:
--   1. RLS on `profiles` — members generally can't SELECT other
--      members'/trainers' rows, so the list came back empty/403.
--   2. `additional_roles` is `user_role[]` (an enum array) —
--      PostgREST's `cs`/`.contains()` operator rejects it (400).
--   3. `trainer_directory_visible` may not exist yet if 0390
--      wasn't applied.
--
-- This migration fixes all three: it idempotently ensures the
-- column exists, then exposes a SECURITY DEFINER RPC that does the
-- role + gym + visibility filtering server-side in plain SQL and
-- returns only safe, public-facing columns. The RPC enforces
-- "same gym as the caller" internally, so SECURITY DEFINER can't
-- leak trainers from other gyms.
-- ============================================================

-- 1. Make sure the opt-out column exists (idempotent — safe whether
--    or not migration 0390 was applied on this database).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trainer_directory_visible BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. The RPC.
CREATE OR REPLACE FUNCTION public.get_gym_trainers()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    UUID := auth.uid();
  _gym_id UUID;
  _result JSON;
BEGIN
  -- Resolve the caller's gym. No gym → nothing to show.
  SELECT gym_id INTO _gym_id FROM profiles WHERE id = _uid;
  IF _gym_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(json_agg(t ORDER BY t.full_name), '[]'::json)
    INTO _result
  FROM (
    SELECT p.id, p.full_name, p.username,
           p.avatar_url, p.avatar_type, p.avatar_value,
           p.trainer_tagline, p.trainer_years_exp
      FROM profiles p
     WHERE p.gym_id = _gym_id
       -- Primary-role trainers AND multi-role users (member primary
       -- + 'trainer' in additional_roles). ANY() handles the enum
       -- array cleanly — no PostgREST `cs` operator involved.
       AND (p.role = 'trainer' OR 'trainer' = ANY(p.additional_roles))
       -- Opt-out flag. COALESCE keeps legacy rows (NULL) visible.
       AND COALESCE(p.trainer_directory_visible, TRUE) = TRUE
     LIMIT 50
  ) t;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_gym_trainers() TO authenticated;

-- 3. Single-trainer public profile, for the /trainers/:id page.
--    Same rationale as get_gym_trainers — reading `profiles` directly
--    is blocked by RLS and `.eq('role','trainer')` misses multi-role
--    accounts. Enforces "same gym as caller"; returns NULL for a
--    cross-gym id, a non-trainer, or an unknown id (the page treats
--    NULL as "trainer not found"). Includes `trainer_directory_visible`
--    so the page can still gate hidden trainers for non-clients.
CREATE OR REPLACE FUNCTION public.get_trainer_public_profile(p_trainer_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    UUID := auth.uid();
  _gym_id UUID;
  _result JSON;
BEGIN
  SELECT gym_id INTO _gym_id FROM profiles WHERE id = _uid;
  IF _gym_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(t) INTO _result
  FROM (
    SELECT p.id, p.full_name, p.username,
           p.avatar_url, p.avatar_type, p.avatar_value, p.bio,
           p.trainer_tagline, p.trainer_cover_url, p.trainer_years_exp,
           p.trainer_location, p.trainer_pronouns, p.trainer_specialties,
           p.trainer_credentials, p.trainer_services, p.trainer_availability,
           p.trainer_verified, p.trainer_directory_visible,
           p.phone_number, p.gym_id, p.role
      FROM profiles p
     WHERE p.id = p_trainer_id
       AND p.gym_id = _gym_id
       AND (p.role = 'trainer' OR 'trainer' = ANY(p.additional_roles))
  ) t;

  RETURN _result; -- NULL when not found / cross-gym / not a trainer
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trainer_public_profile(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
