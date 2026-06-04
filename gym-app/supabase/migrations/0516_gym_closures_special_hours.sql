-- 0516 — Special hours on gym closures
--
-- The admin "Cierres del gym" card (Ajustes → Horario) only let admins mark a
-- date as fully closed. But a holiday often means REDUCED hours, not a full
-- closure ("cierre doesn't necessarily mean closed"). Add an explicit
-- is_closed flag plus optional open/close times so a closure row can express
-- either "closed all day" or "open with special hours".
--
--   is_closed = TRUE  (default) → fully closed (existing behavior, unchanged).
--   is_closed = FALSE           → open with special hours (open_time/close_time).
--
-- Defaulting is_closed to TRUE keeps every existing row — and the streak
-- protection logic that reads gym_closures.closure_date — behaving exactly as
-- before. open_time/close_time are TEXT to match gym_holidays (HH:MM strings).
ALTER TABLE gym_closures
  ADD COLUMN IF NOT EXISTS is_closed  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS open_time  TEXT,
  ADD COLUMN IF NOT EXISTS close_time TEXT;
