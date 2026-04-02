-- =============================================================
-- GYM OFFERS
-- Migration: 0185_gym_offers.sql
--
-- Adds a gym_offers table for promotions, discounts, free
-- trials, bundles, class passes, and custom offers per gym.
-- =============================================================

-- ── 1. gym_offers — Offer catalog per gym ────────────────────

CREATE TABLE IF NOT EXISTS gym_offers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    title_es        TEXT,
    description     TEXT,
    description_es  TEXT,
    offer_type      TEXT NOT NULL DEFAULT 'custom'
                    CHECK (offer_type IN ('discount', 'free_trial', 'bundle', 'class_pass', 'bring_friend', 'custom')),
    badge_label     TEXT,
    valid_from      DATE,
    valid_until     DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_gym_offers_gym_id
  ON gym_offers(gym_id);

CREATE INDEX IF NOT EXISTS idx_gym_offers_gym_active
  ON gym_offers(gym_id, is_active);

-- ── 3. RLS ───────────────────────────────────────────────────

ALTER TABLE gym_offers ENABLE ROW LEVEL SECURITY;

-- Admins (admin / super_admin) can do everything for their gym
CREATE POLICY "gym_offers_admin" ON gym_offers
  FOR ALL USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );

-- Members can view active, non-expired offers for their gym
CREATE POLICY "gym_offers_member_select" ON gym_offers
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND is_active = TRUE
    AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
  );

-- Super admins can read all offers (cross-gym)
CREATE POLICY "gym_offers_super_admin" ON gym_offers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
