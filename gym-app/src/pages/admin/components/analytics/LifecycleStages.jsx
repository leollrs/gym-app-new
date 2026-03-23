import { useQuery } from '@tanstack/react-query';
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
    { key: 'new',        label: 'New',        color: '#60A5FA', count: counts.new },
    { key: 'onboarding', label: 'Onboarding', color: '#818CF8', count: counts.onboarding },
    { key: 'active',     label: 'Active',     color: '#10B981', count: counts.active },
    { key: 'atRisk',     label: 'At Risk',    color: '#F59E0B', count: counts.atRisk },
    { key: 'churned',    label: 'Churned',    color: '#EF4444', count: counts.churned },
    { key: 'wonBack',    label: 'Won Back',   color: '#D4AF37', count: counts.wonBack },
  ].map(s => ({
    ...s,
    pct: total > 0 ? Math.round((s.count / total) * 100) : 0,
  }));
}

export default function LifecycleStages({ gymId }) {
  const { data: stages = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.lifecycle(gymId),
    queryFn: () => fetchLifecycleData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton h="h-[140px]" />;
  if (isError) return <ErrorCard message="Failed to load lifecycle data" onRetry={refetch} />;
  if (stages.length === 0) return null;

  return (
    <AdminCard hover className="mb-6 hover:border-white/10 transition-colors duration-300">
      <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">Member Lifecycle</p>
      <p className="text-[11px] text-[#6B7280] mb-4">Where your members are right now</p>

      <div className="flex gap-1 h-10 rounded-xl overflow-hidden mb-4">
        {stages.map(s => (
          <div key={s.key} className="relative group" style={{ flex: s.count, background: s.color, minWidth: s.count > 0 ? 2 : 0 }}>
            <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1 text-[11px] text-white whitespace-nowrap z-10 pointer-events-none transition-opacity">
              {s.label}: {s.count} ({s.pct}%)
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {stages.map(s => (
          <div key={s.key} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-[12px] text-[#9CA3AF]">{s.label}</span>
            <span className="text-[12px] font-semibold text-[#E5E7EB]">{s.count}</span>
            <span className="text-[11px] text-[#6B7280]">({s.pct}%)</span>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}
