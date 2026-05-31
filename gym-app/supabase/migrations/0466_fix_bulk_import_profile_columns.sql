-- ============================================================
-- 0466 — Fix bulk-import pipeline column references
-- ============================================================
-- Migration 0422 (bulk_import_members + claim_imported_invite) wrote
-- three columns that do NOT exist on `profiles`, so the whole import
-- path raised on the first row:
--
--   • profiles.email          — profiles has NO email column (login
--                               email lives on auth.users; imported
--                               email belongs on gym_invites.email).
--   • profiles.phone          — the real column is `phone_number`
--                               (added 0080).
--   (profiles.date_of_birth itself DOES exist — it's in 0001 — so the
--    birthday write was never the problem; only email + phone were.)
--
-- Fixes here:
--   1. Defensive ADD COLUMN IF NOT EXISTS date_of_birth (no-op on any
--      live DB since 0001 already has it; kept so this migration is
--      self-contained if replayed on an older snapshot).
--   2. Re-create bulk_import_members with:
--        - phone  -> phone_number
--        - drop the profiles.email write (email is already persisted on
--          gym_invites.email for active members; dedup by email now
--          checks gym_invites instead of the nonexistent profiles.email)
--        - keep date_of_birth (now real)
--   3. Re-create claim_imported_invite with the same column fixes
--      (phone -> phone_number, drop email merge, keep date_of_birth).
--
-- No behaviour change beyond making the pipeline actually run. Gates,
-- atomicity, shadow-auth-user handling, and the archived/active split
-- are all preserved from 0422.
-- ============================================================

-- ── 1. Real birthday column ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- ── 2. bulk_import_members (corrected) ──
CREATE OR REPLACE FUNCTION public.bulk_import_members(
  p_gym_id   UUID,
  p_rows     JSONB,
  p_label    TEXT DEFAULT NULL,
  p_filename TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          UUID := auth.uid();
  v_batch_id       UUID;
  v_row            JSONB;
  v_idx            INT := 0;
  v_active_count   INT := 0;
  v_archived_count INT := 0;
  v_skipped_count  INT := 0;
  v_errors         JSONB := '[]'::JSONB;
  v_status         TEXT;
  v_full_name      TEXT;
  v_phone          TEXT;
  v_email          TEXT;
  v_join_date      DATE;
  v_cancel_date    DATE;
  v_plan_name      TEXT;
  v_birthday       DATE;
  v_external_id    TEXT;
  v_profile_id     UUID;
  v_invite_code    TEXT;
  v_attempt        INT;
  v_code_exists    BOOLEAN;
  v_dup_check      INT;
BEGIN
  -- Gate: super-admin only.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required for bulk_import_members';
  END IF;

  IF p_gym_id IS NULL THEN
    RAISE EXCEPTION 'p_gym_id is required';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array, got %', jsonb_typeof(p_rows);
  END IF;

  INSERT INTO gym_import_batches (
    gym_id, created_by, label, source_filename, row_count
  ) VALUES (
    p_gym_id, v_actor, p_label, p_filename, jsonb_array_length(p_rows)
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;

    v_full_name   := NULLIF(trim(v_row->>'full_name'), '');
    v_status      := lower(NULLIF(trim(v_row->>'status'), ''));
    v_phone       := NULLIF(trim(v_row->>'phone'), '');
    v_email       := lower(NULLIF(trim(v_row->>'email'), ''));
    v_plan_name   := NULLIF(trim(v_row->>'plan_name'), '');
    v_external_id := NULLIF(trim(v_row->>'external_id'), '');

    BEGIN
      v_join_date := (v_row->>'join_date')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_join_date := NULL;
    END;
    BEGIN
      v_cancel_date := (v_row->>'cancellation_date')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_cancel_date := NULL;
    END;
    BEGIN
      v_birthday := (v_row->>'birthday')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_birthday := NULL;
    END;

    -- ── Validation ──
    IF v_full_name IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_errors := v_errors || jsonb_build_object(
        'row_index', v_idx, 'reason', 'missing_full_name'
      );
      CONTINUE;
    END IF;

    IF v_status NOT IN ('active', 'archived') THEN
      v_skipped_count := v_skipped_count + 1;
      v_errors := v_errors || jsonb_build_object(
        'row_index', v_idx, 'reason', 'invalid_status',
        'detail', COALESCE(v_status, '(null)')
      );
      CONTINUE;
    END IF;

    IF v_join_date IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_errors := v_errors || jsonb_build_object(
        'row_index', v_idx, 'reason', 'missing_or_invalid_join_date'
      );
      CONTINUE;
    END IF;

    IF v_status = 'active' AND v_phone IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_errors := v_errors || jsonb_build_object(
        'row_index', v_idx, 'reason', 'active_requires_phone'
      );
      CONTINUE;
    END IF;

    -- Duplicate check (active only). Phone lives on profiles.phone_number;
    -- email is not on profiles, so dedup email against gym_invites.email.
    IF v_status = 'active' THEN
      SELECT COUNT(*) INTO v_dup_check
      FROM profiles
      WHERE gym_id = p_gym_id
        AND imported_archived = false
        AND v_phone IS NOT NULL
        AND phone_number = v_phone;

      IF v_dup_check = 0 AND v_email IS NOT NULL THEN
        SELECT COUNT(*) INTO v_dup_check
        FROM gym_invites
        WHERE gym_id = p_gym_id
          AND lower(email) = v_email;
      END IF;

      IF v_dup_check > 0 THEN
        v_skipped_count := v_skipped_count + 1;
        v_errors := v_errors || jsonb_build_object(
          'row_index', v_idx, 'reason', 'duplicate_phone_or_email',
          'detail', COALESCE(v_phone, v_email)
        );
        CONTINUE;
      END IF;
    END IF;

    -- ── Provision a shadow auth.users row (placeholder email, never signed
    --    into; the member's real email lives on the invite below) ──
    v_profile_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      v_profile_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'import-' || v_profile_id::TEXT || '@import.tugympr.invalid',
      now(),
      jsonb_build_object('provider', 'imported', 'providers', ARRAY['imported']),
      jsonb_build_object('imported_batch', v_batch_id::TEXT),
      now(),
      now()
    );

    -- ── Insert the profile (no email column; phone_number not phone) ──
    INSERT INTO profiles (
      id, gym_id, role, full_name, username, phone_number,
      membership_status, is_onboarded,
      membership_started_at, date_of_birth, qr_external_id,
      imported_archived, legacy_cancellation_date, import_batch_id,
      admin_note
    ) VALUES (
      v_profile_id,
      p_gym_id, 'member', v_full_name,
      'imported_' || substr(v_profile_id::TEXT, 1, 8),
      v_phone,
      CASE WHEN v_status = 'active' THEN 'active' ELSE 'cancelled' END,
      CASE WHEN v_status = 'active' THEN false ELSE true END,
      v_join_date::TIMESTAMPTZ,
      v_birthday,
      v_external_id,
      v_status = 'archived',
      CASE WHEN v_status = 'archived' THEN v_cancel_date ELSE NULL END,
      v_batch_id,
      CASE WHEN v_plan_name IS NOT NULL
           THEN 'Imported plan: ' || v_plan_name
           ELSE NULL END
    );

    IF v_status = 'archived' THEN
      v_archived_count := v_archived_count + 1;
      CONTINUE;
    END IF;

    -- ── Active: generate an invite code ──
    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      IF v_attempt > 12 THEN
        RAISE EXCEPTION 'Could not generate a unique invite code after 12 attempts (row %)', v_idx;
      END IF;

      v_invite_code := public.generate_invite_code();

      SELECT EXISTS(
        SELECT 1 FROM gym_invites WHERE invite_code = v_invite_code
      ) INTO v_code_exists;

      EXIT WHEN NOT v_code_exists;
    END LOOP;

    INSERT INTO gym_invites (
      gym_id, created_by, invite_code,
      member_name, email, phone, role,
      expires_at
    ) VALUES (
      p_gym_id, v_actor, v_invite_code,
      v_full_name, v_email, v_phone, 'member',
      NULL
    );

    v_active_count := v_active_count + 1;
  END LOOP;

  UPDATE gym_import_batches
  SET imported_active_count   = v_active_count,
      imported_archived_count = v_archived_count,
      skipped_count           = v_skipped_count,
      skip_reasons            = CASE WHEN v_skipped_count > 0 THEN v_errors ELSE NULL END
  WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'imported_active', v_active_count,
    'imported_archived', v_archived_count,
    'skipped', v_skipped_count,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_members(UUID, JSONB, TEXT, TEXT) TO authenticated;

-- ── 3. claim_imported_invite (corrected) ──
CREATE OR REPLACE FUNCTION public.claim_imported_invite(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean         TEXT;
  v_uid           UUID := auth.uid();
  v_invite        RECORD;
  v_shell         RECORD;
  v_shell_found   BOOLEAN := false;
  v_already_real  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  v_clean := upper(regexp_replace(p_code, '[\s\-]', '', 'g'));

  SELECT * INTO v_invite
  FROM gym_invites
  WHERE upper(invite_code) = v_clean;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code not found');
  END IF;

  IF v_invite.used_by IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_invite.used_by)
      INTO v_already_real;

    IF v_already_real THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invite code has already been used');
    END IF;

    SELECT * INTO v_shell FROM profiles WHERE id = v_invite.used_by;
    v_shell_found := FOUND;
  END IF;

  -- Bulk-import path leaves used_by NULL: find the shell by phone_number
  -- match (profiles has no email column, so we can't match on email here).
  IF NOT v_shell_found THEN
    SELECT * INTO v_shell
    FROM profiles
    WHERE gym_id = v_invite.gym_id
      AND role = 'member'
      AND import_batch_id IS NOT NULL
      AND imported_archived = false
      AND id <> v_uid
      AND v_invite.phone IS NOT NULL
      AND phone_number = v_invite.phone
    ORDER BY created_at ASC
    LIMIT 1;
    v_shell_found := FOUND;
  END IF;

  IF v_shell_found THEN
    -- Merge shell → auth profile (no email column; phone_number not phone).
    UPDATE profiles AS auth_p
    SET
      gym_id                   = v_shell.gym_id,
      full_name                = COALESCE(NULLIF(auth_p.full_name, ''), v_shell.full_name),
      phone_number             = COALESCE(NULLIF(auth_p.phone_number, ''), v_shell.phone_number),
      role                     = 'member',
      membership_status        = 'active',
      membership_started_at    = COALESCE(auth_p.membership_started_at, v_shell.membership_started_at),
      date_of_birth            = COALESCE(auth_p.date_of_birth,         v_shell.date_of_birth),
      qr_external_id           = COALESCE(auth_p.qr_external_id,        v_shell.qr_external_id),
      admin_note               = COALESCE(auth_p.admin_note,            v_shell.admin_note),
      import_batch_id          = v_shell.import_batch_id
    WHERE auth_p.id = v_uid;

    BEGIN
      DELETE FROM auth.users WHERE id = v_shell.id;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        DELETE FROM profiles WHERE id = v_shell.id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  ELSE
    -- No shell — fall back to the standard claim path (phone_number).
    UPDATE profiles
    SET gym_id            = v_invite.gym_id,
        full_name         = COALESCE(NULLIF(full_name, ''), v_invite.member_name),
        phone_number      = COALESCE(NULLIF(phone_number, ''), v_invite.phone),
        role              = v_invite.role,
        membership_status = 'active'
    WHERE id = v_uid;
  END IF;

  UPDATE gym_invites
  SET used_by = v_uid, used_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'success',      true,
    'gym_id',       v_invite.gym_id,
    'role',         v_invite.role,
    'member_name',  v_invite.member_name,
    'merged_shell', v_shell_found
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_imported_invite(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
