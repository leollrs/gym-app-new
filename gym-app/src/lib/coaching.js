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

// ── Member side ─────────────────────────────────────────────────────────────

// Everything the member's coaching surface needs in a few queries.
export async function getMemberCoaching(profileId) {
  const period = mondayOf();
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
          .eq('period_start', period)
          .in('template_id', templateIds)
      : Promise.resolve({ data: [] }),
    habitIds.length
      ? supabase
          .from('habit_logs')
          .select('habit_id, log_date, completed')
          .eq('profile_id', profileId)
          .gte('log_date', period)
          .in('habit_id', habitIds)
      : Promise.resolve({ data: [] }),
  ]);

  const respByTemplate = new Map((respRes.data || []).map((r) => [r.template_id, r]));
  const logsByHabit = new Map();
  for (const l of (logRes.data || [])) {
    if (!logsByHabit.has(l.habit_id)) logsByHabit.set(l.habit_id, []);
    if (l.completed) logsByHabit.get(l.habit_id).push(l.log_date);
  }

  const today = todayStr();
  return {
    period,
    checkins: templates.map((tpl) => ({
      template: tpl,
      response: respByTemplate.get(tpl.id) || null,
      done: respByTemplate.has(tpl.id),
    })),
    habits: habits.map((h) => {
      const dates = logsByHabit.get(h.id) || [];
      return { habit: h, weekDates: dates, doneCount: dates.length, doneToday: dates.includes(today) };
    }),
  };
}

// Upsert this period's check-in answers (one row per template/member/period).
export function submitCheckin({ templateId, profileId, gymId, periodStart, answers }) {
  return supabase
    .from('checkin_responses')
    .upsert(
      { template_id: templateId, profile_id: profileId, gym_id: gymId, period_start: periodStart, answers, submitted_at: new Date().toISOString() },
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
// trainer's progress-tracking view.
export async function getClientCheckins(clientId, { limit = 8 } = {}) {
  const assignsRes = await supabase
    .from('checkin_assignments')
    .select('template_id, checkin_templates(id, title, description, cadence, questions)')
    .eq('profile_id', clientId)
    .eq('active', true);
  const templates = (assignsRes.data || []).map((a) => a.checkin_templates).filter(Boolean);
  const ids = templates.map((t) => t.id);
  let responses = [];
  if (ids.length) {
    const r = await supabase
      .from('checkin_responses')
      .select('template_id, answers, period_start, submitted_at')
      .eq('profile_id', clientId)
      .in('template_id', ids)
      .order('period_start', { ascending: false })
      .limit(limit);
    responses = r.data || [];
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

// A client's habits + last-4-week completion counts, for the trainer view.
export async function getClientHabits(clientId) {
  const habitsRes = await supabase
    .from('habits')
    .select('id, name, icon, target_per_week')
    .eq('profile_id', clientId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  const habits = habitsRes.data || [];
  const ids = habits.map((h) => h.id);
  let logs = [];
  if (ids.length) {
    const since = mondayOf(new Date(Date.now() - 21 * 86400000)); // ~4 weeks
    const r = await supabase
      .from('habit_logs')
      .select('habit_id, log_date')
      .eq('profile_id', clientId)
      .gte('log_date', since)
      .in('habit_id', ids);
    logs = r.data || [];
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
