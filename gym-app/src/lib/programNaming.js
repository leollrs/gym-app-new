// Creative program + routine names.
//
// Each pool entry is a PAIR: { en, es }. We persist the EN string as the
// canonical name (so DB filters like `name.startsWith('Auto:')` keep
// working and we don't need a migration to add `name_es` columns) and
// translate at render time via `translateCreativeName`. That way the user
// switches locale and the program/routine instantly reads in the new
// language without rewriting the DB.

import i18n from 'i18next';

// ── PROGRAM NAME POOLS ──────────────────────────────────────────────────
// Indexed by [splitType][goal]. Each entry is [enName, esName].

const PROGRAM_NAMES = {
  full_body: {
    muscle_gain: [
      ['Mass Code',        'Código Masa'],
      ['Apex Build',       'Construcción Apex'],
      ['Iron Origin',      'Origen Hierro'],
      ['Forge Mode',       'Modo Forja'],
      ['Volume Surge',     'Oleada Volumen'],
      ['Hypertrophy Spark','Chispa Hipertrofia'],
      ['Crown Build',      'Construcción Corona'],
    ],
    fat_loss: [
      ['Lean Engine',  'Motor Definición'],
      ['Burn Stack',   'Pila Quema'],
      ['Furnace Mode', 'Modo Fundidora'],
      ['Cut Cycle',    'Ciclo Marca'],
      ['Shred Origin', 'Origen Shred'],
      ['Carve Mode',   'Modo Cincelar'],
    ],
    strength: [
      ['Iron Doctrine',    'Doctrina Hierro'],
      ['Foundation Force', 'Cimiento Fuerza'],
      ['Steel Origin',     'Origen Acero'],
      ['Heavy Code',       'Código Pesado'],
      ['Power Anchor',     'Ancla Poder'],
    ],
    endurance: [
      ['Engine Origin', 'Origen Motor'],
      ['Stamina Stack', 'Pila Aguante'],
      ['Cardio Code',   'Código Cardio'],
      ['Vital Loop',    'Bucle Vital'],
    ],
    general_fitness: [
      ['Daily Forge',  'Forja Diaria'],
      ['Foundation 12','Cimiento 12'],
      ['Habit Hammer', 'Martillo Hábito'],
      ['Routine Reset','Reset Rutina'],
      ['Apex Daily',   'Apex Diario'],
    ],
  },
  ppl: {
    muscle_gain: [
      ['Pump Protocol',    'Protocolo Pump'],
      ['Volume Vault',     'Bóveda Volumen'],
      ['Mass Atlas',       'Atlas Masa'],
      ['Hypertrophy Loop', 'Bucle Hipertrofia'],
      ['Triple Wave',      'Triple Onda'],
      ['Iron Triad',       'Tríada Hierro'],
    ],
    fat_loss: [
      ['Lean Loop',      'Bucle Definición'],
      ['Cut Cycle',      'Ciclo Marca'],
      ['Burn Rotation',  'Rotación Quema'],
      ['Shred Sequence', 'Secuencia Shred'],
      ['Furnace Triad',  'Tríada Fundidora'],
    ],
    strength: [
      ['Force Cycle',    'Ciclo Fuerza'],
      ['Heavy Doctrine', 'Doctrina Pesada'],
      ['Power Loop',     'Bucle Poder'],
      ['Triad Force',    'Tríada Acero'],
    ],
    endurance: [
      ['Engine Cycle', 'Ciclo Motor'],
      ['Stamina Loop', 'Bucle Aguante'],
      ['Triad Engine', 'Tríada Vital'],
    ],
    general_fitness: [
      ['Apex Cycle',  'Ciclo Apex'],
      ['Build Loop',  'Bucle Construir'],
      ['Daily Drive', 'Impulso Diario'],
      ['Triad Reset', 'Reset Tríada'],
    ],
  },
  upper_lower: {
    muscle_gain: [
      ['Iron Architect',  'Arquitecto Hierro'],
      ['Mass Code',       'Código Masa'],
      ['Hypertrophy Lab', 'Laboratorio Hipertrofia'],
      ['Build Mode 12',   'Modo Construcción 12'],
      ['Vertical Mass',   'Masa Vertical'],
      ['Twin Forge',      'Doble Forja'],
    ],
    fat_loss: [
      ['Lean Frame', 'Marco Definición'],
      ['Cut Engine', 'Motor Marca'],
      ['Shred Stack','Pila Shred'],
      ['Burn Frame', 'Marco Quema'],
      ['Carve Two',  'Doble Cincel'],
    ],
    strength: [
      // No "Twin Tower" — keep it out of the pool entirely.
      ['Power Frame',      'Marco Poder'],
      ['Iron Doctrine',    'Doctrina Hierro'],
      ['Steel Spine',      'Columna Acero'],
      ['Foundation Force', 'Cimiento Fuerza'],
      ['Granite Doctrine', 'Doctrina Granito'],
    ],
    endurance: [
      ['Engine Build', 'Motor Construir'],
      ['Stamina Stack','Pila Aguante'],
      ['Twin Engine',  'Motor Gemelo'],
    ],
    general_fitness: [
      ['Apex Build',     'Construcción Apex'],
      ['Forge Forward',  'Forja Adelante'],
      ['Foundation Code','Código Cimiento'],
      ['Daily Twin',     'Gemelo Diario'],
    ],
  },
  ppl_extended: {
    muscle_gain: [
      ['Mass Atlas',       'Atlas Masa'],
      ['Volume Reactor',   'Reactor Volumen'],
      ['Pump Protocol 5',  'Protocolo Pump 5'],
      ['Hyper Five',       'Hiper Cinco'],
      ['Iron Reactor',     'Reactor Hierro'],
    ],
    fat_loss: [
      ['Shred Reactor', 'Reactor Shred'],
      ['Burn Atlas',    'Atlas Quema'],
      ['Cut Engine 5',  'Motor Marca 5'],
      ['Furnace Five',  'Fundidora Cinco'],
    ],
    strength: [
      ['Force Reactor', 'Reactor Fuerza'],
      ['Heavy Atlas',   'Atlas Pesado'],
      ['Five Force',    'Cinco Fuerza'],
    ],
    endurance: [
      ['Engine Reactor','Reactor Motor'],
      ['Cardio Atlas',  'Atlas Cardio'],
      ['Vital Five',    'Vital Cinco'],
    ],
    general_fitness: [
      ['Apex Atlas',    'Atlas Apex'],
      ['Forge 5',       'Forja 5'],
      ['Daily Reactor', 'Reactor Diario'],
      ['Builder Five',  'Constructor Cinco'],
    ],
  },
  ppl_double: {
    muscle_gain: [
      ['Mass Reactor',      'Reactor Masa'],
      ['Volume Vortex',     'Vórtice Volumen'],
      ['Hypertrophy Engine','Motor Hipertrofia'],
      ['Iron Vault 6',      'Bóveda Hierro 6'],
      ['Six Wave',          'Onda Seis'],
    ],
    fat_loss: [
      ['Burn Vortex',  'Vórtice Quema'],
      ['Shred Engine', 'Motor Shred'],
      ['Furnace 6',    'Fundidora 6'],
      ['Cut Cyclone',  'Ciclón Marca'],
    ],
    strength: [
      ['Force Vortex', 'Vórtice Fuerza'],
      ['Heavy Engine', 'Motor Pesado'],
      ['Steel Vault',  'Bóveda Acero'],
      ['Six Force',    'Seis Fuerza'],
    ],
    endurance: [
      ['Engine Vortex','Vórtice Motor'],
      ['Cardio Vault', 'Bóveda Cardio'],
      ['Six Vital',    'Seis Vital'],
    ],
    general_fitness: [
      ['Apex Vortex', 'Vórtice Apex'],
      ['Daily Vortex','Vórtice Diario'],
      ['Forge 6',     'Forja 6'],
      ['Builder Six', 'Constructor Seis'],
    ],
  },
};

// ── ROUTINE NAME POOLS ─────────────────────────────────────────────────

const ROUTINE_NAMES = {
  upper: [
    ['Apex Build',     'Construcción Apex'],
    ['Iron Frame',     'Marco Hierro'],
    ['Crown Forge',    'Forja Corona'],
    ['Titan Stack',    'Pila Titán'],
    ['Anvil Day',      'Día Yunque'],
    ['Vault Press',    'Bóveda Press'],
    ['Hammer Frame',   'Marco Martillo'],
    ['Phoenix Build',  'Construcción Fénix'],
    ['Skyline Forge',  'Forja Horizonte'],
    ['Aurora Press',   'Aurora Press'],
  ],
  lower: [
    ['Pillar Day',       'Día Pilar'],
    ['Quake Day',        'Día Sismo'],
    ['Granite Lift',     'Día Granito'],
    ['Foundation Drive', 'Día Cimiento'],
    ['Bedrock Day',      'Día Roca Madre'],
    ['Atlas Lift',       'Día Atlas'],
    ['Thunder Day',      'Día Trueno'],
    ['Mantle Lift',      'Día Manto'],
    ['Tectonic Day',     'Día Tectónico'],
    ['Bison Drive',      'Día Bisonte'],
  ],
  push: [
    ['Strike Day',  'Día Embate'],
    ['Cannon Push', 'Empuje Cañón'],
    ['Eruption Day','Día Erupción'],
    ['Forge Push',  'Empuje Forja'],
    ['Comet Push',  'Empuje Cometa'],
    ['Volt Push',   'Empuje Voltio'],
    ['Apex Push',   'Empuje Apex'],
    ['Titan Push',  'Empuje Titán'],
    ['Surge Push',  'Empuje Oleada'],
    ['Vector Push', 'Empuje Vector'],
  ],
  pull: [
    ['Reaper Pull','Tirón Garra'],
    ['Anchor Day', 'Día Ancla'],
    ['Magnet Day', 'Día Imán'],
    ['Iron Pull',  'Tirón Hierro'],
    ['Vortex Pull','Tirón Vórtice'],
    ['Talon Pull', 'Tirón Talón'],
    ['Atlas Pull', 'Tirón Atlas'],
    ['Hook Day',   'Día Gancho'],
    ['Apex Pull',  'Tirón Apex'],
    ['Cable Pull', 'Tirón Cable'],
  ],
  legs: [
    ['Pillar Day',    'Día Pilar'],
    ['Quake Day',     'Día Sismo'],
    ['Foundation Day','Día Cimiento'],
    ['Granite Day',   'Día Granito'],
    ['Atlas Legs',    'Atlas Piernas'],
    ['Thunder Legs',  'Trueno Piernas'],
    ['Mantle Day',    'Día Manto'],
    ['Rider Day',     'Día Jinete'],
    ['Bedrock Legs',  'Roca Piernas'],
    ['Sprinter Day',  'Día Velocista'],
  ],
  full_body: [
    ['Total Forge',  'Forja Total'],
    ['Whole Wake',   'Despertar Total'],
    ['Genesis Day',  'Día Génesis'],
    ['Apex Total',   'Apex Total'],
    ['Vortex Day',   'Día Vórtice'],
    ['Atlas Day',    'Día Atlas'],
    ['Phoenix Day',  'Día Fénix'],
    ['Compound Day', 'Día Compuesto'],
    ['Reactor Day',  'Día Reactor'],
    ['Storm Day',    'Día Tormenta'],
  ],
};

// ── EN → ES translation map (built once from the pools above) ───────────

const TRANSLATION_MAP = (() => {
  const map = new Map();
  for (const split of Object.values(PROGRAM_NAMES)) {
    for (const goal of Object.values(split)) {
      for (const [en, es] of goal) map.set(en, es);
    }
  }
  for (const slot of Object.values(ROUTINE_NAMES)) {
    for (const [en, es] of slot) map.set(en, es);
  }
  return map;
})();

const isSpanish = () => (i18n.language || '').startsWith('es');

// Names we shipped at some point that should never appear again — rewrite
// them at render time so existing user rows from prior generations get a
// non-offensive substitute without needing a DB migration.
const RENAME_OVERRIDES = {
  'Twin Tower': 'Twin Forge',
};

// Translate a creative name (program display_name or routine slug) to the
// active locale. If the EN name has no matching ES entry (legacy or custom
// names), returns the original.
export function translateCreativeName(englishName) {
  if (!englishName) return englishName;
  const safe = RENAME_OVERRIDES[englishName] || englishName;
  if (!isSpanish()) return safe;
  return TRANSLATION_MAP.get(safe) || safe;
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Deterministic shuffle keyed by a numeric seed. Same seed → same order, so
// callers that re-call `generateRoutineName(slot, idx, seed)` with the same
// seed for every routine in a program get a stable per-routine assignment
// while different seeds rotate the whole pool.
function shuffleWithSeed(arr, seed) {
  const a = [...arr];
  let s = (Number(seed) || 1) | 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Generate the EN canonical program name. Caller stores this in
// schedule_map.display_name; the display path translates at render time.
export function generateProgramName(splitType, goal, excludeEnglishNames = []) {
  const splitPool = PROGRAM_NAMES[splitType] || PROGRAM_NAMES.upper_lower;
  const pool = splitPool[goal] || splitPool.general_fitness;

  const used = new Set((excludeEnglishNames || []).map((n) => (n || '').trim().toLowerCase()));
  const available = pool.filter(([en]) => !used.has(en.toLowerCase()));
  if (available.length > 0) return pickRandom(available)[0];

  // Pool exhausted — suffix a numeric variant.
  const base = pickRandom(pool)?.[0] || 'Custom Build';
  for (let i = 2; i < 99; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

// Generate the EN canonical routine name. Deterministic per
// (slotsKey, variantIndex, seed): a fresh seed shuffles the pool so each
// regenerate produces different names, but the same seed across the whole
// program keeps the assignment stable (so DB insert and any consumer that
// re-derives the name from the same generator output match exactly).
export function generateRoutineName(slotsKey, variantIndex = 0, seed = 0) {
  const pool = ROUTINE_NAMES[slotsKey] || ROUTINE_NAMES.upper;
  const shuffled = seed ? shuffleWithSeed(pool, seed) : pool;
  return shuffled[variantIndex % shuffled.length][0];
}
