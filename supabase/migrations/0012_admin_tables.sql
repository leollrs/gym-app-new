-- Admin tables: gym_programs + gym hours/days columns

-- ── Gym hours & open days ─────────────────────────────────
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS open_time  TEXT DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS close_time TEXT DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS open_days  INTEGER[] DEFAULT '{0,1,2,3,4,5,6}';

-- ── Gym programs ──────────────────────────────────────────
-- Structured multi-week programs created by gym admins.
-- Members can enroll; the progressive overload engine will ride on top.
CREATE TABLE gym_programs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id         UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  created_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  duration_weeks INTEGER NOT NULL DEFAULT 8,
  weeks          JSONB NOT NULL DEFAULT '{}',  -- { "1": [routineId, ...], "2": [...] }
  is_published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gym_programs_gym ON gym_programs(gym_id, is_published);

ALTER TABLE gym_programs ENABLE ROW LEVEL SECURITY;

-- Admins + trainers of the gym can manage programs
CREATE POLICY "programs_select_gym" ON gym_programs
  FOR SELECT USING (gym_id = public.current_gym_id());

CREATE POLICY "programs_insert_admin" ON gym_programs
  FOR INSERT WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

CREATE POLICY "programs_update_admin" ON gym_programs
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

CREATE POLICY "programs_delete_admin" ON gym_programs
  FOR DELETE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );
