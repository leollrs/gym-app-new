import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, Zap, BarChart2, Target, Calendar, Users, ChevronDown } from 'lucide-react';
import { format, isPast, isFuture } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const TYPE_LABELS = { consistency: 'Consistency', volume: 'Total Volume', pr_count: 'PR Hunter', team: 'Team', specific_lift: 'Specific Lift' };
const TYPE_ICONS  = { consistency: Zap, volume: BarChart2, pr_count: Target, team: Trophy, specific_lift: Trophy };
const SCORE_UNIT  = { consistency: 'workouts', volume: 'lbs', pr_count: 'PRs', team: 'pts', specific_lift: 'lbs' };

const statusOf = (c) => {
  if (isFuture(new Date(c.start_date))) return 'upcoming';
  if (isPast(new Date(c.end_date)))     return 'ended';
  return 'live';
};

// ── Podium ─────────────────────────────────────────────────
const PODIUM_STYLES = [
  { bg: 'bg-[#D4AF37]',   text: 'text-black', label: '1st', order: 'order-2', height: 'h-20' },
  { bg: 'bg-[#9CA3AF]',   text: 'text-black', label: '2nd', order: 'order-1', height: 'h-14' },
  { bg: 'bg-[#92400E]',   text: 'text-white', label: '3rd', order: 'order-3', height: 'h-10' },
];

const Podium = ({ entries, unit, userId }) => {
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="mt-3">
      {/* Podium top 3 */}
      {top3.length > 0 && (
        <div className="flex items-end justify-center gap-2 mb-4 px-2">
          {[1, 0, 2].map(i => {
            const e = top3[i];
            if (!e) return <div key={i} className="flex-1" />;
            const s = PODIUM_STYLES[i];
            const isMe = e.id === userId;
            return (
              <div key={e.id} className={`flex-1 flex flex-col items-center gap-1 ${s.order}`}>
                {/* Avatar circle */}
                <div className={`w-9 h-9 rounded-full ${s.bg} flex items-center justify-center text-[13px] font-black ${s.text} ${isMe ? 'ring-2 ring-white/40' : ''}`}>
                  {e.name?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
                <p className={`text-[11px] font-semibold truncate w-full text-center ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                  {isMe ? 'You' : e.name?.split(' ')[0]}
                </p>
                <p className="text-[10px] text-[#6B7280]">{e.score.toLocaleString()} {unit}</p>
                {/* Podium block */}
                <div className={`w-full ${s.height} ${s.bg} rounded-t-lg flex items-center justify-center`}>
                  <span className={`text-[11px] font-black ${s.text}`}>{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rest of list */}
      {rest.map((e, i) => (
        <div
          key={e.id}
          className={`flex items-center gap-3 py-2.5 px-3 rounded-xl mb-1.5 ${e.id === userId ? 'bg-[#D4AF37]/8 border border-[#D4AF37]/20' : 'bg-[#111827]'}`}
        >
          <span className="text-[12px] font-bold w-5 text-center text-[#4B5563]">{i + 4}</span>
          <div className="w-7 h-7 rounded-full bg-white/8 flex items-center justify-center flex-shrink-0">
            <span className="text-[11px] font-bold text-[#9CA3AF]">{e.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
          </div>
          <p className={`flex-1 text-[13px] font-medium truncate ${e.id === userId ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
            {e.id === userId ? 'You' : e.name}
          </p>
          <p className="text-[12px] font-semibold text-[#9CA3AF] flex-shrink-0">
            {e.score.toLocaleString()} {unit}
          </p>
        </div>
      ))}
    </div>
  );
};

// ── Challenge card ──────────────────────────────────────────
const ChallengeCard = ({ challenge, gymId, userId, isJoined, onJoin, onLeave }) => {
  const [entries, setEntries]   = useState([]);
  const [loadingLb, setLoadingLb] = useState(false);
  const [joining, setJoining]   = useState(false);
  const [open, setOpen]         = useState(false);
  const status = statusOf(challenge);

  const loadScores = useCallback(async () => {
    if (!open || status === 'upcoming') return;
    setLoadingLb(true);

    // Only score members who have explicitly joined
    const { data: participants } = await supabase
      .from('challenge_participants')
      .select('profile_id, profiles(full_name)')
      .eq('challenge_id', challenge.id);

    const participantMap = {};
    (participants || []).forEach(p => {
      participantMap[p.profile_id] = p.profiles?.full_name ?? '—';
    });
    const participantIds = Object.keys(participantMap);

    if (participantIds.length === 0) {
      setEntries([]);
      setLoadingLb(false);
      return;
    }

    let list = [];
    if (challenge.type === 'consistency' || challenge.type === 'volume') {
      const { data } = await supabase
        .from('workout_sessions')
        .select('profile_id, total_volume_lbs')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', challenge.start_date)
        .lte('started_at', challenge.end_date)
        .in('profile_id', participantIds);

      // Start with all participants at 0
      const agg = {};
      participantIds.forEach(id => { agg[id] = { name: participantMap[id], count: 0, volume: 0 }; });
      (data || []).forEach(s => {
        agg[s.profile_id].count++;
        agg[s.profile_id].volume += parseFloat(s.total_volume_lbs || 0);
      });
      list = Object.entries(agg)
        .map(([id, v]) => ({ id, name: v.name, score: challenge.type === 'volume' ? Math.round(v.volume) : v.count }))
        .sort((a, b) => b.score - a.score).slice(0, 10);

    } else if (challenge.type === 'pr_count') {
      const { data } = await supabase
        .from('pr_history')
        .select('profile_id')
        .eq('gym_id', gymId)
        .gte('achieved_at', challenge.start_date)
        .lte('achieved_at', challenge.end_date)
        .in('profile_id', participantIds);

      const agg = {};
      participantIds.forEach(id => { agg[id] = { name: participantMap[id], score: 0 }; });
      (data || []).forEach(r => { agg[r.profile_id].score++; });
      list = Object.entries(agg).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score).slice(0, 10);
    }

    setEntries(list);
    setLoadingLb(false);
  }, [open, challenge, gymId, status]);

  useEffect(() => { loadScores(); }, [loadScores]);

  const handleJoin = async () => {
    setJoining(true);
    await onJoin(challenge.id);
    setOpen(true);
    setJoining(false);
  };

  const handleLeave = async () => {
    setJoining(true);
    await onLeave(challenge.id);
    setJoining(false);
  };

  const Icon = TYPE_ICONS[challenge.type] ?? Trophy;
  const unit = SCORE_UNIT[challenge.type] ?? '';

  const statusColor = {
    live:     'text-emerald-400 bg-emerald-500/10',
    upcoming: 'text-blue-400 bg-blue-500/10',
    ended:    'text-[#6B7280] bg-white/6',
  }[status];

  return (
    <div className={`bg-[#0F172A] border rounded-[14px] overflow-hidden transition-colors ${isJoined ? 'border-[#D4AF37]/20' : 'border-white/6'}`}>
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/2 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isJoined ? 'bg-[#D4AF37]/15' : 'bg-white/6'}`}>
          <Icon size={18} className={isJoined ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{challenge.name}</p>
            {isJoined && <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full flex-shrink-0">Joined</span>}
          </div>
          <p className="text-[11px] text-[#6B7280]">
            {TYPE_LABELS[challenge.type] ?? challenge.type} ·{' '}
            <span className="flex-shrink-0">
              {format(new Date(challenge.start_date), 'MMM d')} – {format(new Date(challenge.end_date), 'MMM d')}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor}`}>
            {status === 'live' ? 'Live' : status === 'upcoming' ? 'Upcoming' : 'Ended'}
          </span>
          <ChevronDown size={15} className={`text-[#4B5563] transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded panel */}
      {open && (
        <div className="px-4 pb-4 border-t border-white/4">
          {challenge.description && (
            <p className="text-[12px] text-[#9CA3AF] mt-3">{challenge.description}</p>
          )}

          {/* Join / Leave */}
          {status !== 'ended' && (
            <div className="mt-3 flex gap-2">
              {isJoined ? (
                <button
                  onClick={handleLeave}
                  disabled={joining}
                  className="px-4 py-2 text-[12px] font-semibold rounded-xl border border-white/10 text-[#9CA3AF] hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  {joining ? 'Leaving…' : 'Leave challenge'}
                </button>
              ) : (
                <button
                  onClick={handleJoin}
                  disabled={joining}
                  className="flex-1 py-2.5 text-[13px] font-bold rounded-xl bg-[#D4AF37] text-black hover:bg-[#C4A030] transition-colors disabled:opacity-50"
                >
                  {joining ? 'Joining…' : status === 'upcoming' ? 'Sign up for challenge' : 'Join & compete'}
                </button>
              )}
            </div>
          )}

          {/* Leaderboard */}
          {status !== 'upcoming' && (
            <>
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mt-4 mb-1">Leaderboard</p>
              {loadingLb ? (
                <div className="flex justify-center py-5">
                  <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                </div>
              ) : entries.length === 0 ? (
                <p className="text-[12px] text-[#6B7280] text-center py-4">No activity recorded yet</p>
              ) : (
                <Podium entries={entries} unit={unit} userId={userId} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────
const Leaderboard = () => {
  const { profile, user } = useAuth();
  const [challenges, setChallenges]   = useState([]);
  const [myIds, setMyIds]             = useState(new Set());
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState('active');

  const loadAll = useCallback(async () => {
    if (!profile?.gym_id) return;
    const [{ data: chal }, { data: mine }] = await Promise.all([
      supabase.from('challenges').select('*').eq('gym_id', profile.gym_id).order('start_date', { ascending: false }),
      supabase.from('challenge_participants').select('challenge_id').eq('profile_id', user.id),
    ]);
    setChallenges(chal || []);
    setMyIds(new Set((mine || []).map(r => r.challenge_id)));
    setLoading(false);
  }, [profile?.gym_id, user?.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleJoin = async (challengeId) => {
    await supabase.from('challenge_participants').insert({ challenge_id: challengeId, profile_id: user.id, gym_id: profile.gym_id });
    setMyIds(prev => new Set([...prev, challengeId]));
  };

  const handleLeave = async (challengeId) => {
    await supabase.from('challenge_participants').delete().eq('challenge_id', challengeId).eq('profile_id', user.id);
    setMyIds(prev => { const s = new Set(prev); s.delete(challengeId); return s; });
  };

  const live     = challenges.filter(c => statusOf(c) === 'live');
  const upcoming = challenges.filter(c => statusOf(c) === 'upcoming');
  const ended    = challenges.filter(c => statusOf(c) === 'ended');
  const mine     = challenges.filter(c => myIds.has(c.id));

  const tabs = [
    { key: 'mine',     label: `Mine${mine.length ? ` (${mine.length})` : ''}` },
    { key: 'active',   label: `Active${live.length ? ` (${live.length})` : ''}` },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past',     label: 'Past' },
  ];

  const shown = { mine, active: live, upcoming, past: ended }[activeTab] ?? [];

  return (
    <div className="mx-auto w-full max-w-[700px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">
      <header className="mb-8">
        <h1 className="text-[24px] font-bold text-[#E5E7EB]">Challenges</h1>
        <p className="text-[13px] text-[#6B7280] mt-1">Join competitions and track your rank</p>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-white/8 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-shrink-0 px-4 py-3.5 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-[#D4AF37] border-[#D4AF37]'
                : 'text-[#6B7280] border-transparent hover:text-[#9CA3AF]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[72px] animate-pulse" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-20">
          <Trophy size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">
            {activeTab === 'mine'     ? "You haven't joined any challenges yet"  :
             activeTab === 'active'   ? 'No active challenges right now'         :
             activeTab === 'upcoming' ? 'No upcoming challenges'                  :
             'No past challenges'}
          </p>
          {activeTab === 'mine' && live.length > 0 && (
            <button onClick={() => setActiveTab('active')} className="mt-3 text-[13px] font-semibold text-[#D4AF37]">
              View active challenges →
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map(c => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              gymId={profile.gym_id}
              userId={user?.id}
              isJoined={myIds.has(c.id)}
              onJoin={handleJoin}
              onLeave={handleLeave}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
