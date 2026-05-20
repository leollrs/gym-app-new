-- =============================================================
-- ADD: cancellation_save_attempts (member-facing "Before you go")
-- Migration: 0408_cancellation_save_attempts.sql
--
-- Why:
--   Today there is NO member-facing save attempt before a member
--   cancels their own membership from the app — the admin only
--   records an exit survey AFTER the fact. Hormozi's framework
--   inserts a save attempt step BEFORE the cancellation completes;
--   even a low single-digit save rate compounds materially.
--
--   This table records every time the member sees the "Before you
--   go" modal and what they chose: stayed, paused, or proceeded to
--   cancel. The reason_hint mirrors the admin-side exit-survey
--   categories so save attempts and post-mortem surveys live in
--   the same vocabulary.
--
-- Schema notes:
--   • One row per modal display. We don't dedupe — repeat shows are
--     interesting (member came close, backed off, came back).
--   • profile_id + gym_id are both denormalized for tenant isolation
--     and admin roll-ups without an extra JOIN.
--   • outcome is a CHECK constraint (not an enum) because the set is
--     tiny and unlikely to grow; keeping it inline keeps the schema
--     and migrations simpler.
--   • reason_hint is the new cancellation_reason_category enum,
--     created here. It is the source of truth that the admin
--     post-mortem exit survey will share when it lands.
--
-- Indexes:
--   • (gym_id, shown_at DESC)     — admin dashboards: recent attempts
--   • (profile_id, shown_at DESC) — per-member history
-- =============================================================

-- ── enum: cancellation_reason_category ──────────────────────────
-- Six member-friendly buckets. Mirrors the admin exit-survey labels
-- the i18n keys (admin.cancellationSurvey.reasons.*) already use.
DO $$ BEGIN
  CREATE TYPE public.cancellation_reason_category AS ENUM (
    'moved',        -- location / relocated
    'financial',    -- price / cost / affordability
    'time',         -- no time / busy / schedule
    'no_results',   -- not seeing progress
    'experience',   -- gym experience / staff / facilities
    'health'        -- injury / health reasons
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE public.cancellation_reason_category IS
  'Member-facing cancellation reason buckets. Shared between the in-app save attempt modal (cancellation_save_attempts.reason_hint) and the admin post-cancellation exit survey when it lands.';

-- ── table: cancellation_save_attempts ───────────────────────────
CREATE TABLE IF NOT EXISTS public.cancellation_save_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id       UUID NOT NULL REFERENCES public.gyms(id)     ON DELETE CASCADE,
  shown_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome      TEXT NOT NULL
                 CHECK (outcome IN ('stayed', 'paused', 'proceeded_to_cancel')),
  reason_hint  public.cancellation_reason_category,
  note         TEXT
);

COMMENT ON TABLE public.cancellation_save_attempts IS
  'One row per time a member opens the in-app "Before you go" save modal. outcome records whether the save attempt worked (stayed/paused) or the member proceeded to cancel. reason_hint + note are optional self-report fields that mirror the admin exit-survey categories.';

CREATE INDEX IF NOT EXISTS cancellation_save_attempts_gym_shown_idx
  ON public.cancellation_save_attempts (gym_id, shown_at DESC);

CREATE INDEX IF NOT EXISTS cancellation_save_attempts_profile_shown_idx
  ON public.cancellation_save_attempts (profile_id, shown_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.cancellation_save_attempts ENABLE ROW LEVEL SECURITY;

-- Members INSERT their own attempt (gym_id must match their profile's gym
-- so a member can't write into another tenant's table even with a guessed
-- gym_id). No UPDATE or DELETE policy — rows are append-only audit data.
DROP POLICY IF EXISTS "cancellation_save_attempts_insert_own"
  ON public.cancellation_save_attempts;
CREATE POLICY "cancellation_save_attempts_insert_own"
  ON public.cancellation_save_attempts
  FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = (
      SELECT gym_id FROM public.profiles WHERE id = auth.uid()
    )
  );

COMMENT ON POLICY "cancellation_save_attempts_insert_own"
  ON public.cancellation_save_attempts IS
  'Members can record their own save-attempt outcomes. profile_id is locked to auth.uid() and gym_id is locked to the member''s current gym so cross-tenant writes are impossible.';

-- Members read their own rows (so the modal can short-circuit repeat
-- shows if we ever want to in the future — cheap, no extra round-trip).
DROP POLICY IF EXISTS "cancellation_save_attempts_select_own"
  ON public.cancellation_save_attempts;
CREATE POLICY "cancellation_save_attempts_select_own"
  ON public.cancellation_save_attempts
  FOR SELECT
  USING (profile_id = auth.uid());

-- Staff (admin / super_admin / trainer) read their gym's rows. Trainers
-- only see their assigned clients' rows; admins see the whole gym.
DROP POLICY IF EXISTS "cancellation_save_attempts_staff_read"
  ON public.cancellation_save_attempts;
CREATE POLICY "cancellation_save_attempts_staff_read"
  ON public.cancellation_save_attempts
  FOR SELECT
  USING (
    (gym_id = public.current_gym_id() AND public.is_admin())
    OR public.is_trainer_of(profile_id)
  );

COMMENT ON POLICY "cancellation_save_attempts_staff_read"
  ON public.cancellation_save_attempts IS
  'Admins (incl. super_admin via is_admin()) read every save attempt in their gym. Trainers see only their assigned clients'' attempts. No update/delete policies — rows are append-only.';
