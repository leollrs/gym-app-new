-- ═══════════════════════════════════════════════════════════
-- MEAL PLANS & FOOD PREFERENCES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meal_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  meals           JSONB NOT NULL,
  target_calories INT,
  target_protein  INT,
  target_carbs    INT,
  target_fat      INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, plan_date)
);

CREATE INDEX idx_meal_plans_profile_date ON meal_plans(profile_id, plan_date);

CREATE TABLE IF NOT EXISTS disliked_foods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_item_id    UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, food_item_id)
);

-- RLS
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE disliked_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own meal plans" ON meal_plans FOR ALL USING (profile_id = auth.uid());
CREATE POLICY "Users own disliked foods" ON disliked_foods FOR ALL USING (profile_id = auth.uid());
