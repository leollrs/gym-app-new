-- ============================================================
-- 0530 — trainer_clients INSERT: notify the MEMBER, stop self-add spam,
--         + other-trainer ownership probe for the Add Client modal
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor.
--
-- Root causes (trainer audit 2026-06-11, Clients page):
--
-- 1. MEMBER NEVER NOTIFIED / NO CONSENT SIGNAL. 0439's
--    fire_trainer_new_client only notifies the TRAINER on a trainer_clients
--    INSERT. The member is silently attached to a coach — the Help FAQ even
--    claims they're told. Fix: on every active INSERT the member now gets an
--    in-app notification + push (new type 'new_trainer', audience 'member',
--    route '/trainers/<trainer_id>' so the bell deep-links to the trainer's
--    public profile).
--
-- 2. SELF-ADD SPAM. When a trainer adds a client THEMSELVES (the only flow
--    the trainer UI has), the same trigger congratulated them about their own
--    action ("Nuevo cliente asignado"). Fix: the trainer arm now fires only
--    when the inserter is NOT the trainer (admin-assigned / service-role
--    bulk import), mirroring 0439's own fire_trainer_no_show self-check.
--
-- 3. "YA TIENE COACH" TAG IS RLS-DEAD CLIENT-SIDE. trainer_clients SELECT
--    (0274) is `trainer_id = auth.uid() OR client_id = auth.uid()`, so the
--    Add Client modal cannot see other trainers' active rows to warn "this
--    member already has a coach" — and opening the rows up via policy would
--    leak trainer_clients.notes (private). Fix: a narrow SECURITY DEFINER
--    RPC that returns ONLY the subset of probed ids that have an active link
--    with ANOTHER same-gym trainer. Staff-only, no notes, no trainer ids.
--
-- notifications.type is the notification_type ENUM (no CHECK constraint) —
-- 'new_trainer' did not exist, added below. Postgres 12+ allows ADD VALUE in
-- a transaction as long as the value isn't referenced at execution time in
-- the same transaction; the only references below live inside plpgsql bodies,
-- which evaluate when the trigger RUNS (cf. 0415's identical pattern).
--
-- Patterns mirrored from 0439: insert + dedup + audience, vault secrets +
-- pg_net push via send-push-user, bilingual copy by recipient language,
-- EXCEPTION wrapper so a notification failure can never roll back the
-- underlying trainer_clients write.
-- ============================================================

-- ── 0. New notification type ────────────────────────────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_trainer';

-- ── 1. Shared helper: localized insert + push for ONE member ────────────
-- Mirror of 0439's _notify_trainer with audience 'member'::user_role.
CREATE OR REPLACE FUNCTION public._notify_member(
  p_member_id UUID,
  p_gym_id    UUID,
  p_type      notification_type,
  p_title_en  TEXT,
  p_body_en   TEXT,
  p_title_es  TEXT,
  p_body_es   TEXT,
  p_data      JSONB,
  p_dedup     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang  TEXT;
  v_title TEXT;
  v_body  TEXT;
  v_url   TEXT;
  v_key   TEXT;
  v_req   BIGINT;
  v_rows  INTEGER := 0;
BEGIN
  IF p_member_id IS NULL OR p_gym_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(language, 'en') INTO v_lang FROM profiles WHERE id = p_member_id;
  IF v_lang IS NULL THEN v_lang := 'en'; END IF;

  IF v_lang LIKE 'es%' THEN
    v_title := p_title_es; v_body := p_body_es;
  ELSE
    v_title := p_title_en; v_body := p_body_en;
  END IF;

  -- In-app row (skip silently on dedup collision)
  INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key, audience)
  VALUES (p_member_id, p_gym_id, p_type, v_title, v_body, p_data, p_dedup, 'member'::user_role)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN; -- duplicate; don't double-push
  END IF;

  -- Native push (best-effort). send-push-user enforces quiet hours + tokens.
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG '_notify_member: vault secrets not configured, in-app only for %', p_member_id;
    RETURN;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push-user',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id',        p_member_id,
      'gym_id',            p_gym_id,
      'title',             v_title,
      'body',              v_body,
      'data',              p_data,
      'notification_type', p_type::text
    )
  ) INTO v_req;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_member(UUID,UUID,notification_type,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;

-- ── 2. fire_trainer_new_client v2 ───────────────────────────────────────
-- Replaces the 0439 definition. Behavior preserved from 0439: fires only for
-- active rows, trainer copy/dedup/type/data unchanged, failures only logged.
-- New: (a) member arm ALWAYS fires; (b) trainer arm skipped on self-add.
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

  -- (a) The MEMBER always hears about getting a trainer — whoever added them.
  PERFORM public._notify_member(
    NEW.client_id, NEW.gym_id, 'new_trainer'::notification_type,
    COALESCE(v_trainer_name, 'Your trainer') || ' is now your trainer',
    'You can check their profile and message them from the app.',
    COALESCE(v_trainer_name, 'Tu entrenador') || ' ahora es tu entrenador',
    'Puedes ver su perfil y escribirle desde la app.',
    jsonb_build_object('route', '/trainers/' || NEW.trainer_id::text, 'trainer_id', NEW.trainer_id),
    'member_newtrainer_' || NEW.trainer_id::text || '_' || NEW.client_id::text
  );

  -- (b) The TRAINER only hears about it when someone ELSE assigned the client
  --     (admin UI / service-role import). Self-adds are their own action —
  --     notifying them was pure noise (same guard as fire_trainer_no_show).
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

DROP TRIGGER IF EXISTS trg_trainer_new_client ON trainer_clients;
CREATE TRIGGER trg_trainer_new_client
  AFTER INSERT ON trainer_clients
  FOR EACH ROW
  EXECUTE FUNCTION fire_trainer_new_client();

-- ── 3. Other-trainer ownership probe (Add Client "Ya tiene coach" tag) ──
-- Returns ONLY the ids from p_client_ids that have an ACTIVE trainer_clients
-- row with a DIFFERENT same-gym trainer. Deliberately reveals nothing else
-- (no notes, no trainer identity, no inactive history). Staff-only.
CREATE OR REPLACE FUNCTION public.get_clients_with_other_trainer(p_client_ids UUID[])
RETURNS TABLE (client_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT tc.client_id
  FROM trainer_clients tc
  JOIN public.profile_lookup me ON me.id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    -- staff only (covers multi-role via the 0493-maintained flag)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_staff)
    -- cap the probe at 100 ids per call (UI sends ≤50)
    AND tc.client_id = ANY(p_client_ids[1:100])
    AND tc.gym_id = me.gym_id
    AND tc.is_active = TRUE
    AND tc.trainer_id <> auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_clients_with_other_trainer(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_clients_with_other_trainer(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
