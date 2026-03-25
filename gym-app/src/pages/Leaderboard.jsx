import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Trophy, BarChart2, Flame, Dumbbell, MapPin, TrendingUp, Target, ChevronRight, ChevronDown, Sparkles, Award, CheckCircle2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useLeaderboard,
  useLeaderboardMostImproved,
  useLeaderboardConsistency,
  useLeaderboardPrs,
  useLeaderboardCheckins,
  useMilestoneFeed,
} from '../hooks/useSupabaseQuery';

// ── Helpers ─────────────────────────────────────────────────
const ACCENT = '#10B981';
const GOLD   = '#D4AF37';
const MEDAL  = [GOLD, '#9CA3AF', '#92400E'];

const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return d.toISOString(); };
const monthStart = () => { const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0); return d.toISOString(); };

const TIME_OPTIONS  = [{ key: 'weekly', label: 'This Week' }, { key: 'monthly', label: 'This Month' }, { key: 'alltime', label: 'All Time' }];

function timeAgoShort(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

const MILESTONE_CFG = {
  workout_count: { icon: Dumbbell, color: '#3B82F6', label: d => d?.count === 1 ? 'First workout!' : `${d?.count} workouts!` },
  streak:        { icon: Flame,    color: '#EF4444', label: d => `${d?.days}-day streak!` },
  first_pr:      { icon: Trophy,   color: GOLD,      label: d => `First PR: ${d?.exercise_name}` },
  pr_count:      { icon: Award,    color: '#A855F7', label: d => `${d?.count} total PRs!` },
};

// ── Mini entry row (for preview cards) ──────────────────────
const MiniEntry = ({ entry, rank, userId, unit, isImproved, isConsistency }) => {
  const isMe = entry.id === userId;
  const color = rank === 1 ? GOLD : rank <= 3 ? MEDAL[rank - 1] : null;

  return (
    <div className={`flex items-center gap-2.5 py-2 ${rank > 1 ? 'border-t border-white/[0.06]' : ''}`}>
      <div className="w-6 flex items-center justify-center flex-shrink-0">
        {rank <= 3 ? (
          <div className="w-5.5 h-5.5 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: `${color}18`, color, fontVariantNumeric: 'tabular-nums' }}>
            {rank}
          </div>
        ) : (
          <span className="text-[11px] font-bold text-[#3F3F46]" style={{ fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
        )}
      </div>
      <div className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0 overflow-hidden">
        {entry.avatar ? (
          <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] font-bold text-[#6B7280]">{entry.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
        )}
      </div>
      <p className={`flex-1 text-[12px] font-medium truncate ${isMe ? 'text-[#E5E7EB]' : 'text-[#C4C4C4]'}`}>
        {isMe ? 'You' : entry.name}
      </p>
      <span className={`text-[12px] font-bold flex-shrink-0 ${rank === 1 ? '' : 'text-[#9CA3AF]'}`} style={{ fontVariantNumeric: 'tabular-nums', ...(rank === 1 ? { color: ACCENT } : {}) }}>
        {isImproved ? `+${entry.score}%` : isConsistency ? `${entry.score}%` : entry.score?.toLocaleString()}
        {unit && !isImproved && !isConsistency && <span className="text-[10px] font-normal text-[#4B5563] ml-0.5">{unit}</span>}
      </span>
    </div>
  );
};

// ── Category preview card ───────────────────────────────────
const CategoryCard = ({ icon: Icon, iconColor, title, subtitle, entries, loading, userId, unit, isImproved, isConsistency, myEntry, onExpand }) => (
  <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden hover:bg-white/[0.06] transition-colors duration-200">
    {/* Header */}
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${iconColor}12` }}>
          <Icon size={15} style={{ color: iconColor }} />
        </div>
        <div>
          <p className="text-[16px] font-semibold text-[#E5E7EB]">{title}</p>
          <p className="text-[10px] text-[#4B5563] mt-0.5">{subtitle}</p>
        </div>
      </div>
      <button onClick={onExpand} className="flex items-center gap-0.5 text-[11px] font-medium text-[#6B7280] hover:text-[#9CA3AF] transition-colors">
        See All <ChevronRight size={12} />
      </button>
    </div>

    {/* Content */}
    <div className="px-5 pb-4">
      {loading ? (
        <div className="space-y-2 py-2">{[1,2,3].map(i => <div key={i} className="h-8 rounded-lg bg-white/[0.04] animate-pulse" />)}</div>
      ) : !entries || entries.length === 0 ? (
        <p className="text-[11px] text-[#4B5563] py-4 text-center">No activity yet this week</p>
      ) : (
        <>
          {entries.slice(0, 3).map((e, i) => (
            <MiniEntry key={e.id} entry={e} rank={i + 1} userId={userId} unit={unit} isImproved={isImproved} isConsistency={isConsistency} />
          ))}
          {/* Show my position if not in top 3 */}
          {myEntry && !entries.slice(0, 3).some(e => e.id === userId) && (
            <div className="mt-1 pt-1 border-t border-dashed border-white/[0.06]">
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider">Your position</span>
              </div>
              <MiniEntry entry={myEntry.entry} rank={myEntry.rank} userId={userId} unit={unit} isImproved={isImproved} isConsistency={isConsistency} />
            </div>
          )}
        </>
      )}
    </div>
  </div>
);

// ── Expanded full list modal ────────────────────────────────
const ExpandedList = ({ title, icon: Icon, iconColor, entries, loading, userId, unit, isImproved, isConsistency, onClose, timeRange, setTimeRange, availableTimes }) => {
  // Render via portal into document.body — completely detached from page scroll
  return createPortal(
    <div
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '92%', maxWidth: 500, maxHeight: '85vh', background: '#0A0D14', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}
      >
      {/* Header — not scrollable */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${iconColor}12` }}>
              <Icon size={15} style={{ color: iconColor }} />
            </div>
            <h2 className="text-[17px] font-bold text-[#E5E7EB]">{title}</h2>
          </div>
          <button onClick={onClose} className="w-11 h-11 rounded-xl bg-white/[0.06] flex items-center justify-center transition-colors duration-200 hover:bg-white/[0.08]">
            <X size={16} className="text-[#9CA3AF]" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pb-3">
          {availableTimes.map(t => (
            <button
              key={t.key}
              onClick={() => setTimeRange(t.key)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-semibold text-center transition-all ${
                timeRange === t.key ? 'text-[#05070B]' : 'bg-white/[0.04] text-[#6B7280]'
              }`}
              style={timeRange === t.key ? { background: ACCENT } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable list — its own scroll context */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div className="px-4 pt-3 pb-28">
          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5,6,7,8].map(i => <div key={i} className="h-[52px] rounded-xl bg-white/[0.04] animate-pulse" />)}</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-20">
              <Trophy size={28} className="text-[#4B5563] mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">No activity for this period</p>
            </div>
          ) : (
            <div className="space-y-1">
              {entries.map((entry, i) => {
                const rank = i + 1;
                const isMe = entry.id === userId;
                const isFirst = rank === 1;
                const medalColor = rank <= 3 ? MEDAL[rank - 1] : null;

                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all ${
                      isFirst ? 'bg-gradient-to-r from-[#D4AF37]/[0.08] to-transparent border border-[#D4AF37]/12'
                      : isMe ? 'bg-white/[0.04] border border-white/[0.06]'
                      : ''
                    }`}
                  >
                    <div className="w-7 flex items-center justify-center flex-shrink-0">
                      {rank <= 3 ? (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black" style={{ background: `${medalColor}18`, color: medalColor, fontVariantNumeric: 'tabular-nums' }}>
                          {rank}
                        </div>
                      ) : (
                        <span className="text-[12px] font-bold text-[#3F3F46]" style={{ fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
                      )}
                    </div>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${isFirst ? 'ring-1 ring-[#D4AF37]/25' : 'bg-white/[0.06]'}`}>
                      {entry.avatar ? (
                        <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-bold text-[#6B7280]">{entry.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold truncate ${isMe ? 'text-[#E5E7EB]' : isFirst ? 'text-[#F5F5F5]' : 'text-[#C4C4C4]'}`}>
                        {isMe ? 'You' : entry.name}
                      </p>
                      {isConsistency && entry.actual_days != null && (
                        <p className="text-[10px] text-[#4B5563]">{entry.actual_days} of {entry.planned_days}/wk days</p>
                      )}
                      {isImproved && entry.previous_value != null && (
                        <p className="text-[10px] text-[#4B5563]">{Math.round(entry.previous_value).toLocaleString()} → {Math.round(entry.current_value).toLocaleString()}</p>
                      )}
                    </div>
                    <span className={`text-[13px] font-bold flex-shrink-0 ${isFirst ? '' : 'text-[#9CA3AF]'}`} style={{ fontVariantNumeric: 'tabular-nums', ...(isFirst ? { color: ACCENT } : {}) }}>
                      {isImproved ? `+${entry.score}%` : isConsistency ? `${entry.score}%` : entry.score?.toLocaleString()}
                      {unit && !isImproved && !isConsistency && <span className="text-[10px] font-normal text-[#4B5563] ml-1">{unit}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
};

// ── Main component ──────────────────────────────────────────
const Leaderboard = ({ embedded = false }) => {
  const { profile, user } = useAuth();
  const gymId = profile?.gym_id;
  const uid = user?.id;

  const [expanded, setExpanded] = useState(null); // which board is expanded
  const [exTimeRange, setExTimeRange] = useState('weekly');

  const startWeek  = weekStart();
  const startMonth = monthStart();
  const exStart = exTimeRange === 'weekly' ? startWeek : exTimeRange === 'monthly' ? startMonth : null;
  const exPeriod = exTimeRange === 'alltime' ? 'monthly' : exTimeRange;

  // ── Preview data (always weekly for the overview cards) ──
  const volume     = useLeaderboard(gymId, 'volume', startWeek);
  const workouts   = useLeaderboard(gymId, 'workouts', startWeek);
  const streak     = useLeaderboard(gymId, 'streak', null);
  const improved   = useLeaderboardMostImproved(gymId, 'volume', 'weekly');
  const consistency = useLeaderboardConsistency(gymId, 'weekly');
  const prs        = useLeaderboardPrs(gymId, startWeek);
  const checkins   = useLeaderboardCheckins(gymId, startWeek);
  const milestones = useMilestoneFeed(gymId);

  // ── Expanded data (uses adjustable filters) ──
  const exVolume     = useLeaderboard(gymId, 'volume', exStart);
  const exWorkouts   = useLeaderboard(gymId, 'workouts', exStart);
  const exStreak     = useLeaderboard(gymId, 'streak', null);
  const exImproved   = useLeaderboardMostImproved(gymId, 'volume', exPeriod);
  const exConsistency = useLeaderboardConsistency(gymId, exPeriod);
  const exPrs        = useLeaderboardPrs(gymId, exStart);
  const exCheckins   = useLeaderboardCheckins(gymId, exStart);

  // Normalize streak entries
  const normalizeStreak = (data) => {
    if (!data) return [];
    return data.map(s => s.profile_id ? { id: s.profile_id, name: s.profiles?.full_name || s.profiles?.username || 'Unknown', avatar: s.profiles?.avatar_url, score: s.current_streak_days } : s);
  };

  const streakEntries   = useMemo(() => normalizeStreak(streak.data), [streak.data]);
  const exStreakEntries  = useMemo(() => normalizeStreak(exStreak.data), [exStreak.data]);

  // Find my position in a list
  const findMe = (entries) => {
    if (!entries || !uid) return null;
    const idx = entries.findIndex(e => e.id === uid);
    if (idx === -1) return null;
    return { entry: entries[idx], rank: idx + 1 };
  };

  // ── Your Position hero card ──
  const myVolume = findMe(volume.data);
  const totalMembers = volume.data?.length ?? 0;
  const myPct = myVolume && totalMembers > 0 ? Math.round((1 - (myVolume.rank - 1) / totalMembers) * 100) : null;

  // Board configs for expansion
  const BOARDS = {
    volume:      { title: 'Volume',        icon: BarChart2,    iconColor: '#3B82F6', unit: 'lbs',       data: exVolume.data,         loading: exVolume.isLoading,      times: TIME_OPTIONS },
    workouts:    { title: 'Workouts',       icon: Dumbbell,     iconColor: '#8B5CF6', unit: 'sessions',  data: exWorkouts.data,       loading: exWorkouts.isLoading,    times: TIME_OPTIONS },
    streak:      { title: 'Streak',         icon: Flame,        iconColor: '#EF4444', unit: 'days',      data: exStreakEntries,        loading: exStreak.isLoading,      times: [TIME_OPTIONS[2]] },
    improved:    { title: 'Most Improved',  icon: TrendingUp,   iconColor: ACCENT,    unit: '',          data: exImproved.data,       loading: exImproved.isLoading,    times: TIME_OPTIONS.slice(0,2), isImproved: true },
    consistency: { title: 'Consistency',    icon: Target,       iconColor: '#F59E0B', unit: '',          data: exConsistency.data,    loading: exConsistency.isLoading, times: TIME_OPTIONS.slice(0,2), isConsistency: true },
    prs:         { title: 'PR Kings',       icon: Trophy,       iconColor: GOLD,      unit: 'PRs',       data: exPrs.data,            loading: exPrs.isLoading,         times: TIME_OPTIONS },
    checkins:    { title: 'Check-Ins',      icon: MapPin,       iconColor: '#06B6D4', unit: 'check-ins', data: exCheckins.data,       loading: exCheckins.isLoading,    times: TIME_OPTIONS },
  };

  const handleExpand = (key) => {
    setExTimeRange('weekly');
    setExpanded(key);
  };

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[#05070B] pb-28 md:pb-12'} animate-fade-in`}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-[680px] md:max-w-4xl px-5 md:px-8'}>

        {/* Title */}
        {!embedded && (
          <div className="pt-6 pb-5">
            <h1 className="text-[28px] font-bold text-[#E5E7EB] tracking-tight">
              Leaderboard
            </h1>
            <p className="text-[14px] text-[#4B5563] mt-1">This week at your gym</p>
          </div>
        )}

        {/* ── Your Position Hero ── */}
        {myVolume && (
          <div className="rounded-2xl bg-gradient-to-br from-[#0F172A] to-[#0F172A]/60 border border-white/[0.06] p-5 mb-4" style={{ boxShadow: '0 0 30px rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center overflow-hidden flex-shrink-0 ring-2 ring-[#10B981]/20">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[14px] font-bold text-[#6B7280]">{profile?.full_name?.charAt(0)?.toUpperCase() ?? '?'}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[#6B7280] font-medium uppercase tracking-wider">Your Rank</p>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-[28px] font-black leading-none" style={{ color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>#{myVolume.rank}</span>
                  {myPct != null && (
                    <span className="text-[12px] font-semibold text-[#4B5563]">Top {Math.max(100 - myPct + 1, 1)}%</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[18px] font-bold text-[#E5E7EB]" style={{ fontVariantNumeric: 'tabular-nums' }}>{myVolume.entry.score?.toLocaleString()}</p>
                <p className="text-[10px] text-[#4B5563] mt-0.5">lbs this week</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Category Cards ── */}
        <div className="space-y-6">
          <CategoryCard
            icon={BarChart2} iconColor="#3B82F6" title="Volume" subtitle="Total weight lifted"
            entries={volume.data} loading={volume.isLoading} userId={uid} unit="lbs"
            myEntry={findMe(volume.data)} onExpand={() => handleExpand('volume')}
          />
          <CategoryCard
            icon={Dumbbell} iconColor="#8B5CF6" title="Workouts" subtitle="Sessions completed"
            entries={workouts.data} loading={workouts.isLoading} userId={uid} unit="sessions"
            myEntry={findMe(workouts.data)} onExpand={() => handleExpand('workouts')}
          />
          <CategoryCard
            icon={TrendingUp} iconColor={ACCENT} title="Most Improved" subtitle="Biggest gains this week"
            entries={improved.data} loading={improved.isLoading} userId={uid} isImproved
            myEntry={findMe(improved.data)} onExpand={() => handleExpand('improved')}
          />
          <CategoryCard
            icon={Target} iconColor="#F59E0B" title="Consistency" subtitle="Hitting planned training days"
            entries={consistency.data} loading={consistency.isLoading} userId={uid} isConsistency
            myEntry={findMe(consistency.data)} onExpand={() => handleExpand('consistency')}
          />
          <CategoryCard
            icon={Flame} iconColor="#EF4444" title="Streak" subtitle="Consecutive days trained"
            entries={streakEntries} loading={streak.isLoading} userId={uid} unit="days"
            myEntry={findMe(streakEntries)} onExpand={() => handleExpand('streak')}
          />
          <CategoryCard
            icon={Trophy} iconColor={GOLD} title="PR Kings" subtitle="New personal records set"
            entries={prs.data} loading={prs.isLoading} userId={uid} unit="PRs"
            myEntry={findMe(prs.data)} onExpand={() => handleExpand('prs')}
          />
          <CategoryCard
            icon={MapPin} iconColor="#06B6D4" title="Check-Ins" subtitle="Gym attendance"
            entries={checkins.data} loading={checkins.isLoading} userId={uid} unit="check-ins"
            myEntry={findMe(checkins.data)} onExpand={() => handleExpand('checkins')}
          />
        </div>

        {/* ── Highlights Feed ── */}
        {milestones.data && milestones.data.length > 0 && (
          <div className="mt-6">
            <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3 px-1">Recent Highlights</p>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden hover:bg-white/[0.06] transition-colors duration-200">
              <div className="px-5 py-2">
                {milestones.data.slice(0, 5).map(entry => {
                  const cfg = MILESTONE_CFG[entry.type] ?? { icon: Sparkles, color: ACCENT, label: () => 'Milestone!' };
                  const MIcon = cfg.icon;
                  return (
                    <div key={entry.id} className="flex items-center gap-3 py-2.5 border-b border-white/[0.06] last:border-0">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${cfg.color}10` }}>
                        <MIcon size={14} style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-[#E5E7EB] truncate">{entry.name}</p>
                        <p className="text-[10px] text-[#9CA3AF] truncate">{cfg.label(entry.data ?? {})}</p>
                      </div>
                      <span className="text-[10px] text-[#4B5563] flex-shrink-0">{timeAgoShort(entry.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Expanded full list overlay ── */}
      {expanded && BOARDS[expanded] && (
        <ExpandedList
          title={BOARDS[expanded].title}
          icon={BOARDS[expanded].icon}
          iconColor={BOARDS[expanded].iconColor}
          entries={BOARDS[expanded].data}
          loading={BOARDS[expanded].loading}
          userId={uid}
          unit={BOARDS[expanded].unit}
          isImproved={BOARDS[expanded].isImproved}
          isConsistency={BOARDS[expanded].isConsistency}
          onClose={() => setExpanded(null)}
          timeRange={exTimeRange}
          setTimeRange={setExTimeRange}
          availableTimes={BOARDS[expanded].times}
        />
      )}
    </div>
  );
};

export default Leaderboard;
