-- 0576_trainer_meal_plan_duration.sql
-- Meal plans can now span multiple weeks. The 7-day meal structure stays as-is
-- (no JSONB format change, so existing plans + the member render keep working);
-- duration_weeks just tells the client how long to follow the plan, and end_date
-- is set accordingly so the member can see "Week X of N".
--
-- Safe to re-run.

ALTER TABLE public.trainer_meal_plans
  ADD COLUMN IF NOT EXISTS duration_weeks SMALLINT NOT NULL DEFAULT 1;
