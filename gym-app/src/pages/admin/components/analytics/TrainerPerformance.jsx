import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import logger from '../../../../lib/logger';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Card } from './analyticsKit';

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
  (recentSessions || []).forEach(s => { sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1; });

  const trainerStats = trainerRows.map(tr => {
    const clients = (tcRows || []).filter(tc => tc.trainer_id === tr.id);
    const activeClients = clients.filter(tc => tc.is_active);
    const clientCount = activeClients.length;
    const clientsWithWorkout = activeClients.filter(tc => activeMembers.has(tc.client_id)).length;
    const retention = clientCount > 0 ? Math.round((clientsWithWorkout / clientCount) * 100) : 0;
    const totalClientSessions = activeClients.reduce((sum, tc) => sum + (sessionCountMap[tc.client_id] || 0), 0);
    const avgWorkouts = clientCount > 0 ? (totalClientSessions / clientCount / 4.33).toFixed(1) : '0.0';
    return { id: tr.id, name: tr.full_name || '', clientCount, retention, avgWorkouts };
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

  const avgRetention = trainers.length > 0 ? Math.round(trainers.reduce((sum, tr) => sum + tr.retention, 0) / trainers.length) : 0;
  const totalClients = trainers.reduce((sum, tr) => sum + tr.clientCount, 0);

  return (
    <Card style={{ padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.analytics.trainerTitle', 'Trainer Performance')}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 4 }}>{t('admin.analytics.trainerSubtitle', 'Client retention and engagement by trainer')}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 24, fontWeight: 800, color: TK.accent, letterSpacing: -0.8 }}>{avgRetention}%</div>
          <div style={{ fontFamily: FK.body, fontSize: 12, color: TK.textMute }}>{t('admin.analytics.trainerAvgRetention', { count: totalClients, defaultValue: 'avg retention, {{count}} clients' })}</div>
        </div>
      </div>

      {trainers.map((tr) => (
        <div key={tr.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 0', borderTop: `1px solid ${TK.divider}` }}>
          <span style={{ width: 34, height: 34, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.accentSoft, color: TK.accent, fontFamily: FK.display, fontSize: 14, fontWeight: 800 }}>{(tr.name || '?')[0].toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr.name || t('admin.analytics.trainerUnnamed', 'Unnamed trainer')}</div>
            <div style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute }}>{t('admin.analytics.trainerActiveClients', { count: tr.clientCount, defaultValue: '{{count}} active clients' })}</div>
          </div>
          <div style={{ textAlign: 'right', width: 90 }}>
            <div style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: tr.retention === 100 ? 'var(--color-success)' : TK.text }}>{tr.retention}%</div>
            <div style={{ fontFamily: FK.body, fontSize: 11, color: TK.textFaint }}>{t('admin.analytics.trainerRetention', 'retention')}</div>
          </div>
          <div style={{ textAlign: 'right', width: 80 }}>
            <div style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text }}>{tr.avgWorkouts}</div>
            <div style={{ fontFamily: FK.body, fontSize: 11, color: TK.textFaint }}>{t('admin.analytics.trainerWkPerClient', 'wk/client')}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}
