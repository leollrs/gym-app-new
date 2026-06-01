-- 0500_trainer_checkins_habits.sql
-- ---------------------------------------------------------------------------
-- #6 — Trainer check-in forms + member habits.
--
-- Framing: the trainer side is "easier member progress tracking", NOT remote
-- coaching. These give the trainer MORE signal on each member:
--   • checkin_templates / _assignments / _responses — coach-authored recurring
--     questionnaires (weight, energy, adherence, custom questions). The member
--     fills them; the trainer reads the trend.
--   • habits / habit_logs — coach- (or self-) assigned daily habits with a
--     weekly target; completion is an engagement/retention signal.
--
-- Authz: gym-scoped throughout. Members own their own responses/habit logs.
-- Staff (the assigned trainer OR a same-gym admin) reach a client's rows via
-- public._can_manage_client(client_id) — the multi-role-aware helper from 0463.
--
-- NOTE: all five tables are created FIRST, then the policies — the
-- checkin_templates member-select policy references checkin_assignments, which
-- must already exist when that policy is created.
-- ---------------------------------------------------------------------------

-- ════════════════════════════════════════════════════════════════════════
-- TABLES
-- ════════════════════════════════════════════════════════════════════════

-- Check-in templates (coach-authored form definitions).
CREATE TABLE IF NOT EXISTS public.checkin_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  cadence     TEXT NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly','biweekly','monthly')),
  -- questions: [{ id, label, type:'scale'|'number'|'text'|'boolean', unit?, min?, max? }]
  questions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_templates_gym_creator_idx
  ON public.checkin_templates (gym_id, created_by);

-- Assignments (which members get which template).
CREATE TABLE IF NOT EXISTS public.checkin_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.checkin_templates(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, profile_id)
);
CREATE INDEX IF NOT EXISTS checkin_assignments_profile_idx
  ON public.checkin_assignments (profile_id) WHERE active;

-- Responses (member submissions, one per period).
CREATE TABLE IF NOT EXISTS public.checkin_responses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID NOT NULL REFERENCES public.checkin_templates(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id       UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  -- answers: { [questionId]: value }
  answers      JSONB NOT NULL DEFAULT '{}'::jsonb,
  period_start DATE NOT NULL,  -- Monday of the week (or period) this covers
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, profile_id, period_start)
);
CREATE INDEX IF NOT EXISTS checkin_responses_profile_idx
  ON public.checkin_responses (profile_id, template_id, period_start DESC);

-- Habits (coach- or self-assigned, daily).
CREATE TABLE IF NOT EXISTS public.habits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,  -- who performs it
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,          -- trainer/admin or self
  name            TEXT NOT NULL,
  icon            TEXT,
  target_per_week SMALLINT CHECK (target_per_week IS NULL OR (target_per_week BETWEEN 1 AND 7)),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS habits_profile_idx
  ON public.habits (profile_id) WHERE is_active;

-- Habit logs (daily completion).
CREATE TABLE IF NOT EXISTS public.habit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id   UUID NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  log_date   DATE NOT NULL,
  completed  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (habit_id, log_date)
);
CREATE INDEX IF NOT EXISTS habit_logs_profile_date_idx
  ON public.habit_logs (profile_id, log_date DESC);

-- ════════════════════════════════════════════════════════════════════════
-- RLS + GRANTS  (all tables now exist, so cross-table policies are safe)
-- ════════════════════════════════════════════════════════════════════════

-- ── checkin_templates ───────────────────────────────────────────────────
ALTER TABLE public.checkin_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ct_staff_all" ON public.checkin_templates;
CREATE POLICY "ct_staff_all" ON public.checkin_templates
  FOR ALL TO authenticated
  USING (created_by = auth.uid() OR (gym_id = public.current_gym_id() AND public.is_admin()))
  WITH CHECK (created_by = auth.uid() OR (gym_id = public.current_gym_id() AND public.is_admin()));
DROP POLICY IF EXISTS "ct_member_select" ON public.checkin_templates;
CREATE POLICY "ct_member_select" ON public.checkin_templates
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.checkin_assignments a
    WHERE a.template_id = checkin_templates.id AND a.profile_id = auth.uid() AND a.active
  ));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkin_templates TO authenticated;

-- ── checkin_assignments ─────────────────────────────────────────────────
ALTER TABLE public.checkin_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ca_staff_all" ON public.checkin_assignments;
CREATE POLICY "ca_staff_all" ON public.checkin_assignments
  FOR ALL TO authenticated
  USING (public._can_manage_client(profile_id))
  WITH CHECK (public._can_manage_client(profile_id));
DROP POLICY IF EXISTS "ca_member_select" ON public.checkin_assignments;
CREATE POLICY "ca_member_select" ON public.checkin_assignments
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkin_assignments TO authenticated;

-- ── checkin_responses ───────────────────────────────────────────────────
ALTER TABLE public.checkin_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cr_member_all" ON public.checkin_responses;
CREATE POLICY "cr_member_all" ON public.checkin_responses
  FOR ALL TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id());
DROP POLICY IF EXISTS "cr_staff_select" ON public.checkin_responses;
CREATE POLICY "cr_staff_select" ON public.checkin_responses
  FOR SELECT TO authenticated
  USING (public._can_manage_client(profile_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkin_responses TO authenticated;

-- ── habits ──────────────────────────────────────────────────────────────
ALTER TABLE public.habits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "h_member_all" ON public.habits;
CREATE POLICY "h_member_all" ON public.habits
  FOR ALL TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id());
DROP POLICY IF EXISTS "h_staff_all" ON public.habits;
CREATE POLICY "h_staff_all" ON public.habits
  FOR ALL TO authenticated
  USING (public._can_manage_client(profile_id))
  WITH CHECK (public._can_manage_client(profile_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habits TO authenticated;

-- ── habit_logs ──────────────────────────────────────────────────────────
ALTER TABLE public.habit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hl_member_all" ON public.habit_logs;
CREATE POLICY "hl_member_all" ON public.habit_logs
  FOR ALL TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());
DROP POLICY IF EXISTS "hl_staff_select" ON public.habit_logs;
CREATE POLICY "hl_staff_select" ON public.habit_logs
  FOR SELECT TO authenticated
  USING (public._can_manage_client(profile_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_logs TO authenticated;

NOTIFY pgrst, 'reload schema';
