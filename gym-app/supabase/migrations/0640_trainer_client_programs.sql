-- ==========================================================================
-- 0640_trainer_client_programs.sql
-- PER-CLIENT PROGRAM COPY (copy-on-write). A trainer editing a client's
-- assigned program forks a CLIENT-SPECIFIC copy so the shared gym_programs
-- template is never mutated. Mirrors gym_programs' content columns; because
-- gym_programs.weeks is self-contained JSON (references only exercises.id), a
-- fork is a pure JSONB value copy — no dependent rows to clone.
--
-- Design (founder-approved 2026-07-19): resolver prefers the copy over the
-- template everywhere the assigned program is read (trainer viewer + the member
-- materializer in Workouts.jsx). RLS via the multi-role _can_manage_client gate.
-- ==========================================================================

-- ── 1. The per-client copy table (mirrors gym_programs content) ────────────
CREATE TABLE IF NOT EXISTS public.trainer_client_programs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID NOT NULL REFERENCES public.gyms(id)         ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  trainer_id        UUID          REFERENCES public.profiles(id)     ON DELETE SET NULL,
  source_program_id UUID          REFERENCES public.gym_programs(id) ON DELETE SET NULL, -- keep the copy if the template is deleted
  name              TEXT NOT NULL DEFAULT '',
  name_es           TEXT,
  description       TEXT,
  description_es    TEXT,
  cover_preset      TEXT,
  image_path        TEXT,
  duration_weeks    INTEGER NOT NULL DEFAULT 8,
  weeks             JSONB   NOT NULL DEFAULT '{}',   -- same shape as gym_programs.weeks
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  allow_client_edit BOOLEAN NOT NULL DEFAULT FALSE,   -- coach opt-in: let the client edit this program on their side
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One ACTIVE copy per client (deactivated history rows don't count).
CREATE UNIQUE INDEX IF NOT EXISTS trainer_client_programs_active_client_idx
  ON public.trainer_client_programs (client_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS trainer_client_programs_client_idx ON public.trainer_client_programs (client_id);
CREATE INDEX IF NOT EXISTS trainer_client_programs_source_idx ON public.trainer_client_programs (source_program_id);
-- Additive + idempotent — CREATE TABLE IF NOT EXISTS won't backfill a column on an
-- already-created table, so ensure allow_client_edit exists on re-run either way.
ALTER TABLE public.trainer_client_programs
  ADD COLUMN IF NOT EXISTS allow_client_edit BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Pointer on profiles (keep assigned_program_id as template provenance) ─
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_client_program_id UUID
    REFERENCES public.trainer_client_programs(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.profiles.assigned_client_program_id IS
  'When set, the client trains this per-client COPY instead of the shared gym_programs template (assigned_program_id). Copy-on-write via trainer_fork_client_program.';
CREATE INDEX IF NOT EXISTS profiles_assigned_client_program_idx
  ON public.profiles (assigned_client_program_id) WHERE assigned_client_program_id IS NOT NULL;

-- ── 3. updated_at trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trainer_client_programs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trainer_client_programs_updated_at ON public.trainer_client_programs;
CREATE TRIGGER trainer_client_programs_updated_at
  BEFORE UPDATE ON public.trainer_client_programs
  FOR EACH ROW EXECUTE FUNCTION public.trainer_client_programs_set_updated_at();

-- ── 4. RLS — client reads own (for training); staff manage ─────────────────
ALTER TABLE public.trainer_client_programs ENABLE ROW LEVEL SECURITY;

-- Read: the client themselves (materialize their plan) OR an admin/trainer who
-- manages them (multi-role-aware, same-gym — 0463 helper).
DROP POLICY IF EXISTS "tcp_select" ON public.trainer_client_programs;
CREATE POLICY "tcp_select" ON public.trainer_client_programs
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public._can_manage_client(client_id));

DROP POLICY IF EXISTS "tcp_insert" ON public.trainer_client_programs;
CREATE POLICY "tcp_insert" ON public.trainer_client_programs
  FOR INSERT TO authenticated
  WITH CHECK (public._can_manage_client(client_id) AND gym_id = public.current_gym_id());

DROP POLICY IF EXISTS "tcp_update" ON public.trainer_client_programs;
CREATE POLICY "tcp_update" ON public.trainer_client_programs
  FOR UPDATE TO authenticated
  USING (public._can_manage_client(client_id))
  WITH CHECK (public._can_manage_client(client_id) AND gym_id = public.current_gym_id());

DROP POLICY IF EXISTS "tcp_delete" ON public.trainer_client_programs;
CREATE POLICY "tcp_delete" ON public.trainer_client_programs
  FOR DELETE TO authenticated
  USING (public._can_manage_client(client_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_client_programs TO authenticated;

-- ── 5. Fork RPC — deep-copy a template into a per-client copy (idempotent) ──
-- Gated on _can_manage_client (NOT current_user_role()='trainer', so multi-role
-- admin/trainers via additional_roles aren't rejected). SECURITY DEFINER so the
-- insert isn't re-checked by RLS; the function does its own authorization.
CREATE OR REPLACE FUNCTION public.trainer_fork_client_program(p_client_id UUID, p_source_program_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src      public.gym_programs%ROWTYPE;
  v_gym      UUID;
  v_copy     UUID;
  v_copy_src UUID;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized to manage this client';
  END IF;

  -- Reuse the active copy ONLY if it came from the same source (or no explicit
  -- source was requested — the "edit the current program" path). Editing a
  -- DIFFERENT available program retires the old copy and forks fresh below.
  SELECT id, source_program_id INTO v_copy, v_copy_src
    FROM public.trainer_client_programs
   WHERE client_id = p_client_id AND is_active
   LIMIT 1;
  IF v_copy IS NOT NULL AND (p_source_program_id IS NULL OR v_copy_src IS NOT DISTINCT FROM p_source_program_id) THEN
    UPDATE public.profiles SET assigned_client_program_id = v_copy WHERE id = p_client_id;
    RETURN v_copy;
  END IF;
  IF v_copy IS NOT NULL THEN
    UPDATE public.trainer_client_programs SET is_active = FALSE WHERE id = v_copy;
  END IF;

  -- Source template: explicit arg, else the client's currently-assigned gym program.
  SELECT gp.* INTO v_src
    FROM public.gym_programs gp
   WHERE gp.id = COALESCE(p_source_program_id,
                          (SELECT assigned_program_id FROM public.profiles WHERE id = p_client_id));
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'no source program to copy';
  END IF;

  v_gym := (SELECT gym_id FROM public.profiles WHERE id = p_client_id);

  INSERT INTO public.trainer_client_programs
    (gym_id, client_id, trainer_id, source_program_id, name, name_es, description, description_es,
     cover_preset, image_path, duration_weeks, weeks, is_active)
  VALUES
    (v_gym, p_client_id, auth.uid(), v_src.id, v_src.name, v_src.name_es, v_src.description, v_src.description_es,
     v_src.cover_preset, v_src.image_path, v_src.duration_weeks, v_src.weeks, TRUE)
  RETURNING id INTO v_copy;

  -- Point the client at the copy; when an explicit template was chosen (editing
  -- an available program), also make it the assigned template — adopt & customize.
  UPDATE public.profiles
     SET assigned_client_program_id = v_copy,
         assigned_program_id = COALESCE(p_source_program_id, assigned_program_id)
   WHERE id = p_client_id;
  RETURN v_copy;
END;
$$;
REVOKE ALL ON FUNCTION public.trainer_fork_client_program(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trainer_fork_client_program(UUID, UUID) TO authenticated;

-- ── 6. Reset RPC — discard the copy, fall back to the shared template ───────
CREATE OR REPLACE FUNCTION public.trainer_reset_client_program(p_client_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized to manage this client';
  END IF;
  UPDATE public.trainer_client_programs SET is_active = FALSE
   WHERE client_id = p_client_id AND is_active;
  UPDATE public.profiles SET assigned_client_program_id = NULL WHERE id = p_client_id;
END;
$$;
REVOKE ALL ON FUNCTION public.trainer_reset_client_program(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trainer_reset_client_program(UUID) TO authenticated;

-- ── 7. Push RPC — apply the copy's current weeks to the client's ACTIVE
-- materialized program (generated_programs.template_weeks), so a member who
-- already STARTED the program gets edits without a re-start. Content edits
-- (sets/reps/exercises/order within existing days) are safe; if the day COUNT
-- changed, the member picks up the new structure on their next start (their own
-- schedule_map is untouched). SECURITY DEFINER + _can_manage_client gate; the
-- member-owned generated_programs write is intentional and authorization-checked.
CREATE OR REPLACE FUNCTION public.trainer_push_client_program(p_client_id UUID)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copy  public.trainer_client_programs%ROWTYPE;
  v_count integer;
BEGIN
  IF NOT public._can_manage_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized to manage this client';
  END IF;
  SELECT * INTO v_copy FROM public.trainer_client_programs
   WHERE client_id = p_client_id AND is_active LIMIT 1;
  IF v_copy.id IS NULL OR v_copy.source_program_id IS NULL THEN RETURN 0; END IF;

  UPDATE public.generated_programs
     SET template_weeks = v_copy.weeks
   WHERE profile_id = p_client_id
     AND template_id = 'gym_' || v_copy.source_program_id::text
     AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.trainer_push_client_program(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trainer_push_client_program(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
