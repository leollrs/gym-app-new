-- 0513: Bilingual gym programs + drop-set technique marker
--
-- Lets admins author EN + ES names/descriptions for their programs so members
-- see them in their own language (the member program modal already reads
-- name_es / description_es, it just never had the columns to read).
--
-- Adds a drop-set marker that flows from an admin-authored program into the
-- member's enrolled routine. Supersets/circuits already use group_id/group_type
-- (added in 0128) so no new column is needed for those.
--
-- All ADD COLUMN IF NOT EXISTS — safe to re-run. Frontend is resilient and
-- works before this is applied (it retries writes/reads without these columns).

ALTER TABLE gym_programs       ADD COLUMN IF NOT EXISTS name_es        TEXT;
ALTER TABLE gym_programs       ADD COLUMN IF NOT EXISTS description_es TEXT;

-- Program cover for the member-side display (mirrors classes): a gradient/icon
-- preset key, or a custom uploaded image path. The member UI falls back to a
-- deterministic preset when both are null, so cards are never blank/ugly.
ALTER TABLE gym_programs       ADD COLUMN IF NOT EXISTS cover_preset   TEXT;
ALTER TABLE gym_programs       ADD COLUMN IF NOT EXISTS image_path     TEXT;

ALTER TABLE routine_exercises  ADD COLUMN IF NOT EXISTS is_drop_set    BOOLEAN NOT NULL DEFAULT false;
