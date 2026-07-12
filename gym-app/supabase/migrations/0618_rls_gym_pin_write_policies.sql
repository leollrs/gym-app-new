-- ============================================================
-- 0618 — pin gym_id on member write policies (audit-1 pattern 3 siblings)
-- ============================================================
-- Several member write policies pin the owner (profile_id = auth.uid()) but
-- leave gym_id unconstrained, so a member could INSERT/UPDATE a row carrying a
-- DIFFERENT gym's gym_id — injecting rows into (or re-pointing their own rows
-- at) another gym, polluting that gym's attendance/stats. The P0 sibling
-- (trainer_clients) was fixed in 0608; sessions_insert_own / pr_insert_own were
-- already gym-pinned. This closes the rest.
--
-- Fix pattern (matches the live sessions_insert_own): add
--   WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id())
-- to the write policies.
--
-- SAFE for members who were moved between gyms: admin_move_member_to_gym (0591)
-- re-stamps gym_id on every one of these tables (workout_sessions,
-- personal_records, check_ins, member_goals are all in its restamp list), so a
-- member's rows always carry their CURRENT gym — the pin can never reject a
-- legitimate self-write. Admin write paths use SEPARATE policies
-- (checkins_admin_insert/update, 0252) or SECURITY DEFINER RPCs, so they are
-- unaffected. Low severity (data-integrity, not privilege-escalation), but cheap
-- to close correctly.
-- ============================================================

-- ── check_ins: member's own (FOR ALL) — pin gym on write ──────────────────
DROP POLICY IF EXISTS "checkins_own" ON public.check_ins;
CREATE POLICY "checkins_own" ON public.check_ins
  FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id());

-- ── workout_sessions: UPDATE lacked WITH CHECK (could re-point gym) ────────
DROP POLICY IF EXISTS "sessions_update_own" ON public.workout_sessions;
CREATE POLICY "sessions_update_own" ON public.workout_sessions
  FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id());

-- ── personal_records: UPDATE lacked WITH CHECK ────────────────────────────
DROP POLICY IF EXISTS "pr_update_own" ON public.personal_records;
CREATE POLICY "pr_update_own" ON public.personal_records
  FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id());

-- ── member_goals: INSERT + UPDATE unconstrained on gym ────────────────────
DROP POLICY IF EXISTS "Users can insert own goals" ON public.member_goals;
CREATE POLICY "Users can insert own goals" ON public.member_goals
  FOR INSERT
  WITH CHECK (auth.uid() = profile_id AND gym_id = public.current_gym_id());

DROP POLICY IF EXISTS "Users can update own goals" ON public.member_goals;
CREATE POLICY "Users can update own goals" ON public.member_goals
  FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id AND gym_id = public.current_gym_id());

-- ── admin_gift_reward: stop trusting the client-supplied p_gym_id ──────────
-- The redemption row was inserted with p_gym_id (client param), letting an admin
-- attribute a gift to a gym other than the member's. Use the MEMBER's actual
-- gym instead — correct for both regular admins (verified same-gym above) and
-- super admins (cross-gym by design). Body otherwise verbatim from 0471.
CREATE OR REPLACE FUNCTION public.admin_gift_reward(p_member_id uuid, p_gym_id uuid, p_reward_id text, p_reward_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id    UUID;
  v_admin_role  TEXT;
  v_admin_extra user_role[];
  v_admin_gym   UUID;
  v_is_super    BOOLEAN;
  v_is_admin    BOOLEAN;
  v_redeem_id   UUID;
  v_member_gym  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role::text, additional_roles, gym_id
    INTO v_admin_role, v_admin_extra, v_admin_gym
  FROM profiles WHERE id = v_admin_id;

  v_is_super := (v_admin_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_admin_extra, '{}')));
  v_is_admin := v_is_super
                OR v_admin_role = 'admin'
                OR 'admin'::user_role = ANY(COALESCE(v_admin_extra, '{}'));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Verify member belongs to admin's gym (or admin is super_admin)
  IF NOT v_is_super THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = p_member_id AND gym_id = v_admin_gym
    ) THEN
      RAISE EXCEPTION 'Member not in your gym';
    END IF;
  END IF;

  -- Authoritative gym = the member's own gym (ignore the client-supplied
  -- p_gym_id, which was spoofable).
  SELECT gym_id INTO v_member_gym FROM profiles WHERE id = p_member_id;
  IF v_member_gym IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (p_member_id, v_member_gym, p_reward_id, p_reward_name, 0, 'pending')
  RETURNING id INTO v_redeem_id;

  RETURN json_build_object(
    'redemption_id', v_redeem_id,
    'success', true
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
