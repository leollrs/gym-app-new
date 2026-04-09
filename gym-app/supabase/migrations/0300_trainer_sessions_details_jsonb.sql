-- =============================================================
-- Add JSONB details column to trainer_sessions
-- Stores linked workout plan info and other session metadata
-- Migration: 0261_trainer_sessions_details_jsonb.sql
-- =============================================================

ALTER TABLE trainer_sessions
  ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}';

COMMENT ON COLUMN trainer_sessions.details IS
  'Extra session metadata — e.g. { "workout_id": "<uuid>", "workout_name": "Push Day", "workout_type": "routine|program" }';
