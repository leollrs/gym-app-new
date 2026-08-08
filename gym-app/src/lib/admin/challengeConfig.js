/**
 * Los dos ejes de un reto, y qué necesita cada combinación para poder puntuar.
 *
 * EJE 1 · QUÉ SE MIDE (`type`) — entrenos, volumen, récords, un levantamiento,
 * equipo, suma de récords.
 *
 * EJE 2 · CÓMO SE GANA (`format`):
 *   · `competitive` — tabla y podio. Cobran los tres primeros.
 *   · `completion`  — una meta. Cobra TODO el que llegue, sin importar cuándo.
 *
 * Estaban mezclados en `type`, y por eso «ven 12 veces este mes» no cabía en
 * ningún sitio: con el podio, de treinta que cumplen cobran tres. La misma
 * métrica da dos retos completamente distintos según el formato.
 *
 * EL OTRO FALLO QUE ESTO ARREGLA. El formulario guardaba `name`, `type`,
 * `description`, `cover_preset` y las fechas — nada más. Pero el que puntúa
 * (`SessionSummary.jsx`) lee columnas que el formulario nunca escribía:
 *
 *   type === 'specific_lift' && c.exercise_id     ← exercise_id siempre NULL
 *   type === 'milestone' && c.exercise_ids?.length ← exercise_ids siempre NULL
 *
 * Resultado: el reto corría semanas con la tabla en cero y al final repartía
 * los premios sobre una tabla de ceros. `missingConfig` lo comprueba antes de
 * guardar y `buildChallengePayload` lo escribe.
 */

export const FORMATS = ['competitive', 'completion'];

// Los tres que puntúan sin configurar nada: cada entreno completado dispara su
// delta directamente en SessionSummary.
export const SIMPLE_TYPES = ['consistency', 'volume', 'pr_count'];

export const CHALLENGE_TYPES = [
  { value: 'consistency',   needs: [], tone: '#3FBF7F' },
  { value: 'volume',        needs: [], tone: '#FDA904' },
  { value: 'pr_count',      needs: [], tone: '#EF4444' },
  { value: 'specific_lift', needs: ['exercise_id'],  tone: '#8B7CF6' },
  { value: 'team',          needs: ['team_size'],    tone: '#4B9DF0' },
  // El club necesita RUTINA además de los levantamientos: «llega a 1000 lbs» sin
  // decir cómo es un número, no un reto. Los otros tipos no la piden porque
  // «entrena más» ya se explica solo.
  { value: 'milestone',     needs: ['exercise_ids', 'plan'], tone: '#22C7C7' },
  // Asistencia. No necesita ajustes porque no se puntúa aquí: lo cuenta un
  // trigger sobre `check_ins` (migración 0710), que es la única forma de contar
  // al socio que viene y no registra el entreno.
  { value: 'check_in',      needs: [], tone: '#E8639B' },
];

// Cómo se puntúa un levantamiento específico. Los dos los entiende
// SessionSummary; no hay un tercero, así que no se ofrece un tercero.
export const LIFT_METRICS = ['volume', '1rm'];

// Qué se mide dentro de un reto por equipos. Mismos tres que los individuales,
// que son exactamente los que SessionSummary sabe convertir en delta.
export const TEAM_METRICS = ['consistency', 'volume', 'pr_count'];

// `team_size` es CUÁNTOS CABEN POR EQUIPO, no cuántos equipos hay. Es lo que
// consume `TeamFormationModal` como tope al armar el equipo. Sin escribirlo se
// quedaba en 2 por defecto y la ficha del equipo mostraba «N/?».
export const TEAM_SIZES = [2, 3, 4, 6];

export const DURATION_PRESETS = [7, 14, 30];

export const typeMeta = (value) => CHALLENGE_TYPES.find(t => t.value === value) || null;

export const isCompletion = (form) => form?.format === 'completion';

/** ¿Este reto EXIGE decirle al socio con qué entrenar? */
export const needsPlan = (form) =>
  (typeMeta(form?.type)?.needs || []).includes('plan') || !!form?.requiresProgram;

/** Los ajustes que faltan para que el reto pueda puntuar Y pagar. Vacío = puede correr. */
export function missingConfig(form) {
  const meta = typeMeta(form?.type);
  if (!meta) return ['type'];
  const needs = [...meta.needs];
  // Una plantilla puede exigir un PROGRAMA concreto donde el tipo solo pediría
  // una rutina: «transformación en 21 días» sin programa es un titular sin plan.
  if (form.requiresProgram) needs.push('program_id');
  const out = needs.filter((k) => {
    const v = form[k];
    if (k === 'exercise_ids') return !Array.isArray(v) || v.length === 0;
    // «plan» = rutina O programa: cualquiera de los dos le dice al socio qué hacer.
    if (k === 'plan') return !form.workout_template_id && !form.program_id;
    return !v;
  });
  // La meta no depende del TIPO sino del FORMATO: un reto de cumplimiento sin
  // meta no tiene condición de victoria, y uno competitivo no la necesita.
  if (isCompletion(form) && !(Number(form.milestone_target) > 0)) out.push('milestone_target');
  return out;
}

/**
 * La fecha de fin a partir del día de inicio y una duración en días.
 *
 * Termina a las 23:59:59 LOCALES del último día, no a la hora en que se creó:
 * un reto de 7 días creado un lunes a las 3 de la tarde acababa el lunes
 * siguiente a las 3 de la tarde, así que el último día contaba a medias y el
 * que entrenaba por la noche se quedaba fuera sin saber por qué.
 */
export function endFromStart(startDate, days) {
  if (!startDate) return null;
  const [y, m, d] = String(startDate).slice(0, 10).split('-').map(Number);
  const end = new Date(y, m - 1, d);
  end.setDate(end.getDate() + Math.max(1, days || 1) - 1);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Días que cubre un reto ya guardado, para que editarlo no reinvente la rueda. */
export function daysBetween(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const a = new Date(startISO), b = new Date(endISO);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const n = Math.round((day(b) - day(a)) / 86400000) + 1;
  return n > 0 ? n : null;
}

/** El día de inicio a medianoche local. Igual que arriba: no a la hora de crearlo. */
export function startAt(startDate) {
  if (!startDate) return null;
  const [y, m, d] = String(startDate).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * La fila que se guarda.
 *
 * Los ajustes de OTROS tipos se ponen a NULL a propósito: al editar un reto y
 * cambiarle el tipo, dejar el `exercise_id` viejo puesto significa que la fila
 * dice una cosa y el reto hace otra.
 */
export function buildChallengePayload(form, { rewardData }) {
  const type = form.type;
  const format = FORMATS.includes(form.format) ? form.format : 'competitive';
  const isLift = type === 'specific_lift';
  const isTeam = type === 'team';
  const isMilestone = type === 'milestone';

  let scoring_metric = null;
  if (isLift) scoring_metric = LIFT_METRICS.includes(form.scoring_metric) ? form.scoring_metric : 'volume';
  else if (isTeam) scoring_metric = TEAM_METRICS.includes(form.scoring_metric) ? form.scoring_metric : 'consistency';

  return {
    name: form.name.trim(),
    type,
    format,
    description: form.description || '',
    cover_preset: form.cover_preset,
    reward_description: rewardData,
    start_date: startAt(form.start_date)?.toISOString(),
    end_date: endFromStart(form.start_date, form.days)?.toISOString(),
    exercise_id: isLift ? form.exercise_id : null,
    exercise_ids: isMilestone ? form.exercise_ids : null,
    // La meta la manda el formato, no el tipo. Un club competitivo («quién
    // tiene la suma más alta») es legítimo y no lleva meta.
    milestone_target: format === 'completion' ? Number(form.milestone_target) : null,
    team_size: isTeam ? form.team_size : null,
    scoring_metric,
    // La rutina que el reto propone. Vale para cualquier tipo: un reto de
    // asistencia también puede sugerir qué hacer al llegar.
    workout_template_id: form.workout_template_id || null,
    program_id: form.program_id || null,
  };
}

/**
 * Cuántos premios pide el formato.
 *
 * Competitivo: tres, ni uno más — `award_challenge_prizes` reparte con LIMIT 3.
 * Cumplimiento: uno, porque no hay primero ni tercero: o cumpliste o no.
 */
export const rewardSlots = (form) => (isCompletion(form) ? 1 : 3);

/**
 * En qué se cuenta la meta. «12» no significa nada; «12 entrenos» sí.
 * Sale de la métrica efectiva, que en equipo y en levantamiento vive en
 * `scoring_metric` y no en `type`.
 */
export function metricUnit(form) {
  const t = form?.type;
  if (t === 'volume') return 'lbs';
  if (t === 'consistency') return 'workouts';
  if (t === 'pr_count') return 'prs';
  if (t === 'check_in') return 'visits';
  if (t === 'milestone') return 'lbs';
  if (t === 'specific_lift') return (form.scoring_metric === '1rm') ? 'prs' : 'lbs';
  if (t === 'team') {
    const m = form.scoring_metric || 'consistency';
    return m === 'volume' ? 'lbs' : m === 'pr_count' ? 'prs' : 'workouts';
  }
  return 'points';
}
