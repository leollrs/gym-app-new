import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { subMonths } from 'date-fns';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchChallengeData(gymId) {
  const now = new Date();
  const from = subMonths(now, 6).toISOString();

  const { data: allMembers, error: chalMemError } = await supabase
    .from('profiles')
    .select('id')
    .eq('gym_id', gymId)
    .eq('role', 'member');
  if (chalMemError) throw chalMemError;
  const totalMembers = (allMembers || []).length;

  const { data: challenges, error: chalError } = await supabase
    .from('challenges')
    .select('id, name, starts_at')
    .eq('gym_id', gymId)
    .gte('starts_at', from)
    .order('starts_at', { ascending: false })
    .limit(8);
  if (chalError) throw chalError;

  if (!challenges || challenges.length === 0) return [];

  const { data: participants, error: partError } = await supabase
    .from('challenge_participants')
    .select('challenge_id, user_id')
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
  const { data: challengeData = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.challenges(gymId),
    queryFn: () => fetchChallengeData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton />;
  if (isError) return <ErrorCard message="Failed to load challenge data" onRetry={refetch} />;

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <p className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-4 truncate">Challenge Participation</p>
      {challengeData.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <p className="text-[13px] text-[var(--color-text-muted)]">No challenges in the last 6 months</p>
          <p className="text-[10px] text-[var(--color-text-subtle)] mt-1">Create a challenge to see data here</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
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
                      <p className="font-semibold text-[#D4AF37]">{d.pct}% ({d.count} members)</p>
                    </div>
                  );
                }}
                cursor={{ fill: 'var(--color-accent-glow)' }}
              />
              <Bar dataKey="pct" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-[var(--color-text-subtle)] mt-2">% of total members who joined each challenge</p>
        </>
      )}
    </AdminCard>
  );
}
