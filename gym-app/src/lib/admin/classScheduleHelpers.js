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
