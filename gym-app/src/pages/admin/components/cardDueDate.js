// Expected hand-over date for a pending print card.
//
// The card can only be given to the member in person on their NEXT visit, so
// the useful "due date" is when we expect them back — derived from their own
// attendance rhythm, not the fixed milestone date. It recomputes on every load,
// so if a member no-shows on the predicted day it rolls forward to the next slot.
//
// Method (chosen by the gym owner): AVERAGE CADENCE.
//   next visit = last activity + median gap between recent activity days,
//   rolled forward to the first slot >= today.
// Fallback when there isn't enough recent activity: the milestone's own
// calendar date (tenure → join date + threshold, birthday → next birthday).
//
// "Activity" = check-ins OR completed workouts (either means they were at the
// gym), so the prediction still works for gyms that use check-ins lightly.

import { differenceInCalendarDays, addDays, format } from 'date-fns';

// Beyond this many days since the last visit we stop trusting the cadence
// (the member has effectively gone quiet) and fall back to the milestone date.
const STALE_DAYS = 45;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ISO timestamps → unique day-resolution Date list, ascending.
function uniqueDaysAsc(isoList) {
  const byDay = new Map();
  for (const iso of isoList || []) {
    if (!iso) continue;
    const d = startOfDay(new Date(iso));
    const k = d.getTime();
    if (!Number.isNaN(k)) byDay.set(k, d);
  }
  return [...byDay.values()].sort((a, b) => a - b);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Calendar date of the milestone itself, for the fallback. Only date-based
// occasions have one; workout-count occasions (milestone_100/habit_9in6/…)
// return null → "no recent visits".
function milestoneDate(card) {
  const occ = card?.occasion;
  const p = card?.profiles || {};
  if ((occ === 'tenure_30' || occ === 'tenure_90' || occ === 'tenure_365') && p.created_at) {
    const days = occ === 'tenure_30' ? 30 : occ === 'tenure_90' ? 90 : 365;
    return startOfDay(addDays(new Date(p.created_at), days));
  }
  if (occ === 'birthday' && p.date_of_birth) {
    const today = startOfDay(new Date());
    const dob = new Date(p.date_of_birth);
    let next = startOfDay(new Date(today.getFullYear(), dob.getMonth(), dob.getDate()));
    if (next < today) next = startOfDay(new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate()));
    return next;
  }
  return null;
}

/**
 * @returns {{ date: Date|null, basis: 'cadence'|'milestone'|'none', overdue: boolean }}
 */
export function computeExpectedDue(card, activityIsoList) {
  const today = startOfDay(new Date());
  const days = uniqueDaysAsc(activityIsoList);
  const last = days.length ? days[days.length - 1] : null;
  const fresh = last && differenceInCalendarDays(today, last) <= STALE_DAYS;

  if (days.length >= 2 && fresh) {
    const gaps = [];
    for (let i = 1; i < days.length; i++) gaps.push(differenceInCalendarDays(days[i], days[i - 1]));
    const step = Math.max(1, median(gaps) || 1);
    let due = addDays(last, step);
    // Roll forward to the first cadence slot on/after today (handles no-shows).
    let guard = 0;
    while (differenceInCalendarDays(due, today) < 0 && guard < 400) { due = addDays(due, step); guard++; }
    return { date: startOfDay(due), basis: 'cadence', overdue: false };
  }

  const ms = milestoneDate(card);
  if (ms) {
    return { date: ms, basis: 'milestone', overdue: differenceInCalendarDays(today, ms) > 0 };
  }
  return { date: null, basis: 'none', overdue: false };
}

/**
 * Turn a computed due into display text + a tone token.
 * tone ∈ 'danger' | 'accent' | 'sub' | 'muted'.
 */
export function describeDue(due, { t, isEs, dateLocale }) {
  if (!due || !due.date) {
    return { text: t('admin.printCards.noRecentVisits', { defaultValue: 'No recent visits' }), tone: 'muted' };
  }
  const today = startOfDay(new Date());
  const fmt = format(due.date, isEs ? "EEE d 'de' MMM" : 'EEE, MMM d', dateLocale);
  if (due.basis === 'milestone' && due.overdue) {
    return { text: t('admin.printCards.expectedOverdue', { date: fmt, defaultValue: 'Overdue · {{date}}' }), tone: 'danger' };
  }
  if (differenceInCalendarDays(due.date, today) <= 0) {
    return { text: t('admin.printCards.expectedToday', { defaultValue: 'Expected today' }), tone: 'accent' };
  }
  return { text: t('admin.printCards.expectedOn', { date: fmt, defaultValue: 'Expected {{date}}' }), tone: 'sub' };
}
