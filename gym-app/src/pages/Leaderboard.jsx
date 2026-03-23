import React, { useState, useMemo } from 'react';
import { Trophy, BarChart2, Flame, Dumbbell, MapPin, Star, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useLeaderboard,
  useLeaderboardMostImproved,
  useLeaderboardConsistency,
  useLeaderboardPrs,
  useLeaderboardCheckins,
  useLeaderboardNewcomers,
  useMilestoneFeed,
} from '../hooks/useSupabaseQuery';
import PageHeader from '../components/PageHeader';
import BoardSelector from '../components/leaderboard/BoardSelector';
import TierFilter from '../components/leaderboard/TierFilter';
import MostImprovedList from '../components/leaderboard/MostImprovedList';
import ConsistencyList from '../components/leaderboard/ConsistencyList';
import MilestoneFeed from '../components/leaderboard/MilestoneFeed';

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

// ── Board-specific metric & time configs ────────────────────
const RANKING_METRICS = [
  { key: 'volume',   label: 'Volume',   icon: BarChart2, unit: 'lbs' },
  { key: 'workouts', label: 'Workouts', icon: Dumbbell,  unit: 'sessions' },
  { key: 'streak',   label: 'Streak',   icon: Flame,     unit: 'days' },
];

const IMPROVED_METRICS = [
  { key: 'volume',   label: 'Volume',   icon: BarChart2 },
  { key: 'workouts', label: 'Workouts', icon: Dumbbell },
];

const NEWCOMER_METRICS = [
  { key: 'volume',   label: 'Volume',   icon: BarChart2, unit: 'lbs' },
  { key: 'workouts', label: 'Workouts', icon: Dumbbell,  unit: 'sessions' },
];

const ALL_TIME_TABS = [
  { key: 'weekly',  label: 'This Week' },
  { key: 'monthly', label: 'This Month' },
  { key: 'alltime', label: 'All Time' },
];

const SHORT_TIME_TABS = [
  { key: 'weekly',  label: 'This Week' },
  { key: 'monthly', label: 'This Month' },
];

const MEDAL_COLORS = ['#D4AF37', '#9CA3AF', '#92400E'];

// ── Ranked list (reused for Rankings, PRs, Check-Ins, Newcomers) ──
const RankedList = ({ entries, loading, userId, unit, emptyIcon: EmptyIcon = Trophy, emptyTitle, emptyDesc }) => {
  if (loading) {
    return (
      <div className="flex flex-col gap-2.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[60px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-20">
        <EmptyIcon size={32} className="text-[#4B5563] mx-auto mb-3" />
        <p className="text-[14px] text-[#6B7280]">{emptyTitle || 'No activity yet for this period'}</p>
        <p className="text-[12px] text-[#4B5563] mt-1">{emptyDesc || 'Complete workouts to appear on the leaderboard'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, i) => {
        const rank = i + 1;
        const isMe = entry.id === userId;
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

            <div className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {entry.avatar ? (
                <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[12px] font-bold text-[#9CA3AF]">
                  {entry.name?.charAt(0)?.toUpperCase() ?? '?'}
                </span>
              )}
            </div>

            <p className={`flex-1 text-[13px] font-medium truncate ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
              {isMe ? 'You' : entry.name}
            </p>

            <p className={`text-[13px] font-bold flex-shrink-0 ${isMe ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'}`}>
              {entry.score.toLocaleString()} {unit && <span className="text-[11px] font-normal text-[#6B7280]">{unit}</span>}
            </p>
          </div>
        );
      })}
    </div>
  );
};

// ── Metric tabs component ──────────────────────────────────
const MetricTabs = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 bg-[#111827] p-1 rounded-xl mb-3">
    {tabs.map(tab => {
      const Icon = tab.icon;
      return (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
            active === tab.key
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
);

// ── Time range tabs component ──────────────────────────────
const TimeTabs = ({ tabs, active, onChange }) => (
  <div className="flex border-b border-white/8 mb-4">
    {tabs.map(tab => (
      <button
        key={tab.key}
        onClick={() => onChange(tab.key)}
        className={`flex-1 py-3 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${
          active === tab.key
            ? 'text-[#D4AF37] border-[#D4AF37]'
            : 'text-[#6B7280] border-transparent hover:text-[#9CA3AF]'
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

// ── Main page ──────────────────────────────────────────────
const Leaderboard = ({ embedded = false }) => {
  const { profile, user } = useAuth();
  const gymId = profile?.gym_id;

  const [boardType, setBoardType] = useState('rankings');
  const [metric, setMetric]       = useState('volume');
  const [timeRange, setTimeRange] = useState('weekly');
  const [tier, setTier]           = useState(null);

  const startDate = getStartDate(timeRange);
  const period = timeRange === 'alltime' ? 'monthly' : timeRange;

  // ── Data hooks (all called unconditionally, enabled flag controls fetching) ──
  const rankings     = useLeaderboard(gymId, metric, startDate, tier);
  const improved     = useLeaderboardMostImproved(gymId, metric, period, tier);
  const consistency  = useLeaderboardConsistency(gymId, period, tier);
  const prs          = useLeaderboardPrs(gymId, startDate, tier);
  const checkins     = useLeaderboardCheckins(gymId, startDate, tier);
  const newcomers    = useLeaderboardNewcomers(gymId, metric, startDate);
  const milestones   = useMilestoneFeed(gymId);

  // Normalize streak data
  const rankingEntries = useMemo(() => {
    const raw = rankings.data;
    if (!raw) return [];
    if (metric === 'streak') {
      return raw.map(s => ({
        id: s.profile_id,
        name: s.profiles?.full_name || s.profiles?.username || 'Unknown',
        avatar: s.profiles?.avatar_url,
        score: s.current_streak_days,
      }));
    }
    return raw;
  }, [rankings.data, metric]);

  // ── Determine which tabs to show per board ──
  const showMetricTabs = ['rankings', 'improved', 'newcomers'].includes(boardType);
  const metricTabs = boardType === 'improved' ? IMPROVED_METRICS
    : boardType === 'newcomers' ? NEWCOMER_METRICS
    : RANKING_METRICS;

  const showTimeTabs = boardType !== 'milestones';
  const timeTabs = ['improved', 'consistency'].includes(boardType) ? SHORT_TIME_TABS
    : boardType === 'newcomers' ? [{ key: 'monthly', label: 'This Month' }]
    : ALL_TIME_TABS;

  const showTierFilter = !['milestones', 'newcomers'].includes(boardType);

  // Reset metric/time when switching boards if current selection is invalid
  React.useEffect(() => {
    if (boardType === 'improved' && metric === 'streak') setMetric('volume');
    if (boardType === 'newcomers' && metric === 'streak') setMetric('volume');
    if (['improved', 'consistency'].includes(boardType) && timeRange === 'alltime') setTimeRange('monthly');
    if (boardType === 'newcomers') setTimeRange('monthly');
  }, [boardType]);

  // ── Render board content ──
  const renderContent = () => {
    const uid = user?.id;

    switch (boardType) {
      case 'rankings': {
        const currentMetric = RANKING_METRICS.find(m => m.key === metric);
        return (
          <RankedList
            entries={rankingEntries}
            loading={rankings.isLoading}
            userId={uid}
            unit={currentMetric?.unit ?? ''}
          />
        );
      }
      case 'improved':
        return (
          <MostImprovedList
            entries={improved.data ?? []}
            loading={improved.isLoading}
            userId={uid}
          />
        );
      case 'consistency':
        return (
          <ConsistencyList
            entries={consistency.data ?? []}
            loading={consistency.isLoading}
            userId={uid}
          />
        );
      case 'prs':
        return (
          <RankedList
            entries={prs.data ?? []}
            loading={prs.isLoading}
            userId={uid}
            unit="PRs"
            emptyIcon={Trophy}
            emptyTitle="No PRs this period"
            emptyDesc="Set new personal records to climb the board"
          />
        );
      case 'checkins':
        return (
          <RankedList
            entries={checkins.data ?? []}
            loading={checkins.isLoading}
            userId={uid}
            unit="check-ins"
            emptyIcon={MapPin}
            emptyTitle="No check-ins this period"
            emptyDesc="Check in at the gym to appear here"
          />
        );
      case 'newcomers':
        return (
          <RankedList
            entries={newcomers.data ?? []}
            loading={newcomers.isLoading}
            userId={uid}
            unit={NEWCOMER_METRICS.find(m => m.key === metric)?.unit ?? ''}
            emptyIcon={Star}
            emptyTitle="No newcomers yet"
            emptyDesc="Members in their first 60 days will appear here"
          />
        );
      case 'milestones':
        return (
          <MilestoneFeed
            entries={milestones.data ?? []}
            loading={milestones.isLoading}
          />
        );
      default:
        return null;
    }
  };

  // ── Controls block (shared between embedded and full-page) ──
  const controls = (
    <>
      {/* Board selector */}
      <div className="mb-4">
        <BoardSelector active={boardType} onChange={setBoardType} />
      </div>

      {/* Tier filter */}
      {showTierFilter && (
        <div className="mb-3">
          <TierFilter active={tier} onChange={setTier} />
        </div>
      )}

      {/* Metric tabs */}
      {showMetricTabs && (
        <MetricTabs tabs={metricTabs} active={metric} onChange={setMetric} />
      )}

      {/* Time tabs */}
      {showTimeTabs && (
        <TimeTabs tabs={timeTabs} active={timeRange} onChange={setTimeRange} />
      )}
    </>
  );

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[#05070B] pb-28 md:pb-12'} animate-fade-in`}>
      {!embedded && (
        <PageHeader title="Leaderboard" subtitle="See who's putting in the work">
          {controls}
        </PageHeader>
      )}

      {embedded && controls}

      <div className={embedded ? '' : 'mx-auto w-full max-w-[700px] px-5 md:px-8 pt-6'}>
        {renderContent()}
      </div>
    </div>
  );
};

export default Leaderboard;
