-- ============================================================
-- 0468 — claim_imported_invite: support admin-created shells
-- ============================================================
-- admin_create_member (0467) creates a SHADOW auth user (placeholder
-- email '…@invite.tugympr.invalid') + a shell profile, and the modal
-- sets gym_invites.used_by = the shell id. When the member later signs
-- up with their REAL email, Signup.jsx calls claim_imported_invite.
--
-- Two gaps in the 0466 version broke that path:
--
--   1. The "already used" guard treated ANY auth.users row at used_by
--      as a real claim. But our shadow IS an auth.users row, so the
--      code was rejected as "already used" before the member could
--      claim it. Fix: a placeholder-email shadow (…@*.invalid) does
--      NOT count as a real claim.
--
--   2. The merge copied full_name/phone/membership_started_at/DOB/
--      qr_external_id/admin_note but NOT the admin-entered age/sex/
--      height_inches, and it let the shell's member_onboarding seed get
--      cascade-deleted with the shell. Fix: also merge age/sex/
--      height_inches, and re-home the onboarding seed to the real user
--      first (ON CONFLICT DO NOTHING so the member's own onboarding,
--      if already present, wins).
--
--   3. lookup_gym_invite_by_code (0306) — the pre-auth signup validator
--      — filters `used_by IS NULL`, so an admin invite (used_by = shell)
--      was invisible at signup and the member could never enter their
--      code. Fix: also accept invites whose used_by points to a
--      placeholder-email shadow. Truly-claimed codes (real account at
--      used_by) stay hidden.
--
-- bulk-import shells (used_by NULL, found by phone + import_batch_id)
-- are unaffected — they never hit the first branch.
-- ============================================================

-- ── lookup_gym_invite_by_code: tolerate placeholder-shadow used_by ──
CREATE OR REPLACE FUNCTION public.lookup_gym_invite_by_code(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT json_build_object(
      'id',        gi.id,
      'code',      gi.invite_code,
      'gym_id',    gi.gym_id,
      'full_name', gi.member_name,
      'email',     gi.email,
      'phone',     gi.phone
    )
    FROM gym_invites gi
    WHERE gi.invite_code = upper(trim(p_code))
      AND (gi.expires_at IS NULL OR gi.expires_at > now())
      AND (
        gi.used_by IS NULL
        -- admin pre-create: used_by points at a placeholder shadow, which
        -- is not a real claim — the code is still redeemable.
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = gi.used_by
            AND u.email LIKE '%@%.invalid'
        )
      )
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_gym_invite_by_code(TEXT) TO anon, authenticated;

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
    -- A placeholder-email shadow (admin/import pre-create) does NOT count
    -- as a real claim — only a real account at used_by does.
    SELECT EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = v_invite.used_by
        AND email NOT LIKE '%@%.invalid'
    ) INTO v_already_real;

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
    -- Re-home the shell's onboarding seed to the real user BEFORE the
    -- shell (and its cascade) is removed. The member's own onboarding,
    -- if already present, wins (DO NOTHING).
    -- Re-home the shell's onboarding seed (incl. age/sex/height_inches, which
    -- live on member_onboarding — NOT profiles) to the real user BEFORE the
    -- shell + its cascade is removed. The member's own onboarding, if already
    -- present, wins (DO NOTHING).
    INSERT INTO member_onboarding (
      profile_id, gym_id, fitness_level, primary_goal,
      training_days_per_week, initial_weight_lbs, initial_body_fat_pct,
      available_equipment, injuries_notes, excluded_exercise_ids,
      age, sex, height_inches
    )
    SELECT v_uid, gym_id, fitness_level, primary_goal,
           training_days_per_week, initial_weight_lbs, initial_body_fat_pct,
           available_equipment, injuries_notes, excluded_exercise_ids,
           age, sex, height_inches
    FROM member_onboarding WHERE profile_id = v_shell.id
    ON CONFLICT (profile_id) DO NOTHING;

    -- Merge shell → auth profile. Only real profiles columns here
    -- (age/sex/height_inches are NOT on profiles — handled above).
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
      import_batch_id          = COALESCE(v_shell.import_batch_id,      auth_p.import_batch_id)
    WHERE auth_p.id = v_uid;

    -- Remove the shell + its shadow auth user (CASCADE wipes the shell
    -- profile). Best-effort: some deployments restrict auth.users deletes.
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
