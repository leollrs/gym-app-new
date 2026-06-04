import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { BENCHMARKS } from '../../../../lib/benchmarks';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Card, Donut, Funnel } from './analyticsKit';

const TOTAL_STEPS = 9;

async function fetchOnboardingData(gymId) {
  const { data: members, error } = await supabase
    .from('profiles')
    .select('id, is_onboarded, onboarding_step')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('imported_archived', false);
  if (error) throw error;

  const total = (members || []).length;
  const onboarded = (members || []).filter(m => m.is_onboarded).length;
  const pct = total > 0 ? Math.round((onboarded / total) * 100) : 0;

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
  const steps = stepLabels.map((label, i) => {
    const count = stepCounts[i] || 0;
    const prevCount = i > 0 ? (stepCounts[i - 1] || 0) : count;
    const dropOff = prevCount > 0 ? prevCount - count : 0;
    const dropPct = prevCount > 0 && dropOff > 0 ? Math.round((dropOff / prevCount) * 100) : 0;
    return { label, value: count, drop: dropPct > 0 ? `-${dropPct}%` : null };
  });

  const rowDot = (color) => <span style={{ width: 9, height: 9, borderRadius: 99, background: color, flexShrink: 0 }} />;

  return (
    <Card style={{ padding: '22px 24px' }}>
      <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>
        {t('adminAnalytics.onboardingCompletion', { defaultValue: 'Onboarding Completion' })}
      </div>
      <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 4 }}>
        {t('admin.analytics.onboardingIndustryAvg', { value: BENCHMARKS.onboardingCompletion, defaultValue: 'Industry avg: {{value}}% onboarding completion' })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 26, margin: '20px 0 4px', flexWrap: 'wrap' }}>
        <Donut pct={stats.pct} size={150} color={TK.accent} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: TK.textFaint, marginBottom: 12 }}>
            {t('admin.analytics.onboardingCompletionRate', 'Completion rate')}
          </div>
          {[[t('admin.analytics.onboardingOnboarded', 'Onboarded'), stats.onboarded, TK.accent],
            [t('admin.analytics.onboardingNotCompleted', 'Not completed'), stats.total - stats.onboarded, TK.surface3]].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${TK.divider}` }}>
              {rowDot(r[2])}
              <span style={{ flex: 1, fontFamily: FK.body, fontSize: 14, color: TK.textSub }}>{r[0]}</span>
              <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text }}>{r[1]}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 11 }}>
            <span style={{ flex: 1, fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text }}>{t('admin.analytics.onboardingTotalMembers', 'Total members')}</span>
            <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text }}>{stats.total}</span>
          </div>
        </div>
      </div>

      {hasStepData && (
        <>
          <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textFaint, margin: '18px 0 14px' }}>
            {t('adminAnalytics.onboardingFunnelLabel', { defaultValue: 'Step-by-Step Funnel' })}
          </div>
          <Funnel steps={steps} color={TK.accent} />
        </>
      )}
    </Card>
  );
}
