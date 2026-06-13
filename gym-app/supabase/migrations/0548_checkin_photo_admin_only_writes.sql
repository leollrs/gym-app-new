-- ============================================================
-- 0548 — Check-in reference photo: trainers VIEW, only admins EDIT
-- ============================================================
-- 0454 let any trainer-of-record take/replace/delete a member's identity
-- photo. Product decision (2026-06-11): the reference photo is front-desk
-- material — gym admins manage it, trainers may only SEE it on the client
-- card. The trainer UI is already read-only (CheckinPhotoEditor canEdit
-- false); this enforces it server-side:
--   • set_checkin_photo RPC: drop the is_trainer_of() arm (admins only)
--   • storage: split the old can_manage helper into view (admin OR trainer)
--     vs manage (admin only); SELECT keeps trainers, INSERT/UPDATE/DELETE
--     become admin-only. Bodies otherwise verbatim from 0454.
-- ============================================================

-- ── 1. View helper: who may LOOK at a photo (signed URLs) ────────────────
CREATE OR REPLACE FUNCTION public.can_view_checkin_photo(p_object_name text)
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

  BEGIN
    v_subject := v_first::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Trainer of this subject may view.
  IF public.is_trainer_of(v_subject) THEN
    RETURN true;
  END IF;

  -- Admin of the subject's gym may view.
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

GRANT EXECUTE ON FUNCTION public.can_view_checkin_photo(text) TO authenticated;

-- ── 2. Manage helper: who may WRITE — admins only now ────────────────────
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

  BEGIN
    v_subject := v_first::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Admin of the subject's gym only (trainer arm removed in 0548).
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

-- ── 3. Storage policies: SELECT uses view; writes use manage ─────────────
DROP POLICY IF EXISTS "checkin_photos_staff_select" ON storage.objects;
CREATE POLICY "checkin_photos_staff_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'member-checkin-photos'
    AND public.can_view_checkin_photo(name)
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

-- ── 4. set_checkin_photo: admins only ────────────────────────────────────
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

  -- Admins of the member's gym only (trainer arm removed in 0548).
  IF NOT (public.is_admin() AND v_member_gym = public.current_gym_id()) THEN
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

NOTIFY pgrst, 'reload schema';
