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
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton } from '../../components/admin';

// ── CSV helpers ──────────────────────────────────────────────
function esc(value) {
  if (value == null || value === '') return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA');
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
async function exportMembers(gymId, from, to) {
  let query = supabase
    .from('profiles')
    .select('id, full_name, email, role, fitness_level, goal, created_at, last_workout_at, current_streak')
    .eq('gym_id', gymId)
    .order('full_name', { ascending: true })
    .limit(10000);
  query = applyDateFilter(query, 'created_at', from, to);
  const { data, error } = await query;
  if (error) throw error;

  // Try to join churn scores
  let churnMap = {};
  try {
    const { data: scores } = await supabase
      .from('churn_risk_scores')
      .select('profile_id, score, risk_tier')
      .eq('gym_id', gymId);
    for (const s of (scores || [])) churnMap[s.profile_id] = s;
  } catch (err) { console.warn('Failed to fetch churn scores for export', err); }

  const header = ['Name', 'Email', 'Role', 'Fitness Level', 'Goal', 'Joined', 'Last Workout', 'Streak', 'Churn Score', 'Risk Tier'].map(esc).join(',');
  const rows = (data ?? []).map(p => [
    p.full_name || '', p.email || '', p.role || '', p.fitness_level || '',
    p.goal || '', fmtDate(p.created_at), fmtDate(p.last_workout_at),
    p.current_streak ?? '', churnMap[p.id]?.score ?? '', churnMap[p.id]?.risk_tier ?? '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `members_${todayISO()}.csv`;
  downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportWorkouts(gymId, from, to) {
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

  const header = ['Member', 'Date', 'Routine', 'Duration (min)', 'Total Volume (lbs)', 'Exercises', 'Status'].map(esc).join(',');
  const rows = (data ?? []).map(s => [
    s.profiles?.full_name || '', fmtDate(s.completed_at), s.name || '',
    s.duration_seconds ? Math.round(s.duration_seconds / 60) : '',
    s.total_volume_lbs ?? '', (s.session_exercises ?? []).length, s.status || '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `workout_history_${todayISO()}.csv`;
  downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportPRs(gymId, from, to) {
  let query = supabase
    .from('personal_records')
    .select('weight_lbs, reps, estimated_1rm, achieved_at, profiles!inner(full_name, gym_id), exercises(name)')
    .eq('profiles.gym_id', gymId)
    .order('estimated_1rm', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'achieved_at', from, to);
  const { data, error } = await query;
  if (error) throw error;

  const header = ['Member', 'Exercise', 'Weight (lbs)', 'Reps', 'Estimated 1RM', 'Date Achieved'].map(esc).join(',');
  const rows = (data ?? []).map(pr => [
    pr.profiles?.full_name || '', pr.exercises?.name || '',
    pr.weight_lbs ?? '', pr.reps ?? '', pr.estimated_1rm ?? '', fmtDate(pr.achieved_at),
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `personal_records_${todayISO()}.csv`;
  downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportAttendance(gymId, from, to) {
  let query = supabase
    .from('check_ins')
    .select('profile_id, checked_in_at, method, profiles!inner(full_name, gym_id)')
    .eq('profiles.gym_id', gymId)
    .order('checked_in_at', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'checked_in_at', from, to);
  const { data, error } = await query;
  if (error) throw error;

  const header = ['Member', 'Date', 'Time', 'Method'].map(esc).join(',');
  const rows = (data ?? []).map(c => {
    const d = c.checked_in_at ? new Date(c.checked_in_at) : null;
    return [
      c.profiles?.full_name || '',
      d ? fmtDate(c.checked_in_at) : '',
      d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
      c.method || '',
    ].map(esc).join(',');
  });
  const csv = [header, ...rows].join('\n');
  const filename = `attendance_${todayISO()}.csv`;
  downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportBodyMetrics(gymId, from, to) {
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

  const header = ['Member', 'Date', 'Weight (lbs)', 'Body Fat %', 'Chest (cm)', 'Waist (cm)', 'Hips (cm)', 'Left Arm (cm)', 'Right Arm (cm)', 'Left Thigh (cm)', 'Right Thigh (cm)'].map(esc).join(',');
  const rows = sorted.map(r => [
    r.member, r.date, r.weight_lbs ?? '', r.body_fat_pct ?? '', r.chest_cm ?? '', r.waist_cm ?? '', r.hips_cm ?? '', r.left_arm_cm ?? '', r.right_arm_cm ?? '', r.left_thigh_cm ?? '', r.right_thigh_cm ?? '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `body_metrics_${todayISO()}.csv`;
  downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportChallenges(gymId, from, to) {
  let query = supabase
    .from('challenge_participants')
    .select('score, joined_at, challenges!inner(id, title, type, status, gym_id), profiles!inner(full_name)')
    .eq('challenges.gym_id', gymId)
    .order('score', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'joined_at', from, to);
  const { data, error } = await query;
  if (error) throw error;

  const header = ['Challenge', 'Type', 'Status', 'Member', 'Score', 'Joined'].map(esc).join(',');
  const rows = (data ?? []).map(cp => [
    cp.challenges?.title || '', cp.challenges?.type || '', cp.challenges?.status || '',
    cp.profiles?.full_name || '', cp.score ?? '', fmtDate(cp.joined_at),
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `challenge_results_${todayISO()}.csv`;
  downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportPurchases(gymId, from, to) {
  let query = supabase
    .from('member_purchases')
    .select('quantity, total_price, created_at, profiles!inner(full_name, gym_id), gym_products!inner(name, category)')
    .eq('profiles.gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'created_at', from, to);
  const { data, error } = await query;
  if (error) throw error;

  const header = ['Member', 'Product', 'Category', 'Quantity', 'Total Price', 'Date'].map(esc).join(',');
  const rows = (data ?? []).map(p => [
    p.profiles?.full_name || '', p.gym_products?.name || '', p.gym_products?.category || '',
    p.quantity ?? '', p.total_price ?? '', fmtDate(p.created_at),
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `member_purchases_${todayISO()}.csv`;
  downloadCSV(filename, csv);
  return { filename, rows: rows.length };
}

async function exportClassBookings(gymId, from, to) {
  let query = supabase
    .from('class_bookings')
    .select('status, booked_at, checked_in_at, rating, class_schedules!inner(day_of_week, start_time, gym_classes!inner(name, gym_id)), profiles!inner(full_name)')
    .eq('class_schedules.gym_classes.gym_id', gymId)
    .order('booked_at', { ascending: false })
    .limit(10000);
  query = applyDateFilter(query, 'booked_at', from, to);
  const { data, error } = await query;
  if (error) throw error;

  const header = ['Member', 'Class', 'Day', 'Time', 'Status', 'Booked At', 'Checked In', 'Rating'].map(esc).join(',');
  const rows = (data ?? []).map(b => [
    b.profiles?.full_name || '', b.class_schedules?.gym_classes?.name || '',
    b.class_schedules?.day_of_week ?? '', b.class_schedules?.start_time || '',
    b.status || '', fmtDate(b.booked_at), fmtDate(b.checked_in_at), b.rating ?? '',
  ].map(esc).join(','));
  const csv = [header, ...rows].join('\n');
  const filename = `class_bookings_${todayISO()}.csv`;
  downloadCSV(filename, csv);
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

// ── Component ────────────────────────────────────────────────
export default function AdminReports() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const gymId = profile?.gym_id;

  const [rangeKey, setRangeKey] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exporting, setExporting] = useState(null); // key of currently exporting
  const [history, setHistory] = useState(() => getExportHistory());

  const refreshHistory = useCallback(() => setHistory(getExportHistory()), []);

  const handleExport = useCallback(async (key) => {
    if (!gymId || exporting) return;
    setExporting(key);
    try {
      const { from, to } = getDateRange(rangeKey, customFrom ? new Date(customFrom).toISOString() : null, customTo ? new Date(customTo).toISOString() : null);
      const exportFn = EXPORT_FNS[key];
      const result = await exportFn(gymId, from, to);

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

  const rangeLabel = useMemo(() => {
    const preset = RANGE_PRESETS.find(r => r.key === rangeKey);
    return preset ? t(preset.labelKey) : '';
  }, [rangeKey, t]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-6xl mx-auto space-y-8">
      <FadeIn>
        <PageHeader
          title={t('admin.reports.title')}
          subtitle={t('admin.reports.subtitle')}
        />
      </FadeIn>

      {/* ── Date Range Filter ─────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <AdminCard>
          <div className="flex items-center gap-2 mb-4">
            <CalendarRange size={16} className="text-[#D4AF37]" />
            <SectionLabel>{t('admin.reports.dateRange')}</SectionLabel>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map(preset => (
              <button
                key={preset.key}
                onClick={() => setRangeKey(preset.key)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                  rangeKey === preset.key
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                    : 'bg-white/[0.03] text-[#9CA3AF] border border-white/6 hover:border-white/10 hover:text-[#E5E7EB]'
                }`}
              >
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
          {rangeKey === 'custom' && (
            <div className="flex flex-wrap gap-3 mt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6B7280] uppercase tracking-wide">{t('admin.reports.from')}</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="bg-white/[0.04] border border-white/8 rounded-lg px-3 py-1.5 text-[13px] text-[#E5E7EB] focus:outline-none focus:border-[#D4AF37]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6B7280] uppercase tracking-wide">{t('admin.reports.to')}</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="bg-white/[0.04] border border-white/8 rounded-lg px-3 py-1.5 text-[13px] text-[#E5E7EB] focus:outline-none focus:border-[#D4AF37]/50"
                />
              </div>
            </div>
          )}
        </AdminCard>
      </FadeIn>

      {/* ── Quick Export Cards ─────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <div className="flex items-center gap-2 mb-4">
          <FileSpreadsheet size={16} className="text-[#D4AF37]" />
          <SectionLabel>{t('admin.reports.quickExports')}</SectionLabel>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {EXPORT_DEFS.map(({ key, icon: Icon, labelKey, descKey }) => {
            const isActive = exporting === key;
            return (
              <AdminCard key={key} className="flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                      <Icon size={16} className="text-[#D4AF37]" />
                    </div>
                    <p className="text-[13px] font-semibold text-[#E5E7EB] leading-tight">{t(labelKey)}</p>
                  </div>
                  <p className="text-[11px] text-[#6B7280] leading-relaxed mb-3">{t(descKey)}</p>
                </div>
                <button
                  onClick={() => handleExport(key)}
                  disabled={!!exporting}
                  className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all ${
                    isActive
                      ? 'bg-[#D4AF37]/20 text-[#D4AF37] cursor-wait'
                      : exporting
                        ? 'bg-white/[0.02] text-[#6B7280] cursor-not-allowed opacity-50'
                        : 'bg-[#D4AF37]/10 text-[#D4AF37] hover:bg-[#D4AF37]/20 border border-[#D4AF37]/20 hover:border-[#D4AF37]/40'
                  }`}
                >
                  {isActive ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                      {t('admin.reports.exporting')}
                    </>
                  ) : (
                    <>
                      <Download size={13} />
                      {t('admin.reports.exportCSV')}
                    </>
                  )}
                </button>
              </AdminCard>
            );
          })}
        </div>
      </FadeIn>

      {/* ── Export History ─────────────────────────────────────── */}
      <FadeIn delay={0.15}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-[#D4AF37]" />
            <SectionLabel>{t('admin.reports.exportHistory')}</SectionLabel>
          </div>
          {history.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-[#EF4444] transition-colors"
            >
              <Trash2 size={12} />
              {t('admin.reports.clearHistory')}
            </button>
          )}
        </div>
        <AdminCard>
          {history.length === 0 ? (
            <div className="py-8 text-center">
              <Clock size={24} className="mx-auto mb-2 text-[#6B7280]/40" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.reports.noHistory')}</p>
            </div>
          ) : (
            <div className="divide-y divide-white/6">
              {history.map((entry, idx) => {
                const def = EXPORT_DEFS.find(d => d.key === entry.key);
                const Icon = def?.icon || FileSpreadsheet;
                return (
                  <div key={idx} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="w-7 h-7 rounded-md bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                      <Icon size={14} className="text-[#9CA3AF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{entry.filename}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {entry.rows} {t('admin.reports.rows')} &middot; {new Date(entry.exportedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </AdminCard>
      </FadeIn>

      {/* ── Scheduled Reports (Coming Soon) ───────────────────── */}
      <FadeIn delay={0.2}>
        <div className="flex items-center gap-2 mb-4">
          <Timer size={16} className="text-[#D4AF37]" />
          <SectionLabel>{t('admin.reports.scheduledReports')}</SectionLabel>
        </div>
        <AdminCard>
          <div className="py-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-3">
              <Timer size={24} className="text-[#D4AF37]/50" />
            </div>
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-1">{t('admin.reports.comingSoon')}</p>
            <p className="text-[12px] text-[#6B7280] max-w-xs mx-auto">{t('admin.reports.scheduledDesc')}</p>
          </div>
        </AdminCard>
      </FadeIn>
    </div>
  );
}
