-- ============================================================
-- 0473 — CRITICAL (LIVE): re-lock profile_lookup against self-promotion
-- ============================================================
-- CONFIRMED EXPLOITABLE on the live DB (2026-05-30 grants dump):
--   role_table_grants shows `authenticated` still holds INSERT + UPDATE on
--   public.profile_lookup. 0195 was supposed to REVOKE those, but the live
--   DB never (fully) had it applied — DELETE/TRUNCATE are gone, INSERT/UPDATE
--   remain. Classic migration↔live drift.
--
-- profile_lookup is the source of truth for is_admin() / is_super_admin() /
-- current_gym_id() / current_user_role(). The live RLS policy
-- "Users can upsert own lookup" is FOR ALL USING (auth.uid() = id) with NO
-- WITH CHECK, so it constrains *which row* you touch but not *what* you write.
-- With the INSERT/UPDATE grant present, any authenticated member can run:
--     UPDATE public.profile_lookup SET role = 'super_admin' WHERE id = auth.uid();
-- and is_super_admin() immediately returns true → full platform takeover.
-- Setting gym_id likewise grants cross-tenant access.
--
-- The app never writes profile_lookup from the client (0 frontend refs); the
-- SECURITY DEFINER trigger sync_profile_lookup() maintains it from profiles.
-- So removing all client write access is safe.
--
-- FIX (self-contained + idempotent, ordered so nobody is ever stranded):
--   1. Re-assert sync_profile_lookup() + its trigger (guarantees the table
--      keeps populating from profiles even after we cut client writes — in
--      case 0465 also drifted).
--   2. Backfill profile_lookup from profiles (repairs any rows that drifted).
--   3. DROP the permissive "Users can upsert own lookup" policy.
--   4. REVOKE INSERT/UPDATE/DELETE/TRUNCATE on profile_lookup from
--      authenticated + anon (re-assert 0195; belt-and-suspenders with #3).
--      SELECT is retained so "Users can read own lookup" still works.
-- ============================================================

-- ── 1. Re-assert the SECURITY DEFINER sync function + trigger ──
CREATE OR REPLACE FUNCTION public.sync_profile_lookup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profile_lookup WHERE id = OLD.id;
    RETURN OLD;
  ELSE
    INSERT INTO public.profile_lookup (id, gym_id, role, additional_roles)
    VALUES (NEW.id, NEW.gym_id, NEW.role, COALESCE(NEW.additional_roles, '{}'))
    ON CONFLICT (id) DO UPDATE
      SET gym_id           = EXCLUDED.gym_id,
          role             = EXCLUDED.role,
          additional_roles = EXCLUDED.additional_roles;
    RETURN NEW;
  END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_profile_lookup ON public.profiles;
CREATE TRIGGER trg_sync_profile_lookup
  AFTER INSERT OR UPDATE OF gym_id, role, additional_roles ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_lookup();

-- ── 2. Backfill (repair any drifted rows) ──
INSERT INTO public.profile_lookup (id, gym_id, role, additional_roles)
SELECT p.id, p.gym_id, p.role, COALESCE(p.additional_roles, '{}')
FROM public.profiles p
ON CONFLICT (id) DO UPDATE
  SET gym_id           = EXCLUDED.gym_id,
      role             = EXCLUDED.role,
      additional_roles = EXCLUDED.additional_roles;

-- ── 3. Remove the permissive self-write policy ──
DROP POLICY IF EXISTS "Users can upsert own lookup" ON public.profile_lookup;

-- ── 4. Re-assert the write revoke (the part that drifted) ──
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profile_lookup FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profile_lookup FROM anon;
-- SELECT intentionally retained for "Users can read own lookup".

NOTIFY pgrst, 'reload schema';
