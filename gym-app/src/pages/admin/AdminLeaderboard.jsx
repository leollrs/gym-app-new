import { useEffect, useState } from 'react';
import { Trophy, BarChart3, RefreshCw, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { subDays } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';

const METRICS = [
  { key: 'volume',    label: 'Total Volume',     desc: 'lbs lifted' },
  { key: 'workouts',  label: 'Workout Count',    desc: 'sessions completed' },
  { key: 'pr_count',  label: 'Personal Records', desc: 'PRs set' },
];

const PERIODS = [
  { key: '7',   label: 'This Week' },
  { key: '30',  label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

const MEDAL = ['🥇', '🥈', '🥉'];

export default function AdminLeaderboard() {
  const { profile } = useAuth();
  const [metric, setMetric]   = useState('volume');
  const [period, setPeriod]   = useState('30');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!profile?.gym_id) return;
    setLoading(true);
    const gymId = profile.gym_id;
    const from = period !== 'all' ? subDays(new Date(), parseInt(period)).toISOString() : null;

    if (metric === 'pr_count') {
      let q = supabase
        .from('pr_history')
        .select('profile_id, profiles(full_name)')
        .eq('gym_id', gymId);
      if (from) q = q.gte('achieved_at', from);
      const { data } = await q;

      const agg = {};
      (data || []).forEach(r => {
        if (!agg[r.profile_id]) agg[r.profile_id] = { name: r.profiles?.full_name ?? '—', score: 0 };
        agg[r.profile_id].score++;
      });
      setEntries(Object.entries(agg).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score).slice(0, 20));
    } else {
      let q = supabase
        .from('workout_sessions')
        .select('profile_id, total_volume_lbs, profiles(full_name)')
        .eq('gym_id', gymId)
        .eq('status', 'completed');
      if (from) q = q.gte('started_at', from);
      const { data } = await q;

      const agg = {};
      (data || []).forEach(s => {
        if (!agg[s.profile_id]) agg[s.profile_id] = { name: s.profiles?.full_name ?? '—', volume: 0, count: 0 };
        agg[s.profile_id].volume += parseFloat(s.total_volume_lbs || 0);
        agg[s.profile_id].count++;
      });
      const list = Object.entries(agg)
        .map(([id, v]) => ({ id, name: v.name, score: metric === 'volume' ? Math.round(v.volume) : v.count }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      setEntries(list);
    }

    setLoading(false);
  };

  useEffect(() => { load(); }, [profile?.gym_id, metric, period]);

  // Realtime subscription
  useEffect(() => {
    if (!profile?.gym_id) return;
    const channel = supabase.channel('leaderboard-realtime')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'workout_sessions',
        filter: `gym_id=eq.${profile.gym_id}`,
      }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.gym_id, metric, period]);

  const scoreLabel = metric === 'volume' ? 'lbs' : metric === 'workouts' ? 'sessions' : 'PRs';
  const metricLabel = METRICS.find(m => m.key === metric)?.label ?? 'Score';

  const handleExport = () => {
    exportCSV({
      filename: 'leaderboard',
      columns: [
        { key: 'rank', label: 'Rank' },
        { key: 'name', label: 'Name' },
        { key: 'score', label: metricLabel },
      ],
      data: entries.map((e, i) => ({ ...e, rank: i + 1 })),
    });
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Leaderboard</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Live gym rankings</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
          >
            <Download size={13} />
            Export
          </button>
          <button onClick={load} className="p-2 rounded-xl bg-[#0F172A] border border-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex gap-1.5 flex-wrap">
          {METRICS.map(m => (
            <button key={m.key} onClick={() => setMetric(m.key)}
              className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                metric === m.key ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF]'
              }`}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                period === p.key ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF]'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
        {loading ? (
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
              <div key={e.id} className={`flex items-center gap-4 px-5 py-3.5 ${i < 3 ? 'bg-[#D4AF37]/3' : ''}`}>
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
                </div>
                <p className="text-[14px] font-bold text-[#9CA3AF] flex-shrink-0">
                  {e.score.toLocaleString()}
                  <span className="text-[11px] font-normal text-[#6B7280] ml-1">{scoreLabel}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-[#4B5563] text-center mt-3">Updates in real time as members log workouts</p>
    </div>
  );
}
