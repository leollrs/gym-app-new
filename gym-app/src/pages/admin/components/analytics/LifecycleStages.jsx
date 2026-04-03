import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import logger from '../../../../lib/logger';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchLifecycleData(gymId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [membersRes, recentSessRes, churnScoresRes, winBacksRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, created_at, is_onboarded, membership_status')
      .eq('gym_id', gymId)
      .eq('role', 'member'),
    supabase
      .from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .gte('started_at', thirtyDaysAgo),
    supabase
      .from('churn_risk_scores')
      .select('profile_id, risk_tier')
      .eq('gym_id', gymId)
      .limit(2000),
    supabase
      .from('win_back_attempts')
      .select('profile_id')
      .eq('gym_id', gymId)
      .eq('outcome', 'returned')
      .limit(1000),
  ]);

  if (membersRes.error) throw membersRes.error;
  if (recentSessRes.error) logger.error('LifecycleStages: failed to load sessions:', recentSessRes.error);
  if (churnScoresRes.error) logger.error('LifecycleStages: failed to load churn scores:', churnScoresRes.error);
  if (winBacksRes.error) logger.error('LifecycleStages: failed to load win-backs:', winBacksRes.error);

  const members = membersRes.data;
  const recentSessions = recentSessRes.data;
  const churnScores = churnScoresRes.data;
  const winBacks = winBacksRes.data;

  // Build session count per member (last 30 days)
  const sessionCountMap = {};
  (recentSessions || []).forEach(s => {
    sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1;
  });

  // Build latest churn score per member
  const churnMap = {};
  (churnScores || []).forEach(s => {
    churnMap[s.profile_id] = s.risk_tier;
  });

  // Build win-back set
  const wonBackSet = new Set((winBacks || []).map(w => w.profile_id));

  // Need all-time sessions for "total < 3" check
  const { data: allSessions, error: allSessError } = await supabase
    .from('workout_sessions')
    .select('profile_id')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .limit(5000);
  if (allSessError) logger.error('LifecycleStages: failed to load all sessions:', allSessError);

  const totalSessionMap = {};
  (allSessions || []).forEach(s => {
    totalSessionMap[s.profile_id] = (totalSessionMap[s.profile_id] || 0) + 1;
  });

  const counts = { new: 0, onboarding: 0, active: 0, atRisk: 0, churned: 0, wonBack: 0 };

  (members || []).forEach(m => {
    const status = m.membership_status;
    const recentCount = sessionCountMap[m.id] || 0;
    const totalCount = totalSessionMap[m.id] || 0;
    const riskTier = churnMap[m.id];
    const joinedRecently = m.created_at >= fourteenDaysAgo;

    if (status === 'cancelled' || status === 'frozen') {
      counts.churned++;
    } else if (wonBackSet.has(m.id)) {
      counts.wonBack++;
    } else if (riskTier && ['critical', 'high', 'medium'].includes(riskTier)) {
      counts.atRisk++;
    } else if (recentCount >= 3) {
      counts.active++;
    } else if (m.is_onboarded && totalCount < 3) {
      counts.onboarding++;
    } else if (!m.is_onboarded || (joinedRecently && totalCount === 0)) {
      counts.new++;
    } else {
      counts.active++;
    }
  });

  const total = (members || []).length;
  return [
    { key: 'new',        labelKey: 'lifecycleNew',        color: '#7B9EFF', count: counts.new },
    { key: 'onboarding', labelKey: 'lifecycleOnboarding', color: '#9B8AFB', count: counts.onboarding },
    { key: 'active',     labelKey: 'lifecycleActive',     color: '#34D399', count: counts.active },
    { key: 'atRisk',     labelKey: 'lifecycleAtRisk',     color: '#FBBF24', count: counts.atRisk },
    { key: 'churned',    labelKey: 'lifecycleChurned',    color: '#F87171', count: counts.churned },
    { key: 'wonBack',    labelKey: 'lifecycleWonBack',    color: '#C9A84C', count: counts.wonBack },
  ].map(s => ({
    ...s,
    pct: total > 0 ? Math.round((s.count / total) * 100) : 0,
  }));
}

export default function LifecycleStages({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: stages = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.lifecycle(gymId),
    queryFn: () => fetchLifecycleData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton h="h-[140px]" />;
  if (isError) return <ErrorCard message={t('admin.analytics.lifecycleError', 'Failed to load lifecycle data')} onRetry={refetch} />;
  if (stages.length === 0) return null;

  // Headline: largest segment
  const totalMembers = stages.reduce((sum, s) => sum + s.count, 0);
  const activeStage = stages.find(s => s.key === 'active');
  const activePct = activeStage ? activeStage.pct : 0;

  return (
    <AdminCard hover className="h-full hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight">{t('admin.analytics.lifecycleTitle', 'Member Lifecycle')}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{t('admin.analytics.lifecycleSubtitle', 'Where your members are right now')}</p>
        </div>
        <div className="text-right">
          <p className="text-[22px] font-bold text-[#34D399] leading-none tracking-tight">{activePct}%</p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{t('admin.analytics.lifecycleActiveLabel', { count: totalMembers, defaultValue: 'active of {{count}}' })}</p>
        </div>
      </div>

      {/* Stacked segment bar */}
      <div className="flex gap-[3px] h-8 rounded-xl overflow-hidden my-5">
        {stages.map(s => (
          <div
            key={s.key}
            className="relative group transition-all duration-300 hover:opacity-90"
            style={{ flex: s.count, background: s.color, minWidth: s.count > 0 ? 3 : 0, opacity: 0.85 }}
          >
            <div className="opacity-0 group-hover:opacity-100 absolute -top-10 left-1/2 -translate-x-1/2 bg-[var(--color-bg-card)] border border-[var(--color-border-subtle,rgba(255,255,255,0.08))] rounded-xl px-3 py-1.5 text-[11px] text-[var(--color-text-primary)] whitespace-nowrap z-10 pointer-events-none transition-opacity shadow-xl shadow-black/40 backdrop-blur-sm">
              {t(`admin.analytics.${s.labelKey}`, s.labelKey)}: {s.count} ({s.pct}%)
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
        {stages.map(s => (
          <div key={s.key} className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[11px] text-[var(--color-text-muted)] truncate">{t(`admin.analytics.${s.labelKey}`, s.labelKey)}</span>
            <span className="text-[12px] font-semibold text-[var(--color-text-primary)] flex-shrink-0 ml-auto tabular-nums">{s.count}</span>
            <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0 opacity-60">({s.pct}%)</span>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}
