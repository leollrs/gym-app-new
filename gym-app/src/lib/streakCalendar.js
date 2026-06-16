// Pure streak-calendar builder — the single source of truth for the member
// streak. Extracted verbatim from Navigation's loadStreakDays so every surface
// derives the SAME number from the SAME rule.
//
// Why this exists: streak_cache.current_streak_days drifts from reality (backend
// cron edge cases, deleted sessions, stale data). The CheckIn page used to read
// that cached value directly while Navigation (flame pill + modal + Apple Watch)
// derived the streak from the calendar — so they disagreed (CheckIn showed a
// "made up" number). Both now call buildStreakCalendar().
//
// RULE (per product spec): every day counts toward the streak — trained, rest,
// frozen, and gym-closed days all add +1. Today (no workout yet) neither counts
// nor breaks. The streak ends only at a `missed` day or account creation. The
// chain must contain at least one trained day.
//
// Inputs are the raw Supabase `.data` arrays (any may be null/undefined):
//   sessions  — workout_sessions: { completed_at }    (status='completed')
//   cardio    — cardio_sessions:  { completed_at, started_at }
//   profile   — profiles:         { preferred_training_days, created_at }
//   gymHours  — gym_hours:        { day_of_week, is_closed }
//   closures  — gym_closures:     { closure_date }
//   holidays  — gym_holidays:     { date, is_closed }
//   freezes   — streak_freezes:   { month, used_count, max_allowed, frozen_dates }
//   lang      — 'es' | 'en' (month label locale)
//   now       — Date (defaults to new Date())
//
// Returns { months, currentStreak, longestStreak, freezeStatus }.
export function buildStreakCalendar({
  sessions,
  cardio,
  profile,
  gymHours,
  closures,
  holidays,
  freezes,
  lang = 'en',
  now = new Date(),
}) {
  // Helper: date → 'YYYY-MM-DD'
  const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Set of all dates with a completed workout OR cardio session
  const workoutDates = new Set(
    (sessions || []).map(s => toKey(new Date(s.completed_at)))
  );
  for (const c of (cardio || [])) {
    const ts = c.completed_at || c.started_at;
    if (ts) workoutDates.add(toKey(new Date(ts)));
  }
  // Sorted ascending — used by the "fallback rest window" logic below to
  // find the nearest training day for any given gap day.
  const sortedWorkoutKeys = [...workoutDates].sort();

  // Account creation date — nothing before this counts
  const createdAt = profile?.created_at ? new Date(profile.created_at) : new Date(now);
  const createdAtKey = toKey(createdAt);

  // Rest days: days the user is NOT scheduled to train
  const DAY_MAP = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  const prefDays = profile?.preferred_training_days || [];
  const restDowSet = new Set(
    prefDays.length > 0 ? [0, 1, 2, 3, 4, 5, 6].filter(d => !prefDays.some(name => DAY_MAP[name] === d)) : []
  );

  // Gym closed days (recurring day-of-week)
  const gymClosedSet = new Set(
    (gymHours || []).filter(h => h.is_closed).map(h => h.day_of_week)
  );

  // Specific closure dates (gym_closures + gym_holidays)
  const closureDateSet = new Set([
    ...(closures || []).map(c => c.closure_date),
    ...(holidays || []).filter(h => h.is_closed).map(h => h.date),
  ]);

  // Frozen dates from DB (keyed by date string)
  const frozenDateSet = new Set();
  const freezesByMonth = {};
  for (const f of (freezes || [])) {
    freezesByMonth[f.month] = f;
    for (const d of (f.frozen_dates || [])) {
      frozenDateSet.add(typeof d === 'string' ? d : toKey(new Date(d)));
    }
  }

  const today = new Date(now);
  const todayKey = toKey(today);

  // ── CALENDAR GENERATION ────────────────────────────────────
  // Show ALL days in each month (including future days, styled differently).
  const startDate = new Date(createdAt.getFullYear(), createdAt.getMonth(), 1);
  const months = [];
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);

  while (cursor >= startDate) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthDays = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const key = toKey(d);
      const dow = d.getDay();
      const isToday = key === todayKey;
      const isFuture = d > today;
      const hasWorkout = workoutDates.has(key);
      const beforeAccount = key < createdAtKey;
      const isFrozen = frozenDateSet.has(key);
      const isClosureDate = closureDateSet.has(key);

      let status;
      if (isFuture) {
        status = 'future';
      } else if (beforeAccount) {
        status = 'before-account';
      } else if (isToday && !hasWorkout) {
        status = 'today';
      } else if (hasWorkout) {
        status = 'done';
      } else if (isFrozen) {
        status = 'frozen';
      } else if (isClosureDate || gymClosedSet.has(dow)) {
        status = 'rest';
      } else if (prefDays.length > 0 && restDowSet.has(dow)) {
        status = 'rest';
      } else if (prefDays.length === 0) {
        // Fallback when the user hasn't set preferred_training_days:
        // mirror the server-side _streak_gap_day_protected logic — if the
        // gap is within 7 days of a real training day (in either
        // direction), treat as a rest day. Otherwise it's a real miss.
        // This matches migration 0352's semantics.
        const gapMs = 7 * 24 * 60 * 60 * 1000;
        const dayMs = d.getTime();
        let nearestKey = null;
        let nearestDiff = Infinity;
        for (let i = 0; i < sortedWorkoutKeys.length; i += 1) {
          const wk = sortedWorkoutKeys[i];
          const wkDate = new Date(wk + 'T00:00:00');
          const diff = Math.abs(dayMs - wkDate.getTime());
          if (diff < nearestDiff) {
            nearestDiff = diff;
            nearestKey = wk;
          }
          if (wkDate.getTime() > dayMs && diff > gapMs) break; // sorted, can stop
        }
        status = nearestKey && nearestDiff <= gapMs ? 'rest' : 'missed';
      } else {
        status = 'missed';
      }

      // Persist `dayNum` (1-31) only. useCachedState round-trips this
      // payload through JSON, which would silently downgrade a Date
      // object to an ISO string and crash any consumer that called
      // `day.date.getDate()`. We dropped the `date` field entirely — if
      // a future consumer needs the full Date, derive it from
      // `new Date(day.key + 'T00:00:00')` at the call site.
      monthDays.push({ dayNum: day, key, dow, status, isToday });
    }

    const label = cursor.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'long', year: 'numeric' });
    const isCurrent = year === today.getFullYear() && month === today.getMonth();
    months.push({ label, days: monthDays, year, month, isCurrent });
    cursor = new Date(year, month - 1, 1);
  }

  // Freeze status for the current month
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const currentFreeze = freezesByMonth[currentMonthKey];
  const freezeStatus = {
    used: currentFreeze?.used_count || 0,
    max: currentFreeze?.max_allowed || 1,
  };

  // ── DERIVE CURRENT STREAK FROM CALENDAR ────────────────────
  let currentStreak = 0;
  {
    const STATUS_BY_KEY = new Map();
    for (const m of months) for (const d of m.days) STATUS_BY_KEY.set(d.key, d.status);
    let derived = 0;
    let sawDone = false;
    let walk = new Date(today);
    // Safety cap: don't walk further than user creation or 1000 days.
    for (let i = 0; i < 1000; i++) {
      const k = toKey(walk);
      if (k < createdAtKey) break;
      const s = STATUS_BY_KEY.get(k);
      if (s === 'missed') break;
      if (s === 'done') { derived += 1; sawDone = true; }
      else if (s === 'today') { /* today, no workout yet — neither count nor break */ }
      else if (s === 'rest' || s === 'frozen') { derived += 1; }
      else if (s === 'future' || s === 'before-account' || !s) { /* skip */ }
      walk.setDate(walk.getDate() - 1);
    }
    currentStreak = sawDone ? derived : 0;
  }

  // ── DERIVE LONGEST STREAK FROM CALENDAR ────────────────────
  let longestStreak = 0;
  try {
    const allDays = (months || []).slice().reverse().flatMap((m) => (m && m.days) || []);
    let maxRun = 0;
    let curRun = 0;
    let sawDoneInRun = false;
    const commit = () => {
      if (sawDoneInRun && curRun > maxRun) maxRun = curRun;
      curRun = 0;
      sawDoneInRun = false;
    };
    for (const d of allDays) {
      const s = d && d.status;
      if (s === 'missed') { commit(); }
      else if (s === 'done') { curRun += 1; sawDoneInRun = true; }
      else if (s === 'rest' || s === 'frozen') { curRun += 1; }
    }
    commit();
    longestStreak = maxRun;
  } catch {
    longestStreak = 0;
  }

  return { months, currentStreak, longestStreak, freezeStatus };
}
