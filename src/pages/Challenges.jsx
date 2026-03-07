import { useEffect, useState, useCallback } from 'react';
import { Trophy, Clock, ChevronDown, Zap, Dumbbell, Star } from 'lucide-react';
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
    <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF]">
      <Clock size={11} /> {prefix} {label}
    </span>
  );
};

// ── Leaderboard ────────────────────────────────────────────
const Leaderboard = ({ challenge, gymId, myId }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (challenge.type === 'consistency' || challenge.type === 'volume') {
      const { data } = await supabase
        .from('workout_sessions')
        .select('profile_id, total_volume_lbs, profiles(full_name)')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', challenge.start_date)
        .lte('started_at', challenge.end_date);

      const agg = {};
      (data || []).forEach(s => {
        if (!agg[s.profile_id]) agg[s.profile_id] = { name: s.profiles?.full_name ?? '—', count: 0, volume: 0 };
        agg[s.profile_id].count++;
        agg[s.profile_id].volume += parseFloat(s.total_volume_lbs || 0);
      });

      setEntries(
        Object.entries(agg)
          .map(([id, v]) => ({
            id,
            name:  v.name,
            score: challenge.type === 'volume' ? Math.round(v.volume) : v.count,
          }))
          .sort((a, b) => b.score - a.score)
      );
    } else if (challenge.type === 'pr_count') {
      const { data } = await supabase
        .from('pr_history')
        .select('profile_id, profiles(full_name)')
        .eq('gym_id', gymId)
        .gte('achieved_at', challenge.start_date)
        .lte('achieved_at', challenge.end_date);

      const agg = {};
      (data || []).forEach(r => {
        if (!agg[r.profile_id]) agg[r.profile_id] = { name: r.profiles?.full_name ?? '—', score: 0 };
        agg[r.profile_id].score++;
      });
      setEntries(
        Object.entries(agg)
          .map(([id, v]) => ({ id, ...v }))
          .sort((a, b) => b.score - a.score)
      );
    }
    setLoading(false);
  }, [challenge, gymId]);

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
    <div className="mt-3">
      {/* My rank callout */}
      {myEntry && (
        <div className="flex items-center justify-between bg-[#D4AF37]/8 border border-[#D4AF37]/20 rounded-xl px-4 py-2.5 mb-3">
          <div>
            <p className="text-[11px] text-[#D4AF37] font-semibold uppercase tracking-wider">Your rank</p>
            <p className="text-[22px] font-black text-[#D4AF37] leading-tight">
              #{myRank + 1}
              {myRank < 3 && <span className="ml-1.5 text-[18px]">{MEDAL[myRank]}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#9CA3AF]">Your score</p>
            <p className="text-[18px] font-bold text-[#E5E7EB]">
              {myEntry.score.toLocaleString()} <span className="text-[13px] font-normal text-[#6B7280]">{unit}</span>
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-6 flex justify-center">
          <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-[#6B7280] text-center py-4">
          {statusOf(challenge) === 'upcoming' ? 'Leaderboard opens when the challenge starts' : 'No activity logged yet'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.slice(0, 10).map((e, i) => {
            const isMe = e.id === myId;
            const top = entries[0]?.score || 1;
            return (
              <div key={e.id}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl overflow-hidden transition-colors ${
                  isMe ? 'bg-[#D4AF37]/8 border border-[#D4AF37]/20' : 'bg-[#111827]'
                }`}
              >
                {/* progress bar bg */}
                <div
                  className="absolute inset-0 opacity-10"
                  style={{ width: `${(e.score / top) * 100}%`, background: isMe ? '#D4AF37' : '#4B5563' }}
                />
                <span className={`text-[13px] font-bold w-5 text-center relative z-10 ${
                  i === 0 ? 'text-[#D4AF37]' : i === 1 ? 'text-[#9CA3AF]' : i === 2 ? 'text-amber-700' : 'text-[#4B5563]'
                }`}>
                  {i < 3 ? MEDAL[i] : i + 1}
                </span>
                <p className={`flex-1 text-[13px] font-medium truncate relative z-10 ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                  {e.name}{isMe && <span className="ml-1.5 text-[10px] font-bold opacity-70">YOU</span>}
                </p>
                <p className={`text-[12px] font-semibold relative z-10 ${isMe ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'}`}>
                  {e.score.toLocaleString()} <span className="text-[10px] opacity-70">{unit}</span>
                </p>
              </div>
            );
          })}
          {entries.length > 10 && myRank >= 10 && myEntry && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#D4AF37]/8 border border-[#D4AF37]/20">
              <span className="text-[13px] font-bold w-5 text-center text-[#D4AF37]">#{myRank + 1}</span>
              <p className="flex-1 text-[13px] font-medium text-[#D4AF37] truncate">
                {myEntry.name} <span className="text-[10px] font-bold opacity-70">YOU</span>
              </p>
              <p className="text-[12px] font-semibold text-[#D4AF37]">
                {myEntry.score.toLocaleString()} <span className="text-[10px] opacity-70">{unit}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Challenge card ─────────────────────────────────────────
const ChallengeCard = ({ challenge, gymId, myId }) => {
  const [open, setOpen] = useState(false);
  const status = statusOf(challenge);
  const meta = TYPE_META[challenge.type] ?? {};
  const Icon = meta.icon ?? Trophy;

  const statusStyle = {
    live:     'text-emerald-400 bg-emerald-500/10',
    upcoming: 'text-blue-400 bg-blue-500/10',
    ended:    'text-[#6B7280] bg-white/6',
  }[status];

  const statusLabel = { live: 'Live', upcoming: 'Upcoming', ended: 'Ended' }[status];

  return (
    <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/2 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
          <Icon size={18} className="text-[#D4AF37]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{challenge.name}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-[#6B7280]">{meta.label}</span>
            <span className="text-[#4B5563]">·</span>
            {status === 'live' && <Countdown date={challenge.end_date} prefix="Ends in" />}
            {status === 'upcoming' && <Countdown date={challenge.start_date} prefix="Starts in" />}
            {status === 'ended' && (
              <span className="text-[11px] text-[#6B7280]">
                Ended {format(new Date(challenge.end_date), 'MMM d')}
              </span>
            )}
          </div>
        </div>
        <ChevronDown size={16} className={`text-[#6B7280] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/4">
          {challenge.description && (
            <p className="text-[12px] text-[#9CA3AF] mt-3">{challenge.description}</p>
          )}
          <div className="mt-3 text-[11px] text-[#6B7280]">
            {format(new Date(challenge.start_date), 'MMM d')} – {format(new Date(challenge.end_date), 'MMM d, yyyy')}
          </div>
          <Leaderboard challenge={challenge} gymId={gymId} myId={myId} />
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────
const TABS = ['live', 'upcoming', 'ended'];

export default function Challenges() {
  const { profile, user } = useAuth();
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('live');

  useEffect(() => {
    if (!profile?.gym_id) return;
    supabase
      .from('challenges')
      .select('*')
      .eq('gym_id', profile.gym_id)
      .order('start_date', { ascending: false })
      .then(({ data }) => {
        setChallenges(data || []);
        setLoading(false);
      });
  }, [profile?.gym_id]);

  const filtered = challenges.filter(c => statusOf(c) === tab);

  return (
    <div className="min-h-screen bg-[#05070B] pb-24 md:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#05070B]/95 backdrop-blur-xl border-b border-white/6">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center">
              <Trophy size={18} className="text-[#D4AF37]" />
            </div>
            <div>
              <h1 className="text-[18px] font-bold text-[#E5E7EB]">Challenges</h1>
              <p className="text-[12px] text-[#6B7280]">Compete with your gym</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white/4 p-1 rounded-xl">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold capitalize transition-all ${
                  tab === t
                    ? 'bg-[#D4AF37] text-black'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                {t}
                {t === 'live' && challenges.filter(c => statusOf(c) === 'live').length > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-black/20 text-[10px] font-bold">
                    {challenges.filter(c => statusOf(c) === 'live').length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-24">
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Trophy size={32} className="text-[#4B5563] mx-auto mb-3" />
            <p className="text-[14px] text-[#6B7280]">
              {tab === 'live'     && 'No active challenges right now'}
              {tab === 'upcoming' && 'No upcoming challenges'}
              {tab === 'ended'    && 'No past challenges'}
            </p>
            {tab === 'live' && (
              <p className="text-[12px] text-[#4B5563] mt-1">Your gym admin will post challenges here</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(c => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                gymId={profile.gym_id}
                myId={user.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
