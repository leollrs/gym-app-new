// Rough time + calorie estimates for a resistance-training day, derived from the
// programmed sets / reps / rest. Shared by the trainer program viewer + editor
// and the member routine views so both sides show the SAME numbers.
//
// These are estimates, not measured burn — the calorie model assumes work bursts
// burn ~8 kcal/min and the elevated-HR rest between sets ~2 kcal/min. Reps map to
// ~3s of work each. Accepts either program-shape exercises
// ({ sets, reps, rest_seconds }) or member routine rows
// ({ target_sets, target_reps, rest_seconds }).

const repsNum = (r) => {
  const m = String(r ?? '').match(/\d+/g);
  if (!m) return 10; // AMRAP / non-numeric → assume a moderate set
  const n = m.map(Number);
  return n.length > 1 ? Math.round((n[0] + n[1]) / 2) : n[0];
};

const norm = (ex) => ({
  sets: Number(ex.sets ?? ex.target_sets) || 0,
  reps: repsNum(ex.reps ?? ex.target_reps),
  rest: Number(ex.rest_seconds ?? ex.restSeconds ?? ex.rest) || 60,
});

/** Estimated minutes for a day (≈3s work per rep + the programmed rest). */
export function estimateMinutes(exercises) {
  if (!exercises?.length) return 0;
  const secs = exercises.reduce((s, raw) => {
    const e = norm(raw);
    return s + e.sets * (e.reps * 3 + e.rest);
  }, 0);
  return Math.max(1, Math.round(secs / 60));
}

/** Estimated calories for a day — work ~8 kcal/min, rest ~2 kcal/min. */
export function estimateCalories(exercises) {
  if (!exercises?.length) return 0;
  let kcal = 0;
  for (const raw of exercises) {
    const e = norm(raw);
    kcal += (e.sets * e.reps * 3 / 60) * 8 + (e.sets * e.rest / 60) * 2;
  }
  return Math.max(1, Math.round(kcal));
}
