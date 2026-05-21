-- ============================================================================
-- 0422: Bulk-import RPCs for the gym onboarding pipeline
--
--   - `bulk_import_members(p_gym_id, p_rows, p_label, p_filename)` —
--     atomically imports an array of member rows. Active members get a
--     pre-created profile + invite code (matching the existing single-
--     member CreateInviteModal flow). Archived members get a profile
--     marked `imported_archived=true` with no invite code (history only —
--     they feed retention analytics, never appear in active rosters).
--
--   - `claim_imported_invite(p_code)` — handles the "shell profile + new
--     auth user" merge that the existing `claim_invite_code` doesn't
--     cover. When a member signs up with the code we gave them at the
--     front desk, Supabase Auth creates a fresh auth user + bare profile.
--     This RPC copies the imported data (legacy join date, birthday,
--     plan, etc.) from the pre-created shell profile into the auth
--     profile, then deletes the shell.
-- ============================================================================

-- ── Helper: super-admin check ───────────────────────────────────────────────
-- Used as the gate on bulk_import_members. Kept local so changes to the global
-- is_admin() helper don't accidentally widen super-admin-only operations.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;


-- ── bulk_import_members ─────────────────────────────────────────────────────
-- Input p_rows is a JSONB array, each row matching the canonical schema:
--   {
--     "full_name":        TEXT      required
--     "status":           TEXT      required, 'active' or 'archived'
--     "phone":            TEXT      required if active, optional if archived
--     "email":            TEXT      optional
--     "join_date":        DATE      required (ISO YYYY-MM-DD)
--     "cancellation_date":DATE      optional, only meaningful for archived
--     "plan_name":        TEXT      optional
--     "birthday":         DATE      optional
--     "external_id":      TEXT      optional (gym keypad / membership #)
--   }
--
-- Returns: { batch_id, imported_active, imported_archived, skipped, errors }
-- where errors is a JSONB array of { row_index, reason, detail }.
--
-- Atomicity: the batch row + all profiles + all invites are inserted in a
-- single transaction (the function body is one). If any unrecoverable error
-- bubbles up (DB constraint, etc.) the whole import rolls back. Per-row
-- recoverable failures (duplicates, missing required fields) get pushed
-- into the `errors` array and the row is skipped — the rest still commit.
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
  -- Gate: super-admin only. Gym admins can't run imports — this is a
  -- vendor-managed onboarding step that ships gym data into the system.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required for bulk_import_members';
  END IF;

  IF p_gym_id IS NULL THEN
    RAISE EXCEPTION 'p_gym_id is required';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array, got %', jsonb_typeof(p_rows);
  END IF;

  -- Create the audit batch row up front so even if rows fail, we have a
  -- record that an attempt was made. Counts get updated at the end.
  INSERT INTO gym_import_batches (
    gym_id, created_by, label, source_filename, row_count
  ) VALUES (
    p_gym_id, v_actor, p_label, p_filename, jsonb_array_length(p_rows)
  )
  RETURNING id INTO v_batch_id;

  -- ── Row loop ────────────────────────────────────────────────────────────
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;

    -- Extract + normalize. NULLIF(trim(...), '') turns empty strings into
    -- nulls so optional fields don't get stored as whitespace.
    v_full_name   := NULLIF(trim(v_row->>'full_name'), '');
    v_status      := lower(NULLIF(trim(v_row->>'status'), ''));
    v_phone       := NULLIF(trim(v_row->>'phone'), '');
    v_email       := lower(NULLIF(trim(v_row->>'email'), ''));
    v_plan_name   := NULLIF(trim(v_row->>'plan_name'), '');
    v_external_id := NULLIF(trim(v_row->>'external_id'), '');

    -- Dates parse as NULL if missing or unparseable; we validate below.
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

    -- Duplicate check: same phone OR email within this gym, excluding
    -- already-archived imports (those don't conflict with new actives).
    -- We let archived-from-CSV land even if a live member exists with the
    -- same phone — they're different people in different times.
    IF v_status = 'active' THEN
      SELECT COUNT(*) INTO v_dup_check
      FROM profiles
      WHERE gym_id = p_gym_id
        AND imported_archived = false
        AND (
          (v_phone IS NOT NULL AND phone = v_phone)
          OR (v_email IS NOT NULL AND email = v_email)
        );

      IF v_dup_check > 0 THEN
        v_skipped_count := v_skipped_count + 1;
        v_errors := v_errors || jsonb_build_object(
          'row_index', v_idx, 'reason', 'duplicate_phone_or_email',
          'detail', COALESCE(v_phone, v_email)
        );
        CONTINUE;
      END IF;
    END IF;

    -- ── Provision a shadow auth.users row ──
    -- `profiles.id` has a FK to `auth.users(id) ON DELETE CASCADE`. We
    -- can't insert a profile without a matching auth user, so we mint a
    -- placeholder one per imported row. The placeholder has:
    --   - a UUID id we'll reuse for the profile
    --   - a placeholder email (unique, never sent to) so the FK is
    --     satisfied and Supabase's unique-email constraint doesn't clash
    --     with the member's real email when they sign up for real
    --   - no encrypted_password, email_confirmed_at set so it's "active"
    --     (won't trigger Supabase email-verification flows on its own)
    --
    -- This shadow user is NEVER signed into. When the member runs the
    -- claim flow at the front desk, they sign up with their REAL email,
    -- get a separate real auth user + profile, and claim_imported_invite
    -- merges the shell profile (this shadow's profile) into the real one
    -- and cleans up the shadow auth user.
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

    -- ── Insert the profile ──
    -- Active: live shell that the member will claim at the front desk.
    -- Archived: history-only, never claimed, feeds retention analytics.
    INSERT INTO profiles (
      id, gym_id, role, full_name, username, email, phone,
      membership_status, is_onboarded,
      membership_started_at, date_of_birth, qr_external_id,
      imported_archived, legacy_cancellation_date, import_batch_id,
      admin_note
    ) VALUES (
      v_profile_id,
      p_gym_id, 'member', v_full_name,
      -- profiles.username has a NOT NULL + UNIQUE(gym_id, username)
      -- constraint. Use a deterministic placeholder based on the new
      -- profile id; the member picks a real username during onboarding
      -- claim. Suffixing with a short id slice keeps collisions out.
      'imported_' || substr(v_profile_id::TEXT, 1, 8),
      v_email, v_phone,
      CASE WHEN v_status = 'active' THEN 'active' ELSE 'cancelled' END,
      CASE WHEN v_status = 'active' THEN false ELSE true END,
      -- is_onboarded=true for archived so they never trigger onboarding
      -- gap counters or "incomplete profile" admin nags.
      v_join_date::TIMESTAMPTZ,
      v_birthday,
      v_external_id,
      v_status = 'archived',
      CASE WHEN v_status = 'archived' THEN v_cancel_date ELSE NULL END,
      v_batch_id,
      -- Stash the plan name in admin_note for now so we don't lose it.
      -- A dedicated plan_name column would be nicer but plan data is
      -- low-signal (free text from chaotic source CSVs) and stuffing it
      -- in admin_note keeps the schema lean.
      CASE WHEN v_plan_name IS NOT NULL
           THEN 'Imported plan: ' || v_plan_name
           ELSE NULL END
    );

    IF v_status = 'archived' THEN
      v_archived_count := v_archived_count + 1;
      CONTINUE;  -- archived members get no invite code
    END IF;

    -- ── Active: generate an invite code ──
    -- Same alphabet + length as generate_invite_code() so codes from
    -- imports are indistinguishable from admin-created ones at the desk.
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
      -- No expiry on imported codes — members may take months to come in
      -- and claim their account. We'd rather a stale code than a member
      -- showing up six months later to discover their access expired.
      NULL
    );

    v_active_count := v_active_count + 1;
  END LOOP;

  -- Update batch totals
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


-- ── claim_imported_invite ──────────────────────────────────────────────────
-- The existing `claim_invite_code` mutates the caller's own profile (the
-- one Supabase Auth + signUp just created). It works fine for the legacy
-- CreateInviteModal flow because that flow doesn't actually pre-create a
-- profile the member needs to inherit — it stores extras (membership
-- started, external_id, etc.) on the invite, not on a shell profile.
--
-- The bulk-import flow IS different: we DO pre-create a shell profile
-- with the legacy join date, birthday, plan, external_id, all in one
-- record. When the imported member signs up, Supabase makes them a fresh
-- profile row. This RPC merges the shell's data into the new auth
-- profile and removes the shell so the gym doesn't end up with ghost
-- duplicates.
--
-- For non-imported codes (i.e., gym_invites with no linked shell), this
-- RPC delegates to the existing claim_invite_code so callers can use one
-- entry point regardless of where the code came from.
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

  -- "Already used" handling. v_invite.used_by being non-null doesn't
  -- automatically mean the code is spent — the legacy CreateInviteModal
  -- pre-sets used_by to a shell profile (no auth.users row) so the admin
  -- can see the member in the roster immediately. A code is only TRULY
  -- claimed when used_by points to an auth.users row. Otherwise it's a
  -- shell pointer we'll merge below.
  IF v_invite.used_by IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_invite.used_by)
      INTO v_already_real;

    IF v_already_real THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invite code has already been used');
    END IF;

    -- used_by points at a shell — fetch it directly. This is the legacy
    -- CreateInviteModal path; we still want to merge into the auth profile.
    SELECT * INTO v_shell FROM profiles WHERE id = v_invite.used_by;
    v_shell_found := FOUND;
  END IF;

  -- If used_by wasn't set (the bulk-import path leaves it NULL), look for
  -- a shell by matching phone/email + import_batch_id. Same merge logic
  -- applies; just a different way of finding the shell.
  IF NOT v_shell_found THEN
    SELECT * INTO v_shell
    FROM profiles
    WHERE gym_id = v_invite.gym_id
      AND role = 'member'
      AND import_batch_id IS NOT NULL
      AND imported_archived = false
      AND id <> v_uid
      AND (
        (v_invite.phone IS NOT NULL AND phone = v_invite.phone)
        OR (v_invite.email IS NOT NULL AND email = v_invite.email)
      )
    ORDER BY created_at ASC
    LIMIT 1;
    v_shell_found := FOUND;
  END IF;

  IF v_shell_found THEN
    -- Merge shell → auth profile. Copy every field the import pipeline
    -- writes; leave auth-managed fields (id, created_at, terms acceptance,
    -- DOB if user provided their own at signup) untouched.
    UPDATE profiles AS auth_p
    SET
      gym_id                   = v_shell.gym_id,
      full_name                = COALESCE(NULLIF(auth_p.full_name, ''), v_shell.full_name),
      phone                    = COALESCE(NULLIF(auth_p.phone, ''),     v_shell.phone),
      email                    = COALESCE(auth_p.email,                 v_shell.email),
      role                     = 'member',
      membership_status        = 'active',
      membership_started_at    = COALESCE(auth_p.membership_started_at, v_shell.membership_started_at),
      date_of_birth            = COALESCE(auth_p.date_of_birth,         v_shell.date_of_birth),
      qr_external_id           = COALESCE(auth_p.qr_external_id,        v_shell.qr_external_id),
      admin_note               = COALESCE(auth_p.admin_note,            v_shell.admin_note),
      import_batch_id          = v_shell.import_batch_id
    WHERE auth_p.id = v_uid;

    -- Drop the shell profile AND the shadow auth user that was minted
    -- for it during bulk_import_members. The CASCADE on profiles.id
    -- (FK to auth.users with ON DELETE CASCADE) means deleting the auth
    -- row also wipes the profile in one step. Wrapped in BEGIN/EXCEPTION
    -- because some Supabase deployments restrict direct auth.users
    -- deletes — if it fails, we still leave the shell profile orphaned
    -- which is recoverable, vs. the merge above which is the load-bearing
    -- step. Worst case: a placeholder auth user lingers harmlessly.
    BEGIN
      DELETE FROM auth.users WHERE id = v_shell.id;
    EXCEPTION WHEN OTHERS THEN
      -- Try just the profile if auth.users delete fails (e.g., no perms)
      BEGIN
        DELETE FROM profiles WHERE id = v_shell.id;
      EXCEPTION WHEN OTHERS THEN
        NULL; -- swallow; merge already happened, cleanup is best-effort
      END;
    END;
  ELSE
    -- No shell — fall back to the existing claim path so non-imported
    -- codes still work through this entry point.
    UPDATE profiles
    SET gym_id            = v_invite.gym_id,
        full_name         = COALESCE(NULLIF(full_name, ''), v_invite.member_name),
        phone             = COALESCE(NULLIF(phone, ''),     v_invite.phone),
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


COMMENT ON FUNCTION public.bulk_import_members(UUID, JSONB, TEXT, TEXT) IS
  'Atomic CSV bulk import. Super-admin only. Creates pre-populated profiles for active members (with invite codes) and history-only profiles for archived members (no invite). All-or-nothing for unrecoverable errors; per-row recoverable errors are returned in the errors array.';

COMMENT ON FUNCTION public.claim_imported_invite(TEXT) IS
  'Claim flow for imported invite codes. Merges the pre-created shell profile (with legacy join date, birthday, etc.) into the auth user''s profile and removes the shell. Falls back to the standard claim path for non-imported codes.';

NOTIFY pgrst, 'reload schema';
