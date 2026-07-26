-- ============================================================
-- 0644 — Shared trainer plans: assign ONE plan to MANY members
-- ============================================================
-- trainer_workout_plans.client_id is a single (nullable) assignee. Trainers
-- want to hand one reusable plan/session to several clients and edit it once
-- for all of them (a shared template), instead of duplicating it per client.
--
-- This adds a junction (trainer_plan_members). client_id stays as the legacy
-- "primary" assignee (kept in sync by the app to assignedIds[0]) so existing
-- reads (member query, cards, the 0537 assign-notify trigger) keep working;
-- the junction carries the FULL set of assignees. A member sees a plan if they
-- are the client_id OR appear in the junction.
--
-- Additive + idempotent. Touches RLS on a live member-facing table
-- (trainer_workout_plans) — TEST ON STAGING before prod.
-- DEPENDS ON 0537 (_notify_push) for the assign notification.
-- ============================================================

-- ── 1. Junction table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trainer_plan_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES public.trainer_workout_plans(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_tpm_plan   ON public.trainer_plan_members(plan_id);
CREATE INDEX IF NOT EXISTS idx_tpm_member ON public.trainer_plan_members(member_id);

ALTER TABLE public.trainer_plan_members ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS on the junction ─────────────────────────────────
-- CRITICAL: the junction's staff policies must NOT reference trainer_workout_plans
-- with a plain sub-query, because the parent's trainer_plans_member_select (§3)
-- references THIS junction — that mutual reference makes Postgres recurse on
-- every read of either table (ERRCODE 42P17). We break the cycle with
-- SECURITY DEFINER helpers (they bypass RLS on the parent), the same pattern the
-- codebase uses elsewhere (_can_manage_client, 0640/0641).
CREATE OR REPLACE FUNCTION public._trainer_owns_workout_plan(p_plan_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM trainer_workout_plans WHERE id = p_plan_id AND trainer_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public._admin_reads_workout_plan(p_plan_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM trainer_workout_plans p
    JOIN profiles me ON me.id = auth.uid()
    WHERE p.id = p_plan_id AND me.role IN ('admin', 'super_admin') AND me.gym_id = p.gym_id
  );
$$;

-- Members read their own assignments (needed to run the plan).
DROP POLICY IF EXISTS "tpm_member_select" ON public.trainer_plan_members;
CREATE POLICY "tpm_member_select" ON public.trainer_plan_members
  FOR SELECT TO authenticated
  USING (member_id = auth.uid());

-- The plan's trainer manages its assignees. WITH CHECK also constrains the
-- member to someone this trainer actually manages (same-gym client) so a crafted
-- insert can't share a plan with — or push-notify — an arbitrary user.
DROP POLICY IF EXISTS "tpm_trainer_all" ON public.trainer_plan_members;
CREATE POLICY "tpm_trainer_all" ON public.trainer_plan_members
  FOR ALL TO authenticated
  USING (public._trainer_owns_workout_plan(plan_id))
  WITH CHECK (public._trainer_owns_workout_plan(plan_id) AND public._can_manage_client(member_id));

-- Admins can read assignments for plans in their gym.
DROP POLICY IF EXISTS "tpm_admin_select" ON public.trainer_plan_members;
CREATE POLICY "tpm_admin_select" ON public.trainer_plan_members
  FOR SELECT TO authenticated
  USING (public._admin_reads_workout_plan(plan_id));

-- ── 3. Members can read plans shared with them via the junction ────────────
-- Adds to the existing client_id-based read (trainer_plans_client_select from
-- 0036/0537) — a member reads a plan if client_id = them OR they're a junction
-- assignee. Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_workout_plans'
      AND policyname = 'trainer_plans_member_select'
  ) THEN
    CREATE POLICY "trainer_plans_member_select" ON public.trainer_workout_plans
      FOR SELECT TO authenticated
      USING (
        id IN (SELECT plan_id FROM public.trainer_plan_members WHERE member_id = auth.uid())
      );
  END IF;
END $$;

-- ── 4. Notify a member when a plan is shared with them via the junction ────
-- Parity with 0537's client_id assign-notify. Fires on INSERT into the
-- junction when the plan is active. Guarded: never blocks the assignment.
CREATE OR REPLACE FUNCTION public.fire_member_plan_shared()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan    RECORD;
  v_trainer TEXT;
BEGIN
  SELECT id, name, gym_id, trainer_id, is_active, client_id
    INTO v_plan
  FROM trainer_workout_plans WHERE id = NEW.plan_id;

  -- Only notify for a live plan; never notify the trainer about themselves; and
  -- skip the primary assignee (client_id) — the 0537 plan-insert trigger already
  -- notifies them, so notifying again here would double-fire (different dedup key).
  IF v_plan.is_active IS NOT TRUE
     OR NEW.member_id = v_plan.trainer_id
     OR NEW.member_id = v_plan.client_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULL) INTO v_trainer
  FROM profiles WHERE id = v_plan.trainer_id;

  PERFORM public._notify_push(
    NEW.member_id, v_plan.gym_id, 'member'::user_role, 'plan_assigned'::notification_type,
    'New plan from your coach',
    COALESCE(v_trainer, 'Your coach') || ' assigned you a plan: ' || v_plan.name || '. Check it out in Workouts.',
    'Tu coach te asignó un plan',
    COALESCE(v_trainer, 'Tu coach') || ' te asignó un plan: ' || v_plan.name || '. Míralo en Entrenamientos.',
    jsonb_build_object('route', '/workouts', 'plan_id', v_plan.id, 'trainer_id', v_plan.trainer_id),
    'plan_assigned_' || v_plan.id::text || '_' || NEW.member_id::text || '_' || to_char(now(), 'YYYYMMDD')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_plan_shared failed (plan %, member %): %', NEW.plan_id, NEW.member_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_plan_shared_ins ON public.trainer_plan_members;
CREATE TRIGGER trg_member_plan_shared_ins
  AFTER INSERT ON public.trainer_plan_members
  FOR EACH ROW EXECUTE FUNCTION public.fire_member_plan_shared();

-- ── 5. Plan goes active (draft→publish / reactivate) → notify shared members ──
-- 0537 already notifies the PRIMARY (client_id) on is_active false→true. But if
-- members were attached to the plan while it was a DRAFT (junction INSERT fired
-- while inactive → fire_member_plan_shared returned without notifying), those
-- non-primary members would never hear about it once it's published. This
-- covers them. Same per-member dedup key as fire_member_plan_shared, so if a
-- member is both freshly-added AND the plan is activated on the same day, only
-- one notification goes out.
CREATE OR REPLACE FUNCTION public.fire_shared_members_on_activate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainer TEXT;
  r RECORD;
BEGIN
  -- Only on a genuine false/NULL → true transition.
  IF NEW.is_active IS NOT TRUE OR OLD.is_active IS NOT DISTINCT FROM NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULL) INTO v_trainer
  FROM profiles WHERE id = NEW.trainer_id;

  FOR r IN
    SELECT member_id FROM trainer_plan_members
    WHERE plan_id = NEW.id
      AND member_id <> NEW.trainer_id
      AND (NEW.client_id IS NULL OR member_id <> NEW.client_id) -- 0537 handles the primary
  LOOP
    PERFORM public._notify_push(
      r.member_id, NEW.gym_id, 'member'::user_role, 'plan_assigned'::notification_type,
      'New plan from your coach',
      COALESCE(v_trainer, 'Your coach') || ' assigned you a plan: ' || NEW.name || '. Check it out in Workouts.',
      'Tu coach te asignó un plan',
      COALESCE(v_trainer, 'Tu coach') || ' te asignó un plan: ' || NEW.name || '. Míralo en Entrenamientos.',
      jsonb_build_object('route', '/workouts', 'plan_id', NEW.id, 'trainer_id', NEW.trainer_id),
      'plan_assigned_' || NEW.id::text || '_' || r.member_id::text || '_' || to_char(now(), 'YYYYMMDD')
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_shared_members_on_activate failed (plan %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shared_members_on_activate ON public.trainer_workout_plans;
CREATE TRIGGER trg_shared_members_on_activate
  AFTER UPDATE OF is_active ON public.trainer_workout_plans
  FOR EACH ROW EXECUTE FUNCTION public.fire_shared_members_on_activate();

NOTIFY pgrst, 'reload schema';
