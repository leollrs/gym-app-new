import { useEffect, useState, useCallback, useRef } from 'react';
import { Trophy, Clock, ChevronDown, Zap, Dumbbell, Star, Users, Check, Flame, Gift, Swords, CheckCircle2, XCircle, Target, UserPlus, Crown, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { format, isPast, isFuture, formatDistanceToNow, startOfDay, differenceInDays } from 'date-fns';
import { addPoints } from '../lib/rewardsEngine';
import { sendNotification, NOTIFICATION_TYPES } from '../lib/notifications';
import SwipeableTabView from '../components/SwipeableTabView';
import UnderlineTabs from '../components/UnderlineTabs';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { sanitize } from '../lib/sanitize';
import { useToast } from '../contexts/ToastContext';
import { DAILY_CHALLENGES, seededIndex } from '../lib/dailyChallenges';

// ── Helpers ────────────────────────────────────────────────
const statusOf = (c) => {
  if (isFuture(new Date(c.start_date))) return 'upcoming';
  if (isPast(new Date(c.end_date)))     return 'ended';
  return 'live';
};

const TYPE_META = {
  consistency:   { labelKey: 'consistency',   icon: Dumbbell, unitKey: 'consistency'   },
  volume:        { labelKey: 'volume',        icon: Zap,      unitKey: 'volume'        },
  pr_count:      { labelKey: 'pr_count',      icon: Star,     unitKey: 'pr_count'      },
  specific_lift: { labelKey: 'specific_lift', icon: Dumbbell, unitKey: 'specific_lift' },
  team:          { labelKey: 'team',          icon: Users,    unitKey: 'team'          },
  milestone:     { labelKey: 'milestone',     icon: Target,   unitKey: 'milestone'     },
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
    <div className="py-5 flex justify-center" role="status" aria-busy={true} aria-label={t('challenges.loading', 'Loading')}>
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
        <div key={`${name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)]">
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
        <div className="py-8 flex justify-center" role="status" aria-busy={true} aria-label={t('challenges.loading', 'Loading')}>
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
            const silver = isDark ? 'var(--color-text-muted)' : 'var(--color-text-subtle)';
            const base   = isDark ? 'var(--color-text-muted)' : '#374151';
            const barColor = isMe ? 'var(--color-accent)' : i === 0 ? 'var(--color-accent)' : i === 1 ? silver : i === 2 ? '#CD7F32' : base;
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

// ── Team Leaderboard ──────────────────────────────────────
const TeamLeaderboard = ({ challenge, gymId, myId, t }) => {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const status = statusOf(challenge);

  const fetchTeams = useCallback(async () => {
    const { data } = await supabase.rpc('get_team_leaderboard', { p_challenge_id: challenge.id });
    setTeams(data || []);
    setLoading(false);
  }, [challenge.id]);

  const debounceRef = useRef(null);
  useEffect(() => {
    fetchTeams();
    const ch = supabase.channel(`team-lb-${challenge.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workout_sessions', filter: `gym_id=eq.${gymId}` }, () => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(fetchTeams, 2000);
      })
      .subscribe();
    return () => { clearTimeout(debounceRef.current); supabase.removeChannel(ch); };
  }, [fetchTeams, challenge.id, gymId]);

  const myTeam = teams.find(team => team.members?.some(m => m.profile_id === myId));
  const metricLabel = t(`challenges.typeUnits.${challenge.scoring_metric || 'consistency'}`, '');

  return (
    <div className="mt-4">
      {myTeam && (
        <div className="flex items-center justify-between rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 px-5 py-4 mb-4">
          <div>
            <p className="text-[11px] text-[#D4AF37] font-semibold uppercase tracking-widest">{t('challenges.team.yourTeam', 'Your Team')}</p>
            <p className="text-[18px] font-bold text-[#D4AF37] leading-tight mt-0.5">{myTeam.team_name}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[var(--color-text-muted)] font-medium">{t('challenges.team.combinedScore', 'Combined Score')}</p>
            <p className="text-[18px] font-bold text-[var(--color-text-primary)] mt-0.5">
              {Math.round(myTeam.team_score).toLocaleString()} <span className="text-[13px] font-normal text-[var(--color-text-muted)]">{metricLabel}</span>
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center" role="status" aria-busy={true} aria-label={t('challenges.loading', 'Loading')}>
          <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : teams.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-6">{t('challenges.team.noTeamsYet', 'No teams yet')}</p>
      ) : (
        <div className="space-y-3">
          {teams.map((team, i) => {
            const isMyTeam = team.team_id === myTeam?.team_id;
            const isExpanded = expandedTeam === team.team_id;
            return (
              <div key={team.team_id}
                className={`rounded-2xl overflow-hidden transition-colors ${
                  isMyTeam ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30' : 'bg-[var(--color-bg-card)] border border-[var(--color-border)]'
                }`}>
                <button type="button" onClick={() => setExpandedTeam(isExpanded ? null : team.team_id)}
                  className="w-full flex items-center gap-4 px-4 py-4 text-left">
                  <div className="flex-shrink-0 w-8 text-center">
                    {i < 3 ? <span className="text-[22px]">{MEDAL[i]}</span> : <span className="text-[16px] font-bold text-[var(--color-text-muted)]">{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] font-semibold truncate ${isMyTeam ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>
                      {team.team_name}
                      {isMyTeam && <span className="ml-1.5 text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full">{t('challenges.you')}</span>}
                    </p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      <Users size={10} className="inline mr-1" />{team.member_count}/{challenge.team_size || '?'} {t('challenges.team.members', 'members')}
                    </p>
                  </div>
                  <p className={`text-[14px] font-bold flex-shrink-0 ${isMyTeam ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>
                    {Math.round(team.team_score).toLocaleString()} <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{metricLabel}</span>
                  </p>
                  <ChevronDown size={16} className={`text-[var(--color-text-muted)] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                {isExpanded && team.members && (
                  <div className="px-4 pb-4 space-y-2 border-t border-[var(--color-border)]">
                    {team.members.map(m => (
                      <div key={m.profile_id} className="flex items-center gap-3 px-3 py-2">
                        <div className="w-7 h-7 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                          {m.avatar_url ? <img src={m.avatar_url} alt={`${m.display_name || t('challenges.team.member', 'Team member')} avatar`} className="w-7 h-7 rounded-full object-cover" /> : <span className="text-[10px] font-bold text-[#D4AF37]">{(m.display_name || '?')[0]}</span>}
                        </div>
                        <p className={`flex-1 text-[13px] font-medium truncate ${m.profile_id === myId ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>{m.display_name || '—'}</p>
                        <p className="text-[12px] text-[var(--color-text-muted)]">{Math.round(m.score || 0).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Club / Milestone Leaderboard ──────────────────────────
const ClubLeaderboard = ({ challenge, gymId, myId, t }) => {
  const rewards = parseRewards(challenge);
  const hasCustomRewards = challenge.reward_description != null;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const status = statusOf(challenge);
  const threshold = challenge.milestone_target ? Number(challenge.milestone_target) : null;

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('challenge_participants')
      .select('profile_id, score, profiles(full_name)')
      .eq('challenge_id', challenge.id)
      .order('score', { ascending: false })
      .limit(100);
    setEntries((data || []).map(p => ({
      id: p.profile_id, name: p.profiles?.full_name ?? '—', score: Math.round(p.score ?? 0),
    })));
    setLoading(false);
  }, [challenge.id]);

  const debounceRef = useRef(null);
  useEffect(() => {
    fetch();
    const ch = supabase.channel(`club-lb-${challenge.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workout_sessions', filter: `gym_id=eq.${gymId}` }, () => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(fetch, 2000);
      })
      .subscribe();
    return () => { clearTimeout(debounceRef.current); supabase.removeChannel(ch); };
  }, [fetch, challenge.id, gymId]);

  const myEntry = entries.find(e => e.id === myId);
  const myRank = entries.findIndex(e => e.id === myId);
  const madeClub = myEntry && threshold && myEntry.score >= threshold;

  return (
    <div className="mt-4">
      {/* My progress card */}
      {myEntry && (
        <div className={`rounded-2xl px-5 py-4 mb-4 ${madeClub ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-[#D4AF37]/10 border border-[#D4AF37]/30'}`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-widest ${madeClub ? 'text-emerald-400' : 'text-[#D4AF37]'}`}>
                {madeClub ? t('challenges.club.achieved', 'Club Member!') : t('challenges.club.progress', 'Your Progress')}
              </p>
              <p className={`text-[24px] font-bold leading-tight mt-0.5 ${madeClub ? 'text-emerald-400' : 'text-[#D4AF37]'}`}>
                {myEntry.score.toLocaleString()} <span className="text-[14px] font-normal">lbs</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-[var(--color-text-muted)]">#{myRank + 1} {t('challenges.club.overall', 'overall')}</p>
              {madeClub && <span className="text-[20px]">🏆</span>}
            </div>
          </div>
          {threshold && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[var(--color-text-muted)]">{t('challenges.club.threshold', 'Club Threshold')}: {threshold.toLocaleString()} lbs</span>
                <span className="text-[11px] text-[var(--color-text-muted)]">{Math.min(100, Math.round((myEntry.score / threshold) * 100))}%</span>
              </div>
              <div className="h-2 bg-[var(--color-bg-secondary)] rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${madeClub ? 'bg-emerald-500' : 'bg-[#D4AF37]'}`}
                  style={{ width: `${Math.min(100, (myEntry.score / threshold) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center" role="status" aria-busy={true} aria-label={t('challenges.loading', 'Loading')}>
          <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-6">{t('challenges.noOneJoined')}</p>
      ) : (
        <div className="space-y-3">
          {entries.slice(0, 20).map((e, i) => {
            const isMe = e.id === myId;
            const aboveThreshold = threshold && e.score >= threshold;
            return (
              <div key={e.id}
                className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-colors ${
                  isMe ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30' : 'bg-[var(--color-bg-card)] border border-[var(--color-border)]'
                }`}>
                <div className="flex-shrink-0 w-8 text-center">
                  {i < 3 ? <span className="text-[22px]">{MEDAL[i]}</span> : <span className="text-[16px] font-bold text-[var(--color-text-muted)]">{i + 1}</span>}
                </div>
                <p className={`flex-1 text-[14px] font-semibold truncate ${isMe ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>
                  {e.name}
                  {isMe && <span className="ml-1.5 text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full">{t('challenges.you')}</span>}
                </p>
                <p className={`text-[14px] font-bold flex-shrink-0 ${isMe ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>
                  {e.score.toLocaleString()} <span className="text-[11px] font-medium text-[var(--color-text-muted)]">lbs</span>
                </p>
                {aboveThreshold && <span className="text-[14px] flex-shrink-0" title="Club member">✅</span>}
              </div>
            );
          })}
          {/* Threshold line indicator */}
          {threshold && entries.some(e => e.score >= threshold) && entries.some(e => e.score < threshold) && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-[#D4AF37]/30" />
              <span className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-wider whitespace-nowrap">— {threshold.toLocaleString()} lb {t('challenges.club.clubLine', 'Club')} —</span>
              <div className="flex-1 h-px bg-[#D4AF37]/30" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Team Formation Modal ──────────────────────────────────
const TeamFormationModal = ({ challenge, gymId, userId, onTeamJoined, onClose, t }) => {
  const [step, setStep] = useState('choose'); // 'choose' | 'create' | 'invites'
  const [teamName, setTeamName] = useState('');
  const [friends, setFriends] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [existingTeams, setExistingTeams] = useState([]);
  const [myInvites, setMyInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const maxMembers = challenge.team_size || 2;

  useEffect(() => {
    const load = async () => {
      const [teamsRes, friendsRes, invitesRes] = await Promise.all([
        supabase.rpc('get_team_leaderboard', { p_challenge_id: challenge.id }),
        supabase.from('friendships').select('requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, full_name, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, full_name, avatar_url)')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).eq('status', 'accepted'),
        supabase.from('challenge_team_invites').select('*, team:challenge_teams(id, name, challenge_id)')
          .eq('invitee_id', userId).eq('status', 'pending'),
      ]);
      setExistingTeams((teamsRes.data || []).filter(t => t.member_count < maxMembers));
      const friendList = (friendsRes.data || []).map(f => {
        const friend = f.requester_id === userId ? f.addressee : f.requester;
        return friend;
      }).filter(Boolean);
      setFriends(friendList);
      setMyInvites((invitesRes.data || []).filter(inv => inv.team?.challenge_id === challenge.id));
      setLoading(false);
    };
    load();
  }, [challenge.id, userId, maxMembers]);

  const handleCreateTeam = async () => {
    if (!teamName.trim()) return;
    setSaving(true);
    // 1. Create team
    const { data: team, error: teamErr } = await supabase.from('challenge_teams')
      .insert({ challenge_id: challenge.id, name: teamName.trim(), captain_id: userId })
      .select('id').single();
    if (teamErr || !team) { setSaving(false); return; }
    // 2. Join as participant with team_id
    const { error: joinErr } = await supabase.from('challenge_participants')
      .insert({ challenge_id: challenge.id, profile_id: userId, gym_id: gymId, team_id: team.id, score: 0 });
    if (joinErr) { setSaving(false); return; }
    // 3. Send invites to selected friends
    if (selectedFriends.length > 0) {
      const invites = selectedFriends.map(fId => ({
        team_id: team.id, inviter_id: userId, invitee_id: fId,
      }));
      await supabase.from('challenge_team_invites').insert(invites);
      // Send notifications
      for (const fId of selectedFriends) {
        sendNotification({
          profileId: fId, gymId, type: 'challenge',
          title: t('challenges.team.inviteTitle', 'Team Invite!'),
          body: t('challenges.team.inviteBody', { team: teamName.trim(), challenge: challenge.name }),
          dedupKey: `team_invite_${team.id}_${fId}`,
        }).catch(() => {});
      }
    }
    setSaving(false);
    onTeamJoined();
    onClose();
  };

  const handleAcceptInvite = async (invite) => {
    setSaving(true);
    // Update invite status
    await supabase.from('challenge_team_invites').update({ status: 'accepted' }).eq('id', invite.id);
    // Join as participant with that team
    await supabase.from('challenge_participants')
      .insert({ challenge_id: challenge.id, profile_id: userId, gym_id: gymId, team_id: invite.team_id, score: 0 });
    setSaving(false);
    onTeamJoined();
    onClose();
  };

  const handleDeclineInvite = async (invite) => {
    await supabase.from('challenge_team_invites').update({ status: 'declined' }).eq('id', invite.id);
    setMyInvites(prev => prev.filter(i => i.id !== invite.id));
  };

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={t('challenges.team.joinTeam', 'Join Team Challenge')}>
      <div className="w-full max-w-[480px] bg-[var(--color-bg-card)] rounded-t-3xl p-6 pb-10">
        <div className="flex justify-center py-8" role="status" aria-busy={true} aria-label={t('challenges.loading', 'Loading')}><div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" /></div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={step === 'create' ? t('challenges.team.createTeam', 'Create Team') : t('challenges.team.joinTeam', 'Join Team Challenge')} onClick={onClose}>
      <div className="w-full max-w-[480px] bg-[var(--color-bg-card)] rounded-t-3xl p-6 pb-10 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[18px] font-bold text-[var(--color-text-primary)]">
            {step === 'create' ? t('challenges.team.createTeam', 'Create Team') : t('challenges.team.joinTeam', 'Join Team Challenge')}
          </h3>
          <button type="button" onClick={onClose} aria-label={t('common.close', 'Close')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">✕</button>
        </div>

        {/* Incoming invites */}
        {myInvites.length > 0 && step === 'choose' && (
          <div className="mb-5">
            <p className="text-[12px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-3">{t('challenges.team.pendingInvites', 'Pending Invites')}</p>
            {myInvites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between bg-[#D4AF37]/5 border border-[#D4AF37]/20 rounded-xl px-4 py-3 mb-2">
                <div>
                  <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{inv.team?.name}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">{t('challenges.team.invitedYou', 'Invited you to join')}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleAcceptInvite(inv)} disabled={saving}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-[#D4AF37] text-black disabled:opacity-50">
                    {t('challenges.team.accept', 'Accept')}
                  </button>
                  <button type="button" onClick={() => handleDeclineInvite(inv)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-white/5 text-[var(--color-text-muted)] border border-[var(--color-border)]">
                    {t('challenges.team.decline', 'Decline')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 'choose' && (
          <div className="space-y-3">
            <button type="button" onClick={() => setStep('create')}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#D4AF37]/5 border border-[#D4AF37]/20 hover:bg-[#D4AF37]/10 transition-colors text-left">
              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center">
                <UserPlus size={18} className="text-[#D4AF37]" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{t('challenges.team.createNew', 'Create a New Team')}</p>
                <p className="text-[12px] text-[var(--color-text-muted)]">{t('challenges.team.createNewDesc', 'Name your team and invite friends')}</p>
              </div>
            </button>
          </div>
        )}

        {step === 'create' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text-muted)] mb-1.5">{t('challenges.team.teamName', 'Team Name')}</label>
              <input value={teamName} onChange={e => setTeamName(e.target.value)} maxLength={30}
                placeholder={t('challenges.team.teamNamePlaceholder', 'e.g. Iron Warriors')}
                className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text-muted)] mb-1.5">
                {t('challenges.team.inviteFriends', 'Invite Friends')} ({selectedFriends.length}/{maxMembers - 1})
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {friends.length === 0 ? (
                  <p className="text-[12px] text-[var(--color-text-muted)] py-3">{t('challenges.team.noFriends', 'Add friends first to invite them')}</p>
                ) : friends.map(f => {
                  const isSelected = selectedFriends.includes(f.id);
                  const isFull = selectedFriends.length >= maxMembers - 1 && !isSelected;
                  return (
                    <button key={f.id} type="button" disabled={isFull}
                      onClick={() => setSelectedFriends(prev => isSelected ? prev.filter(id => id !== f.id) : [...prev, f.id])}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${
                        isSelected ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30' : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:bg-white/5'
                      } ${isFull ? 'opacity-40' : ''}`}>
                      <div className="w-8 h-8 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                        {f.avatar_url ? <img src={f.avatar_url} alt={`${f.full_name || t('challenges.team.member', 'Team member')} avatar`} className="w-8 h-8 rounded-full object-cover" /> : <span className="text-[11px] font-bold text-[#D4AF37]">{(f.full_name || '?')[0]}</span>}
                      </div>
                      <p className="flex-1 text-[13px] font-medium text-[var(--color-text-primary)] truncate">{f.full_name}</p>
                      {isSelected && <Check size={16} className="text-[#D4AF37]" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setStep('choose')}
                className="flex-1 py-3 rounded-xl text-[13px] font-bold text-[var(--color-text-muted)] bg-white/5 border border-[var(--color-border)]">
                {t('common.back', 'Back')}
              </button>
              <button type="button" onClick={handleCreateTeam} disabled={!teamName.trim() || saving}
                className="flex-1 py-3 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] disabled:opacity-50">
                {saving ? '...' : t('challenges.team.create', 'Create & Join')}
              </button>
            </div>
          </div>
        )}
      </div>
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
          setCompleted(true);
          // Check server-side first to prevent double-claiming
          const { data: existing } = await supabase
            .from('daily_challenge_completions')
            .select('id')
            .eq('profile_id', userId)
            .eq('challenge_date', new Date().toISOString().split('T')[0])
            .maybeSingle();

          if (!existing) {
            await supabase.from('daily_challenge_completions').insert({
              profile_id: userId,
              challenge_date: new Date().toISOString().split('T')[0],
              points_awarded: 25,
            });
            addPoints(userId, gymId, 'daily_challenge', 25, 'Daily challenge completed').catch(() => {});
          }
          localStorage.setItem(storageKey, 'true');
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
  const [showTeamModal, setShowTeamModal] = useState(false);
  const status = statusOf(challenge);
  const meta = TYPE_META[challenge.type] ?? {};
  const Icon = meta.icon ?? Trophy;
  const cardRewards = parseRewards(challenge);
  const hasRewards = challenge.reward_description != null;
  const isTeam = challenge.type === 'team';

  const statusStyle = {
    live:     'text-emerald-400 bg-emerald-500/10',
    upcoming: 'text-blue-400 bg-blue-500/10',
    ended:    'text-[var(--color-text-muted)] bg-white/[0.06]',
  }[status];

  const statusLabel = t(`challenges.tabs.${status}`);

  const handleJoin = async (e) => {
    e.stopPropagation();
    if (isTeam) {
      setShowTeamModal(true);
      return;
    }
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
        aria-expanded={open}
        aria-label={`${sanitize(challenge.name)} - ${statusLabel}`}
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
            {challenge.type === 'team' && challenge.team_size && (
              <>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="text-[11px] text-[#D4AF37] font-medium">{challenge.team_size === 2 ? t('challenges.team.duos', 'Duos') : challenge.team_size === 3 ? t('challenges.team.trios', 'Trios') : `${challenge.team_size}-${t('challenges.team.person', 'person')}`}</span>
              </>
            )}
            {challenge.type === 'milestone' && challenge.milestone_target && (
              <>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="text-[11px] text-[#D4AF37] font-medium">{Number(challenge.milestone_target).toLocaleString()} lb {t('challenges.club.clubLine', 'Club')}</span>
              </>
            )}
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
            : challenge.type === 'team'
              ? <TeamLeaderboard challenge={challenge} gymId={gymId} myId={myId} t={t} />
              : challenge.type === 'milestone'
                ? <ClubLeaderboard challenge={challenge} gymId={gymId} myId={myId} t={t} />
                : <Leaderboard challenge={challenge} gymId={gymId} myId={myId} t={t} />
          }
        </div>
      )}

      {showTeamModal && (
        <TeamFormationModal
          challenge={challenge}
          gymId={gymId}
          userId={myId}
          onTeamJoined={() => {
            setShowTeamModal(false);
            // Refresh participant data
            onJoin(null); // Signal parent to refresh
          }}
          onClose={() => setShowTeamModal(false)}
          t={t}
        />
      )}
    </div>
  );
};

// ── Friend Duels Section ──────────────────────────────────
const METRIC_LABELS = { volume: 'metricVolume', workouts: 'metricWorkouts', prs: 'metricPrs' };

const FriendDuelsSection = ({ userId, gymId, userName, t }) => {
  const { showToast } = useToast();
  const [duels, setDuels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);

  useEffect(() => {
    if (!userId || !gymId) return;
    const load = async () => {
      const { data } = await supabase
        .from('friend_challenges')
        .select('*, challenger:profiles!friend_challenges_challenger_id_fkey(full_name, avatar_url), challenged:profiles!friend_challenges_challenged_id_fkey(full_name, avatar_url)')
        .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(20);
      setDuels(data || []);
      setLoading(false);
    };
    load();
  }, [userId, gymId]);

  const handleAccept = async (duel) => {
    setProcessing(duel.id);
    try {
      await supabase.from('friend_challenges').update({ status: 'active' }).eq('id', duel.id);

      // Notify both users
      await sendNotification(duel.challenger_id, gymId, {
        title: t('leaderboard.challengeFriend.accepted'),
        body: t('leaderboard.challengeFriend.acceptedBody', { name: userName }),
        type: NOTIFICATION_TYPES.FRIEND_ACTIVITY,
        actionUrl: '/challenges',
      });
      await sendNotification(userId, gymId, {
        title: t('leaderboard.challengeFriend.accepted'),
        body: t('leaderboard.challengeFriend.acceptedBody', { name: duel.challenger?.full_name }),
        type: NOTIFICATION_TYPES.FRIEND_ACTIVITY,
        actionUrl: '/challenges',
      });

      setDuels(prev => prev.map(d => d.id === duel.id ? { ...d, status: 'active' } : d));
    } catch (err) {
      showToast(t('challenges.friendDuels.acceptError', 'Could not accept duel'));
    } finally {
      setProcessing(null);
    }
  };

  const handleDecline = async (duel) => {
    setProcessing(duel.id);
    try {
      await supabase.from('friend_challenges').update({ status: 'declined' }).eq('id', duel.id);

      await sendNotification(duel.challenger_id, gymId, {
        title: t('leaderboard.challengeFriend.declined'),
        body: t('leaderboard.challengeFriend.declinedBody', { name: userName }),
        type: NOTIFICATION_TYPES.FRIEND_ACTIVITY,
        actionUrl: '/challenges',
      });

      setDuels(prev => prev.filter(d => d.id !== duel.id));
    } catch (err) {
      showToast(t('challenges.friendDuels.declineError', 'Could not decline duel'));
    } finally {
      setProcessing(null);
    }
  };

  const pending = duels.filter(d => d.status === 'pending');
  const active  = duels.filter(d => d.status === 'active');
  const completed = duels.filter(d => d.status === 'completed');

  if (loading) return null;
  if (duels.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Swords size={14} className="text-[#D4AF37]" />
        <p className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('challenges.friendDuels.title')}</p>
      </div>

      <div className="space-y-2">
        {/* Pending duels (incoming challenges I need to respond to) */}
        {pending.filter(d => d.challenged_id === userId).map(duel => {
          const opponentName = duel.challenger?.full_name || 'Someone';
          return (
            <div key={duel.id} className="rounded-2xl bg-white/[0.04] border border-[#D4AF37]/20 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-[#D4AF37]/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {duel.challenger?.avatar_url ? (
                    <img src={duel.challenger.avatar_url} alt={`${opponentName} avatar`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[12px] font-bold text-[#D4AF37]">{opponentName.charAt(0)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                    {t('challenges.friendDuels.challengeFrom', { name: opponentName })}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {t(`challenges.friendDuels.${METRIC_LABELS[duel.metric]}`)} &middot; 7 {t('challenges.friendDuels.daysLeft', { count: 7 })}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleDecline(duel)}
                  disabled={processing === duel.id}
                  className="flex-1 py-2.5 rounded-xl bg-white/[0.06] text-[12px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-white/[0.08] min-h-[44px] flex items-center justify-center gap-1.5"
                >
                  <XCircle size={13} /> {t('challenges.friendDuels.decline')}
                </button>
                <button
                  type="button"
                  onClick={() => handleAccept(duel)}
                  disabled={processing === duel.id}
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-bold text-white transition-all min-h-[44px] flex items-center justify-center gap-1.5 disabled:opacity-60"
                  style={{ background: 'var(--color-accent)' }}
                >
                  <CheckCircle2 size={13} /> {t('challenges.friendDuels.accept')}
                </button>
              </div>
            </div>
          );
        })}

        {/* Pending duels I sent (waiting for response) */}
        {pending.filter(d => d.challenger_id === userId).map(duel => {
          const opponentName = duel.challenged?.full_name || 'Someone';
          return (
            <div key={duel.id} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {duel.challenged?.avatar_url ? (
                    <img src={duel.challenged.avatar_url} alt={`${opponentName} avatar`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[12px] font-bold text-[var(--color-text-muted)]">{opponentName.charAt(0)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                    {t('challenges.friendDuels.youChallenged', { name: opponentName })}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {t(`challenges.friendDuels.${METRIC_LABELS[duel.metric]}`)} &middot; {t('challenges.friendDuels.pending')}
                  </p>
                </div>
                <Clock size={14} className="text-[var(--color-text-subtle)] flex-shrink-0" />
              </div>
            </div>
          );
        })}

        {/* Active duels */}
        {active.map(duel => {
          const iAmChallenger = duel.challenger_id === userId;
          const myScore = iAmChallenger ? duel.challenger_score : duel.challenged_score;
          const theirScore = iAmChallenger ? duel.challenged_score : duel.challenger_score;
          const opponent = iAmChallenger ? duel.challenged : duel.challenger;
          const opponentName = opponent?.full_name || 'Someone';
          const daysLeft = Math.max(0, differenceInDays(new Date(duel.end_date), new Date()));

          return (
            <div key={duel.id} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Swords size={13} className="text-[#D4AF37]" />
                  <p className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider">
                    {t(`challenges.friendDuels.${METRIC_LABELS[duel.metric]}`)}
                  </p>
                </div>
                <span className="text-[10px] text-[var(--color-text-subtle)]">
                  {t('challenges.friendDuels.daysLeft', { count: daysLeft })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-center">
                  <p className="text-[11px] text-[var(--color-text-muted)] mb-1">{t('leaderboard.you')}</p>
                  <p className="text-[18px] font-bold text-[var(--color-text-primary)]" style={{ fontVariantNumeric: 'tabular-nums', color: Number(myScore) >= Number(theirScore) ? 'var(--color-success)' : undefined }}>
                    {Number(myScore).toLocaleString()}
                  </p>
                </div>
                <p className="text-[12px] font-bold text-[var(--color-text-subtle)]">{t('challenges.friendDuels.vs')}</p>
                <div className="flex-1 text-center">
                  <p className="text-[11px] text-[var(--color-text-muted)] mb-1 truncate">{opponentName}</p>
                  <p className="text-[18px] font-bold text-[var(--color-text-primary)]" style={{ fontVariantNumeric: 'tabular-nums', color: Number(theirScore) > Number(myScore) ? 'var(--color-danger)' : undefined }}>
                    {Number(theirScore).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {/* Completed duels (last 5) */}
        {completed.slice(0, 5).map(duel => {
          const iAmChallenger = duel.challenger_id === userId;
          const myScore = iAmChallenger ? duel.challenger_score : duel.challenged_score;
          const theirScore = iAmChallenger ? duel.challenged_score : duel.challenger_score;
          const opponent = iAmChallenger ? duel.challenged : duel.challenger;
          const opponentName = opponent?.full_name || 'Someone';
          const iWon = duel.winner_id === userId;
          const isDraw = !duel.winner_id && duel.status === 'completed';

          return (
            <div key={duel.id} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4 opacity-70">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  {t(`challenges.friendDuels.${METRIC_LABELS[duel.metric]}`)}
                </p>
                <span className={`text-[11px] font-bold ${iWon ? 'text-[#10B981]' : isDraw ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-subtle)]'}`}>
                  {iWon ? t('challenges.friendDuels.winner') : isDraw ? t('challenges.friendDuels.draw') : opponentName}
                  {iWon && <span className="text-[#D4AF37] ml-1">{t('challenges.friendDuels.bonusPoints')}</span>}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
                <span>{t('leaderboard.you')}: {Number(myScore).toLocaleString()}</span>
                <span>{t('challenges.friendDuels.vs')}</span>
                <span className="truncate">{opponentName}: {Number(theirScore).toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
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

  useEffect(() => { document.title = `${t('challenges.title', 'Challenges')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  useEffect(() => {
    if (!profile?.gym_id || !user?.id) return;

    const load = async () => {
      const [{ data: cData }, { data: pData }] = await Promise.all([
        supabase.from('challenges').select('id, name, description, type, start_date, end_date, reward_description, gym_id, exercise_id, scoring_metric, team_size, exercise_ids, milestone_target').eq('gym_id', profile.gym_id).order('start_date', { ascending: false }).limit(50),
        supabase.from('challenge_participants').select('challenge_id, profile_id, score').eq('gym_id', profile.gym_id).limit(500),
      ]);
      setChallenges(cData || []);
      setParticipants(pData || []);
      setLoading(false);
    };
    load();
  }, [profile?.gym_id, user?.id]);

  // Check if the user has already earned challenge_joined points for a specific challenge.
  // This prevents the farming exploit: join → leave → rejoin → repeat for unlimited points.
  const hasEarnedChallengeJoinPoints = async (challengeId) => {
    const { data } = await supabase
      .from('reward_points_log')
      .select('id')
      .eq('profile_id', user.id)
      .eq('action', 'challenge_joined')
      .ilike('description', `%${challengeId}%`)
      .limit(1);
    return data && data.length > 0;
  };

  const handleJoin = async (challengeId) => {
    // null challengeId = refresh signal from TeamFormationModal (team already joined)
    if (!challengeId) {
      const { data: pData } = await supabase.from('challenge_participants')
        .select('challenge_id, profile_id, score').eq('gym_id', profile.gym_id).limit(500);
      setParticipants(pData || []);
      // Points for team joins are awarded in the team-specific flow; skip here to avoid double-award.
      return;
    }

    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return;

    // Team challenges handle their own join in TeamFormationModal
    if (challenge.type === 'team') return;

    // Score starts at 0 — the DB trigger enforces this to prevent score injection.
    // Scores are updated server-side as workouts/PRs are logged.
    const { data, error } = await supabase
      .from('challenge_participants')
      .insert({ challenge_id: challengeId, profile_id: user.id, gym_id: profile.gym_id, score: 0 })
      .select('challenge_id, profile_id, score')
      .single();
    if (!error && data) {
      setParticipants(prev => [...prev, data]);
      // Guard: only award points if this user hasn't already earned them for this challenge.
      // The server-side unique constraint (dedup_key) is the authoritative enforcement;
      // this check avoids a silent rejection from the DB by skipping the call entirely.
      const alreadyEarned = await hasEarnedChallengeJoinPoints(challengeId);
      if (!alreadyEarned) {
        addPoints(
          user.id,
          profile.gym_id,
          'challenge_joined',
          25,
          `Joined a challenge (${challengeId})`,
        ).catch(() => {});
      }
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
    <div className={`${embedded ? '' : 'min-h-screen bg-[var(--color-bg-primary)] pb-28 md:pb-12'}`}>
      {/* Header */}
      {!embedded && (
      <div className="sticky top-0 z-20 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border-b border-[var(--color-border)]">
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 pt-6 pb-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center">
              <Trophy size={24} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[var(--color-text-primary)] tracking-tight truncate">{t('challenges.title')}</h1>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{t('challenges.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Tab bar — always visible */}
      <div className={`${embedded ? 'pt-2 pb-3' : 'max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4'}`}>
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

      <div className={`${embedded ? '' : 'max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-6'}`}>
        {tab === 'live' && user?.id && profile?.gym_id && (
          <DailyChallenge userId={user.id} gymId={profile.gym_id} t={t} />
        )}
        {user?.id && profile?.gym_id && (
          <FriendDuelsSection
            userId={user.id}
            gymId={profile.gym_id}
            userName={profile?.full_name || profile?.username || 'Someone'}
            t={t}
          />
        )}
        {loading ? (
          <div role="status" aria-busy={true} aria-label={t('challenges.loading', 'Loading')}>
            <Skeleton variant="card" count={3} height="h-[90px]" />
          </div>
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
                    <div className="space-y-4 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">
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
