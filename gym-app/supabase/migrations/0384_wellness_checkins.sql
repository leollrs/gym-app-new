-- =============================================================
-- ADD: wellness_checkins (subjective soreness check-in, one per day)
-- Migration: 0384_wellness_checkins.sql
--
-- Why:
--   The Recovery (Recuperación) page's HRV/Resting-HR card requires
--   an Apple Watch — useless to the ~80% of users on iPhone alone.
--   We replace that signal with a daily subjective soreness check-in
--   (1-10 slider) prompted after every workout on training days and
--   via a 9 AM local notification on rest/closed days.
--
--   One row per member per day. Soreness 1 = fully recovered, 10 =
--   completely smoked. Scoring (handled client-side in
--   readinessEngine.js): wellness_factor = (10 - soreness) * 100 / 9.
--
-- Schema:
--   • profile_id + checkin_date make a natural PK (one entry/day).
--   • gym_id denormalized for admin / trainer reads + retention queries.
--   • soreness NOT NULL CHECK 1..10.
--   • notes optional, free text for future "anything bothering you?".
--
-- Indexes:
--   • PK already covers (profile_id, checkin_date) lookups.
--   • A separate (gym_id, checkin_date) index supports admin roll-ups.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.wellness_checkins (
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id        UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  checkin_date  DATE NOT NULL,
  soreness      SMALLINT NOT NULL CHECK (soreness BETWEEN 1 AND 10),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS wellness_checkins_gym_date_idx
  ON public.wellness_checkins (gym_id, checkin_date DESC);

COMMENT ON TABLE public.wellness_checkins IS
  'Daily subjective soreness check-in (1-10). Replaces HRV/RHR on the Recovery page for iPhone-only users. One row per profile per calendar day.';

-- RLS
ALTER TABLE public.wellness_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wellness_select_own" ON public.wellness_checkins;
CREATE POLICY "wellness_select_own" ON public.wellness_checkins
  FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "wellness_insert_own" ON public.wellness_checkins;
CREATE POLICY "wellness_insert_own" ON public.wellness_checkins
  FOR INSERT
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "wellness_update_own" ON public.wellness_checkins;
CREATE POLICY "wellness_update_own" ON public.wellness_checkins
  FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Trainer / admin read access for the user's gym — mirrors the pattern
-- used by other member-data tables (workout_sessions, body_metrics, etc.).
DROP POLICY IF EXISTS "wellness_trainer_admin_read" ON public.wellness_checkins;
CREATE POLICY "wellness_trainer_admin_read" ON public.wellness_checkins
  FOR SELECT
  USING (
    public.is_trainer_of(profile_id)
    OR (gym_id = public.current_gym_id() AND public.is_admin())
  );

COMMENT ON POLICY "wellness_trainer_admin_read" ON public.wellness_checkins IS
  'Trainers see their assigned clients'' check-ins; admins see their own gym''s.';

-- Auto-bump updated_at on UPDATE so client-side "last changed" logic works.
CREATE OR REPLACE FUNCTION public.wellness_checkins_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wellness_checkins_updated_at ON public.wellness_checkins;
CREATE TRIGGER wellness_checkins_updated_at
  BEFORE UPDATE ON public.wellness_checkins
  FOR EACH ROW
  EXECUTE FUNCTION public.wellness_checkins_set_updated_at();
