/**
 * Churn Intelligence — composición v4
 * ─────────────────────────────────────────────────────────────
 * Cada socio contra sí mismo. Refleja compute-churn-scores (v4).
 *
 *   score = 100 × (1 − Π(1 − señalᵢ)) × (1 − protección)
 *
 * OR-ruidoso, no suma: una sola señal fuerte basta para subir el score y varias
 * componen, pero ninguna diluye a otra. Una señal que no se puede calcular
 * aporta factor 1 y desaparece — sin denominadores que cuadrar.
 *
 * QUÉ CAMBIA FRENTE A v3, Y POR QUÉ
 *
 * 1. Se va el ancla global de 3×/semana, con su amortiguador y su ajuste por
 *    cuartil. La vara la pone el propio socio (rhythm.js), así que un box de
 *    CrossFit y un estudio boutique saltan a tiempos distintos sin calibrar nada.
 *
 * 2. Se va el multiplicador por antigüedad. Era una tasa base INCONDICIONAL
 *    multiplicando una probabilidad ya condicionada a la conducta, y su único
 *    efecto real era hundir a los veteranos: con ×0,85 sobre un máximo de 81, un
 *    socio de 12 meses NO PODÍA puntuar Crítico ni desapareciendo del todo.
 *    La antigüedad vive ahora fuera del número — en el valor en riesgo y en la
 *    explicación, que es donde informa en vez de esconder.
 *
 * 3. Se van los overrides de 30 y 60 días como PUNTUACIÓN. A los 30 días v3
 *    saltaba de ~55 a 95 en una noche, y le clavaba ese 95 al socio de 1×/mes
 *    que no había faltado a nada. Siguen existiendo como ESTADO (dormido /
 *    perdido) para ordenar la cola, pero el número lo pone la curva.
 *
 * 4. Se va la compuerta de asistencia. Existía para contener la señal de app,
 *    que ahora está acotada por construcción (12 pts y solo con base propia).
 *
 * 5. Sin presupuesto fijo de puntos. En v3 la racha (10) y las recompensas (4)
 *    estaban cableadas a cero: el modelo repartía 100 puntos de los que 14 no
 *    existían y las bandas se habían corrido solas, sin que nadie lo decidiera.
 */
import i18n from 'i18next';
import {
  sigGap, sigDrop, sigFloor, sigGapGeneric,
  sigHabit, sigOnboardingRecency, sigActivation,
  sigAppWithdrawal, protectionFactor,
} from './churnSignalsV4.js';
import { confidenceOf } from './rhythm.js';

const tt = (key, fallback, params = {}) =>
  i18n.t(key, { ns: 'pages', defaultValue: fallback, ...params });

export const MODEL_VERSION = 4;

// ── Parámetros ──
export const ONBOARDING_DAYS = 75;      // cuenta más nueva que esto → régimen de hábito
const GRACE_DAYS = 21;                  // cuenta más nueva que esto y sin pisar el gym → sin datos
const ACTIVATION_DEADLINE_DAYS = 21;    // matriculado y con CERO huella pasado esto → nunca activó
const LOST_DAYS = 60;                   // fuera de la cola de acción
const DORMANT_DAYS = 30;                // etiqueta «dormido»: sigue en la cola, sigue siendo recuperable

// Bandas. Más bajas que las de v3 (80/55/30) porque el número ya es PORCENTAJE
// del riesgo alcanzable, no puntos crudos — y alcanzable por cualquiera, sin
// techo por antigüedad.
export const BAND_CRITICAL = 70;
export const BAND_HIGH = 45;
export const BAND_MEDIUM = 25;

// Se conserva la forma para no romper a quien lo importe; en v4 todos los pesos
// son 1.0 y la calibración por gimnasio está descartada a propósito: necesita
// ~200 desenlaces etiquetados, que a 15/mes son trece meses, y sobreajustaría.
// Si algún día se calibra será AGRUPANDO gimnasios.
export const DEFAULT_WEIGHTS = {
  gap: 1.0, drop: 1.0, floor: 1.0,
  habit: 1.0, onboarding_recency: 1.0, activation: 1.0,
  app_withdrawal: 1.0,
};

/**
 * Score (y estado) → nivel de riesgo con sus props de pintado.
 * Firma intacta: la usan StatusBadge, riskTone, AdminChurn, ContactPanel…
 */
export function getRiskTier(score, state = 'scored') {
  if (state === 'insufficient_data') return {
    label: 'Not enough data', tier: 'insufficient_data', color: '#94A3B8',
    bg: 'rgba(148,163,184,0.12)', dot: '⚪',
    textClass: 'text-[#94A3B8]', bgClass: 'bg-[#94A3B8]/10', borderClass: 'border-[#94A3B8]/20',
  };
  if (state === 'paused') return {
    label: 'Paused', tier: 'paused', color: '#94A3B8',
    bg: 'rgba(148,163,184,0.12)', dot: '⏸️',
    textClass: 'text-[#94A3B8]', bgClass: 'bg-[#94A3B8]/10', borderClass: 'border-[#94A3B8]/20',
  };
  if (state === 'churned') return {
    label: 'Lost', tier: 'churned', color: '#6B7280',
    bg: 'rgba(107,114,128,0.14)', dot: '⚫',
    textClass: 'text-[#6B7280]', bgClass: 'bg-[#6B7280]/10', borderClass: 'border-[#6B7280]/20',
  };
  if (score >= BAND_CRITICAL) return {
    label: 'Critical', tier: 'critical', color: '#DC2626',
    bg: 'rgba(220,38,38,0.12)', dot: '🔴',
    textClass: 'text-[#DC2626]', bgClass: 'bg-[#DC2626]/10', borderClass: 'border-[#DC2626]/20',
  };
  if (score >= BAND_HIGH) return {
    label: 'High Risk', tier: 'high', color: '#EF4444',
    bg: 'rgba(239,68,68,0.12)', dot: '🔴',
    textClass: 'text-[#EF4444]', bgClass: 'bg-[#EF4444]/10', borderClass: 'border-[#EF4444]/20',
  };
  if (score >= BAND_MEDIUM) return {
    label: 'Medium Risk', tier: 'medium', color: '#F59E0B',
    bg: 'rgba(245,158,11,0.12)', dot: '🟡',
    textClass: 'text-[#F59E0B]', bgClass: 'bg-[#F59E0B]/10', borderClass: 'border-[#F59E0B]/20',
  };
  return {
    label: 'Low Risk', tier: 'low', color: '#10B981',
    bg: 'rgba(16,185,129,0.12)', dot: '🟢',
    textClass: 'text-[#10B981]', bgClass: 'bg-[#10B981]/10', borderClass: 'border-[#10B981]/20',
  };
}

/**
 * La frase. Sin ella el dueño no puede comprobar nada, y mientras no haya
 * desenlaces etiquetados suficientes (≈200, o sea meses) la comprobabilidad ES
 * la validación: «no suele pasar de 5 días y lleva 14» se verifica de memoria;
 * «riesgo 62» no se verifica de ninguna forma.
 */
export function buildExplanation(driver, m = {}) {
  const d = m.daysSinceLastVisit != null ? Math.round(m.daysSinceLastVisit)
    : (m.daysSinceLastActivity != null ? Math.round(m.daysSinceLastActivity) : null);
  const g = m.g90 != null ? Math.round(m.g90) : null;
  switch (driver) {
    case 'healthy':
      return tt('admin.churn.expl.healthy', 'Viene con constancia — se ve sano.');
    case 'gap':
      return d != null && g != null
        ? tt('admin.churn.expl.v4Gap', 'Lleva {{d}} días sin venir; no suele pasar de {{g}}.', { d, g })
        : tt('admin.churn.expl.attendanceDays', 'Lleva {{d}} días sin venir.', { d: d ?? 0 });
    case 'drop':
      return tt('admin.churn.expl.v4Drop', 'Sigue viniendo, pero mucho menos que antes: {{pct}}% menos.', {
        pct: Math.round((m.drop ?? 0) * 100),
      });
    case 'both':
      return tt('admin.churn.expl.v4Both', 'Viene menos y lleva más tiempo del suyo sin aparecer.');
    case 'volume':
      return tt('admin.churn.expl.v4Volume', 'Viene {{n}} veces por semana — poco para sostener el hábito.', {
        n: (m.weeklyRate ?? 0).toFixed(1),
      });
    case 'onboarding':
      return tt('admin.churn.expl.v4Onboarding', 'Socio nuevo que todavía no coge rutina.');
    case 'dormant':
      return d != null
        ? tt('admin.churn.expl.dormant', 'Sin actividad hace más de {{d}} días.', { d })
        : tt('admin.churn.expl.dormantNever', 'Sin entrenos ni visitas registradas.');
    case 'new':
      return tt('admin.churn.expl.new', 'Socio nuevo — todavía no hay datos para puntuar.');
    case 'never_activated': {
      const enrolled = m.accountAgeDays != null ? Math.round(m.accountAgeDays) : null;
      return enrolled != null
        ? tt('admin.churn.expl.neverActivated', 'Se matriculó hace {{d}} días y no ha pisado el gimnasio.', { d: enrolled })
        : tt('admin.churn.expl.neverActivatedShort', 'Nunca ha pisado el gimnasio.');
    }
    case 'paused':
      return tt('admin.churn.expl.paused', 'Membresía en pausa — avisos desactivados.');
    case 'churned':
      return d != null
        ? tt('admin.churn.expl.churned', 'Probablemente perdido — sin actividad hace más de {{d}} días.', { d })
        : tt('admin.churn.expl.churnedNever', 'Probablemente perdido — sin actividad registrada.');
    default:
      return tt('admin.churn.expl.attendanceGeneric', 'La asistencia ha bajado.');
  }
}

/** Qué está mandando en el score — alimenta la frase de arriba. */
function classifyDriver(terms, score, isOnboarding) {
  if (score < BAND_MEDIUM) return 'healthy';
  if (isOnboarding) return 'onboarding';
  const gap = terms.gap?.frac ?? 0;
  const drop = terms.drop?.frac ?? 0;
  const floor = terms.floor?.frac ?? 0;
  if (gap >= 0.15 && drop >= 0.15) return 'both';
  if (gap >= drop && gap > 0) return 'gap';
  if (drop > 0) return 'drop';
  if (floor > 0) return 'volume';
  return 'gap';
}

const state = (s, tier, extra) => ({
  score: s, state: extra?.stateName ?? tier, tier,
  riskTier: getRiskTier(s, extra?.tierState ?? tier),
  signals: {}, keySignals: [extra.key], keySignal: extra.key,
  primaryDriver: extra.driver, explanation: buildExplanation(extra.driver, extra.m || {}),
  trend: extra.trend || 'stable', confidence: extra.confidence || 'low',
  bonus: 0, attRisk: extra.attRisk ?? 0, engRisk: 0,
});

/**
 * @param {Object} m métricas del socio (las arma retention.js / la edge fn)
 * @param {Object} [weights]
 */
export function calculateChurnScore(m, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const rhythm = m.rhythm || { klass: 'none', visits: 0, g90: null, daysSinceLastVisit: null, weeklyRate: 0, drop: null };
  const accountAgeDays = m.accountAgeDays ?? 0;
  const dsv = rhythm.daysSinceLastVisit;
  const hasFootprint = rhythm.visits > 0;
  const confidence = confidenceOf(rhythm);

  // ── 1. Pausa ──
  if (m.isPaused) {
    return state(0, 'paused', { key: 'En pausa', driver: 'paused', m, confidence });
  }

  // ── 2. Perdido ── ANTES que «nunca activó»: si no, el que se apuntó hace tres
  // años y no pisó el gimnasio se quedaba en 78 Alto para siempre, ordenando por
  // encima de gente recuperable. La cola se llenaba de fantasmas.
  const neverCameAndOld = !hasFootprint && accountAgeDays >= LOST_DAYS;
  if ((dsv != null && dsv >= LOST_DAYS) || neverCameAndOld) {
    return state(100, 'churned', {
      key: 'Sin actividad', driver: neverCameAndOld ? 'never_activated' : 'churned',
      m: { ...m, daysSinceLastVisit: dsv }, trend: 'declining', attRisk: 100, confidence,
    });
  }

  // ── 3. Nunca activó ── matriculado el tiempo suficiente, huella cero.
  if (!hasFootprint && accountAgeDays >= ACTIVATION_DEADLINE_DAYS) {
    const weeksOverdue = Math.max(0, Math.floor((accountAgeDays - ACTIVATION_DEADLINE_DAYS) / 7));
    const s = Math.min(75, 55 + weeksOverdue * 3);
    return state(s, getRiskTier(s).tier, {
      stateName: 'scored', tierState: 'scored',
      key: 'Nunca activó', driver: 'never_activated', m, trend: 'declining', attRisk: s, confidence,
    });
  }

  // ── 4. Sin datos ── nunca Crítico, y el corte va por EDAD DE CUENTA, no por
  // antigüedad de membresía: importar un roster viejo no marca a nadie el día uno.
  if (!hasFootprint || accountAgeDays < GRACE_DAYS) {
    return state(0, 'insufficient_data', {
      key: 'Socio nuevo — sin datos suficientes', driver: 'new', m, confidence,
    });
  }

  // ── 5. Términos ──
  const isOnboarding = accountAgeDays < ONBOARDING_DAYS;
  const terms = {};

  if (isOnboarding) {
    terms.habit = sigHabit(rhythm.visits, accountAgeDays);
    terms.onboarding_recency = sigOnboardingRecency(dsv);
    const act = sigActivation(m.visitsIn21d ?? rhythm.visits, accountAgeDays);
    if (act) terms.activation = act;
  } else if (rhythm.g90 != null) {
    // Clase A o B: hay vara propia. La B la saca del intervalo más largo visto
    // en vez de un p90 (pocos datos), pero SIGUE SIENDO SUYA — y eso importa:
    // mandarla a la curva genérica hacía que el socio de 1×/3 semanas saliera
    // Crítico a los 30 días sin haber faltado a nada. Lo cazó una prueba.
    terms.gap = sigGap(dsv, rhythm.g90);
    const drop = sigDrop(rhythm.drop);
    if (drop) terms.drop = drop;
    terms.floor = sigFloor(rhythm.weeklyRate);
  } else {
    // Clase C: menos de 3 intervalos. Curva genérica, y la confianza lo dice.
    terms.gap = sigGapGeneric(dsv);
    terms.floor = sigFloor(rhythm.weeklyRate);
  }

  // La lente de app solo existe para quien usaba la app. Ausente no vale 0:
  // desaparece del producto y no roza el resultado.
  const app = sigAppWithdrawal(m.appActivity?.baseline, m.appActivity?.recent);
  if (app) terms.app_withdrawal = app;

  // ── 6. Combinar: OR-ruidoso ──
  //
  //     riesgo = 1 − Π(1 − señal)
  //
  // No una suma normalizada: al dividir entre la suma de máximos, el socio con
  // asistencia PERFECTA que de pronto desaparece tenía una sola señal encendida
  // y las demás a cero, así que su techo quedaba en 44 y no podía ser Crítico.
  // Ese es el mismo error del multiplicador de antigüedad de v3, por otra puerta,
  // y lo cazó una prueba. Aquí ninguna señal diluye a otra, y una que no se puede
  // calcular aporta factor 1 y simplemente no participa.
  let survive = 1;
  for (const [k, term] of Object.entries(terms)) {
    survive *= (1 - Math.min(1, term.frac * (w[k] ?? 1)));
  }
  const pct = (1 - survive) * 100;

  // ── 7. Protección: proporcional, no restando puntos ──
  // v3 restaba hasta 20 planos: sobre un 25 lo dejaba en 5 y sobre un 90 no se
  // notaba, al revés de lo que hace falta. Estar en un reto no hace que tres
  // semanas sin aparecer estén bien; solo hace el caso algo menos grave.
  const { factor } = protectionFactor({
    activeChallenge: m.activeChallenge ?? false,
    activeReferrer: m.activeReferrer ?? false,
    recentPRs: m.recentPRs ?? false,
    activeSocial: m.activeSocial ?? false,
  });

  const score = Math.round(Math.max(0, Math.min(100, pct * (1 - factor))) * 10) / 10;

  // «Dormido» es una ETIQUETA para ordenar la cola, ya no una puntuación. El de
  // 1×/mes a los 30 días sale bajo porque no ha faltado a nada — v3 le clavaba 95.
  const stateName = dsv != null && dsv >= DORMANT_DAYS ? 'dormant' : 'scored';

  const ctx = { ...m, daysSinceLastVisit: dsv, g90: rhythm.g90, drop: rhythm.drop, weeklyRate: rhythm.weeklyRate };
  const driver = classifyDriver(terms, score, isOnboarding);
  const keySignals = Object.values(terms)
    .filter((t) => t.frac > 0)
    .sort((a, b) => b.frac - a.frac)
    .slice(0, 3)
    .map((t) => t.label);
  if (keySignals.length === 0) keySignals.push(tt('admin.churnSignals.v4Healthy', 'Todo en orden'));

  return {
    score,
    state: stateName,
    tier: getRiskTier(score).tier,
    riskTier: getRiskTier(score),
    signals: terms,
    keySignals,
    keySignal: keySignals[0],
    primaryDriver: driver,
    explanation: buildExplanation(driver, ctx),
    trend: rhythm.drop != null && rhythm.drop > 0.15 ? 'declining'
      : rhythm.drop != null && rhythm.drop < -0.15 ? 'improving' : 'stable',
    confidence,
    bonus: -Math.round(pct * factor * 10) / 10,
    attRisk: Math.round(pct * 10) / 10,
    engRisk: terms.app_withdrawal?.score ?? 0,
    confidenceKlass: rhythm.klass,
  };
}

export function calculateChurnScoreSimple(m, weights) {
  return calculateChurnScore(m, weights).score;
}

/**
 * Arranque en frío (adminQueries.fetchChurnFallback) cuando la tubería no
 * devuelve nada. Bandas alineadas con getRiskTier (70/45/25).
 */
export function estimateChurnScoreFallback(daysInactive, recentWorkouts, neverActive, tenureDays = null, lifetimeEvents = null) {
  if (neverActive
      || (tenureDays != null && tenureDays < GRACE_DAYS)
      || (lifetimeEvents != null && lifetimeEvents < 3)) {
    return { score: 0, risk_tier: 'insufficient_data', key_signals: ['Socio nuevo — sin datos suficientes'], state: 'insufficient_data' };
  }
  let score;
  if (daysInactive > 45) score = 95;
  else if (daysInactive > 21) score = recentWorkouts === 0 ? 78 : 60;
  else if (daysInactive > 10) score = recentWorkouts === 0 ? 48 : 32;
  else score = Math.max(0, 18 - recentWorkouts * 4);
  score = Math.min(100, Math.max(0, score));
  const risk_tier = score >= BAND_CRITICAL ? 'critical' : score >= BAND_HIGH ? 'high' : score >= BAND_MEDIUM ? 'medium' : 'low';
  const key_signals = [];
  if (daysInactive > 30) key_signals.push(`Sin actividad hace ${daysInactive}+ días`);
  else if (daysInactive > 14) key_signals.push('Sin actividad hace 14+ días');
  if (recentWorkouts === 0) key_signals.push('Sin entrenos en 14 días');
  return { score, risk_tier, key_signals, state: 'scored' };
}
