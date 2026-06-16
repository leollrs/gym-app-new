-- Allow general (client-less) trainer meal plans.
-- Trainer WORKOUT plans already permit a NULL client (a generic template/plan);
-- meal plans forced a client (client_id NOT NULL), so a trainer couldn't make a
-- reusable general meal plan. Drop the NOT NULL to match workout plans.
ALTER TABLE trainer_meal_plans ALTER COLUMN client_id DROP NOT NULL;
