-- ============================================================
-- 0657 — A trainer link now needs the MEMBER's consent
-- ============================================================
-- ⚠️ APPLY ON STAGING FIRST. This changes two functions that 137 policies and
--    RPCs depend on. A mistake here either locks every trainer out of their
--    real clients, or leaves the hole open silently.
--
-- WHAT WAS WRONG
--   trainer_clients had no consent concept at all: `is_active BOOLEAN DEFAULT
--   TRUE` and the relationship went live the instant the row was inserted. Any
--   trainer at a gym could attach themselves to any member of that gym and
--   immediately read their body measurements, PRs, goals, check-in responses,
--   habits, nutrition preferences and private feed, plus write their fee, cues
--   and schedule (the list is 0608's own inventory).
--
--   0530 noticed this and fixed the wrong half — it made the member get a
--   NOTIFICATION. Its header says so in as many words: "MEMBER NEVER NOTIFIED /
--   NO CONSENT SIGNAL … the member is silently attached to a coach". They were
--   told, never asked. And no policy let them undo it: every write policy on
--   the table is trainer- or admin-scoped, so the member could not detach.
--
--   0608 closed a different, worse hole (any MEMBER could forge the row and
--   become someone's trainer). That stands. This migration is about the
--   legitimate trainer's unilateral power, which 0608 deliberately left intact.
--
-- WHY THIS IS ONLY TWO FUNCTIONS
--   Every one of those 137 gates routes through is_trainer_of() or
--   _can_manage_client(), and both key off `trainer_clients … is_active = true`.
--   Adding the consent test inside them covers the whole surface at once. No
--   policy is rewritten, which is what makes this reviewable.
--
-- WHAT DOES **NOT** CHANGE
--   _can_manage_client()'s ADMIN branch. Consent here is about the TRAINER, a
--   specific person. A gym admin manages their gym's members by role, and a
--   member who joined the gym already accepted that. Gating admins on a
--   trainer_clients row would break gym operations and protects nobody.
-- ============================================================

-- ── 1. The column ─────────────────────────────────────────────────────────
-- Added nullable, backfilled, THEN constrained — so existing coaching
-- relationships stay live through the migration instead of every trainer in
-- production losing their clients the moment this lands.
ALTER TABLE public.trainer_clients
  ADD COLUMN IF NOT EXISTS status TEXT;

UPDATE public.trainer_clients SET status = 'active' WHERE status IS NULL;

ALTER TABLE public.trainer_clients
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.trainer_clients
    ADD CONSTRAINT trainer_clients_status_check
    CHECK (status IN ('pending', 'active', 'declined', 'ended'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.trainer_clients
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- The member's "do I have a request waiting?" lookup runs on every app open.
CREATE INDEX IF NOT EXISTS idx_trainer_clients_client_pending
  ON public.trainer_clients (client_id) WHERE status = 'pending';

-- ── 2. Nobody but the member can grant consent ────────────────────────────
-- Enforced by TRIGGER, not by RLS. Policies are permissive and OR together —
-- `trainer_clients_admin` is FOR ALL, so a WITH CHECK on the trainer's INSERT
-- policy alone would be bypassed by it. A BEFORE trigger has no such gap.
CREATE OR REPLACE FUNCTION public.trainer_clients_consent_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Any authenticated inserter — trainer OR admin — creates a REQUEST.
    -- auth.uid() IS NULL means service_role (bulk import / data migration),
    -- which keeps whatever status it set deliberately.
    IF auth.uid() IS NOT NULL THEN
      NEW.status := 'pending';
      NEW.responded_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- THE RULE: nobody but the member can GRANT access. Anyone may revoke it or
    -- ask again.
    --
    -- Only 'active' is a grant. A trainer moving their own row to 'pending'
    -- (re-asking — e.g. restoring a client who had left) or to 'ended'
    -- (giving up) takes nothing and must stay possible: without it, restoring a
    -- removed client would either fail outright or, worse, silently hand back
    -- access the member never re-approved.
    --
    -- Blocking the grant is what stops a trainer flipping a 'declined' row back
    -- to 'active' — the UPDATE policy is only `trainer_id = auth.uid()`, so
    -- without this a refusal would be a speed bump, not an answer.
    IF NEW.status = 'active'
       AND auth.uid() IS NOT NULL
       AND auth.uid() IS DISTINCT FROM OLD.client_id
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only the member can accept a trainer'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_clients_consent_guard ON public.trainer_clients;
CREATE TRIGGER trg_trainer_clients_consent_guard
  BEFORE INSERT OR UPDATE ON public.trainer_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.trainer_clients_consent_guard();

-- ── 3. The two gates ──────────────────────────────────────────────────────
-- Rebuilt from their latest definitions (0211 and 0463) with ONE clause added
-- to each. Diff them against those files before applying.
CREATE OR REPLACE FUNCTION public.is_trainer_of(p_client_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trainer_clients tc
    JOIN public.profile_lookup tp ON tp.id = tc.trainer_id
    JOIN public.profile_lookup cp ON cp.id = tc.client_id
    WHERE tc.trainer_id = auth.uid()
      AND tc.client_id = p_client_id
      AND tc.is_active = TRUE
      AND tc.status = 'active'          -- ← the member said yes
      AND tp.gym_id = cp.gym_id
  );
$$;

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

  -- Admin / super_admin in same gym → always allowed. Unchanged on purpose:
  -- see the header. Consent gates the TRAINER, not the gym.
  IF caller_role IN ('admin', 'super_admin')
     OR 'admin'::user_role       = ANY(caller_extra)
     OR 'super_admin'::user_role = ANY(caller_extra) THEN
    RETURN TRUE;
  END IF;

  -- Otherwise must be the client's active, ACCEPTED trainer.
  RETURN EXISTS (
    SELECT 1 FROM trainer_clients
     WHERE trainer_id = uid
       AND client_id = p_client_id
       AND is_active = true
       AND status = 'active'            -- ← the member said yes
  );
END;
$$;

-- ── 4. The member's side of the handshake ─────────────────────────────────
-- SECURITY DEFINER and keyed on auth.uid() = client_id, so a member can only
-- ever answer for themselves. Returns the resulting status so the client can
-- render without a second round trip.
CREATE OR REPLACE FUNCTION public.respond_to_trainer_request(
  p_trainer_id UUID,
  p_accept     BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_new := CASE WHEN p_accept THEN 'active' ELSE 'declined' END;

  UPDATE public.trainer_clients
     SET status = v_new,
         responded_at = now()
   WHERE client_id = auth.uid()
     AND trainer_id = p_trainer_id
     AND status = 'pending';

  IF NOT FOUND THEN
    RETURN NULL;   -- nothing pending from that trainer; not an error
  END IF;
  RETURN v_new;
END;
$$;

-- Ending an accepted relationship. Separate from declining because they are
-- different acts: this one revokes access that was previously granted, and the
-- member must be able to do it without asking anyone.
CREATE OR REPLACE FUNCTION public.end_trainer_relationship(p_trainer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.trainer_clients
     SET status = 'ended',
         responded_at = now()
   WHERE client_id = auth.uid()
     AND trainer_id = p_trainer_id
     AND status IN ('active', 'pending');

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_trainer_request(UUID, BOOLEAN) FROM public;
REVOKE ALL ON FUNCTION public.end_trainer_relationship(UUID)            FROM public;
GRANT EXECUTE ON FUNCTION public.respond_to_trainer_request(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_trainer_relationship(UUID)            TO authenticated;

-- ── 5. The notification becomes a REQUEST ─────────────────────────────────
-- Rebuilt from 0530 verbatim except the member's copy and the pending guard.
CREATE OR REPLACE FUNCTION public.fire_trainer_new_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name  TEXT;
  v_trainer_name TEXT;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'a new client') INTO v_client_name
  FROM profiles WHERE id = NEW.client_id;

  SELECT NULLIF(full_name, '') INTO v_trainer_name
  FROM profiles WHERE id = NEW.trainer_id;

  -- (a) The MEMBER is now ASKED, not informed. Copy changed with the mechanic:
  --     telling someone a coach "is now your trainer" when they still have to
  --     accept would be worse than the old wording, not better.
  IF NEW.status = 'pending' THEN
    PERFORM public._notify_member(
      NEW.client_id, NEW.gym_id, 'new_trainer'::notification_type,
      COALESCE(v_trainer_name, 'A trainer') || ' wants to be your trainer',
      'They can only see your training data after you accept. Tap to decide.',
      COALESCE(v_trainer_name, 'Un entrenador') || ' quiere ser tu entrenador',
      'Solo podrá ver tus datos de entrenamiento si aceptas. Toca para decidir.',
      jsonb_build_object('route', '/trainers/' || NEW.trainer_id::text,
                         'trainer_id', NEW.trainer_id, 'pending', true),
      'member_newtrainer_' || NEW.trainer_id::text || '_' || NEW.client_id::text
    );
  ELSE
    -- Pre-accepted rows only reach here via service_role (import/migration).
    PERFORM public._notify_member(
      NEW.client_id, NEW.gym_id, 'new_trainer'::notification_type,
      COALESCE(v_trainer_name, 'Your trainer') || ' is now your trainer',
      'You can check their profile and message them from the app.',
      COALESCE(v_trainer_name, 'Tu entrenador') || ' ahora es tu entrenador',
      'Puedes ver su perfil y escribirle desde la app.',
      jsonb_build_object('route', '/trainers/' || NEW.trainer_id::text, 'trainer_id', NEW.trainer_id),
      'member_newtrainer_' || NEW.trainer_id::text || '_' || NEW.client_id::text
    );
  END IF;

  -- (b) The TRAINER only hears about it when someone ELSE assigned the client
  --     (admin UI / service-role import). Self-adds are their own action.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.trainer_id THEN
    PERFORM public._notify_trainer(
      NEW.trainer_id, NEW.gym_id, 'new_client_assigned'::notification_type,
      'New client assigned',
      v_client_name || ' was assigned to you. Take a look at their profile and set them up.',
      'Nuevo cliente asignado',
      'Te asignaron a ' || COALESCE(NULLIF((SELECT full_name FROM profiles WHERE id = NEW.client_id), ''), 'un cliente nuevo')
        || '. Revisa su perfil y prepáralo.',
      jsonb_build_object('route', '/trainer/clients/' || NEW.client_id::text, 'client_id', NEW.client_id),
      'trainer_newclient_' || NEW.trainer_id::text || '_' || NEW.client_id::text
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_trainer_new_client failed for %/%: %', NEW.trainer_id, NEW.client_id, SQLERRM;
  RETURN NEW;
END;
$$;

-- The consent guard must run BEFORE the notifier reads NEW.status. Postgres
-- fires BEFORE triggers ahead of AFTER triggers, so ordering is already right;
-- named alphabetically only for readability in \d output.

NOTIFY pgrst, 'reload schema';
