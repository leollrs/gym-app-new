-- Phase 1: Caribbean & PR Staples — Unique Images
-- Replaces generic category images with specific high-quality photography

UPDATE food_items SET image_url = '/foods/arroz_blanco.png' WHERE name = 'Arroz Blanco';
UPDATE food_items SET image_url = '/foods/arroz_amarillo.png' WHERE name = 'Arroz Amarillo (con aceite)';
UPDATE food_items SET image_url = '/foods/arroz_con_gandules.png' WHERE name = 'Arroz con Gandules';
UPDATE food_items SET image_url = '/foods/arroz_con_pollo.png' WHERE name = 'Arroz con Pollo';
UPDATE food_items SET image_url = '/foods/arroz_con_habichuelas.png' WHERE name = 'Arroz con Habichuelas';
UPDATE food_items SET image_url = '/foods/arroz_con_salchichas.png' WHERE name = 'Arroz con Salchichas';
UPDATE food_items SET image_url = '/foods/arroz_con_maiz.png' WHERE name = 'Arroz con Maíz';
UPDATE food_items SET image_url = '/foods/arroz_mamposteao.png' WHERE name = 'Arroz Mamposteao';
UPDATE food_items SET image_url = '/foods/arroz_con_dulce.png' WHERE name = 'Arroz con Dulce';
UPDATE food_items SET image_url = '/foods/pegao.png' WHERE name = 'Pegao (Crispy Rice)';

UPDATE food_items SET image_url = '/foods/pernil.png' WHERE name = 'Pernil (Roast Pork Shoulder)';
UPDATE food_items SET image_url = '/foods/lechon_asado.png' WHERE name = 'Lechón Asado';
UPDATE food_items SET image_url = '/foods/pollo_guisado.png' WHERE name = 'Pollo Guisado';
UPDATE food_items SET image_url = '/foods/carne_guisada.png' WHERE name = 'Carne Guisada';
UPDATE food_items SET image_url = '/foods/bistec_encebollado.png' WHERE name = 'Bistec Encebollado';
