-- Migration 0317: Add boiled egg variants to food database

INSERT INTO food_items (name, name_es, brand, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES
('Hard Boiled Egg',  'Huevo Duro',              NULL, 1, 'large', 78, 6,   0.6, 5,   0),
('Soft Boiled Egg',  'Huevo Pasado por Agua',    NULL, 1, 'large', 78, 6,   0.6, 5,   0),
('Egg White',        'Clara de Huevo',           NULL, 1, 'large', 17, 3.6, 0.2, 0.1, 0);
