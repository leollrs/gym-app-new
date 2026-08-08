/**
 * «Solo ese día»: la excepción con fecha propia que se impone a la semana.
 *
 * POR QUÉ EXISTE. `workout_schedule` es recurrente — `(día_de_la_semana,
 * rutina)` y un único por día — y no hay ninguna columna de fecha en todo el
 * sistema de entrenos. Sin esto, «hazlo hoy» solo se podía traducir a «hazlo
 * todos los miércoles», que es una cosa muy distinta y bastante más cara.
 *
 * TODO EL QUE PINTE UN DÍA DEBE PASAR POR AQUÍ. Si un sitio lee
 * `schedule[fecha.getDay()]` a pelo, ese sitio enseñará la rutina recurrente y
 * contradirá al de al lado — que es peor que no tener excepciones.
 */
import { supabase } from './supabase';
import { dateKey } from './dateKey';

/** Clave de fecha LOCAL. Nunca `toISOString()`: eso convierte a UTC y en Puerto Rico adelanta el día a partir de las 8 de la noche. */
export { dateKey };

/**
 * Las excepciones de una ventana alrededor de hoy.
 * Devuelve un OBJETO plano, no un Map: esto acaba en estado que se persiste, y
 * `JSON.stringify(Map)` da `{}` — ya ha mordido dos veces en este repo.
 */
export async function fetchOverrides(profileId, { daysBack = 7, daysAhead = 21 } = {}) {
  if (!profileId) return {};
  const from = new Date(); from.setDate(from.getDate() - daysBack);
  const to = new Date();   to.setDate(to.getDate() + daysAhead);
  const { data, error } = await supabase
    .from('workout_schedule_overrides')
    .select('scheduled_date, routine_id, source, source_id')
    .eq('profile_id', profileId)
    .gte('scheduled_date', dateKey(from))
    .lte('scheduled_date', dateKey(to));
  if (error) return {};
  const out = {};
  (data || []).forEach(r => {
    out[String(r.scheduled_date).slice(0, 10)] = {
      routineId: r.routine_id, source: r.source || null, sourceId: r.source_id || null,
    };
  });
  return out;
}

/**
 * Qué rutina toca en una fecha. La excepción gana; si no hay, lo recurrente.
 *
 * @param date        Date
 * @param schedule    mapa recurrente `{ [day_of_week]: { routineId } }`
 * @param overrides   mapa por fecha `{ 'YYYY-MM-DD': { routineId } }`
 * @returns `{ routineId, isOverride, source }` o null si ese día no toca nada
 */
export function resolveForDate(date, schedule, overrides) {
  if (!date) return null;
  const ov = overrides?.[dateKey(date)];
  if (ov?.routineId) return { routineId: ov.routineId, isOverride: true, source: ov.source || null };
  const rec = schedule?.[date.getDay()];
  if (rec?.routineId) return { routineId: rec.routineId, isOverride: false, source: null };
  return null;
}

/** Poner una rutina en UNA fecha. Reemplaza la excepción anterior de ese día, si la había. */
export async function setOverride({ profileId, gymId, date, routineId, source = null, sourceId = null }) {
  const { error } = await supabase
    .from('workout_schedule_overrides')
    .upsert({
      profile_id: profileId,
      gym_id: gymId || null,
      scheduled_date: dateKey(date),
      routine_id: routineId,
      source, source_id: sourceId,
    }, { onConflict: 'profile_id,scheduled_date' });
  return { error };
}

/** Quitar la excepción de una fecha: ese día vuelve a lo que diga la semana. */
export async function clearOverride({ profileId, date }) {
  const { error } = await supabase
    .from('workout_schedule_overrides')
    .delete()
    .eq('profile_id', profileId)
    .eq('scheduled_date', dateKey(date));
  return { error };
}
