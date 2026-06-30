-- 0604 — Member deletion: drop the storage-sweep trigger Supabase now blocks
--
-- THE actual cause of "Direct deletion from storage tables is not allowed. Use the
-- Storage API instead." on member delete:
--
-- 0461 installed a BEFORE DELETE trigger on `profiles`
-- (_sweep_user_storage_on_profile_delete) that runs `DELETE FROM storage.objects`
-- to purge the user's check-in photos / print cards. Supabase's platform now
-- forbids direct deletes on storage tables, so that trigger RAISES on every
-- `DELETE FROM profiles` — which is exactly the line admin_delete_gym_member dies
-- on, before anything else runs. (0603 nulled storage.objects.owner before the
-- LATER auth.users delete, so it never got a chance to help.)
--
-- A trigger physically cannot delete storage.objects anymore, so drop it (and its
-- function). admin_delete_gym_member already nulls storage.objects.owner before
-- deleting auth.users (0603), so the whole deletion now completes.
--
-- Tradeoff: the member's storage FILES (check-in photos, print cards, progress
-- photos, avatar) are left in their buckets — orphaned, not blocking. Purge them
-- out-of-band via the Storage API (the only path Supabase now allows). A follow-up
-- edge function should do this on delete for a clean GDPR erasure; until then it
-- just wastes storage.

DROP TRIGGER IF EXISTS trg_sweep_user_storage_on_profile_delete ON public.profiles;
DROP FUNCTION IF EXISTS public._sweep_user_storage_on_profile_delete();

NOTIFY pgrst, 'reload schema';
