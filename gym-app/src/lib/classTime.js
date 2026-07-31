// classTime.js
// -----------------------------------------------------------------------------
// When does a scheduled class actually END?
//
// Two places worked this out independently — the Classes day strip and the
// Dashboard "you have a class today" banner — and both made the same mistake:
// they took `end_time` (a bare TIME like "18:30"), applied it to *today*, and
// compared. That is right for the ordinary case and wrong for the one that
// matters most:
//
//   A class that runs 23:00 → 00:30 stores end_time = "00:30". Applied to its
//   own start date, that instant is BEFORE the class begins. So a late class
//   read as "Finalizada" all day, was struck through before anyone attended,
//   and its detail sheet replaced Cancel with "Clase finalizada" for a booking
//   the member could still legitimately cancel.
//
// `gym_class_schedules.end_time` is a TIME and `booking_date` a DATE (0157), so
// the crossing is only recoverable by comparing the two clock times: an end
// that is at or before the start means the class runs past midnight.
// -----------------------------------------------------------------------------

/** "18:30" | "18:30:00" → minutes since midnight, or null if unparseable. */
function toMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/**
 * The local Date at which a class occurrence ends.
 *
 * @param dateStr    'YYYY-MM-DD' — the occurrence's own date. Parsed by hand:
 *                   `new Date('2026-08-30')` is read as UTC midnight and lands
 *                   on the previous day for anyone west of GMT, which is all of
 *                   Puerto Rico.
 * @param startTime  'HH:MM' — needed only to detect a midnight crossing.
 * @param endTime    'HH:MM'
 * @returns Date, or null when there isn't enough information to say.
 */
export function classEndsAt(dateStr, startTime, endTime) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  const end = toMinutes(endTime);
  if (!d || end == null) return null;

  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), 0, 0, 0, 0);
  at.setMinutes(end);

  // Ends at or before it starts → it ran past midnight into the next day.
  const start = toMinutes(startTime);
  if (start != null && end <= start) at.setDate(at.getDate() + 1);

  return at;
}

/**
 * Has this occurrence finished?
 * Returns false when the schedule doesn't say — never claim a class is over on
 * missing data, because that is what hides the Cancel button.
 */
export function classHasEnded(dateStr, startTime, endTime, now = Date.now()) {
  const at = classEndsAt(dateStr, startTime, endTime);
  return at ? at.getTime() < now : false;
}
