import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import logger from '../../../../lib/logger';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchTrainerData(gymId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: trainerRows, error: trainerError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('gym_id', gymId)
    .eq('role', 'trainer');
  if (trainerError) throw trainerError;

  if (!trainerRows || trainerRows.length === 0) return [];

  const { data: tcRows, error: tcError } = await supabase
    .from('trainer_clients')
    .select('trainer_id, client_id, is_active')
    .eq('gym_id', gymId);
  if (tcError) logger.error('TrainerPerformance: failed to load trainer-client rows:', tcError);

  const { data: recentSessions, error: recSessError } = await supabase
    .from('workout_sessions')
    .select('profile_id')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', thirtyDaysAgo);
  if (recSessError) logger.error('TrainerPerformance: failed to load recent sessions:', recSessError);

  const activeMembers = new Set((recentSessions || []).map(s => s.profile_id));

  const sessionCountMap = {};
  (recentSessions || []).forEach(s => {
    sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1;
  });

  const trainerStats = trainerRows.map(t => {
    const clients = (tcRows || []).filter(tc => tc.trainer_id === t.id);
    const activeClients = clients.filter(tc => tc.is_active);
    const clientCount = activeClients.length;

    const clientsWithWorkout = activeClients.filter(tc => activeMembers.has(tc.client_id)).length;
    const retention = clientCount > 0 ? Math.round((clientsWithWorkout / clientCount) * 100) : 0;

    const totalClientSessions = activeClients.reduce((sum, tc) => sum + (sessionCountMap[tc.client_id] || 0), 0);
    const avgWorkouts = clientCount > 0 ? (totalClientSessions / clientCount / 4.33).toFixed(1) : '0.0';

    return {
      id: t.id,
      name: t.full_name || 'Unnamed',
      clientCount,
      retention,
      avgWorkouts,
    };
  });

  trainerStats.sort((a, b) => b.clientCount - a.clientCount);
  return trainerStats;
}

export default function TrainerPerformance({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: trainers = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.trainers(gymId),
    queryFn: () => fetchTrainerData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton h="h-[200px]" />;
  if (isError) return <ErrorCard message={t('admin.analytics.trainerError', 'Failed to load trainer data')} onRetry={refetch} />;
  if (trainers.length === 0) return null;

  // Headline: average retention across trainers
  const avgRetention = trainers.length > 0
    ? Math.round(trainers.reduce((sum, tr) => sum + tr.retention, 0) / trainers.length)
    : 0;
  const totalClients = trainers.reduce((sum, tr) => sum + tr.clientCount, 0);

  return (
    <AdminCard hover className="mt-4 hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight">{t('admin.analytics.trainerTitle', 'Trainer Performance')}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{t('admin.analytics.trainerSubtitle', 'Client retention and engagement by trainer')}</p>
        </div>
        <div className="text-right">
          <p className="text-[22px] font-bold text-[var(--color-accent)] leading-none tracking-tight">{avgRetention}%</p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{t('admin.analytics.trainerAvgRetention', { count: totalClients, defaultValue: 'avg retention, {{count}} clients' })}</p>
        </div>
      </div>

      <div className="divide-y divide-white/[0.04] mt-4">
        {trainers.map((tr, idx) => (
          <div key={tr.id} className="flex items-center gap-4 py-3.5 first:pt-0">
            <div className="w-9 h-9 rounded-full bg-[var(--color-accent)]/12 flex items-center justify-center flex-shrink-0">
              <span className="text-[12px] font-bold text-[var(--color-accent)]">{tr.name[0]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{tr.name}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">{t('admin.analytics.trainerActiveClients', { count: tr.clientCount, defaultValue: '{{count}} active clients' })}</p>
            </div>
            <div className="flex gap-5 text-right flex-shrink-0">
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-text-primary)] tabular-nums">{tr.retention}%</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{t('admin.analytics.trainerRetention', 'retention')}</p>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-text-primary)] tabular-nums">{tr.avgWorkouts}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{t('admin.analytics.trainerWkPerClient', 'wk/client')}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}
