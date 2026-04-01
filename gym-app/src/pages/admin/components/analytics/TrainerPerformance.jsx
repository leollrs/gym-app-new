import { useQuery } from '@tanstack/react-query';
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
  const { data: trainers = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.trainers(gymId),
    queryFn: () => fetchTrainerData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton h="h-[200px]" />;
  if (isError) return <ErrorCard message="Failed to load trainer data" onRetry={refetch} />;
  if (trainers.length === 0) return null;

  return (
    <AdminCard hover className="mt-4 hover:border-white/10 transition-colors duration-300">
      <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">Trainer Performance</p>
      <p className="text-[11px] text-[#6B7280] mb-4">Client retention and engagement by trainer</p>

      <div className="divide-y divide-white/4">
        {trainers.map(t => (
          <div key={t.id} className="flex items-center gap-4 py-3">
            <div className="w-9 h-9 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
              <span className="text-[12px] font-bold text-[#D4AF37]">{t.name[0]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{t.name}</p>
              <p className="text-[11px] text-[#6B7280]">{t.clientCount} active client{t.clientCount !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex gap-4 text-right flex-shrink-0">
              <div>
                <p className="text-[13px] font-semibold text-[#E5E7EB]">{t.retention}%</p>
                <p className="text-[10px] text-[#6B7280]">retention</p>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[#E5E7EB]">{t.avgWorkouts}</p>
                <p className="text-[10px] text-[#6B7280]">wk/client</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}
