-- =============================================================
-- 0686 — member_email_context: the real data an automated email needs
-- =============================================================
--
-- WHY
--
-- A generic "we miss you" does not convert. "Your Thursday 6pm Spinning is
-- booked and today's plan is Legs" does. That data exists — it is just not
-- reachable from a cron:
--
--   • get_dashboard_data() is keyed on auth.uid() (0551:500-628). A scheduled
--     job has no user, so the entire "today's plan" resolution the Dashboard
--     performs is unavailable server-side.
--   • Next-booked-class needs a three-table join plus an instructor fallback
--     chain that no RPC exposes.
--
-- One SECURITY DEFINER function returns the whole merge context in a single
-- round trip, so the sender does not make five queries per member.
--
-- HONEST-FAILURE RULE
--
-- Every field can come back NULL, and the renderer drops any line whose tokens
-- did not resolve (applyTokens in _shared/emailRenderer.ts). So "unknown" is
-- always safe: the sentence simply disappears. Nothing here should ever guess.
--
-- ON TODAY'S PLAN AND THE A/B SUFFIX
--
-- Dashboard renders the routine name through
-- `localizeRoutineName(name).replace(/ [AB]$/, '')` (Dashboard.jsx:786) — the
-- variant suffix is stripped for display. So resolving which of the A/B
-- rotations runs this week is irrelevant to the NAME, and we skip it: "Legs"
-- is correct either way. Anything that needed the actual routine id would have
-- to replicate resolveVariant (Dashboard.jsx:774-793).
--
-- REST DAY IS A REAL ANSWER
--
-- Mirrors Dashboard.jsx:845-849: if the member has a schedule at all and today
-- is not in it, today is a rest day — full stop. Do NOT fall through to
-- program rotation or least-recently-trained; that bulldozes the rest day the
-- member chose, and an email telling someone to train on their rest day is
-- worse than an email that says nothing.
-- =============================================================

CREATE OR REPLACE FUNCTION public.member_email_context(p_profile_id UUID)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_p            RECORD;
  v_gym          RECORD;
  v_brand        RECORD;
  v_email        TEXT;
  v_tz           TEXT;
  v_today        DATE;
  v_dow          INT;
  v_plan_name    TEXT;
  v_is_rest      BOOLEAN := FALSE;
  v_has_schedule BOOLEAN := FALSE;
  v_class        RECORD;
  v_instructor   TEXT;
  v_streak       INT := 0;
  v_workouts     INT := 0;
  v_days_inactive INT;
  v_last_class   TEXT;
BEGIN
  SELECT id, gym_id, full_name, language, timezone, last_active_at, email_unsub_token
    INTO v_p FROM profiles WHERE id = p_profile_id;
  IF v_p.id IS NULL THEN RETURN json_build_object('found', false); END IF;

  SELECT name, address INTO v_gym FROM gyms WHERE id = v_p.gym_id;
  SELECT logo_url, primary_color, secondary_color, custom_app_name
    INTO v_brand FROM gym_branding WHERE gym_id = v_p.gym_id;

  -- The real address: admin-created members carry a shadow
  -- invite-<uuid>@invite.tugympr.invalid on auth.users, with the true one in
  -- raw_user_meta_data.pending_email (0603).
  SELECT COALESCE(
           NULLIF(u.raw_user_meta_data ->> 'pending_email', ''),
           CASE WHEN u.email LIKE '%@%.invalid' THEN NULL ELSE u.email END)
    INTO v_email FROM auth.users u WHERE u.id = p_profile_id;

  -- Everything date-shaped is in the MEMBER's timezone, not the server's.
  v_tz    := COALESCE(NULLIF(v_p.timezone, ''), 'America/Puerto_Rico');
  v_today := (NOW() AT TIME ZONE v_tz)::DATE;
  v_dow   := EXTRACT(DOW FROM v_today)::INT;   -- 0 = Sunday, app-wide

  -- ── Today's plan ──
  SELECT EXISTS (SELECT 1 FROM workout_schedule WHERE profile_id = p_profile_id)
    INTO v_has_schedule;

  SELECT regexp_replace(r.name, ' [AB]$', '')
    INTO v_plan_name
    FROM workout_schedule ws
    JOIN routines r ON r.id = ws.routine_id
   WHERE ws.profile_id = p_profile_id AND ws.day_of_week = v_dow
   LIMIT 1;

  IF v_plan_name IS NULL AND v_has_schedule THEN
    -- They have a schedule and today isn't in it. Rest day, and we stop.
    v_is_rest := TRUE;
  ELSIF v_plan_name IS NULL THEN
    -- No personal schedule — fall back to the generated program's map.
    SELECT regexp_replace(r.name, ' [AB]$', '')
      INTO v_plan_name
      FROM generated_programs gp
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(gp.schedule_map -> 'routine_day_map', '[]'::jsonb)) AS m(entry)
      JOIN routines r ON r.created_by = p_profile_id
                     AND r.name ILIKE 'Auto:%'
                     -- Stale-program guard: a regenerated program leaves the
                     -- old Auto: rows behind and they still resolve.
                     AND r.created_at >= gp.program_start
     WHERE gp.profile_id = p_profile_id
       AND gp.expires_at > NOW()
       AND (m.entry ->> 'day_of_week')::INT = v_dow
     ORDER BY gp.created_at DESC, r.created_at DESC
     LIMIT 1;
  END IF;

  -- ── Next booked class ──
  SELECT b.booking_date, s.start_time, s.id AS schedule_id, s.trainer_id AS slot_trainer,
         c.name, c.name_es, c.trainer_id AS class_trainer, c.instructor_name
    INTO v_class
    FROM gym_class_bookings b
    JOIN gym_class_schedules s ON s.id = b.schedule_id
    JOIN gym_classes c         ON c.id = s.class_id
   WHERE b.profile_id = p_profile_id
     AND b.status = 'confirmed'
     AND b.booking_date >= v_today
   ORDER BY b.booking_date ASC, s.start_time ASC
   LIMIT 1;

  IF v_class.schedule_id IS NOT NULL THEN
    -- Per-slot trainer wins, then the class's, then the free-text name.
    SELECT full_name INTO v_instructor FROM profiles
     WHERE id = COALESCE(v_class.slot_trainer, v_class.class_trainer);
    v_instructor := COALESCE(NULLIF(v_instructor, ''), NULLIF(v_class.instructor_name, ''));
  END IF;

  -- The class they used to attend — for win-back, where "next class" is empty
  -- by definition.
  SELECT COALESCE(NULLIF(c.name_es, ''), c.name) INTO v_last_class
    FROM gym_class_bookings b
    JOIN gym_class_schedules s ON s.id = b.schedule_id
    JOIN gym_classes c         ON c.id = s.class_id
   WHERE b.profile_id = p_profile_id AND b.status IN ('attended','confirmed')
   ORDER BY b.booking_date DESC LIMIT 1;

  -- ── Stats ──
  SELECT COALESCE(current_streak_days, 0) INTO v_streak
    FROM streak_cache WHERE profile_id = p_profile_id;
  SELECT COUNT(*) INTO v_workouts
    FROM workout_sessions WHERE profile_id = p_profile_id AND status = 'completed';
  v_days_inactive := CASE WHEN v_p.last_active_at IS NULL THEN NULL
                          ELSE GREATEST(0, (v_today - v_p.last_active_at::DATE)) END;

  RETURN json_build_object(
    'found', true,
    'profile_id', v_p.id,
    'gym_id', v_p.gym_id,
    'email', v_email,
    'language', COALESCE(v_p.language, 'en'),
    'unsub_token', v_p.email_unsub_token,
    'gym', json_build_object(
      'name', COALESCE(v_gym.name, v_brand.custom_app_name, ''),
      'address', v_gym.address,
      'logo_ref', v_brand.logo_url,          -- bucket path; the sender signs it
      'primary_color', COALESCE(v_brand.primary_color, '#D4AF37'),
      'secondary_color', COALESCE(v_brand.secondary_color, '#0F172A')
    ),
    'values', json_build_object(
      'first_name',    COALESCE(NULLIF(split_part(v_p.full_name, ' ', 1), ''), ''),
      'member_name',   COALESCE(v_p.full_name, ''),
      'full_name',     COALESCE(v_p.full_name, ''),
      'gym_name',      COALESCE(v_gym.name, ''),
      'gym_address',   COALESCE(v_gym.address, ''),
      'streak_count',  v_streak::TEXT,
      'workout_count', v_workouts::TEXT,
      'days_inactive', CASE WHEN v_days_inactive IS NULL THEN NULL ELSE v_days_inactive::TEXT END,
      -- NULL on a rest day on purpose: the sentence disappears rather than
      -- telling someone to train when they planned not to.
      'today_plan_name', CASE WHEN v_is_rest THEN NULL ELSE v_plan_name END,
      'next_class_name', CASE WHEN v_class.schedule_id IS NULL THEN NULL
                              ELSE COALESCE(NULLIF(v_class.name_es, ''), v_class.name) END,
      'next_class_date', CASE WHEN v_class.schedule_id IS NULL THEN NULL
                              ELSE to_char(v_class.booking_date, 'YYYY-MM-DD') END,
      -- substr, not to_char: to_char has no `time` overload (see 0655:150).
      'next_class_time', CASE WHEN v_class.schedule_id IS NULL THEN NULL
                              ELSE substr(v_class.start_time::TEXT, 1, 5) END,
      'next_class_instructor', v_instructor,
      'next_class_schedule_id', v_class.schedule_id,
      'last_class_name', v_last_class
    ),
    'is_rest_day', v_is_rest
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.member_email_context(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_email_context(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.member_email_context(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verify:
--   SELECT member_email_context('<profile>');
--   -- rest day → values.today_plan_name IS NULL and is_rest_day = true
--   -- no booking → every next_class_* NULL, and the renderer drops those lines
-- =============================================================
