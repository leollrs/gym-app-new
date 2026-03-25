-- Store user corrections to AI food analysis for future model improvement
CREATE TABLE IF NOT EXISTS ai_food_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_name       TEXT NOT NULL,
  ai_calories     NUMERIC,
  ai_protein_g    NUMERIC,
  ai_carbs_g      NUMERIC,
  ai_fat_g        NUMERIC,
  ai_grams        NUMERIC,
  user_calories   NUMERIC,
  user_protein_g  NUMERIC,
  user_carbs_g    NUMERIC,
  user_fat_g      NUMERIC,
  user_grams      NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_food_corrections_food ON ai_food_corrections (food_name);

ALTER TABLE ai_food_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own corrections"
  ON ai_food_corrections FOR ALL
  USING (profile_id = auth.uid());
