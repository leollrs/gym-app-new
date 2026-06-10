-- ============================================================
-- 0522 — Restore EXECUTE on RLS auth-helper functions (current_gym_id et al.)
-- ============================================================
-- Symptom (live):  42501  permission denied for function current_gym_id
--   • Signup (anon): the gym-code field queries `gyms_public`, which evaluates
--     ALL permissive SELECT policies on `gyms` — including `gyms_select_own`,
--     whose USING clause calls `current_gym_id()`. With no EXECUTE grant the
--     whole query throws 42501, so the gym lookup returns nothing →
--     "Gym code not found. Ask your gym for the correct code."
--   • Authenticated: the same 42501 surfaces on normal RLS evaluation
--     (the raw error toast on a dark screen).
--
-- This is the identical failure migration 0367 fixed. The grants were lost on
-- this database (0367 not applied, or reset by a later change). Re-grant the 7
-- RLS helper functions to BOTH `authenticated` AND `anon` (idempotent, and
-- resilient to a missing signature), then re-assert the defensive short-circuit
-- on `gyms_select_own` so anon never invokes the helper at all.
--
-- Granting `anon` is safe: each helper reads `profile_lookup` filtered by
-- auth.uid(), which is NULL for anon → it returns NULL / FALSE and leaks
-- nothing; the grant just lets policy expressions evaluate without 42501.
-- ============================================================

DO $$
DECLARE
  sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.current_gym_id()',
    'public.current_user_role()',
    'public.is_admin()',
    'public.is_super_admin()',
    'public.is_trainer_of(uuid)',
    'public.is_blocked(uuid, uuid)',
    'public.is_blocked_pair(uuid, uuid)'
  ] LOOP
    BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, anon', sig);
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE 'skip (no such function): %', sig;
    END;
  END LOOP;
END $$;

-- Defensive short-circuit (matches 0367): anon owns no gym row, so this returns
-- FALSE *without* invoking current_gym_id() — signup keeps working even if an
-- EXECUTE grant is ever lost again.
DROP POLICY IF EXISTS "gyms_select_own" ON public.gyms;

CREATE POLICY "gyms_select_own" ON public.gyms
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND id = public.current_gym_id()
  );

NOTIFY pgrst, 'reload schema';
