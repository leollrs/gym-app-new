// Program week math.
//
// The user thinks of "this week" as the calendar week (Sun → Sat) that
// contains today. Anniversary math (`floor(days_since_start / 7) + 1`) breaks
// for any mid-week signup: a Thursday-start program kept the user on "Week 1"
// through the following Wednesday, even though Sunday's roll-over should have
// moved them into Week 2 already.
//
// `getProgramWeekNum` returns the 1-indexed calendar-week index since the
// week containing `programStart`. Pair it with
// `getTotalProgramWeeks(program)` so the "Week X of Y" pill stays consistent.

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const startOfCalendarWeek = (d) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay()); // Sunday-anchored
  return x;
};

export function getProgramWeekNum(programStart, today = new Date()) {
  if (!programStart) return 0;
  const startSunday = startOfCalendarWeek(programStart);
  const todayMid = startOfDay(today);
  const days = Math.floor((todayMid - startSunday) / 86400000);
  return Math.floor(days / 7) + 1;
}

export function getTotalProgramWeeks(program) {
  if (!program) return 0;
  return (
    program.schedule_map?.total_calendar_weeks
    ?? program.duration_weeks
    ?? (program.expires_at && program.program_start
      ? Math.ceil(
          (new Date(program.expires_at) - new Date(program.program_start)) /
          (7 * 86400000)
        )
      : 0)
  );
}

// Convenience: clamped current week (1..total).
export function getCurrentWeekClamped(program, today = new Date()) {
  if (!program) return 0;
  const total = getTotalProgramWeeks(program);
  const raw = getProgramWeekNum(program.program_start, today);
  return Math.min(Math.max(raw, 1), total || raw);
}
