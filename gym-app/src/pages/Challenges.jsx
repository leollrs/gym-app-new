import { useEffect, useState, useCallback, useRef } from 'react';
import { Trophy, Clock, ChevronDown, Zap, Dumbbell, Star, Users, Check, Flame, Gift } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { format, isPast, isFuture, formatDistanceToNow, startOfDay } from 'date-fns';
import { addPoints } from '../lib/rewardsEngine';
import SwipeableTabView from '../components/SwipeableTabView';
import UnderlineTabs from '../components/UnderlineTabs';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { sanitize } from '../lib/sanitize';
import { DAILY_CHALLENGES, seededIndex } from '../lib/dailyChallenges';

// ── Helpers ────────────────────────────────────────────────
const statusOf = (c) => {
  if (isFuture(new Date(c.start_date))) return 'upcoming';
  if (isPast(new Date(c.end_date)))     return 'ended';
  return 'live';
};

const TYPE_META = {
  consistency: { labelKey: 'consistency', icon: Dumbbell, unitKey: 'consistency' },
  volume:      { labelKey: 'volume',      icon: Zap,     unitKey: 'volume'      },
  pr_count:    { labelKey: 'pr_count',    icon: Star,    unitKey: 'pr_count'    },
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
    <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
      <Clock size={11} /> {prefix} {label}
    </span>
  );
};

// ── Participant List (upcoming challenges only) ─────────────
const ParticipantList = ({ challengeId, t }) => {
  const [names, setNames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('challenge_participants')
      .select('profiles(full_name)')
      .eq('challenge_id', challengeId)
      .limit(100)
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
    <p className="text-[13px] text-[var(--color-text-muted)] text-center py-5">{t('challenges.noOneJoinedFirst')}</p>
  );

  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">{t('challenges.signedUp')}</p>
      {names.map((name, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)]">
          <div className="w-8 h-8 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[12px] font-bold text-[#D4AF37]">{name[0]}</span>
          </div>
          <p className="text-[14px] font-medium text-[var(--color-text-primary)]">{name}</p>
        </div>
      ))}
    </div>
  );
};

// ── Helpers for reward parsing ──────────────────────────────
const DEFAULT_REWARDS = [
  { place: '1st', points: 500, prize: null },
  { place: '2nd', points: 300, prize: null },
  { place: '3rd', points: 150, prize: null },
];

function parseRewards(challenge) {
  try {
    const parsed = challenge.reward_description ? JSON.parse(challenge.reward_description) : null;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_REWARDS;
}

// ── Leaderboard ────────────────────────────────────────────
const Leaderboard = ({ challenge, gymId, myId, t }) => {
  const rewards = parseRewards(challenge);
  const hasCustomRewards = challenge.reward_description != null;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const status = statusOf(challenge);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('challenge_participants')
      .select('profile_id, score, profiles(full_name)')
      .eq('challenge_id', challenge.id)
      .order('score', { ascending: false })
      .limit(100);

    setEntries(
      (data || []).map(p => ({
        id:    p.profile_id,
        name:  p.profiles?.full_name ?? '—',
        score: Math.round(p.score ?? 0),
      }))
    );
    setLoading(false);
  }, [challenge.id]);

  // Debounce realtime updates to avoid re-fetching on every single workout INSERT
  const debounceRef = useRef(null);
  useEffect(() => {
    fetch();
    const ch = supabase.channel(`member-challenge-${challenge.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workout_sessions', filter: `gym_id=eq.${gymId}` }, () => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(fetch, 2000);
      })
      .subscribe();
    return () => {
      clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [fetch, challenge.id, gymId]);

  const unit = t(`challenges.typeUnits.${TYPE_META[challenge.type]?.unitKey ?? challenge.type}`, TYPE_META[challenge.type]?.unitKey ?? '');
  const myRank = entries.findIndex(e => e.id === myId);
  const myEntry = entries[myRank];

  return (
    <div className="mt-4">
      {/* My rank callout */}
      {myEntry && (
        <div className="flex items-center justify-between rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 px-5 py-4 mb-4">
          <div>
            <p className="text-[11px] text-[#D4AF37] font-semibold uppercase tracking-widest">{t('challenges.yourRank')}</p>
            <p className="text-[24px] font-bold text-[#D4AF37] leading-tight mt-0.5 tabular-nums">
              #{myRank + 1}
              {myRank < 3 && <span className="ml-1.5 text-[20px]">{MEDAL[myRank]}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[var(--color-text-muted)] font-medium">{t('challenges.yourScore')}</p>
            <p className="text-[18px] font-bold text-[var(--color-text-primary)] mt-0.5">
              {myEntry.score.toLocaleString()} <span className="text-[13px] font-normal text-[var(--color-text-muted)]">{unit}</span>
            </p>
            {status === 'ended' && myRank < 3 && rewards[myRank] && (
              <div className="mt-1">
                <p className="text-[12px] font-semibold text-[#D4AF37]">
                  {t('challenges.youEarned', { points: rewards[myRank].points })}
                </p>
                {rewards[myRank].prize && (
                  <p className="text-[11px] text-[#D4AF37]/80">+ {sanitize(rewards[myRank].prize)}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center">
          <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-6">
          {status === 'upcoming' ? t('challenges.leaderboardOpens') : t('challenges.noOneJoined')}
        </p>
      ) : (
        <div className="space-y-3">
          {entries.slice(0, 10).map((e, i) => {
            const isMe = e.id === myId;
            const top = entries[0]?.score || 1;
            const barPct = Math.max((e.score / top) * 100, 2);
            const isDark = document.documentElement.classList.contains('dark');
            const silver = isDark ? '#9CA3AF' : '#6B7280';
            const base   = isDark ? '#4B5563' : '#374151';
            const barColor = isMe ? '#D4AF37' : i === 0 ? '#D4AF37' : i === 1 ? silver : i === 2 ? '#CD7F32' : base;
            return (
              <div key={e.id}
                className={`relative flex items-center gap-4 px-4 py-4 rounded-2xl overflow-hidden transition-colors ${
                  isMe
                    ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30'
                    : 'bg-[var(--color-bg-card)] border border-[var(--color-border)]'
                }`}
              >
                {/* Score bar background */}
                <div
                  className="absolute left-0 top-0 bottom-0 rounded-2xl opacity-[0.07]"
                  style={{ width: `${barPct}%`, background: barColor }}
                />
                {/* Rank */}
                <div className="relative z-10 flex-shrink-0 w-8 text-center">
                  {i < 3 ? (
                    <span className="text-[22px] leading-none">{MEDAL[i]}</span>
                  ) : (
                    <span className="text-[16px] font-bold text-[var(--color-text-muted)] tabular-nums">{i + 1}</span>
                  )}
                </div>
                {/* Name */}
                <p className={`flex-1 text-[14px] font-semibold truncate relative z-10 ${isMe ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>
                  {e.name}{isMe && <span className="ml-1.5 text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full">{t('challenges.you')}</span>}
                </p>
                {/* Score */}
                <div className="relative z-10 text-right flex-shrink-0">
                  <span className={`text-[14px] font-bold ${isMe ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>
                    {e.score.toLocaleString()}
                  </span>
                  <span className="text-[11px] font-medium text-[var(--color-text-muted)] ml-1">{unit}</span>
                </div>
                {status === 'ended' && i < 3 && rewards[i] && (
                  <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded-full relative z-10 flex-shrink-0">
                    {rewards[i].prize ? `${rewards[i].points} pts + ${sanitize(rewards[i].prize)}` : `${MEDAL[i]} ${rewards[i].points} pts`}
                  </span>
                )}
              </div>
            );
          })}
          {entries.length > 10 && myRank >= 10 && myEntry && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/30">
              <span className="text-[14px] font-bold w-6 text-center text-[#D4AF37]">#{myRank + 1}</span>
              <p className="flex-1 text-[14px] font-semibold text-[#D4AF37] truncate">
                {myEntry.name} <span className="ml-1.5 text-[10px] font-bold text-[#D4AF37]">{t('challenges.you')}</span>
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
// DAILY_CHALLENGES and seededIndex imported from ../lib/dailyChallenges

const DailyChallenge = ({ userId, gymId, t }) => {
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
            .from('session_sets')
            .select('weight_lbs, reps, session_exercises!inner(exercise_id, workout_sessions!inner(profile_id, completed_at, status))')
            .eq('session_exercises.workout_sessions.profile_id', userId)
            .eq('session_exercises.workout_sessions.status', 'completed')
            .gte('session_exercises.workout_sessions.completed_at', todayStart)
            .eq('is_completed', true);
          value = (sets || []).reduce((sum, s) => sum + (s.weight_lbs ?? 0) * (s.reps ?? 0), 0);

        } else if (challenge.metric === 'reps') {
          const { data: sets } = await supabase
            .from('session_sets')
            .select('reps, session_exercises!inner(workout_sessions!inner(profile_id, completed_at, status))')
            .eq('session_exercises.workout_sessions.profile_id', userId)
            .eq('session_exercises.workout_sessions.status', 'completed')
            .gte('session_exercises.workout_sessions.completed_at', todayStart)
            .eq('is_completed', true);
          value = (sets || []).reduce((sum, s) => sum + (s.reps ?? 0), 0);

        } else if (challenge.metric === 'exercises') {
          const { data: sets } = await supabase
            .from('session_sets')
            .select('session_exercises!inner(exercise_id, workout_sessions!inner(profile_id, completed_at, status))')
            .eq('session_exercises.workout_sessions.profile_id', userId)
            .eq('session_exercises.workout_sessions.status', 'completed')
            .gte('session_exercises.workout_sessions.completed_at', todayStart)
            .eq('is_completed', true);
          const unique = new Set((sets || []).map(s => s.session_exercises?.exercise_id));
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
    <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[#D4AF37]/20 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest">{t('challenges.dailyChallenge')}</p>
        <span className="text-[10px] text-[var(--color-text-muted)] font-medium">{format(today, 'MMM d')}</span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-[12px] bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
          {completed
            ? <Check size={20} className="text-emerald-400" strokeWidth={2.5} />
            : <Flame size={20} className="text-[#D4AF37]" strokeWidth={2} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-bold text-[var(--color-text-primary)]">{challenge.nameKey ? t(`challenges.dailyChallengeNames.${challenge.nameKey}`, sanitize(challenge.name)) : sanitize(challenge.name)}</p>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{challenge.descKey ? t(`challenges.dailyChallengeDescs.${challenge.descKey}`, challenge.desc) : challenge.desc}</p>
        </div>
      </div>

      {completed ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Check size={16} className="text-emerald-400" strokeWidth={2.5} />
          <span className="text-[14px] font-semibold text-emerald-400">{t('challenges.completed')}</span>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] text-[var(--color-text-muted)] font-medium">{loading ? '...' : progressLabel}</span>
            <span className="text-[12px] text-[var(--color-text-muted)] font-medium">{Math.round(pct)}%</span>
          </div>
          <div className="h-2 bg-[var(--color-bg-secondary)] rounded-full overflow-hidden">
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
const ChallengeCard = ({ challenge, gymId, myId, joined, participantCount, onJoin, onLeave, t }) => {
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const status = statusOf(challenge);
  const meta = TYPE_META[challenge.type] ?? {};
  const Icon = meta.icon ?? Trophy;
  const cardRewards = parseRewards(challenge);
  const hasRewards = challenge.reward_description != null;

  const statusStyle = {
    live:     'text-emerald-400 bg-emerald-500/10',
    upcoming: 'text-blue-400 bg-blue-500/10',
    ended:    'text-[var(--color-text-muted)] bg-white/[0.06]',
  }[status];

  const statusLabel = t(`challenges.tabs.${status}`);

  const handleJoin = async (e) => {
    e.stopPropagation();
    setJoining(true);
    await onJoin(challenge.id);
    setJoining(false);
  };

  const handleLeave = async (e) => {
    e.stopPropagation();
    if (!window.confirm(t('challenges.leaveConfirm'))) return;
    setLeaving(true);
    await onLeave(challenge.id);
    setLeaving(false);
  };

  return (
    <div className="bg-white/[0.04] rounded-2xl border border-[var(--color-border)] overflow-hidden hover:bg-white/[0.06] transition-colors duration-200">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-white/[0.06] active:bg-white/[0.06] transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
      >
        <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
          <Icon size={22} className="text-[#D4AF37]" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <p className="text-[16px] font-semibold text-[var(--color-text-primary)] truncate">{sanitize(challenge.name)}</p>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[12px] text-[var(--color-text-muted)]">{t(`challenges.typeLabels.${meta.labelKey ?? challenge.type}`, meta.labelKey ?? '')}</span>
            {participantCount > 0 && (
              <>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
                  <Users size={12} /> {participantCount}
                </span>
              </>
            )}
            {hasRewards && (
              <>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="flex items-center gap-1 text-[11px] text-[#D4AF37] font-medium">
                  <Gift size={11} /> {t('challenges.rewards')}
                </span>
              </>
            )}
            <span className="text-[var(--color-text-muted)]">·</span>
            {status === 'live' && <Countdown date={challenge.end_date} prefix={t('challenges.endsIn')} />}
            {status === 'upcoming' && <Countdown date={challenge.start_date} prefix={t('challenges.startsIn')} />}
            {status === 'ended' && (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {t('challenges.ended', { date: format(new Date(challenge.end_date), 'MMM d') })}
              </span>
            )}
          </div>
        </div>

        {/* Join / Leave for live + upcoming */}
        {status !== 'ended' && (
          joined ? (
            <button
              type="button"
              onClick={handleLeave}
              disabled={leaving}
              className="flex items-center gap-1 text-[10px] font-semibold flex-shrink-0 px-2.5 py-1.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {leaving ? '...' : t('challenges.leave')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining}
              className="flex-shrink-0 px-4 py-2 rounded-xl text-[13px] font-bold transition-all active:scale-95 disabled:opacity-50 bg-[#D4AF37] text-black hover:bg-[#E6C766] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
            >
              {joining ? '…' : t('challenges.join')}
            </button>
          )
        )}

        <ChevronDown size={20} className={`text-[var(--color-text-muted)] flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-[var(--color-border)] bg-[var(--color-bg-card)]">
          {challenge.description && (
            <p className="text-[14px] text-[var(--color-text-muted)] leading-relaxed mt-4">{sanitize(challenge.description)}</p>
          )}
          <div className="mt-3 text-[12px] text-[var(--color-text-muted)] font-medium">
            {format(new Date(challenge.start_date), 'MMM d')} – {format(new Date(challenge.end_date), 'MMM d, yyyy')}
          </div>

          {/* Rewards section */}
          {hasRewards && (
            <div className="mt-4 rounded-2xl bg-gradient-to-r from-[#D4AF37]/5 to-[#D4AF37]/10 border border-[#D4AF37]/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Gift size={14} className="text-[#D4AF37]" />
                <p className="text-[12px] font-bold text-[#D4AF37] uppercase tracking-widest">{t('challenges.rewards')}</p>
              </div>
              <div className="space-y-2">
                {cardRewards.map((r, i) => {
                  const medals = ['🥇', '🥈', '🥉'];
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[18px]">{medals[i]}</span>
                      <div className="flex-1">
                        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{r.points} pts</span>
                        {r.prize && <span className="text-[13px] text-[#D4AF37] ml-2">+ {sanitize(r.prize)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {status === 'upcoming'
            ? <ParticipantList challengeId={challenge.id} t={t} />
            : <Leaderboard challenge={challenge} gymId={gymId} myId={myId} t={t} />
          }
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────
const TABS = ['live', 'upcoming', 'ended'];

export default function Challenges({ embedded = false }) {
  const { t } = useTranslation('pages');
  const { profile, user } = useAuth();
  const [challenges, setChallenges]       = useState([]);
  const [participants, setParticipants]   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [tab, setTab]                     = useState('live');
  const chalTabIndex = TABS.indexOf(tab);
  const handleChalSwipe = (i) => setTab(TABS[i]);

  useEffect(() => { document.title = 'Challenges | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.gym_id || !user?.id) return;

    const load = async () => {
      const [{ data: cData }, { data: pData }] = await Promise.all([
        supabase.from('challenges').select('id, name, description, type, start_date, end_date, reward_description, gym_id').eq('gym_id', profile.gym_id).order('start_date', { ascending: false }).limit(50),
        supabase.from('challenge_participants').select('challenge_id, profile_id, score').eq('gym_id', profile.gym_id).limit(500),
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

  const handleLeave = async (challengeId) => {
    const { error } = await supabase
      .from('challenge_participants')
      .delete()
      .eq('challenge_id', challengeId)
      .eq('profile_id', user.id);
    if (!error) {
      setParticipants(prev => prev.filter(p => !(p.challenge_id === challengeId && p.profile_id === user.id)));
    }
  };

  const myJoinedIds = new Set(participants.filter(p => p.profile_id === user?.id).map(p => p.challenge_id));
  const countMap = participants.reduce((acc, p) => {
    acc[p.challenge_id] = (acc[p.challenge_id] ?? 0) + 1;
    return acc;
  }, {});

  const liveCount = challenges.filter(c => statusOf(c) === 'live').length;

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[var(--color-bg-primary)] pb-32 md:pb-12'}`}>
      {/* Header */}
      {!embedded && (
      <div className="sticky top-0 z-20 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border-b border-[var(--color-border)]">
        <div className="max-w-[680px] md:max-w-4xl mx-auto px-4 pt-6 pb-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center">
              <Trophy size={24} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[28px] font-bold text-[var(--color-text-primary)] tracking-tight">{t('challenges.title')}</h1>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{t('challenges.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Tab bar — always visible */}
      <div className={`${embedded ? 'pt-2 pb-3' : 'max-w-[680px] md:max-w-4xl mx-auto px-4'}`}>
        {!embedded && <div className="h-0" />}
        <UnderlineTabs
          tabs={TABS.map(tabKey => ({
            key: tabKey,
            label: t(`challenges.tabs.${tabKey}`),
            count: tabKey === 'live' ? liveCount : null,
          }))}
          activeIndex={chalTabIndex}
          onChange={handleChalSwipe}
        />
      </div>

      <div className={`${embedded ? '' : 'max-w-[680px] md:max-w-4xl mx-auto px-4 py-6'}`}>
        {tab === 'live' && user?.id && profile?.gym_id && (
          <DailyChallenge userId={user.id} gymId={profile.gym_id} t={t} />
        )}
        {loading ? (
          <Skeleton variant="card" count={3} height="h-[90px]" />
        ) : (
          <SwipeableTabView activeIndex={chalTabIndex} onChangeIndex={handleChalSwipe} tabKeys={TABS}>
            {TABS.map(tabKey => {
              const items = challenges.filter(c => statusOf(c) === tabKey);
              return (
                <div key={tabKey}>
                  {items.length === 0 ? (
                    <EmptyState
                      icon={Trophy}
                      title={
                        tabKey === 'live'     ? t('challenges.noActiveChallenges') :
                        tabKey === 'upcoming' ? t('challenges.noUpcomingChallenges') :
                        t('challenges.noPastChallenges')
                      }
                      description={tabKey === 'live' ? t('challenges.adminPostsHere') : undefined}
                    />
                  ) : (
                    <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
                      {items.map(c => (
                        <ChallengeCard
                          key={c.id}
                          challenge={c}
                          gymId={profile.gym_id}
                          myId={user.id}
                          joined={myJoinedIds.has(c.id)}
                          participantCount={countMap[c.id] ?? 0}
                          onJoin={handleJoin}
                          onLeave={handleLeave}
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </SwipeableTabView>
        )}
      </div>
    </div>
  );
}
