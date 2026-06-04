import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { selectAllRows } from '../../../../lib/churn/batchedSelect.js';
import { subMonths } from 'date-fns';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Card, BarChart } from './analyticsKit';

const FILTERS = ['all', 'active', 'past'];

async function fetchChallengeData(gymId, filter) {
  const now = new Date();
  const from = subMonths(now, 6).toISOString();

  const { data: allMembers, error: chalMemError } = await selectAllRows((rangeFrom, rangeTo) =>
    supabase
      .from('profiles')
      .select('id')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .eq('imported_archived', false)
      .order('id')
      .range(rangeFrom, rangeTo)
  );
  if (chalMemError) throw chalMemError;
  const totalMembers = (allMembers || []).length;

  let query = supabase
    .from('challenges')
    .select('id, name, start_date, end_date')
    .eq('gym_id', gymId);

  if (filter === 'active') {
    query = query.or(`end_date.is.null,end_date.gte.${now.toISOString()}`);
  } else if (filter === 'past') {
    query = query.lt('end_date', now.toISOString());
  } else {
    query = query.gte('start_date', from);
  }
  query = query.order('start_date', { ascending: false }).limit(8);

  const { data: challenges, error: chalError } = await query;
  if (chalError) throw chalError;
  if (!challenges || challenges.length === 0) return [];

  const { data: participants, error: partError } = await supabase
    .from('challenge_participants')
    .select('challenge_id, profile_id')
    .in('challenge_id', challenges.map(c => c.id));
  if (partError) throw partError;

  const countMap = {};
  (participants || []).forEach(p => { countMap[p.challenge_id] = (countMap[p.challenge_id] || 0) + 1; });

  const data = challenges.map(c => ({
    name: c.name.length > 18 ? c.name.slice(0, 16) + '…' : c.name,
    fullName: c.name,
    count: countMap[c.id] || 0,
    pct: totalMembers > 0 ? Math.round(((countMap[c.id] || 0) / totalMembers) * 100) : 0,
  }));

  return data.reverse();
}

export default function ChallengeStats({ gymId }) {
  const { t } = useTranslation('pages');
  const [filter, setFilter] = useState('all');

  const { data: challengeData = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...adminKeys.analytics.challenges(gymId), filter],
    queryFn: () => fetchChallengeData(gymId, filter),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton />;
  if (isError) return <ErrorCard message={t('admin.analytics.challengeError', 'Failed to load challenge data')} onRetry={refetch} />;

  const filterLabels = {
    all: t('admin.analytics.filterAll', 'All'),
    active: t('admin.analytics.filterActive', 'Active'),
    past: t('admin.analytics.filterPast', 'Past'),
  };

  const avgPct = challengeData.length > 0 ? Math.round(challengeData.reduce((sum, d) => sum + d.pct, 0) / challengeData.length) : 0;
  const totalParticipants = challengeData.reduce((sum, d) => sum + d.count, 0);
  const bars = challengeData.map(d => ({ label: d.name, value: d.pct, label2: `${d.pct}%` }));

  return (
    <Card style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', minHeight: 360 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.analytics.challengeTitle', 'Challenge Participation')}</div>
        <div style={{ display: 'inline-flex', gap: 4, background: TK.surface3, padding: 4, borderRadius: 999, border: `1px solid ${TK.borderSolid}` }}>
          {FILTERS.map(f => {
            const on = filter === f;
            return (
              <button key={f} type="button" onClick={() => setFilter(f)}
                style={{ padding: '6px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: FK.body, fontSize: 12, fontWeight: on ? 700 : 600, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : 'transparent' }}>
                {filterLabels[f]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, color: TK.accent }}>{avgPct}%</span>
        <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute }}>{t('admin.analytics.challengeAvg', { count: totalParticipants, defaultValue: 'avg participation — {{count}} total joins' })}</span>
      </div>

      {challengeData.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 0' }}>
          <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: 0 }}>{t('admin.analytics.challengeEmpty', 'No challenges in the last 6 months')}</p>
          <p style={{ fontFamily: FK.body, fontSize: 11, color: TK.textFaint, marginTop: 4 }}>{t('admin.analytics.challengeEmptyHint', 'Create a challenge to see data here')}</p>
        </div>
      ) : (
        <>
          <BarChart data={bars} height={250} color={TK.accent} />
          <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textFaint, marginTop: 10 }}>{t('admin.analytics.challengeFooter', '% of total members who joined each challenge')}</p>
        </>
      )}
    </Card>
  );
}
