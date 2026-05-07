-- =============================================================
-- TRAINER PROFILE — extended fields + reviews
-- Migration: 0331_trainer_profile.sql
--
-- Adds the columns the new private + public trainer profile pages
-- (docs/trainer-redesign/profile.html) read from. Existing `bio`
-- column on `profiles` is reused for the long-form about copy;
-- `trainer_tagline` is the short one-liner shown above stats.
--
-- Design choice: services / credentials / specialties / availability
-- live as JSONB on `profiles` rather than separate tables. v1 doesn't
-- need to query across them. If reviews of services or per-credential
-- verification flows ship later, promote to real tables.
--
-- Reviews ARE a real table — they're queried for aggregate rating +
-- recent-reviews list, and a member should only be able to leave
-- one review per trainer.
-- =============================================================

-- ── Trainer profile fields on `profiles` ────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trainer_tagline      TEXT,
  ADD COLUMN IF NOT EXISTS trainer_cover_url    TEXT,
  ADD COLUMN IF NOT EXISTS trainer_years_exp    SMALLINT,
  ADD COLUMN IF NOT EXISTS trainer_location     TEXT,
  ADD COLUMN IF NOT EXISTS trainer_pronouns     TEXT,
  ADD COLUMN IF NOT EXISTS trainer_specialties  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trainer_credentials  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trainer_services     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trainer_availability JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS trainer_verified     BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.trainer_tagline      IS 'Short one-liner shown above stats on trainer profile.';
COMMENT ON COLUMN profiles.trainer_specialties  IS 'JSON array of strings: ["Strength","Hypertrophy",...]';
COMMENT ON COLUMN profiles.trainer_credentials  IS 'JSON array: [{name,issuer,year,verified}]';
COMMENT ON COLUMN profiles.trainer_services     IS 'JSON array: [{id,name,duration_min,price_cents,currency,popular,description}]';
COMMENT ON COLUMN profiles.trainer_availability IS 'JSON object keyed by dow (0-6): {"1":{"open":"06:00","close":"20:00"}}';

-- ── Reviews table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trainer_reviews (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reviewer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body          TEXT CHECK (char_length(body) <= 1000),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One review per (trainer, reviewer) pair. Updates allowed via UPSERT.
    CONSTRAINT trainer_reviews_unique UNIQUE (trainer_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_reviews_trainer    ON trainer_reviews(trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_reviews_reviewer   ON trainer_reviews(reviewer_id);

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE trainer_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone in the same gym can read reviews of a trainer in that gym.
DROP POLICY IF EXISTS trainer_reviews_select ON trainer_reviews;
CREATE POLICY trainer_reviews_select ON trainer_reviews FOR SELECT
USING (
  gym_id IN (
    SELECT gym_id FROM profiles WHERE id = auth.uid()
  )
);

-- A reviewer can write their own review only when they are an active
-- client of the trainer (or have been one — `trainer_clients` row exists).
-- Trainers cannot review themselves; admins/super_admins are allowed for
-- moderation flows.
DROP POLICY IF EXISTS trainer_reviews_insert ON trainer_reviews;
CREATE POLICY trainer_reviews_insert ON trainer_reviews FOR INSERT
WITH CHECK (
  reviewer_id = auth.uid()
  AND reviewer_id <> trainer_id
  AND EXISTS (
    SELECT 1 FROM trainer_clients tc
    WHERE tc.trainer_id = trainer_reviews.trainer_id
      AND tc.client_id  = auth.uid()
  )
);

-- Reviewers can update / delete their own review.
DROP POLICY IF EXISTS trainer_reviews_update ON trainer_reviews;
CREATE POLICY trainer_reviews_update ON trainer_reviews FOR UPDATE
USING (reviewer_id = auth.uid())
WITH CHECK (reviewer_id = auth.uid());

DROP POLICY IF EXISTS trainer_reviews_delete ON trainer_reviews;
CREATE POLICY trainer_reviews_delete ON trainer_reviews FOR DELETE
USING (
  reviewer_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin','super_admin')
      AND p.gym_id = trainer_reviews.gym_id
  )
);

-- ── Aggregate RPC ───────────────────────────────────────────────
-- Returns rating count + average for a trainer in one round-trip.
CREATE OR REPLACE FUNCTION public.get_trainer_review_summary(
  p_trainer_id UUID
)
RETURNS TABLE (
  review_count INT,
  avg_rating   NUMERIC(3,2),
  five_pct     NUMERIC(5,2)  -- % of reviews that are 5-star
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::INT,
    ROUND(AVG(rating)::NUMERIC, 2),
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND((COUNT(*) FILTER (WHERE rating = 5))::NUMERIC * 100 / COUNT(*), 2)
    END
  FROM trainer_reviews
  WHERE trainer_id = p_trainer_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_trainer_review_summary(UUID) TO authenticated;

-- ── updated_at trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_trainer_reviews()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_reviews_touch ON trainer_reviews;
CREATE TRIGGER trg_trainer_reviews_touch
  BEFORE UPDATE ON trainer_reviews
  FOR EACH ROW EXECUTE FUNCTION public.touch_trainer_reviews();
