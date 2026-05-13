// muscleBuckets.js
//
// Single source of truth for bucket → anatomical region mapping. The
// Recovery modal uses this to aggregate readiness; the Exercise Library
// uses this to filter exercises by tapped sub-region.
//
// Bucket IDs match `src/lib/musclePolygons.js` (FRONT_POLY_BUCKET +
// BACK_POLY_BUCKET). Region IDs match readinessEngine.js's region keys
// and the `primaryRegions` arrays on exercises in `src/data/exercises.js`.

export const MUSCLE_BUCKETS = [
  // ── Front ──────────────────────────────────────────────────────────────
  { id: 'chest-upper',       label: 'Upper Chest',         regionIds: ['upper_chest'] },
  { id: 'chest-mid',         label: 'Mid Chest',           regionIds: ['mid_chest'] },
  { id: 'chest-lower',       label: 'Lower Chest',         regionIds: ['lower_chest'] },
  { id: 'serratus',          label: 'Serratus',            regionIds: ['serratus'] },
  { id: 'front-delts',       label: 'Front Delts',         regionIds: ['front_delts'] },
  { id: 'side-delts',        label: 'Side Delts',          regionIds: ['side_delts'] },
  { id: 'biceps',            label: 'Biceps',              regionIds: ['biceps'] },
  { id: 'forearm-flex',      label: 'Forearm Flexors',     regionIds: ['forearms'] },
  { id: 'forearm-ext',       label: 'Forearm Extensors',   regionIds: ['forearms'] },
  { id: 'upper-abs',         label: 'Upper Abs',           regionIds: ['upper_abs', 'abs'] },
  { id: 'mid-abs',           label: 'Mid Abs',             regionIds: ['mid_abs', 'abs'] },
  { id: 'lower-abs',         label: 'Lower Abs',           regionIds: ['lower_abs', 'abs'] },
  { id: 'obliques',          label: 'Obliques',            regionIds: ['obliques'] },
  { id: 'quads',             label: 'Quads',               regionIds: ['quads', 'hip_flexors'] },
  { id: 'adductors',         label: 'Inner Thigh',         regionIds: ['adductors'] },
  { id: 'tibialis',          label: 'Shin',                regionIds: ['tibialis'] },
  { id: 'calves-front',      label: 'Calves (front)',      regionIds: ['calves', 'soleus'] },

  // ── Back ───────────────────────────────────────────────────────────────
  { id: 'traps',             label: 'Traps',               regionIds: ['traps'] },
  { id: 'upper-back',        label: 'Upper Back',          regionIds: ['upper_back', 'mid_back'] },
  { id: 'lats',              label: 'Lats',                regionIds: ['lats'] },
  { id: 'rear-delts',        label: 'Rear Delts',          regionIds: ['rear_delts'] },
  { id: 'triceps',           label: 'Triceps',             regionIds: ['triceps'] },
  { id: 'lower-back',        label: 'Lower Back',          regionIds: ['lower_back'] },
  { id: 'side-waist',        label: 'Side Waist',          regionIds: ['obliques'] },
  { id: 'glutes',            label: 'Glutes',              regionIds: ['glutes'] },
  // The "outside hip" muscle the user calls Abductors anatomically wraps
  // glute_med + the upper-back-leg biceps-femoris-outer region. Both
  // contribute to the "Abductors" bucket on back view.
  { id: 'abductors',         label: 'Abductors',           regionIds: ['abductors', 'glute_med'] },
  { id: 'hamstrings',        label: 'Hamstrings',          regionIds: ['hamstrings'] },
  { id: 'calves',            label: 'Calves',              regionIds: ['calves', 'soleus'] },
  { id: 'forearm-back-ext',  label: 'Forearm Ext. (back)', regionIds: ['forearms'] },
  { id: 'forearm-back-flex', label: 'Forearm Flex. (back)',regionIds: ['forearms'] },
];

export const MUSCLE_BUCKET_BY_ID = new Map(MUSCLE_BUCKETS.map((b) => [b.id, b]));

/**
 * Map a high-level muscle group (e.g. 'Chest') to all anatomical region
 * IDs that fall under it. Used when the user wants to broaden a sub-region
 * tap to the whole muscle ("Ver todo Pecho").
 */
export const GROUP_TO_REGIONS = {
  Chest:     ['upper_chest', 'mid_chest', 'lower_chest', 'serratus'],
  Back:      ['upper_back', 'mid_back', 'lats', 'lower_back', 'traps'],
  Shoulders: ['front_delts', 'side_delts', 'rear_delts'],
  Biceps:    ['biceps'],
  Triceps:   ['triceps'],
  Legs:      ['quads', 'hamstrings', 'adductors', 'hip_flexors'],
  Glutes:    ['glutes', 'glute_med', 'abductors'],
  Core:      ['upper_abs', 'mid_abs', 'lower_abs', 'abs', 'obliques'],
  Calves:    ['calves', 'soleus', 'tibialis'],
  Forearms:  ['forearms'],
  Traps:     ['traps'],
};

/**
 * For a given bucket ID, return the high-level muscle group it belongs to.
 * Drives the "Ver todo [Group]" expand chip in the muscle picker.
 */
// Bucket → muscle_group enum mapping. Aligned with the chip filters on
// the exercise library page: serratus reads as Core (sits on the side
// of the rib cage / interacts with obliques), abductors as Legs (not
// Glutes), and the back is split into separately-pickable buckets.
const BUCKET_TO_GROUP = {
  'chest-upper': 'Chest', 'chest-mid': 'Chest', 'chest-lower': 'Chest',
  'serratus': 'Core',
  'front-delts': 'Shoulders', 'side-delts': 'Shoulders', 'rear-delts': 'Shoulders',
  'biceps': 'Biceps',
  'forearm-flex': 'Forearms', 'forearm-ext': 'Forearms',
  'forearm-back-flex': 'Forearms', 'forearm-back-ext': 'Forearms',
  'upper-abs': 'Core', 'mid-abs': 'Core', 'lower-abs': 'Core',
  'obliques': 'Core', 'side-waist': 'Core',
  'quads': 'Legs', 'adductors': 'Legs', 'hamstrings': 'Legs', 'abductors': 'Legs',
  'glutes': 'Glutes',
  'tibialis': 'Calves', 'calves-front': 'Calves', 'calves': 'Calves',
  'traps': 'Traps',
  'upper-back': 'Back', 'lats': 'Back', 'lower-back': 'Back',
  'triceps': 'Triceps',
};

export const bucketGroup = (bucketId) => BUCKET_TO_GROUP[bucketId] || null;
