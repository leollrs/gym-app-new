// Equipment stations — the "scan a machine → what can I do here" taxonomy.
// HYBRID granularity: machine-level for distinct machines, area-level for free weights.
// `stationFor(exercise)` mirrors migration 0622's server-side assignment exactly, so
// the DB `exercises.station` column and this client util stay in sync. Sports/activities
// return null (not scannable equipment). Reference list is tiny (36 rows) — safe to bundle.

export const STATION_GROUPS = [
  { key: 'free_weights', label: 'Free Weights', label_es: 'Pesos Libres' },
  { key: 'cables',       label: 'Cables',       label_es: 'Poleas' },
  { key: 'machines',     label: 'Machines',     label_es: 'Máquinas' },
  { key: 'bodyweight',   label: 'Bodyweight & Functional', label_es: 'Peso Corporal y Funcional' },
  { key: 'cardio',       label: 'Cardio',       label_es: 'Cardio' },
];

export const STATIONS = [
  // Free weights
  { slug: 'dumbbell-area',   name: 'Dumbbell Area',   name_es: 'Zona de Mancuernas',   group: 'free_weights', emoji: '🏋️' },
  { slug: 'barbell-platform',name: 'Barbell Platform',name_es: 'Plataforma de Barra',  group: 'free_weights', emoji: '🏋️' },
  { slug: 'squat-rack',      name: 'Squat Rack',      name_es: 'Rack de Sentadillas',  group: 'free_weights', emoji: '🔲' },
  { slug: 'bench-press',     name: 'Bench Press',     name_es: 'Banco de Press',       group: 'free_weights', emoji: '🛋️' },
  { slug: 'kettlebell-area', name: 'Kettlebell Area', name_es: 'Zona de Kettlebells',  group: 'free_weights', emoji: '🔔' },
  // Cables
  { slug: 'cable-station',   name: 'Cable Station',   name_es: 'Estación de Poleas',   group: 'cables', emoji: '🪢' },
  { slug: 'lat-pulldown',    name: 'Lat Pulldown',    name_es: 'Jalón al Pecho',       group: 'cables', emoji: '⬇️' },
  { slug: 'seated-cable-row',name: 'Seated Cable Row',name_es: 'Remo Sentado en Polea',group: 'cables', emoji: '🚣' },
  // Machines
  { slug: 'smith-machine',   name: 'Smith Machine',   name_es: 'Máquina Smith',        group: 'machines', emoji: '🏗️' },
  { slug: 'weight-machine',  name: 'Weight Machine',  name_es: 'Máquina de Pesas',     group: 'machines', emoji: '⚙️' },
  { slug: 'row-machine',     name: 'Row Machine',     name_es: 'Máquina de Remo',      group: 'machines', emoji: '🚣' },
  { slug: 'hack-squat',      name: 'Hack Squat',      name_es: 'Sentadilla Hack',      group: 'machines', emoji: '🦵' },
  { slug: 'leg-press',       name: 'Leg Press',       name_es: 'Prensa de Piernas',    group: 'machines', emoji: '🦵' },
  { slug: 'leg-curl',        name: 'Leg Curl',        name_es: 'Curl de Femoral',      group: 'machines', emoji: '🦵' },
  { slug: 'calf-machine',    name: 'Calf Machine',    name_es: 'Máquina de Pantorrillas', group: 'machines', emoji: '🦵' },
  { slug: 'chest-press-machine', name: 'Chest Press Machine', name_es: 'Máquina de Press de Pecho', group: 'machines', emoji: '💪' },
  { slug: 'pec-deck',        name: 'Pec Deck',        name_es: 'Contractor de Pecho',  group: 'machines', emoji: '💪' },
  { slug: 'leg-extension',   name: 'Leg Extension',   name_es: 'Extensión de Piernas', group: 'machines', emoji: '🦵' },
  { slug: 'hip-abduction-adduction', name: 'Hip Abduction/Adduction', name_es: 'Abductores/Aductores', group: 'machines', emoji: '🦵' },
  { slug: 'glute-machine',   name: 'Glute Machine',   name_es: 'Máquina de Glúteos',   group: 'machines', emoji: '🍑' },
  { slug: 'shoulder-press-machine', name: 'Shoulder Press Machine', name_es: 'Máquina de Press de Hombros', group: 'machines', emoji: '💪' },
  { slug: 'preacher-curl',   name: 'Preacher Curl',   name_es: 'Curl Predicador',      group: 'machines', emoji: '💪' },
  { slug: 'back-extension',  name: 'Back Extension',  name_es: 'Extensión de Espalda', group: 'machines', emoji: '🔙' },
  // Bodyweight & functional
  { slug: 'open-floor',      name: 'Open Floor',      name_es: 'Zona Libre',           group: 'bodyweight', emoji: '🤸' },
  { slug: 'pull-up-bar',     name: 'Pull-Up Bar',     name_es: 'Barra de Dominadas',   group: 'bodyweight', emoji: '🔝' },
  { slug: 'dip-station',     name: 'Dip Station',     name_es: 'Estación de Fondos',   group: 'bodyweight', emoji: '💪' },
  { slug: 'captains-chair',  name: "Captain's Chair", name_es: 'Silla Romana',         group: 'bodyweight', emoji: '🪑' },
  { slug: 'sled-turf',       name: 'Sled / Turf',     name_es: 'Trineo / Césped',      group: 'bodyweight', emoji: '🛷' },
  { slug: 'resistance-bands',name: 'Resistance Bands',name_es: 'Bandas de Resistencia',group: 'bodyweight', emoji: '➰' },
  // Cardio
  { slug: 'treadmill',       name: 'Treadmill',       name_es: 'Caminadora',           group: 'cardio', emoji: '🏃' },
  { slug: 'stationary-bike', name: 'Stationary Bike', name_es: 'Bicicleta Estática',   group: 'cardio', emoji: '🚴' },
  { slug: 'stair-climber',   name: 'Stair Climber',   name_es: 'Escaladora',           group: 'cardio', emoji: '🪜' },
  { slug: 'elliptical',      name: 'Elliptical',      name_es: 'Elíptica',             group: 'cardio', emoji: '🌀' },
  { slug: 'rowing-machine',  name: 'Rowing Machine',  name_es: 'Máquina de Remo',      group: 'cardio', emoji: '🚣' },
  { slug: 'ski-erg',         name: 'Ski Erg',         name_es: 'Ski Erg',              group: 'cardio', emoji: '⛷️' },
  { slug: 'cardio-area',     name: 'Cardio Area',     name_es: 'Zona de Cardio',       group: 'cardio', emoji: '❤️' },
];

const BY_NAME = Object.fromEntries(STATIONS.map(s => [s.name, s]));
const BY_SLUG = Object.fromEntries(STATIONS.map(s => [s.slug, s]));

export const stationBySlug = (slug) => BY_SLUG[slug] || null;
export const stationByName = (name) => BY_NAME[name] || null;

/** The QR payload a printed equipment sticker encodes. */
export const equipmentDeepLink = (slug) => `tugympr://equipment/${slug}`;

/**
 * Parse a scanned equipment QR (or deep link) into a known station slug.
 * Accepts `tugympr://equipment/<slug>`, `https://…/equipment/<slug>`, or a bare
 * `<slug>`. Returns the slug only if it maps to a real station, else null.
 */
export function parseEquipmentSlug(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/equipment\/([a-z0-9-]+)/i);
  const slug = (m ? m[1] : s).toLowerCase();
  return BY_SLUG[slug] ? slug : null;
}

/**
 * Assign a station to an exercise. MUST stay identical to the server-side rule in
 * migration 0622 (scratchpad assign_stations.js). Returns a station display name,
 * or null for sports/activities that aren't tied to scannable equipment.
 */
export function stationFor(e) {
  if (!e) return null;
  const n = (e.name || '').toLowerCase();
  const eq = e.equipment;
  const muscle = e.muscle;
  const has = (...k) => k.some(x => n.includes(x));

  if (has('swimming','basketball','soccer','tennis','boxing','dance','martial art','hiking','yoga','pilates','hiit','zumba','sport')) return null;

  if (eq === 'Smith Machine') return 'Smith Machine';
  if (eq === 'Kettlebell') return 'Kettlebell Area';
  if (eq === 'Resistance Band') return 'Resistance Bands';
  if (eq === 'Cardio Machine' || muscle === 'Cardio') {
    if (has('treadmill','run','jog','sprint','walk')) return 'Treadmill';
    if (has('bike','cycl','spin','assault bike','air bike')) return 'Stationary Bike';
    if (has('row')) return 'Rowing Machine';
    if (has('elliptical')) return 'Elliptical';
    if (has('stair','step mill','stepmill','climber')) return 'Stair Climber';
    if (has('ski')) return 'Ski Erg';
    if (has('jump rope','skip')) return 'Open Floor';
    return 'Cardio Area';
  }
  if (eq === 'Cable') {
    if (has('lat pulldown','pulldown','pull-down') && !has('pushdown')) return 'Lat Pulldown';
    if (has('row') && has('seated')) return 'Seated Cable Row';
    if (has('cable row','seated row')) return 'Seated Cable Row';
    return 'Cable Station';
  }
  if (eq === 'Machine') {
    if (has('sled','prowler')) return 'Sled / Turf';
    if (has("captain's chair",'captains chair')) return "Captain's Chair";
    if (has('incline machine press','incline chest')) return 'Chest Press Machine';
    if (has('leg press')) return 'Leg Press';
    if (has('hack squat','pendulum squat','belt squat')) return 'Hack Squat';
    if (has('leg extension','knee extension')) return 'Leg Extension';
    if (has('leg curl','hamstring curl','lying curl','seated curl') && muscle === 'Legs') return 'Leg Curl';
    if (has('calf')) return 'Calf Machine';
    if (has('chest press')) return 'Chest Press Machine';
    if (has('pec deck','pec fly','chest fly','reverse fly','rear delt fly','reverse pec')) return 'Pec Deck';
    if (has('shoulder press','overhead press')) return 'Shoulder Press Machine';
    if (has('lat pulldown','pulldown')) return 'Lat Pulldown';
    if (has('preacher')) return 'Preacher Curl';
    if (has('abduction','abductor','adduction','adductor')) return 'Hip Abduction/Adduction';
    if (has('back extension','hyperextension','hyper extension')) return 'Back Extension';
    if (has('assisted') && has('pull','chin','dip')) return 'Assisted Pull-Up/Dip';
    if (has('hip thrust','glute','kickback')) return 'Glute Machine';
    if (has('row')) return 'Row Machine';
    return 'Weight Machine';
  }
  if (eq === 'Barbell' || eq === 'EZ Bar') {
    if (has('bench press','floor press','close-grip bench','close grip bench')) return 'Bench Press';
    if (has('squat','overhead press','ohp','military','push press','front squat','back squat')) return 'Squat Rack';
    return 'Barbell Platform';
  }
  if (eq === 'Dumbbell') return 'Dumbbell Area';
  if (eq === 'Bodyweight') {
    if (has('pull-up','pullup','chin-up','chinup','hanging','muscle-up')) return 'Pull-Up Bar';
    if (has('dip')) return 'Dip Station';
    return 'Open Floor';
  }
  return 'Open Floor';
}

/**
 * Rule-based difficulty for the "beginner-friendly" filter + card badge.
 * Returns 'beginner' | 'intermediate' | 'advanced'. Mirrors migration 0624's
 * SQL so client and DB agree. Guided machines/cardio + simple isolation/bodyweight
 * = beginner; free-weight compounds = intermediate; Olympic/high-skill = advanced.
 */
export function difficultyFor(e) {
  if (!e) return 'intermediate';
  const n = (e.name || '').toLowerCase();
  const eq = e.equipment;
  const has = (...k) => k.some(x => n.includes(x));
  if (has('clean','snatch','jerk','muscle-up','pistol','planche','handstand','overhead squat','deficit','zercher','turkish get-up','windmill','front lever','human flag','sissy squat','nordic')) return 'advanced';
  if (eq === 'Machine' || eq === 'Cardio Machine' || eq === 'Resistance Band') return 'beginner';
  if (has('assisted','seated','supported','machine','wall sit','incline walk')) return 'beginner';
  if (eq === 'Cable' && has('pushdown','curl','raise','fly','kickback','crunch','pull-apart','face pull','pressdown')) return 'beginner';
  if (eq === 'Bodyweight' && has('push-up','plank','crunch','glute bridge','bird dog','superman','sit-up','dead bug','calf raise','mountain climber','leg raise','hip thrust','step-up','wall sit')) return 'beginner';
  if (eq === 'Dumbbell' && has('curl','raise','fly','extension','kickback','shrug','pullover','lateral')) return 'beginner';
  if (has('deadlift','squat','bench press','overhead press','barbell row','pull-up','chin-up','dip','romanian','good morning','front squat','push press','thruster','bulgarian')) return 'intermediate';
  if (eq === 'Barbell' || eq === 'EZ Bar' || eq === 'Smith Machine' || eq === 'Kettlebell') return 'intermediate';
  return 'beginner';
}
