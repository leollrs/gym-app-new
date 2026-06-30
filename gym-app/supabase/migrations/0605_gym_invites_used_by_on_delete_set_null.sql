-- 0605_gym_invites_used_by_on_delete_set_null.sql
-- ----------------------------------------------------------------------------
-- Bug: deleting a member who joined via an invite code fails with
--   update or delete on table "profiles" violates foreign key constraint
--   "gym_invites_used_by_fkey" on table "gym_invites"
--
-- Root cause: gym_invites.used_by (the member who CLAIMED the invite) was
-- defined in 0022 as `used_by UUID REFERENCES profiles(id)` with no ON DELETE
-- rule, so it defaults to NO ACTION and blocks the profile delete.
--
-- admin_delete_gym_member (0551) deletes ~30 child tables by hand but only
-- clears gym_invites WHERE created_by = target — it never clears used_by.
-- The self-serve account-deletion path (0339) already nulls used_by manually,
-- so the two delete paths diverged.
--
-- Fix at the schema level instead of patching one RPC: ON DELETE SET NULL makes
-- the constraint self-heal for EVERY delete path (admin delete, self delete,
-- and any future path). Matches the existing manual-null semantics in 0339:
-- the invite row survives, it just loses the claimed-by marker.
--
-- created_by stays NOT NULL / NO ACTION on purpose — the delete RPCs already
-- remove invites a member created, and an invite with no creator is meaningless.
-- ----------------------------------------------------------------------------

ALTER TABLE public.gym_invites
  DROP CONSTRAINT IF EXISTS gym_invites_used_by_fkey;

ALTER TABLE public.gym_invites
  ADD CONSTRAINT gym_invites_used_by_fkey
  FOREIGN KEY (used_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
