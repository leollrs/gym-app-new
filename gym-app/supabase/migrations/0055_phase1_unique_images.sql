-- Phase 1: Caribbean & PR Staples — Unique Images
-- Replaces generic category images with specific high-quality photography

UPDATE food_items SET image_url = '/foods/arroz_blanco.jpg' WHERE name = 'Arroz Blanco';
UPDATE food_items SET image_url = '/foods/arroz_amarillo.jpg' WHERE name = 'Arroz Amarillo (con aceite)';
UPDATE food_items SET image_url = '/foods/arroz_con_gandules.jpg' WHERE name = 'Arroz con Gandules';
UPDATE food_items SET image_url = '/foods/arroz_con_pollo.jpg' WHERE name = 'Arroz con Pollo';
UPDATE food_items SET image_url = '/foods/arroz_con_habichuelas.jpg' WHERE name = 'Arroz con Habichuelas';
UPDATE food_items SET image_url = '/foods/arroz_con_salchichas.jpg' WHERE name = 'Arroz con Salchichas';
UPDATE food_items SET image_url = '/foods/arroz_con_maiz.jpg' WHERE name = 'Arroz con Maíz';
UPDATE food_items SET image_url = '/foods/arroz_mamposteao.jpg' WHERE name = 'Arroz Mamposteao';
UPDATE food_items SET image_url = '/foods/arroz_con_dulce.jpg' WHERE name = 'Arroz con Dulce';
UPDATE food_items SET image_url = '/foods/pegao.jpg' WHERE name = 'Pegao (Crispy Rice)';

UPDATE food_items SET image_url = '/foods/pernil.jpg' WHERE name = 'Pernil (Roast Pork Shoulder)';
UPDATE food_items SET image_url = '/foods/lechon_asado.jpg' WHERE name = 'Lechón Asado';
UPDATE food_items SET image_url = '/foods/pollo_guisado.jpg' WHERE name = 'Pollo Guisado';
UPDATE food_items SET image_url = '/foods/carne_guisada.jpg' WHERE name = 'Carne Guisada';
UPDATE food_items SET image_url = '/foods/bistec_encebollado.jpg' WHERE name = 'Bistec Encebollado';
