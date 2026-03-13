import { useEffect, useState, useCallback } from 'react';
import { Trophy, Clock, ChevronDown, Zap, Dumbbell, Star, Users, Check, Flame } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, isPast, isFuture, formatDistanceToNow, startOfDay } from 'date-fns';
import { addPoints } from '../lib/rewardsEngine';
import useSwipeTabs from '../hooks/useSwipeTabs';

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
    <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
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
      <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );

  if (names.length === 0) return (
    <p className="text-[13px] text-[#6B7280] text-center py-5">No one has joined yet — be the first!</p>
  );

  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-2">Signed up</p>
      {names.map((name, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-[14px] bg-[#111827] border border-white/6">
          <div className="w-8 h-8 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[12px] font-bold text-[#D4AF37]">{name[0]}</span>
          </div>
          <p className="text-[14px] font-medium text-[#E5E7EB]">{name}</p>
        </div>
      ))}
    </div>
  );
};

// ── Leaderboard ────────────────────────────────────────────
const REWARD_BADGES = [
  { label: '🏆 500 pts', points: 500 },
  { label: '🥈 300 pts', points: 300 },
  { label: '🥉 150 pts', points: 150 },
];

const Leaderboard = ({ challenge, gymId, myId }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const status = statusOf(challenge);

  const fetch = useCallback(async () => {
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
        <div className="flex items-center justify-between rounded-[14px] bg-[#D4AF37]/10 border border-[#D4AF37]/30 px-5 py-4 mb-4">
          <div>
            <p className="text-[11px] text-[#D4AF37] font-semibold uppercase tracking-widest">Your rank</p>
            <p className="text-[24px] font-black text-[#D4AF37] leading-tight mt-0.5">
              #{myRank + 1}
              {myRank < 3 && <span className="ml-1.5 text-[20px]">{MEDAL[myRank]}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#9CA3AF] font-medium">Your score</p>
            <p className="text-[18px] font-bold text-[#E5E7EB] mt-0.5">
              {myEntry.score.toLocaleString()} <span className="text-[13px] font-normal text-[#9CA3AF]">{unit}</span>
            </p>
            {status === 'ended' && myRank < 3 && (
              <p className="text-[12px] font-semibold text-[#D4AF37] mt-1">
                You earned {REWARD_BADGES[myRank].points} points!
              </p>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center">
          <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-[#6B7280] text-center py-6">
          {status === 'upcoming' ? 'Leaderboard opens when the challenge starts' : 'No one has joined yet'}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.slice(0, 10).map((e, i) => {
            const isMe = e.id === myId;
            const top = entries[0]?.score || 1;
            return (
              <div key={e.id}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-[14px] overflow-hidden transition-colors ${
                  isMe
                    ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30'
                    : 'bg-[#111827] border border-white/6'
                }`}
              >
                <div
                  className="absolute inset-0 opacity-[0.08]"
                  style={{ width: `${(e.score / top) * 100}%`, background: isMe ? '#D4AF37' : '#6B7280' }}
                />
                <span className={`text-[14px] font-bold w-6 text-center relative z-10 ${
                  i === 0 ? 'text-[#D4AF37]' : i === 1 ? 'text-[#9CA3AF]' : i === 2 ? 'text-[#D4AF37]/70' : 'text-[#6B7280]'
                }`}>
                  {i < 3 ? MEDAL[i] : i + 1}
                </span>
                <p className={`flex-1 text-[14px] font-semibold truncate relative z-10 ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                  {e.name}{isMe && <span className="ml-1.5 text-[10px] font-bold text-[#D4AF37]">YOU</span>}
                </p>
                <p className={`text-[13px] font-bold relative z-10 ${isMe ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'}`}>
                  {e.score.toLocaleString()} <span className="text-[11px] font-medium text-[#6B7280]">{unit}</span>
                </p>
                {status === 'ended' && i < 3 && (
                  <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded-full relative z-10 flex-shrink-0">
                    {REWARD_BADGES[i].label}
                  </span>
                )}
              </div>
            );
          })}
          {entries.length > 10 && myRank >= 10 && myEntry && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-[14px] bg-[#D4AF37]/10 border border-[#D4AF37]/30">
              <span className="text-[14px] font-bold w-6 text-center text-[#D4AF37]">#{myRank + 1}</span>
              <p className="flex-1 text-[14px] font-semibold text-[#D4AF37] truncate">
                {myEntry.name} <span className="ml-1.5 text-[10px] font-bold text-[#D4AF37]">YOU</span>
              </p>
              <p className="text-[13px] font-bold text-[#D4AF37]">
                {myEntry.score.toLocaleString()} <span className="text-[11px] font-medium text-[#D4AF37]/70">{unit}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Daily Challenge ───────────────────────────────────────
const DAILY_CHALLENGES = [
  { name: 'Volume Crusher',    desc: 'Hit 10,000 lbs total volume today',     target: 10000, unit: 'lbs',       metric: 'volume'      },
  { name: 'Rep Master',        desc: 'Complete 100 total reps today',          target: 100,   unit: 'reps',      metric: 'reps'        },
  { name: 'Iron Will',         desc: 'Log at least 3 exercises today',         target: 3,     unit: 'exercises', metric: 'exercises'   },
  { name: 'Speed Demon',       desc: 'Finish a workout in under 30 minutes',  target: 1,     unit: 'workout',   metric: 'speed'       },
  { name: 'Consistency King',  desc: 'Check in at the gym today',             target: 1,     unit: 'check-in',  metric: 'checkin'     },
  { name: 'PR Hunter',         desc: 'Hit a new personal record today',        target: 1,     unit: 'PR',        metric: 'pr'          },
  { name: 'Early Bird',        desc: 'Complete a workout before noon',         target: 1,     unit: 'workout',   metric: 'early'       },
];

function seededIndex(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % DAILY_CHALLENGES.length;
}

const DailyChallenge = ({ userId, gymId }) => {
  const today = new Date();
  const dateString = format(today, 'yyyy-MM-dd');
  const todayStart = startOfDay(today).toISOString();
  const challenge = DAILY_CHALLENGES[seededIndex(dateString)];
  const storageKey = `daily_challenge_${userId}_${dateString}`;

  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(() => localStorage.getItem(storageKey) === 'true');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || completed) { setLoading(false); return; }

    const fetchProgress = async () => {
      try {
        let value = 0;

        if (challenge.metric === 'volume') {
          const { data: sets } = await supabase
            .from('workout_sets')
            .select('weight_kg, reps, workout_sessions!inner(profile_id, completed_at, status)')
            .eq('workout_sessions.profile_id', userId)
            .eq('workout_sessions.status', 'completed')
            .gte('workout_sessions.completed_at', todayStart)
            .eq('completed', true);
          value = (sets || []).reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);

        } else if (challenge.metric === 'reps') {
          const { data: sets } = await supabase
            .from('workout_sets')
            .select('reps, workout_sessions!inner(profile_id, completed_at, status)')
            .eq('workout_sessions.profile_id', userId)
            .eq('workout_sessions.status', 'completed')
            .gte('workout_sessions.completed_at', todayStart)
            .eq('completed', true);
          value = (sets || []).reduce((sum, s) => sum + (s.reps ?? 0), 0);

        } else if (challenge.metric === 'exercises') {
          const { data: sets } = await supabase
            .from('workout_sets')
            .select('exercise_id, workout_sessions!inner(profile_id, completed_at, status)')
            .eq('workout_sessions.profile_id', userId)
            .eq('workout_sessions.status', 'completed')
            .gte('workout_sessions.completed_at', todayStart)
            .eq('completed', true);
          const unique = new Set((sets || []).map(s => s.exercise_id));
          value = unique.size;

        } else if (challenge.metric === 'speed') {
          const { data: sessions } = await supabase
            .from('workout_sessions')
            .select('started_at, completed_at')
            .eq('profile_id', userId)
            .eq('status', 'completed')
            .gte('completed_at', todayStart);
          const fast = (sessions || []).some(s => {
            if (!s.started_at || !s.completed_at) return false;
            return (new Date(s.completed_at) - new Date(s.started_at)) < 30 * 60 * 1000;
          });
          value = fast ? 1 : 0;

        } else if (challenge.metric === 'checkin') {
          const { count } = await supabase
            .from('check_ins')
            .select('id', { count: 'exact', head: true })
            .eq('profile_id', userId)
            .gte('created_at', todayStart);
          value = count ?? 0;

        } else if (challenge.metric === 'pr') {
          const { count } = await supabase
            .from('personal_records')
            .select('id', { count: 'exact', head: true })
            .eq('profile_id', userId)
            .gte('achieved_at', todayStart);
          value = count ?? 0;

        } else if (challenge.metric === 'early') {
          const noonToday = new Date(today);
          noonToday.setHours(12, 0, 0, 0);
          const { count } = await supabase
            .from('workout_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('profile_id', userId)
            .eq('status', 'completed')
            .gte('completed_at', todayStart)
            .lt('completed_at', noonToday.toISOString());
          value = count ?? 0;
        }

        setProgress(value);

        if (value >= challenge.target && !completed) {
          localStorage.setItem(storageKey, 'true');
          setCompleted(true);
          addPoints(userId, gymId, 'workout_completed', 25, 'Daily challenge completed').catch(() => {});
        }
      } catch (_) {
        // silently fail
      } finally {
        setLoading(false);
      }
    };

    fetchProgress();
  }, [userId, gymId, challenge, todayStart, completed, storageKey]);

  const pct = Math.min((progress / challenge.target) * 100, 100);
  const progressLabel = challenge.target >= 1000
    ? `${progress.toLocaleString()} / ${challenge.target.toLocaleString()} ${challenge.unit}`
    : `${progress} / ${challenge.target} ${challenge.unit}`;

  return (
    <div className="rounded-[14px] bg-gradient-to-r from-[#0F172A] to-[#1a1a2e] border border-[#D4AF37]/20 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest">Daily Challenge</p>
        <span className="text-[10px] text-[#6B7280] font-medium">{format(today, 'MMM d')}</span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-[12px] bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
          {completed
            ? <Check size={20} className="text-emerald-400" strokeWidth={2.5} />
            : <Flame size={20} className="text-[#D4AF37]" strokeWidth={2} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-bold text-[#E5E7EB]">{challenge.name}</p>
          <p className="text-[13px] text-[#9CA3AF] mt-0.5">{challenge.desc}</p>
        </div>
      </div>

      {completed ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Check size={16} className="text-emerald-400" strokeWidth={2.5} />
          <span className="text-[14px] font-semibold text-emerald-400">Completed! +25 pts</span>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] text-[#9CA3AF] font-medium">{loading ? '...' : progressLabel}</span>
            <span className="text-[12px] text-[#6B7280] font-medium">{Math.round(pct)}%</span>
          </div>
          <div className="h-2 bg-[#1E293B] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#D4AF37] rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
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
    live:     'text-emerald-400 bg-emerald-500/10',
    upcoming: 'text-blue-400 bg-blue-500/10',
    ended:    'text-[#6B7280] bg-white/6',
  }[status];

  const statusLabel = { live: 'Live', upcoming: 'Upcoming', ended: 'Ended' }[status];

  const handleJoin = async (e) => {
    e.stopPropagation();
    setJoining(true);
    await onJoin(challenge.id);
    setJoining(false);
  };

  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-white/[0.02] active:bg-white/[0.04] transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
      >
        <div className="w-12 h-12 rounded-[14px] bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
          <Icon size={22} className="text-[#D4AF37]" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <p className="text-[16px] font-semibold text-[#E5E7EB] truncate">{challenge.name}</p>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[12px] text-[#9CA3AF]">{meta.label}</span>
            {participantCount > 0 && (
              <>
                <span className="text-[#6B7280]">·</span>
                <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
                  <Users size={12} /> {participantCount}
                </span>
              </>
            )}
            <span className="text-[#6B7280]">·</span>
            {status === 'live' && <Countdown date={challenge.end_date} prefix="Ends in" />}
            {status === 'upcoming' && <Countdown date={challenge.start_date} prefix="Starts in" />}
            {status === 'ended' && (
              <span className="text-[12px] text-[#9CA3AF]">
                Ended {format(new Date(challenge.end_date), 'MMM d')}
              </span>
            )}
          </div>
        </div>

        {/* Join / Joined for live + upcoming */}
        {status !== 'ended' && (
          joined ? (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-500/10">
              <Check size={14} strokeWidth={2.5} /> In
            </span>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining}
              className="flex-shrink-0 px-4 py-2 rounded-xl text-[13px] font-bold transition-all active:scale-95 disabled:opacity-50 bg-[#D4AF37] text-black hover:bg-[#E6C766] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
            >
              {joining ? '…' : 'Join'}
            </button>
          )
        )}

        <ChevronDown size={20} className={`text-[#6B7280] flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-white/6 bg-[#111827]/50">
          {challenge.description && (
            <p className="text-[14px] text-[#9CA3AF] leading-relaxed mt-4">{challenge.description}</p>
          )}
          <div className="mt-3 text-[12px] text-[#6B7280] font-medium">
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

export default function Challenges({ embedded = false }) {
  const { profile, user } = useAuth();
  const [challenges, setChallenges]       = useState([]);
  const [participants, setParticipants]   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [tab, setTab]                     = useState('live');
  const swipe = useSwipeTabs(TABS, tab, setTab);

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

    // Score starts at 0 — the DB trigger enforces this to prevent score injection.
    // Scores are updated server-side as workouts/PRs are logged.
    const { data, error } = await supabase
      .from('challenge_participants')
      .insert({ challenge_id: challengeId, profile_id: user.id, gym_id: profile.gym_id, score: 0 })
      .select('challenge_id, profile_id, score')
      .single();
    if (!error && data) {
      setParticipants(prev => [...prev, data]);
      addPoints(user.id, profile.gym_id, 'challenge_joined', 25, 'Joined a challenge').catch(() => {});
    }
  };

  const myJoinedIds = new Set(participants.filter(p => p.profile_id === user?.id).map(p => p.challenge_id));
  const countMap = participants.reduce((acc, p) => {
    acc[p.challenge_id] = (acc[p.challenge_id] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = challenges.filter(c => statusOf(c) === tab);
  const liveCount = challenges.filter(c => statusOf(c) === 'live').length;

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[#05070B] pb-28 md:pb-12'}`}>
      {/* Header */}
      {!embedded && (
      <div className="sticky top-0 z-20 bg-[#05070B]/95 backdrop-blur-xl border-b border-white/6">
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-[14px] bg-[#D4AF37]/10 flex items-center justify-center">
              <Trophy size={24} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[#E5E7EB] tracking-tight">Challenges</h1>
              <p className="text-[13px] text-[#9CA3AF] mt-0.5">Compete with your gym</p>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Tab bar — always visible */}
      <div className={`${embedded ? 'pt-2 pb-3' : 'max-w-2xl mx-auto px-4'}`}>
        {!embedded && <div className="h-0" />}
        <div className="flex gap-1 bg-[#111827] p-1 rounded-xl">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold capitalize transition-all ${
                tab === t
                  ? 'bg-[#D4AF37] text-black font-semibold'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              {t}
              {t === 'live' && liveCount > 0 && (
                <span className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[11px] font-bold ${
                  tab === t ? 'bg-black/20 text-black' : 'bg-white/10 text-[#9CA3AF]'
                }`}>
                  {liveCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={`${embedded ? '' : 'max-w-2xl mx-auto px-4 py-6'}`} {...swipe}>
        {user?.id && profile?.gym_id && (
          <DailyChallenge userId={user.id} gymId={profile.gym_id} />
        )}
        {loading ? (
          <div className="flex justify-center py-28">
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 px-6">
            <div className="w-16 h-16 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-4">
              <Trophy size={32} className="text-[#6B7280]" />
            </div>
            <p className="text-[16px] font-semibold text-[#E5E7EB]">
              {tab === 'live'     && 'No active challenges right now'}
              {tab === 'upcoming' && 'No upcoming challenges'}
              {tab === 'ended'    && 'No past challenges'}
            </p>
            {tab === 'live' && (
              <p className="text-[14px] text-[#9CA3AF] mt-2">Your gym admin will post challenges here</p>
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
