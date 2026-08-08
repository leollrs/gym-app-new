/**
 * Small helpers + constants shared across the AdminClasses surfaces: the
 * create/edit form, the detail modal, the schedule view, and the
 * cron-equivalent end-time computation when changing a class's duration.
 *
 * Pure functions, no React. The display helpers (`slotDayLabel`,
 * `format12h`) format for the UI; `addMinutes` returns a Postgres-time
 * compatible string and is used by the mutation that re-syncs slot
 * end_times when the parent class's duration changes.
 *
 * `DAYS_OF_WEEK` lives here so the form's day-picker, the schedule
 * label, and the duration-sync mutation all reference the same value
 * → label_key mapping (matches Postgres day_of_week 0..6 = Sun..Sat).
 */

export const DAYS_OF_WEEK = [
  { value: 0, labelKey: 'days.sunday' },
  { value: 1, labelKey: 'days.monday' },
  { value: 2, labelKey: 'days.tuesday' },
  { value: 3, labelKey: 'days.wednesday' },
  { value: 4, labelKey: 'days.thursday' },
  { value: 5, labelKey: 'days.friday' },
  { value: 6, labelKey: 'days.saturday' },
];

// Format a schedule slot label (recurring vs specific date)
export function slotDayLabel(slot, dayLabelFn, lang) {
  if (slot.specific_date) {
    const d = new Date(slot.specific_date + 'T00:00:00');
    return d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return dayLabelFn(slot.day_of_week);
}

// Convert "HH:MM" (24h, possibly with seconds) → "h:mm AM/PM" for display.
// Returns the input unchanged if it isn't parseable.
export function format12h(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1; // 0→12, 13→1, etc.
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Las siete iniciales de los días, en el idioma que toque y empezando en
 * DOMINGO. Estaban cableadas a «D L M X J V S», que en inglés no es nada.
 * CLDR ya trae la forma corta de cada idioma (es: D L M X J V S · en: S M T W
 * T F S), así que se pide en vez de inventarla.
 */
export function dayInitials(lang) {
  // 2026-02-01 fue domingo; solo hace falta un domingo cualquiera de ancla.
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 1, 1 + i).toLocaleDateString(lang || undefined, { weekday: 'narrow' }).toUpperCase());
}

// Normaliza "9:00", "09:00" y "09:00:00" a "09:00" para poder comparar.
const hhmm = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const [h, m] = timeStr.split(':');
  return `${String(parseInt(h, 10) || 0).padStart(2, '0')}:${(m || '00').slice(0, 2)}`;
};

// La hora de fin REAL de la franja. Cae a la duración de la clase solo si la
// fila no la trae — hay clases viejas cuyas franjas duran cosas distintas y
// pintar todas con la duración de la clase era mentir sobre lo guardado.
export function slotEnd(slot, fallbackDuration) {
  return slot?.end_time ? hhmm(slot.end_time) : hhmm(addMinutes(slot?.start_time, fallbackDuration));
}

/**
 * Un «horario», para quien llena el formulario, no es una fila: es
 * «lunes, miércoles y viernes a las 9». La tabla guarda una fila por día, así
 * que tres días eran tres tarjetas repitiendo la misma hora, y ocho franjas
 * llenaban la pantalla de ruido.
 *
 * Aquí se vuelven a juntar: misma hora de inicio, misma hora de fin y mismo
 * instructor → un solo grupo con sus días. Las fechas sueltas nunca se agrupan;
 * cada una es su propio horario.
 *
 * Devuelve grupos, no filas — pero cada grupo conserva sus filas en `rows`,
 * que es lo que hay que borrar o actualizar en la base.
 */
export function groupSlots(slots, fallbackDuration) {
  const byKey = new Map();
  (slots || []).forEach((slot, index) => {
    const start = hhmm(slot.start_time);
    const end = slotEnd(slot, fallbackDuration);
    const trainer = slot.trainer_id || '';
    const key = slot.specific_date
      ? `d|${slot.specific_date}|${start}|${end}|${trainer}|${index}`
      : `r|${start}|${end}|${trainer}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.days.push(slot.day_of_week);
      existing.rows.push({ slot, index });
      return;
    }
    byKey.set(key, {
      key,
      kind: slot.specific_date ? 'date' : 'recurring',
      specific_date: slot.specific_date || null,
      days: slot.specific_date ? [] : [slot.day_of_week],
      start_time: start,
      end_time: end,
      trainer_id: slot.trainer_id || null,
      rows: [{ slot, index }],
    });
  });

  return [...byKey.values()]
    .map(g => ({ ...g, days: [...g.days].sort((a, b) => a - b) }))
    .sort((a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      (a.days[0] ?? 9) - (b.days[0] ?? 9) ||
      String(a.specific_date).localeCompare(String(b.specific_date)));
}

// Add minutes to a "HH:MM[:SS]" 24h string, returning "HH:MM:SS" suitable
// for inserts into a Postgres `time` column. Caps at 23:59:59.
export function addMinutes(timeStr, mins) {
  if (!timeStr || typeof timeStr !== 'string') return timeStr;
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr;
  let total = h * 60 + m + (mins || 0);
  if (total >= 24 * 60) total = 24 * 60 - 1;
  if (total < 0) total = 0;
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}:00`;
}
