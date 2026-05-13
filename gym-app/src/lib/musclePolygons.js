// musclePolygons.js
//
// Loads the user-traced muscle polygons from src/data/muscleRegions.json
// and groups them into the 14 visual "buckets" the Recovery modal uses.
// Each bucket maps to a region set in readinessEngine.js; the bucket id is
// what onSelect(...) receives when the user taps a polygon.
//
// Image dimensions (native, polygon coords are in this space):
//   FRONT 626 × 832
//   BACK  634 × 832
//
// Polygons can be filtered (hidden:true) but in practice we honour the
// hidden flag at render time, not here.

import RAW from '../data/muscleRegions.json';

export const FRONT_DIM = { w: 626, h: 832 };
export const BACK_DIM = { w: 634, h: 832 };

// FRONT view: each polygon → its granular bucket. Splits per user spec.
const FRONT_POLY_BUCKET = {
  // Chest — 3 separate buckets per anatomical region
  'pec-upper-l': 'chest-upper', 'pec-upper-r': 'chest-upper',
  'pec-mid-l': 'chest-mid', 'pec-mid-r': 'chest-mid',
  'pec-lower-l': 'chest-lower', 'pec-lower-r': 'chest-lower',
  // Serratus stands alone
  'serratus-l': 'serratus', 'serratus-r': 'serratus',
  // Shoulders — polygon IDs were reversed during tracing: the polygon tagged
  // `delt-front-*` actually sits on the OUTER edge of the shoulder (the side
  // / lateral deltoid), and `delt-side-*` sits inward toward the chest (the
  // front / anterior deltoid). Swap the bucket assignment to match anatomy.
  'delt-front-l': 'side-delts', 'delt-front-r': 'side-delts',
  'delt-side-l': 'front-delts', 'delt-side-r': 'front-delts',
  // Trap caps visible from front
  'trap-upper-l': 'traps', 'trap-upper-r': 'traps',
  // Arms — `brachialis` polygons sit lateral to the biceps on the front
  // view. From the user's POV this reads as "side of triceps", and since
  // brachialis-specific exercises don't really exist in the catalogue
  // we route those taps to the triceps bucket so the sheet actually has
  // exercises.
  'biceps-l': 'biceps', 'biceps-r': 'biceps',
  'brachialis-l': 'triceps', 'brachialis-r': 'triceps',
  'forearm-flex-l': 'forearm-flex', 'forearm-flex-r': 'forearm-flex',
  'forearm-ext-l': 'forearm-ext', 'forearm-ext-r': 'forearm-ext',
  // Torso — abs split into upper / mid / lower so the user can drill
  // into specific exercises (crunches vs leg raises etc.).
  'abs-upper-l': 'upper-abs', 'abs-upper-r': 'upper-abs',
  'abs-mid-l':   'mid-abs',   'abs-mid-r':   'mid-abs',
  'abs-low-l':   'lower-abs', 'abs-low-r':   'lower-abs',
  'abs-bottom-l':'lower-abs', 'abs-bottom-r':'lower-abs',
  'oblique-upper-l': 'obliques', 'oblique-upper-r': 'obliques',
  'oblique-lower-l': 'obliques', 'oblique-lower-r': 'obliques',
  // Legs (front)
  'quad-l': 'quads', 'quad-r': 'quads',
  'adductor-l': 'adductors', 'adductor-r': 'adductors',
  // Lower leg — SWAPPED per user feedback: the polygon traced as `tibialis-*`
  // visually corresponds to what they label "Pantorrillas frente" (calves
  // from the front), and `peroneal-*` is what they call the shin/tibial.
  'tibialis-l': 'calves-front', 'tibialis-r': 'calves-front',
  'peroneal-l': 'tibialis', 'peroneal-r': 'tibialis',
};

// BACK view: granular per-muscle buckets.
const BACK_POLY_BUCKET = {
  // Traps cap
  'trap-upper-l': 'traps', 'trap-upper-r': 'traps',
  // Upper back / rhomboid area (trap-mid + teres major)
  'trap-mid-l': 'upper-back', 'trap-mid-r': 'upper-back',
  'teres-l': 'upper-back', 'teres-r': 'upper-back',
  // Lats — their own bucket
  'lat-l': 'lats', 'lat-r': 'lats',
  // Rear delts
  'delt-rear-l': 'rear-delts', 'delt-rear-r': 'rear-delts',
  // Triceps
  'tricep-l': 'triceps', 'tricep-r': 'triceps',
  // Lower back
  'lower-back': 'lower-back',
  // Glutes (main)
  'glute-l': 'glutes', 'glute-r': 'glutes',
  // Side-of-lower-back strip above the glutes — user called out this is NOT
  // abductors; it's the obliques-wrapping / quadratus area. Bucket "side-
  // waist" so it shows correctly.
  'glute-side-l': 'side-waist', 'glute-side-r': 'side-waist',
  // Hamstrings — split into main (semitendinosus/membranosus) and outer
  // (biceps femoris, which the user labels "Abductors").
  'hamstring-l': 'hamstrings', 'hamstring-r': 'hamstrings',
  'hamstring-outer-l': 'abductors', 'hamstring-outer-r': 'abductors',
  // Calves (back)
  'calf-l': 'calves', 'calf-r': 'calves',
  // Back-view forearms split into two buckets so it mirrors the front-view
  // flex/ext split. The wider polygons are the main extensor compartment;
  // the narrow lateral-edge polygons are the flexor-side edge visible from
  // behind.
  'forearm-back-l': 'forearm-back-ext', 'forearm-back-r': 'forearm-back-ext',
  'forearm-back-l-edge': 'forearm-back-flex', 'forearm-back-r-edge': 'forearm-back-flex',
};

function buildPolygons(rawList, bucketMap) {
  return (rawList ?? [])
    .filter((r) => !r.hidden && Array.isArray(r.pts) && r.pts.length >= 3)
    .map((r) => ({
      id: r.id,
      bucketId: bucketMap[r.id] || null,
      // SVG "points" attribute expects "x,y x,y ..." pairs.
      points: r.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    }))
    // Drop any polygon we don't have a bucket for — they wouldn't be
    // clickable or color-mapped anyway.
    .filter((p) => p.bucketId);
}

export const FRONT_POLYGONS = buildPolygons(RAW.front, FRONT_POLY_BUCKET);
export const BACK_POLYGONS = buildPolygons(RAW.back, BACK_POLY_BUCKET);
