import { useEffect, useState, useCallback } from 'react';
import { Trophy, Clock, ChevronDown, Zap, Dumbbell, Star, Users, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, isPast, isFuture, formatDistanceToNow } from 'date-fns';

// ── Helpers ────────────────────────────────────────────────
const statusOf = (c) => {
  if (isFuture(new Date(c.start_date))) return 'upcoming';
  if (isPast(new Date(c.end_date)))     return 'ended';
  return 'live';
};

const TYPE_META = {
  consistency: { label: 'Consistency', icon: Dumbbell, unit: 'workouts' },
  volume:      { label: 'Total Volume', icon: Zap,     unit: 'lbs'      },
  pr_count:    { label: 'PR Hunter',    icon: Star,    unit: 'PRs'      },
};

const MEDAL = ['🥇', '🥈', '🥉'];

// ── Countdown ──────────────────────────────────────────────
const Countdown = ({ date, prefix }) => {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const tick = () => setLabel(formatDistanceToNow(new Date(date), { addSuffix: false }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [date]);
  return (
    <span className="flex items-center gap-1 text-[11px] text-[#64748B] dark:text-slate-400">
      <Clock size={11} /> {prefix} {label}
    </span>
  );
};

// ── Participant List (upcoming challenges only) ─────────────
const ParticipantList = ({ challengeId }) => {
  const [names, setNames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('challenge_participants')
      .select('profiles(full_name)')
      .eq('challenge_id', challengeId)
      .then(({ data }) => {
        setNames((data || []).map(p => p.profiles?.full_name).filter(Boolean));
        setLoading(false);
      });
  }, [challengeId]);

  if (loading) return (
    <div className="py-5 flex justify-center">
      <div className="w-5 h-5 border-2 border-amber-200 dark:border-amber-800 border-t-amber-500 dark:border-t-amber-400 rounded-full animate-spin" />
    </div>
  );

  if (names.length === 0) return (
    <p className="text-[13px] text-[#64748B] dark:text-slate-400 text-center py-5">No one has joined yet — be the first!</p>
  );

  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400 uppercase tracking-widest mb-2">Signed up</p>
      {names.map((name, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#F8FAFC] dark:bg-white/5 border border-black/5 dark:border-white/10">
          <div className="w-8 h-8 rounded-full bg-[#FEF3C7] dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
            <span className="text-[12px] font-bold text-[#B45309] dark:text-amber-300">{name[0]}</span>
          </div>
          <p className="text-[14px] font-medium text-[#0F172A] dark:text-slate-100">{name}</p>
        </div>
      ))}
    </div>
  );
};

// ── Leaderboard ────────────────────────────────────────────
const Leaderboard = ({ challenge, gymId, myId }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const status = statusOf(challenge);

  const fetch = useCallback(async () => {
    // Always read from challenge_participants.score — it's the persisted source of truth
    // readable by all gym members (RLS: gym_id = current_gym_id()).
    // Scores are backfilled on join and incremented by SessionSummary on workout completion.
    const { data } = await supabase
      .from('challenge_participants')
      .select('profile_id, score, profiles(full_name)')
      .eq('challenge_id', challenge.id)
      .order('score', { ascending: false });

    setEntries(
      (data || []).map(p => ({
        id:    p.profile_id,
        name:  p.profiles?.full_name ?? '—',
        score: Math.round(p.score ?? 0),
      }))
    );
    setLoading(false);
  }, [challenge.id]);

  useEffect(() => {
    fetch();
    const ch = supabase.channel(`member-challenge-${challenge.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workout_sessions', filter: `gym_id=eq.${gymId}` }, fetch)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetch, challenge.id, gymId]);

  const unit = TYPE_META[challenge.type]?.unit ?? '';
  const myRank = entries.findIndex(e => e.id === myId);
  const myEntry = entries[myRank];

  return (
    <div className="mt-4">
      {/* My rank callout */}
      {myEntry && (
        <div className="flex items-center justify-between rounded-2xl bg-[#FFFBEB] dark:bg-amber-900/30 border border-amber-200/80 dark:border-amber-700/50 px-5 py-4 mb-4 shadow-sm">
          <div>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold uppercase tracking-widest">Your rank</p>
            <p className="text-[24px] font-black text-amber-700 dark:text-amber-400 leading-tight mt-0.5">
              #{myRank + 1}
              {myRank < 3 && <span className="ml-1.5 text-[20px]">{MEDAL[myRank]}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#64748B] dark:text-slate-400 font-medium">Your score</p>
            <p className="text-[18px] font-bold text-[#0F172A] dark:text-slate-100 mt-0.5">
              {myEntry.score.toLocaleString()} <span className="text-[13px] font-normal text-[#64748B] dark:text-slate-400">{unit}</span>
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center">
          <div className="w-6 h-6 border-2 border-amber-200 dark:border-amber-800 border-t-amber-500 dark:border-t-amber-400 rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-[#64748B] dark:text-slate-400 text-center py-6">
          {status === 'upcoming' ? 'Leaderboard opens when the challenge starts' : 'No one has joined yet'}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.slice(0, 10).map((e, i) => {
            const isMe = e.id === myId;
            const top = entries[0]?.score || 1;
            return (
              <div key={e.id}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-2xl overflow-hidden transition-colors ${
                  isMe ? 'bg-[#FFFBEB] dark:bg-amber-900/30 border border-amber-200/80 dark:border-amber-700/50 shadow-sm' : 'bg-[#F8FAFC] dark:bg-white/5 border border-black/5 dark:border-white/10'
                }`}
              >
                <div
                  className="absolute inset-0 opacity-[0.06] dark:opacity-[0.12]"
                  style={{ width: `${(e.score / top) * 100}%`, background: isMe ? '#B45309' : '#64748B' }}
                />
                <span className={`text-[14px] font-bold w-6 text-center relative z-10 ${
                  i === 0 ? 'text-amber-600 dark:text-amber-400' : i === 1 ? 'text-slate-500 dark:text-slate-400' : i === 2 ? 'text-amber-700 dark:text-amber-500' : 'text-[#64748B] dark:text-slate-400'
                }`}>
                  {i < 3 ? MEDAL[i] : i + 1}
                </span>
                <p className={`flex-1 text-[14px] font-semibold truncate relative z-10 ${isMe ? 'text-amber-800 dark:text-amber-300' : 'text-[#0F172A] dark:text-slate-100'}`}>
                  {e.name}{isMe && <span className="ml-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">YOU</span>}
                </p>
                <p className={`text-[13px] font-bold relative z-10 ${isMe ? 'text-amber-700 dark:text-amber-400' : 'text-[#475569] dark:text-slate-400'}`}>
                  {e.score.toLocaleString()} <span className="text-[11px] font-medium text-[#94A3B8] dark:text-slate-500">{unit}</span>
                </p>
              </div>
            );
          })}
          {entries.length > 10 && myRank >= 10 && myEntry && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#FFFBEB] dark:bg-amber-900/30 border border-amber-200/80 dark:border-amber-700/50 shadow-sm">
              <span className="text-[14px] font-bold w-6 text-center text-amber-700 dark:text-amber-400">#{myRank + 1}</span>
              <p className="flex-1 text-[14px] font-semibold text-amber-800 dark:text-amber-300 truncate">
                {myEntry.name} <span className="ml-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">YOU</span>
              </p>
              <p className="text-[13px] font-bold text-amber-700 dark:text-amber-400">
                {myEntry.score.toLocaleString()} <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{unit}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Challenge card ─────────────────────────────────────────
const ChallengeCard = ({ challenge, gymId, myId, joined, participantCount, onJoin }) => {
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const status = statusOf(challenge);
  const meta = TYPE_META[challenge.type] ?? {};
  const Icon = meta.icon ?? Trophy;

  const statusStyle = {
    live:     'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40',
    upcoming: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40',
    ended:    'text-[#64748B] dark:text-slate-400 bg-slate-100 dark:bg-slate-700',
  }[status];

  const statusLabel = { live: 'Live', upcoming: 'Upcoming', ended: 'Ended' }[status];

  const handleJoin = async (e) => {
    e.stopPropagation();
    setJoining(true);
    await onJoin(challenge.id);
    setJoining(false);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-slate-50/80 dark:hover:bg-white/5 active:bg-slate-100/80 dark:active:bg-white/10 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
      >
        <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
          <Icon size={22} className="text-amber-600 dark:text-amber-400" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <p className="text-[16px] font-semibold text-[#0F172A] dark:text-slate-100 truncate">{challenge.name}</p>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[12px] text-[#64748B] dark:text-slate-400">{meta.label}</span>
            {participantCount > 0 && (
              <>
                <span className="text-[#CBD5E1] dark:text-slate-500">·</span>
                <span className="flex items-center gap-1 text-[12px] text-[#64748B] dark:text-slate-400">
                  <Users size={12} /> {participantCount}
                </span>
              </>
            )}
            <span className="text-[#CBD5E1] dark:text-slate-500">·</span>
            {status === 'live' && <Countdown date={challenge.end_date} prefix="Ends in" />}
            {status === 'upcoming' && <Countdown date={challenge.start_date} prefix="Starts in" />}
            {status === 'ended' && (
              <span className="text-[12px] text-[#64748B] dark:text-slate-400">
                Ended {format(new Date(challenge.end_date), 'MMM d')}
              </span>
            )}
          </div>
        </div>

        {/* Join / Joined for live + upcoming */}
        {status !== 'ended' && (
          joined ? (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/40">
              <Check size={14} strokeWidth={2.5} /> In
            </span>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining}
              className="flex-shrink-0 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-50 bg-amber-500 text-black hover:bg-amber-600 shadow-sm border border-amber-600/30 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 dark:focus:ring-offset-slate-800 dark:!bg-amber-400 dark:hover:!bg-amber-300 dark:border-amber-300/60 dark:text-black"
            >
              {joining ? '…' : 'Join'}
            </button>
          )
        )}

        <ChevronDown size={20} className={`text-[#94A3B8] dark:text-slate-500 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5">
          {challenge.description && (
            <p className="text-[14px] text-[#475569] dark:text-slate-400 leading-relaxed mt-4">{challenge.description}</p>
          )}
          <div className="mt-3 text-[12px] text-[#64748B] dark:text-slate-400 font-medium">
            {format(new Date(challenge.start_date), 'MMM d')} – {format(new Date(challenge.end_date), 'MMM d, yyyy')}
          </div>
          {status === 'upcoming'
            ? <ParticipantList challengeId={challenge.id} />
            : <Leaderboard challenge={challenge} gymId={gymId} myId={myId} />
          }
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────
const TABS = ['live', 'upcoming', 'ended'];

export default function Challenges() {
  const { profile, user } = useAuth();
  const [challenges, setChallenges]       = useState([]);
  const [participants, setParticipants]   = useState([]); // all participant rows for this gym's challenges
  const [loading, setLoading]             = useState(true);
  const [tab, setTab]                     = useState('live');

  useEffect(() => {
    if (!profile?.gym_id || !user?.id) return;

    const load = async () => {
      const [{ data: cData }, { data: pData }] = await Promise.all([
        supabase.from('challenges').select('*').eq('gym_id', profile.gym_id).order('start_date', { ascending: false }),
        supabase.from('challenge_participants').select('challenge_id, profile_id, score').eq('gym_id', profile.gym_id),
      ]);
      setChallenges(cData || []);
      setParticipants(pData || []);
      setLoading(false);
    };
    load();
  }, [profile?.gym_id, user?.id]);

  const handleJoin = async (challengeId) => {
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return;

    // Backfill score from user's own data during the challenge period
    let score = 0;
    try {
      const start = challenge.start_date;
      const end   = challenge.end_date;

      if (challenge.type === 'consistency') {
        const { count } = await supabase
          .from('workout_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id)
          .gte('completed_at', start)
          .lte('completed_at', end);
        score = count ?? 0;

      } else if (challenge.type === 'volume') {
        const { data: sets } = await supabase
          .from('workout_sets')
          .select('weight_kg, reps, workout_sessions!inner(profile_id, completed_at)')
          .eq('workout_sessions.profile_id', user.id)
          .gte('workout_sessions.completed_at', start)
          .lte('workout_sessions.completed_at', end)
          .eq('completed', true);
        score = (sets || []).reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);

      } else if (challenge.type === 'pr_count') {
        const { count } = await supabase
          .from('personal_records')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id)
          .gte('achieved_at', start)
          .lte('achieved_at', end);
        score = count ?? 0;
      }
    } catch (_) {
      // If backfill fails, join with 0 — better than not joining
    }

    const { data, error } = await supabase
      .from('challenge_participants')
      .insert({ challenge_id: challengeId, profile_id: user.id, gym_id: profile.gym_id, score })
      .select('challenge_id, profile_id, score')
      .single();
    if (!error && data) setParticipants(prev => [...prev, data]);
  };

  // Derived maps
  const myJoinedIds = new Set(participants.filter(p => p.profile_id === user?.id).map(p => p.challenge_id));
  const countMap = participants.reduce((acc, p) => {
    acc[p.challenge_id] = (acc[p.challenge_id] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = challenges.filter(c => statusOf(c) === tab);

  const liveCount = challenges.filter(c => statusOf(c) === 'live').length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A] pb-24 md:pb-10 transition-colors">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F8FAFC]/95 dark:bg-[#0F172A]/95 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/10">
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shadow-sm">
              <Trophy size={24} className="text-amber-600 dark:text-amber-400" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[#0F172A] dark:text-slate-100 tracking-tight">Challenges</h1>
              <p className="text-[13px] text-[#64748B] dark:text-slate-400 mt-0.5">Compete with your gym</p>
            </div>
          </div>

          {/* Pill tabs */}
          <div className="flex gap-1.5 bg-slate-200/60 dark:bg-white/10 p-1.5 rounded-full">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 rounded-full text-[13px] font-semibold capitalize transition-all ${
                  tab === t
                    ? 'bg-white dark:bg-slate-700 text-[#0F172A] dark:text-slate-100 shadow-sm'
                    : 'text-[#64748B] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100'
                }`}
              >
                {t}
                {t === 'live' && liveCount > 0 && (
                  <span className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[11px] font-bold ${
                    tab === t ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300' : 'bg-slate-300/80 dark:bg-white/20 text-slate-600 dark:text-slate-400'
                  }`}>
                    {liveCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-28">
            <div className="w-8 h-8 border-2 border-amber-200 dark:border-amber-800 border-t-amber-500 dark:border-t-amber-400 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 px-6">
            <div className="w-16 h-16 rounded-3xl bg-slate-200/80 dark:bg-white/10 flex items-center justify-center mx-auto mb-4">
              <Trophy size={32} className="text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-[16px] font-semibold text-[#334155] dark:text-slate-200">
              {tab === 'live'     && 'No active challenges right now'}
              {tab === 'upcoming' && 'No upcoming challenges'}
              {tab === 'ended'    && 'No past challenges'}
            </p>
            {tab === 'live' && (
              <p className="text-[14px] text-[#64748B] dark:text-slate-400 mt-2">Your gym admin will post challenges here</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(c => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                gymId={profile.gym_id}
                myId={user.id}
                joined={myJoinedIds.has(c.id)}
                participantCount={countMap[c.id] ?? 0}
                onJoin={handleJoin}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
