-- 0534_session_packs.sql
-- ---------------------------------------------------------------------------
-- MARKET FEATURE #1 (trainer audit 2026-06-11): session packs / remaining-
-- session balance — THE business model of a $20–40/session cash/ATH trainer
-- (Trainerize Session Packs, Mindbody session bank, Glofox credits, FitSW
-- credits). Zero pack concept existed anywhere in the codebase.
--
-- WHAT THIS ADDS:
--   • session_packs table — a sold block of N sessions for one trainer↔client
--     pair. This schema is a CONTRACT consumed by TrainerPayments (balance
--     chips + "Paquetes" filter) and TrainerClientPayment — do not rename.
--   • Auto-decrement: when a trainer_sessions row transitions to 'completed'
--     (the existing calendar flow), the OLDEST active pack for that
--     trainer+client consumes one session.
--       - reaches sessions_total → pack deactivates + trainer notified
--         ('pack_exhausted', audience trainer, route /trainer/payments).
--       - exactly 1 left → trainer notified ('pack_low') AND member notified
--         ('pack_low', audience member, "Te queda 1 sesión con <trainer>").
--   • Reversal: un-completing a session (completed → anything else) returns
--     one session to the pack being consumed (oldest active with usage, else
--     re-opens the newest exhausted pack) so accidental completions don't
--     silently burn paid sessions.
--
-- Notifications: notifications.type is the notification_type ENUM (0001),
-- not a CHECK — extended below with 'pack_exhausted' / 'pack_low'. The new
-- values are only referenced inside function bodies (runtime), so adding
-- them in the same migration is transaction-safe. Copy is localized by the
-- recipient's profiles.preferred_language (the column the app writes) and
-- delivered via _notify_push (0440: in-app row + dedup + native push).
-- The trigger is fully exception-wrapped: a pack/notification failure can
-- NEVER roll back the session completion itself.
-- ---------------------------------------------------------------------------

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'pack_exhausted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'pack_low';

-- ── Table (CONTRACT — other agents code against these exact columns) ───────
CREATE TABLE IF NOT EXISTS public.session_packs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id         UUID NOT NULL REFERENCES public.gyms(id),
  trainer_id     UUID NOT NULL REFERENCES public.profiles(id),
  client_id      UUID NOT NULL REFERENCES public.profiles(id),
  sessions_total INT  NOT NULL CHECK (sessions_total > 0),
  sessions_used  INT  NOT NULL DEFAULT 0,
  amount         NUMERIC(10,2),
  note           TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_packs_trainer_client_active_idx
  ON public.session_packs (trainer_id, client_id, is_active);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.session_packs ENABLE ROW LEVEL SECURITY;

-- Trainer manages their own packs; WITH CHECK pins the row to the trainer's
-- own gym and a client of that same gym (no cross-tenant writes).
DROP POLICY IF EXISTS "session_packs_trainer_all" ON public.session_packs;
CREATE POLICY "session_packs_trainer_all" ON public.session_packs
  FOR ALL TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles cp
      WHERE cp.id = session_packs.client_id AND cp.gym_id = session_packs.gym_id
    )
  );

-- Client sees their own pack balances.
DROP POLICY IF EXISTS "session_packs_client_select" ON public.session_packs;
CREATE POLICY "session_packs_client_select" ON public.session_packs
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

-- Gym admins see all packs in their gym (read-only; packs are the trainer's
-- own arrangement).
DROP POLICY IF EXISTS "session_packs_admin_select" ON public.session_packs;
CREATE POLICY "session_packs_admin_select" ON public.session_packs
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND gym_id = (SELECT gym_id FROM public.profiles WHERE id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_packs TO authenticated;

-- ── Localized notify helper (internal) ──────────────────────────────────────
-- Resolves the recipient's language from profiles.preferred_language (the
-- column Settings/Onboarding actually write) and hands the pre-localized
-- text to _notify_push (0440) for the in-app row + dedup + native push.
CREATE OR REPLACE FUNCTION public._notify_pack_event(
  p_profile_id UUID,
  p_gym_id     UUID,
  p_audience   user_role,
  p_type       notification_type,
  p_title_en   TEXT,
  p_body_en    TEXT,
  p_title_es   TEXT,
  p_body_es    TEXT,
  p_data       JSONB,
  p_dedup      TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_lang TEXT; v_title TEXT; v_body TEXT;
BEGIN
  IF p_profile_id IS NULL OR p_gym_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(NULLIF(preferred_language, ''), 'en') INTO v_lang
  FROM profiles WHERE id = p_profile_id;
  IF v_lang LIKE 'es%' THEN
    v_title := p_title_es; v_body := p_body_es;
  ELSE
    v_title := p_title_en; v_body := p_body_en;
  END IF;
  PERFORM public._notify_push(
    p_profile_id, p_gym_id, p_audience, p_type,
    v_title, v_body, v_title, v_body, p_data, p_dedup
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_pack_event(UUID,UUID,user_role,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

-- ── Decrement / reversal trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_session_pack_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack      RECORD;
  v_remaining INT;
  v_client    TEXT;
  v_trainer   TEXT;
  v_consume   BOOLEAN := FALSE;
  v_restore   BOOLEAN := FALSE;
BEGIN
  -- OLD is only assigned on UPDATE — never touch it on INSERT (and don't
  -- rely on AND/OR short-circuiting, which SQL does not guarantee).
  IF TG_OP = 'INSERT' THEN
    v_consume := (NEW.status = 'completed');
  ELSE
    v_consume := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');
    v_restore := (OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed');
  END IF;

  -- ── A. Session transitioned INTO 'completed' → consume one ──
  IF v_consume THEN

    SELECT * INTO v_pack FROM session_packs
    WHERE trainer_id = NEW.trainer_id AND client_id = NEW.client_id AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN RETURN NEW; END IF; -- no active pack: nothing to do

    v_remaining := v_pack.sessions_total - (v_pack.sessions_used + 1);

    UPDATE session_packs
    SET sessions_used = v_pack.sessions_used + 1,
        is_active     = (v_remaining > 0)
    WHERE id = v_pack.id;

    SELECT COALESCE(NULLIF(full_name, ''), 'Tu cliente')   INTO v_client  FROM profiles WHERE id = NEW.client_id;
    SELECT COALESCE(NULLIF(full_name, ''), 'tu entrenador') INTO v_trainer FROM profiles WHERE id = NEW.trainer_id;

    IF v_remaining <= 0 THEN
      -- Pack done → trainer should sell/renew.
      PERFORM public._notify_pack_event(
        NEW.trainer_id, NEW.gym_id, 'trainer'::user_role, 'pack_exhausted'::notification_type,
        'Pack finished: ' || v_client,
        v_client || ' used the last session of their ' || v_pack.sessions_total || '-session pack. Time to renew.',
        'Paquete terminado: ' || v_client,
        v_client || ' usó la última sesión de su paquete de ' || v_pack.sessions_total || '. Hora de renovar.',
        jsonb_build_object('route', '/trainer/payments', 'client_id', NEW.client_id, 'pack_id', v_pack.id),
        'pack_exhausted_' || v_pack.id::text
      );
    ELSIF v_remaining = 1 THEN
      -- One left → heads-up to both sides.
      PERFORM public._notify_pack_event(
        NEW.trainer_id, NEW.gym_id, 'trainer'::user_role, 'pack_low'::notification_type,
        v_client || ' has 1 session left',
        'Their ' || v_pack.sessions_total || '-session pack is almost done. Good moment to offer the next one.',
        'A ' || v_client || ' le queda 1 sesión',
        'Su paquete de ' || v_pack.sessions_total || ' está por terminarse. Buen momento para ofrecerle el próximo.',
        jsonb_build_object('route', '/trainer/payments', 'client_id', NEW.client_id, 'pack_id', v_pack.id),
        'pack_low_t_' || v_pack.id::text
      );
      PERFORM public._notify_pack_event(
        NEW.client_id, NEW.gym_id, 'member'::user_role, 'pack_low'::notification_type,
        'You have 1 session left with ' || v_trainer,
        'Your session pack is almost done — talk to ' || v_trainer || ' to keep going.',
        'Te queda 1 sesión con ' || v_trainer,
        'Tu paquete de sesiones está por terminarse — habla con ' || v_trainer || ' para seguir.',
        jsonb_build_object('trainer_id', NEW.trainer_id, 'pack_id', v_pack.id),
        'pack_low_m_' || v_pack.id::text
      );
    END IF;

  -- ── B. Session reverted OUT of 'completed' → give the session back ──
  -- (accidental completions must not burn paid sessions). Targets the pack
  -- currently being consumed: oldest active with usage; else re-opens the
  -- newest exhausted pack.
  ELSIF v_restore THEN

    SELECT * INTO v_pack FROM session_packs
    WHERE trainer_id = NEW.trainer_id AND client_id = NEW.client_id
      AND is_active = true AND sessions_used > 0
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      SELECT * INTO v_pack FROM session_packs
      WHERE trainer_id = NEW.trainer_id AND client_id = NEW.client_id
        AND is_active = false AND sessions_used > 0
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE;
      IF NOT FOUND THEN RETURN NEW; END IF;
    END IF;

    UPDATE session_packs
    SET sessions_used = greatest(0, v_pack.sessions_used - 1),
        is_active     = true
    WHERE id = v_pack.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_session_pack_usage failed for session %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_pack_usage ON trainer_sessions;
CREATE TRIGGER trg_session_pack_usage
  AFTER INSERT OR UPDATE OF status ON trainer_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fire_session_pack_usage();

NOTIFY pgrst, 'reload schema';
