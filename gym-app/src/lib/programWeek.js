// Program week math.
//
// Anniversary-based: Week 1 = the first 7 days from `programStart`, Week 2 the
// next 7, and so on. A freshly-created program holds Week 1 for a full week
// instead of jumping to Week 2 at the next calendar Sunday — the old
// calendar-week math bumped a Saturday signup to Week 2 the very next day, and
// a timezone-shifted start could read Week 2 immediately on creation.
//
// Pair with `getTotalProgramWeeks(program)` so the "Week X of Y" pill stays
// consistent. NOTE: pause/resume backdating in personalProgramService.js
// mirrors this math — keep the two in sync.

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export function getProgramWeekNum(programStart, today = new Date()) {
  if (!programStart) return 0;
  const startMid = startOfDay(programStart);
  const todayMid = startOfDay(today);
  const days = Math.floor((todayMid - startMid) / 86400000);
  // Clamp to >=1 so a start that parses a day ahead (timezone edge) never reads week 0.
  return Math.max(1, Math.floor(days / 7) + 1);
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
