import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { subMonths } from 'date-fns';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

const FILTERS = ['all', 'active', 'past'];

async function fetchChallengeData(gymId, filter) {
  const now = new Date();
  const from = subMonths(now, 6).toISOString();

  const { data: allMembers, error: chalMemError } = await supabase
    .from('profiles')
    .select('id')
    .eq('gym_id', gymId)
    .eq('role', 'member');
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
    // "all" — last 6 months
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
  (participants || []).forEach(p => {
    countMap[p.challenge_id] = (countMap[p.challenge_id] || 0) + 1;
  });

  const data = challenges.map(c => ({
    name:     c.name.length > 18 ? c.name.slice(0, 16) + '\u2026' : c.name,
    fullName: c.name,
    count:    countMap[c.id] || 0,
    pct:      totalMembers > 0 ? Math.round(((countMap[c.id] || 0) / totalMembers) * 100) : 0,
  }));

  return data.reverse(); // chronological
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
    all:    t('admin.analytics.filterAll', 'All'),
    active: t('admin.analytics.filterActive', 'Active'),
    past:   t('admin.analytics.filterPast', 'Past'),
  };

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300 min-h-[320px] flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-4 shrink-0">
        <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">{t('admin.analytics.challengeTitle', 'Challenge Participation')}</p>
        <div className="flex gap-1 shrink-0">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                filter === f
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-white/6 text-[var(--color-text-muted)] hover:bg-white/10'
              }`}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
      </div>
      {challengeData.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <p className="text-[13px] text-[var(--color-text-muted)]">{t('admin.analytics.challengeEmpty', 'No challenges in the last 6 months')}</p>
          <p className="text-[10px] text-[var(--color-text-subtle)] mt-1">{t('admin.analytics.challengeEmptyHint', 'Create a challenge to see data here')}</p>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={challengeData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={v => `${v}%`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-[var(--color-bg-card)] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
                        <p className="text-[var(--color-text-muted)] text-[11px] mb-1">{d.fullName}</p>
                        <p className="font-semibold text-[#D4AF37]">{d.pct}% ({t('admin.analytics.challengeTooltipMembers', { count: d.count, defaultValue: '{{count}} members' })})</p>
                      </div>
                    );
                  }}
                  cursor={{ fill: 'var(--color-accent-glow)' }}
                />
                <Bar dataKey="pct" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-[var(--color-text-subtle)] mt-2 shrink-0">{t('admin.analytics.challengeFooter', '% of total members who joined each challenge')}</p>
        </>
      )}
    </AdminCard>
  );
}
