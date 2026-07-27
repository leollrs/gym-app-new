-- ============================================================================
-- 0651: Three independent fixes
--
--   A. get_friend_feed — stop scanning the whole gym feed for friendless members
--   B. tv_get_dashboard_data — rate-limit the anon-callable RPC
--   C. get_unread_dm_count — an exact count that PostgREST's row cap can't break
--
-- All additive or behaviour-preserving. Nothing is dropped.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- A. get_friend_feed — resolve visible actors FIRST
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0573 wrote the visibility test as:
--
--   LEFT JOIN friendships f ON (...) AND f.status = 'accepted'
--   WHERE afi.gym_id = my_gym
--     AND (afi.actor_id = uid OR f.id IS NOT NULL OR public.is_trainer_of(afi.actor_id))
--
-- `is_trainer_of` is STABLE SECURITY DEFINER, so Postgres cannot hoist it out of
-- the OR — it is evaluated PER CANDIDATE ROW. For a member WITH friends the
-- `idx_feed_gym (gym_id, created_at DESC)` scan satisfies p_limit quickly and
-- stops. For a member with ZERO friends nothing matches except their own posts,
-- so it walks the ENTIRE gym feed history, running that function on every row,
-- before returning almost nothing.
--
-- That is every new signup — and every seeded account in a demo gym. It is the
-- first thing a new member sees on the Community tab, it is slowest exactly when
-- the gym is largest, and it gets monotonically worse as the feed ages.
--
-- The visible-actor set is fully knowable up front and is SMALL: self, accepted
-- friends, and (if the caller is a trainer) their active clients in this gym.
-- `is_trainer_of` is literally `EXISTS (trainer_clients WHERE trainer_id =
-- auth.uid() AND client_id = $1 AND is_active AND same gym)` (0211), so
-- enumerating the caller's active client_ids once is exactly equivalent to
-- calling it per row.
--
-- Result: `actor_id = ANY(visible)` — an index range scan, no per-row function
-- call. Identical rows, identical order, identical block filtering.

CREATE OR REPLACE FUNCTION public.get_friend_feed(
  p_limit  INT         DEFAULT 30,
  p_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid     UUID;
  my_gym  UUID;
  visible UUID[];
  result  JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;
  IF my_gym IS NULL THEN RETURN '[]'::JSON; END IF;

  -- Self + accepted friends (either direction) + active training clients.
  -- Built once, not once per feed row.
  SELECT ARRAY(
    SELECT uid
    UNION
    SELECT CASE WHEN f.requester_id = uid THEN f.addressee_id ELSE f.requester_id END
      FROM friendships f
     WHERE f.status = 'accepted'
       AND (f.requester_id = uid OR f.addressee_id = uid)
    UNION
    -- Mirrors public.is_trainer_of (0211) exactly: active link, caller is the
    -- trainer, and both parties in the same gym.
    SELECT tc.client_id
      FROM trainer_clients tc
      JOIN public.profile_lookup tp ON tp.id = tc.trainer_id
      JOIN public.profile_lookup cp ON cp.id = tc.client_id
     WHERE tc.trainer_id = uid
       AND tc.is_active = TRUE
       AND tp.gym_id = cp.gym_id
  ) INTO visible;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      afi.id,
      afi.gym_id,
      afi.actor_id,
      afi.type,
      afi.data,
      afi.is_public,
      afi.created_at,
      json_build_object(
        'full_name',    p.full_name,
        'username',     p.username,
        'avatar_url',   p.avatar_url,
        'avatar_type',  p.avatar_type,
        'avatar_value', p.avatar_value,
        'role',         p.role
      ) AS profiles
    FROM activity_feed_items afi
    JOIN profiles p ON p.id = afi.actor_id
    WHERE afi.gym_id = my_gym
      AND afi.actor_id = ANY(visible)
      AND (p_cursor IS NULL OR afi.created_at < p_cursor)
      -- BLOCK FILTER preserved verbatim from 0573: hide items from anyone the
      -- caller blocked AND from anyone who blocked the caller. Kept as a NOT
      -- EXISTS rather than subtracted from `visible` because it is symmetric and
      -- cheap here (blocked_users is tiny and indexed both ways).
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE (b.blocker_id = uid          AND b.blocked_id = afi.actor_id)
           OR (b.blocker_id = afi.actor_id AND b.blocked_id = uid)
      )
    ORDER BY afi.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

COMMENT ON FUNCTION public.get_friend_feed(INT, TIMESTAMPTZ) IS
  'Friend/trainer activity feed. 0651 resolves the visible-actor set up front instead of calling is_trainer_of per candidate row, which made a friendless member scan the entire gym feed.';


-- ════════════════════════════════════════════════════════════════════════════
-- B. tv_get_dashboard_data — rate limit
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0491 correctly rate-limited `tv_authenticate` against brute-forcing the TV
-- code. But `tv_get_dashboard_data` is ALSO `GRANT EXECUTE ... TO anon`
-- (0551:805) with NO limit of any kind. Anyone holding a leaked code — it is
-- displayed on a gym wall — can call it without bound, and each call runs six
-- gym-wide leaderboard aggregates plus a challenges query. The PR board has no
-- date filter at all, so it aggregates the gym's entire lifetime PR history
-- every single call.
--
-- A legitimate screen calls this once per 30s heartbeat. 30 calls/minute per
-- session leaves ~15x headroom for retries and clock skew while making sustained
-- hammering pointless.
--
-- Rate limiting per SESSION (not IP): several screens at one gym share an IP and
-- must not throttle each other, and the session id is already required by the
-- function so there is nothing new to pass.

CREATE TABLE IF NOT EXISTS public.tv_data_calls (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tv_data_calls_session_time
  ON public.tv_data_calls (session_id, called_at DESC);

ALTER TABLE public.tv_data_calls ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER function below touches this table.

-- Housekeeping: this table is append-only and would grow without bound
-- (2,880 rows/day/screen). Nothing here needs history beyond the window.
CREATE OR REPLACE FUNCTION public.prune_tv_data_calls()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.tv_data_calls WHERE called_at < now() - INTERVAL '1 hour';
$$;

-- The guard is its own function so the call site in tv_get_dashboard_data (B2,
-- below) is a single PERFORM and the policy can be tuned without touching that
-- 169-line body again. It records the call, prunes opportunistically, and raises
-- when over the cap.
CREATE OR REPLACE FUNCTION public.tv_rate_limit_check(p_session_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent INT;
BEGIN
  IF p_session_id IS NULL OR length(trim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'session_required';
  END IF;

  SELECT COUNT(*) INTO v_recent
    FROM public.tv_data_calls
   WHERE session_id = p_session_id
     AND called_at >= now() - INTERVAL '1 minute';

  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  INSERT INTO public.tv_data_calls (session_id) VALUES (p_session_id);

  -- ~1 call in 500 does the cleanup, so no cron dependency and no per-call cost.
  IF random() < 0.002 THEN PERFORM public.prune_tv_data_calls(); END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tv_rate_limit_check(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_tv_data_calls()     FROM PUBLIC;

COMMENT ON FUNCTION public.tv_rate_limit_check(TEXT) IS
  'Per-session call cap for the anon-callable TV data RPC (0651). 30/min; a real screen uses 2/min.';


-- ════════════════════════════════════════════════════════════════════════════
-- C. get_unread_dm_count — exact, cap-proof
-- ════════════════════════════════════════════════════════════════════════════
--
-- The client counted unread DMs by fetching rows and taking `.length`. PostgREST
-- caps every response at 1000 rows, so a member with more than 1000 unread
-- messages saw a badge stuck at 1000 — and no `.limit()` can fix a count.
--
-- Own-messages-only by construction: it counts rows in conversations the caller
-- participates in, excluding their own sends. SECURITY DEFINER is required to
-- read direct_messages past the caller's RLS, so the participation check below
-- IS the authorization — it must stay.
--
-- The conversation_member_state exclusion is NOT optional. Navigation.jsx's
-- client-side version drops conversations the caller has deleted or purged
-- (0449) before tallying, so that clearing a chat also clears its unread from
-- the badge. A count without that clause would light the nav badge for chats the
-- user already deleted and give them no way to clear it — a worse bug than the
-- undercount this replaces.

CREATE OR REPLACE FUNCTION public.get_unread_dm_count()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*), 0)::INT
    FROM direct_messages dm
    JOIN conversations c ON c.id = dm.conversation_id
   WHERE auth.uid() IS NOT NULL
     AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
     AND dm.sender_id <> auth.uid()
     AND dm.read_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM conversation_member_state s
        WHERE s.conversation_id = dm.conversation_id
          AND s.profile_id      = auth.uid()
          AND (s.deleted_at IS NOT NULL OR s.purged_at IS NOT NULL)
     );
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_dm_count() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_unread_dm_count() FROM anon;

COMMENT ON FUNCTION public.get_unread_dm_count() IS
  'Exact unread DM count for auth.uid(). Replaces a client-side row count that PostgREST capped at 1000 (0651).';


-- ── B2. Wire the guard in ────────────────────────────────────────────────
-- Postgres has no "before function" hook, so the only way to gate an existing
-- function is to redefine it. This body is 0551's VERBATIM (extracted
-- programmatically, not retyped, so it cannot drift) with the single PERFORM
-- above inserted directly after BEGIN. Nothing else is changed.

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
  -- ── 0651 rate limit ──────────────────────────────────────────────────────
  -- RAISES rather than returning success:false. That is deliberate: TVDisplay
  -- treats `!data.success` as "revoked / expired", clears its stored credentials
  -- and drops to the code-entry screen — so a soft rate-limit reply would
  -- de-authenticate a legitimate wall screen and require someone to physically
  -- walk over and retype the code. Its catch block, by contrast, explicitly
  -- keeps the last-known data on screen and retries next tick. So a throw is the
  -- graceful path here and success:false is the destructive one.
  PERFORM public.tv_rate_limit_check(p_session_id);

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


-- ════════════════════════════════════════════════════════════════════════════
-- D. Null the one exercise video that 404s
-- ════════════════════════════════════════════════════════════════════════════
--
-- `global/incline_cable_fly.mp4` returns 404 "Object not found" — verified live,
-- and it is the ONLY broken reference of the 200 videos in the library.
--
-- Why this needs a migration and not just a data-file edit: `exerciseStore.js`
-- REPLACES the bundled static list with the DB copy at boot (App.jsx ->
-- hydrateExercisesFromDb), and 0636 seeded this row with the broken path. Nulling
-- it in src/data/exercises.js alone is inert — hydration puts the bad URL right
-- back, and libraryCache persists it to localStorage on top.
--
-- With a truthy video_url the card renders a <video> whose src fails; onError
-- only clears the shimmer, so the member gets a blank box. NULL renders the
-- honest "Video coming soon" placeholder instead.
--
-- RESTORE by re-running 0636's value once the file is uploaded to the
-- exercise-videos bucket:
--   UPDATE exercises SET video_url = 'global/incline_cable_fly.mp4'
--    WHERE id = 'ex_inccblfly';
UPDATE exercises SET video_url = NULL WHERE id = 'ex_inccblfly';


-- ════════════════════════════════════════════════════════════════════════════
-- Reload PostgREST's schema cache
-- ════════════════════════════════════════════════════════════════════════════
--
-- NEW functions are invisible to PostgREST until its schema cache reloads. Without
-- this, `get_unread_dm_count` returns PGRST202 and Navigation.jsx silently takes
-- its legacy fallback — which is exactly the row-capped path this migration exists
-- to replace. It fails quietly, showing a plausible but undercounted badge.
--
-- 298 of the migrations in this repo end with this line. It is only needed for NEW
-- functions; a CREATE OR REPLACE of an existing signature does not require it.
NOTIFY pgrst, 'reload schema';
