-- 0608 — Close the trainer_clients self-assign privilege escalation (Audit P0)
-- ============================================================
-- The trainer_clients INSERT policy (0291) checked only:
--     trainer_id = auth.uid() AND gym_id = public.current_gym_id()
-- with NO caller-role check. So any ordinary member could POST a row making
-- themselves the "trainer of" any other member in their own gym (the app's
-- own Add-Client flow is a bare client-side upsert). That single write then
-- unlocked trainer-level read/write on the victim via every is_trainer_of /
-- _can_manage_client-gated policy and RPC: their body measurements, PRs,
-- goals, checkin responses, habits, nutrition prefs, private feed, plus
-- set_client_fee / trainer_send_cue / set_client_schedule. Gym boundary held
-- (intra-gym only), but that's a full cross-account health-data breach.
--
-- Fix: require the inserter to actually be STAFF (trainer/admin/super_admin)
-- via the profiles.is_staff keystone (0493). A plain member has is_staff=false,
-- so the WITH CHECK now fails and the escalation is closed. Legit trainers
-- (is_staff=true) still self-add through the same policy, so we KEEP the INSERT
-- grant — a blanket REVOKE would break the real add-client flow, since the
-- role-gated RLS policy is itself the enforcement path.

-- Reusable, RLS-proof caller-is-staff check (SECURITY DEFINER reads is_staff
-- directly so it can't be defeated by profiles RLS or recurse through it).
CREATE OR REPLACE FUNCTION public.current_user_is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_staff FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_staff() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_is_staff() TO authenticated;

DROP POLICY IF EXISTS "trainer_clients_insert_trainer" ON trainer_clients;
CREATE POLICY "trainer_clients_insert_trainer" ON trainer_clients
  FOR INSERT WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = public.current_gym_id()
    AND public.current_user_is_staff()
  );

-- Defense-in-depth follow-up (NOT done here to keep this P0 fix's blast radius
-- minimal): also assert caller role inside is_trainer_of() / _can_manage_client().
-- With the INSERT hole closed, a member can no longer forge the trainer_clients
-- row those helpers key off, so the escalation is already shut — the helper
-- hardening is belt-and-suspenders for a later, separately-tested migration.

NOTIFY pgrst, 'reload schema';
