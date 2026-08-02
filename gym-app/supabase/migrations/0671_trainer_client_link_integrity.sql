-- ============================================================
-- 0671 — The trainer↔client LINK itself, and what revoking means
-- ============================================================
-- ⚠️ APPLY ON STAGING FIRST, like 0657 and 0660.
--
-- 0657 asked "did the member say yes?" and 0660 asked it at every door. This
-- one asks the question underneath both: is the ROW those checks read even
-- trustworthy, and does saying "no" actually take anything away?
--
-- Three findings, all in the same seam.
--
-- ── 1. A trainer could re-point an accepted link at anyone ────────────────
-- `trainer_clients_update_trainer` (latest definition: 0274) is
--
--     FOR UPDATE USING (trainer_id = auth.uid())
--
-- with no WITH CHECK. Postgres then reuses USING as the check, so `trainer_id`
-- is pinned — but `client_id` is not constrained at ALL. One accepted client is
-- therefore a master key:
--
--     UPDATE trainer_clients SET client_id = '<any member>'
--      WHERE trainer_id = auth.uid();
--
-- The row keeps status='active' and responded_at, so every gate added by 0657
-- and 0660 reads it as consent — from a member who never gave any. And because
-- the consent guard only inspects `status`, and status did not change, nothing
-- fires: no exception, no notification, no trace. The victim is never told.
--
-- Fixed in the TRIGGER, not only the policy, for the reason 0657 already gives:
-- policies are permissive and OR together, and `trainer_clients_admin` is
-- FOR ALL. A WITH CHECK on the trainer's policy alone would be walked around.
-- The policy gets its explicit WITH CHECK anyway so the intent is readable
-- where people look for it.
--
-- Re-pointing is forbidden outright rather than re-set to 'pending'. No app
-- path updates client_id or trainer_id — all 32 call sites touch is_active,
-- status, responded_at or notes — so nothing legitimate is lost, and "move a
-- client to another trainer" stays what it already is: delete, then invite.
-- auth.uid() IS NULL (service_role) keeps the escape hatch for data migration.
--
-- ── 2. Assigning a program was full-row UPDATE on the member's profile ────
-- 0146 dropped `profiles_trainer_assign_program` and called it out as a HIGH
-- issue in its own title: "trainer could update ANY column on ANY profile in
-- their gym". It replaced the policy with a SECURITY DEFINER function that
-- writes exactly one column. 0354 then re-created the policy — scoped by WHO
-- (is_trainer_of) but, like every RLS policy, not by WHICH COLUMNS, because RLS
-- is row-level. The 0146 hole came back narrower but real: a trainer could
-- write `ai_consent`, `data_consent_at`, `membership_status`, `role`,
-- `friend_code`, anything — on a client's row. Forging the very consent records
-- 0657 introduced is the worst of those.
--
-- The app never needed it. Every assign site already calls the RPC
-- (TrainerClients bulk, TrainerClientDetail, trainerAssignment.clearOther-
-- Assignments); every `profiles` UPDATE on the trainer side targets the
-- trainer's OWN row and rides profiles_update_own. So this restores 0146's
-- decision instead of trying to re-narrow a policy that cannot express the
-- constraint.
--
-- While it is being rebuilt, the RPC also stops trusting the role alone. It
-- checked "caller is a trainer" and "same gym" — not "is this trainer's
-- client" — so ANY trainer in the gym could set ANY member's program, which is
-- also what let a trainer wipe a colleague's assignment through
-- clearOtherAssignments.
--
-- ── 3. Revoking was half a no-op ──────────────────────────────────────────
-- `end_trainer_relationship` sets status='ended' and leaves is_active TRUE.
-- 0657's own gates read both, so THEY close — but every check written before
-- 0657 keys on is_active alone, and those are the majority: invoiceService,
-- TrainerHome's roster, TrainerMessages, TrainerLiveSession, TrainerSocial,
-- the admin analytics. The member pressed the button, saw it disappear from
-- their side, and stayed on the trainer's list.
-- ============================================================
--
-- ⚠️ RUN THE FOUR BLOCKS BELOW SEPARATELY, one at a time.
--
-- The first attempt at this file deadlocked against live traffic:
--
--   Process A waits for AccessExclusiveLock on <trainer_clients>, blocked by B
--   Process B waits for AccessShareLock   on <profiles>,        blocked by A
--
-- A policy change takes an ACCESS EXCLUSIVE lock on its table — the strongest
-- one there is, blocking even plain SELECTs. As one transaction this file grabs
-- that lock on `trainer_clients` and then reaches for the same on `profiles`,
-- while any ordinary request holds a share lock on `profiles` (every query
-- touches it) and is waiting on `trainer_clients` through `is_trainer_of()`.
-- Each side holds what the other needs.
--
-- Splitting removes the cycle: no transaction ever holds an exclusive lock on
-- one hot table while waiting for another. `lock_timeout` then keeps a blocked
-- block from queueing behind a long query — every session that arrives after it
-- would queue behind the LOCK, not the query, which is how a 3-second wait
-- becomes an outage. It aborts in 5s instead; just run that block again.
--
-- Partial application is safe. Each block is an independent tightening, so
-- stopping after any of them leaves the database no less protected than before.
-- ============================================================

-- ═══════════════ BLOCK 1 — the consent guard (no table locks) ═════════════
SET lock_timeout = '5s';

-- ── 1. Link integrity ─────────────────────────────────────────────────────
-- Rebuilt from 0657's definition verbatim, with the TG_OP = 'UPDATE' identity
-- block added. Diff against 0657 before applying.
CREATE OR REPLACE FUNCTION public.trainer_clients_consent_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Any authenticated inserter — trainer OR admin — creates a REQUEST.
    -- auth.uid() IS NULL means service_role (bulk import / data migration),
    -- which keeps whatever status it set deliberately.
    IF auth.uid() IS NOT NULL THEN
      NEW.status := 'pending';
      NEW.responded_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- A link is between two named people. It is never edited into a link
  -- between two different people: that would carry an accepted consent over
  -- to someone who never gave it, and it is the one change no policy on this
  -- table constrains.
  IF auth.uid() IS NOT NULL
     AND (NEW.client_id  IS DISTINCT FROM OLD.client_id
       OR NEW.trainer_id IS DISTINCT FROM OLD.trainer_id) THEN
    RAISE EXCEPTION 'A trainer-client link cannot be re-pointed at someone else; remove it and create a new one'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- THE RULE: nobody but the member can GRANT access. Anyone may revoke it or
    -- ask again.
    --
    -- Only 'active' is a grant. A trainer moving their own row to 'pending'
    -- (re-asking — e.g. restoring a client who had left) or to 'ended'
    -- (giving up) takes nothing and must stay possible: without it, restoring a
    -- removed client would either fail outright or, worse, silently hand back
    -- access the member never re-approved.
    --
    -- Blocking the grant is what stops a trainer flipping a 'declined' row back
    -- to 'active' — the UPDATE policy is only `trainer_id = auth.uid()`, so
    -- without this a refusal would be a speed bump, not an answer.
    IF NEW.status = 'active'
       AND auth.uid() IS NOT NULL
       AND auth.uid() IS DISTINCT FROM OLD.client_id
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only the member can accept a trainer'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ═══════════════ END OF BLOCK 1 ═══════════════
-- Replacing a function takes no lock on any table, so nothing above can block
-- a reader. The trigger picks the new body up on its next fire.


NOTIFY pgrst, 'reload schema';

-- ═══════════════ BLOCK 2 — trainer_clients (ACCESS EXCLUSIVE) ═════════════
SET lock_timeout = '5s';

-- Say it in the policy too. Rebuilt from 0274 with the WITH CHECK it never had.
-- Alone in its block: this is one of the two locks whose ordering deadlocked.
DROP POLICY IF EXISTS "trainer_clients_update_trainer" ON trainer_clients;
CREATE POLICY "trainer_clients_update_trainer" ON trainer_clients
  FOR UPDATE
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());


NOTIFY pgrst, 'reload schema';

-- ═══════════════ BLOCK 3 — profiles (ACCESS EXCLUSIVE) ════════════════════
-- ── 2. Programs go through the function, not through the profile row ──────
-- The other half of the deadlock. `profiles` is the god-table — essentially
-- every request in the app reads it — so this lock is the expensive one. It is
-- a single DROP POLICY: it takes microseconds once it is granted. The risk is
-- entirely in WAITING for it behind a slow query, which lock_timeout caps.
SET lock_timeout = '5s';

DROP POLICY IF EXISTS profiles_trainer_assign_program ON profiles;


NOTIFY pgrst, 'reload schema';

-- ═══════════════ BLOCK 4 — functions, grants, backfill ════════════════════
-- No ACCESS EXCLUSIVE locks below this line. The backfill UPDATE at the end
-- takes ROW EXCLUSIVE on trainer_clients, which does not block readers.

-- Rebuilt from 0146 with the trainer-of-record check added. Diff against 0146.
CREATE OR REPLACE FUNCTION public.trainer_assign_program(p_member_id UUID, p_program_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_gym_id UUID;
  v_member_gym_id UUID;
BEGIN
  IF public.current_user_role() <> 'trainer' THEN
    RAISE EXCEPTION 'Only trainers can assign programs';
  END IF;

  SELECT gym_id INTO v_caller_gym_id FROM profiles WHERE id = auth.uid();
  SELECT gym_id INTO v_member_gym_id FROM profiles WHERE id = p_member_id;

  IF v_member_gym_id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_caller_gym_id <> v_member_gym_id THEN
    RAISE EXCEPTION 'Cannot assign programs to members outside your gym';
  END IF;

  -- Same gym is not the same thing as your client. Without this, any trainer
  -- in the gym could set — or, with p_program_id NULL, silently CLEAR — any
  -- member's program, including a colleague's client's.
  IF NOT public.is_trainer_of(p_member_id) THEN
    RAISE EXCEPTION 'That member has not accepted you as their trainer'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Only update the assigned_program_id column
  UPDATE profiles
  SET assigned_program_id = p_program_id
  WHERE id = p_member_id
    AND gym_id = v_caller_gym_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trainer_assign_program(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trainer_assign_program(UUID, UUID) TO authenticated;

-- ── 3. Revoking revokes ───────────────────────────────────────────────────
-- Rebuilt from 0657 with is_active. Diff against 0657.
CREATE OR REPLACE FUNCTION public.end_trainer_relationship(p_trainer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.trainer_clients
     SET status = 'ended',
         is_active = FALSE,   -- ← every pre-0657 check reads this one
         responded_at = now()
   WHERE client_id = auth.uid()
     AND trainer_id = p_trainer_id
     AND status IN ('active', 'pending');

  RETURN FOUND;
END;
$$;

-- Declining an invitation is the other half of the same act: a row that was
-- never accepted must not sit in anyone's roster either.
CREATE OR REPLACE FUNCTION public.respond_to_trainer_request(
  p_trainer_id UUID,
  p_accept     BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_new := CASE WHEN p_accept THEN 'active' ELSE 'declined' END;

  UPDATE public.trainer_clients
     SET status = v_new,
         is_active = p_accept,
         responded_at = now()
   WHERE client_id = auth.uid()
     AND trainer_id = p_trainer_id
     AND status = 'pending';

  IF NOT FOUND THEN
    RETURN NULL;   -- nothing pending from that trainer; not an error
  END IF;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_trainer_request(UUID, BOOLEAN) FROM public;
REVOKE ALL ON FUNCTION public.end_trainer_relationship(UUID)            FROM public;
GRANT EXECUTE ON FUNCTION public.respond_to_trainer_request(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_trainer_relationship(UUID)            TO authenticated;

-- Rows that were revoked before this migration are still sitting in rosters.
UPDATE public.trainer_clients
   SET is_active = FALSE
 WHERE is_active IS TRUE
   AND status IN ('ended', 'declined');

NOTIFY pgrst, 'reload schema';
