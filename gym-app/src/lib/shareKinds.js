// Shape the `data` payload for each ShareSheet kind. Call sites pass the
// raw domain object (a PR row, a streak number, a monthly recap object)
// and we map it onto the keys ShareTplSticker reads. Keeping the mapping
// here means individual screens don't have to know the sticker's data
// contract — they just hand the sheet a kind + the helper output.

/**
 * PR card data.
 * @param {object} pr - { exerciseName, value, previousValue, unit?, accentColor? }
 */
export function buildPRShareData(pr = {}) {
  const value = Number(pr.value) || 0;
  const previous = Number(pr.previousValue) || 0;
  const delta = previous > 0 ? value - previous : null;
  return {
    kind: 'pr',
    prExercise: pr.exerciseName || 'Personal record',
    prValue: value.toLocaleString(),
    prUnit: pr.unit || 'lbs',
    prPrevious: previous > 0 ? previous.toLocaleString() : null,
    prDelta: delta != null && delta > 0 ? `+${delta.toLocaleString()}` : null,
    name: pr.exerciseName ? `${pr.exerciseName} PR` : 'New PR',
    user: pr.userName || '',
    gym: pr.gym || '',
    gymLogo: pr.gymLogo || null,
  };
}

/**
 * Streak milestone data. Tiered messaging by days hit so 7-day and 365-day
 * cards don't both read "Day N — keep going".
 * @param {object} s - { days, userName?, gym?, gymLogo? }
 */
export function buildStreakShareData(s = {}) {
  const days = Number(s.days) || 0;
  let subtitle = `Day ${days}`;
  if (days >= 365) subtitle = '1 year strong';
  else if (days >= 180) subtitle = '6 months in';
  else if (days >= 100) subtitle = '100 days deep';
  else if (days >= 30) subtitle = '30 days locked in';
  else if (days >= 7) subtitle = 'First week clear';
  return {
    kind: 'streak',
    streakDays: days,
    streakSubtitle: subtitle,
    name: `${days}-day streak`,
    user: s.userName || '',
    gym: s.gym || '',
    gymLogo: s.gymLogo || null,
  };
}

/**
 * Monthly recap data.
 * @param {object} m - { workoutsCount, volume, prCount, streakDays, monthLabel? }
 */
export function buildMonthlyShareData(m = {}) {
  const month = m.monthLabel || (() => {
    const d = new Date();
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
  })();
  return {
    kind: 'monthly',
    monthLabel: month,
    workoutsCount: Number(m.workoutsCount) || 0,
    volume: Number(m.volume) || 0,
    prCount: Number(m.prCount) || 0,
    streakDays: Number(m.streakDays) || 0,
    monthlyHeadline: m.headline || '',
    name: `${month} recap`,
    user: m.userName || '',
    gym: m.gym || '',
    gymLogo: m.gymLogo || null,
  };
}

/**
 * Body-progress data (before/after photos + delta weeks).
 * @param {object} b - { beforeUrl, afterUrl, weeks, deltaLbs?, deltaBodyFat? }
 */
export function buildBodyProgressShareData(b = {}) {
  return {
    kind: 'body',
    beforeUrl: b.beforeUrl || null,
    afterUrl: b.afterUrl || null,
    weeksBetween: Number(b.weeks) || 0,
    deltaLbs: b.deltaLbs != null ? Number(b.deltaLbs) : null,
    deltaBodyFat: b.deltaBodyFat != null ? Number(b.deltaBodyFat) : null,
    name: `${b.weeks || 0}-week progress`,
    user: b.userName || '',
    gym: b.gym || '',
    gymLogo: b.gymLogo || null,
  };
}
