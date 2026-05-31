-- ============================================================
-- 0469 — Re-assert corrected admin_create_member +
--        claim_imported_invite (fix LIVE age/sex/height bug)
-- ============================================================
-- A live-schema dump on 2026-05-30 revealed the versions of these two
-- functions currently in the database are the BUGGY intermediates: they
-- write age / sex / height_inches into `profiles`, where those columns
-- do NOT exist (they live on member_onboarding, added 0048). plpgsql
-- bodies are only validated at call time, so the functions sit there
-- looking fine and throw `column "age" does not exist` the first time:
--   • an admin adds a member        (admin_create_member)
--   • an imported member claims      (claim_imported_invite)
--
-- This migration re-applies the CORRECTED bodies (identical to the
-- fixed 0467/0468 on disk): age/sex/height_inches route to
-- member_onboarding, profiles gets only real columns. lookup_gym_invite_by_code
-- is included for completeness (unchanged from 0468 — placeholder-shadow aware).
--
-- Idempotent: pure CREATE OR REPLACE; safe to run more than once.
-- ============================================================

-- ── admin_create_member (corrected) ──
CREATE OR REPLACE FUNCTION public.admin_create_member(
  p_gym_id                UUID,
  p_full_name             TEXT,
  p_email                 TEXT,
  p_phone                 TEXT    DEFAULT NULL,
  p_membership_started_at TIMESTAMPTZ DEFAULT NULL,
  p_external_id           TEXT    DEFAULT NULL,
  p_admin_note            TEXT    DEFAULT NULL,
  p_age                   INT     DEFAULT NULL,
  p_sex                   TEXT    DEFAULT NULL,
  p_height_inches         NUMERIC DEFAULT NULL,
  p_weight_lbs            NUMERIC DEFAULT NULL,
  p_fitness_level         TEXT    DEFAULT NULL,
  p_primary_goal          TEXT    DEFAULT NULL,
  p_training_days         INT     DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_super     BOOLEAN;
  v_is_admin     BOOLEAN;
  v_new_id       UUID;
  v_username     TEXT;
  v_email        TEXT := lower(trim(p_email));
  v_phone        TEXT := NULLIF(trim(COALESCE(p_phone, '')), '');
BEGIN
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := (v_caller_role = 'admin'
                 OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));

  IF NOT (v_is_admin OR v_is_super) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  IF NOT v_is_super AND p_gym_id IS DISTINCT FROM v_caller_gym THEN
    RAISE EXCEPTION 'Cannot create members outside your gym';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM gyms WHERE id = p_gym_id) THEN
    RAISE EXCEPTION 'Gym not found';
  END IF;

  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = v_email AND email NOT LIKE '%@%.invalid'
  ) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;

  v_new_id := gen_random_uuid();
  v_username := 'member_' || substr(v_new_id::text, 1, 8);

  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    v_new_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'invite-' || v_new_id::text || '@invite.tugympr.invalid',
    NOW(),
    jsonb_build_object('provider', 'invited', 'providers', ARRAY['invited']),
    jsonb_build_object('full_name', p_full_name, 'pending_email', v_email),
    NOW(), NOW()
  );

  -- Shell profile — real columns only (NO age/sex/height_inches here).
  INSERT INTO profiles (
    id, gym_id, role, full_name, username,
    membership_status, is_onboarded,
    phone_number,
    qr_external_id, admin_note, membership_started_at
  ) VALUES (
    v_new_id, p_gym_id, 'member', trim(p_full_name), v_username,
    'active', false,
    v_phone,
    NULLIF(trim(COALESCE(p_external_id, '')), ''),
    NULLIF(trim(COALESCE(p_admin_note, '')), ''),
    p_membership_started_at
  );

  -- Fitness/body → member_onboarding (age/sex/height_inches live here).
  IF p_fitness_level IS NOT NULL
     OR p_primary_goal IS NOT NULL
     OR p_training_days IS NOT NULL
     OR p_weight_lbs IS NOT NULL
     OR p_age IS NOT NULL
     OR p_sex IS NOT NULL
     OR p_height_inches IS NOT NULL THEN
    INSERT INTO member_onboarding (
      profile_id, gym_id,
      fitness_level, primary_goal, training_days_per_week, initial_weight_lbs,
      age, sex, height_inches
    ) VALUES (
      v_new_id, p_gym_id,
      CASE WHEN p_fitness_level IS NULL OR p_fitness_level = ''
           THEN NULL ELSE p_fitness_level::fitness_level END,
      CASE WHEN p_primary_goal IS NULL OR p_primary_goal = ''
           THEN NULL ELSE p_primary_goal::fitness_goal END,
      p_training_days,
      p_weight_lbs,
      p_age,
      NULLIF(trim(COALESCE(p_sex, '')), ''),
      p_height_inches
    )
    ON CONFLICT (profile_id) DO UPDATE SET
      fitness_level          = EXCLUDED.fitness_level,
      primary_goal           = EXCLUDED.primary_goal,
      training_days_per_week = EXCLUDED.training_days_per_week,
      initial_weight_lbs     = EXCLUDED.initial_weight_lbs,
      age                    = EXCLUDED.age,
      sex                    = EXCLUDED.sex,
      height_inches          = EXCLUDED.height_inches;
  END IF;

  RETURN json_build_object(
    'id',        v_new_id,
    'email',     v_email,
    'username',  v_username,
    'full_name', trim(p_full_name)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_member(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT,
  INT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, INT
) TO authenticated;

-- ── claim_imported_invite (corrected) ──
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
    -- Re-home the shell's onboarding seed (incl. age/sex/height_inches, which
    -- live on member_onboarding — NOT profiles) BEFORE the shell + cascade is
    -- removed. The member's own onboarding, if already present, wins.
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

    -- Merge shell → auth profile. Only real profiles columns here.
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
