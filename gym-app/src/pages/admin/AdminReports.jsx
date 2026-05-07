import { useState, useCallback, useMemo } from 'react';
import {
  Download, Users, Dumbbell, Trophy, CalendarCheck,
  Scale, Swords, ShoppingBag, CalendarDays, Clock,
  FileSpreadsheet, CalendarRange, Timer, Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { downloadCSV } from '../../lib/exportData';
import {
  PageHeader, FadeIn, AdminPageShell,
} from '../../components/admin';

// ── CSV helpers ──────────────────────────────────────────────
// Cells starting with =, +, -, @, tab, or CR are interpreted as formulas by
// Excel/Sheets/LibreOffice — prefix with `'` to neutralize (OWASP CSV Injection).
const CSV_FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function esc(value) {
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
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return fmtDate(new Date().toISOString());
}

// ── Date range presets ───────────────────────────────────────
const RANGE_PRESETS = [
  { key: '7d',    labelKey: 'admin.reports.last7Days',  days: 7 },
  { key: '30d',   labelKey: 'admin.reports.last30Days', days: 30 },
  { key: '90d',   labelKey: 'admin.reports.last90Days', days: 90 },
  { key: 'all',   labelKey: 'admin.reports.allTime',    days: null },
  { key: 'custom', labelKey: 'admin.reports.custom',    days: null },
];

// ── Export definitions ───────────────────────────────────────
const EXPORT_DEFS = [
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
const HISTORY_KEY = 'admin_export_history';
const MAX_HISTORY = 10;

function getExportHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch (err) { console.warn('Failed to parse export history from localStorage', err); return []; }
}

function addExportHistory(entry) {
  const history = getExportHistory();
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function clearExportHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ── Date range computation ───────────────────────────────────
function getDateRange(rangeKey, customFrom, customTo) {
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

function applyDateFilter(query, dateCol, from, to) {
  if (from) query = query.gte(dateCol, from);
  if (to) query = query.lte(dateCol, to);
  return query;
}

// ── Export functions ─────────────────────────────────────────
async function exportMembers(gymId, from, to, t) {
  let query = supabase
    .from('profiles')
    .select('id, full_name, email, role, fitness_level, goal, created_at, last_workout_at, streak_cache(current_streak_days)')
    .eq('gym_id', gymId)
    .order('full_name', { ascending: true })
    .limit(10000);
  query = applyDateFilter(query, 'created_at', from, to);
  const { data, error } = await query;
  if (error) throw error;

  let churnMap = {};
  try {
    const { data: scores } = await supabase
      .from('churn_risk_scores')
      .select('profile_id, score, risk_tier')
      .eq('gym_id', gymId);
    for (const s of (scores || [])) churnMap[s.profile_id] = s;
  } catch (err) { console.warn('Failed to fetch churn scores for export', err); }

  const header = [
    t('admin.reports.csv.name', 'Name'),
    t('admin.reports.csv.email', 'Email'),
    t('admin.reports.csv.role', 'Role'),
    t('admin.reports.csv.fitnessLevel', 'Fitness Level'),
    t('admin.reports.csv.goal', 'Goal'),
    t('admin.reports.csv.joined', 'Joined'),
    t('admin.reports.csv.lastWorkout', 'Last Workout'),
    t('admin.reports.csv.streak', 'Streak'),
    t('admin.reports.csv.churnScore', 'Churn Score'),
    t('admin.reports.csv.riskTier', 'Risk Tier'),
  ].map(esc).join(',');
  const rows = (data ?? []).map(p => [
    p.full_name || '', p.email || '', p.role || '', p.fitness_level || '',
    p.goal || '', fmtDate(p.created_at), fmtDate(p.last_workout_at),
    p.streak_cache?.current_streak_days ?? p.streak_cache?.[0]?.current_streak_days ?? '', churnMap[p.id]?.score ?? '', churnMap[p.id]?.risk_tier ?? '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `members_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportWorkouts(gymId, from, to, t) {
  let query = supabase
    .from('workout_sessions')
    .select('profile_id, name, completed_at, duration_seconds, total_volume_lbs, status, profiles!inner(full_name, gym_id), session_exercises(id)')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'completed_at', from, to);
  const { data, error } = await query;
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

async function exportPRs(gymId, from, to, t) {
  let query = supabase
    .from('personal_records')
    .select('weight_lbs, reps, estimated_1rm, achieved_at, profiles!inner(full_name, gym_id), exercises(name)')
    .eq('profiles.gym_id', gymId)
    .order('estimated_1rm', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'achieved_at', from, to);
  const { data, error } = await query;
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

async function exportAttendance(gymId, from, to, t, locale) {
  let query = supabase
    .from('check_ins')
    .select('profile_id, checked_in_at, method, profiles!inner(full_name, gym_id)')
    .eq('profiles.gym_id', gymId)
    .order('checked_in_at', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'checked_in_at', from, to);
  const { data, error } = await query;
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

async function exportBodyMetrics(gymId, from, to, t) {
  const [{ data: weights, error: wErr }, { data: measurements, error: mErr }] = await Promise.all([
    applyDateFilter(
      supabase.from('body_weight_logs')
        .select('weight_lbs, logged_at, profiles!inner(full_name, gym_id)')
        .eq('profiles.gym_id', gymId)
        .order('logged_at', { ascending: true })
        .limit(10000),
      'logged_at', from, to,
    ),
    applyDateFilter(
      supabase.from('body_measurements')
        .select('measured_at, body_fat_pct, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm, profiles!inner(full_name, gym_id)')
        .eq('profiles.gym_id', gymId)
        .order('measured_at', { ascending: true })
        .limit(10000),
      'measured_at', from, to,
    ),
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

async function exportChallenges(gymId, from, to, t) {
  let query = supabase
    .from('challenge_participants')
    .select('score, joined_at, challenges!inner(id, title, type, status, gym_id), profiles!inner(full_name)')
    .eq('challenges.gym_id', gymId)
    .order('score', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'joined_at', from, to);
  const { data, error } = await query;
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
    cp.challenges?.title || '', cp.challenges?.type || '', cp.challenges?.status || '',
    cp.profiles?.full_name || '', cp.score ?? '', fmtDate(cp.joined_at),
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `challenge_results_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportPurchases(gymId, from, to, t) {
  let query = supabase
    .from('member_purchases')
    .select('quantity, total_price, created_at, profiles!inner(full_name, gym_id), gym_products!inner(name, category)')
    .eq('profiles.gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'created_at', from, to);
  const { data, error } = await query;
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

async function exportClassBookings(gymId, from, to, t) {
  let query = supabase
    .from('gym_class_bookings')
    .select('status, booked_at, checked_in_at, rating, gym_class_schedules!inner(day_of_week, start_time, gym_classes!inner(name, gym_id)), profiles!inner(full_name)')
    .eq('gym_class_schedules.gym_classes.gym_id', gymId)
    .order('booked_at', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'booked_at', from, to);
  const { data, error } = await query;
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
    b.status || '', fmtDate(b.booked_at), fmtDate(b.checked_in_at), b.rating ?? '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `class_bookings_${todayISO()}.csv`;
  await downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

const EXPORT_FNS = {
  members: exportMembers,
  workouts: exportWorkouts,
  prs: exportPRs,
  attendance: exportAttendance,
  body_metrics: exportBodyMetrics,
  challenges: exportChallenges,
  purchases: exportPurchases,
  class_bookings: exportClassBookings,
};

// ── Tone → CSS var mapping ─────────────────────────────────
const TONE_VARS = {
  teal:  { bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',  fg: 'var(--color-accent)' },
  coach: { bg: 'var(--color-coach-soft)',   fg: 'var(--color-coach)' },
  warn:  { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)' },
  hot:   { bg: 'var(--color-danger-soft)',  fg: 'var(--color-danger)' },
  good:  { bg: 'var(--color-success-soft)', fg: 'var(--color-success)' },
  info:  { bg: 'var(--color-info-soft)',    fg: 'var(--color-info)' },
};

// Assign a tone per export key (matches reference palette)
const EXPORT_TONE = {
  members: 'teal',
  workouts: 'coach',
  prs: 'warn',
  attendance: 'teal',
  body_metrics: 'hot',
  challenges: 'coach',
  purchases: 'good',
  class_bookings: 'warn',
};

// ── Report Card ─────────────────────────────────────────────
function ReportCard({ def, exporting, onExport, t, delay }) {
  const { key, icon: Icon, labelKey, descKey } = def;
  const isActive = exporting === key;
  const tone = TONE_VARS[EXPORT_TONE[key] || 'teal'];

  return (
    <FadeIn delay={delay}>
      <div className="admin-card flex flex-col h-full" style={{ padding: 16 }}>
        <div className="flex items-start gap-2.5 mb-2.5">
          <div
            className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0"
            style={{ background: tone.bg }}
          >
            <Icon size={15} style={{ color: tone.fg }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-extrabold leading-tight" style={{ color: 'var(--color-admin-text)', fontFamily: 'Archivo, sans-serif' }}>
              {t(labelKey)}
            </p>
            <p className="text-[11px] mt-[3px] leading-[1.4]" style={{ color: 'var(--color-admin-text-muted)' }}>
              {t(descKey)}
            </p>
          </div>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => onExport(key)}
          disabled={!!exporting}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[10px] text-[12px] font-bold transition-all mt-2 disabled:opacity-50"
          style={{
            background: isActive
              ? 'color-mix(in srgb, var(--color-accent) 22%, transparent)'
              : 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
            color: 'var(--color-accent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
            cursor: isActive ? 'wait' : exporting ? 'not-allowed' : 'pointer',
          }}
        >
          {isActive ? (
            <>
              <div className="w-3.5 h-3.5 rounded-full animate-spin" style={{ border: '2px solid color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
              {t('admin.reports.exporting')}
            </>
          ) : (
            <>
              <Download size={14} />
              {t('admin.reports.exportCSV')}
            </>
          )}
        </button>
      </div>
    </FadeIn>
  );
}

// ── Component ────────────────────────────────────────────────
export default function AdminReports() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const gymId = profile?.gym_id;

  const [rangeKey, setRangeKey] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exporting, setExporting] = useState(null);
  const [history, setHistory] = useState(() => getExportHistory());

  const refreshHistory = useCallback(() => setHistory(getExportHistory()), []);

  const handleExport = useCallback(async (key) => {
    if (!gymId || exporting) return;
    if (rangeKey === 'custom' && (!customFrom || !customTo)) {
      showToast(t('admin.reports.pickBothDates', { defaultValue: 'Pick both start and end dates.' }), 'error');
      return;
    }
    // Sanity-check the custom range: from must be on/before to.
    if (rangeKey === 'custom' && customFrom && customTo && new Date(customFrom) > new Date(customTo)) {
      showToast(t('admin.reports.invalidDateRange', { defaultValue: 'Start date must be on or before end date.' }), 'error');
      return;
    }
    setExporting(key);
    try {
      const { from, to } = getDateRange(rangeKey, customFrom ? new Date(customFrom).toISOString() : null, customTo ? new Date(customTo).toISOString() : null);
      const exportFn = EXPORT_FNS[key];
      const result = await exportFn(gymId, from, to, t, i18n.language);

      const entry = {
        key,
        filename: result.filename,
        rows: result.rows,
        range: rangeKey,
        exportedAt: new Date().toISOString(),
      };
      addExportHistory(entry);
      refreshHistory();
      showToast(t('admin.reports.exportSuccess', { filename: result.filename, count: result.rows }), 'success');
    } catch (err) {
      console.error('Export failed:', err);
      showToast(t('admin.reports.exportError'), 'error');
    } finally {
      setExporting(null);
    }
  }, [gymId, exporting, rangeKey, customFrom, customTo, showToast, t, refreshHistory]);

  const handleClearHistory = useCallback(() => {
    clearExportHistory();
    refreshHistory();
  }, [refreshHistory]);

  return (
    <AdminPageShell size="narrow">
      {/* ── Header ─────────────────────────────────────────── */}
      <FadeIn>
        <PageHeader
          title={t('admin.reports.title')}
          subtitle={t('admin.reports.subtitle')}
        />
      </FadeIn>

      <div className="mt-6">
        {/* ── Global Date Range ─────────────────────────────── */}
        <FadeIn delay={0.05}>
          <div className="admin-card mb-[18px]" style={{ padding: 16 }}>
            <div className="flex items-center gap-2 mb-3">
              <CalendarRange size={14} style={{ color: 'var(--color-admin-text-muted)' }} />
              <span className="admin-eyebrow">{t('admin.reports.dateRange')}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:flex-wrap">
              {RANGE_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  onClick={() => setRangeKey(preset.key)}
                  className={`admin-pill flex-shrink-0 ${rangeKey === preset.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
                  style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
            {rangeKey === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 max-w-md">
                <div className="flex flex-col gap-1">
                  <label className="admin-eyebrow">{t('admin.reports.from')}</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="w-full rounded-lg px-3 py-1.5 text-[13px]"
                    style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="admin-eyebrow">{t('admin.reports.to')}</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="w-full rounded-lg px-3 py-1.5 text-[13px]"
                    style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                  />
                </div>
              </div>
            )}
          </div>
        </FadeIn>

        {/* ── Quick Exports grid ────────────────────────────── */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <FileSpreadsheet size={13} style={{ color: 'var(--color-admin-text-muted)' }} />
            <span className="admin-eyebrow">{t('admin.reports.quickExports')}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-3">
            {EXPORT_DEFS.map((def, idx) => (
              <ReportCard
                key={def.key}
                def={def}
                exporting={exporting}
                onExport={handleExport}
                t={t}
                delay={0.08 + idx * 0.03}
              />
            ))}
          </div>
        </div>

        {/* ── 2-col: History + Scheduled ────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Export History */}
          <FadeIn delay={0.2}>
            <div className="admin-card" style={{ padding: 20 }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13px] font-extrabold" style={{ color: 'var(--color-admin-text)', fontFamily: 'Archivo, sans-serif' }}>{t('admin.reports.exportHistory')}</p>
                  <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                    {history.length === 0 ? t('admin.reports.noHistory') : `${history.length}`}
                  </p>
                </div>
                {history.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="flex items-center gap-1 text-[11px] transition-colors"
                    style={{ color: 'var(--color-admin-text-muted)' }}
                  >
                    <Trash2 size={12} />
                    {t('admin.reports.clearHistory')}
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="text-center" style={{ padding: '28px 0', color: 'var(--color-admin-text-muted)', fontSize: 12.5 }}>
                  <div
                    className="flex items-center justify-center mx-auto mb-2.5"
                    style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-admin-panel)' }}
                  >
                    <Clock size={18} style={{ color: 'var(--color-admin-text-muted)' }} />
                  </div>
                  {t('admin.reports.noHistory')}
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                  {history.map((entry, idx) => {
                    const def = EXPORT_DEFS.find(d => d.key === entry.key);
                    const EntryIcon = def?.icon || FileSpreadsheet;
                    return (
                      <div key={idx} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-admin-panel)' }}>
                          <EntryIcon size={14} style={{ color: 'var(--color-admin-text-sub)' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{entry.filename}</p>
                          <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                            {entry.rows} {t('admin.reports.rows')} &middot; {new Date(entry.exportedAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </FadeIn>

          {/* Scheduled Reports */}
          <FadeIn delay={0.25}>
            <div className="admin-card" style={{ padding: 20 }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-extrabold" style={{ color: 'var(--color-admin-text)', fontFamily: 'Archivo, sans-serif' }}>{t('admin.reports.scheduledReports')}</p>
                <span className="admin-pill admin-pill--warn">{t('admin.reports.comingSoon', 'COMING SOON')}</span>
              </div>
              <div className="text-center" style={{ padding: '28px 0', color: 'var(--color-admin-text-muted)', fontSize: 12.5 }}>
                <div
                  className="flex items-center justify-center mx-auto mb-2.5"
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-admin-panel)' }}
                >
                  <Timer size={18} style={{ color: 'var(--color-admin-text-muted)' }} />
                </div>
                {t('admin.reports.scheduledDesc')}
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </AdminPageShell>
  );
}
