/**
 * Señales v4 — cada socio contra sí mismo.
 * ─────────────────────────────────────────────────────────────
 * Refleja supabase/functions/compute-churn-scores/index.ts.
 *
 * Cada señal devuelve { frac, ceil, score, label } donde `frac` es su
 * contribución 0..1 y `score` la misma cifra en 0..100 para pintarla. Se
 * combinan con un OR-ruidoso (ver los techos abajo), no con una suma.
 */
import i18n from 'i18next';

const tt = (key, fallback, params = {}) =>
  i18n.t(key, { ns: 'pages', defaultValue: fallback, ...params });

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// ── Techos ──
// Cada señal aporta como mucho ESTA fracción del riesgo, y se combinan con un
// OR-ruidoso:  riesgo = 1 − Π(1 − señal)
//
// Por qué no una suma normalizada (que era mi primer intento, y las pruebas lo
// tumbaron): al dividir entre la suma de máximos, un socio con asistencia
// PERFECTA que de pronto desaparece tenía una sola señal encendida y las otras a
// cero — su techo quedaba en 40/90 = 44 y no podía ser Crítico jamás. Es el
// mismo error que el multiplicador de antigüedad de v3, por otra puerta.
//
// Con el OR-ruidoso ninguna señal diluye a otra: una sola señal fuerte basta
// para subir el score, y varias a la vez componen. Además una señal que no se
// puede calcular aporta factor 1 y simplemente no participa — sin denominadores
// que ajustar ni el fallo silencioso de v3, donde dos señales cableadas a cero
// encogieron el rango de todo el mundo.
export const CEIL_GAP = 0.85;
export const CEIL_DROP = 0.45;
export const CEIL_FLOOR = 0.30;
export const CEIL_APP = 0.10;
export const CEIL_HABIT = 0.60;
export const CEIL_ONB_RECENCY = 0.55;
export const CEIL_ACTIVATION = 0.40;

const pct1 = (n) => Math.round(n * 1000) / 10;

// `maxPts` se mantiene además de `ceil` porque las barras de AdminChurn y
// MemberDetailPanel calculan `score / maxPts`. Al renombrarlo a `ceil` esas
// barras pintaban 0% en silencio y el panel enseñaba literalmente «42.5/undefined»
// — un build verde no ve eso. En estas unidades `score/maxPts` es `frac/ceil`,
// que es exactamente «cuánto de esta señal está encendida».
const sig = (frac, ceil, label) => ({ frac, ceil, score: pct1(frac), maxPts: pct1(ceil), label });

// ═══════════════════════════════════════════════════════════════
//  Clase A — hay ritmo medible
// ═══════════════════════════════════════════════════════════════

/**
 * Brecha contra su propio ritmo. `tramo = días / g90`: 1.0 es el borde de lo
 * normal para ESE socio, 3.0 es el máximo.
 *
 * Aquí es donde el veterano deja de ser inmune. v3 le aplicaba ×0,85 al
 * subtotal —una tasa base incondicional multiplicando una probabilidad ya
 * condicionada— y le ponía un techo de 69 sobre 100: matemáticamente no podía
 * ser Crítico. Con esto, un año de historia le da un g90 estrechísimo, así que
 * la misma ausencia le pesa MÁS, que es lo correcto: romper un hábito de un año
 * suele ser una mudanza o una lesión, no un bajón de motivación.
 */
export function sigGap(daysSinceLastVisit, g90) {
  if (daysSinceLastVisit == null || !g90) {
    return sig(CEIL_GAP, CEIL_GAP, tt('admin.churnSignals.noRecentActivity', 'Sin actividad reciente'));
  }
  const stretch = daysSinceLastVisit / g90;
  // Satura a 4× su ritmo normal, no a 3×: con /2 el socio regular de 1×/semana
  // llegaba al máximo a los 21 días —dos visitas perdidas— y salía Crítico. Es
  // el precio de premiar la regularidad: cuanto más constante, más estrecha su
  // vara, así que la curva tiene que ser más indulgente para todos.
  const frac = CEIL_GAP * clamp01((stretch - 1) / 3);
  const label = frac === 0
    ? tt('admin.churnSignals.v4OnRhythm', 'Dentro de su ritmo')
    : tt('admin.churnSignals.v4GapVsUsual', '{{d}} días sin venir — no suele pasar de {{g}}', {
      d: Math.round(daysSinceLastVisit), g: Math.round(g90),
    });
  return sig(frac, CEIL_GAP, label);
}

/**
 * Caída de volumen contra su propia base, medida HASTA SU ÚLTIMA VISITA.
 * Caza el desgaste, no el corte: el que pasa de 5×/semana a 2×/semana nunca
 * abre un hueco grande y en v3 salía Riesgo bajo. Zona muerta hasta el 15%
 * (ruido), saturación al 70%.
 */
export function sigDrop(drop) {
  if (drop == null) return null; // sin base propia suficiente no hay caída que medir
  const frac = CEIL_DROP * clamp01((drop - 0.15) / 0.55);
  const label = frac === 0
    ? tt('admin.churnSignals.v4RateStable', 'Mantiene su ritmo')
    : tt('admin.churnSignals.v4RateDown', 'Venía {{pct}}% menos que antes', { pct: Math.round(drop * 100) });
  return sig(frac, CEIL_DROP, label);
}

/**
 * Suelo absoluto. Aquí SÍ vive el ancla de Hormozi (<2×/semana es frágil), pero
 * pequeña y sin amortiguador — en v3 era la señal principal y luego se
 * multiplicaba por 0,55 cuando el socio era estable, o sea que el ancla y su
 * parche se contradecían sobre exactamente la población que el ancla existía
 * para cazar.
 */
export function sigFloor(weeklyRate) {
  const frac = CEIL_FLOOR * clamp01((2 - (weeklyRate || 0)) / 2);
  const label = frac === 0
    ? tt('admin.churnSignals.v4GoodVolume', 'Buen volumen de visitas')
    : tt('admin.churnSignals.v4LowVolume', '{{n}} visitas por semana', { n: (weeklyRate || 0).toFixed(1) });
  return sig(frac, CEIL_FLOOR, label);
}

/** Clase C: menos de 3 intervalos, no hay vara propia. Curva genérica y confianza baja. */
export function sigGapGeneric(daysSinceLastVisit) {
  if (daysSinceLastVisit == null) {
    return sig(CEIL_GAP, CEIL_GAP, tt('admin.churnSignals.noRecentActivity', 'Sin actividad reciente'));
  }
  const frac = CEIL_GAP * clamp01((daysSinceLastVisit - 10) / 25);
  const label = frac === 0
    ? tt('admin.churnSignals.recentlyActive', 'Vino hace poco')
    : tt('admin.churnSignals.daysSinceVisit', '{{d}} días desde la última visita', { d: Math.round(daysSinceLastVisit) });
  return sig(frac, CEIL_GAP, label);
}

// ═══════════════════════════════════════════════════════════════
//  Régimen novato — cuenta < 75 días
// ═══════════════════════════════════════════════════════════════

/** Rampa de ~3/semana hacia 12 visitas en 6 semanas (Kaushal & Rhodes; PushPress). */
export function sigHabit(visitsSoFar, accountAgeDays) {
  const weeks = Math.max(accountAgeDays / 7, 0.5);
  const expected = Math.min(weeks * 3, 18);
  const gap = clamp01((expected - (visitsSoFar || 0)) / expected);
  const frac = CEIL_HABIT * gap;
  const label = gap <= 0.15
    ? tt('admin.churnSignals.buildingHabit', 'Construyendo rutina')
    : tt('admin.churnSignals.notBuildingHabit', 'Aún sin rutina ({{v}} visitas en {{w}} sem)', {
      v: visitsSoFar || 0, w: Math.round(weeks),
    });
  return sig(frac, CEIL_HABIT, label);
}

/** Recencia de novato: lineal y más dura. Las ausencias tempranas predicen fuerte. */
export function sigOnboardingRecency(daysSinceLastVisit) {
  const d = daysSinceLastVisit == null ? 14 : daysSinceLastVisit;
  const frac = CEIL_ONB_RECENCY * clamp01(d / 14);
  const label = frac === 0
    ? tt('admin.churnSignals.recentlyActive', 'Vino hace poco')
    : tt('admin.churnSignals.daysSinceVisit', '{{d}} días desde la última visita', { d: Math.round(d) });
  return sig(frac, CEIL_ONB_RECENCY, label);
}

/**
 * Activación = TRES VISITAS AL GIMNASIO en las primeras 3 semanas.
 *
 * En v3 era «¿registró su primer entreno en la app?», que se llevaba 12 puntos
 * de alguien que entrenaba todos los días y no tocaba el móvil. Eso mide la app,
 * no el hábito, y castiga justo al socio que v3 decía proteger.
 */
export function sigActivation(visitsIn21d, accountAgeDays) {
  if (accountAgeDays < 21) return null; // todavía no toca preguntarlo
  const frac = CEIL_ACTIVATION * clamp01((3 - (visitsIn21d || 0)) / 3);
  const label = frac === 0
    ? tt('admin.churnSignals.v4Activated', 'Arrancó bien')
    : tt('admin.churnSignals.v4NotActivated', 'Solo {{n}} visitas en sus primeras semanas', { n: visitsIn21d || 0 });
  return sig(frac, CEIL_ACTIVATION, label);
}

// ═══════════════════════════════════════════════════════════════
//  Lente de app — 10% como mucho, y SOLO si el socio usaba la app
// ═══════════════════════════════════════════════════════════════
//
// La app no puede constituir el riesgo, solo corroborarlo. Si nunca la usó, el
// término NO EXISTE: aporta factor 1 al OR-ruidoso y desaparece. Con base
// presente, un 10% no llega ni a Medio por sí solo — un susurro, no una alarma.
//
// Con esto sobra la compuerta de asistencia de v3 (`si Layer A ≤ 18, tope 54`),
// que era un tope artificial para contener una señal mal acotada.

export function sigAppWithdrawal(baseline, recent) {
  if (baseline == null || baseline < 6) return null; // nunca la adoptó → no existe
  const drop = clamp01(1 - (recent || 0) / baseline);
  const frac = CEIL_APP * clamp01((drop - 0.4) / 0.6);
  const label = frac === 0
    ? tt('admin.churnSignals.appActive', 'Sigue activo en la app')
    : tt('admin.churnSignals.appActivityDropped', 'Dejó de usar la app');
  return sig(frac, CEIL_APP, label);
}

// ═══════════════════════════════════════════════════════════════
//  Protección — multiplicativa, tope 15%
// ═══════════════════════════════════════════════════════════════
//
// v3 restaba hasta 20 puntos planos: sobre un score de 25 lo dejaba en 5, y
// sobre uno de 90 no se notaba — al revés de lo que hace falta. Estar en un
// reto no hace que tres semanas sin aparecer estén bien; solo hace que el caso
// sea algo menos grave.

export function protectionFactor({ activeChallenge, activeReferrer, recentPRs, activeSocial }) {
  let p = 0;
  const parts = [];
  if (activeChallenge) { p += 0.05; parts.push(tt('admin.churnSignals.bonusChallenge', 'En un reto')); }
  if (activeReferrer) { p += 0.05; parts.push(tt('admin.churnSignals.bonusReferrer', 'Trae gente')); }
  if (recentPRs) { p += 0.03; parts.push(tt('admin.churnSignals.bonusPRs', 'Marcando récords')); }
  if (activeSocial) { p += 0.02; parts.push(tt('admin.churnSignals.bonusSocial', 'Activo socialmente')); }
  return { factor: Math.min(p, 0.15), parts };
}
