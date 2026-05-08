-- =============================================================
-- CLEANUP: duplicate audit-log entries + Spanish NPS survey title
-- Migration: 0382_cleanup_audit_dupes_and_es_nps.sql
--
-- Why:
--   1. Before 0381's `handleDeleteSlot` fix landed, repeated delete clicks
--      on a class schedule slot wrote one audit row each — even though
--      every click after the first deleted 0 rows. The result was
--      noisy duplicates (e.g. 8x DELETE_SCHEDULE_SLOT for the same
--      entity within seconds). Code now skips audit when 0 rows
--      were deleted; this migration cleans up the historical noise.
--
--   2. The default NPS survey title is the English string
--      "How likely are you to recommend our gym?". Spanish-default
--      gyms ended up with English survey questions on the member side.
--      Update existing rows that still hold the literal English
--      default to its Spanish equivalent, and update the column
--      default for future surveys.
-- =============================================================

-- ── 1) Dedupe admin_audit_log ────────────────────────────────
-- For each (gym_id, actor_id, action, entity_id) group, keep the
-- earliest row and delete the rest. Restricted to actions that are
-- known to have been emitted in tight loops by the now-fixed UI.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY gym_id, actor_id, action, entity_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM admin_audit_log
  WHERE action IN ('delete_schedule_slot')
    AND entity_id IS NOT NULL
)
DELETE FROM admin_audit_log
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 2) Translate English NPS survey title to Spanish ─────────
-- Only touches rows that still hold the literal English default,
-- so admin-customized questions are left alone.
UPDATE public.nps_surveys
   SET title = '¿Qué tan probable es que recomiendes nuestro gimnasio?'
 WHERE title = 'How likely are you to recommend our gym?';

-- New surveys default to Spanish. Most TuGymPR gyms run in Spanish;
-- admins editing in English can override at create time.
ALTER TABLE public.nps_surveys
  ALTER COLUMN title
  SET DEFAULT '¿Qué tan probable es que recomiendes nuestro gimnasio?';
