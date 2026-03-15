import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, BarChart2, Flame, Dumbbell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Time range helpers ──────────────────────────────────────
const getStartDate = (range) => {
  const now = new Date();
  if (range === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (range === 'monthly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  return null; // all-time
};

const METRIC_TABS = [
  { key: 'volume',   label: 'Volume',   icon: BarChart2, unit: 'lbs' },
  { key: 'workouts', label: 'Workouts', icon: Dumbbell,  unit: 'sessions' },
  { key: 'streak',   label: 'Streak',   icon: Flame,     unit: 'days' },
];

const TIME_TABS = [
  { key: 'weekly',  label: 'This Week' },
  { key: 'monthly', label: 'This Month' },
  { key: 'alltime', label: 'All Time' },
];

const MEDAL_COLORS = ['#D4AF37', '#9CA3AF', '#92400E'];

// ── Main page ──────────────────────────────────────────────
const Leaderboard = () => {
  const { profile, user } = useAuth();
  const [metric, setMetric]     = useState('volume');
  const [timeRange, setTimeRange] = useState('weekly');
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);

  const loadLeaderboard = useCallback(async () => {
    if (!profile?.gym_id) return;
    setLoading(true);

    const startDate = getStartDate(timeRange);

    if (metric === 'streak') {
      // For streak, fetch all completed sessions and compute per-user streaks
      const query = supabase
        .from('workout_sessions')
        .select('profile_id, completed_at, profiles!profile_id(full_name, username, avatar_url)')
        .eq('gym_id', profile.gym_id)
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false });

      const { data, error } = await query;
      if (error) { console.error('Leaderboard: failed to load streak data:', error); }

      // Group by profile and compute current streak (consecutive days)
      const byUser = {};
      (data || []).forEach(s => {
        if (!byUser[s.profile_id]) {
          byUser[s.profile_id] = {
            id: s.profile_id,
            name: s.profiles?.full_name || s.profiles?.username || 'Unknown',
            avatar: s.profiles?.avatar_url,
            dates: new Set(),
          };
        }
        if (s.completed_at) {
          byUser[s.profile_id].dates.add(new Date(s.completed_at).toDateString());
        }
      });

      const list = Object.values(byUser).map(u => {
        // Count consecutive days ending today or yesterday
        const sorted = [...u.dates].map(d => new Date(d)).sort((a, b) => b - a);
        let streak = 0;
        if (sorted.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const mostRecent = new Date(sorted[0]);
          mostRecent.setHours(0, 0, 0, 0);
          const diffFromToday = Math.floor((today - mostRecent) / 86400000);
          if (diffFromToday > 1) {
            streak = 0;
          } else {
            streak = 1;
            for (let i = 1; i < sorted.length; i++) {
              const prev = new Date(sorted[i - 1]);
              prev.setHours(0, 0, 0, 0);
              const curr = new Date(sorted[i]);
              curr.setHours(0, 0, 0, 0);
              const gap = Math.floor((prev - curr) / 86400000);
              if (gap === 1) streak++;
              else break;
            }
          }
        }
        return { id: u.id, name: u.name, avatar: u.avatar, score: streak };
      })
        .filter(u => u.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      setEntries(list);
    } else {
      // Volume or workout count
      let query = supabase
        .from('workout_sessions')
        .select('profile_id, total_volume_lbs, profiles!profile_id(full_name, username, avatar_url)')
        .eq('gym_id', profile.gym_id)
        .eq('status', 'completed');

      if (startDate) {
        query = query.gte('started_at', startDate);
      }

      const { data, error: volError } = await query;
      if (volError) { console.error('Leaderboard: failed to load leaderboard data:', volError); }

      const agg = {};
      (data || []).forEach(s => {
        if (!agg[s.profile_id]) {
          agg[s.profile_id] = {
            id: s.profile_id,
            name: s.profiles?.full_name || s.profiles?.username || 'Unknown',
            avatar: s.profiles?.avatar_url,
            volume: 0,
            count: 0,
          };
        }
        agg[s.profile_id].count++;
        agg[s.profile_id].volume += parseFloat(s.total_volume_lbs || 0);
      });

      const list = Object.values(agg)
        .map(u => ({
          id: u.id,
          name: u.name,
          avatar: u.avatar,
          score: metric === 'volume' ? Math.round(u.volume) : u.count,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      setEntries(list);
    }

    setLoading(false);
  }, [profile?.gym_id, metric, timeRange]);

  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);

  const currentMetric = METRIC_TABS.find(m => m.key === metric);
  const unit = currentMetric?.unit ?? '';

  return (
    <div className="mx-auto w-full max-w-[700px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Trophy size={22} className="text-[#D4AF37]" />
          <h1 className="text-[24px] font-bold text-[#E5E7EB]">Leaderboard</h1>
        </div>
        <p className="text-[13px] text-[#6B7280] mt-1">See who's putting in the work</p>
      </header>

      {/* Metric toggle */}
      <div className="flex gap-1 bg-[#111827] p-1 rounded-xl mb-4">
        {METRIC_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setMetric(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                metric === tab.key
                  ? 'bg-[#D4AF37] text-black'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Time range tabs */}
      <div className="flex border-b border-white/8 mb-6">
        {TIME_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setTimeRange(tab.key)}
            className={`flex-1 py-3 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${
              timeRange === tab.key
                ? 'text-[#D4AF37] border-[#D4AF37]'
                : 'text-[#6B7280] border-transparent hover:text-[#9CA3AF]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-2.5">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[60px] animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20">
          <Trophy size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No activity yet for this period</p>
          <p className="text-[12px] text-[#4B5563] mt-1">Complete workouts to appear on the leaderboard</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry, i) => {
            const rank = i + 1;
            const isMe = entry.id === user?.id;
            const isTopThree = rank <= 3;
            const medalColor = isTopThree ? MEDAL_COLORS[rank - 1] : null;

            return (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-[14px] transition-colors ${
                  isMe
                    ? 'bg-[#D4AF37]/8 border border-[#D4AF37]/20'
                    : 'bg-[#0F172A] border border-white/6'
                }`}
              >
                {/* Rank */}
                <div className="w-7 flex items-center justify-center flex-shrink-0">
                  {isTopThree ? (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black"
                      style={{ backgroundColor: `${medalColor}20`, color: medalColor }}
                    >
                      {rank}
                    </div>
                  ) : (
                    <span className="text-[13px] font-bold text-[#4B5563]">{rank}</span>
                  )}
                </div>

                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {entry.avatar ? (
                    <img src={entry.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[12px] font-bold text-[#9CA3AF]">
                      {entry.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </span>
                  )}
                </div>

                {/* Name */}
                <p className={`flex-1 text-[13px] font-medium truncate ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                  {isMe ? 'You' : entry.name}
                </p>

                {/* Score */}
                <p className={`text-[13px] font-bold flex-shrink-0 ${isMe ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'}`}>
                  {entry.score.toLocaleString()} <span className="text-[11px] font-normal text-[#6B7280]">{unit}</span>
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
