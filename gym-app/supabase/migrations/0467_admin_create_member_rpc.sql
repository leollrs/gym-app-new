-- ============================================================
-- 0467 — admin_create_member RPC (shadow auth user + shell profile)
-- ============================================================
-- CreateInviteModal's "Add Member" did a DIRECT `profiles` INSERT that
-- could never succeed:
--   • it set profiles.email          — no such column (email is on
--                                       auth.users)
--   • it set initial_weight_lbs /     — none of these are profiles
--     fitness_level / primary_goal /    columns; they live on
--     training_days_per_week            member_onboarding
--   • it omitted `id`                 — profiles.id is a FK to
--                                       auth.users with NO default, so
--                                       the insert had no valid id
--
-- Design (mirrors bulk_import_members, 0422/0466 — the proven, app-
-- consistent pattern):
--   The member activates by SIGNING UP FRESH with their real email
--   (Signup.jsx → supabase.auth.signUp → claim_imported_invite). So we
--   must NOT occupy their real email on an auth user now, or signup
--   collides with "email already registered". Instead we mint a SHADOW
--   auth user with a placeholder email (satisfies the profiles.id FK),
--   attach a shell profile (so the member shows in the roster
--   immediately), and store the real email on gym_invites.email. When
--   the member signs up, claim_imported_invite merges the shell into
--   their real profile and deletes the shadow.
--
-- Authz: gym admin OR super_admin, honouring additional_roles (0332).
-- A non-super admin may only create members in their OWN gym.
--
-- Fitness/body fields are routed to member_onboarding (seed for the
-- overload engine pre-activation; the member's own onboarding wizard
-- supersedes them after they sign up).
-- ============================================================

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
  -- ── Authz: admin or super_admin (incl. additional_roles) ──
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

  -- Gym boundary: a non-super admin can only create in their own gym.
  IF NOT v_is_super AND p_gym_id IS DISTINCT FROM v_caller_gym THEN
    RAISE EXCEPTION 'Cannot create members outside your gym';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM gyms WHERE id = p_gym_id) THEN
    RAISE EXCEPTION 'Gym not found';
  END IF;

  -- ── Validate inputs ──
  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  -- Reject only if a REAL (non-placeholder) account already owns the
  -- email. Placeholder shadows (…@*.invalid) never block.
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = v_email AND email NOT LIKE '%@%.invalid'
  ) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;

  v_new_id := gen_random_uuid();

  -- Deterministic placeholder username (NOT NULL + UNIQUE(gym_id, username));
  -- the member picks a real one during onboarding.
  v_username := 'member_' || substr(v_new_id::text, 1, 8);

  -- ── Shadow auth user (placeholder email, never signed into) ──
  -- Real email lives on gym_invites.email; this row only satisfies the
  -- profiles.id FK and is deleted by claim_imported_invite on activation.
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

  -- ── Shell profile (real columns only) ──
  -- NOTE: age / sex / height_inches are NOT profiles columns — they live on
  -- member_onboarding (verified against live schema 2026-05-30). They're
  -- written below, not here.
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

  -- ── Fitness/body data → member_onboarding (only if any provided) ──
  -- age/sex/height_inches live here (added 0048), alongside the fitness
  -- fields. We seed whatever the admin entered.
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

NOTIFY pgrst, 'reload schema';
