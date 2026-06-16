-- Remove pronouns from the product. The trainer_pronouns COLUMN is retained on
-- purpose: get_auth_context + get_trainer_public_profile (and get_gym_trainers)
-- still SELECT it, so dropping it would break login / trainer profiles. Nothing
-- in the app reads or writes it anymore — here we just clear all stored values.
UPDATE profiles SET trainer_pronouns = NULL WHERE trainer_pronouns IS NOT NULL;
