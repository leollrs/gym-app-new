-- =============================================================
-- 0551_platform_integration_fixes.sql
--
-- Fix wave from the 2026-06-12 platform integration audit:
--
--   1. admin_delete_gym_member (0354) — the final audit insert used
--      columns that don't exist on admin_audit_log (admin_id/target_type/
--      target_id vs actor_id/entity_type/entity_id) and its guard only
--      caught undefined_table, so 42703 aborted the WHOLE function:
--      every member delete (admin MemberDetail + platform GymDetail)
--      has failed since 0354. Recreated with the audit written through
--      the canonical log_admin_action (0543) — which dual-writes
--      admin_audit_log AND the platform audit_log, never throws.
--
--   2. platform_config RLS (0277/0279) checked profiles.role directly,
--      ignoring additional_roles — an additional-roles super admin
--      couldn't read/flip kill switches or maintenance. → is_super_admin().
--
--   3. print_cards super-admin RLS (0430) — same primary-role-only flaw;
--      an additional-roles super admin saw an empty CardQueue.
--
--   4. gym_branding — super_admin could SELECT all (0040) but had no
--      INSERT/UPDATE arm, so the platform tier couldn't edit a gym's
--      branding. Adds a super_admin ALL policy (the new platform
--      branding editor in GymSettingsTab writes through it).
--
--   5. claim_imported_invite (0468) — hardening: (a) never checked
--      expires_at (the signup UI filters expired codes via
--      lookup_gym_invite_by_code, but a direct RPC call could claim an
--      expired owner invite); (b) the final used_by write had no race
--      guard (two concurrent claimers could both pass the "already
--      used" check); (c) the no-shell fallback copied v_invite.role
--      verbatim — the 0022 CHECK caps it at member/trainer, but
--      whitelist explicitly so a future CHECK relaxation can't turn
--      this into an escalation path. Claim is now claimed-first
--      (atomic), then merged.
--
--   6. get_platform_flags (0547) + new 'ai' kill switch — the AI photo
--      surfaces (food/body/menu → OpenAI) are the only direct per-call
--      spend and had no switch (body scan wasn't behind ANY flag).
--      Adds feature_ai to the RPC + seeds the config row so the
--      Operations page lists it.
--
--   7. Owner-invite claimed → notify super admins. The gym handoff
--      stalls on the founder polling GymDetail to notice the owner
--      signed up (then promote + set owner). Trigger on gym_invites
--      fires _notify_push (in-app + native push, EN/ES) when an
--      'Owner' invite gets claimed by a real account.
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS + guarded seed.
-- Apply manually (supabase db push or SQL editor).
-- =============================================================


-- ───────────────────────────────────────────────────────────────
-- 1. admin_delete_gym_member — fix the fatal audit insert
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_gym_member(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_gym UUID;
  v_target_gym UUID;
  v_target_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.is_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only admins can delete members';
  END IF;

  SELECT gym_id, role INTO v_target_gym, v_target_role
    FROM profiles WHERE id = p_user_id;

  IF v_target_gym IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_target_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot delete a super admin account';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account here';
  END IF;

  -- Gym admin can only delete members in their own gym
  IF NOT public.is_super_admin() THEN
    SELECT gym_id INTO v_caller_gym
      FROM public.profile_lookup WHERE id = auth.uid();

    IF v_caller_gym IS NULL OR v_caller_gym <> v_target_gym THEN
      RAISE EXCEPTION 'Member not found in your gym';
    END IF;

    IF v_target_role = 'admin' THEN
      RAISE EXCEPTION 'Only super admins can delete other admins';
    END IF;
  END IF;

  -- Session data (deepest children first) — verbatim from 0354
  DELETE FROM session_sets WHERE session_exercise_id IN (
    SELECT id FROM session_exercises WHERE session_id IN (
      SELECT id FROM workout_sessions WHERE profile_id = p_user_id));
  DELETE FROM session_exercises WHERE session_id IN (
    SELECT id FROM workout_sessions WHERE profile_id = p_user_id);
  DELETE FROM workout_sessions       WHERE profile_id = p_user_id;

  DELETE FROM personal_records       WHERE profile_id = p_user_id;
  DELETE FROM pr_history             WHERE profile_id = p_user_id;
  DELETE FROM body_weight_logs       WHERE profile_id = p_user_id;
  DELETE FROM body_measurements      WHERE profile_id = p_user_id;
  DELETE FROM progress_photos        WHERE profile_id = p_user_id;
  DELETE FROM overload_suggestions   WHERE profile_id = p_user_id;
  DELETE FROM streak_cache           WHERE profile_id = p_user_id;

  DELETE FROM member_onboarding      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_targets      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_checkins     WHERE profile_id = p_user_id;
  DELETE FROM check_ins              WHERE profile_id = p_user_id;

  DELETE FROM feed_likes             WHERE profile_id = p_user_id;
  DELETE FROM feed_comments          WHERE profile_id = p_user_id;
  DELETE FROM activity_feed_items    WHERE actor_id   = p_user_id;
  DELETE FROM friendships            WHERE requester_id = p_user_id OR addressee_id = p_user_id;

  DELETE FROM challenge_score_events WHERE profile_id = p_user_id;
  DELETE FROM challenge_participants WHERE profile_id = p_user_id;
  DELETE FROM user_achievements      WHERE profile_id = p_user_id;
  DELETE FROM user_enrolled_programs WHERE profile_id = p_user_id;

  DELETE FROM routine_exercises      WHERE routine_id IN (
    SELECT id FROM routines WHERE created_by = p_user_id);
  DELETE FROM routines               WHERE created_by = p_user_id;

  DELETE FROM notifications          WHERE profile_id = p_user_id;
  DELETE FROM trainer_clients        WHERE trainer_id = p_user_id OR client_id = p_user_id;
  DELETE FROM churn_risk_scores      WHERE profile_id = p_user_id;
  DELETE FROM leaderboard_snapshots  WHERE profile_id = p_user_id;
  DELETE FROM gym_invites            WHERE created_by = p_user_id;

  DELETE FROM profiles               WHERE id = p_user_id;
  DELETE FROM auth.users             WHERE id = p_user_id;

  -- Audit through the canonical dual-writer (0543): lands in
  -- admin_audit_log (gym admins) AND audit_log (platform AuditLog),
  -- correctly attributed to the target gym. log_admin_action swallows
  -- its own errors; the extra guard covers a missing function.
  BEGIN
    PERFORM public.log_admin_action(
      'delete_member',
      'member',
      p_user_id,
      jsonb_build_object('deleted_role', v_target_role),
      v_target_gym
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- audit must never break (or roll back) the deletion
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_gym_member(UUID) TO authenticated;


-- ───────────────────────────────────────────────────────────────
-- 2. platform_config policies → is_super_admin() (additional_roles-aware)
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "super_admin_select_platform_config" ON platform_config;
DROP POLICY IF EXISTS "super_admin_all_platform_config"    ON platform_config;

CREATE POLICY "super_admin_select_platform_config" ON platform_config
  FOR SELECT USING (public.is_super_admin());

CREATE POLICY "super_admin_all_platform_config" ON platform_config
  FOR ALL USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ───────────────────────────────────────────────────────────────
-- 3. print_cards super-admin policies → is_super_admin()
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS print_cards_super_admin_read   ON print_cards;
DROP POLICY IF EXISTS print_cards_super_admin_update ON print_cards;

CREATE POLICY print_cards_super_admin_read
  ON print_cards FOR SELECT USING (public.is_super_admin());

CREATE POLICY print_cards_super_admin_update
  ON print_cards FOR UPDATE USING (public.is_super_admin());


-- ───────────────────────────────────────────────────────────────
-- 4. gym_branding — super_admin write arm (platform branding editor)
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS gym_branding_super_admin_all ON gym_branding;

CREATE POLICY gym_branding_super_admin_all
  ON gym_branding FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ───────────────────────────────────────────────────────────────
-- 5. claim_imported_invite — expiry check, atomic claim, role whitelist
-- ───────────────────────────────────────────────────────────────
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
  v_claimed       INT;
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

  -- NEW (0551): the signup UI filters expired codes via
  -- lookup_gym_invite_by_code, but the claim itself never checked.
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code has expired');
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
  END IF;

  -- NEW (0551): claim FIRST, atomically. Two concurrent claimers both
  -- snapshot the same used_by; only one passes this guarded update.
  UPDATE gym_invites
  SET used_by = v_uid, used_at = now()
  WHERE id = v_invite.id
    AND used_by IS NOT DISTINCT FROM v_invite.used_by;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code has already been used');
  END IF;

  -- Shell discovery — from the SNAPSHOT (v_invite.used_by still holds
  -- the shadow pointer; the row itself now points at the claimer).
  IF v_invite.used_by IS NOT NULL THEN
    SELECT * INTO v_shell FROM profiles WHERE id = v_invite.used_by;
    v_shell_found := FOUND;
  END IF;

  -- Bulk-import path leaves used_by NULL: find the shell by phone_number.
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
    -- Re-home the shell's onboarding seed (incl. age/sex/height_inches,
    -- which live on member_onboarding — NOT profiles) to the real user
    -- BEFORE the shell + its cascade is removed. The member's own
    -- onboarding, if already present, wins (DO NOTHING).
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
    -- No shell — standard claim. NEW (0551): whitelist the role copy.
    -- The 0022 CHECK already caps invites at member/trainer; this makes
    -- the cap local so a future CHECK relaxation can't escalate here.
    UPDATE profiles
    SET gym_id            = v_invite.gym_id,
        full_name         = COALESCE(NULLIF(full_name, ''), v_invite.member_name),
        phone_number      = COALESCE(NULLIF(phone_number, ''), v_invite.phone),
        role              = CASE WHEN v_invite.role IN ('member', 'trainer')
                                 THEN v_invite.role ELSE 'member' END,
        membership_status = 'active'
    WHERE id = v_uid;
  END IF;

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


-- ───────────────────────────────────────────────────────────────
-- 6. get_platform_flags + 'ai' kill switch
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_platform_flags()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'referrals',  COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_referrals'),  'true') <> 'false',
    'classes',    COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_classes'),    'true') <> 'false',
    'social',     COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_social'),     'true') <> 'false',
    'messaging',  COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_messaging'),  'true') <> 'false',
    'qr',         COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_qr'),         'true') <> 'false',
    'challenges', COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_challenges'), 'true') <> 'false',
    'nutrition',  COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_nutrition'),  'true') <> 'false',
    'ai',         COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_ai'),         'true') <> 'false'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_flags() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_flags() TO anon, authenticated;

-- Seed the row so the Operations page (which lists feature_% rows) shows it.
INSERT INTO platform_config (key, value)
VALUES ('feature_ai', to_jsonb('true'::text))
ON CONFLICT (key) DO NOTHING;


-- ───────────────────────────────────────────────────────────────
-- 7. Owner-invite claimed → notify super admins (push + in-app)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_super_admins_on_owner_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin    RECORD;
  v_gym_name TEXT;
  v_is_real  BOOLEAN;
  v_body     TEXT;
BEGIN
  -- Only the platform-created owner invite (platform_create_gym writes
  -- member_name = 'Owner'), and only on a genuine claim transition.
  IF COALESCE(NEW.member_name, '') <> 'Owner'
     OR NEW.used_by IS NULL
     OR NEW.used_by IS NOT DISTINCT FROM OLD.used_by THEN
    RETURN NEW;
  END IF;

  -- Shadow/placeholder accounts are pre-creates, not real claims.
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = NEW.used_by AND email NOT LIKE '%@%.invalid'
  ) INTO v_is_real;
  IF NOT v_is_real THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_gym_name FROM public.gyms WHERE id = NEW.gym_id;
  v_body := COALESCE(NULLIF(v_gym_name, ''), '—');

  FOR v_admin IN
    SELECT id, gym_id
    FROM public.profiles
    WHERE role = 'super_admin'
       OR 'super_admin'::user_role = ANY(additional_roles)
  LOOP
    PERFORM public._notify_push(
      v_admin.id,
      COALESCE(v_admin.gym_id, NEW.gym_id),
      'super_admin'::user_role,
      'system_alert'::notification_type,
      'Gym owner signed up',
      v_body || ' — the owner claimed their invite. Promote them to admin and set them as owner.',
      'El dueño del gimnasio se registró',
      v_body || ' — el dueño canjeó su invitación. Promuévelo a admin y márcalo como dueño.',
      jsonb_build_object(
        'route',  '/platform/gym/' || NEW.gym_id::text,
        'gym_id', NEW.gym_id,
        'invite_id', NEW.id
      ),
      'ownerclaim:' || NEW.id::text || ':' || v_admin.id::text
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let notifying break the claim itself.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_owner_claim ON gym_invites;
CREATE TRIGGER trg_notify_owner_claim
  AFTER UPDATE ON gym_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_on_owner_claim();


-- ───────────────────────────────────────────────────────────────
-- 8. gyms_public — expose registration_mode so the signup page can
--    enforce invite-only gyms (0118 added the column; nothing ever
--    enforced it — open slug signups into invite-only gyms were the
--    duplicate-profile vector for imported rosters). Appended column
--    (CREATE OR REPLACE VIEW only allows additions at the end);
--    security_invoker preserved from 0233, grants from 0110.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.gyms_public
  WITH (security_barrier = true, security_invoker = on)
AS
  SELECT id, name, slug, is_active, registration_mode
  FROM public.gyms
  WHERE is_active = TRUE;

GRANT SELECT ON public.gyms_public TO anon;
GRANT SELECT ON public.gyms_public TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────────
-- 9. Dashboard + TV challenge cards showed DRAFT challenges.
--    get_dashboard_data (0249) and tv_get_dashboard_data (0518)
--    pick challenges purely by dates — a draft with current dates
--    surfaced on the member Dashboard card and the gym TV board even
--    though lifecycle/broadcast/prizes ignore drafts. Both recreated
--    VERBATIM from their latest definitions + one status filter each.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_data()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid       UUID := auth.uid();
  _gym_id    UUID;
  _result    JSON;
BEGIN
  SELECT gym_id INTO _gym_id
    FROM profiles
   WHERE id = _uid;

  SELECT json_build_object(
    -- Recent completed sessions (last 50)
    'sessions', (
      SELECT COALESCE(json_agg(s ORDER BY s.completed_at DESC), '[]'::json)
        FROM (
          SELECT id, name, completed_at, total_volume_lbs,
                 duration_seconds, routine_id
            FROM workout_sessions
           WHERE profile_id = _uid
             AND status = 'completed'
           ORDER BY completed_at DESC
           LIMIT 50
        ) s
    ),

    -- User's routines with exercises (now includes rest_seconds)
    'routines', (
      SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json)
        FROM (
          SELECT r.id, r.name, r.description, r.created_at,
                 (
                   SELECT COALESCE(json_agg(
                     json_build_object(
                       'id',           re.id,
                       'exercise_id',  re.exercise_id,
                       'target_sets',  re.target_sets,
                       'target_reps',  re.target_reps,
                       'rest_seconds', re.rest_seconds,
                       'position',     re.position,
                       'exercises',   json_build_object(
                         'name',      e.name,
                         'name_es',   e.name_es,
                         'video_url', e.video_url
                       )
                     ) ORDER BY re.position
                   ), '[]'::json)
                   FROM routine_exercises re
                   LEFT JOIN exercises e ON e.id = re.exercise_id
                  WHERE re.routine_id = r.id
                 ) AS routine_exercises
            FROM routines r
           WHERE r.created_by = _uid
             AND r.is_template = FALSE
           ORDER BY r.created_at DESC
        ) r
    ),

    -- Workout schedule
    'schedule', (
      SELECT COALESCE(json_agg(
        json_build_object('day_of_week', ws.day_of_week, 'routine_id', ws.routine_id)
      ), '[]'::json)
        FROM workout_schedule ws
       WHERE ws.profile_id = _uid
    ),

    -- Active generated program (not expired)
    'program', (
      SELECT row_to_json(p)
        FROM (
          SELECT id, program_start, split_type, expires_at, routines_a_count, duration_weeks, schedule_map
            FROM generated_programs
           WHERE profile_id = _uid
             AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 1
        ) p
    ),

    -- Gym hours
    'gym_hours', (
      SELECT COALESCE(json_agg(
        json_build_object('day_of_week', gh.day_of_week, 'is_closed', gh.is_closed)
      ), '[]'::json)
        FROM gym_hours gh
       WHERE gh.gym_id = _gym_id
    ),

    -- Streak cache
    'streak', (
      SELECT row_to_json(sc)
        FROM (
          SELECT current_streak_days, longest_streak_days
            FROM streak_cache
           WHERE profile_id = _uid
        ) sc
    ),

    -- Reward points (current balance + lifetime)
    'points', (
      SELECT row_to_json(rp)
        FROM (
          SELECT total_points, lifetime_points
            FROM reward_points
           WHERE profile_id = _uid
        ) rp
    ),

    -- Active challenge for the user's gym
    'challenge', (
      SELECT row_to_json(c)
        FROM (
          SELECT id, name, type, start_date, end_date
            FROM challenges
           WHERE gym_id = _gym_id
             AND start_date <= NOW()
             AND end_date   >= NOW()
             AND status = 'active'  -- 0551: drafts/archived must not surface on the Dashboard card
           ORDER BY start_date ASC
           LIMIT 1
        ) c
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION public.tv_get_dashboard_data(p_code text, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings    RECORD;
  v_gym_id      UUID;
  v_revoked     TIMESTAMPTZ;
  v_exists      BOOLEAN;
  v_period      TEXT;
  v_since       TIMESTAMPTZ;
  v_volume      JSONB;
  v_workouts    JSONB;
  v_prs         JSONB;
  v_improved    JSONB;
  v_consistency JSONB;
  v_checkins    JSONB;
  v_challenges  JSONB;
BEGIN
  SELECT * INTO v_settings FROM gym_tv_settings WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;
  v_gym_id := v_settings.gym_id;

  -- Chosen window for the count-based boards.
  v_period := COALESCE(v_settings.tv_period, 'month');
  v_since := CASE v_period
    WHEN 'today' THEN date_trunc('day', now())
    WHEN 'week'  THEN now() - interval '7 days'
    WHEN 'month' THEN now() - interval '30 days'
    WHEN '90d'   THEN now() - interval '90 days'
    WHEN 'all'   THEN 'epoch'::timestamptz
    ELSE now() - interval '30 days'
  END;

  -- ── Per-session revoke gate ──
  SELECT revoked_at INTO v_revoked
  FROM gym_tv_sessions
  WHERE gym_id = v_gym_id AND session_id = p_session_id;
  v_exists := FOUND;
  IF v_exists AND v_revoked IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'revoked');
  END IF;

  -- Heartbeat (only for non-revoked sessions).
  IF v_exists THEN
    UPDATE gym_tv_sessions
    SET last_heartbeat_at = now()
    WHERE gym_id = v_gym_id AND session_id = p_session_id;
  ELSE
    INSERT INTO gym_tv_sessions (gym_id, session_id)
    VALUES (v_gym_id, p_session_id)
    ON CONFLICT (gym_id, session_id) DO UPDATE SET last_heartbeat_at = now();
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_volume FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND(SUM(ws.total_volume_lbs)::NUMERIC) AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    HAVING SUM(ws.total_volume_lbs) > 0
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_workouts FROM (
    SELECT ws.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_prs FROM (
    SELECT pr.profile_id AS id, p.full_name AS name,
           ROUND(MAX(pr.estimated_1rm)::NUMERIC) AS score
    FROM personal_records pr JOIN profiles p ON p.id = pr.profile_id
    WHERE p.gym_id = v_gym_id
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY pr.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_improved FROM (
    WITH this_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now())
      GROUP BY ws.profile_id
    ), last_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now() - interval '1 month')
        AND ws.started_at <  date_trunc('month', now())
      GROUP BY ws.profile_id
    )
    SELECT tm.profile_id AS id, p.full_name AS name,
           ROUND(((tm.vol - lm.vol) / NULLIF(lm.vol, 0) * 100)::NUMERIC) AS score
    FROM this_month tm JOIN last_month lm ON lm.profile_id = tm.profile_id
    JOIN profiles p ON p.id = tm.profile_id
    WHERE lm.vol > 0 AND tm.vol > lm.vol
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_consistency FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND((COUNT(DISTINCT date_trunc('day', ws.started_at))::NUMERIC
             / GREATEST(EXTRACT(DAY FROM now())::NUMERIC, 1) * 100))::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= date_trunc('month', now())
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_checkins FROM (
    SELECT ci.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM check_ins ci JOIN profiles p ON p.id = ci.profile_id
    WHERE ci.gym_id = v_gym_id AND ci.checked_in_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ci.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(c ORDER BY c.start_date ASC), '[]'::JSONB)
  INTO v_challenges FROM (
    SELECT ch.id, ch.name, ch.description, ch.type,
           ch.start_date, ch.end_date, ch.reward_description,
      (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.score DESC NULLS LAST), '[]'::JSONB)
        FROM (
          SELECT cp.profile_id, cp.score, pr.full_name AS name, pr.avatar_url
          FROM challenge_participants cp JOIN profiles pr ON pr.id = cp.profile_id
          WHERE cp.challenge_id = ch.id AND cp.gym_id = v_gym_id
            AND pr.imported_archived = false
            AND pr.leaderboard_visible = TRUE
          ORDER BY cp.score DESC NULLS LAST LIMIT 10
        ) p
      ) AS participants
    FROM challenges ch
    WHERE ch.gym_id = v_gym_id
      AND ch.status IN ('active', 'completed')  -- 0551: hide draft/archived challenges from the TV board
      AND (ch.end_date IS NULL OR ch.end_date >= now()::DATE)
      AND (ch.start_date IS NULL OR ch.start_date <= (now() + interval '60 days')::DATE)
    LIMIT 6
  ) c;

  RETURN jsonb_build_object(
    'success', true,
    'tv_style', v_settings.tv_style,
    'tv_period', v_period,
    'leaderboards', jsonb_build_object(
      'volume', v_volume, 'workouts', v_workouts, 'prs', v_prs,
      'improved', v_improved, 'consistency', v_consistency, 'checkins', v_checkins
    ),
    'challenges', v_challenges
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
