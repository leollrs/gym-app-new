-- ═══════════════════════════════════════════════════════════
-- PUERTO RICAN & CARIBBEAN FOOD LIBRARY
-- 100+ items: PR staples, frituras, sopas, postres,
-- Dominican crossover, local chains, panadería
-- ═══════════════════════════════════════════════════════════

INSERT INTO food_items (name, brand, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES

-- ─────────────────────────────────────────────────────────
-- ARROZ (Rice Dishes)
-- ─────────────────────────────────────────────────────────
('Arroz Blanco', NULL, 1, 'cup', 206, 4, 45, 0.4, 0.6),
('Arroz Amarillo (con aceite)', NULL, 1, 'cup', 240, 4, 45, 5, 0.6),
('Arroz con Gandules', NULL, 1, 'cup', 280, 9, 42, 8, 4),
('Arroz con Pollo', NULL, 1, 'cup', 320, 22, 38, 8, 1.5),
('Arroz con Habichuelas', NULL, 1, 'cup', 260, 10, 44, 4, 6),
('Arroz con Salchichas', NULL, 1, 'cup', 340, 12, 40, 14, 1),
('Arroz con Maíz', NULL, 1, 'cup', 250, 5, 46, 5, 2),
('Arroz Mamposteao', NULL, 1, 'cup', 290, 10, 42, 9, 5),
('Arroz con Dulce', NULL, 1, 'cup', 320, 4, 58, 8, 1),
('Pegao (Crispy Rice)', NULL, 0.5, 'cup', 160, 2, 28, 5, 0.3),

-- ─────────────────────────────────────────────────────────
-- HABICHUELAS (Beans)
-- ─────────────────────────────────────────────────────────
('Habichuelas Guisadas (rosadas)', NULL, 1, 'cup', 220, 12, 38, 3, 10),
('Habichuelas Guisadas (rojas)', NULL, 1, 'cup', 230, 13, 40, 3, 11),
('Habichuelas Guisadas (blancas)', NULL, 1, 'cup', 210, 12, 36, 3, 9),
('Habichuelas Negras Guisadas', NULL, 1, 'cup', 240, 14, 42, 2, 12),
('Gandules Guisados', NULL, 1, 'cup', 210, 11, 36, 3, 8),

-- ─────────────────────────────────────────────────────────
-- CARNES (Meats — PR Style)
-- ─────────────────────────────────────────────────────────
('Pernil (Roast Pork Shoulder)', NULL, 100, 'g', 280, 28, 2, 18, 0),
('Lechón Asado', NULL, 100, 'g', 290, 26, 0, 20, 0),
('Pollo Guisado', NULL, 1, 'cup', 280, 30, 8, 14, 1),
('Carne Guisada', NULL, 1, 'cup', 310, 32, 10, 16, 1),
('Bistec Encebollado', NULL, 1, 'serving', 320, 30, 6, 18, 0.5),
('Chuleta Kan Kan (fried pork chop)', NULL, 1, 'chop', 420, 28, 12, 28, 0),
('Churrasco (skirt steak)', NULL, 6, 'oz', 340, 36, 0, 22, 0),
('Pollo Frito', NULL, 2, 'pieces', 380, 28, 16, 22, 0.5),
('Pollo a la Brasa (quarter)', NULL, 1, 'quarter', 310, 32, 2, 18, 0),
('Carne Frita (fried pork chunks)', NULL, 1, 'cup', 450, 30, 8, 34, 0),
('Chicharrón de Pollo', NULL, 1, 'cup', 380, 26, 14, 24, 0),
('Chicharrón de Cerdo', NULL, 100, 'g', 540, 24, 0, 50, 0),

-- ─────────────────────────────────────────────────────────
-- MARISCOS (Seafood — PR Style)
-- ─────────────────────────────────────────────────────────
('Camarones al Ajillo', NULL, 1, 'serving', 280, 24, 4, 18, 0),
('Mofongo Relleno de Camarones', NULL, 1, 'serving', 580, 28, 52, 28, 4),
('Asopao de Camarones', NULL, 1, 'bowl', 350, 22, 40, 10, 2),
('Pescado Frito (whole fried fish)', NULL, 1, 'fish', 420, 38, 12, 24, 0),
('Ensalada de Pulpo', NULL, 1, 'cup', 180, 22, 8, 6, 1),
('Bacalao Guisado (salt cod stew)', NULL, 1, 'cup', 260, 24, 14, 12, 2),
('Serenata de Bacalao (cod salad)', NULL, 1, 'serving', 320, 26, 18, 16, 3),

-- ─────────────────────────────────────────────────────────
-- MOFONGO & TOSTONES
-- ─────────────────────────────────────────────────────────
('Mofongo (plain)', NULL, 1, 'serving', 360, 4, 48, 18, 4),
('Mofongo Relleno de Pollo', NULL, 1, 'serving', 520, 30, 48, 22, 4),
('Mofongo Relleno de Carne', NULL, 1, 'serving', 560, 32, 48, 26, 4),
('Tostones (fried green plantains)', NULL, 6, 'pieces', 280, 2, 40, 14, 3),
('Amarillos / Maduros (sweet plantains)', NULL, 1, 'cup', 310, 2, 52, 12, 3),
('Trifongo', NULL, 1, 'serving', 420, 6, 52, 22, 5),
('Mofongo de Yuca', NULL, 1, 'serving', 380, 4, 50, 20, 3),

-- ─────────────────────────────────────────────────────────
-- FRITURAS (Fried Snacks)
-- ─────────────────────────────────────────────────────────
('Alcapurria (meat)', NULL, 1, 'piece', 230, 8, 24, 12, 2),
('Alcapurria (crab)', NULL, 1, 'piece', 220, 10, 24, 10, 2),
('Bacalaíto', NULL, 1, 'piece', 180, 8, 18, 8, 0.5),
('Empanadilla de Carne', NULL, 1, 'piece', 240, 10, 26, 12, 1),
('Empanadilla de Pollo', NULL, 1, 'piece', 220, 12, 24, 10, 1),
('Empanadilla de Pizza', NULL, 1, 'piece', 250, 10, 28, 12, 1),
('Sorullito de Maíz', NULL, 2, 'pieces', 200, 4, 24, 10, 1),
('Relleno de Papa (meat stuffed potato ball)', NULL, 1, 'piece', 260, 10, 28, 12, 2),
('Papa Rellena', NULL, 1, 'piece', 280, 12, 30, 12, 2),
('Pionono (sweet plantain ring)', NULL, 1, 'piece', 320, 14, 32, 16, 2),
('Aranitas de Plátano (plantain fritters)', NULL, 4, 'pieces', 240, 2, 32, 12, 2),
('Tostón Relleno', NULL, 1, 'piece', 350, 16, 34, 18, 3),

-- ─────────────────────────────────────────────────────────
-- SOPAS & ASOPAO
-- ─────────────────────────────────────────────────────────
('Sancocho Puertorriqueño', NULL, 1, 'bowl', 380, 24, 40, 14, 5),
('Asopao de Pollo', NULL, 1, 'bowl', 320, 24, 36, 8, 2),
('Sopa de Pollo con Fideos', NULL, 1, 'bowl', 240, 18, 28, 6, 2),
('Sopa de Plátano', NULL, 1, 'bowl', 220, 8, 34, 6, 3),
('Caldo de Res', NULL, 1, 'bowl', 280, 22, 24, 10, 3),
('Sopa de Salchichón', NULL, 1, 'bowl', 260, 12, 30, 10, 2),

-- ─────────────────────────────────────────────────────────
-- VIANDAS & SIDES
-- ─────────────────────────────────────────────────────────
('Yuca Hervida (boiled cassava)', NULL, 1, 'cup', 190, 2, 46, 0.3, 2),
('Yuca Frita (fried cassava)', NULL, 1, 'cup', 320, 2, 46, 16, 2),
('Batata / Boniato (boiled sweet potato)', NULL, 1, 'medium', 115, 2, 27, 0.1, 4),
('Guineo Verde Hervido (boiled green banana)', NULL, 2, 'pieces', 140, 2, 34, 0.4, 2),
('Plátano Hervido (boiled plantain)', NULL, 1, 'medium', 180, 2, 48, 0.2, 3),
('Ensalada de Coditos (macaroni salad)', NULL, 1, 'cup', 360, 8, 38, 20, 1),
('Ensalada de Papa (potato salad)', NULL, 1, 'cup', 280, 4, 28, 16, 2),

-- ─────────────────────────────────────────────────────────
-- PASTELÓN & PASTELES
-- ─────────────────────────────────────────────────────────
('Pastelón de Plátano Maduro', NULL, 1, 'slice', 340, 18, 36, 14, 2),
('Pasteles (pork)', NULL, 1, 'pastel', 320, 14, 38, 14, 3),
('Pasteles de Yuca', NULL, 1, 'pastel', 300, 12, 40, 12, 2),
('Lasagna Boricua', NULL, 1, 'slice', 380, 22, 32, 18, 2),

-- ─────────────────────────────────────────────────────────
-- DESAYUNO (Breakfast)
-- ─────────────────────────────────────────────────────────
('Huevos Revueltos con Jamón', NULL, 1, 'serving', 220, 16, 2, 16, 0),
('Tortilla de Huevo (Spanish omelette)', NULL, 1, 'serving', 280, 14, 22, 16, 1),
('Avena (oatmeal, Puerto Rican style)', NULL, 1, 'cup', 220, 6, 38, 5, 3),
('Majarete (corn pudding)', NULL, 1, 'cup', 260, 4, 44, 8, 1),
('Panqueques con Sirope', NULL, 3, 'pancakes', 420, 10, 62, 14, 2),

-- ─────────────────────────────────────────────────────────
-- PANADERÍA (Bakery)
-- ─────────────────────────────────────────────────────────
('Pan Sobao', NULL, 1, 'slice', 120, 3, 22, 2.5, 1),
('Pan de Agua', NULL, 1, 'roll', 140, 4, 28, 1, 1),
('Mallorca (sweet bread)', NULL, 1, 'piece', 280, 6, 42, 10, 1),
('Mallorca con Jamón y Queso', NULL, 1, 'sandwich', 420, 18, 44, 18, 1),
('Quesito (cream cheese pastry)', NULL, 1, 'piece', 260, 5, 30, 14, 0.5),
('Pastelillo de Guayaba', NULL, 1, 'piece', 220, 3, 28, 12, 1),
('Pastelillo de Guayaba y Queso', NULL, 1, 'piece', 260, 6, 30, 14, 1),
('Brazo Gitano (jelly roll cake)', NULL, 1, 'slice', 240, 3, 36, 10, 0),
('Bizcocho de Ron (rum cake)', NULL, 1, 'slice', 320, 4, 42, 16, 0),
('Mantecaditos (shortbread cookies)', NULL, 3, 'cookies', 210, 2, 24, 12, 0),
('Polvorón', NULL, 2, 'pieces', 180, 2, 22, 10, 0),

-- ─────────────────────────────────────────────────────────
-- POSTRES (Desserts)
-- ─────────────────────────────────────────────────────────
('Tembleque', NULL, 1, 'cup', 220, 2, 32, 10, 1),
('Flan de Queso', NULL, 1, 'slice', 280, 6, 38, 12, 0),
('Flan de Coco', NULL, 1, 'slice', 300, 5, 40, 14, 1),
('Tres Leches Cake', NULL, 1, 'slice', 350, 6, 48, 16, 0),
('Limber de Coco', NULL, 1, 'cup', 160, 2, 22, 8, 1),
('Limber de Parcha (passion fruit)', NULL, 1, 'cup', 120, 1, 28, 1, 1),
('Piragua (shaved ice with syrup)', NULL, 1, 'cup', 90, 0, 24, 0, 0),
('Dulce de Lechoza (papaya dessert)', NULL, 0.5, 'cup', 180, 1, 42, 2, 2),
('Arroz con Coco', NULL, 1, 'cup', 340, 4, 54, 12, 2),
('Besitos de Coco (coconut kisses)', NULL, 3, 'pieces', 180, 2, 24, 10, 2),

-- ─────────────────────────────────────────────────────────
-- BEBIDAS (Drinks)
-- ─────────────────────────────────────────────────────────
('Café con Leche', NULL, 1, 'cup', 80, 4, 8, 3, 0),
('Café Puya (espresso shot)', NULL, 1, 'shot', 5, 0.3, 0, 0, 0),
('Malta India', 'India', 355, 'ml', 230, 2, 52, 0, 0),
('Coquito', NULL, 4, 'oz', 280, 3, 20, 18, 1),
('Jugo de Parcha (passion fruit)', NULL, 240, 'ml', 130, 1, 32, 0.4, 0.5),
('Jugo de Guayaba (guava)', NULL, 240, 'ml', 140, 1, 34, 0.4, 4),
('Jugo de Acerola', NULL, 240, 'ml', 60, 1, 14, 0.2, 1),
('Morir Soñando', NULL, 240, 'ml', 180, 4, 30, 5, 0),
('Medalla Light (beer)', 'Medalla', 355, 'ml', 95, 0.7, 3.2, 0, 0),
('Piña Colada', NULL, 8, 'oz', 300, 1, 40, 14, 1),

-- ─────────────────────────────────────────────────────────
-- POLLO TROPICAL / LOCAL CHAINS
-- ─────────────────────────────────────────────────────────
('TropiChop (chicken, white rice, beans)', 'Pollo Tropical', 1, 'bowl', 540, 38, 60, 14, 5),
('Quarter Chicken (dark meat)', 'Pollo Tropical', 1, 'serving', 320, 30, 2, 22, 0),
('Quarter Chicken (white meat)', 'Pollo Tropical', 1, 'serving', 240, 34, 0, 12, 0),
('Moro Rice', 'Pollo Tropical', 1, 'cup', 260, 8, 42, 6, 3),
('Sweet Plantains', 'Pollo Tropical', 1, 'serving', 260, 1, 44, 10, 2),
('Chicken Quesadilla', 'Pollo Tropical', 1, 'quesadilla', 680, 38, 48, 36, 2),
('Pica Pollo (fried chicken, 2 pc)', NULL, 2, 'pieces', 420, 32, 18, 24, 0.5),
('Yaroa de Pollo (chicken loaded fries)', NULL, 1, 'serving', 680, 28, 52, 38, 3),

-- ─────────────────────────────────────────────────────────
-- DOMINICANO / CARIBBEAN CROSSOVER
-- ─────────────────────────────────────────────────────────
('Mangú (mashed plantain)', NULL, 1, 'cup', 220, 2, 50, 4, 3),
('Tres Golpes (mangú, huevo, salami, queso)', NULL, 1, 'plate', 520, 24, 52, 24, 3),
('Sancocho Dominicano (7 meats)', NULL, 1, 'bowl', 420, 30, 42, 16, 5),
('Chimichurri Burger (Dominican)', NULL, 1, 'sandwich', 580, 28, 42, 32, 2),
('Moro de Habichuelas Negras', NULL, 1, 'cup', 270, 10, 44, 5, 6),
('Moro de Gandules', NULL, 1, 'cup', 260, 9, 42, 6, 5),
('Pastelitos Dominicanos (chicken)', NULL, 1, 'piece', 240, 10, 26, 12, 1),
('Habichuela con Dulce', NULL, 1, 'cup', 320, 8, 54, 10, 6),
('Concón (crispy rice, Dominican)', NULL, 0.5, 'cup', 170, 2, 30, 5, 0.3),
('Chofán (Dominican fried rice)', NULL, 1, 'cup', 380, 14, 50, 14, 2),

-- ─────────────────────────────────────────────────────────
-- CUBAN & OTHER CARIBBEAN
-- ─────────────────────────────────────────────────────────
('Cubano Sandwich', NULL, 1, 'sandwich', 580, 34, 44, 28, 2),
('Ropa Vieja', NULL, 1, 'cup', 280, 30, 8, 14, 2),
('Vaca Frita', NULL, 1, 'serving', 320, 28, 4, 22, 0),
('Medianoche Sandwich', NULL, 1, 'sandwich', 520, 28, 48, 22, 1),
('Croquetas de Jamón (4)', NULL, 4, 'pieces', 240, 10, 20, 14, 0.5),
('Empanada de Carne', NULL, 1, 'piece', 260, 10, 26, 14, 1),
('Arepas de Queso', NULL, 1, 'piece', 220, 6, 28, 10, 1)

ON CONFLICT DO NOTHING;
