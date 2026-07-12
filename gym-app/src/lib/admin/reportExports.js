import { supabase } from '../supabase';
import { downloadCSV } from '../exportData';
import { selectAllRows } from '../churn/batchedSelect';
import {
  Users, Dumbbell, Trophy, CalendarCheck, Scale, Swords, ShoppingBag, CalendarDays,
} from 'lucide-react';

/**
 * Report-export toolbox for the Admin → Reports page. Bundles the CSV cell
 * escaper (with OWASP formula-injection guard), local date formatters, the
 * date-range presets the page exposes, localStorage history-log helpers, and
 * one async `exportXxx` function per supported report — each runs a Supabase
 * query and triggers a CSV download via `downloadCSV`.
 */

// ── CSV helpers ──────────────────────────────────────────────
// Cells starting with =, +, -, @, tab, or CR are interpreted as formulas by
// Excel/Sheets/LibreOffice — prefix with `'` to neutralize (OWASP CSV Injection).
export const CSV_FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

export function esc(value) {
  if (value == null || value === '') return '';
  let str = String(value);
  if (CSV_FORMULA_PREFIX_RE.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ISO yyyy-mm-dd in the user's local timezone — locale-independent so the CSV
// is consistent regardless of where the admin clicks Export.
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO() {
  return fmtDate(new Date().toISOString());
}

// ── Date range presets ───────────────────────────────────────
export const RANGE_PRESETS = [
  { key: '7d',    labelKey: 'admin.reports.last7Days',  days: 7 },
  { key: '30d',   labelKey: 'admin.reports.last30Days', days: 30 },
  { key: '90d',   labelKey: 'admin.reports.last90Days', days: 90 },
  { key: 'all',   labelKey: 'admin.reports.allTime',    days: null },
  { key: 'custom', labelKey: 'admin.reports.custom',    days: null },
];

// ── Export definitions ───────────────────────────────────────
export const EXPORT_DEFS = [
  { key: 'members',       icon: Users,         labelKey: 'admin.reports.membersList',       descKey: 'admin.reports.membersDesc' },
  { key: 'workouts',      icon: Dumbbell,      labelKey: 'admin.reports.workoutHistory',    descKey: 'admin.reports.workoutsDesc' },
  { key: 'prs',           icon: Trophy,        labelKey: 'admin.reports.personalRecords',   descKey: 'admin.reports.prsDesc' },
  { key: 'attendance',    icon: CalendarCheck,  labelKey: 'admin.reports.attendanceLog',     descKey: 'admin.reports.attendanceDesc' },
  { key: 'body_metrics',  icon: Scale,         labelKey: 'admin.reports.bodyMetrics',       descKey: 'admin.reports.bodyMetricsDesc' },
  { key: 'challenges',    icon: Swords,        labelKey: 'admin.reports.challengeResults',  descKey: 'admin.reports.challengesDesc' },
  { key: 'purchases',     icon: ShoppingBag,   labelKey: 'admin.reports.storePurchases',    descKey: 'admin.reports.purchasesDesc' },
  { key: 'class_bookings', icon: CalendarDays,  labelKey: 'admin.reports.classBookings',     descKey: 'admin.reports.classBookingsDesc' },
];

// ── localStorage history helpers ─────────────────────────────
// History lives in localStorage (per-device, never touches the DB). We keep at
// most MAX_HISTORY entries AND auto-expire anything older than 30 days so the
// log doesn't accumulate stale rows. The UI pages it HISTORY_PAGE_SIZE at a time.
export const HISTORY_KEY = 'admin_export_history';
export const MAX_HISTORY = 10;
export const HISTORY_RETENTION_DAYS = 30;
export const HISTORY_PAGE_SIZE = 5;

// Drop entries older than the retention window, newest-first, capped.
function pruneHistory(list) {
  if (!Array.isArray(list)) return [];
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return list
    .filter((e) => {
      const ts = e?.exportedAt ? new Date(e.exportedAt).getTime() : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    })
    .slice(0, MAX_HISTORY);
}

export function getExportHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const fresh = pruneHistory(raw);
    // Re-persist when pruning actually removed something, so expired rows stop
    // taking up space on the device.
    if (!Array.isArray(raw) || fresh.length !== raw.length) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch (err) { console.warn('Failed to parse export history from localStorage', err); return []; }
}

export function addExportHistory(entry) {
  const history = getExportHistory();
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(pruneHistory(history)));
}

export function clearExportHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ── Date range computation ───────────────────────────────────
export function getDateRange(rangeKey, customFrom, customTo) {
  if (rangeKey === 'custom') {
    return { from: customFrom || null, to: customTo || null };
  }
  const preset = RANGE_PRESETS.find(r => r.key === rangeKey);
  if (!preset?.days) return { from: null, to: null };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - preset.days);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function applyDateFilter(query, dateCol, from, to) {
  if (from) query = query.gte(dateCol, from);
  if (to) query = query.lte(dateCol, to);
  return query;
}

// ── Export functions ─────────────────────────────────────────
export async function exportMembers(gymId, from, to, t) {
  // NOTE on column homes: fitness_level + primary_goal live on member_onboarding
  // (NOT profiles); the login email lives on auth.users (read via the admin RPC
  // below); there is no profiles.last_workout_at, so we report last_active_at.
  // Page the full roster — .limit(10000) is a false safeguard (PostgREST caps
  // the response at ~1000), so a gym past 1000 members silently exported a
  // truncated list. Order by full_name then id (stable tiebreaker) so OFFSET
  // paging can't skip/duplicate members who share a name.
  const { data, error } = await selectAllRows((lo, hi) => applyDateFilter(
    supabase
      .from('profiles')
      .select('id, full_name, role, created_at, last_active_at, member_onboarding(fitness_level, primary_goal), streak_cache(current_streak_days)')
      .eq('gym_id', gymId)
      .order('full_name', { ascending: true })
      .order('id', { ascending: true })
      .range(lo, hi),
    'created_at', from, to,
  ));
  if (error) throw error;

  // Churn score + tier (nightly precompute written by compute-churn-scores).
  let churnMap = {};
  try {
    const { data: scores } = await supabase
      .from('churn_risk_scores')
      .select('profile_id, score, risk_tier')
      .eq('gym_id', gymId);
    for (const s of (scores || [])) churnMap[s.profile_id] = s;
  } catch (err) { console.warn('Failed to fetch churn scores for export', err); }

  // Login email lives on auth.users — admins read it through a SECURITY DEFINER
  // RPC (gym-scoped, admin-gated). Non-fatal: blank email column if it fails.
  let emailMap = {};
  try {
    const ids = (data ?? []).map(p => p.id);
    if (ids.length) {
      const { data: emailRows } = await supabase.rpc('admin_get_member_emails', { p_member_ids: ids });
      for (const e of (emailRows || [])) emailMap[e.member_id] = e.email;
    }
  } catch (err) { console.warn('Failed to fetch member emails for export', err); }

  const header = [
    t('admin.reports.csv.name', 'Name'),
    t('admin.reports.csv.email', 'Email'),
    t('admin.reports.csv.role', 'Role'),
    t('admin.reports.csv.fitnessLevel', 'Fitness Level'),
    t('admin.reports.csv.goal', 'Goal'),
    t('admin.reports.csv.joined', 'Joined'),
    t('admin.reports.csv.lastActive', 'Last Active'),
    t('admin.reports.csv.streak', 'Streak'),
    t('admin.reports.csv.churnScore', 'Churn Score'),
    t('admin.reports.csv.riskTier', 'Risk Tier'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(p => {
    const ob = Array.isArray(p.member_onboarding) ? p.member_onboarding[0] : p.member_onboarding;
    const sc = Array.isArray(p.streak_cache) ? p.streak_cache[0] : p.streak_cache;
    return [
      p.full_name || '', emailMap[p.id] || '', p.role || '',
      ob?.fitness_level || '', ob?.primary_goal || '',
      fmtDate(p.created_at), fmtDate(p.last_active_at),
      sc?.current_streak_days ?? '', churnMap[p.id]?.score ?? '', churnMap[p.id]?.risk_tier ?? '',
    ].map(esc).join(',');
  });
  const csv = [header, ...rows].join('\n');
  const filename = `members_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export async function exportWorkouts(gymId, from, to, t) {
  const { data, error } = await selectAllRows((lo, hi) => applyDateFilter(
    supabase
      .from('workout_sessions')
      .select('id, profile_id, name, completed_at, duration_seconds, total_volume_lbs, status, profiles!inner(full_name, gym_id), session_exercises(id)')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(lo, hi),
    'completed_at', from, to,
  ));
  if (error) throw error;

  const header = [
    t('admin.reports.csv.member', 'Member'),
    t('admin.reports.csv.date', 'Date'),
    t('admin.reports.csv.routine', 'Routine'),
    t('admin.reports.csv.durationMin', 'Duration (min)'),
    t('admin.reports.csv.totalVolumeLbs', 'Total Volume (lbs)'),
    t('admin.reports.csv.exercises', 'Exercises'),
    t('admin.reports.csv.status', 'Status'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(s => [
    s.profiles?.full_name || '', fmtDate(s.completed_at), s.name || '',
    s.duration_seconds ? Math.round(s.duration_seconds / 60) : '',
    s.total_volume_lbs ?? '', (s.session_exercises ?? []).length, s.status || '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `workout_history_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export async function exportPRs(gymId, from, to, t) {
  const { data, error } = await selectAllRows((lo, hi) => applyDateFilter(
    supabase
      .from('personal_records')
      .select('id, weight_lbs, reps, estimated_1rm, achieved_at, profiles!inner(full_name, gym_id), exercises(name)')
      .eq('profiles.gym_id', gymId)
      .order('estimated_1rm', { ascending: false })
      .order('id', { ascending: true })
      .range(lo, hi),
    'achieved_at', from, to,
  ));
  if (error) throw error;

  const header = [
    t('admin.reports.csv.member', 'Member'),
    t('admin.reports.csv.exercise', 'Exercise'),
    t('admin.reports.csv.weightLbs', 'Weight (lbs)'),
    t('admin.reports.csv.reps', 'Reps'),
    t('admin.reports.csv.estimated1RM', 'Estimated 1RM'),
    t('admin.reports.csv.dateAchieved', 'Date Achieved'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(pr => [
    pr.profiles?.full_name || '', pr.exercises?.name || '',
    pr.weight_lbs ?? '', pr.reps ?? '', pr.estimated_1rm ?? '', fmtDate(pr.achieved_at),
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `personal_records_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export async function exportAttendance(gymId, from, to, t, locale) {
  const { data, error } = await selectAllRows((lo, hi) => applyDateFilter(
    supabase
      .from('check_ins')
      .select('id, profile_id, checked_in_at, method, profiles!inner(full_name, gym_id)')
      .eq('profiles.gym_id', gymId)
      .order('checked_in_at', { ascending: false })
      .order('id', { ascending: true })
      .range(lo, hi),
    'checked_in_at', from, to,
  ));
  if (error) throw error;

  const header = [
    t('admin.reports.csv.member', 'Member'),
    t('admin.reports.csv.date', 'Date'),
    t('admin.reports.csv.time', 'Time'),
    t('admin.reports.csv.method', 'Method'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(c => {
    const d = c.checked_in_at ? new Date(c.checked_in_at) : null;
    return [
      c.profiles?.full_name || '',
      d ? fmtDate(c.checked_in_at) : '',
      d ? d.toLocaleTimeString(locale || undefined, { hour: '2-digit', minute: '2-digit' }) : '',
      c.method || '',
    ].map(esc).join(',');
  });
  const csv = [header, ...rows].join('\n');
  const filename = `attendance_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export async function exportBodyMetrics(gymId, from, to, t) {
  const [{ data: weights, error: wErr }, { data: measurements, error: mErr }] = await Promise.all([
    selectAllRows((lo, hi) => applyDateFilter(
      supabase.from('body_weight_logs')
        .select('id, weight_lbs, logged_at, profiles!inner(full_name, gym_id)')
        .eq('profiles.gym_id', gymId)
        .order('logged_at', { ascending: true })
        .order('id', { ascending: true })
        .range(lo, hi),
      'logged_at', from, to,
    )),
    selectAllRows((lo, hi) => applyDateFilter(
      supabase.from('body_measurements')
        .select('id, measured_at, body_fat_pct, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm, profiles!inner(full_name, gym_id)')
        .eq('profiles.gym_id', gymId)
        .order('measured_at', { ascending: true })
        .order('id', { ascending: true })
        .range(lo, hi),
      'measured_at', from, to,
    )),
  ]);
  if (wErr) throw wErr;
  if (mErr) throw mErr;

  const byKey = {};
  for (const w of (weights ?? [])) {
    const k = `${w.profiles?.full_name || ''}||${fmtDate(w.logged_at)}`;
    if (!byKey[k]) byKey[k] = { member: w.profiles?.full_name || '', date: fmtDate(w.logged_at) };
    byKey[k].weight_lbs = w.weight_lbs;
  }
  for (const m of (measurements ?? [])) {
    const k = `${m.profiles?.full_name || ''}||${fmtDate(m.measured_at)}`;
    if (!byKey[k]) byKey[k] = { member: m.profiles?.full_name || '', date: fmtDate(m.measured_at) };
    Object.assign(byKey[k], { body_fat_pct: m.body_fat_pct, chest_cm: m.chest_cm, waist_cm: m.waist_cm, hips_cm: m.hips_cm, left_arm_cm: m.left_arm_cm, right_arm_cm: m.right_arm_cm, left_thigh_cm: m.left_thigh_cm, right_thigh_cm: m.right_thigh_cm });
  }
  const sorted = Object.values(byKey).sort((a, b) => a.member.localeCompare(b.member) || a.date.localeCompare(b.date));

  const header = [
    t('admin.reports.csv.member', 'Member'),
    t('admin.reports.csv.date', 'Date'),
    t('admin.reports.csv.weightLbs', 'Weight (lbs)'),
    t('admin.reports.csv.bodyFatPct', 'Body Fat %'),
    t('admin.reports.csv.chestCm', 'Chest (cm)'),
    t('admin.reports.csv.waistCm', 'Waist (cm)'),
    t('admin.reports.csv.hipsCm', 'Hips (cm)'),
    t('admin.reports.csv.leftArmCm', 'Left Arm (cm)'),
    t('admin.reports.csv.rightArmCm', 'Right Arm (cm)'),
    t('admin.reports.csv.leftThighCm', 'Left Thigh (cm)'),
    t('admin.reports.csv.rightThighCm', 'Right Thigh (cm)'),
  ].map(esc).join(',');
  const rows = sorted.map(r => [
    r.member, r.date, r.weight_lbs ?? '', r.body_fat_pct ?? '', r.chest_cm ?? '', r.waist_cm ?? '', r.hips_cm ?? '', r.left_arm_cm ?? '', r.right_arm_cm ?? '', r.left_thigh_cm ?? '', r.right_thigh_cm ?? '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `body_metrics_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export async function exportChallenges(gymId, from, to, t) {
  const { data, error } = await selectAllRows((lo, hi) => applyDateFilter(
    supabase
      .from('challenge_participants')
      .select('id, score, joined_at, challenges!inner(id, name, type, status, gym_id), profiles!inner(full_name)')
      .eq('challenges.gym_id', gymId)
      .order('score', { ascending: false })
      .order('id', { ascending: true })
      .range(lo, hi),
    'joined_at', from, to,
  ));
  if (error) throw error;

  const header = [
    t('admin.reports.csv.challenge', 'Challenge'),
    t('admin.reports.csv.type', 'Type'),
    t('admin.reports.csv.status', 'Status'),
    t('admin.reports.csv.member', 'Member'),
    t('admin.reports.csv.score', 'Score'),
    t('admin.reports.csv.joined', 'Joined'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(cp => [
    cp.challenges?.name || '', cp.challenges?.type || '', cp.challenges?.status || '',
    cp.profiles?.full_name || '', cp.score ?? '', fmtDate(cp.joined_at),
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `challenge_results_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export async function exportPurchases(gymId, from, to, t) {
  // member_purchases has TWO FKs to profiles (member_id + recorded_by) — embed the
  // buyer explicitly via member_id to avoid PGRST201 ambiguity. gym_id is a column
  // on member_purchases, so scope there (no embedded-profiles filter needed).
  const { data, error } = await selectAllRows((lo, hi) => applyDateFilter(
    supabase
      .from('member_purchases')
      .select('id, quantity, total_price, created_at, profiles:member_id(full_name), gym_products:product_id(name, category)')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(lo, hi),
    'created_at', from, to,
  ));
  if (error) throw error;

  const header = [
    t('admin.reports.csv.member', 'Member'),
    t('admin.reports.csv.product', 'Product'),
    t('admin.reports.csv.category', 'Category'),
    t('admin.reports.csv.quantity', 'Quantity'),
    t('admin.reports.csv.totalPrice', 'Total Price'),
    t('admin.reports.csv.date', 'Date'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(p => [
    p.profiles?.full_name || '', p.gym_products?.name || '', p.gym_products?.category || '',
    p.quantity ?? '', p.total_price ?? '', fmtDate(p.created_at),
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `member_purchases_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export async function exportClassBookings(gymId, from, to, t) {
  const { data, error } = await selectAllRows((lo, hi) => applyDateFilter(
    supabase
      .from('gym_class_bookings')
      .select('id, status, booked_at, attended_at, rating, gym_class_schedules!inner(day_of_week, start_time, gym_classes!inner(name, gym_id)), profiles!inner(full_name)')
      .eq('gym_class_schedules.gym_classes.gym_id', gymId)
      .order('booked_at', { ascending: false })
      .order('id', { ascending: true })
      .range(lo, hi),
    'booked_at', from, to,
  ));
  if (error) throw error;

  const header = [
    t('admin.reports.csv.member', 'Member'),
    t('admin.reports.csv.class', 'Class'),
    t('admin.reports.csv.day', 'Day'),
    t('admin.reports.csv.time', 'Time'),
    t('admin.reports.csv.status', 'Status'),
    t('admin.reports.csv.bookedAt', 'Booked At'),
    t('admin.reports.csv.checkedIn', 'Checked In'),
    t('admin.reports.csv.rating', 'Rating'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(b => [
    b.profiles?.full_name || '', b.gym_class_schedules?.gym_classes?.name || '',
    b.gym_class_schedules?.day_of_week ?? '', b.gym_class_schedules?.start_time || '',
    b.status || '', fmtDate(b.booked_at), fmtDate(b.attended_at), b.rating ?? '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `class_bookings_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

export const EXPORT_FNS = {
  members: exportMembers,
  workouts: exportWorkouts,
  prs: exportPRs,
  attendance: exportAttendance,
  body_metrics: exportBodyMetrics,
  challenges: exportChallenges,
  purchases: exportPurchases,
  class_bookings: exportClassBookings,
};
