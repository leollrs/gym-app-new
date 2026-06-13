-- 0531_checkin_cadence_once.sql
-- ---------------------------------------------------------------------------
-- ROOT CAUSE: the new one-time intake / PAR-Q check-in preset (trainer
-- coaching tab) creates templates with cadence 'once', but 0500 defined
-- checkin_templates.cadence with an inline CHECK limited to
-- ('weekly','biweekly','monthly') — inserting an intake template would fail
-- with a check_violation. Extend the allowed set with 'once'.
-- Semantics of 'once': the member answers a single time (period handling is
-- client-side via periodFor(); responses store their submission date in
-- period_start, and "answered?" means "any response ever").
-- Idempotent: drops whatever the cadence CHECK is currently named (inline
-- CHECKs get auto-generated names) and re-adds a named one including 'once'.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_name TEXT;
BEGIN
  -- Find the existing cadence CHECK regardless of its auto-generated name.
  SELECT conname INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'public.checkin_templates'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%cadence%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.checkin_templates DROP CONSTRAINT %I', v_name);
  END IF;

  ALTER TABLE public.checkin_templates
    ADD CONSTRAINT checkin_templates_cadence_check
    CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'once'));
END $$;

NOTIFY pgrst, 'reload schema';
