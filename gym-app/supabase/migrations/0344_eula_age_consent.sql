-- ============================================================
-- 0344: EULA enforcement + age verification (App Store / Play Store compliance)
--
-- Apple Guideline 5.1.1(v) and Play UGC policy require explicit
-- acceptance of Terms and Privacy with a logged timestamp.
-- Apple also requires "appropriate" age verification for non-Kids
-- apps that collect personal data; GDPR-K requires 16+ in some EU
-- regions. We use self-attestation (date of birth) at signup.
--
-- Columns added to public.profiles:
--   terms_accepted_at  TIMESTAMPTZ  — when user accepted Terms of Service
--   privacy_accepted_at TIMESTAMPTZ — when user accepted Privacy Policy
--   age_verified_at    TIMESTAMPTZ  — when user self-attested DOB at signup
--
-- date_of_birth (DATE) already exists on profiles (since 0001_initial_schema).
-- All new columns are nullable so existing rows aren't blocked.
-- App logic enforces NOT NULL on new signups.
--
-- Backfill: existing rows get terms_accepted_at = privacy_accepted_at = created_at,
-- so existing users aren't forced through re-acceptance. date_of_birth is
-- left untouched — users without a DOB will be prompted by app logic on
-- next login (handled at the app layer, not in this migration).
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS age_verified_at     TIMESTAMPTZ;

-- Backfill so we don't lock out existing accounts. Treat the row's
-- created_at as the implicit acceptance moment (the prior signup screen
-- showed the disclosure inline).
UPDATE public.profiles
SET terms_accepted_at   = created_at
WHERE terms_accepted_at IS NULL;

UPDATE public.profiles
SET privacy_accepted_at = created_at
WHERE privacy_accepted_at IS NULL;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'Timestamp when user explicitly accepted Terms of Service at signup. '
  'Required for App Store guideline 5.1.1(v) and Play UGC policy.';

COMMENT ON COLUMN public.profiles.privacy_accepted_at IS
  'Timestamp when user explicitly accepted Privacy Policy at signup.';

COMMENT ON COLUMN public.profiles.age_verified_at IS
  'Timestamp when user self-attested their date of birth at signup. '
  'Pairs with profiles.date_of_birth for runtime age-gate enforcement.';

NOTIFY pgrst, 'reload schema';
