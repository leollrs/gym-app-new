-- Gym invite links: token-based invites created by admins

-- ── gym_invites table ─────────────────────────────────────
CREATE TABLE gym_invites (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id      UUID        NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  created_by  UUID        NOT NULL REFERENCES profiles(id),
  email       TEXT,                               -- optional: targeted single-use invite
  token       TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  role        TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'trainer')),
  used_by     UUID        REFERENCES profiles(id),
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gym_invites_gym   ON gym_invites(gym_id);
CREATE INDEX idx_gym_invites_token ON gym_invites(token);

ALTER TABLE gym_invites ENABLE ROW LEVEL SECURITY;

-- ── RLS policies ──────────────────────────────────────────

-- Admins can view all invites for their gym
CREATE POLICY "gym_invites_select_admin" ON gym_invites
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- Anyone can look up an invite by token (unauthenticated signup flow)
CREATE POLICY "gym_invites_select_by_token" ON gym_invites
  FOR SELECT USING (true);

-- Admins can create invites for their own gym
CREATE POLICY "gym_invites_insert_admin" ON gym_invites
  FOR INSERT WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- Admins can mark invites as used (used_by, used_at) or revoke them via update
CREATE POLICY "gym_invites_update_admin" ON gym_invites
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  )
  WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );

-- Admins can delete (revoke) invites for their gym
CREATE POLICY "gym_invites_delete_admin" ON gym_invites
  FOR DELETE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );
