-- ============================================================
-- 0660 — Consent gates the SIDE DOORS too
-- ============================================================
-- ⚠️ APPLY ON STAGING FIRST, like 0657.
--
-- 0657 put the consent test inside is_trainer_of() and _can_manage_client(),
-- which covers every RLS policy that routes through them. An audit of the
-- member↔trainer seam found that is only ONE of three surfaces:
--
--   1. RLS policies via the helpers        → closed by 0657 ✓
--   2. Tables gated on `trainer_id = auth.uid()` ALONE  → OPEN
--   3. SECURITY DEFINER functions doing their own
--      `trainer_clients … is_active` check → OPEN
--
-- What that meant in practice: a trainer whose request had NOT been accepted
-- could still push a meal plan, a workout plan, sessions and a weekly schedule
-- at that member — and the member SAW them, because the member-side policies
-- are a bare `client_id = auth.uid()`. Meanwhile they were notified of every
-- workout the member completed, every PR, and every at-risk flag; could write a
-- live cue into their active session; could open a DM thread; and could read
-- their full profile preview.
--
-- The tell that it was a real gap and not a design: assigning a PROGRAM was
-- already blocked (trainer_client_programs goes through _can_manage_client) and
-- so was editing their GOALS — but a MEAL PLAN was not. Same act, two doors.
--
-- THE SHAPE OF THE FIX
--   Consent gates WRITES and NOTIFICATIONS, not the trainer's own reads.
--   `USING` stays open on these policies deliberately: a trainer must still be
--   able to see and DELETE content they created for someone who then declined.
--   Taking that away would strand rows nobody can clean up.
--
-- NOT GATED, ON PURPOSE
--   get_trainer_money_overview / get_trainer_year_overview. Those are the
--   TRAINER's own income records. 0533's own comment says it is deliberately
--   not gated on is_active so that deactivating a client cannot erase collected
--   history — the same reasoning applies here, more so.
--
--   trainer_automations.ta_owner_all. That table is the trainer's own rule
--   config and has no client_id; the consent test belongs where the rules FAN
--   OUT to clients, which is run_trainer_automations below.
--
--   Member → trainer messaging. get_or_create_conversation has a separate
--   "anyone may DM gym staff" branch, so closing the trainer→client direction
--   leaves the member perfectly able to ask "who are you?" — which is exactly
--   the asymmetry you want.
-- ============================================================

-- ── The third helper ──────────────────────────────────────────────────────
-- Reads like the sentence it enforces. NULL client = a template or draft with
-- nobody attached (trainer_workout_plans.client_id went nullable in 0571,
-- trainer_meal_plans in 0582), and a trainer must always be able to build those.
CREATE OR REPLACE FUNCTION public.has_client_consent(p_trainer_id UUID, p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_client_id IS NULL OR EXISTS (
    SELECT 1 FROM public.trainer_clients
     WHERE trainer_id = p_trainer_id
       AND client_id  = p_client_id
       AND is_active  = TRUE
       AND status     = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.has_client_consent(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_client_consent(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_client_consent(UUID, UUID) TO anon;

-- ── 1. Stop a pending trainer CREATING content for a member ───────────────
-- Rebuilt from their latest definitions (0291, 0211, 0452) with the consent
-- clause added to WITH CHECK only. Diff them against those files.

DROP POLICY IF EXISTS "trainer_meal_plans_trainer_all" ON trainer_meal_plans;
CREATE POLICY "trainer_meal_plans_trainer_all" ON trainer_meal_plans
  FOR ALL
  TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = public.current_gym_id()
    AND public.has_client_consent(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "trainer_plans_trainer_all" ON trainer_workout_plans;
CREATE POLICY "trainer_plans_trainer_all" ON trainer_workout_plans
  FOR ALL USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND public.has_client_consent(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "trainer_sessions_trainer_all" ON trainer_sessions;
CREATE POLICY "trainer_sessions_trainer_all" ON trainer_sessions
  FOR ALL USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND public.has_client_consent(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "tcs_trainer_all" ON public.trainer_client_schedule;
CREATE POLICY "tcs_trainer_all" ON public.trainer_client_schedule
  FOR ALL TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid() AND public.has_client_consent(auth.uid(), client_id));

-- ── 2. Stop the MEMBER seeing content from a trainer they never accepted ──
-- The write gate above stops new rows. These stop anything already written —
-- including everything created before this migration — from showing up in
-- Nutrition, Workouts or Sessions under a stranger's name.
DROP POLICY IF EXISTS "trainer_meal_plans_client_select" ON trainer_meal_plans;
CREATE POLICY "trainer_meal_plans_client_select" ON trainer_meal_plans
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() AND public.has_client_consent(trainer_id, auth.uid()));

DROP POLICY IF EXISTS "trainer_sessions_client_select" ON trainer_sessions;
CREATE POLICY "trainer_sessions_client_select" ON trainer_sessions
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() AND public.has_client_consent(trainer_id, auth.uid()));

DROP POLICY IF EXISTS "tcs_client_select" ON public.trainer_client_schedule;
CREATE POLICY "tcs_client_select" ON public.trainer_client_schedule
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() AND public.has_client_consent(trainer_id, auth.uid()));

-- ── 3. The SECURITY DEFINER functions ─────────────────────────────────────
-- Each is its latest definition VERBATIM with exactly one clause added.
-- Regenerate from the source file listed above each if they ever change again.

-- trainer_send_cue  ← rebuilt from 0549_set_log_cue.sql
CREATE OR REPLACE FUNCTION trainer_send_cue(
  p_client_id  UUID,
  p_cue_type   TEXT,
  p_payload    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainer_id UUID := auth.uid();
  v_gym_id     UUID;
  v_cue_id     UUID;
BEGIN
  IF v_trainer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be the trainer-of-record for this client (active assignment).
  -- Pull gym_id from the assignment row so we don't trust client-supplied data.
  SELECT gym_id INTO v_gym_id
    FROM trainer_clients
   WHERE trainer_id = v_trainer_id
     AND client_id  = p_client_id
     AND is_active  = TRUE
    AND status     = 'active'
   LIMIT 1;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Not assigned as trainer for this client';
  END IF;

  -- Cue type whitelist (also enforced by CHECK constraint, but the explicit
  -- error message is more useful than a constraint violation).
  IF p_cue_type NOT IN ('rest_extend', 'weight_adjust', 'drop_set', 'note', 'set_log') THEN
    RAISE EXCEPTION 'Unknown cue type: %', p_cue_type;
  END IF;

  INSERT INTO session_cues (client_id, trainer_id, gym_id, cue_type, payload)
  VALUES (p_client_id, v_trainer_id, v_gym_id, p_cue_type, p_payload)
  RETURNING id INTO v_cue_id;

  RETURN v_cue_id;
END;
$$;

-- fire_trainer_client_workout  ← rebuilt from 0443_trainer_tier2_notifications.sql
CREATE OR REPLACE FUNCTION public.fire_trainer_client_workout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_tr   RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'completed' THEN
    RETURN NEW; -- already counted
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Your client') INTO v_name
  FROM profiles WHERE id = NEW.profile_id;

  FOR v_tr IN
    SELECT trainer_id FROM trainer_clients
    WHERE client_id = NEW.profile_id AND is_active = TRUE AND status = 'active'
  LOOP
    PERFORM public._notify_push(
      v_tr.trainer_id, NEW.gym_id, 'trainer'::user_role, 'client_workout_logged'::notification_type,
      v_name || ' completed a workout',
      v_name || ' just finished a session. Their numbers are updated.',
      v_name || ' completó un entrenamiento',
      v_name || ' acaba de terminar una sesión. Sus datos están actualizados.',
      jsonb_build_object('route', '/trainer/clients/' || NEW.profile_id::text, 'client_id', NEW.profile_id, 'session_id', NEW.id),
      'trainer_clientwo_' || NEW.id::text || '_' || v_tr.trainer_id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_client_workout failed (session %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- fire_trainer_client_pr  ← rebuilt from 0443_trainer_tier2_notifications.sql
CREATE OR REPLACE FUNCTION public.fire_trainer_client_pr()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_tr   RECORD;
BEGIN
  SELECT COALESCE(NULLIF(full_name, ''), 'Your client') INTO v_name
  FROM profiles WHERE id = NEW.profile_id;

  FOR v_tr IN
    SELECT trainer_id FROM trainer_clients
    WHERE client_id = NEW.profile_id AND is_active = TRUE AND status = 'active'
  LOOP
    PERFORM public._notify_push(
      v_tr.trainer_id, NEW.gym_id, 'trainer'::user_role, 'client_pr'::notification_type,
      v_name || ' hit a new PR 🏆',
      v_name || ' just set a new personal record (' || NEW.weight::text || ' x ' || NEW.reps::text || '). Nice coaching.',
      v_name || ' logró un nuevo récord 🏆',
      v_name || ' acaba de marcar un récord personal (' || NEW.weight::text || ' x ' || NEW.reps::text || '). Buen trabajo.',
      jsonb_build_object('route', '/trainer/clients/' || NEW.profile_id::text, 'client_id', NEW.profile_id),
      'trainer_clientpr_' || NEW.id::text || '_' || v_tr.trainer_id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_client_pr failed (pr %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- fire_trainer_client_at_risk  ← rebuilt from 0439_trainer_notification_producers.sql
CREATE OR REPLACE FUNCTION public.fire_trainer_client_at_risk()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name    TEXT;
  v_crossed BOOLEAN := FALSE;
  v_tr      RECORD;
BEGIN
  IF NEW.risk_tier IS DISTINCT FROM 'critical' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_crossed := TRUE;
  ELSIF TG_OP = 'UPDATE' AND OLD.risk_tier IS DISTINCT FROM 'critical' THEN
    v_crossed := TRUE;
  END IF;
  IF NOT v_crossed THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'A client') INTO v_name
  FROM profiles WHERE id = NEW.profile_id;

  FOR v_tr IN
    SELECT trainer_id FROM trainer_clients
    WHERE client_id = NEW.profile_id AND is_active = TRUE AND status = 'active'
  LOOP
    PERFORM public._notify_trainer(
      v_tr.trainer_id, NEW.gym_id, 'client_adherence_drop'::notification_type,
      v_name || ' is now at high risk',
      'Their churn risk just hit critical (score ' || NEW.score::text || '). A quick check-in today goes a long way.',
      COALESCE(NULLIF((SELECT full_name FROM profiles WHERE id = NEW.profile_id), ''), 'Un cliente') || ' está en riesgo alto',
      'Su riesgo de abandono pasó a crítico (score ' || NEW.score::text || '). Un mensaje hoy puede marcar la diferencia.',
      jsonb_build_object('route', '/trainer/clients/' || NEW.profile_id::text, 'client_id', NEW.profile_id, 'score', NEW.score),
      'trainer_churncrit_' || NEW.profile_id::text || '_' || v_tr.trainer_id::text || '_' || CURRENT_DATE::text
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_client_at_risk failed for profile %: %', NEW.profile_id, SQLERRM;
  RETURN NEW;
END;
$$;

-- get_or_create_conversation  ← rebuilt from 0536_conversations_effective_roles.sql
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_caller_gym     UUID;
  v_caller_role    TEXT;
  v_caller_extra   public.user_role[];
  v_other_gym      UUID;
  v_other_role     TEXT;
  v_other_extra    public.user_role[];
  v_caller_is_admin   BOOLEAN;
  v_caller_is_trainer BOOLEAN;
  v_other_is_staff    BOOLEAN;
  v_allowed        BOOLEAN := FALSE;
  v_convo_id       UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller_id = p_other_user THEN
    RAISE EXCEPTION 'Cannot DM yourself';
  END IF;

  -- Block enforcement (preserved from 0338/0355/0374).
  IF EXISTS (
    SELECT 1 FROM public.is_blocked_pair(v_caller_id, p_other_user) WHERE is_blocked_pair = TRUE
  ) THEN
    RAISE EXCEPTION 'Conversation blocked';
  END IF;

  SELECT gym_id, role::TEXT, COALESCE(additional_roles, '{}'::public.user_role[])
    INTO v_caller_gym, v_caller_role, v_caller_extra
    FROM public.profile_lookup WHERE id = v_caller_id;
  SELECT gym_id, role::TEXT, COALESCE(additional_roles, '{}'::public.user_role[])
    INTO v_other_gym, v_other_role, v_other_extra
    FROM public.profile_lookup WHERE id = p_other_user;

  IF v_caller_gym IS NULL OR v_other_gym IS NULL OR v_caller_gym <> v_other_gym THEN
    RAISE EXCEPTION 'Cannot DM users outside your gym';
  END IF;

  -- Effective-role flags (primary role OR additional_roles).
  v_caller_is_admin :=
       v_caller_role IN ('admin', 'super_admin')
    OR v_caller_extra && ARRAY['admin', 'super_admin']::public.user_role[];
  v_caller_is_trainer :=
       v_caller_role = 'trainer'
    OR 'trainer'::public.user_role = ANY(v_caller_extra);
  v_other_is_staff :=
       v_other_role IN ('trainer', 'admin', 'super_admin')
    OR v_other_extra && ARRAY['trainer', 'admin', 'super_admin']::public.user_role[];

  -- Gating: a conversation is allowed if ANY of the caller's effective
  -- roles permits it.
  IF v_caller_is_admin THEN
    v_allowed := TRUE;                       -- admins are unrestricted
  END IF;

  IF NOT v_allowed AND v_other_is_staff THEN
    v_allowed := TRUE;                       -- anyone may DM gym staff
  END IF;

  IF NOT v_allowed AND v_caller_is_trainer THEN
    IF EXISTS (
      SELECT 1 FROM trainer_clients
      WHERE trainer_id = v_caller_id AND client_id = p_other_user AND is_active = TRUE
         AND status = 'active'
    ) THEN
      v_allowed := TRUE;                     -- trainer → assigned client
    END IF;
  END IF;

  IF NOT v_allowed THEN
    IF EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((requester_id = v_caller_id AND addressee_id = p_other_user)
          OR (requester_id = p_other_user AND addressee_id = v_caller_id))
    ) THEN
      v_allowed := TRUE;                     -- accepted friends
    END IF;
  END IF;

  IF NOT v_allowed THEN
    IF v_caller_is_trainer THEN
      RAISE EXCEPTION 'Trainers can only DM assigned clients';
    ELSE
      RAISE EXCEPTION 'Members can only DM friends, trainers, or admins';
    END IF;
  END IF;

  -- Find existing conversation (either ordering) using the real schema.
  SELECT id INTO v_convo_id FROM conversations
  WHERE (participant_1 = v_caller_id AND participant_2 = p_other_user)
     OR (participant_1 = p_other_user AND participant_2 = v_caller_id)
  LIMIT 1;

  IF v_convo_id IS NOT NULL THEN
    RETURN v_convo_id;
  END IF;

  -- Don't generate the encryption_seed inline. pgcrypto's gen_random_bytes()
  -- isn't enabled on every Supabase project (we hit 42883 in production).
  -- conversations.encryption_seed has DEFAULT gen_random_uuid()::text from
  -- migration 0228, which IS available everywhere — let the column default
  -- fire instead.
  INSERT INTO conversations (gym_id, participant_1, participant_2)
  VALUES (v_caller_gym, v_caller_id, p_other_user)
  RETURNING id INTO v_convo_id;

  RETURN v_convo_id;
END;
$$;

-- get_profile_preview  ← rebuilt from 0573_feed_and_preview_role.sql
CREATE OR REPLACE FUNCTION public.get_profile_preview(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          UUID;
  my_gym       UUID;
  their_gym    UUID;
  their_role   TEXT;
  is_private   BOOLEAN;
  caller_role  TEXT;
  result       JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Own profile — always allowed
  IF uid = p_user_id THEN
    NULL;
  ELSE
    -- Get caller's gym and role
    SELECT pl.gym_id, pl.role::TEXT INTO my_gym, caller_role
      FROM profile_lookup pl WHERE pl.id = uid;

    -- Get target's gym and privacy flag
    SELECT p.gym_id, p.privacy_public INTO their_gym, is_private
      FROM profiles p WHERE p.id = p_user_id;

    -- privacy_public = FALSE means the profile is private (confusing name).

    -- Enforce same-gym boundary
    IF my_gym IS NULL OR their_gym IS NULL OR my_gym != their_gym THEN
      RETURN NULL;
    END IF;

    -- Privacy check: if target is private, only admins / trainers / accepted
    -- friends may view.
    IF is_private = FALSE THEN
      -- Caller is admin or super_admin — allowed
      IF caller_role IN ('admin', 'super_admin') THEN
        NULL;
      -- Caller is a trainer of this user — allowed
      ELSIF EXISTS (
        SELECT 1 FROM trainer_clients
        WHERE trainer_id = uid AND client_id = p_user_id AND is_active = TRUE AND status = 'active'
      ) THEN
        NULL;
      -- Caller is an accepted friend (either direction) — allowed
      ELSIF EXISTS (
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = uid AND addressee_id = p_user_id)
            OR (requester_id = p_user_id AND addressee_id = uid))
      ) THEN
        NULL;
      ELSE
        -- Regular member viewing a private, non-friend profile — blocked
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  SELECT json_build_object(
    'profile', (
      SELECT json_build_object(
        'id',           p.id,
        'username',     p.username,
        'full_name',    p.full_name,
        'avatar_url',   p.avatar_url,
        'avatar_type',  p.avatar_type,
        'avatar_value', p.avatar_value,
        'created_at',   p.created_at,
        'fitness_level', mo.fitness_level,
        'goal',         mo.primary_goal,
        'role',         p.role
      )
      FROM profiles p
      LEFT JOIN member_onboarding mo ON mo.profile_id = p.id
      WHERE p.id = p_user_id
    ),
    'workouts', (
      SELECT COUNT(*)::INT FROM workout_sessions WHERE profile_id = p_user_id
    ),
    'prs', (
      SELECT COUNT(*)::INT FROM personal_records WHERE profile_id = p_user_id
    ),
    'streak', (
      SELECT COALESCE(current_streak_days, 0)
      FROM streak_cache WHERE profile_id = p_user_id
    ),
    'latest_achievement', (
      SELECT achievement_key
      FROM user_achievements
      WHERE profile_id = p_user_id OR user_id = p_user_id
      ORDER BY unlocked_at DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- extend_trainer_schedule_materialization  ← rebuilt from 0529_set_client_schedule_v2.sql
CREATE OR REPLACE FUNCTION public.extend_trainer_schedule_materialization()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO trainer_sessions (gym_id, trainer_id, client_id, title, scheduled_at, duration_mins, status, from_schedule)
  SELECT sch.gym_id, sch.trainer_id, sch.client_id, 'Entrenamiento',
         ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico'),
         sch.duration_mins, 'scheduled', true
  FROM trainer_client_schedule sch
  CROSS JOIN generate_series(date_trunc('day', now())::date, (now() + interval '8 weeks')::date, '1 day') d
  WHERE EXTRACT(dow FROM d) = sch.day_of_week
    AND ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico') >= now()
    -- Only extend pairs that are still an active coaching relationship.
    AND EXISTS (
      SELECT 1 FROM trainer_clients tc
       WHERE tc.trainer_id = sch.trainer_id
         AND tc.client_id  = sch.client_id
         AND tc.is_active  = true
      AND tc.status     = 'active'
    )
    AND NOT EXISTS (
      SELECT 1 FROM trainer_sessions ts
       WHERE ts.trainer_id = sch.trainer_id
         AND ts.client_id  = sch.client_id
         AND ts.scheduled_at = ((d::date + sch.start_time) AT TIME ZONE 'America/Puerto_Rico')
    );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'extend_trainer_schedule_materialization failed: %', SQLERRM;
END;
$$;

-- run_trainer_automations  ← rebuilt from 0501_trainer_automations.sql
CREATE OR REPLACE FUNCTION public.run_trainer_automations()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule   RECORD;
  v_client RECORD;
  v_week   TEXT := to_char(CURRENT_DATE, 'IYYY"-W"IW');
  v_period DATE := date_trunc('week', CURRENT_DATE)::date;  -- Monday
  v_dow    INT  := EXTRACT(ISODOW FROM CURRENT_DATE);       -- 1=Mon..7=Sun
  v_name   TEXT;
  v_t_en   TEXT; v_t_es TEXT; v_b_en TEXT; v_b_es TEXT;
  v_fire   BOOLEAN;
BEGIN
  FOR v_rule IN
    SELECT * FROM trainer_automations WHERE is_active = true
  LOOP
    -- Each rule applies to all of that trainer's ACTIVE clients in the gym.
    FOR v_client IN
      SELECT tc.client_id, p.full_name, p.created_at
      FROM trainer_clients tc
      JOIN profiles p ON p.id = tc.client_id
      WHERE tc.trainer_id = v_rule.trainer_id
        AND tc.gym_id = v_rule.gym_id
        AND tc.is_active = true
        AND tc.status = 'active'
    LOOP
      v_fire := false;

      IF v_rule.trigger_type = 'inactivity' THEN
        -- Skip brand-new clients (no fair window yet).
        IF v_client.created_at <= now() - (v_rule.threshold_days || ' days')::interval THEN
          v_fire := NOT EXISTS (
            SELECT 1 FROM workout_sessions ws
            WHERE ws.profile_id = v_client.client_id
              AND ws.status = 'completed'
              AND ws.completed_at >= now() - (v_rule.threshold_days || ' days')::interval
          );
        END IF;

      ELSIF v_rule.trigger_type = 'missed_checkin' THEN
        -- Only late in the week (Thu+), only if they actually have an assigned
        -- check-in, and only if no response exists for this week's period.
        IF v_dow >= 4 THEN
          v_fire := EXISTS (
              SELECT 1 FROM checkin_assignments ca
              WHERE ca.profile_id = v_client.client_id AND ca.active = true
            )
            AND NOT EXISTS (
              SELECT 1 FROM checkin_responses cr
              JOIN checkin_assignments ca2 ON ca2.template_id = cr.template_id AND ca2.active = true
              WHERE cr.profile_id = v_client.client_id
                AND ca2.profile_id = v_client.client_id
                AND cr.period_start = v_period
            );
        END IF;
      END IF;

      CONTINUE WHEN NOT v_fire;

      v_name := COALESCE(NULLIF(split_part(v_client.full_name, ' ', 1), ''), 'Your client');

      IF v_rule.action = 'nudge_member' THEN
        IF v_rule.trigger_type = 'inactivity' THEN
          v_t_en := 'We miss you 💪';  v_t_es := 'Te extrañamos 💪';
          v_b_en := 'Ready for your next workout? Your coach is rooting for you.';
          v_b_es := '¿Listo para tu próximo entrenamiento? Tu entrenador te apoya.';
        ELSE
          v_t_en := 'Quick check-in 📋'; v_t_es := 'Check-in rápido 📋';
          v_b_en := 'Don''t forget this week''s check-in — it helps your coach help you.';
          v_b_es := 'No olvides tu check-in de esta semana — ayuda a tu entrenador a apoyarte.';
        END IF;
        PERFORM public._notify_push(
          v_client.client_id, v_rule.gym_id, 'member'::user_role, 'announcement'::notification_type,
          v_t_en, v_b_en, v_t_es, v_b_es,
          jsonb_build_object('route', '/dashboard', 'source', 'automation'),
          'autonudge_' || v_rule.id::text || '_' || v_client.client_id::text || '_' || v_week
        );
      ELSE
        -- notify_trainer
        IF v_rule.trigger_type = 'inactivity' THEN
          v_t_en := v_name || ' has gone quiet';
          v_t_es := v_name || ' está inactivo';
          v_b_en := 'No workouts in ' || v_rule.threshold_days || ' days. A quick message could bring them back.';
          v_b_es := 'Sin entrenamientos en ' || v_rule.threshold_days || ' días. Un mensaje podría traerlo de vuelta.';
        ELSE
          v_t_en := v_name || ' missed their check-in';
          v_t_es := v_name || ' no hizo su check-in';
          v_b_en := 'No check-in logged this week.';
          v_b_es := 'No registró check-in esta semana.';
        END IF;
        PERFORM public._notify_push(
          v_rule.trainer_id, v_rule.gym_id, 'trainer'::user_role, 'trainer_alert'::notification_type,
          v_t_en, v_b_en, v_t_es, v_b_es,
          jsonb_build_object('route', '/trainer/clients/' || v_client.client_id::text, 'source', 'automation'),
          'autoalert_' || v_rule.id::text || '_' || v_client.client_id::text || '_' || v_week
        );
      END IF;
    END LOOP;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'run_trainer_automations failed: %', SQLERRM;
END;
$$;

-- get_trainer_adherence  ← rebuilt from 0330_trainer_adherence.sql
CREATE OR REPLACE FUNCTION public.get_trainer_adherence(
  p_trainer_id UUID,
  p_week_start DATE DEFAULT (date_trunc('week', now() AT TIME ZONE 'UTC')::date)
)
RETURNS TABLE (
  client_id        UUID,
  client_name      TEXT,
  client_avatar    TEXT,
  client_username  TEXT,
  plan_id          UUID,
  plan_name        TEXT,
  planned_count    INT,
  completed_count  INT,
  last_session_at  TIMESTAMPTZ,
  status           TEXT  -- 'on_track' | 'at_risk' | 'behind' | 'inactive'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH assigned AS (
    SELECT
      tc.client_id,
      twp.id   AS plan_id,
      twp.name AS plan_name,
      -- Planned sessions per week:
      -- 1) length of plan.weeks->'1' if defined (jsonb array)
      -- 2) else fall back to member_onboarding.training_days_per_week
      -- 3) else default to 3
      COALESCE(
        NULLIF(
          jsonb_array_length(
            CASE
              WHEN jsonb_typeof(twp.weeks -> '1') = 'array' THEN twp.weeks -> '1'
              ELSE '[]'::jsonb
            END
          ),
          0
        ),
        NULLIF(mo.training_days_per_week, 0),
        3
      )::int AS planned_count
    FROM trainer_clients tc
    LEFT JOIN trainer_workout_plans twp
      ON twp.client_id  = tc.client_id
     AND twp.trainer_id = tc.trainer_id
     AND twp.is_active  = TRUE
    LEFT JOIN member_onboarding mo ON mo.profile_id = tc.client_id
    WHERE tc.trainer_id = p_trainer_id
      AND tc.is_active  = TRUE
      AND tc.status     = 'active'
  ),
  done AS (
    SELECT
      ws.profile_id   AS client_id,
      COUNT(*)::int   AS completed,
      MAX(COALESCE(ws.completed_at, ws.started_at)) AS last_at
    FROM workout_sessions ws
    WHERE ws.profile_id IN (SELECT a.client_id FROM assigned a)
      AND ws.status      = 'completed'
      AND ws.started_at >= p_week_start
      AND ws.started_at <  (p_week_start + INTERVAL '7 days')
    GROUP BY ws.profile_id
  ),
  last_seen AS (
    -- Fall back to last completed session of all time for "inactive" detection
    SELECT
      ws.profile_id AS client_id,
      MAX(COALESCE(ws.completed_at, ws.started_at)) AS last_at
    FROM workout_sessions ws
    WHERE ws.profile_id IN (SELECT a.client_id FROM assigned a)
      AND ws.status = 'completed'
    GROUP BY ws.profile_id
  )
  SELECT
    a.client_id,
    COALESCE(p.full_name, p.username, 'Client') AS client_name,
    p.avatar_url                                AS client_avatar,
    p.username                                  AS client_username,
    a.plan_id,
    a.plan_name,
    a.planned_count,
    COALESCE(d.completed, 0)::int               AS completed_count,
    COALESCE(d.last_at, ls.last_at)             AS last_session_at,
    CASE
      -- Inactive: no completed session in 7+ days (or ever)
      WHEN COALESCE(ls.last_at, '1970-01-01'::timestamptz)
           < (now() - INTERVAL '7 days') THEN 'inactive'
      -- On track: ≥80% of planned sessions this week
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) >= 0.8 THEN 'on_track'
      -- At risk: 50–79% completion
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) >= 0.5 THEN 'at_risk'
      -- Behind: <50% (and active in the last 7 days)
      ELSE 'behind'
    END AS status
  FROM assigned a
  JOIN profiles  p  ON p.id = a.client_id
  LEFT JOIN done       d  ON d.client_id = a.client_id
  LEFT JOIN last_seen  ls ON ls.client_id = a.client_id
  ORDER BY
    CASE
      WHEN COALESCE(ls.last_at, '1970-01-01'::timestamptz)
           < (now() - INTERVAL '7 days') THEN 0     -- inactive first
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) < 0.5 THEN 1
      WHEN a.planned_count > 0
        AND (COALESCE(d.completed, 0)::float / a.planned_count) < 0.8 THEN 2
      ELSE 3
    END,
    client_name;
$$;

NOTIFY pgrst, 'reload schema';
