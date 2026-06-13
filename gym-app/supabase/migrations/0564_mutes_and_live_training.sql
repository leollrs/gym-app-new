-- ============================================================
-- 0564 — muted_users (persistent mutes) + live_training_sessions (presence)
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor. Both are new, additive tables.
--
-- 1. muted_users — feed mutes were localStorage-only (lost when iOS WKWebView
--    clears storage). Per-user, owner-RLS, mirrors hidden_posts (0343).
--
-- 2. live_training_sessions — presence row written while a member is in an
--    active workout, so friends see them in the "Friends training now" strip.
--    Deliberately a SEPARATE table (not an in_progress workout_sessions row) so
--    it can't pollute the heavily-used session history / stat counts, and so
--    a friends-only RLS read can't leak who's training to the whole gym.
-- ============================================================

-- ── 1. muted_users ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.muted_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muter_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muted_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (muter_id, muted_id)
);
CREATE INDEX IF NOT EXISTS idx_muted_users_muter ON public.muted_users(muter_id);

ALTER TABLE public.muted_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY muted_users_select_own ON public.muted_users
  FOR SELECT USING (muter_id = auth.uid());
CREATE POLICY muted_users_insert_own ON public.muted_users
  FOR INSERT WITH CHECK (muter_id = auth.uid());
CREATE POLICY muted_users_delete_own ON public.muted_users
  FOR DELETE USING (muter_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.muted_users TO authenticated;

-- ── 2. live_training_sessions (presence) ────────────────────
-- One row per user (PK = profile_id) upserted on workout start + heartbeated;
-- deleted when they leave the active-session screen. Stale rows (app killed
-- mid-workout) are ignored by the client's `updated_at` freshness filter.
CREATE TABLE IF NOT EXISTS public.live_training_sessions (
  profile_id   UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id       UUID NOT NULL,
  routine_name TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_training_gym ON public.live_training_sessions(gym_id, updated_at);

ALTER TABLE public.live_training_sessions ENABLE ROW LEVEL SECURITY;

-- Read: yourself, or an accepted friend (either direction). Keeps "who's
-- training" visible only to friends, not the whole gym.
CREATE POLICY live_training_select_friends ON public.live_training_sessions
  FOR SELECT USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = auth.uid() AND f.addressee_id = live_training_sessions.profile_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = live_training_sessions.profile_id))
    )
  );
-- Write: own row only.
CREATE POLICY live_training_insert_own ON public.live_training_sessions
  FOR INSERT WITH CHECK (profile_id = auth.uid());
CREATE POLICY live_training_update_own ON public.live_training_sessions
  FOR UPDATE USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY live_training_delete_own ON public.live_training_sessions
  FOR DELETE USING (profile_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_training_sessions TO authenticated;
