-- Security fix: password complexity for admin_create_gym_member
-- and gym-boundary check for admin_delete_gym_member.

------------------------------------------------------------------------
-- 1. admin_create_gym_member — enforce minimum password length
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS admin_create_gym_member(TEXT, TEXT, TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION admin_create_gym_member(
  p_email     TEXT,
  p_password  TEXT,
  p_full_name TEXT,
  p_username  TEXT,
  p_gym_id    UUID,
  p_role      TEXT DEFAULT 'member'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  new_user_id UUID;
  encrypted_pw TEXT;
BEGIN
  -- Password complexity gate
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  -- Only super_admins may call this
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can create gym members';
  END IF;

  -- Validate role
  IF p_role NOT IN ('member', 'trainer', 'admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Validate gym exists
  IF NOT EXISTS (SELECT 1 FROM gyms WHERE id = p_gym_id) THEN
    RAISE EXCEPTION 'Gym not found';
  END IF;

  -- Check username not already taken in this gym
  IF EXISTS (SELECT 1 FROM profiles WHERE username = lower(p_username) AND gym_id = p_gym_id) THEN
    RAISE EXCEPTION 'Username already taken in this gym';
  END IF;

  -- Check email not already registered
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(p_email)) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;

  new_user_id := gen_random_uuid();
  encrypted_pw := crypt(p_password, gen_salt('bf'));

  -- Create auth user with all fields GoTrue expects
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    invited_at,
    confirmation_token,
    confirmation_sent_at,
    recovery_token,
    recovery_sent_at,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    last_sign_in_at,
    phone,
    phone_confirmed_at,
    phone_change,
    phone_change_token,
    phone_change_sent_at,
    email_change_token_current,
    email_change_confirm_status,
    banned_until,
    reauthentication_token,
    reauthentication_sent_at,
    is_sso_user
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    lower(p_email),
    encrypted_pw,
    NOW(),          -- email_confirmed_at
    NULL,           -- invited_at
    '',             -- confirmation_token
    NULL,           -- confirmation_sent_at
    '',             -- recovery_token
    NULL,           -- recovery_sent_at
    '',             -- email_change_token_new
    '',             -- email_change
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    FALSE,          -- is_super_admin (Supabase internal, not our app role)
    NOW(),
    NOW(),
    NULL,           -- last_sign_in_at
    NULL,           -- phone
    NULL,           -- phone_confirmed_at
    '',             -- phone_change
    '',             -- phone_change_token
    NULL,           -- phone_change_sent_at
    '',             -- email_change_token_current
    0,              -- email_change_confirm_status
    NULL,           -- banned_until
    '',             -- reauthentication_token
    NULL,           -- reauthentication_sent_at
    FALSE           -- is_sso_user
  );

  -- Create identity row with all fields GoTrue checks during login
  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object(
      'sub', new_user_id::text,
      'email', lower(p_email),
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    new_user_id::text,
    NOW(),
    NOW(),
    NOW()
  );

  -- Create profile
  INSERT INTO profiles (id, gym_id, full_name, username, role, is_onboarded)
  VALUES (new_user_id, p_gym_id, p_full_name, lower(p_username), p_role::user_role, false);

  RETURN json_build_object(
    'id',       new_user_id,
    'email',    lower(p_email),
    'username', lower(p_username),
    'role',     p_role
  );
END;
$$;

------------------------------------------------------------------------
-- 2. admin_delete_gym_member — add gym-boundary check
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS admin_delete_gym_member(UUID);

CREATE OR REPLACE FUNCTION admin_delete_gym_member(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can delete members';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Cannot delete a super admin account';
  END IF;

  -- Verify target member belongs to the admin's gym
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Member not found in your gym';
  END IF;

  -- Session data (deepest children first)
  DELETE FROM session_sets WHERE session_exercise_id IN (
    SELECT id FROM session_exercises WHERE session_id IN (
      SELECT id FROM workout_sessions WHERE profile_id = p_user_id));
  DELETE FROM session_exercises WHERE session_id IN (
    SELECT id FROM workout_sessions WHERE profile_id = p_user_id);
  DELETE FROM workout_sessions       WHERE profile_id = p_user_id;

  -- Progress & metrics
  DELETE FROM personal_records       WHERE profile_id = p_user_id;
  DELETE FROM pr_history             WHERE profile_id = p_user_id;
  DELETE FROM body_weight_logs       WHERE profile_id = p_user_id;
  DELETE FROM body_measurements      WHERE profile_id = p_user_id;
  DELETE FROM progress_photos        WHERE profile_id = p_user_id;
  DELETE FROM overload_suggestions   WHERE profile_id = p_user_id;
  DELETE FROM streak_cache           WHERE profile_id = p_user_id;

  -- Onboarding & nutrition
  DELETE FROM member_onboarding      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_targets      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_checkins     WHERE profile_id = p_user_id;
  DELETE FROM check_ins              WHERE profile_id = p_user_id;

  -- Social
  DELETE FROM feed_likes             WHERE profile_id = p_user_id;
  DELETE FROM feed_comments          WHERE profile_id = p_user_id;
  DELETE FROM activity_feed_items    WHERE actor_id   = p_user_id;
  DELETE FROM friendships            WHERE requester_id = p_user_id OR addressee_id = p_user_id;

  -- Challenges & achievements
  DELETE FROM challenge_score_events WHERE profile_id = p_user_id;
  DELETE FROM challenge_participants WHERE profile_id = p_user_id;
  DELETE FROM user_achievements      WHERE profile_id = p_user_id;
  DELETE FROM user_enrolled_programs WHERE profile_id = p_user_id;

  -- Routines
  DELETE FROM routine_exercises      WHERE routine_id IN (
    SELECT id FROM routines WHERE created_by = p_user_id);
  DELETE FROM routines               WHERE created_by = p_user_id;

  -- Misc
  DELETE FROM notifications          WHERE profile_id = p_user_id;
  DELETE FROM trainer_clients        WHERE trainer_id = p_user_id OR client_id = p_user_id;
  DELETE FROM churn_risk_scores      WHERE profile_id = p_user_id;
  DELETE FROM leaderboard_snapshots  WHERE profile_id = p_user_id;
  DELETE FROM gym_invites            WHERE created_by = p_user_id;

  -- Profile and auth user
  DELETE FROM profiles               WHERE id = p_user_id;
  DELETE FROM auth.users             WHERE id = p_user_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
