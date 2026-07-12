-- ============================================================
-- 0613 — exercise_favorites: create the missing backing table
-- ============================================================
-- The favorite-exercise feature is fully built on the client — a star toggle
-- + "favorites only" filter + fallback chips across ExerciseLibrary.jsx and
-- ActiveSession.jsx (and CLAUDE.md lists it as a shipped feature) — but the
-- `exercise_favorites` table was never created. Every load returned an error
-- (swallowed → empty Set) and every star tap silently failed to persist.
--
-- Fix is the tiny missing table, NOT ripping out working UI. Columns match the
-- exact shape the client already writes: (user_id, exercise_id).
--
--   ExerciseLibrary.jsx: .from('exercise_favorites')
--     .select('exercise_id').eq('user_id', user.id)
--     .insert({ user_id, exercise_id })  /  .delete().eq('user_id',…).eq('exercise_id',…)
--   ActiveSession.jsx: same select shape for the picker's favorites filter.
--
-- user_id → profiles(id) ON DELETE CASCADE means delete_user_account()'s
-- `DELETE FROM profiles` already cleans these up (no RPC change needed);
-- exercise_id → exercises(id) ON DELETE CASCADE cleans up when a custom
-- exercise is removed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.exercise_favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_favorites_user ON public.exercise_favorites(user_id);

ALTER TABLE public.exercise_favorites ENABLE ROW LEVEL SECURITY;

-- A member manages only their own favorites.
CREATE POLICY "exercise_favorites_select_own" ON public.exercise_favorites
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "exercise_favorites_insert_own" ON public.exercise_favorites
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "exercise_favorites_delete_own" ON public.exercise_favorites
  FOR DELETE USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
