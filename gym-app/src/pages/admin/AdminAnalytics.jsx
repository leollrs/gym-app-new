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
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-5 h-5 text-[color:var(--color-accent)]" />
        <h3 className="text-white font-semibold text-lg">{t('admin.analytics.kpiTargets', 'KPI Targets')}</h3>
        <span className="text-white/40 text-sm ml-auto">{format(new Date(), 'MMMM yyyy', dateFnsLocale)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {KPI_METRICS.map((m) => {
          const row = targets[m.key];
          const current = row?.current_value;
          const target = row?.target_value;
          const pct = target ? Math.min(((current ?? 0) / target) * 100, 120) : 0;
          const isEditing = editing === m.key;

          return (
            <div key={m.key} className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{m.icon}</span>
                <span className="text-white/70 text-xs font-medium leading-tight">{t(m.labelKey)}</span>
              </div>

              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${getTextColor(current, target, m.invertColor)}`}>
                  {current != null ? `${current}${m.unit}` : '—'}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getStatusColor(current, target, m.invertColor)}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>

              {/* Target row */}
              {isEditing ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="number"
                    className="w-full bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-[color:var(--color-accent)]"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && save(m.key)}
                    autoFocus
                  />
                  <button onClick={() => save(m.key)} className="p-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditing(null)} className="p-1 rounded-lg bg-white/[0.06] text-white/40 hover:bg-white/10">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditing(m.key); setDraft(target ?? ''); }}
                  className="text-xs text-white/40 hover:text-[color:var(--color-accent)] transition-colors text-left mt-1"
                >
                  {target != null ? t('admin.analytics.targetLabel', { value: target, unit: m.unit, defaultValue: 'Target: {{value}}{{unit}}' }) : t('admin.analytics.setTarget', '+ Set Target')}
                </button>
              )}
            </div>
          );
        })}
      </div>
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
        <p className="text-[#EF4444] text-[14px] font-semibold">Access denied</p>
      </div>
    );
  }

  return (
    <AdminPageShell>

      {/* Page header */}
      <FadeIn>
        <PageHeader
          title={t('admin.analytics.title', 'Analytics')}
          subtitle={t('admin.analytics.subtitle', 'Retention, growth, and engagement metrics')}
          className="mb-6"
        />
      </FadeIn>

      {/* KPI Targets */}
      <FadeIn delay={30}>
        <KPITargets gymId={gymId} />
      </FadeIn>

      <div className="grid xl:grid-cols-12 gap-4">
        {/* Member Lifecycle Funnel */}
        <FadeIn delay={60} className="xl:col-span-7">
          <LifecycleStages gymId={gymId} />
        </FadeIn>

        {/* Monthly Summary */}
        <FadeIn delay={90} className="xl:col-span-5">
          <MonthlySummary gymId={gymId} />
        </FadeIn>

        {/* Row 1: Member Growth + Retention Rate */}
        <FadeIn delay={120} className="xl:col-span-8">
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <GrowthChart gymId={gymId} />
            <RetentionChart gymId={gymId} />
          </div>
        </FadeIn>

        {/* Row 1b: Engagement */}
        <FadeIn delay={180} className="xl:col-span-4">
          <div className="mb-4 h-full">
            <ActivityChart gymId={gymId} />
          </div>
        </FadeIn>

        {/* Row 2: Cohort Retention */}
        <FadeIn delay={240} className="xl:col-span-12">
          <div className="mb-4">
            <CohortTable gymId={gymId} />
          </div>
        </FadeIn>

        {/* Trainer Performance */}
        <FadeIn delay={300} className="xl:col-span-12">
          <TrainerPerformance gymId={gymId} />
        </FadeIn>

        {/* Row 4: Challenge Participation (60%) + Onboarding Completion (40%) — full width */}
        <FadeIn delay={360} className="xl:col-span-12">
          <div className="grid md:grid-cols-[3fr_2fr] gap-4">
            <ChallengeStats gymId={gymId} />
            <OnboardingFunnel gymId={gymId} />
          </div>
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
