-- ============================================================================
-- 0654 — Make `gym-logos` public again (deliberately reversing 0111)
-- ============================================================================
-- 0111 made this bucket private on purpose:
--
--   "Make the bucket private so unauthenticated direct-URL access is blocked.
--    Authenticated reads will still work via Supabase client."
--
-- That held while a gym logo was only ever shown INSIDE the app, where every
-- reader has a session. The share-preview work (0653) breaks that assumption in
-- a way signed URLs cannot cover.
--
-- WHY SIGNED URLS DO NOT WORK HERE
-- A signed URL expires. An Open Graph card does not — iMessage renders the card
-- once and keeps it in that conversation indefinitely. Putting a 7-day signed
-- URL (AuthContext.jsx:489) inside a card that never re-fetches means every
-- share ever sent shows a broken logo one week later, permanently, with no way
-- to repair the ones already sitting in people's chat history. The crawler
-- itself is anonymous too — it has no session to sign with.
--
-- WHAT THIS ACTUALLY EXPOSES
-- The bucket holds gym LOGOS and nothing else — uploaded from
-- AdminSettingsBranding, AdminOnboardingWizard and GymSettingsTab, all at
-- `{gym_id}/logo.*`. The exposure is: someone holding a gym's UUID can fetch
-- that gym's logo. A logo is a public brand mark — it is on the storefront, the
-- Instagram and the shirts. That is the entire delta.
--
-- PRECEDENT IN THIS SCHEMA
-- 0375 forced `class-images` public for the same reason (it must render without
-- a session); `avatars` is public. This makes gym-logos consistent with both.
--
-- NOT CHANGED: upload and update stay admin-only and gym-scoped (0024 + 0487).
-- Public here means public READ, nothing else.
-- ============================================================================

-- ── 1. Flip the bucket ──────────────────────────────────────────────────────
-- This is what the /storage/v1/object/public/… route checks. Without it that
-- route answers "Bucket not found" even though the bucket exists — which is
-- exactly what it was doing before this migration.
UPDATE storage.buckets
   SET public = true
 WHERE id = 'gym-logos';

-- ── 2. Restore the public SELECT policy 0111 dropped ────────────────────────
-- Recreated verbatim from 0024:31. DROP first so the migration is re-runnable.
DROP POLICY IF EXISTS "gym_logos_public_read" ON storage.objects;
CREATE POLICY "gym_logos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'gym-logos');

-- 0111's authenticated-read policy is left in place. It is redundant now (the
-- policy above already covers authenticated callers) but harmless, and removing
-- it would be a second behaviour change riding along inside a migration that is
-- meant to do exactly one thing.

NOTIFY pgrst, 'reload schema';
