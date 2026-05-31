-- 0482_db_hardening_followups.sql
--
-- Safe DB-level fixes from the audit (2026-05-30) that do NOT depend on
-- unverified frontend behavior:
--   1) feed_comments: a duplicate PERMISSIVE INSERT policy (feed_comments_insert_own)
--      omits the is_blocked() check that feed_comments_insert enforces. Because
--      PERMISSIVE policies are OR'd, the weaker one wins -> a blocked user can
--      still comment on the blocker's post. Drop the duplicate.
--   2) member_goals.gym_id is ON DELETE NO ACTION (every other gym_id is CASCADE)
--      -> deleting a gym is blocked if member_goals rows exist. Make it CASCADE.
--   3) claim_member_invite references a non-existent column `phone` (profiles has
--      phone_number) -> the RPC throws at runtime. Fix the column name.
--   4) tv_get_dashboard_data: the challenge-participant list ignores
--      leaderboard_visible (a member who opted out of leaderboards still appears
--      by full name on the gym TV). Add the filter, matching the leaderboards.

-- ── 1. Drop the is_blocked-bypassing duplicate comment INSERT policy ────────
DROP POLICY IF EXISTS feed_comments_insert_own ON public.feed_comments;

-- ── 1b. Drop the unused, loose member-UPDATE policy on earned_rewards ───────
-- Members only ever SELECT earned_rewards from the client; claim/redeem/QR all
-- go through SECURITY DEFINER RPCs (claim_earned_reward / redeem_earned_reward)
-- which bypass RLS. The member-UPDATE policy's WITH CHECK only pinned
-- (profile_id, status='pending'), letting a member mutate reward_label/qr_code/
-- notes on their own pending reward. Unused -> drop it.
DROP POLICY IF EXISTS earned_rewards_member_update_qr ON public.earned_rewards;

-- ── 2. member_goals.gym_id -> ON DELETE CASCADE ────────────────────────────
DO $$
DECLARE v_con TEXT;
BEGIN
  SELECT con.conname INTO v_con
  FROM pg_constraint con
  JOIN pg_class c     ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'member_goals' AND con.contype = 'f'
    AND array_length(con.conkey, 1) = 1
    AND (SELECT attname FROM pg_attribute
          WHERE attrelid = con.conrelid AND attnum = con.conkey[1]) = 'gym_id'
  LIMIT 1;

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.member_goals DROP CONSTRAINT %I', v_con);
  END IF;

  ALTER TABLE public.member_goals
    ADD CONSTRAINT member_goals_gym_id_fkey
    FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
END$$;

-- ── 3. claim_member_invite: phone -> phone_number ──────────────────────────
CREATE OR REPLACE FUNCTION public.claim_member_invite(p_invite_code text, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv RECORD;
BEGIN
  -- Security check: only allow claiming for yourself
  IF p_profile_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: can only claim invites for yourself';
  END IF;

  -- Find the invite
  SELECT * INTO inv FROM member_invites
  WHERE invite_code = upper(trim(p_invite_code))
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired');
  END IF;

  -- Mark as claimed
  UPDATE member_invites
  SET status = 'claimed', claimed_by = p_profile_id, claimed_at = now()
  WHERE id = inv.id;

  -- Link the profile to the gym (profiles has phone_number, not phone)
  UPDATE profiles
  SET gym_id = inv.gym_id,
      full_name = COALESCE(NULLIF(trim(inv.member_name), ''), full_name),
      phone_number = COALESCE(NULLIF(trim(inv.member_phone), ''), phone_number)
  WHERE id = p_profile_id;

  RETURN jsonb_build_object(
    'success', true,
    'gym_id', inv.gym_id,
    'member_name', inv.member_name,
    'member_phone', inv.member_phone
  );
END;
$function$;

-- ── 4. tv_get_dashboard_data: respect leaderboard_visible for challenge list ─
CREATE OR REPLACE FUNCTION public.tv_get_dashboard_data(p_code text, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings   RECORD;
  v_gym_id     UUID;
  v_thirty_ago TIMESTAMPTZ := now() - interval '30 days';
  v_volume     JSONB;
  v_workouts   JSONB;
  v_prs        JSONB;
  v_improved   JSONB;
  v_consistency JSONB;
  v_checkins   JSONB;
  v_challenges JSONB;
BEGIN
  SELECT * INTO v_settings FROM gym_tv_settings WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;
  v_gym_id := v_settings.gym_id;

  UPDATE gym_tv_sessions
  SET last_heartbeat_at = now()
  WHERE gym_id = v_gym_id AND session_id = p_session_id;
  IF NOT FOUND THEN
    INSERT INTO gym_tv_sessions (gym_id, session_id)
    VALUES (v_gym_id, p_session_id)
    ON CONFLICT (gym_id, session_id) DO UPDATE SET last_heartbeat_at = now();
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_volume FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND(SUM(ws.total_volume_lbs)::NUMERIC) AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_thirty_ago
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    HAVING SUM(ws.total_volume_lbs) > 0
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_workouts FROM (
    SELECT ws.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_thirty_ago
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
    WHERE ci.gym_id = v_gym_id AND ci.checked_in_at >= v_thirty_ago
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
            AND pr.leaderboard_visible = TRUE   -- NEW: respect the opt-out (matches leaderboards)
          ORDER BY cp.score DESC NULLS LAST LIMIT 10
        ) p
      ) AS participants
    FROM challenges ch
    WHERE ch.gym_id = v_gym_id
      AND (ch.end_date IS NULL OR ch.end_date >= now()::DATE)
      AND (ch.start_date IS NULL OR ch.start_date <= (now() + interval '60 days')::DATE)
    LIMIT 6
  ) c;

  RETURN jsonb_build_object(
    'success', true,
    'tv_style', v_settings.tv_style,
    'leaderboards', jsonb_build_object(
      'volume', v_volume, 'workouts', v_workouts, 'prs', v_prs,
      'improved', v_improved, 'consistency', v_consistency, 'checkins', v_checkins
    ),
    'challenges', v_challenges
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
