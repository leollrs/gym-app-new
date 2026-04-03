import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Trophy, BarChart2, Flame, Dumbbell, MapPin, TrendingUp, Target, ChevronRight, ChevronDown, Sparkles, Award, CheckCircle2, X, Swords, UserPlus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import {
  useLeaderboard,
  useLeaderboardMostImproved,
  useLeaderboardConsistency,
  useLeaderboardPrs,
  useLeaderboardCheckins,
  useMilestoneFeed,
} from '../hooks/useSupabaseQuery';
import { formatStatNumber } from '../lib/formatStatValue';
import { supabase } from '../lib/supabase';
import { sendNotification, NOTIFICATION_TYPES } from '../lib/notifications';

// ── Helpers ─────────────────────────────────────────────────
const ACCENT = 'var(--color-success)';
const GOLD   = 'var(--color-accent)';
const MEDAL  = [GOLD, 'var(--color-text-muted)', '#92400E'];

const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return d.toISOString(); };
const monthStart = () => { const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0); return d.toISOString(); };

const TIME_OPTIONS  = [{ key: 'weekly', label: 'This Week' }, { key: 'monthly', label: 'This Month' }, { key: 'alltime', label: 'All Time' }];

// Map expanded board keys to friend_challenges metric values
const BOARD_TO_METRIC = {
  volume: 'volume',
  workouts: 'workouts',
  prs: 'prs',
};

function timeAgoShort(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

const MILESTONE_CFG = {
  workout_count: { icon: Dumbbell, color: 'var(--color-blue)', label: (d, t) => d?.count === 1 ? t('milestones.firstWorkout') : t('milestones.workoutCount', { count: d?.count }) },
  streak:        { icon: Flame,    color: 'var(--color-danger)', label: (d, t) => t('milestones.dayStreak', { days: d?.days }) },
  first_pr:      { icon: Trophy,   color: GOLD,      label: (d, t) => t('milestones.firstPR', { exercise: d?.exercise_name }) },
  pr_count:      { icon: Award,    color: '#A855F7', label: (d, t) => t('milestones.totalPRs', { count: d?.count }) },
};

// ── Challenge a Friend Modal ─────────────────────────────────
const ChallengeModal = ({ entry, metric, metricLabel, gymId, userId, userName, isFriend, onClose, onSendFriendRequest, t }) => {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleChallenge = async () => {
    if (sending || sent) return;
    setSending(true);
    try {
      const { error } = await supabase.from('friend_challenges').insert({
        challenger_id: userId,
        challenged_id: entry.id,
        gym_id: gymId,
        metric,
        status: 'pending',
      });
      if (error) throw error;

      // Notify the challenged user
      await sendNotification(entry.id, gymId, {
        title: t('leaderboard.challengeFriend.notifTitle', { name: userName }),
        body: t('leaderboard.challengeFriend.notifBody', { name: userName, metric: metricLabel }),
        type: NOTIFICATION_TYPES.FRIEND_ACTIVITY,
        actionUrl: '/challenges',
      });

      // Confirmation notification to challenger
      await sendNotification(userId, gymId, {
        title: t('leaderboard.challengeFriend.sentTitle'),
        body: t('leaderboard.challengeFriend.sentBody', { name: entry.name }),
        type: NOTIFICATION_TYPES.FRIEND_ACTIVITY,
        actionUrl: '/challenges',
      });

      setSent(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      console.error('[ChallengeModal] Error:', err);
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className="w-[85%] max-w-[380px] rounded-2xl border border-white/[0.08] overflow-hidden"
        style={{ background: 'var(--color-bg-primary)', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="w-14 h-14 rounded-full bg-white/[0.06] flex items-center justify-center mx-auto mb-3 overflow-hidden">
            {entry.avatar ? (
              <img src={entry.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[18px] font-bold text-[var(--color-text-muted)]">{entry.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
            )}
          </div>

          {isFriend ? (
            <>
              <h3 className="text-[17px] font-bold text-[var(--color-text-primary)]">
                {t('leaderboard.challengeFriend.title', { name: entry.name })}
              </h3>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1.5">
                {t('leaderboard.challengeFriend.description', { metric: metricLabel })}
              </p>
            </>
          ) : (
            <>
              <h3 className="text-[17px] font-bold text-[var(--color-text-primary)]">
                {t('leaderboard.challengeFriend.addFriendFirst', { name: entry.name })}
              </h3>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1.5">
                {t('leaderboard.challengeFriend.addFriendHint')}
              </p>
            </>
          )}
        </div>

        {/* Details */}
        {isFriend && (
          <div className="mx-5 mb-4 rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider font-semibold">{t('leaderboard.challengeFriend.metricLabel')}</span>
              <span className="text-[12px] font-bold text-[var(--color-text-primary)]">{metricLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider font-semibold">{t('leaderboard.challengeFriend.duration')}</span>
              <span className="text-[12px] font-bold text-[var(--color-text-primary)]">{t('leaderboard.challengeFriend.thisWeek')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider font-semibold">{t('leaderboard.challengeFriend.reward')}</span>
              <span className="text-[12px] font-bold text-[#D4AF37]">+50 pts</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/[0.06] text-[13px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-white/[0.08] min-h-[44px]"
          >
            {t('leaderboard.challengeFriend.cancel')}
          </button>
          {isFriend ? (
            <button
              onClick={handleChallenge}
              disabled={sending || sent}
              className="flex-1 py-3 rounded-xl text-[13px] font-bold text-white transition-all min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: sent ? ACCENT : GOLD }}
            >
              {sent ? (
                <><CheckCircle2 size={14} /> {t('leaderboard.challengeFriend.sent')}</>
              ) : sending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <><Swords size={14} /> {t('leaderboard.challengeFriend.challenge')}</>
              )}
            </button>
          ) : (
            <button
              onClick={() => { onSendFriendRequest(entry.id); onClose(); }}
              className="flex-1 py-3 rounded-xl text-[13px] font-bold text-white transition-all min-h-[44px] flex items-center justify-center gap-2"
              style={{ background: 'var(--color-blue)' }}
            >
              <UserPlus size={14} /> {t('leaderboard.challengeFriend.addFriend')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Mini entry row (for preview cards) ──────────────────────
const MiniEntry = ({ entry, rank, userId, unit, isImproved, isConsistency, t }) => {
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
          <span className="text-[11px] font-bold text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
        )}
      </div>
      <div className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0 overflow-hidden">
        {entry.avatar ? (
          <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] font-bold text-[var(--color-text-muted)]">{entry.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
        )}
      </div>
      <p className={`flex-1 text-[12px] font-medium truncate ${isMe ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
        {isMe ? t('leaderboard.you') : entry.name}
      </p>
      <span className={`text-[12px] font-bold flex-shrink-0 ${rank === 1 ? '' : 'text-[var(--color-text-muted)]'}`} style={{ fontVariantNumeric: 'tabular-nums', ...(rank === 1 ? { color: ACCENT } : {}) }}>
        {isImproved ? `+${entry.score}%` : isConsistency ? `${entry.score}%` : formatStatNumber(entry.score)}
        {unit && !isImproved && !isConsistency && <span className="text-[10px] font-normal text-[var(--color-text-subtle)] ml-0.5">{unit}</span>}
      </span>
    </div>
  );
};

// ── Category preview card ───────────────────────────────────
const CategoryCard = ({ icon: Icon, iconColor, title, subtitle, entries, loading, userId, unit, isImproved, isConsistency, myEntry, onExpand, t }) => (
  <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden hover:bg-white/[0.06] transition-colors duration-200">
    {/* Header */}
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${iconColor}12` }}>
          <Icon size={15} style={{ color: iconColor }} />
        </div>
        <div>
          <p className="text-[16px] font-semibold text-[var(--color-text-primary)]">{title}</p>
          <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">{subtitle}</p>
        </div>
      </div>
      <button onClick={onExpand} className="flex items-center gap-0.5 text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] transition-colors min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg px-2">
        {t('leaderboard.seeAll')} <ChevronRight size={12} />
      </button>
    </div>

    {/* Content */}
    <div className="px-5 pb-4">
      {loading ? (
        <div className="space-y-2 py-2">{[1,2,3].map(i => <div key={i} className="h-8 rounded-lg bg-white/[0.04] animate-pulse" />)}</div>
      ) : !entries || entries.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-subtle)] py-4 text-center">{t('leaderboard.noActivityYet')}</p>
      ) : (
        <>
          {entries.slice(0, 3).map((e, i) => (
            <MiniEntry key={e.id} entry={e} rank={i + 1} userId={userId} unit={unit} isImproved={isImproved} isConsistency={isConsistency} t={t} />
          ))}
          {/* Show my position if not in top 3 */}
          {myEntry && !entries.slice(0, 3).some(e => e.id === userId) && (
            <div className="mt-1 pt-1 border-t border-dashed border-white/[0.06]">
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider">{t('leaderboard.yourPosition')}</span>
              </div>
              <MiniEntry entry={myEntry.entry} rank={myEntry.rank} userId={userId} unit={unit} isImproved={isImproved} isConsistency={isConsistency} t={t} />
            </div>
          )}
        </>
      )}
    </div>
  </div>
);

// ── Expanded full list modal ────────────────────────────────
const ExpandedList = ({ title, icon: Icon, iconColor, entries, loading, userId, unit, isImproved, isConsistency, onClose, timeRange, setTimeRange, availableTimes, boardKey, friendIds, gymId, userName, onChallenge, onSendFriendRequest, t }) => {
  const metric = BOARD_TO_METRIC[boardKey];
  const canChallenge = !!metric; // Only volume, workouts, prs can be challenged

  // Render via portal into document.body — completely detached from page scroll
  return createPortal(
    <div
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-expanded-title"
        onClick={e => e.stopPropagation()}
        style={{ width: '92%', maxWidth: 500, maxHeight: '85vh', background: 'var(--color-bg-primary)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}
      >
      {/* Header — not scrollable */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${iconColor}12` }}>
              <Icon size={15} style={{ color: iconColor }} />
            </div>
            <h2 id="leaderboard-expanded-title" className="text-[17px] font-bold text-[var(--color-text-primary)]">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close leaderboard" className="w-11 h-11 rounded-xl bg-white/[0.06] flex items-center justify-center transition-colors duration-200 hover:bg-white/[0.08] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
            <X size={16} className="text-[var(--color-text-muted)]" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pb-3">
          {availableTimes.map(opt => (
            <button
              key={opt.key}
              onClick={() => setTimeRange(opt.key)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-semibold text-center transition-all ${
                timeRange === opt.key ? 'text-[var(--color-text-primary)]' : 'bg-white/[0.04] text-[var(--color-text-muted)]'
              }`}
              style={timeRange === opt.key ? { background: ACCENT } : undefined}
            >
              {t(`leaderboard.timeOptions.${opt.key}`)}
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
              <Trophy size={28} className="text-[var(--color-text-subtle)] mx-auto mb-2" />
              <p className="text-[13px] text-[var(--color-text-muted)]">{t('leaderboard.noActivityPeriod')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {entries.map((entry, i) => {
                const rank = i + 1;
                const isMe = entry.id === userId;
                const isFirst = rank === 1;
                const medalColor = rank <= 3 ? MEDAL[rank - 1] : null;
                const isFriend = friendIds.has(entry.id);

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
                        <span className="text-[12px] font-bold text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
                      )}
                    </div>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${isFirst ? 'ring-1 ring-[#D4AF37]/25' : 'bg-white/[0.06]'}`}>
                      {entry.avatar ? (
                        <img src={entry.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-bold text-[var(--color-text-muted)]">{entry.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold truncate ${isMe ? 'text-[var(--color-text-primary)]' : isFirst ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                        {isMe ? t('leaderboard.you') : entry.name}
                      </p>
                      {isConsistency && entry.actual_days != null && (
                        <p className="text-[10px] text-[var(--color-text-subtle)]">{t('leaderboard.ofDays', { actual: entry.actual_days, planned: entry.planned_days })}</p>
                      )}
                      {isImproved && entry.previous_value != null && (
                        <p className="text-[10px] text-[var(--color-text-subtle)]">{formatStatNumber(Math.round(entry.previous_value))} → {formatStatNumber(Math.round(entry.current_value))}</p>
                      )}
                    </div>
                    <span className={`text-[13px] font-bold flex-shrink-0 ${isFirst ? '' : 'text-[var(--color-text-muted)]'}`} style={{ fontVariantNumeric: 'tabular-nums', ...(isFirst ? { color: ACCENT } : {}) }}>
                      {isImproved ? `+${entry.score}%` : isConsistency ? `${entry.score}%` : formatStatNumber(entry.score)}
                      {unit && !isImproved && !isConsistency && <span className="text-[10px] font-normal text-[var(--color-text-subtle)] ml-1">{unit}</span>}
                    </span>
                    {/* Challenge / Add Friend button */}
                    {!isMe && canChallenge && (
                      <button
                        onClick={() => onChallenge(entry, isFriend)}
                        aria-label={isFriend ? t('leaderboard.challengeFriend.challenge') : t('leaderboard.challengeFriend.addFriend')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors hover:bg-white/[0.08] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                        style={{ background: isFriend ? 'color-mix(in srgb, var(--color-accent) 7%, transparent)' : 'color-mix(in srgb, var(--color-blue) 7%, transparent)' }}
                      >
                        {isFriend ? (
                          <Swords size={13} style={{ color: 'var(--color-accent)' }} />
                        ) : (
                          <UserPlus size={13} style={{ color: 'var(--color-blue)' }} />
                        )}
                      </button>
                    )}
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
  const { t } = useTranslation('pages');
  const { profile, user } = useAuth();
  const gymId = profile?.gym_id;
  const uid = user?.id;

  const [expanded, setExpanded] = useState(null); // which board is expanded
  const [exTimeRange, setExTimeRange] = useState('weekly');
  const [challengeTarget, setChallengeTarget] = useState(null); // { entry, isFriend }
  const [friendIds, setFriendIds] = useState(new Set());

  // Fetch friend IDs for the current user
  useEffect(() => {
    if (!uid) return;
    // SECURITY: uid comes from supabase.auth (user.id), not user input.
    // Validate UUID format as a defense-in-depth measure before interpolating into .or() filter.
    if (!/^[0-9a-f-]{36}$/i.test(uid)) return;
    supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
      .eq('status', 'accepted')
      .then(({ data }) => {
        if (!data) return;
        const ids = new Set(data.map(f => f.requester_id === uid ? f.addressee_id : f.requester_id));
        setFriendIds(ids);
      });
  }, [uid]);

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
    volume:      { title: t('leaderboard.categories.volume'),       icon: BarChart2,    iconColor: 'var(--color-blue)', unit: 'lbs',       data: exVolume.data,         loading: exVolume.isLoading,      times: TIME_OPTIONS },
    workouts:    { title: t('leaderboard.categories.workouts'),     icon: Dumbbell,     iconColor: '#8B5CF6', unit: 'sessions',  data: exWorkouts.data,       loading: exWorkouts.isLoading,    times: TIME_OPTIONS },
    streak:      { title: t('leaderboard.categories.streak'),       icon: Flame,        iconColor: 'var(--color-danger)', unit: 'days',      data: exStreakEntries,        loading: exStreak.isLoading,      times: [TIME_OPTIONS[2]] },
    improved:    { title: t('leaderboard.categories.improved'),     icon: TrendingUp,   iconColor: ACCENT,    unit: '',          data: exImproved.data,       loading: exImproved.isLoading,    times: TIME_OPTIONS.slice(0,2), isImproved: true },
    consistency: { title: t('leaderboard.categories.consistency'),  icon: Target,       iconColor: 'var(--color-warning)', unit: '',          data: exConsistency.data,    loading: exConsistency.isLoading, times: TIME_OPTIONS.slice(0,2), isConsistency: true },
    prs:         { title: t('leaderboard.categories.prs'),          icon: Trophy,       iconColor: GOLD,      unit: 'PRs',       data: exPrs.data,            loading: exPrs.isLoading,         times: TIME_OPTIONS },
    checkins:    { title: t('leaderboard.categories.checkins'),     icon: MapPin,       iconColor: '#06B6D4', unit: 'check-ins', data: exCheckins.data,       loading: exCheckins.isLoading,    times: TIME_OPTIONS },
  };

  const handleExpand = (key) => {
    setExTimeRange('weekly');
    setExpanded(key);
  };

  const handleChallenge = useCallback((entry, isFriend) => {
    setChallengeTarget({ entry, isFriend });
  }, []);

  const handleSendFriendRequest = useCallback(async (targetId) => {
    if (!uid || !gymId) return;
    try {
      const { error } = await supabase.from('friendships').insert({
        requester_id: uid,
        addressee_id: targetId,
        status: 'pending',
      });
      if (error) throw error;
    } catch (err) {
      console.error('[Leaderboard] Friend request error:', err);
    }
  }, [uid, gymId]);

  // Metric label for the challenge modal
  const challengeMetricLabel = expanded && BOARD_TO_METRIC[expanded]
    ? t(`leaderboard.challengeFriend.metrics.${BOARD_TO_METRIC[expanded]}`)
    : '';

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[var(--color-bg-primary)] pb-28 md:pb-12'} animate-fade-in`}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-[480px] md:max-w-4xl px-4'}>

        {/* Title */}
        {!embedded && (
          <div className="pt-6 pb-5">
            <h1 className="text-[22px] font-bold text-[var(--color-text-primary)] tracking-tight truncate">
              {t('leaderboard.title')}
            </h1>
            <p className="text-[14px] text-[var(--color-text-subtle)] mt-1">{t('leaderboard.thisWeekAtYourGym')}</p>
          </div>
        )}

        {/* ── Your Position Hero ── */}
        {myVolume && (
          <div className="rounded-2xl bg-gradient-to-br from-[var(--color-bg-card)] to-[var(--color-bg-card)]/60 border border-white/[0.06] overflow-hidden p-5 mb-4" style={{ boxShadow: '0 0 30px rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center overflow-hidden flex-shrink-0 ring-2 ring-[#10B981]/20">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[14px] font-bold text-[var(--color-text-muted)]">{profile?.full_name?.charAt(0)?.toUpperCase() ?? '?'}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider">{t('leaderboard.yourRank')}</p>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-[24px] font-black leading-none truncate" style={{ color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>#{myVolume.rank}</span>
                  {myPct != null && (
                    <span className="text-[12px] font-semibold text-[var(--color-text-subtle)]">Top {Math.max(100 - myPct + 1, 1)}%</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[18px] font-bold text-[var(--color-text-primary)] truncate" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatStatNumber(myVolume.entry.score)}</p>
                <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">{t('leaderboard.lbsThisWeek')}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Category Cards ── */}
        <div className="space-y-6">
          <CategoryCard
            icon={BarChart2} iconColor="var(--color-blue)" title={t('leaderboard.categories.volume')} subtitle={t('leaderboard.categories.volume_sub')}
            entries={volume.data} loading={volume.isLoading} userId={uid} unit="lbs"
            myEntry={findMe(volume.data)} onExpand={() => handleExpand('volume')} t={t}
          />
          <CategoryCard
            icon={Dumbbell} iconColor="#8B5CF6" title={t('leaderboard.categories.workouts')} subtitle={t('leaderboard.categories.workouts_sub')}
            entries={workouts.data} loading={workouts.isLoading} userId={uid} unit="sessions"
            myEntry={findMe(workouts.data)} onExpand={() => handleExpand('workouts')} t={t}
          />
          <CategoryCard
            icon={TrendingUp} iconColor={ACCENT} title={t('leaderboard.categories.improved')} subtitle={t('leaderboard.categories.improved_sub')}
            entries={improved.data} loading={improved.isLoading} userId={uid} isImproved
            myEntry={findMe(improved.data)} onExpand={() => handleExpand('improved')} t={t}
          />
          <CategoryCard
            icon={Target} iconColor="var(--color-warning)" title={t('leaderboard.categories.consistency')} subtitle={t('leaderboard.categories.consistency_sub')}
            entries={consistency.data} loading={consistency.isLoading} userId={uid} isConsistency
            myEntry={findMe(consistency.data)} onExpand={() => handleExpand('consistency')} t={t}
          />
          <CategoryCard
            icon={Flame} iconColor="var(--color-danger)" title={t('leaderboard.categories.streak')} subtitle={t('leaderboard.categories.streak_sub')}
            entries={streakEntries} loading={streak.isLoading} userId={uid} unit="days"
            myEntry={findMe(streakEntries)} onExpand={() => handleExpand('streak')} t={t}
          />
          <CategoryCard
            icon={Trophy} iconColor={GOLD} title={t('leaderboard.categories.prs')} subtitle={t('leaderboard.categories.prs_sub')}
            entries={prs.data} loading={prs.isLoading} userId={uid} unit="PRs"
            myEntry={findMe(prs.data)} onExpand={() => handleExpand('prs')} t={t}
          />
          <CategoryCard
            icon={MapPin} iconColor="#06B6D4" title={t('leaderboard.categories.checkins')} subtitle={t('leaderboard.categories.checkins_sub')}
            entries={checkins.data} loading={checkins.isLoading} userId={uid} unit="check-ins"
            myEntry={findMe(checkins.data)} onExpand={() => handleExpand('checkins')} t={t}
          />
        </div>

        {/* ── Highlights Feed ── */}
        {milestones.data && milestones.data.length > 0 && (
          <div className="mt-6">
            <p className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3 px-1">{t('leaderboard.recentHighlights')}</p>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden hover:bg-white/[0.06] transition-colors duration-200">
              <div className="px-5 py-2">
                {milestones.data.slice(0, 5).map(entry => {
                  const cfg = MILESTONE_CFG[entry.type] ?? { icon: Sparkles, color: ACCENT, label: (d, t) => t('leaderboard.milestone') };
                  const MIcon = cfg.icon;
                  return (
                    <div key={entry.id} className="flex items-center gap-3 py-2.5 border-b border-white/[0.06] last:border-0">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${cfg.color}10` }}>
                        <MIcon size={14} style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-[var(--color-text-primary)] truncate">{entry.name}</p>
                        <p className="text-[10px] text-[var(--color-text-muted)] truncate">{cfg.label(entry.data ?? {}, t)}</p>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-subtle)] flex-shrink-0">{timeAgoShort(entry.created_at)}</span>
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
          boardKey={expanded}
          friendIds={friendIds}
          gymId={gymId}
          userName={profile?.full_name || profile?.username || 'Someone'}
          onChallenge={handleChallenge}
          onSendFriendRequest={handleSendFriendRequest}
          t={t}
        />
      )}

      {/* ── Challenge Modal ── */}
      {challengeTarget && expanded && BOARD_TO_METRIC[expanded] && (
        <ChallengeModal
          entry={challengeTarget.entry}
          metric={BOARD_TO_METRIC[expanded]}
          metricLabel={challengeMetricLabel}
          gymId={gymId}
          userId={uid}
          userName={profile?.full_name || profile?.username || 'Someone'}
          isFriend={challengeTarget.isFriend}
          onClose={() => setChallengeTarget(null)}
          onSendFriendRequest={handleSendFriendRequest}
          t={t}
        />
      )}
    </div>
  );
};

export default Leaderboard;
