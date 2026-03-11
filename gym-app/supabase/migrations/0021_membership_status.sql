-- Membership status on profiles: active / frozen / cancelled / banned

-- ── Enum type ─────────────────────────────────────────────
CREATE TYPE membership_status AS ENUM ('active', 'frozen', 'cancelled', 'banned');

-- ── profiles columns ──────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS membership_status            membership_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS membership_status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS membership_status_reason     TEXT;

-- ── RLS: admins can update membership status for gym members ──
-- profiles already has RLS enabled; this policy allows gym admins
-- to update the three membership_status* columns for any member
-- whose gym_id matches the admin's current gym.
CREATE POLICY "profiles_update_admin_membership" ON profiles
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  )
  WITH CHECK (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );
