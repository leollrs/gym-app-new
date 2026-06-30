-- 0603 — Admin member fixes: real email display, invite-code linking, delete cascade
--
-- Three independent admin-side defects, all server-side (no client change needed):
--
-- (A) Member email shows the .invalid placeholder.
--     admin_create_member (0469) provisions a SHADOW auth.users row with a
--     synthetic placeholder email ('invite-<uuid>@invite.tugympr.invalid') so the
--     real address isn't claimed before signup; the real email is stashed in
--     auth.users.raw_user_meta_data->>'pending_email'. The email-resolution RPCs
--     returned auth.users.email verbatim, so MemberDetail + Outreach showed/used
--     the placeholder. Fix: return pending_email when the auth email is a
--     placeholder. (Preserves 0598's super_admin cross-gym bypass.)
--
-- (B) The access/invite code for an admin-created member "doesn't link to the gym".
--     CreateInviteModal inserts the gym_invites row PRE-CLAIMED (used_by = the new
--     shell, used_at = now). lookup_gym_invite_by_code (0306) filtered
--     `used_by IS NULL`, so it returned nothing for that code → Onboarding skipped
--     claim_imported_invite (which merges the shell + links the gym) and fell
--     through to claim_invite_code, which rejects it. Fix: also surface codes whose
--     used_by is an unclaimed placeholder shell (…@*.invalid) — exactly the rows
--     claim_imported_invite knows how to claim.
--
-- (C) Deleting a member with uploaded photos fails with "Direct deletion from
--     storage tables is not allowed. Use the Storage API instead." admin_delete_
--     gym_member ends with DELETE FROM auth.users, which CASCADES into
--     storage.objects (owner FK) → trips Supabase's storage-delete guard → the
--     whole transaction aborts. Fix: NULL the owner of the member's storage objects
--     first (an UPDATE, which the guard allows) so the cascade has nothing to
--     delete. (The files themselves are left orphaned in the bucket — clean up
--     out-of-band via the Storage API; this just unblocks account deletion.)

-- ── (A) admin_get_member_email — real email + 0598 super_admin bypass ──
CREATE OR REPLACE FUNCTION public.admin_get_member_email(p_member_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_gym   UUID;
  member_gym   UUID;
  member_email TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT gym_id INTO member_gym FROM profiles WHERE id = p_member_id;
  IF member_gym IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Gym admins are confined to their own gym; super_admins may read any member.
  IF NOT public.is_super_admin() THEN
    caller_gym := public.current_gym_id();
    IF member_gym != caller_gym THEN
      RAISE EXCEPTION 'Member not found in your gym';
    END IF;
  END IF;

  SELECT CASE
           WHEN u.email LIKE '%@%.invalid'
           THEN COALESCE(NULLIF(u.raw_user_meta_data->>'pending_email', ''), u.email)
           ELSE u.email
         END
    INTO member_email
    FROM auth.users u
    WHERE u.id = p_member_id;

  RETURN member_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_member_email(UUID) TO authenticated;


-- ── (A) admin_get_member_emails (batch, used by Outreach email channel) ──
CREATE OR REPLACE FUNCTION public.admin_get_member_emails(p_member_ids UUID[])
RETURNS TABLE (member_id UUID, email TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.id AS member_id,
         (CASE
            WHEN u.email LIKE '%@%.invalid'
            THEN COALESCE(NULLIF(u.raw_user_meta_data->>'pending_email', ''), u.email)
            ELSE u.email
          END)::text
  FROM auth.users u
  INNER JOIN public.profiles p ON p.id = u.id
  WHERE u.id = ANY(p_member_ids)
    AND p.gym_id = public.current_gym_id();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_member_emails(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_member_emails(UUID[]) TO authenticated;


-- ── (B) lookup_gym_invite_by_code — also surface unclaimed admin/import shells ──
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
      'id',        id,
      'code',      invite_code,
      'gym_id',    gym_id,
      'full_name', member_name,
      'email',     email,
      'phone',     phone
    )
    FROM gym_invites
    WHERE invite_code = upper(trim(p_code))
      AND (
        -- never claimed, OR pre-created by admin/import and still a placeholder
        -- shell (claim_imported_invite merges these and links the gym).
        used_by IS NULL
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = gym_invites.used_by
            AND u.email LIKE '%@%.invalid'
        )
      )
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_gym_invite_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_gym_invite_by_code(TEXT) TO anon;


-- ── (C) admin_delete_gym_member — disown storage objects before deleting auth user ──
-- Verbatim from 0551 with ONE added statement (the UPDATE storage.objects before
-- the auth.users delete); everything else is preserved exactly.
CREATE OR REPLACE FUNCTION public.admin_delete_gym_member(p_user_id UUID)
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

  -- Session data (deepest children first)
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

  -- Disown this member's storage objects FIRST so the auth.users delete below
  -- does not CASCADE into storage.objects. Supabase blocks direct/cascade
  -- DELETEs on storage tables ("Use the Storage API instead"), which otherwise
  -- aborts the whole deletion for any member who uploaded a photo. Nulling owner
  -- is an UPDATE (allowed); files remain in the bucket for an out-of-band sweep.
  UPDATE storage.objects SET owner = NULL WHERE owner = p_user_id;

  DELETE FROM auth.users             WHERE id = p_user_id;

  -- Audit through the canonical dual-writer (0543). Never breaks the deletion.
  BEGIN
    PERFORM public.log_admin_action(
      'delete_member',
      'member',
      p_user_id,
      jsonb_build_object('deleted_role', v_target_role),
      v_target_gym
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_gym_member(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
