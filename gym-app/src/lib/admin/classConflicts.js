// Choques de horario y proyección de sesiones.
//
// Lo que el formulario de clases no sabía decir: que la franja que acabas de
// escribir se solapa con otra clase, y sobre todo que **el mismo instructor ya
// está dando otra cosa a esa hora**. Eso no se descubría al guardar sino el
// martes, cuando dos grupos aparecen en la misma sala.
//
// Sin React ni i18n a propósito: se prueba sola y la puede usar cualquiera.

/** `day_of_week` es 0=domingo (Postgres y toda la app). NO reindexar. */
export const WEEK_STARTS_SUNDAY = true;

/** "HH:MM" o "HH:MM:SS" → minutos desde medianoche. */
export function toMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** Los ids de instructor de una clase, vengan de la tabla puente o del campo viejo. */
export function trainerIdsOf(cls) {
  const fromJunction = (cls?.gym_class_trainers || []).map(r => r?.trainer?.id).filter(Boolean);
  if (fromJunction.length) return fromJunction;
  return cls?.trainer_id ? [cls.trainer_id] : [];
}

/**
 * ¿Con qué choca esta franja?
 *
 * @param {{day_of_week:number|null, specific_date:string|null, start_time:string}} slot
 * @param {number} durationMinutes
 * @param {Array} allClasses  clases del gimnasio con `gym_class_schedules`
 * @param {{ excludeClassId?: string, trainerIds?: string[] }} opts
 * @returns {Array<{ classId, name, instructorClash: boolean }>}
 */
export function findConflicts(slot, durationMinutes, allClasses = [], opts = {}) {
  const start = toMinutes(slot?.start_time);
  if (start == null || !durationMinutes) return [];
  const end = start + durationMinutes;
  const mine = new Set(opts.trainerIds || []);

  const out = [];
  for (const cls of allClasses) {
    if (!cls || cls.id === opts.excludeClassId) continue;
    if (cls.is_active === false) continue;

    const theirs = trainerIdsOf(cls);
    const instructorClash = theirs.some(id => mine.has(id));

    for (const s of cls.gym_class_schedules || []) {
      // Una franja recurrente y una de fecha concreta solo pueden chocar si esa
      // fecha cae en ese día de la semana; se compara en el mismo terreno.
      const sameSlotDay = slot.specific_date
        ? (s.specific_date
          ? s.specific_date === slot.specific_date
          : s.day_of_week === new Date(`${slot.specific_date}T00:00:00`).getDay())
        : (s.specific_date
          ? new Date(`${s.specific_date}T00:00:00`).getDay() === slot.day_of_week
          : s.day_of_week === slot.day_of_week);
      if (!sameSlotDay) continue;

      const oStart = toMinutes(s.start_time);
      if (oStart == null) continue;
      const oEnd = toMinutes(s.end_time) ?? (oStart + (cls.duration_minutes || 60));
      if (!overlaps(start, end, oStart, oEnd)) continue;

      out.push({ classId: cls.id, name: cls.name, instructorClash });
      break; // una mención por clase basta
    }
  }
  // El choque de instructor primero: es el que de verdad no se puede resolver
  // cambiando de sala.
  return out.sort((a, b) => Number(b.instructorClash) - Number(a.instructorClash));
}

/**
 * Las fechas en que esta clase va a ocurrir dentro de los próximos `weeks`.
 * Es lo que convierte «3 franjas» en «12 sesiones», que es lo que el dueño
 * está decidiendo de verdad.
 */
export function projectSessions(slots = [], { weeks = 4, from = new Date() } = {}) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const days = weeks * 7;
  const out = [];

  for (const slot of slots) {
    if (slot?.specific_date) {
      const d = new Date(`${slot.specific_date}T00:00:00`);
      const diff = Math.round((d - start) / 86400000);
      if (diff >= 0 && diff < days) out.push({ date: d, slot });
      continue;
    }
    if (slot?.day_of_week == null) continue;
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d.getDay() === slot.day_of_week) out.push({ date: d, slot });
    }
  }

  return out.sort((a, b) => a.date - b.date
    || (toMinutes(a.slot.start_time) ?? 0) - (toMinutes(b.slot.start_time) ?? 0));
}

/** Rejilla de 5 semanas que empieza EN DOMINGO, para el mapa del panel derecho. */
export function calendarGrid(from = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const start = new Date(today);
  start.setDate(start.getDate() - today.getDay()); // domingo de esta semana
  return Array.from({ length: 35 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}
