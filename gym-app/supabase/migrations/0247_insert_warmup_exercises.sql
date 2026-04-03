-- Add 'Warm-Up' to the muscle_group enum if it exists as an enum type
DO $$
BEGIN
  ALTER TYPE muscle_group ADD VALUE IF NOT EXISTS 'Warm-Up';
EXCEPTION WHEN others THEN
  -- muscle_group might be TEXT, not an enum — that's fine
  NULL;
END $$;

-- Insert warm-up exercises into the exercises table
-- These match the IDs in the local exercise library (exercises.js)
INSERT INTO exercises (id, name, name_es, muscle_group, equipment, category, instructions, instructions_es)
VALUES
  ('ex_wu_jj',   'Jumping Jacks',           'Saltos de tijera',       'Warm-Up', 'Bodyweight', 'Mobility', 'Stand feet together. Jump feet apart while raising arms overhead. Jump back. Maintain rhythm.', 'De pie con los pies juntos. Salta separando los pies mientras subes los brazos. Vuelve a la posición inicial.'),
  ('ex_wu_ac',   'Arm Circles',             'Círculos de brazos',     'Warm-Up', 'Bodyweight', 'Mobility', 'Extend arms to sides. Make small circles, gradually increasing size. Reverse direction halfway.', 'Extiende los brazos a los lados. Haz círculos pequeños, aumentando gradualmente. Cambia dirección a mitad.'),
  ('ex_wu_ls',   'Leg Swings',              'Balanceo de piernas',    'Warm-Up', 'Bodyweight', 'Mobility', 'Hold a wall for balance. Swing one leg forward and back in a controlled arc. Switch legs halfway.', 'Apóyate en la pared. Balancea una pierna hacia adelante y atrás. Cambia de pierna a mitad.'),
  ('ex_wu_hc',   'Hip Circles',             'Círculos de cadera',     'Warm-Up', 'Bodyweight', 'Mobility', 'Stand with hands on hips. Rotate hips in large circles. Switch direction halfway.', 'De pie con las manos en la cadera. Rota las caderas en círculos amplios. Cambia dirección a mitad.'),
  ('ex_wu_lc',   'Light Cardio (Jump Rope)', 'Cardio ligero (Cuerda)', 'Warm-Up', 'Bodyweight', 'Mobility', 'Jump rope or jog in place at an easy pace. Focus on warming up your entire body and raising heart rate.', 'Salta la cuerda o trota en el lugar a un ritmo fácil. Enfócate en calentar todo el cuerpo.'),
  ('ex_wu_hw',   'High Knees',              'Rodillas altas',         'Warm-Up', 'Bodyweight', 'Mobility', 'Run in place, driving knees up to hip height. Pump arms. Keep core engaged.', 'Corre en el lugar, llevando las rodillas a la altura de la cadera. Mueve los brazos. Mantén el core activado.'),
  ('ex_wu_bk',   'Butt Kicks',              'Patadas al glúteo',      'Warm-Up', 'Bodyweight', 'Mobility', 'Jog in place, kicking heels up to glutes. Keep upper body upright and arms pumping.', 'Trota en el lugar, llevando los talones a los glúteos. Mantén el torso erguido.'),
  ('ex_wu_iw',   'Inchworm',                'Gusano',                 'Warm-Up', 'Bodyweight', 'Mobility', 'Stand, hinge at hips, walk hands out to plank. Do a push-up (optional). Walk hands back, stand up.', 'De pie, inclínate, camina con las manos hasta plancha. Haz una flexión (opcional). Regresa caminando.'),
  ('ex_wu_wls',  'Walking Lunges',          'Zancadas caminando',     'Warm-Up', 'Bodyweight', 'Mobility', 'Step forward into a lunge, knee tracking over ankle. Push off front foot to step forward into next lunge.', 'Da un paso adelante en zancada, rodilla sobre el tobillo. Empuja para avanzar a la siguiente zancada.'),
  ('ex_wu_trot', 'Torso Rotations',         'Rotaciones de torso',    'Warm-Up', 'Bodyweight', 'Mobility', 'Stand with arms extended. Rotate torso left and right, keeping hips stable. Controlled pace.', 'De pie con brazos extendidos. Rota el torso a izquierda y derecha, manteniendo las caderas estables.')
ON CONFLICT (id) DO NOTHING;
