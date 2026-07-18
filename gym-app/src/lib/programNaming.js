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
      ['Bulk Forge',       'Forja Volumen'],
      ['Titan Frame',      'Marco Titán'],
      ['Mass Engine',      'Motor Masa'],
      ['Growth Code',      'Código Crecimiento'],
    ],
    fat_loss: [
      ['Lean Engine',  'Motor Definición'],
      ['Burn Stack',   'Pila Quema'],
      ['Furnace Mode', 'Modo Fundidora'],
      ['Cut Cycle',    'Ciclo Marca'],
      ['Shred Origin', 'Origen Shred'],
      ['Carve Mode',   'Modo Cincelar'],
      ['Ember Cut',    'Corte Brasa'],
      ['Lean Forge',   'Forja Definición'],
      ['Torch Mode',   'Modo Antorcha'],
      ['Ash Cycle',    'Ciclo Ceniza'],
    ],
    strength: [
      ['Iron Doctrine',    'Doctrina Hierro'],
      ['Foundation Force', 'Cimiento Fuerza'],
      ['Steel Origin',     'Origen Acero'],
      ['Heavy Code',       'Código Pesado'],
      ['Power Anchor',     'Ancla Poder'],
      ['Bedrock Force',    'Fuerza Roca'],
      ['Titan Doctrine',   'Doctrina Titán'],
      ['Iron Spine',       'Columna Hierro'],
      ['Granite Force',    'Fuerza Granito'],
    ],
    endurance: [
      ['Engine Origin', 'Origen Motor'],
      ['Stamina Stack', 'Pila Aguante'],
      ['Cardio Code',   'Código Cardio'],
      ['Vital Loop',    'Bucle Vital'],
      ['Pulse Engine',  'Motor Pulso'],
      ['Tempo Code',    'Código Tempo'],
      ['Marathon Mode', 'Modo Maratón'],
      ['Relentless Loop','Bucle Incansable'],
    ],
    general_fitness: [
      ['Daily Forge',  'Forja Diaria'],
      ['Foundation 12','Cimiento 12'],
      ['Habit Hammer', 'Martillo Hábito'],
      ['Routine Reset','Reset Rutina'],
      ['Apex Daily',   'Apex Diario'],
      ['Everyday Forge','Forja Cotidiana'],
      ['Baseline Build','Construcción Base'],
      ['Momentum 12',  'Ímpetu 12'],
      ['Vital Code',   'Código Vital'],
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
      ['Triad Mass',       'Masa Tríada'],
      ['Split Surge',      'Oleada Split'],
      ['Pump Reactor',     'Reactor Pump'],
      ['Volume Triad',     'Tríada Volumen'],
    ],
    fat_loss: [
      ['Lean Loop',      'Bucle Definición'],
      ['Cut Cycle',      'Ciclo Marca'],
      ['Burn Rotation',  'Rotación Quema'],
      ['Shred Sequence', 'Secuencia Shred'],
      ['Furnace Triad',  'Tríada Fundidora'],
      ['Triad Cut',      'Corte Tríada'],
      ['Lean Rotation',  'Rotación Definición'],
      ['Ember Split',    'Split Brasa'],
      ['Shred Triad',    'Tríada Shred'],
    ],
    strength: [
      ['Force Cycle',    'Ciclo Fuerza'],
      ['Heavy Doctrine', 'Doctrina Pesada'],
      ['Power Loop',     'Bucle Poder'],
      ['Triad Force',    'Tríada Acero'],
      ['Triad Iron',     'Hierro Tríada'],
      ['Heavy Rotation', 'Rotación Pesada'],
      ['Force Triad',    'Tríada Fuerza'],
      ['Steel Split',    'Split Acero'],
    ],
    endurance: [
      ['Engine Cycle', 'Ciclo Motor'],
      ['Stamina Loop', 'Bucle Aguante'],
      ['Triad Engine', 'Tríada Vital'],
      ['Triad Pulse',  'Pulso Tríada'],
      ['Rotation Engine','Motor Rotación'],
      ['Tempo Triad',  'Tríada Tempo'],
      ['Relentless Split','Split Incansable'],
    ],
    general_fitness: [
      ['Apex Cycle',  'Ciclo Apex'],
      ['Build Loop',  'Bucle Construir'],
      ['Daily Drive', 'Impulso Diario'],
      ['Triad Reset', 'Reset Tríada'],
      ['Triad Habit', 'Hábito Tríada'],
      ['Split Reset', 'Reset Split'],
      ['Daily Triad', 'Tríada Diaria'],
      ['Momentum Split','Split Ímpetu'],
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
      ['Twin Mass',       'Masa Gemela'],
      ['Split Forge',     'Forja Split'],
      ['Dual Reactor',    'Reactor Dual'],
      ['Growth Frame',    'Marco Crecimiento'],
    ],
    fat_loss: [
      ['Lean Frame', 'Marco Definición'],
      ['Cut Engine', 'Motor Marca'],
      ['Shred Stack','Pila Shred'],
      ['Burn Frame', 'Marco Quema'],
      ['Carve Two',  'Doble Cincel'],
      ['Twin Cut',   'Corte Gemelo'],
      ['Dual Ember', 'Brasa Dual'],
      ['Lean Split', 'Split Definición'],
      ['Carve Frame','Marco Cincel'],
    ],
    strength: [
      // No "Twin Tower" — keep it out of the pool entirely.
      ['Power Frame',      'Marco Poder'],
      ['Iron Doctrine',    'Doctrina Hierro'],
      ['Steel Spine',      'Columna Acero'],
      ['Foundation Force', 'Cimiento Fuerza'],
      ['Granite Doctrine', 'Doctrina Granito'],
      ['Twin Force',       'Fuerza Gemela'],
      ['Dual Iron',        'Hierro Dual'],
      ['Granite Frame',    'Marco Granito'],
      ['Steel Twin',       'Gemelo Acero'],
    ],
    endurance: [
      ['Engine Build', 'Motor Construir'],
      ['Stamina Stack','Pila Aguante'],
      ['Twin Engine',  'Motor Gemelo'],
      ['Twin Pulse',   'Pulso Gemelo'],
      ['Dual Engine',  'Motor Dual'],
      ['Tempo Twin',   'Gemelo Tempo'],
      ['Relentless Frame','Marco Incansable'],
    ],
    general_fitness: [
      ['Apex Build',     'Construcción Apex'],
      ['Forge Forward',  'Forja Adelante'],
      ['Foundation Code','Código Cimiento'],
      ['Daily Twin',     'Gemelo Diario'],
      ['Twin Habit',     'Hábito Gemelo'],
      ['Dual Reset',     'Reset Dual'],
      ['Balanced Build', 'Construcción Balance'],
      ['Momentum Twin',  'Gemelo Ímpetu'],
    ],
  },
  ppl_extended: {
    muscle_gain: [
      ['Mass Atlas',       'Atlas Masa'],
      ['Volume Reactor',   'Reactor Volumen'],
      ['Pump Protocol 5',  'Protocolo Pump 5'],
      ['Hyper Five',       'Hiper Cinco'],
      ['Iron Reactor',     'Reactor Hierro'],
      ['Five Mass',        'Masa Cinco'],
      ['Volume Penta',     'Penta Volumen'],
      ['Growth Reactor',   'Reactor Crecimiento'],
      ['Hyper Split',      'Split Híper'],
    ],
    fat_loss: [
      ['Shred Reactor', 'Reactor Shred'],
      ['Burn Atlas',    'Atlas Quema'],
      ['Cut Engine 5',  'Motor Marca 5'],
      ['Furnace Five',  'Fundidora Cinco'],
      ['Five Cut',      'Corte Cinco'],
      ['Penta Shred',   'Penta Shred'],
      ['Ember Five',    'Cinco Brasa'],
      ['Lean Penta',    'Penta Definición'],
    ],
    strength: [
      ['Force Reactor', 'Reactor Fuerza'],
      ['Heavy Atlas',   'Atlas Pesado'],
      ['Five Force',    'Cinco Fuerza'],
      ['Five Iron',     'Hierro Cinco'],
      ['Penta Force',   'Penta Fuerza'],
      ['Heavy Five',    'Cinco Pesado'],
      ['Steel Penta',   'Penta Acero'],
    ],
    endurance: [
      ['Engine Reactor','Reactor Motor'],
      ['Cardio Atlas',  'Atlas Cardio'],
      ['Vital Five',    'Vital Cinco'],
      ['Five Pulse',    'Pulso Cinco'],
      ['Penta Engine',  'Motor Penta'],
      ['Tempo Five',    'Cinco Tempo'],
      ['Relentless Penta','Penta Incansable'],
    ],
    general_fitness: [
      ['Apex Atlas',    'Atlas Apex'],
      ['Forge 5',       'Forja 5'],
      ['Daily Reactor', 'Reactor Diario'],
      ['Builder Five',  'Constructor Cinco'],
      ['Five Habit',    'Hábito Cinco'],
      ['Penta Reset',   'Reset Penta'],
      ['Daily Five',    'Cinco Diario'],
      ['Momentum Penta','Penta Ímpetu'],
    ],
  },
  ppl_double: {
    muscle_gain: [
      ['Mass Reactor',      'Reactor Masa'],
      ['Volume Vortex',     'Vórtice Volumen'],
      ['Hypertrophy Engine','Motor Hipertrofia'],
      ['Iron Vault 6',      'Bóveda Hierro 6'],
      ['Six Wave',          'Onda Seis'],
      ['Six Mass',          'Masa Seis'],
      ['Volume Hexa',       'Hexa Volumen'],
      ['Growth Cyclone',    'Ciclón Crecimiento'],
      ['Hyper Six',         'Seis Híper'],
    ],
    fat_loss: [
      ['Burn Vortex',  'Vórtice Quema'],
      ['Shred Engine', 'Motor Shred'],
      ['Furnace 6',    'Fundidora 6'],
      ['Cut Cyclone',  'Ciclón Marca'],
      ['Six Cut',      'Corte Seis'],
      ['Hexa Shred',   'Hexa Shred'],
      ['Ember Six',    'Seis Brasa'],
      ['Lean Hexa',    'Hexa Definición'],
    ],
    strength: [
      ['Force Vortex', 'Vórtice Fuerza'],
      ['Heavy Engine', 'Motor Pesado'],
      ['Steel Vault',  'Bóveda Acero'],
      ['Six Force',    'Seis Fuerza'],
      ['Six Iron',     'Hierro Seis'],
      ['Hexa Force',   'Hexa Fuerza'],
      ['Heavy Six',    'Seis Pesado'],
      ['Steel Hexa',   'Hexa Acero'],
    ],
    endurance: [
      ['Engine Vortex','Vórtice Motor'],
      ['Cardio Vault', 'Bóveda Cardio'],
      ['Six Vital',    'Seis Vital'],
      ['Six Pulse',    'Pulso Seis'],
      ['Hexa Engine',  'Motor Hexa'],
      ['Tempo Six',    'Seis Tempo'],
      ['Relentless Hexa','Hexa Incansable'],
    ],
    general_fitness: [
      ['Apex Vortex', 'Vórtice Apex'],
      ['Daily Vortex','Vórtice Diario'],
      ['Forge 6',     'Forja 6'],
      ['Builder Six', 'Constructor Seis'],
      ['Six Habit',   'Hábito Seis'],
      ['Hexa Reset',  'Reset Hexa'],
      ['Daily Six',   'Seis Diario'],
      ['Momentum Hexa','Hexa Ímpetu'],
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
    ['Summit Press',   'Press Cumbre'],
    ['Iron Crown',     'Corona Hierro'],
    ['Steel Canvas',   'Lienzo Acero'],
    ['Overhead Empire','Imperio Vertical'],
    ['Colossus Day',   'Día Coloso'],
    ['Vanguard Press', 'Press Vanguardia'],
    ['Monarch Build',  'Construcción Monarca'],
    ['Kraken Press',   'Press Kraken'],
    ['Halo Forge',     'Forja Halo'],
    ['Meridian Press', 'Press Meridiano'],
    ['Zenith Frame',   'Marco Cénit'],
    ['Cobalt Press',   'Press Cobalto'],
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
    ['Fault Line',       'Línea de Falla'],
    ['Richter Day',      'Día Richter'],
    ['Titan Base',       'Base Titán'],
    ['Iron Roots',       'Raíces Hierro'],
    ['Gravity Well',     'Pozo Gravedad'],
    ['Magma Day',        'Día Magma'],
    ['Basalt Day',       'Día Basalto'],
    ['Summit Base',      'Base Cumbre'],
    ['Colossus Base',    'Base Coloso'],
    ['Anchor Legs',      'Piernas Ancla'],
    ['Terra Drive',      'Día Terra'],
    ['Boulder Day',      'Día Peñasco'],
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
    ['Blast Push',    'Empuje Explosión'],
    ['Ignition Day',  'Día Ignición'],
    ['Piston Push',   'Empuje Pistón'],
    ['Havoc Push',    'Empuje Caos'],
    ['Nova Push',     'Empuje Nova'],
    ['Ballistic Day', 'Día Balístico'],
    ['Momentum Push', 'Empuje Ímpetu'],
    ['Torque Push',   'Empuje Torque'],
    ['Overdrive Push','Empuje Turbo'],
    ['Thruster Day',  'Día Propulsor'],
    ['Rocket Push',   'Empuje Cohete'],
    ['Prime Push',    'Empuje Primo'],
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
    ['Grip Day',      'Día Agarre'],
    ['Winch Pull',    'Tirón Torno'],
    ['Raptor Pull',   'Tirón Raptor'],
    ['Gravity Pull',  'Tirón Gravedad'],
    ['Undertow Day',  'Día Resaca'],
    ['Harpoon Pull',  'Tirón Arpón'],
    ['Titan Pull',    'Tirón Titán'],
    ['Vice Pull',     'Tirón Prensa'],
    ['Ironclad Pull', 'Tirón Acorazado'],
    ['Riptide Day',   'Día Corriente'],
    ['Summit Pull',   'Tirón Cumbre'],
    ['Anchor Haul',   'Arrastre Ancla'],
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
    ['Piston Legs',   'Piernas Pistón'],
    ['Titan Legs',    'Piernas Titán'],
    ['Fault Legs',    'Piernas Falla'],
    ['Gravity Legs',  'Piernas Gravedad'],
    ['Colossus Legs', 'Piernas Coloso'],
    ['Wheel Day',     'Día Ruedas'],
    ['Iron Legs',     'Piernas Hierro'],
    ['Boulder Legs',  'Piernas Peñasco'],
    ['Stampede Day',  'Día Estampida'],
    ['Terra Legs',    'Piernas Terra'],
    ['Richter Legs',  'Piernas Richter'],
    ['Summit Legs',   'Piernas Cumbre'],
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
    ['Prime Day',      'Día Primo'],
    ['Full Circuit',   'Circuito Total'],
    ['Titan Total',    'Titán Total'],
    ['Complete Day',   'Día Completo'],
    ['Ignition Total', 'Ignición Total'],
    ['Momentum Day',   'Día Ímpetu'],
    ['Catalyst Day',   'Día Catalizador'],
    ['Fusion Day',     'Día Fusión'],
    ['Complete Forge', 'Forja Completa'],
    ['Odyssey Day',    'Día Odisea'],
    ['Summit Total',   'Cumbre Total'],
    ['Nova Day',       'Día Nova'],
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
