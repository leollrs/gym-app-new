import i18n from 'i18next';

/**
 * Returns the localized exercise name.
 * Uses `name_es` when the app language is Spanish and the field exists,
 * otherwise falls back to the default `name`.
 */
export const exName = (ex) =>
  i18n.language === 'es' && ex?.name_es ? ex.name_es : ex?.name;

export const exInstructions = (ex) =>
  i18n.language === 'es' && ex?.instructions_es ? ex.instructions_es : ex?.instructions;

// ── Routine / day name display-time translation ──────────────────────────────
// Translates English routine names stored in the DB to Spanish at render time.
const WORD_MAP_ES = {
  // Structure
  'Day':        'Día',
  'Workout':    'Entrenamiento',
  'Rest':       'Descanso',
  'Circuit':    'Circuito',
  'Meet Day':   'Día de Competición',
  // Splits
  'Push':       'Empuje',
  'Pull':       'Tirón',
  'Legs':       'Piernas',
  'Upper':      'Tren Superior',
  'Lower':      'Tren Inferior',
  'Full Body':  'Cuerpo Completo',
  'Upper Body': 'Tren Superior',
  'Lower Body': 'Tren Inferior',
  // Muscles
  'Chest':        'Pecho',
  'Back':         'Espalda',
  'Shoulders':    'Hombros',
  'Arms':         'Brazos',
  'Glutes':       'Glúteos',
  'Hamstrings':   'Isquiotibiales',
  'Quads':        'Cuádriceps',
  'Core':         'Core',
  'Rear Delts':   'Deltoides Posterior',
  // Modifiers
  'Heavy':        'Pesado',
  'Light':        'Ligero',
  'Volume':       'Volumen',
  'Power':        'Fuerza',
  'Hypertrophy':  'Hipertrofia',
  'Deload':       'Descarga',
  'Peak':         'Pico',
  'Pump':         'Bombeo',
  'Focus':        'Enfoque',
  'Single Leg':   'Unilateral',
  'Accessories':  'Accesorios',
  'Light Accessories': 'Accesorios Ligeros',
  'Light Movement':    'Movimiento Ligero',
  'Openers Only':      'Solo Aperturas',
  'Openers':           'Aperturas',
  // Compound terms
  'Quad & Glute':      'Cuádriceps y Glúteos',
  'Hamstring & Glute': 'Isquiotibiales y Glúteos',
  'Glute & Quad Focus':      'Enfoque Glúteos y Cuádriceps',
  'Hamstring & Glute Focus':  'Enfoque Isquiotibiales y Glúteos',
  'Push & Shoulders':  'Empuje y Hombros',
  'Pull & Arms':       'Tirón y Brazos',
  // Exercise names in day titles
  'Bench':       'Press Banca',
  'Squat':       'Sentadilla',
  'Deadlift':    'Peso Muerto',
  'OHP':         'Press Militar',
  'Front Squat': 'Sentadilla Frontal',
  'Sumo DL':     'Peso Muerto Sumo',
  'Incline Bench': 'Press Inclinado',
};

// Sort keys by length (longest first) so multi-word terms match before single words
const SORTED_KEYS = Object.keys(WORD_MAP_ES).sort((a, b) => b.length - a.length);

/**
 * Translate a routine name for display. Works on names stored in DB (English)
 * and returns Spanish when the app language is 'es'.
 * Strips the "Auto: " prefix if present.
 */
export const localizeRoutineName = (name) => {
  if (!name) return '';
  // Strip Auto: prefix
  let display = name.replace(/^Auto:\s*/, '');
  if (i18n.language !== 'es') return display;

  // Replace known terms (longest-first to avoid partial matches)
  for (const key of SORTED_KEYS) {
    if (display.includes(key)) {
      display = display.split(key).join(WORD_MAP_ES[key]);
    }
  }
  return display;
};
