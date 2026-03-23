-- =============================================================
-- ADD NEW ENUM VALUES FOR EXERCISE LIBRARY EXPANSION
-- Migration: 0044_add_exercise_enum_values.sql
-- =============================================================
-- Must be in a separate migration (committed) before the enums
-- can be used in INSERT statements (PostgreSQL requirement).
-- =============================================================

-- ── Add new muscle_group enum values ─────────────────────────
ALTER TYPE muscle_group ADD VALUE IF NOT EXISTS 'Forearms';
ALTER TYPE muscle_group ADD VALUE IF NOT EXISTS 'Traps';

-- ── Add new equipment enum value ─────────────────────────────
ALTER TYPE equipment_type ADD VALUE IF NOT EXISTS 'EZ Bar';
