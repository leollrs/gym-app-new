-- ============================================================
-- 0463 — Multi-role sweep: admin / super_admin / trainer
-- ============================================================
-- Migration 0332 introduced `profiles.additional_roles user_role[]`
-- + the SECURITY DEFINER helper `public.user_has_role(p_role)`.
-- The helper checks `role = p_role OR p_role = ANY(additional_roles)`
-- and is the canonical entitlement check for multi-role users.
--
-- Most pre-0332 RPCs and RLS policies still gate access with the
-- bare pattern
--     role IN ('admin','super_admin'[,'trainer'])
-- which ignores `additional_roles`. A member who also holds
-- 'admin' (or 'trainer') in additional_roles silently fails every
-- check, locking them out of features they're entitled to.
--
-- This migration sweeps the highest-impact callers. Each section
-- targets the LATEST definition of the function / policy and
-- expands the predicate to also accept additional-role holders.
-- Behaviour change: existing single-role admins/trainers still
-- pass; multi-role users now pass as well. Nothing is tightened.
--
-- Pattern used inside PL/pgSQL helpers (need primary+additional):
--   SELECT role, additional_roles INTO caller_role, caller_extra
--     FROM profiles WHERE id = uid;
--   IF caller_role IN ('admin','super_admin')
--      OR 'admin'::user_role      = ANY(caller_extra)
--      OR 'super_admin'::user_role = ANY(caller_extra) THEN …
--
-- Pattern used inside RLS / inline SQL checks:
--   EXISTS (SELECT 1 FROM profiles
--            WHERE id = auth.uid()
--              AND (role IN ('admin','super_admin')
--                   OR 'admin'::user_role      = ANY(additional_roles)
--                   OR 'super_admin'::user_role = ANY(additional_roles)))
--
-- DO NOT use `public.user_has_role()` inside SECURITY DEFINER bodies
-- — it returns SQL STABLE and re-reads `profiles` via auth.uid(),
-- which still works but doubles the row lookup. Inline the predicate
-- against the row we're already loading.
--
-- ============================================================

-- ==========================================================================
-- 1. TRAINER TIER 2 — _can_manage_client
--    Origin: 0450_trainer_payments_recovery.sql:38-57
--    Called by every RPC in 0450 / 0451 / 0452 / 0453. ONE fix
--    unblocks the entire trainer-tier-2 surface (payments, billing,
--    schedule, attendance) for admin/super_admin/trainer holders
--    of additional_roles.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public._can_manage_client(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          UUID;
  caller_gym   UUID;
  caller_role  TEXT;
  caller_extra user_role[];
  client_gym   UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN FALSE; END IF;

  SELECT gym_id, role::text, additional_roles
    INTO caller_gym, caller_role, caller_extra
    FROM profiles WHERE id = uid;

  SELECT gym_id INTO client_gym FROM profiles WHERE id = p_client_id;
  IF client_gym IS NULL OR caller_gym IS DISTINCT FROM client_gym THEN
    RETURN FALSE;
  END IF;

  -- Admin / super_admin in same gym → always allowed.
  IF caller_role IN ('admin', 'super_admin')
     OR 'admin'::user_role       = ANY(caller_extra)
     OR 'super_admin'::user_role = ANY(caller_extra) THEN
    RETURN TRUE;
  END IF;

  -- Otherwise must be the client's active trainer.
  -- A primary-role trainer satisfies this naturally. A multi-role
  -- holder with 'trainer' in additional_roles also satisfies this
  -- the moment they're assigned in trainer_clients — no role check
  -- is needed here, the row IS the entitlement.
  RETURN EXISTS (
    SELECT 1 FROM trainer_clients
     WHERE trainer_id = uid AND client_id = p_client_id AND is_active = true
  );
END;
$$;

-- ==========================================================================
-- 2. PRINT CARDS — RLS policies on print_cards
--    Origin: 0399_print_cards_queue.sql:89-117
-- ==========================================================================
DROP POLICY IF EXISTS "print_cards_read_staff"   ON print_cards;
DROP POLICY IF EXISTS "print_cards_update_staff" ON print_cards;
DROP POLICY IF EXISTS "print_cards_insert_admin" ON print_cards;

CREATE POLICY "print_cards_read_staff"
  ON print_cards FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

CREATE POLICY "print_cards_update_staff"
  ON print_cards FOR UPDATE USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

CREATE POLICY "print_cards_insert_admin"
  ON print_cards FOR INSERT WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 3. PRINT CARDS — gym_card_settings RLS
--    Origin: 0415_print_cards_v2_occasions_and_rewards.sql:89-100
-- ==========================================================================
DROP POLICY IF EXISTS "gym_card_settings_admin_all" ON gym_card_settings;

CREATE POLICY "gym_card_settings_admin_all" ON gym_card_settings
  FOR ALL TO authenticated
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(p.additional_roles)
           OR 'super_admin'::user_role = ANY(p.additional_roles)
         )
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(p.additional_roles)
           OR 'super_admin'::user_role = ANY(p.additional_roles)
         )
    )
  );

-- ==========================================================================
-- 4. PRINT CARDS — attach_reward_to_print_card
--    Origin: 0457_fix_attach_reward_gen_random_bytes.sql:16
--    (latest redefinition; 0415 was the original)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.attach_reward_to_print_card(
  p_card_id        UUID,
  p_reward_label   TEXT,
  p_reward_emoji   TEXT DEFAULT NULL,
  p_expires_in_days INT DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card        print_cards%ROWTYPE;
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_caller_extra user_role[];
  v_reward_id   UUID;
  v_qr_code     TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role::text, additional_roles
    INTO v_caller_role, v_caller_extra
    FROM profiles WHERE id = v_caller_id;

  IF NOT (
    v_caller_role IN ('admin', 'super_admin')
    OR 'admin'::user_role       = ANY(v_caller_extra)
    OR 'super_admin'::user_role = ANY(v_caller_extra)
  ) THEN
    RAISE EXCEPTION 'Only admins can attach rewards to print cards';
  END IF;

  SELECT * INTO v_card FROM print_cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id AND gym_id = v_card.gym_id
  ) THEN
    RAISE EXCEPTION 'Card belongs to a different gym';
  END IF;

  IF v_card.reward_id IS NOT NULL THEN
    RAISE EXCEPTION 'Card already has a reward attached';
  END IF;

  -- See 0457: gen_random_uuid() works everywhere; gen_random_bytes() does not.
  v_qr_code := replace(gen_random_uuid()::text, '-', '');

  INSERT INTO earned_rewards (
    gym_id, profile_id, reward_label, reward_emoji,
    qr_code, source, status, expires_at
  )
  VALUES (
    v_card.gym_id, v_card.profile_id, p_reward_label, p_reward_emoji,
    v_qr_code, 'print_card', 'pending',
    NOW() + (p_expires_in_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_reward_id;

  UPDATE print_cards
     SET reward_id      = v_reward_id,
         reward_qr_code = v_qr_code,
         reward_label   = p_reward_label
   WHERE id = p_card_id;

  RETURN json_build_object(
    'success',    true,
    'card_id',    p_card_id,
    'reward_id',  v_reward_id,
    'qr_code',    v_qr_code,
    'expires_at', NOW() + (p_expires_in_days || ' days')::INTERVAL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_reward_to_print_card(UUID, TEXT, TEXT, INT)
  TO authenticated;

-- ==========================================================================
-- 5. PRINT CARDS — detach_reward_from_print_card
--    Origin: 0415_print_cards_v2_occasions_and_rewards.sql:505
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.detach_reward_from_print_card(p_card_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card         print_cards%ROWTYPE;
  v_caller_id    UUID;
  v_caller_role  TEXT;
  v_caller_extra user_role[];
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role::text, additional_roles
    INTO v_caller_role, v_caller_extra
    FROM profiles WHERE id = v_caller_id;

  IF NOT (
    v_caller_role IN ('admin', 'super_admin')
    OR 'admin'::user_role       = ANY(v_caller_extra)
    OR 'super_admin'::user_role = ANY(v_caller_extra)
  ) THEN
    RAISE EXCEPTION 'Only admins can modify print cards';
  END IF;

  SELECT * INTO v_card FROM print_cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id AND gym_id = v_card.gym_id
  ) THEN
    RAISE EXCEPTION 'Card belongs to a different gym';
  END IF;

  IF v_card.reward_id IS NOT NULL THEN
    UPDATE earned_rewards
       SET status = 'cancelled'
     WHERE id = v_card.reward_id AND status = 'pending';
  END IF;

  UPDATE print_cards
     SET reward_id      = NULL,
         reward_qr_code = NULL,
         reward_label   = NULL
   WHERE id = p_card_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.detach_reward_from_print_card(UUID)
  TO authenticated;

-- ==========================================================================
-- 6. PRINT CARDS — get_upcoming_print_cards
--    Origin: 0455_upcoming_print_cards_surface_queued.sql:27
--    (latest; 0414→0416→0455 chain. Only the auth guard changes;
--    body kept verbatim so the columns + behaviour are identical.)
-- ==========================================================================
DROP FUNCTION IF EXISTS public.get_upcoming_print_cards(UUID, INT, INT);

CREATE OR REPLACE FUNCTION public.get_upcoming_print_cards(
  p_gym_id              UUID,
  p_lookahead_workouts  INT DEFAULT 5,
  p_lookahead_days      INT DEFAULT 7
)
RETURNS TABLE (
  occasion         card_occasion,
  profile_id       UUID,
  full_name        TEXT,
  avatar_url       TEXT,
  headline         TEXT,
  subline          TEXT,
  units_away       INT,
  unit_type        TEXT,
  predicted_at     TIMESTAMPTZ,
  current_value    INT,
  card_id          UUID,
  card_status      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin', 'trainer')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
        OR 'trainer'::user_role     = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  -- ── Workout milestones approaching (100 / 250 / 500) ──
  WITH session_counts AS (
    SELECT
      ws.profile_id, p.gym_id, p.full_name, p.avatar_url,
      COUNT(*)::INT AS current_count
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.status = 'completed'
      AND p.role = 'member' AND p.membership_status = 'active'
      AND p.gym_id = p_gym_id
    GROUP BY ws.profile_id, p.gym_id, p.full_name, p.avatar_url
  ),
  upcoming_milestones AS (
    SELECT
      sc.profile_id, sc.full_name, sc.avatar_url, sc.current_count,
      m.threshold AS next_threshold
    FROM session_counts sc
    CROSS JOIN LATERAL (
      SELECT t.threshold
      FROM (VALUES (100), (250), (500)) AS t(threshold)
      WHERE t.threshold > sc.current_count
        AND t.threshold - sc.current_count <= p_lookahead_workouts
      ORDER BY t.threshold ASC
      LIMIT 1
    ) m
  )
  SELECT
    (CASE um.next_threshold
       WHEN 100 THEN 'milestone_100'
       WHEN 250 THEN 'milestone_250'
       WHEN 500 THEN 'milestone_500'
     END)::card_occasion AS occasion,
    um.profile_id,
    um.full_name,
    um.avatar_url,
    (um.next_threshold || ' workouts logged')::TEXT AS headline,
    (CASE um.next_threshold
       WHEN 100 THEN 'Triple digits. The work shows.'
       WHEN 250 THEN 'Quarter-thousand sessions. Rare company.'
       WHEN 500 THEN 'Five hundred. We''re honored you train here.'
     END)::TEXT AS subline,
    (um.next_threshold - um.current_count)::INT AS units_away,
    'workouts'::TEXT AS unit_type,
    NULL::TIMESTAMPTZ AS predicted_at,
    um.current_count AS current_value,
    ex.id AS card_id,
    ex.st AS card_status
  FROM upcoming_milestones um
  LEFT JOIN LATERAL (
    SELECT pc.id, pc.status::text AS st
    FROM print_cards pc
    WHERE pc.profile_id = um.profile_id
      AND pc.status IN ('pending', 'printed')
      AND pc.occasion = (CASE um.next_threshold
        WHEN 100 THEN 'milestone_100'
        WHEN 250 THEN 'milestone_250'
        WHEN 500 THEN 'milestone_500'
      END)::card_occasion
    ORDER BY pc.created_at DESC
    LIMIT 1
  ) ex ON TRUE

  UNION ALL

  -- ── Tenure marks coming up (30 / 90 / 365) ──
  SELECT
    (CASE t_hit.threshold
       WHEN 30  THEN 'tenure_30'
       WHEN 90  THEN 'tenure_90'
       WHEN 365 THEN 'tenure_365'
     END)::card_occasion AS occasion,
    p.id AS profile_id,
    p.full_name,
    p.avatar_url,
    (CASE t_hit.threshold
       WHEN 30  THEN 'One month in.'
       WHEN 90  THEN 'Ninety days strong.'
       WHEN 365 THEN 'One year here.'
     END)::TEXT AS headline,
    (CASE t_hit.threshold
       WHEN 30  THEN 'Past the trial-period brain — you''re a regular now.'
       WHEN 90  THEN 'You''re past the cliff. This is your gym.'
       WHEN 365 THEN 'Twelve months of showing up. Few do this.'
     END)::TEXT AS subline,
    (t_hit.threshold - (CURRENT_DATE - p.created_at::DATE)::INT)::INT AS units_away,
    'days'::TEXT AS unit_type,
    (p.created_at::DATE + t_hit.threshold)::TIMESTAMPTZ AS predicted_at,
    NULL::INT AS current_value,
    ex.id AS card_id,
    ex.st AS card_status
  FROM profiles p
  CROSS JOIN LATERAL (
    SELECT t.threshold
    FROM (VALUES (30), (90), (365)) AS t(threshold)
    WHERE t.threshold > (CURRENT_DATE - p.created_at::DATE)::INT
      AND t.threshold - (CURRENT_DATE - p.created_at::DATE)::INT <= p_lookahead_days
    ORDER BY t.threshold ASC
    LIMIT 1
  ) t_hit
  LEFT JOIN LATERAL (
    SELECT pc.id, pc.status::text AS st
    FROM print_cards pc
    WHERE pc.profile_id = p.id
      AND pc.status IN ('pending', 'printed')
      AND pc.occasion = (CASE t_hit.threshold
        WHEN 30  THEN 'tenure_30'
        WHEN 90  THEN 'tenure_90'
        WHEN 365 THEN 'tenure_365'
      END)::card_occasion
    ORDER BY pc.created_at DESC
    LIMIT 1
  ) ex ON TRUE
  WHERE p.gym_id = p_gym_id
    AND p.role = 'member'
    AND p.membership_status = 'active'

  UNION ALL

  -- ── habit_9in6 approaching — UNCHANGED rolling-window dedup ──
  SELECT
    'habit_9in6'::card_occasion AS occasion,
    sc.profile_id,
    p.full_name,
    p.avatar_url,
    'You''re building the habit.'::TEXT AS headline,
    ('Nine sessions in six weeks — keep going.')::TEXT AS subline,
    (COALESCE(s.habit_target_count, 9) - sc.window_count)::INT AS units_away,
    'workouts'::TEXT AS unit_type,
    NULL::TIMESTAMPTZ AS predicted_at,
    sc.window_count AS current_value,
    NULL::UUID AS card_id,
    NULL::TEXT AS card_status
  FROM (
    SELECT
      ws.profile_id,
      p2.gym_id,
      COUNT(*)::INT AS window_count
    FROM workout_sessions ws
    JOIN profiles p2 ON p2.id = ws.profile_id
    LEFT JOIN gym_card_settings s2 ON s2.gym_id = p2.gym_id
    WHERE ws.status = 'completed'
      AND ws.completed_at >= NOW() - (COALESCE(s2.habit_window_days, 42) || ' days')::INTERVAL
      AND p2.role = 'member' AND p2.membership_status = 'active'
      AND p2.gym_id = p_gym_id
    GROUP BY ws.profile_id, p2.gym_id
  ) sc
  JOIN profiles p ON p.id = sc.profile_id
  LEFT JOIN gym_card_settings s ON s.gym_id = sc.gym_id
  WHERE sc.window_count >= COALESCE(s.habit_target_count, 9) - 2
    AND sc.window_count < COALESCE(s.habit_target_count, 9)
    AND NOT EXISTS (
      SELECT 1 FROM print_cards pc
      WHERE pc.profile_id = sc.profile_id
        AND pc.occasion = 'habit_9in6'::card_occasion
        AND pc.created_at >= NOW() - (COALESCE(s.habit_dedup_days, 90) || ' days')::INTERVAL
    )

  UNION ALL

  -- ── Upcoming birthdays (next N days, wrap-around safe) ──
  SELECT
    'birthday'::card_occasion AS occasion,
    p.id AS profile_id,
    p.full_name,
    p.avatar_url,
    'Happy birthday.'::TEXT AS headline,
    'On the house today. Take it easy.'::TEXT AS subline,
    GREATEST(0, (
      CASE
        WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) >= CURRENT_DATE
        THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
        ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
      END
    ))::INT AS units_away,
    'days'::TEXT AS unit_type,
    (CASE
       WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                      EXTRACT(MONTH FROM p.date_of_birth)::INT,
                      EXTRACT(DAY FROM p.date_of_birth)::INT) >= CURRENT_DATE
       THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                      EXTRACT(MONTH FROM p.date_of_birth)::INT,
                      EXTRACT(DAY FROM p.date_of_birth)::INT)
       ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                      EXTRACT(MONTH FROM p.date_of_birth)::INT,
                      EXTRACT(DAY FROM p.date_of_birth)::INT)
     END)::TIMESTAMPTZ AS predicted_at,
    NULL::INT AS current_value,
    ex.id AS card_id,
    ex.st AS card_status
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT pc.id, pc.status::text AS st
    FROM print_cards pc
    WHERE pc.profile_id = p.id
      AND pc.status IN ('pending', 'printed')
      AND pc.occasion = 'birthday'::card_occasion
    ORDER BY pc.created_at DESC
    LIMIT 1
  ) ex ON TRUE
  WHERE p.gym_id = p_gym_id
    AND p.role = 'member'
    AND p.membership_status = 'active'
    AND p.date_of_birth IS NOT NULL
    AND (
      CASE
        WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) >= CURRENT_DATE
        THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
        ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
      END
    ) BETWEEN 0 AND p_lookahead_days

  ORDER BY units_away ASC, occasion;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_upcoming_print_cards(UUID, INT, INT)
  TO authenticated;

-- ==========================================================================
-- 7. PRINT CARDS — materialize_upcoming_print_card
--    Origin: 0418_materialize_upcoming_print_card.sql:20
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.materialize_upcoming_print_card(
  p_gym_id        UUID,
  p_profile_id    UUID,
  p_occasion      card_occasion,
  p_headline      TEXT,
  p_subline       TEXT,
  p_occasion_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin', 'trainer')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
        OR 'trainer'::user_role     = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_profile_id AND gym_id = p_gym_id
  ) THEN
    RAISE EXCEPTION 'Member not found in this gym';
  END IF;

  IF EXISTS (
    SELECT 1 FROM print_cards
    WHERE profile_id = p_profile_id
      AND occasion = p_occasion
      AND status IN ('pending', 'printed')
  ) THEN
    RAISE EXCEPTION 'Active card already exists for this member and occasion';
  END IF;

  INSERT INTO print_cards (
    gym_id, profile_id, occasion, occasion_data,
    headline, subline, status, expires_at, created_at
  )
  VALUES (
    p_gym_id, p_profile_id, p_occasion, COALESCE(p_occasion_data, '{}'::jsonb),
    p_headline, p_subline, 'pending',
    NOW() + INTERVAL '60 days', NOW()
  )
  RETURNING id INTO v_card_id;

  RETURN v_card_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.materialize_upcoming_print_card(UUID, UUID, card_occasion, TEXT, TEXT, JSONB)
  TO authenticated;

-- ==========================================================================
-- 8. PRINT CARDS — notify_gym_card_delivery
--    Origin: 0432_card_realtime_and_delivery_notifs.sql:32
--    Caller-side check stays super_admin-only (platform action),
--    but the admin RECIPIENT lookup expands to additional-role admins.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.notify_gym_card_delivery(p_gym_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count    INT;
  v_date     TIMESTAMPTZ;
  v_admin    RECORD;
  v_notified INT := 0;
  v_title    TEXT;
  v_body     TEXT;
  v_datestr  TEXT;
BEGIN
  -- Authorization unchanged: only super_admin (primary OR additional)
  -- triggers a cross-gym platform notification.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND (
        role = 'super_admin'
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT COUNT(*), MIN(expected_delivery_at)
    INTO v_count, v_date
    FROM print_cards
   WHERE gym_id = p_gym_id
     AND status = 'printed'
     AND delivery_fulfilled_by = 'platform'
     AND expected_delivery_at >= date_trunc('day', now());

  IF v_count = 0 OR v_date IS NULL THEN
    RETURN 0;
  END IF;

  v_datestr := to_char(v_date, 'FMMon FMDD');

  -- Recipient fan-out: include additional-role admins so a member-as-admin
  -- still receives delivery notifications.
  FOR v_admin IN
    SELECT id, COALESCE(preferred_language, 'en') AS lang
      FROM profiles
     WHERE gym_id = p_gym_id
       AND (
         role IN ('admin', 'super_admin')
         OR 'admin'::user_role       = ANY(additional_roles)
         OR 'super_admin'::user_role = ANY(additional_roles)
       )
  LOOP
    IF v_admin.lang = 'es' THEN
      v_title := '📦 Tarjetas en camino';
      v_body  := v_count || ' tarjetas llegan el ' || v_datestr || ' — tenlas listas para entregar.';
    ELSE
      v_title := '📦 Cards on the way';
      v_body  := v_count || ' cards arriving ' || v_datestr || ' — have them ready to hand out.';
    END IF;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key)
    VALUES (
      v_admin.id, p_gym_id, 'admin_message'::notification_type,
      v_title, v_body,
      jsonb_build_object('route', '/admin/print-cards', 'count', v_count, 'deliver_at', v_date),
      'card_delivery:' || v_admin.id::text || ':' || p_gym_id::text || ':' || to_char(v_date, 'YYYY-MM-DD')
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

    v_notified := v_notified + 1;
  END LOOP;

  RETURN v_notified;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_gym_card_delivery(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.notify_gym_card_delivery(UUID) TO authenticated;

-- ==========================================================================
-- 9. PRINT CARDS — print_cards_on_session_complete
--    Origin: 0432_card_realtime_and_delivery_notifs.sql:100
--    Notification fan-out only — expand admin recipient lookup.
--    The trigger itself fires per workout_session regardless of caller.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.print_cards_on_session_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id    UUID;
  v_role      TEXT;
  v_status    TEXT;
  v_name      TEXT;
  v_count     INT;
  v_milestone INT;
  v_enabled   BOOLEAN;
  v_occasion  card_occasion;
  v_headline  TEXT;
  v_subline   TEXT;
  v_label_en  TEXT;
  v_label_es  TEXT;
  v_card_id   UUID;
  v_admin     RECORD;
  v_title     TEXT;
  v_body      TEXT;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  IF COALESCE(NEW.completed_at, NEW.started_at) < now() - INTERVAL '12 hours' THEN
    RETURN NEW;
  END IF;

  SELECT p.gym_id, p.role, p.membership_status, p.full_name
    INTO v_gym_id, v_role, v_status, v_name
    FROM profiles p WHERE p.id = NEW.profile_id;

  IF v_gym_id IS NULL OR v_role <> 'member' OR v_status <> 'active' THEN
    RETURN NEW;
  END IF;

  BEGIN

  SELECT COUNT(*) INTO v_count
    FROM workout_sessions
   WHERE profile_id = NEW.profile_id AND status = 'completed';

  IF v_count = 1 THEN
    IF COALESCE((SELECT enable_welcome FROM gym_card_settings WHERE gym_id = v_gym_id), TRUE) THEN
      v_occasion := 'welcome';
      v_headline := 'You showed up.';
      v_subline  := 'That was the hard part.';
      v_label_en := 'their first workout';
      v_label_es := 'su primer entrenamiento';
    END IF;
  ELSIF v_count IN (100, 250, 500) THEN
    v_milestone := v_count;
    SELECT CASE v_milestone
             WHEN 100 THEN COALESCE(enable_milestone_100, TRUE)
             WHEN 250 THEN COALESCE(enable_milestone_250, TRUE)
             WHEN 500 THEN COALESCE(enable_milestone_500, TRUE)
           END
      INTO v_enabled FROM gym_card_settings WHERE gym_id = v_gym_id;
    IF COALESCE(v_enabled, TRUE) THEN
      v_occasion := ('milestone_' || v_milestone)::card_occasion;
      v_headline := v_milestone || ' workouts logged';
      v_subline  := CASE v_milestone
        WHEN 100 THEN 'Triple digits. The work shows.'
        WHEN 250 THEN 'Quarter-thousand sessions. Rare company.'
        WHEN 500 THEN 'Five hundred. We''re honored you train here.'
      END;
      v_label_en := v_milestone || ' workouts';
      v_label_es := v_milestone || ' entrenamientos';
    END IF;
  END IF;

  IF v_occasion IS NULL THEN RETURN NEW; END IF;

  v_card_id := enqueue_print_card(
    NEW.profile_id, v_gym_id, v_occasion, v_headline, v_subline,
    CASE WHEN v_milestone IS NOT NULL
      THEN jsonb_build_object('milestone_n', v_milestone)
      ELSE '{}'::jsonb END
  );

  IF v_card_id IS NULL THEN RETURN NEW; END IF;

  -- Recipient fan-out: include additional-role admins.
  FOR v_admin IN
    SELECT id, COALESCE(preferred_language, 'en') AS lang
      FROM profiles
     WHERE gym_id = v_gym_id
       AND (
         role IN ('admin', 'super_admin')
         OR 'admin'::user_role       = ANY(additional_roles)
         OR 'super_admin'::user_role = ANY(additional_roles)
       )
  LOOP
    IF v_admin.lang = 'es' THEN
      v_title := '🎁 ' || COALESCE(v_name, 'Un miembro') || ' ganó una tarjeta';
      v_body  := COALESCE(v_name, 'Un miembro') || ' alcanzó ' || v_label_es
                 || ' hoy — imprímela y entrégala mientras está en el gym.';
    ELSE
      v_title := '🎁 ' || COALESCE(v_name, 'A member') || ' earned a card';
      v_body  := COALESCE(v_name, 'A member') || ' hit ' || v_label_en
                 || ' today — print it and hand it over while they''re here.';
    END IF;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key)
    VALUES (
      v_admin.id, v_gym_id, 'admin_message'::notification_type,
      v_title, v_body,
      jsonb_build_object('route', '/admin/print-cards', 'occasion', v_occasion,
                         'member_id', NEW.profile_id, 'card_id', v_card_id),
      'card_earned:' || v_admin.id::text || ':' || NEW.profile_id::text || ':' || v_occasion::text
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END LOOP;

  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

-- ==========================================================================
-- 10. RETENTION — weekly_attendance_flags_read_staff (member_weekly_attendance_flags)
--     Origin: 0395_member_weekly_attendance.sql:55-63
-- ==========================================================================
DROP POLICY IF EXISTS "weekly_attendance_flags_read_staff" ON member_weekly_attendance_flags;

CREATE POLICY "weekly_attendance_flags_read_staff"
  ON member_weekly_attendance_flags
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 11. RETENTION — cancellation_reasons read + insert policies
--     Origin: 0396_cancellation_reasons.sql:63-82
-- ==========================================================================
DROP POLICY IF EXISTS "cancellation_reasons_read_staff"   ON cancellation_reasons;
DROP POLICY IF EXISTS "cancellation_reasons_insert_admin" ON cancellation_reasons;

CREATE POLICY "cancellation_reasons_read_staff"
  ON cancellation_reasons
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

CREATE POLICY "cancellation_reasons_insert_admin"
  ON cancellation_reasons
  FOR INSERT WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 12. RETENTION — orchestrator RLS on member_outreach_state + owner_queue_items
--     Origin: 0398_retention_orchestrator.sql:60-132
-- ==========================================================================
DROP POLICY IF EXISTS "outreach_state_read_staff"   ON member_outreach_state;
DROP POLICY IF EXISTS "owner_queue_read_staff"     ON owner_queue_items;
DROP POLICY IF EXISTS "owner_queue_update_staff"   ON owner_queue_items;

CREATE POLICY "outreach_state_read_staff"
  ON member_outreach_state
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

CREATE POLICY "owner_queue_read_staff"
  ON owner_queue_items
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

CREATE POLICY "owner_queue_update_staff"
  ON owner_queue_items
  FOR UPDATE USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 13. RETENTION — lifecycle_log_read_staff
--     Origin: 0400_lifecycle_messages.sql:48-56
-- ==========================================================================
DROP POLICY IF EXISTS "lifecycle_log_read_staff" ON lifecycle_message_log;

CREATE POLICY "lifecycle_log_read_staff"
  ON lifecycle_message_log
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 14. RETENTION — winback_log_read_staff
--     Origin: 0402_winback_messages.sql:66-74
-- ==========================================================================
DROP POLICY IF EXISTS "winback_log_read_staff" ON winback_message_log;

CREATE POLICY "winback_log_read_staff"
  ON winback_message_log
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 15. RETENTION — message_templates read + write policies
--     Origin: 0403_message_templates.sql:55-86
-- ==========================================================================
DROP POLICY IF EXISTS "message_templates_read"  ON message_templates;
DROP POLICY IF EXISTS "message_templates_write" ON message_templates;

CREATE POLICY "message_templates_read"
  ON message_templates FOR SELECT
  USING (
    gym_id IS NULL
    OR gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

CREATE POLICY "message_templates_write"
  ON message_templates FOR ALL
  USING (
    gym_id IS NOT NULL
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
        )
    )
  )
  WITH CHECK (
    gym_id IS NOT NULL
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 16. RETENTION — membership_status_history msh_read_staff
--     Origin: 0405_membership_status_history.sql:84-92
-- ==========================================================================
DROP POLICY IF EXISTS "msh_read_staff" ON membership_status_history;

CREATE POLICY "msh_read_staff"
  ON membership_status_history
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 17. RETENTION — get_retention_effectiveness
--     Origin: 0407_effectiveness_timeseries.sql:18 (latest; 0404 was earlier)
--     Only the auth guard changes; body kept verbatim.
-- ==========================================================================
CREATE OR REPLACE FUNCTION get_retention_effectiveness(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin', 'trainer')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
        OR 'trainer'::user_role     = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'not authorized for gym %', p_gym_id USING ERRCODE = '42501';
  END IF;

  WITH
  totals AS (
    SELECT jsonb_build_object(
      'lifecycle_sent_7d', (
        SELECT COUNT(*)::INTEGER FROM lifecycle_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '7 days'
      ),
      'lifecycle_sent_30d', (
        SELECT COUNT(*)::INTEGER FROM lifecycle_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '30 days'
      ),
      'winback_sent_7d', (
        SELECT COUNT(*)::INTEGER FROM winback_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '7 days'
      ),
      'winback_sent_30d', (
        SELECT COUNT(*)::INTEGER FROM winback_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '30 days'
      ),
      'queue_resolved_7d', (
        SELECT COUNT(*)::INTEGER FROM owner_queue_items
        WHERE gym_id = p_gym_id AND status = 'done' AND resolved_at >= NOW() - INTERVAL '7 days'
      ),
      'queue_resolved_30d', (
        SELECT COUNT(*)::INTEGER FROM owner_queue_items
        WHERE gym_id = p_gym_id AND status = 'done' AND resolved_at >= NOW() - INTERVAL '30 days'
      ),
      'print_cards_delivered_30d', (
        SELECT COUNT(*)::INTEGER FROM print_cards
        WHERE gym_id = p_gym_id AND status = 'delivered' AND delivered_at >= NOW() - INTERVAL '30 days'
      ),
      'cancellations_30d', (
        SELECT COUNT(*)::INTEGER FROM cancellation_reasons
        WHERE gym_id = p_gym_id AND recorded_at >= NOW() - INTERVAL '30 days'
      ),
      'returns_30d', (
        SELECT COUNT(DISTINCT cr.profile_id)::INTEGER
        FROM cancellation_reasons cr
        JOIN profiles p ON p.id = cr.profile_id
        WHERE cr.gym_id = p_gym_id
          AND p.membership_status = 'active'
          AND p.membership_status_updated_at IS NOT NULL
          AND p.membership_status_updated_at > cr.recorded_at
          AND p.membership_status_updated_at >= NOW() - INTERVAL '30 days'
      )
    ) AS payload
  ),
  queue_outcomes AS (
    SELECT jsonb_agg(jsonb_build_object(
      'outcome', outcome,
      'count',   count
    ) ORDER BY count DESC) AS payload
    FROM (
      SELECT
        resolved_outcome AS outcome,
        COUNT(*)::INTEGER AS count
      FROM owner_queue_items
      WHERE gym_id = p_gym_id
        AND status = 'done'
        AND resolved_outcome IS NOT NULL
        AND resolved_at >= NOW() - INTERVAL '30 days'
      GROUP BY resolved_outcome
    ) o
  ),
  winback_by_category AS (
    SELECT jsonb_agg(jsonb_build_object(
      'category', category,
      'sent',     sent,
      'returned', returned
    ) ORDER BY sent DESC) AS payload
    FROM (
      SELECT
        wml.category::TEXT AS category,
        COUNT(DISTINCT wml.cancellation_id)::INTEGER AS sent,
        COUNT(DISTINCT wml.cancellation_id) FILTER (
          WHERE p.membership_status = 'active'
            AND p.membership_status_updated_at IS NOT NULL
            AND p.membership_status_updated_at > cr.recorded_at
        )::INTEGER AS returned
      FROM winback_message_log wml
      JOIN cancellation_reasons cr ON cr.id = wml.cancellation_id
      JOIN profiles p ON p.id = wml.profile_id
      WHERE wml.gym_id = p_gym_id
        AND wml.sent_at >= NOW() - INTERVAL '90 days'
      GROUP BY wml.category
    ) wbc
  ),
  lifecycle_by_step AS (
    SELECT jsonb_agg(jsonb_build_object(
      'step_key', step_key,
      'sent',     count
    ) ORDER BY step_key) AS payload
    FROM (
      SELECT step_key, COUNT(*)::INTEGER AS count
      FROM lifecycle_message_log
      WHERE gym_id = p_gym_id
        AND sent_at >= NOW() - INTERVAL '30 days'
      GROUP BY step_key
    ) ls
  ),
  cancellations_by_reason AS (
    SELECT jsonb_agg(jsonb_build_object(
      'category', category,
      'count',    count
    ) ORDER BY count DESC) AS payload
    FROM (
      SELECT category::TEXT AS category, COUNT(*)::INTEGER AS count
      FROM cancellation_reasons
      WHERE gym_id = p_gym_id
        AND recorded_at >= NOW() - INTERVAL '90 days'
      GROUP BY category
    ) cb
  ),
  week_buckets AS (
    SELECT week_start::DATE AS week_start
    FROM generate_series(
      (date_trunc('week', NOW()) - INTERVAL '12 weeks')::DATE,
      (date_trunc('week', NOW()) - INTERVAL '1 week')::DATE,
      INTERVAL '1 week'
    ) AS week_start
  ),
  weekly_lifecycle AS (
    SELECT date_trunc('week', sent_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS lifecycle_sent
    FROM lifecycle_message_log
    WHERE gym_id = p_gym_id
      AND sent_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND sent_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),
  weekly_winback AS (
    SELECT date_trunc('week', sent_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS winback_sent
    FROM winback_message_log
    WHERE gym_id = p_gym_id
      AND sent_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND sent_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),
  weekly_queue AS (
    SELECT date_trunc('week', resolved_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS queue_resolved
    FROM owner_queue_items
    WHERE gym_id = p_gym_id
      AND status = 'done'
      AND resolved_at IS NOT NULL
      AND resolved_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND resolved_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),
  weekly_cancellations AS (
    SELECT date_trunc('week', recorded_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS cancellations
    FROM cancellation_reasons
    WHERE gym_id = p_gym_id
      AND recorded_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND recorded_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),
  weekly_returns AS (
    SELECT date_trunc('week', p.membership_status_updated_at)::DATE AS week_start,
           COUNT(DISTINCT cr.profile_id)::INTEGER AS returns
    FROM cancellation_reasons cr
    JOIN profiles p ON p.id = cr.profile_id
    WHERE cr.gym_id = p_gym_id
      AND p.membership_status = 'active'
      AND p.membership_status_updated_at IS NOT NULL
      AND p.membership_status_updated_at > cr.recorded_at
      AND p.membership_status_updated_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND p.membership_status_updated_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),
  timeseries AS (
    SELECT jsonb_agg(jsonb_build_object(
      'week_start',     to_char(wb.week_start, 'YYYY-MM-DD'),
      'lifecycle_sent', COALESCE(wl.lifecycle_sent, 0),
      'winback_sent',   COALESCE(ww.winback_sent, 0),
      'queue_resolved', COALESCE(wq.queue_resolved, 0),
      'cancellations',  COALESCE(wc.cancellations, 0),
      'returns',        COALESCE(wr.returns, 0)
    ) ORDER BY wb.week_start) AS payload
    FROM week_buckets wb
    LEFT JOIN weekly_lifecycle     wl ON wl.week_start = wb.week_start
    LEFT JOIN weekly_winback       ww ON ww.week_start = wb.week_start
    LEFT JOIN weekly_queue         wq ON wq.week_start = wb.week_start
    LEFT JOIN weekly_cancellations wc ON wc.week_start = wb.week_start
    LEFT JOIN weekly_returns       wr ON wr.week_start = wb.week_start
  )

  SELECT jsonb_build_object(
    'totals',                  (SELECT payload FROM totals),
    'queue_outcomes',          COALESCE((SELECT payload FROM queue_outcomes),          '[]'::jsonb),
    'winback_by_category',     COALESCE((SELECT payload FROM winback_by_category),     '[]'::jsonb),
    'lifecycle_by_step',       COALESCE((SELECT payload FROM lifecycle_by_step),       '[]'::jsonb),
    'cancellations_by_reason', COALESCE((SELECT payload FROM cancellations_by_reason), '[]'::jsonb),
    'timeseries',              COALESCE((SELECT payload FROM timeseries),              '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_retention_effectiveness(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_retention_effectiveness(UUID) TO authenticated;

-- ==========================================================================
-- 18. RETENTION — milestone_push_log_read_staff
--     Origin: 0409_milestone_push_cron.sql:53-62
-- ==========================================================================
DROP POLICY IF EXISTS "milestone_push_log_read_staff" ON milestone_push_log;

CREATE POLICY "milestone_push_log_read_staff"
  ON milestone_push_log
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(p.additional_roles)
          OR 'super_admin'::user_role = ANY(p.additional_roles)
          OR 'trainer'::user_role     = ANY(p.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 19. RETENTION — resolve_queue_item
--     Origin: 0410_resolve_queue_item_rpc.sql:26
-- ==========================================================================
CREATE OR REPLACE FUNCTION resolve_queue_item(
  p_item_id UUID,
  p_outcome TEXT,
  p_note    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id      UUID;
  v_profile_id  UUID;
  v_lang        TEXT;
  v_title       TEXT;
  v_body        TEXT;
BEGIN
  IF p_outcome NOT IN ('reached_out', 'returned', 'no_response', 'lost') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome
      USING ERRCODE = '22023';
  END IF;

  SELECT gym_id, profile_id
    INTO v_gym_id, v_profile_id
  FROM owner_queue_items
  WHERE id = p_item_id;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'queue item not found: %', p_item_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = v_gym_id
      AND (
        role IN ('admin', 'super_admin', 'trainer')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
        OR 'trainer'::user_role     = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'not authorized for gym %', v_gym_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE owner_queue_items
  SET status           = 'done',
      resolved_at      = NOW(),
      resolved_by      = auth.uid(),
      resolved_outcome = p_outcome,
      resolved_note    = p_note
  WHERE id = p_item_id;

  IF p_outcome IN ('reached_out', 'returned') THEN
    SELECT COALESCE(preferred_language, 'en')
      INTO v_lang
    FROM profiles
    WHERE id = v_profile_id;

    IF v_lang = 'es' THEN
      v_title := 'Tu gimnasio te notó';
      v_body  := 'Alguien aquí pensó en ti hoy.';
    ELSE
      v_title := 'Your gym noticed you';
      v_body  := 'Someone here was thinking of you today.';
    END IF;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    VALUES (
      v_profile_id,
      v_gym_id,
      'admin_message',
      v_title,
      v_body,
      'queue_reflection_' || p_item_id::TEXT
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN p_item_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_queue_item(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION resolve_queue_item(UUID, TEXT, TEXT) TO authenticated;

-- ==========================================================================
-- 20. NOTIFICATION PRODUCERS — send_owner_morning_queue_push
--     Origin: 0406_owner_morning_queue_push.sql:26
--     Recipient lookup expansion only.
-- ==========================================================================
CREATE OR REPLACE FUNCTION send_owner_morning_queue_push()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url        TEXT;
  v_key        TEXT;
  v_today      TEXT := TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_pushes     INTEGER := 0;
  v_have_vault BOOLEAN;
  v_title      TEXT;
  v_body       TEXT;
  v_dedup      TEXT;
  v_req_id     BIGINT;
  r            RECORD;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  v_have_vault := (v_url IS NOT NULL AND v_key IS NOT NULL);
  IF NOT v_have_vault THEN
    RAISE LOG 'send_owner_morning_queue_push: vault secrets missing, skipping push delivery';
  END IF;

  FOR r IN
    WITH gym_counts AS (
      SELECT
        q.gym_id,
        COUNT(*)::INTEGER AS pending_count
      FROM owner_queue_items q
      WHERE q.status = 'pending'
        AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())
      GROUP BY q.gym_id
      HAVING COUNT(*) > 0
    )
    SELECT
      p.id                                       AS admin_id,
      p.gym_id                                   AS gym_id,
      COALESCE(p.preferred_language, 'en')       AS lang,
      gc.pending_count                           AS pending_count
    FROM gym_counts gc
    JOIN profiles p ON p.gym_id = gc.gym_id
    WHERE p.role IN ('admin', 'super_admin')
       OR 'admin'::user_role       = ANY(p.additional_roles)
       OR 'super_admin'::user_role = ANY(p.additional_roles)
  LOOP
    IF r.lang = 'es' THEN
      IF r.pending_count = 1 THEN
        v_title := r.pending_count || ' conversación esperando';
      ELSE
        v_title := r.pending_count || ' conversaciones esperando';
      END IF;
      v_body := 'Tu cola de retención está lista cuando tomes café.';
    ELSE
      IF r.pending_count = 1 THEN
        v_title := r.pending_count || ' conversation waiting';
      ELSE
        v_title := r.pending_count || ' conversations waiting';
      END IF;
      v_body := 'Your retention queue is ready when you have coffee.';
    END IF;

    v_dedup := 'morning_queue_' || r.admin_id::TEXT || '_' || v_today;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    VALUES (
      r.admin_id,
      r.gym_id,
      'admin_message'::notification_type,
      v_title,
      v_body,
      v_dedup
    )
    ON CONFLICT DO NOTHING;

    IF v_have_vault THEN
      SELECT net.http_post(
        url     := v_url || '/functions/v1/send-push-user',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_key,
          'Content-Type',  'application/json'
        ),
        body    := jsonb_build_object(
          'profile_id',        r.admin_id,
          'gym_id',            r.gym_id,
          'title',             v_title,
          'body',              v_body,
          'data',              jsonb_build_object(
                                  'route', '/admin',
                                  'type',  'morning_queue'
                               ),
          'notification_type', 'admin_message'
        )
      ) INTO v_req_id;
    END IF;

    v_pushes := v_pushes + 1;
  END LOOP;

  RETURN v_pushes;
END;
$$;

REVOKE EXECUTE ON FUNCTION send_owner_morning_queue_push() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION send_owner_morning_queue_push() TO service_role;

-- ==========================================================================
-- 21. NOTIFICATION PRODUCERS — _fan_out_admin_notification
--     Origin: 0412_admin_notification_producers.sql:52
--     Recipient lookup expansion only.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public._fan_out_admin_notification(
  p_gym_id     UUID,
  p_type       notification_type,
  p_title      TEXT,
  p_body       TEXT,
  p_data       JSONB,
  p_dedup_root TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  IF p_gym_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_admin IN
    SELECT id
    FROM profiles
    WHERE gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  LOOP
    INSERT INTO notifications (
      profile_id, gym_id, type, title, body, data, dedup_key, audience
    )
    VALUES (
      v_admin.id,
      p_gym_id,
      p_type,
      p_title,
      p_body,
      p_data,
      p_dedup_root || '_' || v_admin.id::text,
      'admin'::user_role
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
    DO NOTHING;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._fan_out_admin_notification(
  UUID, notification_type, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC;

-- ==========================================================================
-- 22. NOTIFICATION PRODUCERS — _notify_gym_admins
--     Origin: 0445_admin_tier2_notifications.sql:15
--     Recipient lookup expansion only.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public._notify_gym_admins(
  p_gym_id     UUID,
  p_type       notification_type,
  p_title_en   TEXT,
  p_body_en    TEXT,
  p_title_es   TEXT,
  p_body_es    TEXT,
  p_data       JSONB,
  p_dedup_root TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
BEGIN
  IF p_gym_id IS NULL THEN RETURN; END IF;
  FOR a IN
    SELECT id FROM profiles
    WHERE gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  LOOP
    PERFORM public._notify_push(
      a.id, p_gym_id, 'admin'::user_role, p_type,
      p_title_en, p_body_en, p_title_es, p_body_es, p_data,
      p_dedup_root || '_' || a.id::text
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_gym_admins(UUID,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

-- ==========================================================================
-- 23. MEMBER IMPORT — gym_import_batches "Gym admins read their own batches"
--     Origin: 0421_member_import_pipeline.sql:93-102
-- ==========================================================================
DROP POLICY IF EXISTS "Gym admins read their own batches" ON gym_import_batches;

CREATE POLICY "Gym admins read their own batches"
  ON gym_import_batches FOR SELECT
  USING (
    gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (
          profiles.role IN ('admin', 'super_admin')
          OR 'admin'::user_role       = ANY(profiles.additional_roles)
          OR 'super_admin'::user_role = ANY(profiles.additional_roles)
        )
    )
  );

-- ==========================================================================
-- 24. OLDER ADMIN RPC — record_gym_purchase
--     Origin: 0355_audit_sweep_db_fixes.sql:16
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.record_gym_purchase(
  p_gym_id      UUID,
  p_member_id   UUID,
  p_product_id  UUID,
  p_recorded_by UUID,
  p_quantity    INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product          RECORD;
  v_purchase_id      UUID;
  v_points_earned    INTEGER;
  v_total_price      NUMERIC(8,2);
  v_punch_current    INTEGER := 0;
  v_punch_target     INTEGER;
  v_free_earned      BOOLEAN := FALSE;
  v_free_purchase_id UUID;
  v_punch_card       RECORD;
  v_punch_changed    BOOLEAN := FALSE;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 1000';
  END IF;

  -- profile_lookup mirrors profiles 1:1 but lacks additional_roles; fall back
  -- to profiles for the multi-role expansion. The same-gym + admin check is
  -- preserved exactly; only the role predicate widens.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Only gym admins can record purchases';
  END IF;

  IF p_recorded_by != auth.uid() THEN
    RAISE EXCEPTION 'recorded_by must match the authenticated user';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_member_id::text || ':' || p_product_id::text)
  );

  SELECT price, points_per_purchase, punch_card_enabled, punch_card_target
    INTO v_product
    FROM gym_products
   WHERE id = p_product_id AND gym_id = p_gym_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;

  v_total_price   := v_product.price * p_quantity;
  v_points_earned := v_product.points_per_purchase * p_quantity;

  INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward)
  VALUES (p_gym_id, p_member_id, p_product_id, p_recorded_by, p_quantity, v_total_price, v_points_earned, FALSE)
  RETURNING id INTO v_purchase_id;

  IF v_product.punch_card_enabled THEN
    v_punch_target := COALESCE(v_product.punch_card_target, 10);
    v_punch_changed := TRUE;

    INSERT INTO member_punch_cards (gym_id, member_id, product_id, punches, total_completed)
    VALUES (p_gym_id, p_member_id, p_product_id, p_quantity, 0)
    ON CONFLICT (gym_id, member_id, product_id) DO UPDATE SET
      punches    = member_punch_cards.punches + p_quantity,
      updated_at = NOW()
    RETURNING punches, total_completed INTO v_punch_card;

    v_punch_current := v_punch_card.punches;

    IF v_punch_current >= v_punch_target THEN
      v_free_earned := TRUE;

      UPDATE member_punch_cards
      SET punches         = v_punch_current - v_punch_target,
          total_completed = v_punch_card.total_completed + 1,
          updated_at      = NOW()
      WHERE gym_id = p_gym_id AND member_id = p_member_id AND product_id = p_product_id;

      INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward)
      VALUES (p_gym_id, p_member_id, p_product_id, p_recorded_by, 1, 0, 0, TRUE)
      RETURNING id INTO v_free_purchase_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'purchase_id',       v_purchase_id,
    'points_earned',     v_points_earned,
    'total_price',       v_total_price,
    'punch_card_changed', v_punch_changed,
    'punch_current',     v_punch_current,
    'punch_target',      v_punch_target,
    'free_earned',       v_free_earned,
    'free_purchase_id',  v_free_purchase_id
  );
END;
$$;

-- ==========================================================================
-- 25. OLDER ADMIN RPC — earned_rewards_admin_all policy
--     Origin: 0370_earned_rewards.sql:77-91
-- ==========================================================================
DROP POLICY IF EXISTS earned_rewards_admin_all ON public.earned_rewards;

CREATE POLICY earned_rewards_admin_all ON public.earned_rewards
  FOR ALL
  USING (
    gym_id IN (
      SELECT p.gym_id FROM public.profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(p.additional_roles)
           OR 'super_admin'::user_role = ANY(p.additional_roles)
         )
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM public.profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(p.additional_roles)
           OR 'super_admin'::user_role = ANY(p.additional_roles)
         )
    )
  );

-- ==========================================================================
-- 26. OLDER ADMIN RPC — get_nps_stats
--     Origin: 0373_nps_realign_to_1_to_5_scale.sql:18
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.get_nps_stats(p_gym_id UUID, p_days INT DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result JSON;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_responses', COUNT(*),
    'promoters',  COUNT(*) FILTER (WHERE score >= 4),
    'passives',   COUNT(*) FILTER (WHERE score = 3),
    'detractors', COUNT(*) FILTER (WHERE score >= 1 AND score <= 2),
    'nps_score', CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
        (COUNT(*) FILTER (WHERE score >= 4)::NUMERIC / COUNT(*)::NUMERIC * 100)
        - (COUNT(*) FILTER (WHERE score >= 1 AND score <= 2)::NUMERIC / COUNT(*)::NUMERIC * 100)
      )
    END,
    'avg_score', ROUND(AVG(score)::NUMERIC, 1),
    'distribution', json_build_array(
      COUNT(*) FILTER (WHERE score = 1),
      COUNT(*) FILTER (WHERE score = 2),
      COUNT(*) FILTER (WHERE score = 3),
      COUNT(*) FILTER (WHERE score = 4),
      COUNT(*) FILTER (WHERE score = 5)
    ),
    'response_rate', (
      SELECT CASE
        WHEN member_count = 0 THEN 0
        ELSE ROUND(response_count::NUMERIC / member_count::NUMERIC * 100)
      END
      FROM (
        SELECT
          COUNT(DISTINCT nr.profile_id) AS response_count,
          (SELECT COUNT(*) FROM profiles WHERE gym_id = p_gym_id AND role = 'member') AS member_count
        FROM nps_responses nr
        WHERE nr.gym_id = p_gym_id
          AND nr.created_at >= now() - (p_days || ' days')::INTERVAL
          AND nr.score >= 1
      ) sub
    )
  )
  INTO _result
  FROM nps_responses
  WHERE gym_id = p_gym_id
    AND created_at >= now() - (p_days || ' days')::INTERVAL
    AND score >= 1;

  RETURN _result;
END;
$$;

NOTIFY pgrst, 'reload schema';
