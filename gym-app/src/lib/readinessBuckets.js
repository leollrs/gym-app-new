// Shared readiness visual constants — the polygon→region bucket map + state
// colors used to paint the anatomical muscle figure. Mirrors the definitions
// inside ReadinessModal.jsx (member recovery view); kept here so the trainer's
// MuscleFigure can paint the exact same body map from a client's readiness.
// If the muscle buckets change, update both (they track the traced polygon
// bucketIds in musclePolygons.js).

// State colors — tuned for warm-paper backgrounds.
export const STATE_HEX = {
  fatigued: '#E26B5C',
  moderate: '#E0A042',
  fresh: '#3DAD7C',
  rest: '#9CA3AB',
};

export const STATE_LABEL = {
  fatigued: 'Sore',
  moderate: 'Recovering',
  fresh: 'Fresh',
  rest: 'Untrained',
};

// Each polygon on the body maps to a bucket. The bucket's `regionIds` are the
// engine-side anatomical region keys (see readinessEngine.js) so aggregation
// against logged exercises stays accurate.
export const READINESS_BUCKETS = [
  // ── Front ──
  { id: 'chest-upper',       label: 'Upper Chest',         regionIds: ['upper_chest'] },
  { id: 'chest-mid',         label: 'Mid Chest',           regionIds: ['mid_chest'] },
  { id: 'chest-lower',       label: 'Lower Chest',         regionIds: ['lower_chest'] },
  { id: 'serratus',          label: 'Serratus',            regionIds: ['serratus'] },
  { id: 'front-delts',       label: 'Front Delts',         regionIds: ['front_delts'] },
  { id: 'side-delts',        label: 'Side Delts',          regionIds: ['side_delts'] },
  { id: 'biceps',            label: 'Biceps',              regionIds: ['biceps'] },
  { id: 'brachialis',        label: 'Brachialis',          regionIds: ['brachialis'] },
  { id: 'forearm-flex',      label: 'Forearm Flexors',     regionIds: ['forearms'] },
  { id: 'forearm-ext',       label: 'Forearm Extensors',   regionIds: ['forearms'] },
  { id: 'abs',               label: 'Abs',                 regionIds: ['upper_abs', 'mid_abs', 'lower_abs', 'abs'] },
  { id: 'upper-abs',         label: 'Upper Abs',           regionIds: ['upper_abs', 'abs'] },
  { id: 'mid-abs',           label: 'Mid Abs',             regionIds: ['mid_abs', 'abs'] },
  { id: 'lower-abs',         label: 'Lower Abs',           regionIds: ['lower_abs', 'abs'] },
  { id: 'obliques',          label: 'Obliques',            regionIds: ['obliques'] },
  { id: 'quads',             label: 'Quads',               regionIds: ['quads', 'hip_flexors'] },
  { id: 'adductors',         label: 'Inner Thigh',         regionIds: ['adductors'] },
  { id: 'tibialis',          label: 'Shin',                regionIds: ['tibialis'] },
  { id: 'calves-front',      label: 'Calves (front)',      regionIds: ['calves', 'soleus'] },
  // ── Back ──
  { id: 'traps',             label: 'Traps',               regionIds: ['traps'] },
  { id: 'upper-back',        label: 'Upper Back',          regionIds: ['upper_back', 'mid_back'] },
  { id: 'lats',              label: 'Lats',                regionIds: ['lats'] },
  { id: 'rear-delts',        label: 'Rear Delts',          regionIds: ['rear_delts'] },
  { id: 'triceps',           label: 'Triceps',             regionIds: ['triceps'] },
  { id: 'lower-back',        label: 'Lower Back',          regionIds: ['lower_back'] },
  { id: 'side-waist',        label: 'Side Waist',          regionIds: ['obliques', 'lower_back'] },
  { id: 'glutes',            label: 'Glutes',              regionIds: ['glutes'] },
  { id: 'abductors',         label: 'Abductors',           regionIds: ['abductors', 'glute_med'] },
  { id: 'hamstrings',        label: 'Hamstrings',          regionIds: ['hamstrings'] },
  { id: 'calves',            label: 'Calves',              regionIds: ['calves', 'soleus'] },
  { id: 'forearm-back-ext',  label: 'Forearm Ext. (back)', regionIds: ['forearms'] },
  { id: 'forearm-back-flex', label: 'Forearm Flex. (back)',regionIds: ['forearms'] },
];

export const BUCKET_BY_ID = new Map(READINESS_BUCKETS.map(b => [b.id, b]));
