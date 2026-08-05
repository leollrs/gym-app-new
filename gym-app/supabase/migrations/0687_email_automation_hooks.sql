-- =============================================================
-- 0687 — Wire the gym's email templates to the automated moments
-- =============================================================
--
-- Adds the mapping (which template serves which moment) and the triggers that
-- fire an email when the existing lifecycle / win-back jobs log a send.
--
-- NOTHING STARTS SENDING ON APPLY. `auto_enabled` defaults to FALSE, so a gym
-- that already has templates saved does not wake up emailing its members. An
-- admin has to pick a moment and switch it on, per template.
--
-- WHY TRIGGERS ON THE LOG TABLES
--
-- run_lifecycle_messages_daily and run_winback_messages_daily already do all
-- the eligibility work — tenure windows, condition gates, category exclusions,
-- one-step-per-member-per-day — and record exactly one row per send in
-- lifecycle_message_log / winback_message_log, guarded by a UNIQUE constraint.
--
-- Hanging the email off that INSERT means the email inherits every one of those
-- guarantees for free: same audience, same dedup, once per member ever. It also
-- mirrors how push already works (fire_lifecycle_push 0447, fire_winback_push
-- 0402), so there is one shape to reason about rather than two.
--
-- No new cron. Class-reminder email rides the existing scheduled-reminders
-- function, which already walks members and finds their bookings.
-- =============================================================

-- ── 1. Template ↔ moment mapping ─────────────────────────────
ALTER TABLE public.gym_email_templates
  ADD COLUMN IF NOT EXISTS step_key     TEXT,
  ADD COLUMN IF NOT EXISTS auto_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.gym_email_templates.step_key IS
  'Which automated moment this template serves: a lifecycle step (day_1 … '
  'day_60), a win-back step (day_7/day_30/day_60), or the literal ''classes''. '
  'NULL = manual-only, the historical behaviour.';

-- One live template per moment per gym. Partial so the pile of manual
-- (step_key NULL, auto_enabled false) templates is unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_email_templates_auto_step
  ON public.gym_email_templates (gym_id, step_key)
  WHERE auto_enabled = TRUE AND step_key IS NOT NULL;

-- ── 2. The dispatcher ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_automated_email(
  p_profile_id UUID,
  p_scope      TEXT,
  p_step_key   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  -- Cheap pre-check so we don't burn an HTTP call on someone who opted out.
  -- The edge function re-checks — belt and braces, the same pattern
  -- send-push-user uses.
  IF NOT public.email_allowed_for(p_profile_id, p_scope) THEN RETURN; END IF;

  -- Vault, not current_setting('app.settings.*'): that parameter was never set
  -- on this project and the crons built on it errored on every tick until 0446
  -- and 0606 moved to this pattern.
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'fire_automated_email: vault secrets not configured, skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-automated-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id', p_profile_id,
      'scope',      p_scope,
      'step_key',   p_step_key
    )
  );
EXCEPTION WHEN OTHERS THEN
  -- An email must never roll back the log row that recorded the in-app
  -- message. Same posture as print_cards_on_session_complete (0432:146).
  RAISE LOG 'fire_automated_email failed for % (%): %', p_profile_id, p_scope, SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_automated_email(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fire_automated_email(UUID, TEXT, TEXT) TO service_role;

-- ── 3. Lifecycle ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_lifecycle_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fire_automated_email(NEW.profile_id, 'lifecycle', NEW.step_key);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_lifecycle_email ON public.lifecycle_message_log;
CREATE TRIGGER trg_fire_lifecycle_email
  AFTER INSERT ON public.lifecycle_message_log
  FOR EACH ROW EXECUTE FUNCTION public.fire_lifecycle_email();

-- ── 4. Win-back ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_winback_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fire_automated_email(NEW.profile_id, 'winback', NEW.step_key);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_winback_email ON public.winback_message_log;
CREATE TRIGGER trg_fire_winback_email
  AFTER INSERT ON public.winback_message_log
  FOR EACH ROW EXECUTE FUNCTION public.fire_winback_email();

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verify:
--   -- 1. Point a template at a moment and switch it on:
--   UPDATE gym_email_templates
--      SET step_key = 'day_7', auto_enabled = TRUE
--    WHERE id = '<template>';
--
--   -- 2. Opted out → no HTTP call at all:
--   SELECT email_allowed_for('<profile>', 'lifecycle');
--
--   -- 3. Force one end to end (this is what the cron does):
--   INSERT INTO lifecycle_message_log (profile_id, gym_id, step_key)
--   VALUES ('<profile>', '<gym>', 'day_7');
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 1;
--
-- Requires the vault secrets from 0401:15-19:
--   SELECT vault.create_secret('<url>', 'supabase_url', 'Project URL');
--   SELECT vault.create_secret('<key>', 'service_role_key', 'Service role key');
-- =============================================================
