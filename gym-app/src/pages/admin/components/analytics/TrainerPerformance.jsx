import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import logger from '../../../../lib/logger';
import { selectAllRows } from '../../../../lib/churn/batchedSelect';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Card } from './analyticsKit';

async function fetchTrainerData(gymId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Not paged on purpose: a gym has tens of trainers, never the 1000 it would
  // take to hit PostgREST's max_rows, and adding an .order() here would change
  // the tie-break order of the rendered list (the sort below is stable, so the
  // arrival order decides ties between trainers with equal client counts).
  const { data: trainerRows, error: trainerError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('gym_id', gymId)
    .eq('role', 'trainer');
  if (trainerError) throw trainerError;
  if (!trainerRows || trainerRows.length === 0) return [];

  // Paged: PostgREST is configured with `max_rows = 1000` (verified live:
  // `content-range: 0-999/1275`) and this read had no cap of its own, so a gym
  // whose assignment history crosses 1000 rows lost trainers off the end of the
  // list entirely and under-counted the ones that survived. `id` is the PK, so
  // ordering by it alone is a total order — OFFSET paging can't skip or dupe.
  const { data: tcRows, error: tcError } = await selectAllRows((lo, hi) => supabase
    .from('trainer_clients')
    .select('trainer_id, client_id, is_active')
    .eq('gym_id', gymId)
    .order('id', { ascending: true })
    .range(lo, hi));
  if (tcError) logger.error('TrainerPerformance: failed to load trainer-client rows:', tcError);

  // 30 days of completed sessions is ~1,800 rows at 300 members, so the un-paged
  // read returned the first 1000 (~55%) — and with no .order() those 1000 were
  // an arbitrary slice. Both numbers this card shows were computed from roughly
  // half the gym's workouts: clients who DID train but whose sessions fell past
  // the cut counted as inactive, dragging every trainer's "retention" down and
  // the "wk/client" figure with it. Order (started_at, id) for stable paging.
  const { data: recentSessions, error: recSessError } = await selectAllRows((lo, hi) => supabase
    .from('workout_sessions')
    .select('profile_id')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', thirtyDaysAgo)
    .order('started_at', { ascending: true })
    .order('id', { ascending: true })
    .range(lo, hi));
  if (recSessError) logger.error('TrainerPerformance: failed to load recent sessions:', recSessError);

  // ONE pass for sessions-per-member. The separate `activeMembers` Set was a
  // second full walk of the same array to answer a question this map already
  // answers — "has a positive count" IS "trained in the last 30 days".
  const sessionCountMap = new Map();
  for (const s of (recentSessions || [])) {
    sessionCountMap.set(s.profile_id, (sessionCountMap.get(s.profile_id) || 0) + 1);
  }

  // THE coupling trap, de-looped. `trainerRows.map(tr => tcRows.filter(tc =>
  // tc.trainer_id === tr.id))` re-scanned EVERY assignment row for EVERY
  // trainer — O(trainers x assignments) — and then filtered/re-walked that slice
  // three more times per trainer. Paging removes the 1000-row ceiling that was
  // accidentally holding `tcRows` down, so that product would have grown with
  // the gym. Bucketing by trainer_id first makes it O(trainers + assignments)
  // with O(1) lookups. Only `is_active` rows are ever used downstream, so the
  // inactive ones are dropped here once instead of per trainer.
  const activeClientsByTrainer = new Map();
  for (const tc of (tcRows || [])) {
    if (!tc.is_active) continue;
    const bucket = activeClientsByTrainer.get(tc.trainer_id);
    if (bucket) bucket.push(tc.client_id);
    else activeClientsByTrainer.set(tc.trainer_id, [tc.client_id]);
  }

  const trainerStats = trainerRows.map(tr => {
    const clientIds = activeClientsByTrainer.get(tr.id) || [];
    const clientCount = clientIds.length;
    // One walk of this trainer's clients yields both aggregates; the old code
    // took three (a .filter for the count, a .filter for retention, a .reduce
    // for sessions).
    let clientsWithWorkout = 0;
    let totalClientSessions = 0;
    for (const clientId of clientIds) {
      const n = sessionCountMap.get(clientId) || 0;
      if (n > 0) clientsWithWorkout++;
      totalClientSessions += n;
    }
    const retention = clientCount > 0 ? Math.round((clientsWithWorkout / clientCount) * 100) : 0;
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
