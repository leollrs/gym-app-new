-- =============================================================
-- Account deletion: cleanup for storage buckets added AFTER the
-- hardening pass in 0336/0339 (and the admin variant in 0341).
--
-- Codex audit flagged that:
--   * member-checkin-photos (added in 0454)
--   * print-cards
-- are NOT in the bucket list those functions clean up. Result:
-- orphaned PII storage objects survive account deletion, breaking
-- right-to-erasure (GDPR Art. 17).
--
-- Rather than redefine the 300-line delete_user_account function
-- twice (member-self path AND admin path), we install a BEFORE
-- DELETE trigger on profiles that removes the user's objects from
-- ANY bucket whose folder layout is `{uid}/...`. This covers both
-- code paths and future-proofs against bucket additions — as long
-- as buckets follow the per-user folder convention.
-- =============================================================

CREATE OR REPLACE FUNCTION public._sweep_user_storage_on_profile_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- New / late-added buckets the legacy delete functions miss.
  -- Listed explicitly so we don't accidentally wipe shared buckets
  -- (gym-logos, exercise-videos, etc.) where the path may also
  -- start with a user-shaped UUID.
  DELETE FROM storage.objects
  WHERE bucket_id IN (
          'member-checkin-photos',
          'print-cards'
        )
    AND (
          owner = OLD.id
          OR (storage.foldername(name))[1] = OLD.id::text
        );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sweep_user_storage_on_profile_delete ON profiles;
CREATE TRIGGER trg_sweep_user_storage_on_profile_delete
  BEFORE DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public._sweep_user_storage_on_profile_delete();

COMMENT ON FUNCTION public._sweep_user_storage_on_profile_delete() IS
  'Sweeps storage buckets added after the original delete_user_account
   hardening (0336/0339/0341). Fires on ANY profiles DELETE so both the
   self-delete and admin-delete paths are covered. Add new buckets here
   when introducing per-user storage.';
