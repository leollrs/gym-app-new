import React, { useState } from 'react';
import { Trophy, BarChart2, Flame, Dumbbell } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLeaderboard } from '../hooks/useSupabaseQuery';
import PageHeader from '../components/PageHeader';

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
const Leaderboard = ({ embedded = false }) => {
  const { profile, user } = useAuth();
  const [metric, setMetric]     = useState('volume');
  const [timeRange, setTimeRange] = useState('weekly');

  const startDate = getStartDate(timeRange);
  const { data: rawData, isLoading: loading } = useLeaderboard(profile?.gym_id, metric, startDate);

  // Normalize streak data to match the { id, name, avatar, score } shape
  const entries = React.useMemo(() => {
    if (!rawData) return [];
    if (metric === 'streak') {
      return rawData.map(s => ({
        id: s.profile_id,
        name: s.profiles?.full_name || s.profiles?.username || 'Unknown',
        avatar: s.profiles?.avatar_url,
        score: s.current_streak_days,
      }));
    }
    return rawData;
  }, [rawData, metric]);

  const currentMetric = METRIC_TABS.find(m => m.key === metric);
  const unit = currentMetric?.unit ?? '';

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[#05070B] pb-28 md:pb-12'} animate-fade-in`}>
      {!embedded && (
      <PageHeader title="Leaderboard" subtitle="See who's putting in the work">
        {/* Metric toggle */}
        <div className="flex gap-1 bg-[#111827] p-1 rounded-xl mb-3">
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
        <div className="flex border-b border-white/8">
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
      </PageHeader>
      )}

      {embedded && (
        <>
        {/* Metric toggle (inline for embedded) */}
        <div className="flex gap-1 bg-[#111827] p-1 rounded-xl mb-3">
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

        {/* Time range tabs (inline for embedded) */}
        <div className="flex border-b border-white/8 mb-4">
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
        </>
      )}

      <div className={embedded ? '' : 'mx-auto w-full max-w-[700px] px-5 md:px-8 pt-6'}>

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
                    <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
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
    </div>
  );
};

export default Leaderboard;
