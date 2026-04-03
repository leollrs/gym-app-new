import { useEffect, useState } from 'react';
import { Target, Check, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { FadeIn, PageHeader, AdminPageShell } from '../../components/admin';
import { adminKeys } from '../../lib/adminQueryKeys';

import GrowthChart from './components/analytics/GrowthChart';
import RetentionChart from './components/analytics/RetentionChart';
import ActivityChart from './components/analytics/ActivityChart';
import CohortTable from './components/analytics/CohortTable';
import ChallengeStats from './components/analytics/ChallengeStats';
import OnboardingFunnel from './components/analytics/OnboardingFunnel';
import LifecycleStages from './components/analytics/LifecycleStages';
import TrainerPerformance from './components/analytics/TrainerPerformance';
import MonthlySummary from './components/analytics/MonthlySummary';

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
  if (current == null || target == null) return 'text-white/40';
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
  const { addToast } = useToast();
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
        .select('metric, target_value, current_value')
        .eq('gym_id', gymId)
        .eq('month', month);
      const map = {};
      (data || []).forEach((r) => { map[r.metric] = r; });
      return map;
    },
    enabled: !!gymId,
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
      addToast(t('admin.analytics.targetSaved', 'Target saved'), 'success');
      setEditing(null);
    },
    onError: () => addToast(t('admin.analytics.targetSaveFailed', 'Failed to save target'), 'error'),
  });

  const save = (metric) => {
    const val = parseFloat(draft);
    if (isNaN(val) || val < 0) return;
    upsert.mutate({ metric, value: val });
  };

  return (
    <div className="mb-8">
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl bg-[color:var(--color-accent)]/10 flex items-center justify-center">
          <Target className="w-4 h-4 text-[color:var(--color-accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-[16px] tracking-tight">
            {t('admin.analytics.kpiTargets', 'KPI Targets')}
          </h3>
        </div>
        <span className="text-white/30 text-[12px] tabular-nums">
          {format(new Date(), 'MMMM yyyy', dateFnsLocale)}
        </span>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {KPI_METRICS.map((m) => {
          const row = targets[m.key];
          const current = row?.current_value;
          const target = row?.target_value;
          const pct = target ? Math.min(((current ?? 0) / target) * 100, 120) : 0;
          const isEditing = editing === m.key;

          return (
            <div
              key={m.key}
              className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-5
                hover:border-white/[0.08] hover:bg-[#111827]/80
                transition-all duration-200 group"
            >
              {/* Label row */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base leading-none">{m.icon}</span>
                <span className="text-white/60 text-[11.5px] font-medium leading-tight tracking-wide uppercase">
                  {t(m.labelKey)}
                </span>
              </div>

              {/* Current value -- large and prominent */}
              <div className="flex items-baseline gap-1 mb-3">
                <span className={`text-[28px] font-bold leading-none tabular-nums tracking-tight ${getTextColor(current, target, m.invertColor)}`}>
                  {current != null ? `${current}${m.unit}` : '--'}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${getStatusColor(current, target, m.invertColor)}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>

              {/* Target row */}
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
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
                    className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400
                      hover:bg-emerald-500/30 active:scale-95 transition-all duration-150"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="p-1.5 rounded-lg bg-white/[0.06] text-white/40
                      hover:bg-white/10 active:scale-95 transition-all duration-150"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditing(m.key); setDraft(target ?? ''); }}
                  className="text-[11.5px] text-white/35 hover:text-[color:var(--color-accent)]
                    transition-colors duration-200 text-left"
                >
                  {target != null
                    ? t('admin.analytics.targetLabel', { value: target, unit: m.unit, defaultValue: 'Target: {{value}}{{unit}}' })
                    : t('admin.analytics.setTarget', '+ Set Target')}
                </button>
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
    <div className="flex items-center gap-3 mb-5 mt-2">
      <div className="h-px flex-1 bg-gradient-to-r from-white/[0.08] to-transparent" />
      {label && (
        <span className="text-[10.5px] font-semibold text-[#D4AF37]/60 uppercase tracking-[0.12em] flex-shrink-0">
          {label}
        </span>
      )}
      <div className="h-px flex-1 bg-gradient-to-l from-white/[0.08] to-transparent" />
    </div>
  );
}

export default function AdminAnalytics() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  useEffect(() => { document.title = t('admin.analytics.title', 'Analytics') + ' | TuGymPR'; }, [t]);

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

      {/* ── 1. Header ── */}
      <FadeIn>
        <PageHeader
          title={t('admin.analytics.title', 'Analytics')}
          subtitle={t('admin.analytics.subtitle', 'Retention, growth, and engagement metrics')}
          className="mb-10"
        />
      </FadeIn>

      {/* ── 2. KPI Target Cards ── */}
      <FadeIn delay={30}>
        <KPITargets gymId={gymId} />
      </FadeIn>

      {/* ── Visual separator: Operational metrics ── */}
      <FadeIn delay={50}>
        <SectionDivider label="Engagement" />
      </FadeIn>

      {/* ── 3. Onboarding + Challenge: 50/50 ── */}
      <FadeIn delay={60}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
          <OnboardingFunnel gymId={gymId} />
          <ChallengeStats gymId={gymId} />
        </div>
      </FadeIn>

      {/* ── Visual separator: Growth analytics ── */}
      <FadeIn delay={80}>
        <SectionDivider label="Growth" />
      </FadeIn>

      {/* ── 4. Broad metrics: Growth + Retention side-by-side ── */}
      <FadeIn delay={90}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
          <GrowthChart gymId={gymId} />
          <RetentionChart gymId={gymId} />
        </div>
      </FadeIn>

      {/* ── Visual separator: Activity deep-dive ── */}
      <FadeIn delay={110}>
        <SectionDivider label="Activity" />
      </FadeIn>

      {/* ── 5. Engagement 60% + Lifecycle 40% ── */}
      <FadeIn delay={120}>
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5 mb-8 items-stretch">
          <div className="min-h-0"><ActivityChart gymId={gymId} /></div>
          <div className="min-h-0"><LifecycleStages gymId={gymId} /></div>
        </div>
      </FadeIn>

      {/* ── Visual separator: Deep analysis ── */}
      <FadeIn delay={140}>
        <SectionDivider label="Analysis" />
      </FadeIn>

      {/* ── 6. Cohort Retention -- full width ── */}
      <FadeIn delay={150}>
        <div className="mb-8">
          <CohortTable gymId={gymId} />
        </div>
      </FadeIn>

      {/* ── 7. Trainer Performance -- full width ── */}
      <FadeIn delay={180}>
        <div className="mb-8">
          <TrainerPerformance gymId={gymId} />
        </div>
      </FadeIn>

      {/* ── 8. Monthly Summary -- full width ── */}
      <FadeIn delay={210}>
        <MonthlySummary gymId={gymId} />
      </FadeIn>

    </AdminPageShell>
  );
}
