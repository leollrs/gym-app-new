-- =============================================================
-- 0417 — Gym branding fields for v2 print cards
--
-- Two small text columns used by the v2 print card designs:
--
--   • cup_noun     — what the gym calls their drinkware: 'shaker',
--                    'bottle', 'protein cup', 'jug', etc. Appears on
--                    the HabitCard pickup ticket ("One {{cup_noun}},
--                    with your name on it.").
--   • founded_year — gym's founding year, shown as a quiet "est. XXXX"
--                    on the back panel of the Tenure365 folded card.
--                    Stored as TEXT so gyms can pass 'MMXX' / '2018' /
--                    'est. 2018' / '' as they prefer.
--
-- Both are nullable. Cards fall back gracefully when missing:
--   • cup_noun → 'shaker' (sensible default for PR gym culture)
--   • founded_year → line omitted entirely from the back panel
-- =============================================================

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS cup_noun TEXT,
  ADD COLUMN IF NOT EXISTS founded_year TEXT;

COMMENT ON COLUMN public.gyms.cup_noun IS
  'What the gym calls their drinkware (shaker/bottle/cup). Used on HabitCard pickup ticket.';
COMMENT ON COLUMN public.gyms.founded_year IS
  'Gym founding year as TEXT (free format). Shown on Tenure365 folded card back panel.';

NOTIFY pgrst, 'reload schema';
