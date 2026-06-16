-- ============================================================================
-- 0591 — admin_move_member_to_gym                      (audit: completeness, support)
-- ============================================================================
-- SupportConsole could not move a member between gyms. A naive
-- `UPDATE profiles SET gym_id = …` orphans every gym-scoped row the member
-- owns: their training history stays stamped with the OLD gym_id (so it
-- vanishes from the new gym's admin views and analytics), while their old-gym
-- community associations (program enrollment, challenge entries, class
-- bookings, leaderboard snapshots, friendships, trainer link) keep pointing at
-- rows that don't exist in the new gym.
--
-- This RPC performs the move ATOMICALLY (single implicit txn — any failure
-- rolls the whole thing back) with two passes:
--
--   RE-STAMP — the member's OWN data follows them. Every allow-listed table
--   that carries a gym_id column has it rewritten to the target gym so the
--   history stays visible and correctly attributed at the new gym.
--
--   CLEAR — old-gym community associations are deleted. They reference
--   old-gym entities (that gym's programs / challenges / classes / leaderboard
--   / social graph / trainers) and cannot transfer; leaving them would dangle.
--
-- It is CATALOG-GUARDED: each table is touched only if it exists and has the
-- needed columns, and the member column is auto-detected from the catalog.
-- So the function can never abort on a missing table/column (the 0354→0551
-- trap, where a wrong column name silently killed admin_delete_gym_member for
-- a year). The explicit table allow-list is the safety boundary — we never
-- re-stamp an arbitrary gym_id table (gyms / audit logs / branding stay put).
--
-- super_admin-ONLY: a cross-gym move is inherently a platform operation
-- (gym admins are scoped to their own tenant and must never reach into
-- another gym's data). Mirrors admin_delete_gym_member's protected-account
-- rules (no super_admin target, no self).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_move_member_to_gym(
  p_user_id       uuid,
  p_target_gym_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_gym  uuid;
  v_role        text;
  v_target_name text;
  v_tbl         text;
  v_mc          text;
  v_n           int;
  v_restamped   int := 0;
  v_cleared     int := 0;

  -- Member's OWN data (re-stamp gym_id → target so it follows them). A table
  -- here that lacks a gym_id column is simply skipped (it is personal and
  -- already follows the member via profile_id).
  restamp_tables text[] := ARRAY[
    'workout_sessions','personal_records','pr_history','body_weight_logs',
    'body_measurements','progress_photos','check_ins','streak_cache',
    'overload_suggestions','member_onboarding','nutrition_targets',
    'nutrition_checkins','food_logs','member_goals','user_achievements',
    'churn_risk_scores','notifications','session_drafts','routines',
    'reward_points','reward_points_log','reward_redemptions','earned_rewards',
    'member_punch_cards'
  ];

  -- Old-gym community associations (delete — they reference old-gym entities).
  -- friendships + trainer_clients have dual member columns and are handled
  -- explicitly below.
  clear_tables text[] := ARRAY[
    'user_enrolled_programs','challenge_participants','challenge_score_events',
    'gym_class_bookings','leaderboard_snapshots'
  ];

  -- Member-identifying columns, in priority order (first present one wins).
  member_cols text[] := ARRAY['profile_id','member_id','user_id','created_by'];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Cross-gym move is a platform-only operation.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can move members between gyms';
  END IF;

  SELECT gym_id, role INTO v_source_gym, v_role
    FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Protected-account rules (mirror admin_delete_gym_member).
  IF v_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot move a super admin account';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot move your own account';
  END IF;

  SELECT name INTO v_target_name FROM gyms WHERE id = p_target_gym_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target gym not found';
  END IF;
  IF p_target_gym_id IS NOT DISTINCT FROM v_source_gym THEN
    RAISE EXCEPTION 'Member is already in that gym';
  END IF;

  -- ── PASS 1: re-stamp the member's own gym-scoped data ────────────────────
  FOREACH v_tbl IN ARRAY restamp_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN CONTINUE; END IF;
    -- only tables carrying a gym_id need re-stamping
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = 'gym_id'
    ) THEN CONTINUE; END IF;

    SELECT column_name INTO v_mc
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = v_tbl
       AND column_name = ANY(member_cols)
     ORDER BY array_position(member_cols, column_name)
     LIMIT 1;
    IF v_mc IS NULL THEN CONTINUE; END IF;

    EXECUTE format('UPDATE public.%I SET gym_id = $1 WHERE %I = $2', v_tbl, v_mc)
      USING p_target_gym_id, p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restamped := v_restamped + v_n;
  END LOOP;

  -- ── PASS 2: clear old-gym community associations ─────────────────────────
  FOREACH v_tbl IN ARRAY clear_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN CONTINUE; END IF;
    SELECT column_name INTO v_mc
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = v_tbl
       AND column_name = ANY(ARRAY['profile_id','member_id','user_id'])
     ORDER BY array_position(ARRAY['profile_id','member_id','user_id'], column_name)
     LIMIT 1;
    IF v_mc IS NULL THEN CONTINUE; END IF;

    EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_tbl, v_mc)
      USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cleared := v_cleared + v_n;
  END LOOP;

  -- friendships: gym-scoped social graph (dual columns).
  IF to_regclass('public.friendships') IS NOT NULL THEN
    DELETE FROM friendships
     WHERE requester_id = p_user_id OR addressee_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cleared := v_cleared + v_n;
  END IF;

  -- trainer_clients: break links both as client AND as trainer (a moved
  -- trainer's roster stays with the old gym).
  IF to_regclass('public.trainer_clients') IS NOT NULL THEN
    DELETE FROM trainer_clients
     WHERE client_id = p_user_id OR trainer_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cleared := v_cleared + v_n;
  END IF;

  -- Clear the profile's old-gym program assignment (FK → gym_programs in the
  -- source gym; ON DELETE SET NULL would never fire on a move).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'assigned_program_id'
  ) THEN
    UPDATE profiles SET assigned_program_id = NULL WHERE id = p_user_id;
  END IF;

  -- ── Finally: move the profile itself ─────────────────────────────────────
  UPDATE profiles SET gym_id = p_target_gym_id WHERE id = p_user_id;

  -- Audit (canonical dual-writer; guard so a logging hiccup can't roll back
  -- the move — the actual move is what matters).
  BEGIN
    PERFORM public.log_admin_action(
      'admin_move_member_to_gym', 'member', p_user_id,
      jsonb_build_object(
        'from_gym', v_source_gym,
        'to_gym', p_target_gym_id,
        'rows_restamped', v_restamped,
        'rows_cleared', v_cleared
      ),
      p_target_gym_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'moved', true,
    'from_gym', v_source_gym,
    'to_gym', p_target_gym_id,
    'to_gym_name', v_target_name,
    'rows_restamped', v_restamped,
    'rows_cleared', v_cleared
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_move_member_to_gym(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_move_member_to_gym(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
