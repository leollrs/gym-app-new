// coaching.js
// -----------------------------------------------------------------------------
// Data layer for #6 — trainer check-in forms + member habits. Used by both the
// member surface (fill check-ins, tick habits) and the trainer surface (author
// templates, assign, read responses, manage habits). RLS (migration 0500)
// enforces who can see/write what; these helpers just shape the queries.
// -----------------------------------------------------------------------------

import { supabase } from './supabase';

// Monday (local) of the week containing `d`, as YYYY-MM-DD — the period key for
// weekly check-ins and the anchor for the current habit week.
export function mondayOf(d = new Date()) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 0 = Monday
  date.setDate(date.getDate() - day);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ISO-8601 week number (local) — used to anchor the biweekly cadence.
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // 0 = Monday
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const ftDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3);
  return 1 + Math.round((t - firstThursday) / (7 * 86400000));
}

// The period key a check-in response belongs to, per template cadence.
// BOTH the member submit/upsert and the trainer "answered this period?"
// check must use this — otherwise cadence is decorative (the old code
// hardcoded Monday-weekly everywhere).
//   weekly   → Monday of this week (YYYY-MM-DD)
//   biweekly → Monday of the current ISO-EVEN week (advances every 2 weeks)
//   monthly  → 1st of this month (YYYY-MM-DD)
//   once     → the literal string 'once' (sentinel: any response ever counts;
//              submissions store their actual date as period_start)
export function periodFor(cadence, now = new Date()) {
  if (cadence === 'once') return 'once';
  const d = new Date(now);
  if (cadence === 'monthly') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  if (cadence === 'biweekly') {
    const monday = new Date(d);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    if (isoWeek(monday) % 2 === 1) monday.setDate(monday.getDate() - 7); // snap odd weeks back to the even-week Monday
    return todayStr(monday);
  }
  return mondayOf(d); // weekly (default)
}

// The response (if any) that belongs to the template's CURRENT period.
// responses: rows with { period_start } for ONE template, newest first.
// Legacy tolerance: before periodFor existed every row was keyed to the
// weekly Monday regardless of cadence — so match by BUCKET (map each stored
// date through periodFor) rather than only by exact key.
export function findCurrentResponse(cadence, responses, now = new Date()) {
  const list = Array.isArray(responses) ? responses : [];
  if (cadence === 'once') return list[0] || null;
  const period = periodFor(cadence, now);
  return list.find((r) => {
    if (r.period_start === period) return true;
    const d = r.period_start ? new Date(`${r.period_start}T12:00:00`) : null; // local noon — TZ-safe
    return d && !isNaN(d.getTime()) && periodFor(cadence, d) === period;
  }) || null;
}

// Has this template been answered for its CURRENT period?
// ('once': any response ever counts.)
export function answeredThisPeriod(cadence, responses, now = new Date()) {
  const list = Array.isArray(responses) ? responses : [];
  if (cadence === 'once') return list.length > 0;
  return !!findCurrentResponse(cadence, list, now);
}

// ── Member side ─────────────────────────────────────────────────────────────

// Everything the member's coaching surface needs in a few queries.
// Per-template cadence-aware: each template's "done" is judged against ITS
// period (periodFor), and 'once' templates count any response ever.
export async function getMemberCoaching(profileId) {
  const habitWeek = mondayOf(); // habit week is always Monday-anchored
  const [assignsRes, habitsRes] = await Promise.all([
    supabase
      .from('checkin_assignments')
      .select('id, template_id, checkin_templates(id, title, description, cadence, questions, is_active)')
      .eq('profile_id', profileId)
      .eq('active', true),
    supabase
      .from('habits')
      .select('id, name, icon, target_per_week, is_active')
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ]);
  if (assignsRes.error) throw assignsRes.error;
  if (habitsRes.error) throw habitsRes.error;

  const templates = (assignsRes.data || [])
    .map((a) => a.checkin_templates)
    .filter((tpl) => tpl && tpl.is_active);

  const templateIds = templates.map((t) => t.id);
  const habits = habitsRes.data || [];
  const habitIds = habits.map((h) => h.id);

  const [respRes, logRes] = await Promise.all([
    templateIds.length
      ? supabase
          .from('checkin_responses')
          .select('template_id, answers, period_start, submitted_at')
          .eq('profile_id', profileId)
          .in('template_id', templateIds)
          .order('period_start', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    habitIds.length
      ? supabase
          .from('habit_logs')
          .select('habit_id, log_date, completed')
          .eq('profile_id', profileId)
          .gte('log_date', habitWeek)
          .in('habit_id', habitIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (respRes.error) throw respRes.error;
  if (logRes.error) throw logRes.error;

  const respsByTemplate = new Map();
  for (const r of (respRes.data || [])) {
    if (!respsByTemplate.has(r.template_id)) respsByTemplate.set(r.template_id, []);
    respsByTemplate.get(r.template_id).push(r); // already period_start DESC
  }
  const logsByHabit = new Map();
  for (const l of (logRes.data || [])) {
    if (!logsByHabit.has(l.habit_id)) logsByHabit.set(l.habit_id, []);
    if (l.completed) logsByHabit.get(l.habit_id).push(l.log_date);
  }

  const today = todayStr();
  return {
    period: habitWeek, // kept for back-compat readers
    checkins: templates.map((tpl) => {
      const list = respsByTemplate.get(tpl.id) || [];
      const period = periodFor(tpl.cadence);
      const current = findCurrentResponse(tpl.cadence, list);
      return {
        template: tpl,
        period,
        response: current,
        done: tpl.cadence === 'once' ? list.length > 0 : !!current,
      };
    }),
    habits: habits.map((h) => {
      const dates = logsByHabit.get(h.id) || [];
      return { habit: h, weekDates: dates, doneCount: dates.length, doneToday: dates.includes(today) };
    }),
  };
}

// Upsert this period's check-in answers (one row per template/member/period).
// periodStart 'once' (the sentinel from periodFor) stores today's date —
// checkin_responses.period_start is a DATE column; "answered?" for once-
// cadence templates is "any response ever", not a period match.
export function submitCheckin({ templateId, profileId, gymId, periodStart, answers }) {
  const period = periodStart === 'once' ? todayStr() : periodStart;
  return supabase
    .from('checkin_responses')
    .upsert(
      { template_id: templateId, profile_id: profileId, gym_id: gymId, period_start: period, answers, submitted_at: new Date().toISOString() },
      { onConflict: 'template_id,profile_id,period_start' },
    );
}

// Toggle today's habit completion. completed=true → upsert; false → delete the row.
export async function setHabitLog({ habitId, profileId, date, completed }) {
  if (completed) {
    return supabase
      .from('habit_logs')
      .upsert({ habit_id: habitId, profile_id: profileId, log_date: date, completed: true }, { onConflict: 'habit_id,log_date' });
  }
  return supabase.from('habit_logs').delete().eq('habit_id', habitId).eq('log_date', date);
}

// ── Trainer / admin side ────────────────────────────────────────────────────

export function createCheckinTemplate({ gymId, createdBy, title, description, cadence, questions }) {
  return supabase
    .from('checkin_templates')
    .insert({ gym_id: gymId, created_by: createdBy, title, description, cadence: cadence || 'weekly', questions: questions || [] })
    .select()
    .single();
}

export function assignCheckin({ templateId, profileId, gymId, assignedBy }) {
  return supabase
    .from('checkin_assignments')
    .upsert({ template_id: templateId, profile_id: profileId, gym_id: gymId, assigned_by: assignedBy, active: true }, { onConflict: 'template_id,profile_id' });
}

// A client's check-in templates (assigned) + their recent responses, for the
// trainer's progress-tracking view. Responses are fetched PER template (last
// `limit` each) — a single shared limit starves every card after the first
// chatty template.
export async function getClientCheckins(clientId, { limit = 6 } = {}) {
  const assignsRes = await supabase
    .from('checkin_assignments')
    .select('template_id, checkin_templates(id, title, description, cadence, questions)')
    .eq('profile_id', clientId)
    .eq('active', true);
  if (assignsRes.error) throw assignsRes.error;
  const templates = (assignsRes.data || []).map((a) => a.checkin_templates).filter(Boolean);
  let responses = [];
  if (templates.length) {
    const results = await Promise.all(templates.map((tpl) =>
      supabase
        .from('checkin_responses')
        .select('template_id, answers, period_start, submitted_at')
        .eq('profile_id', clientId)
        .eq('template_id', tpl.id)
        .order('period_start', { ascending: false })
        .limit(limit),
    ));
    for (const r of results) {
      if (r.error) throw r.error;
      responses = responses.concat(r.data || []);
    }
  }
  return { templates, responses };
}

export function createHabitForClient({ gymId, profileId, createdBy, name, icon, targetPerWeek }) {
  return supabase
    .from('habits')
    .insert({ gym_id: gymId, profile_id: profileId, created_by: createdBy, name, icon: icon || null, target_per_week: targetPerWeek || null })
    .select()
    .single();
}

export function deactivateHabit(habitId) {
  return supabase.from('habits').update({ is_active: false }).eq('id', habitId);
}

// Edit a habit's weekly target after creation (1–7, or null = no target).
export function updateHabitTarget(habitId, targetPerWeek) {
  const target = targetPerWeek == null ? null : Math.max(1, Math.min(7, Number(targetPerWeek)));
  return supabase.from('habits').update({ target_per_week: target }).eq('id', habitId);
}

// A client's habits + THIS week's completion counts (Monday-anchored — same
// window the member's weekly target bar uses; mixing ~4 weeks of logs against
// a weekly target made a 2×/wk habit read 7/7).
export async function getClientHabits(clientId) {
  const habitsRes = await supabase
    .from('habits')
    .select('id, name, icon, target_per_week, created_by')
    .eq('profile_id', clientId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (habitsRes.error) throw habitsRes.error;
  const habits = habitsRes.data || [];
  const ids = habits.map((h) => h.id);
  let logs = [];
  if (ids.length) {
    const since = mondayOf(); // Monday of the current week
    const r = await supabase
      .from('habit_logs')
      .select('habit_id, log_date, completed')
      .eq('profile_id', clientId)
      .gte('log_date', since)
      .in('habit_id', ids);
    if (r.error) throw r.error;
    logs = (r.data || []).filter((l) => l.completed !== false);
  }
  const countByHabit = new Map();
  for (const l of logs) countByHabit.set(l.habit_id, (countByHabit.get(l.habit_id) || 0) + 1);
  return habits.map((h) => ({ ...h, recentCount: countByHabit.get(h.id) || 0 }));
}

// ── Automations (#7) ────────────────────────────────────────────────────────

export async function getTrainerAutomations(trainerId) {
  const { data } = await supabase
    .from('trainer_automations')
    .select('*')
    .eq('trainer_id', trainerId)
    .order('created_at', { ascending: true });
  return data || [];
}

export function createAutomation({ gymId, trainerId, triggerType, thresholdDays, action }) {
  return supabase
    .from('trainer_automations')
    .insert({ gym_id: gymId, trainer_id: trainerId, trigger_type: triggerType, threshold_days: thresholdDays, action })
    .select()
    .single();
}

export function setAutomationActive(id, isActive) {
  return supabase.from('trainer_automations').update({ is_active: isActive }).eq('id', id);
}

export function deleteAutomation(id) {
  return supabase.from('trainer_automations').delete().eq('id', id);
}
