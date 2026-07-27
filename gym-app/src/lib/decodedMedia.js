// Shared "this src already decoded a frame" memory for exercise media tiles.
//
// WHY THIS IS SHARED AND NOT PER-COMPONENT: two components render the same
// exercise clips — `ExerciseVideoThumb` (library rows, equipment tiles) and
// `LazyVideoTile` (search modal, muscle sheet, builder pickers). A member taps a
// muscle, then a neighbouring muscle, then goes back; the tiles unmount and
// remount with an overlapping set of exercises. With per-component memory the
// second component starts from zero and every tile replays the whole sequence —
// wait for IntersectionObserver, mount a fresh <video>, re-decode, shimmer — for
// clips the app decoded seconds ago. That is the "it reloads the images every
// time I switch muscle" complaint.
//
// One module-level Set means a clip decoded ANYWHERE counts EVERYWHERE, so
// back-navigation and muscle-switching are instant.
//
// CAPPED on purpose. Membership doubles as "safe to mount immediately", and
// these grids are not virtualised — an uncapped set would let a full scroll
// followed by a remount spin up hundreds of <video> decoders at once, which iOS
// will not tolerate. Past the cap tiles still render correctly, just via the
// lazy path, exactly as before.
const DECODED = new Set();
const DECODED_CAP = 240;

/** Record that `src` has painted a frame at least once this session. */
export function markDecoded(src) {
  if (src && DECODED.size < DECODED_CAP) DECODED.add(src);
}

/** True when `src` has already decoded — safe to mount and treat as painted. */
export function hasDecoded(src) {
  return !!src && DECODED.has(src);
}
