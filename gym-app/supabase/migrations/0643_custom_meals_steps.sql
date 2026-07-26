-- 0643 — instructions for trainer/member custom meals.
--
-- custom_meals already has by-value macro totals + `items` (0632, the
-- ingredient list). This adds `steps` so a hand-built meal can also carry
-- preparation instructions (one step per array entry), the same shape the
-- catalog `meals.steps` uses — so the meal preview can render ingredients AND
-- instructions for custom meals, not just frozen macros.
--
-- `steps` is a JSON array of strings: ["Preheat oven to 400F", "Season the ..."]
-- Nullable + additive: existing custom meals keep working with steps = NULL.
-- Safe to re-run. No policy change (custom_meals RLS already governs the row).

ALTER TABLE public.custom_meals
  ADD COLUMN IF NOT EXISTS steps jsonb;

NOTIFY pgrst, 'reload schema';
