-- ==========================================================================
-- 0454_member_checkin_photos.sql
-- Staff-managed CHECK-IN REFERENCE PHOTO.
--
-- A photo OF a member (or trainer-staff) that gym staff attach so the front
-- desk can verify identity at check-in ("¿es él? — sí, nítido"). This is NOT
-- the member's self-chosen profile avatar (profiles.avatar_url): members can
-- neither set NOR see this photo. It is added by:
--   • a gym admin   — for any member/trainer in their gym
--   • a trainer     — for their own assigned clients
--
-- Storage is a PRIVATE bucket (signed URLs only). Read/write is gated to the
-- same staff. Members have no policy granting access, so they can't even mint
-- a signed URL for their own photo.
--
-- Depends only on base tables (profiles, trainer_clients) and the auth helpers
-- public.is_admin(), public.current_gym_id(), public.is_trainer_of(uuid),
-- all of which exist since early migrations — so this stands alone and can be
-- applied independently of the 0450–0453 trainer-payment migrations.
-- ==========================================================================

-- =========================================================
-- 1. Columns on profiles
--    checkin_photo_path        — storage object key in the private bucket,
--                                always prefixed "{profile_id}/...". NULL = none.
--    checkin_photo_updated_at  — when it was last set (for "added on" + cache-bust).
-- =========================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS checkin_photo_path       text,
  ADD COLUMN IF NOT EXISTS checkin_photo_updated_at timestamptz;

-- =========================================================
-- 2. Private storage bucket
-- =========================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-checkin-photos',
  'member-checkin-photos',
  false,             -- PRIVATE: access only via signed URLs gated by RLS below
  5242880,           -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

-- =========================================================
-- 3. Access predicate helper
--    Given a storage object key "{subject_id}/file.jpg", return TRUE when the
--    CURRENT user may manage that subject's check-in photo:
--      • they are an active trainer of the subject, OR
--      • they are an admin of the subject's gym.
--    SECURITY DEFINER so it can read profiles/trainer_clients during policy
--    evaluation; identity still comes from auth.uid() inside the helpers.
-- =========================================================
CREATE OR REPLACE FUNCTION public.can_manage_checkin_photo(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first   text := (storage.foldername(p_object_name))[1];
  v_subject uuid;
BEGIN
  IF v_first IS NULL OR v_first = '' THEN
    RETURN false;
  END IF;

  -- First path segment must be a uuid (the subject profile id).
  BEGIN
    v_subject := v_first::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Trainer of this subject?
  IF public.is_trainer_of(v_subject) THEN
    RETURN true;
  END IF;

  -- Admin of the subject's gym?
  IF public.is_admin() AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_subject
      AND p.gym_id = public.current_gym_id()
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_checkin_photo(text) TO authenticated;

-- =========================================================
-- 4. Storage RLS policies (member-checkin-photos)
--    Staff-only for every verb. No member/self policy by design.
-- =========================================================
DROP POLICY IF EXISTS "checkin_photos_staff_select" ON storage.objects;
CREATE POLICY "checkin_photos_staff_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'member-checkin-photos'
    AND public.can_manage_checkin_photo(name)
  );

DROP POLICY IF EXISTS "checkin_photos_staff_insert" ON storage.objects;
CREATE POLICY "checkin_photos_staff_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'member-checkin-photos'
    AND public.can_manage_checkin_photo(name)
  );

DROP POLICY IF EXISTS "checkin_photos_staff_update" ON storage.objects;
CREATE POLICY "checkin_photos_staff_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'member-checkin-photos'
    AND public.can_manage_checkin_photo(name)
  )
  WITH CHECK (
    bucket_id = 'member-checkin-photos'
    AND public.can_manage_checkin_photo(name)
  );

DROP POLICY IF EXISTS "checkin_photos_staff_delete" ON storage.objects;
CREATE POLICY "checkin_photos_staff_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'member-checkin-photos'
    AND public.can_manage_checkin_photo(name)
  );

-- =========================================================
-- 5. set_checkin_photo(member, path)
--    Persists (or clears, when p_path IS NULL) the path on profiles.
--    Trainers can't UPDATE arbitrary client profiles under normal RLS, so the
--    column write goes through this SECURITY DEFINER RPC, which authorizes the
--    same staff as the storage policies and pins the path to the member folder.
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_checkin_photo(p_member_id uuid, p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          uuid := auth.uid();
  v_member_gym uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gym_id INTO v_member_gym FROM public.profiles WHERE id = p_member_id;
  IF v_member_gym IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF NOT (
    (public.is_admin() AND v_member_gym = public.current_gym_id())
    OR public.is_trainer_of(p_member_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to set check-in photo';
  END IF;

  -- A non-null path must live in the member's own folder.
  IF p_path IS NOT NULL AND p_path NOT LIKE (p_member_id::text || '/%') THEN
    RAISE EXCEPTION 'Invalid photo path for member';
  END IF;

  UPDATE public.profiles
  SET checkin_photo_path       = p_path,
      checkin_photo_updated_at = CASE WHEN p_path IS NULL THEN NULL ELSE now() END
  WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_checkin_photo(uuid, text) TO authenticated;
