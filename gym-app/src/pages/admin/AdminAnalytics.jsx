import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Check, X, Pencil, TrendingUp, TrendingDown, Minus, LayoutDashboard, Sprout, Zap, Microscope, HeartHandshake, AlertTriangle, Sparkles } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useAuth } from '../../contexts/AuthContext';
import { useInsightsRange } from '../../contexts/InsightsRangeContext';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { FadeIn, PageHeader, AdminPageShell, AdminTabs } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { adminKeys } from '../../lib/adminQueryKeys';
import { suggestTarget, checkRealism } from '../../lib/admin/realisticTargets';
import { fetchCurrentKPIs } from '../../lib/admin/currentKPIs';

import GrowthChart from './components/analytics/GrowthChart';
import RetentionChart from './components/analytics/RetentionChart';
import ActivityChart from './components/analytics/ActivityChart';
import CohortTable from './components/analytics/CohortTable';
import ChallengeStats from './components/analytics/ChallengeStats';
import OnboardingFunnel from './components/analytics/OnboardingFunnel';
import LifecycleStages from './components/analytics/LifecycleStages';
import TrainerPerformance from './components/analytics/TrainerPerformance';
import MonthlySummary from './components/analytics/MonthlySummary';
import LTVCard from './components/analytics/LTVCard';
import WhyLeftPanel from './components/WhyLeftPanel';
import RetentionEffectivenessPanel from './components/RetentionEffectivenessPanel';

const KPI_METRICS = [
  { key: 'retention_rate', labelKey: 'admin.analytics.retentionRate', unit: '%', icon: '📊' },
  { key: 'new_members', labelKey: 'admin.analytics.newMembers', unit: '', icon: '👥' },
  { key: 'active_rate', labelKey: 'admin.analytics.activeRate', unit: '%', icon: '🔥' },
  { key: 'avg_workouts', labelKey: 'admin.analytics.avgWorkouts', unit: '', icon: '💪' },
  { key: 'checkin_rate', labelKey: 'admin.analytics.checkinRate', unit: '%', icon: '📍' },
  { key: 'churn_rate', labelKey: 'admin.analytics.churnRate', unit: '%', icon: '⚠️', invertColor: true },
];

function getStatusColor(current, target, invert) {
  if (current == null || target == null) return 'bg-white/10';
  const ratio = current / target;
  if (invert) {
    if (ratio <= 1) return 'bg-emerald-500';
    if (ratio <= 1.25) return 'bg-amber-500';
    return 'bg-red-500';
  }
  if (ratio >= 1) return 'bg-emerald-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-red-500';
}

function getTextColor(current, target, invert) {
  if (current == null || target == null) return 'text-white/70';
  const ratio = current / target;
  if (invert) {
    if (ratio <= 1) return 'text-emerald-400';
    if (ratio <= 1.25) return 'text-amber-400';
    return 'text-red-400';
  }
  if (ratio >= 1) return 'text-emerald-400';
  if (ratio >= 0.8) return 'text-amber-400';
  return 'text-red-400';
}

function KPITargets({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const month = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  const { data: targets = {} } = useQuery({
    queryKey: [...adminKeys.analytics.all(gymId), 'kpi-targets', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('admin_kpi_targets')
        .select('metric, target_value')
        .eq('gym_id', gymId)
        .eq('month', month);
      const map = {};
      (data || []).forEach((r) => { map[r.metric] = r; });
      return map;
    },
    enabled: !!gymId,
  });

  // Current KPI values, derived live from profiles/sessions/check_ins. Feeds
  // both the "current vs target" display and the realistic-target advisor
  // so suggestions are anchored on this gym's actual performance instead of
  // floating in space. 5-min staleTime — these don't change minute-to-minute
  // and the queries scan a few thousand rows.
  const { data: currentKPIs = {} } = useQuery({
    queryKey: [...adminKeys.analytics.all(gymId), 'kpi-current'],
    queryFn: () => fetchCurrentKPIs(gymId),
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });

  const upsert = useMutation({
    mutationFn: async ({ metric, value }) => {
      const { error } = await supabase
        .from('admin_kpi_targets')
        .upsert({ gym_id: gymId, month, metric, target_value: value }, { onConflict: 'gym_id,month,metric' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.analytics.all(gymId) });
      showToast(t('admin.analytics.targetSaved', 'Target saved'), 'success');
      setEditing(null);
    },
    onError: () => showToast(t('admin.analytics.targetSaveFailed', 'Failed to save target'), 'error'),
  });

  const save = (metric) => {
    const val = parseFloat(draft);
    if (isNaN(val) || val < 0) return;
    upsert.mutate({ metric, value: val });
  };

  return (
    <div className="mb-5">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <Target size={14} style={{ color: 'var(--color-accent)' }} />
        <span
          className="text-[14px] font-extrabold"
          style={{ color: 'var(--color-admin-text)' }}
        >
          {t('admin.analytics.kpiTargets', 'KPI Targets')}
        </span>
        <div className="flex-1" />
        <span className="text-[11.5px] tabular-nums" style={{ color: 'var(--color-admin-text-muted)' }}>
          {format(new Date(), 'MMMM yyyy', dateFnsLocale)}
        </span>
      </div>

      {/* KPI Grid — 3 cols */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
        {KPI_METRICS.map((m) => {
          const row = targets[m.key];
          const current = currentKPIs?.[m.key] ?? null;
          const target = row?.target_value;
          const pct = target ? Math.min(((current ?? 0) / target) * 100, 120) : 0;
          const isEditing = editing === m.key;
          // Suggestion anchored on this gym's current performance (or the
          // industry default when no baseline exists). Drives both the
          // tap-to-apply chip and the soft warning below the input.
          const suggested = suggestTarget(m.key, current);
          const draftNum = parseFloat(draft);
          const realism = isEditing && Number.isFinite(draftNum)
            ? checkRealism(m.key, current, draftNum)
            : null;

          return (
            <div
              key={m.key}
              className="admin-card p-3 sm:p-4 transition-all duration-200 group overflow-hidden"
            >
              {/* Label row */}
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-base leading-none">{m.icon}</span>
                <span
                  className="admin-eyebrow"
                  style={{ fontSize: '10.5px' }}
                >
                  {t(m.labelKey)}
                </span>
              </div>

              {/* Current value + delta indicator */}
              <div className="flex items-baseline gap-2 mb-3">
                <span
                  className={`admin-kpi text-[22px] md:text-[28px] leading-none tabular-nums ${getTextColor(current, target, m.invertColor)}`}
                  style={{ letterSpacing: '-0.8px' }}
                >
                  {current != null ? `${current}${m.unit}` : '——'}
                </span>
                {current != null && target != null && (() => {
                  const diff = current - target;
                  const meetingTarget = m.invertColor ? diff <= 0 : diff >= 0;
                  const atTarget = Math.abs(diff) < 0.01;
                  if (atTarget) return (
                    <span className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-400">
                      <Minus className="w-3 h-3" /> {t('admin.analytics.onTarget', 'On target')}
                    </span>
                  );
                  return (
                    <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${meetingTarget ? 'text-emerald-400' : 'text-red-400'}`}>
                      {meetingTarget
                        ? <TrendingUp className="w-3 h-3" />
                        : <TrendingDown className="w-3 h-3" />
                      }
                      {Math.abs(diff).toFixed(m.unit === '%' ? 1 : 0)}{m.unit} {meetingTarget ? (m.invertColor ? t('admin.analytics.below', 'below') : t('admin.analytics.above', 'above')) : (m.invertColor ? t('admin.analytics.above', 'above') : t('admin.analytics.below', 'below'))}
                    </span>
                  );
                })()}
              </div>

              {/* Progress bar */}
              <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'var(--color-admin-panel)' }}>
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${getStatusColor(current, target, m.invertColor)}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>

              {/* Target row */}
              {isEditing ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      max="100000"
                      aria-label={t('admin.analytics.targetInput', { metric: t(m.labelKey), defaultValue: 'Target value for {{metric}}' })}
                      className="w-full bg-white/[0.06] border border-white/10 rounded-lg px-2.5 py-1.5
                        text-sm text-white outline-none
                        focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]/20
                        transition-all duration-200"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && save(m.key)}
                      autoFocus
                    />
                    <button
                      onClick={() => save(m.key)}
                      aria-label={t('admin.analytics.saveTarget', 'Save target')}
                      className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400
                        hover:bg-emerald-500/30 active:scale-95 transition-all duration-150"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      aria-label={t('admin.analytics.cancelEdit', 'Cancel editing')}
                      className="p-1.5 rounded-lg bg-white/[0.06] text-white/70
                        hover:bg-white/10 active:scale-95 transition-all duration-150"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Suggestion chip — tap to populate the input. Sourced
                      from realisticTargets.js using this gym's current
                      baseline (or the industry default when no data). */}
                  {suggested != null && (
                    <button
                      onClick={() => setDraft(String(suggested))}
                      className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-md px-1.5 py-1 transition-colors"
                      style={{
                        background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                        color: 'var(--color-accent)',
                      }}
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      {t('admin.analytics.suggestedTarget', { value: suggested, unit: m.unit, defaultValue: 'Suggested: {{value}}{{unit}}' })}
                    </button>
                  )}
                  {/* Soft warning when the typed value is well outside what
                      this gym can plausibly hit in a month. Doesn't block
                      save — the owner can still commit aggressive goals. */}
                  {realism && (
                    <div
                      className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-snug rounded-md px-2 py-1.5"
                      style={{
                        background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                        color: 'var(--color-warning)',
                      }}
                    >
                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>
                        {t('admin.analytics.unrealisticWarning', {
                          baseline: realism.baseline,
                          delta: realism.monthlyDelta,
                          suggested: realism.suggested,
                          unit: realism.unit,
                          defaultValue: 'From {{baseline}}{{unit}} baseline, gyms typically improve ~{{delta}}{{unit}}/month. Suggested: {{suggested}}{{unit}}.',
                        })}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setEditing(m.key); setDraft(target ?? ''); }}
                    className="flex items-center gap-1.5 text-[11.5px] text-white/60 hover:text-[color:var(--color-accent)]
                      transition-colors duration-200 text-left group/edit"
                  >
                    <Pencil className="w-3 h-3 opacity-0 group-hover/edit:opacity-100 transition-opacity duration-200" />
                    {target != null
                      ? t('admin.analytics.targetLabel', { value: target, unit: m.unit, defaultValue: 'Target: {{value}}{{unit}}' })
                      : t('admin.analytics.setTarget', '+ Set Target')}
                  </button>
                  {/* When no target has been set yet, surface the suggested
                      value inline so the owner has a one-tap starting point
                      instead of staring at a blank field. */}
                  {target == null && suggested != null && (
                    <button
                      onClick={() => { setEditing(m.key); setDraft(String(suggested)); }}
                      className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-md px-1.5 py-1 transition-colors"
                      style={{
                        background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                        color: 'var(--color-accent)',
                      }}
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      {t('admin.analytics.suggestedTarget', { value: suggested, unit: m.unit, defaultValue: 'Suggested: {{value}}{{unit}}' })}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section Divider ──────────────────────────────────────
function SectionDivider({ label }) {
  return (
    <div className="flex items-center justify-center mb-3 mt-2">
      {label && (
        <span
          className="admin-eyebrow text-center"
          style={{ fontSize: '10.5px', letterSpacing: '1.1px' }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ── Period Selector Pills ────────────────────────────────
// Every chart on this page is a MONTHLY trend (growth / retention curve /
// engagement / cohort), so the selector is month-spans, not day windows — a
// "7 day" window of a monthly chart is meaningless. `months` drives the trend
// charts; `days` is kept only so the shared InsightsRangeContext still
// interoperates with the day-based sibling pages (Attendance/Revenue/NPS).
const PERIODS = [
  { key: '3m', labelKey: 'admin.analytics.period3m', fallback: '3M', days: 90, months: 3 },
  { key: '6m', labelKey: 'admin.analytics.period6m', fallback: '6M', days: 180, months: 6 },
  { key: '12m', labelKey: 'admin.analytics.period12m', fallback: '12M', days: 365, months: 12 },
  { key: 'all', labelKey: 'admin.analytics.periodAll', fallback: 'All', days: null, months: null },
];

function PeriodSelector({ value, onChange }) {
  const { t } = useTranslation('pages');
  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={`admin-pill flex-shrink-0 inline-flex items-center justify-center min-h-[44px] ${value === p.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
          style={{ padding: '0 16px', fontSize: 12 }}
        >
          {t(p.labelKey, p.fallback)}
        </button>
      ))}
    </div>
  );
}

// ── Tab definitions ──────────────────────────────────────
const ANALYTICS_TAB_KEYS = [
  // Tab key stays 'overview' for stable URLs; the user-facing label is now
  // "This Month" / "Este mes" to disambiguate from the AdminOverview page.
  { key: 'overview', labelKey: 'admin.analytics.tabThisMonth', fallback: 'This Month', icon: LayoutDashboard },
  { key: 'growth', labelKey: 'admin.analytics.tabGrowth', fallback: 'Growth', icon: Sprout },
  { key: 'engagement', labelKey: 'admin.analytics.tabEngagement', fallback: 'Engagement', icon: Zap },
  { key: 'retention',  labelKey: 'admin.analytics.tabRetention',  fallback: 'Retention',  icon: HeartHandshake },
  { key: 'deep-dives', labelKey: 'admin.analytics.tabDeepDives', fallback: 'Deep Dives', icon: Microscope },
];

export default function AdminAnalytics() {
  const { t } = useTranslation('pages');
  const { profile, availableRoles } = useAuth();
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = useCallback((tab) => {
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);
  // Period is shared across Insights pages via InsightsRangeContext.
  // If the context's value isn't one of this page's PERIODS choices
  // (e.g. NPS set 180d which Analytics doesn't offer), fall back to '30d'
  // for display + queries without overwriting the shared state.
  const { periodDays: ctxPeriodDays, setPeriodDays } = useInsightsRange();
  const matchedPeriod = PERIODS.find((p) => p.days === ctxPeriodDays) ?? PERIODS.find((p) => p.key === '6m');
  const period = matchedPeriod.key;
  const setPeriod = (key) => setPeriodDays((PERIODS.find((p) => p.key === key) || {}).days ?? null);

  const ANALYTICS_TABS = ANALYTICS_TAB_KEYS.map(tab => ({
    ...tab,
    label: t(tab.labelKey, tab.fallback),
  }));

  useEffect(() => { document.title = t('admin.analytics.title', 'Analytics') + ' | ' + (window.__APP_NAME || 'TuGymPR'); }, [t]);

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[#EF4444] text-[14px] font-semibold">
          {t('admin.overview.accessDenied')}
        </p>
      </div>
    );
  }

  return (
    <AdminPageShell>

      {/* ── 1. Header + Period Selector ── */}
      <FadeIn>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <PageHeader
            title={t('admin.analytics.title', 'Analytics')}
            subtitle={t('admin.analytics.subtitle', 'Retention, growth, and engagement metrics')}
            className="mb-0"
          />
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </FadeIn>

      {/* ── 2. Tab Bar ── */}
      <FadeIn delay={20}>
        <AdminTabs tabs={ANALYTICS_TABS} active={activeTab} onChange={setActiveTab} className="mb-6" />
      </FadeIn>

      {/* ── Tab Content ── */}
      {/* Each child receives the selected period so its query window matches what
          the admin picked. PERIODS map: 7d/30d/90d → days; 'all' → null (component
          interprets null as "no upper bound"). */}
      {(() => {
        const selectedPeriod = PERIODS.find((p) => p.key === period) || {};
        // monthsBack drives the monthly trend charts (Growth / Retention curve /
        // Engagement / Cohort). null = "All" → each chart applies its own bounded
        // cap. Snapshot cards (KPIs, LTV, Lifecycle, Onboarding, Trainer,
        // MonthlySummary) intentionally ignore it — they're point-in-time or have
        // their own range control.
        const monthsBack = selectedPeriod.months ?? null;
        return (
          <SwipeableTabContent tabs={ANALYTICS_TABS} active={activeTab} onChange={setActiveTab}>
            {(tabKey) => {
              if (tabKey === 'overview') return (
                <>
                  <FadeIn delay={30}>
                    {/* KPI targets are monthly / 30d by design — period N/A. */}
                    <KPITargets gymId={gymId} />
                  </FadeIn>
                  <FadeIn delay={50}>
                    <SectionDivider label={t('admin.analytics.sectionLifecycle', 'Lifecycle')} />
                  </FadeIn>
                  <FadeIn delay={60}>
                    <div className="mb-8">
                      {/* Snapshot — current lifecycle mix; period N/A by design. */}
                      <LifecycleStages gymId={gymId} />
                    </div>
                  </FadeIn>
                </>
              );
              if (tabKey === 'growth') return (
                <>
                  <FadeIn delay={30}>
                    <div className="mb-5">
                      <LTVCard gymId={gymId} />
                    </div>
                  </FadeIn>
                  <FadeIn delay={40}>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
                      <GrowthChart gymId={gymId} monthsBack={monthsBack} />
                      <RetentionChart gymId={gymId} monthsBack={monthsBack} />
                    </div>
                  </FadeIn>
                </>
              );
              if (tabKey === 'engagement') return (
                <>
                  <FadeIn delay={30}>
                    <SectionDivider label={t('admin.analytics.sectionOnboarding', 'Onboarding & Challenges')} />
                  </FadeIn>
                  <FadeIn delay={40}>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
                      {/* Snapshots / own filters — period N/A by design. */}
                      <OnboardingFunnel gymId={gymId} />
                      <ChallengeStats gymId={gymId} />
                    </div>
                  </FadeIn>
                  <FadeIn delay={60}>
                    <SectionDivider label={t('admin.analytics.sectionActivity', 'Activity')} />
                  </FadeIn>
                  <FadeIn delay={70}>
                    <div className="mb-8">
                      <ActivityChart gymId={gymId} monthsBack={monthsBack} />
                    </div>
                  </FadeIn>
                </>
              );
              if (tabKey === 'retention') return (
                <>
                  <FadeIn delay={30}>
                    <SectionDivider label={t('admin.analytics.sectionWhyLeft', 'Why members leave')} />
                  </FadeIn>
                  <FadeIn delay={40}>
                    <div className="mb-8">
                      <WhyLeftPanel gymId={gymId} />
                    </div>
                  </FadeIn>
                  <FadeIn delay={60}>
                    <SectionDivider label={t('admin.analytics.sectionEffectiveness', 'Retention machine effectiveness')} />
                  </FadeIn>
                  <FadeIn delay={70}>
                    <div className="mb-8">
                      <RetentionEffectivenessPanel gymId={gymId} />
                    </div>
                  </FadeIn>
                </>
              );
              if (tabKey === 'deep-dives') return (
                <>
                  <FadeIn delay={30}>
                    <SectionDivider label={t('admin.analytics.sectionCohortRetention', 'Cohort Retention')} />
                  </FadeIn>
                  <FadeIn delay={40}>
                    <div className="mb-8">
                      <CohortTable gymId={gymId} monthsBack={monthsBack} />
                    </div>
                  </FadeIn>
                  <FadeIn delay={60}>
                    <SectionDivider label={t('admin.analytics.sectionTrainerPerformance', 'Trainer Performance')} />
                  </FadeIn>
                  <FadeIn delay={70}>
                    <div className="mb-8">
                      {/* 30-day performance snapshot — own fixed window by design. */}
                      <TrainerPerformance gymId={gymId} />
                    </div>
                  </FadeIn>
                  <FadeIn delay={90}>
                    <SectionDivider label={t('admin.analytics.sectionMonthlySummary', 'Monthly Summary')} />
                  </FadeIn>
                  <FadeIn delay={100}>
                    {/* Has its own month navigator — period selector N/A. */}
                    <MonthlySummary gymId={gymId} />
                  </FadeIn>
                </>
              );
              return null;
            }}
          </SwipeableTabContent>
        );
      })()}

    </AdminPageShell>
  );
}
