import { useEffect, useState } from 'react';
import { Trophy, RefreshCw, Download } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { subDays } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, FadeIn, FilterBar } from '../../components/admin';

const METRICS = [
  { key: 'volume',      label: 'Total Volume',     scoreLabel: 'lbs' },
  { key: 'workouts',    label: 'Workout Count',    scoreLabel: 'sessions' },
  { key: 'pr_count',    label: 'Personal Records', scoreLabel: 'PRs' },
  { key: 'checkins',    label: 'Check-Ins',        scoreLabel: 'check-ins' },
  { key: 'improved',    label: 'Most Improved',    scoreLabel: '%' },
  { key: 'consistency', label: 'Consistency',       scoreLabel: '%' },
];

const PERIODS = [
  { key: '7',   label: 'This Week' },
  { key: '30',  label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

const TIERS = [
  { key: 'all',          label: 'All Tiers' },
  { key: 'beginner',     label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced',     label: 'Advanced' },
];

const MEDAL = ['🥇', '🥈', '🥉'];

export default function AdminLeaderboard() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const [metric, setMetric] = useState('volume');
  const [period, setPeriod] = useState('30');
  const [tier, setTier]     = useState('all');

  useEffect(() => { document.title = 'Admin - Leaderboard | IronForge'; }, []);

  // Clamp period for boards that don't support all-time
  const effectivePeriod = (['improved', 'consistency'].includes(metric) && period === 'all') ? '30' : period;
  const from = effectivePeriod !== 'all' ? subDays(new Date(), parseInt(effectivePeriod)).toISOString() : null;
  const tierParam = tier === 'all' ? null : tier;
  const periodLabel = effectivePeriod === '7' ? 'weekly' : 'monthly';

  // ── Fetch leaderboard ──
  const { data: entries = [], isLoading, refetch } = useQuery({
    queryKey: [...adminKeys.leaderboard(gymId), metric, effectivePeriod, tier],
    queryFn: async () => {
      if (metric === 'pr_count') {
        const { data } = await supabase.rpc('get_leaderboard_prs', {
          p_gym_id: gymId, p_start_date: from, p_limit: 20, p_tier: tierParam,
        });
        return data || [];
      }
      if (metric === 'checkins') {
        const { data } = await supabase.rpc('get_leaderboard_checkins', {
          p_gym_id: gymId, p_start_date: from, p_tier: tierParam, p_limit: 20,
        });
        return data || [];
      }
      if (metric === 'improved') {
        const { data } = await supabase.rpc('get_leaderboard_most_improved', {
          p_gym_id: gymId, p_metric: 'volume', p_period: periodLabel,
          p_tier: tierParam, p_limit: 20,
        });
        return data || [];
      }
      if (metric === 'consistency') {
        const { data } = await supabase.rpc('get_leaderboard_consistency', {
          p_gym_id: gymId, p_period: periodLabel, p_tier: tierParam, p_limit: 20,
        });
        return data || [];
      }
      const { data } = await supabase.rpc('get_leaderboard_volume', {
        p_gym_id: gymId, p_metric: metric, p_start_date: from, p_limit: 20, p_tier: tierParam,
      });
      return data || [];
    },
    enabled: !!gymId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!gymId) return;
    const channel = supabase.channel('leaderboard-realtime')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'workout_sessions',
        filter: `gym_id=eq.${gymId}`,
      }, () => queryClient.invalidateQueries({ queryKey: adminKeys.leaderboard(gymId) }))
      .subscribe((status, err) => {
        if (err) console.error('Realtime subscription error:', err);
      });
    return () => supabase.removeChannel(channel);
  }, [gymId, queryClient]);

  const currentMetric = METRICS.find(m => m.key === metric);
  const scoreLabel = currentMetric?.scoreLabel ?? 'pts';
  const metricLabel = currentMetric?.label ?? 'Score';

  const formatScore = (e) => {
    if (metric === 'improved') return `+${e.score}%`;
    if (metric === 'consistency') return `${e.score}%`;
    return e.score.toLocaleString();
  };

  const handleExport = () => {
    exportCSV({
      filename: 'leaderboard',
      columns: [
        { key: 'rank', label: 'Rank' },
        { key: 'name', label: 'Name' },
        { key: 'score', label: metricLabel },
        { key: 'tier', label: 'Tier' },
      ],
      data: entries.map((e, i) => ({ ...e, rank: i + 1, tier: e.tier ?? '—' })),
    });
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      <PageHeader
        title="Leaderboard"
        subtitle="Live gym rankings"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
            >
              <Download size={13} />
              Export
            </button>
            <button onClick={() => refetch()} className="p-2 rounded-xl bg-[#0F172A] border border-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
              <RefreshCw size={15} />
            </button>
          </div>
        }
        className="mb-6"
      />

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterBar
          options={METRICS.map(m => ({ key: m.key, label: m.label }))}
          active={metric}
          onChange={setMetric}
        />
        <FilterBar
          options={PERIODS}
          active={effectivePeriod}
          onChange={setPeriod}
        />
        <FilterBar
          options={TIERS}
          active={tier}
          onChange={setTier}
        />
      </div>

      {/* Table */}
      <FadeIn>
        <AdminCard className="overflow-hidden !p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <Trophy size={28} className="text-[#4B5563] mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">No data yet for this period</p>
            </div>
          ) : (
            <div className="divide-y divide-white/4">
              {entries.map((e, i) => (
                <div key={e.id} className={`flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.03] transition-all ${i < 3 ? 'bg-[#D4AF37]/3' : ''}`}>
                  <div className="w-8 text-center">
                    {i < 3 ? (
                      <span className="text-[18px]">{MEDAL[i]}</span>
                    ) : (
                      <span className="text-[13px] font-bold text-[#4B5563]">{i + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] font-semibold truncate ${i === 0 ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                      {e.name}
                    </p>
                    {e.tier && (
                      <span className="text-[10px] text-[#4B5563] capitalize">{e.tier}</span>
                    )}
                  </div>
                  <div className="hidden md:block w-24 flex-shrink-0">
                    <div className="h-1.5 bg-white/6 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${entries[0]?.score ? Math.round((e.score / entries[0].score) * 100) : 0}%`, background: i === 0 ? '#D4AF37' : 'rgba(212,175,55,0.4)' }} />
                    </div>
                  </div>
                  <p className="text-[14px] font-bold text-[#9CA3AF] flex-shrink-0">
                    {formatScore(e)}
                    {!['improved', 'consistency'].includes(metric) && (
                      <span className="text-[11px] font-normal text-[#6B7280] ml-1">{scoreLabel}</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </FadeIn>

      <p className="text-[11px] text-[#4B5563] text-center mt-3">Updates in real time as members log workouts</p>
    </div>
  );
}
