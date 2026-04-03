import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { BENCHMARKS } from '../../../../lib/benchmarks';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

const TOTAL_STEPS = 9;

async function fetchOnboardingData(gymId) {
  const { data: members, error } = await supabase
    .from('profiles')
    .select('id, is_onboarded, onboarding_step')
    .eq('gym_id', gymId)
    .eq('role', 'member');
  if (error) throw error;

  const total     = (members || []).length;
  const onboarded = (members || []).filter(m => m.is_onboarded).length;
  const pct       = total > 0 ? Math.round((onboarded / total) * 100) : 0;

  // Build step funnel: for each step, count how many users reached it or beyond
  const stepCounts = {};
  for (let i = 0; i <= TOTAL_STEPS; i++) stepCounts[i] = 0;
  (members || []).forEach(p => {
    const memberStep = p.onboarding_step ?? (p.is_onboarded ? TOTAL_STEPS : 0);
    for (let i = 0; i <= memberStep; i++) stepCounts[i]++;
  });

  return { total, onboarded, pct, stepCounts };
}

export default function OnboardingFunnel({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: stats = { total: 0, onboarded: 0, pct: 0, stepCounts: {} }, isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.onboarding(gymId),
    queryFn: () => fetchOnboardingData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton />;
  if (isError) return <ErrorCard message={t('admin.analytics.onboardingError', 'Failed to load onboarding data')} onRetry={refetch} />;

  const donutData = [
    { name: 'Onboarded',     value: stats.onboarded },
    { name: 'Not Onboarded', value: stats.total - stats.onboarded },
  ];

  // Step labels from i18n
  const stepLabels = [
    t('adminAnalytics.onboardingSteps.invite'),
    t('adminAnalytics.onboardingSteps.language'),
    t('adminAnalytics.onboardingSteps.fitnessLevel'),
    t('adminAnalytics.onboardingSteps.goal'),
    t('adminAnalytics.onboardingSteps.equipment'),
    t('adminAnalytics.onboardingSteps.schedule'),
    t('adminAnalytics.onboardingSteps.injuries'),
    t('adminAnalytics.onboardingSteps.healthSync'),
    t('adminAnalytics.onboardingSteps.social'),
    t('adminAnalytics.onboardingSteps.complete'),
  ];

  const { stepCounts } = stats;
  const hasStepData = Object.values(stepCounts).some(v => v > 0);

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight">
            {t('adminAnalytics.onboardingCompletion', { defaultValue: 'Onboarding Completion' })}
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
            {t('admin.analytics.onboardingIndustryAvg', { value: BENCHMARKS.onboardingCompletion, defaultValue: 'Industry avg: {{value}}% onboarding completion' })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-8 mt-4">

        {/* Donut chart */}
        <div className="flex-shrink-0 relative">
          <ResponsiveContainer width={130} height={130}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={58}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                strokeWidth={0}
              >
                <Cell fill="var(--color-accent)" />
                <Cell fill="rgba(255,255,255,0.05)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Centered percentage inside donut */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[20px] font-bold text-[var(--color-accent)] leading-none tracking-tight">{stats.pct}%</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{t('admin.analytics.onboardingCompletionRate', 'Completion rate')}</p>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                <span className="text-[12px] text-[var(--color-text-muted)]">{t('admin.analytics.onboardingOnboarded', 'Onboarded')}</span>
              </div>
              <span className="text-[12px] font-semibold text-[var(--color-text-primary)] tabular-nums">{stats.onboarded}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-white/8" />
                <span className="text-[12px] text-[var(--color-text-muted)]">{t('admin.analytics.onboardingNotCompleted', 'Not completed')}</span>
              </div>
              <span className="text-[12px] font-semibold text-[var(--color-text-primary)] tabular-nums">
                {stats.total - stats.onboarded}
              </span>
            </div>
            <div className="h-px bg-white/[0.05] my-1" />
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[var(--color-text-muted)]">{t('admin.analytics.onboardingTotalMembers', 'Total members')}</span>
              <span className="text-[12px] font-semibold text-[var(--color-text-primary)] tabular-nums">{stats.total}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Step-by-step funnel */}
      {hasStepData && (
        <div className="mt-6 pt-5 border-t border-white/[0.05]">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-4">
            {t('adminAnalytics.onboardingFunnelLabel', { defaultValue: 'Step-by-Step Funnel' })}
          </p>
          <div className="space-y-2">
            {stepLabels.map((label, i) => {
              const count = stepCounts[i] || 0;
              const maxCount = stepCounts[0] || 1;
              const pctOfTotal = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
              const prevCount = i > 0 ? (stepCounts[i - 1] || 0) : count;
              const dropOff = prevCount > 0 ? prevCount - count : 0;
              const dropPct = prevCount > 0 && dropOff > 0 ? Math.round((dropOff / prevCount) * 100) : 0;

              return (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="text-[10px] font-mono text-[var(--color-text-subtle)] w-4 text-right flex-shrink-0 opacity-60">{i}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-[var(--color-text-muted)] truncate">{label}</span>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="text-[11px] font-semibold text-[var(--color-text-primary)] tabular-nums">{count}</span>
                        {dropPct > 0 && (
                          <span className="text-[10px] text-red-400/80 tabular-nums">-{dropPct}%</span>
                        )}
                      </div>
                    </div>
                    <div className="h-[5px] rounded-full bg-white/[0.04] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${pctOfTotal}%`,
                          backgroundColor: i === TOTAL_STEPS ? '#34D399' : 'var(--color-accent)',
                          opacity: 0.35 + (pctOfTotal / 100) * 0.65,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AdminCard>
  );
}
