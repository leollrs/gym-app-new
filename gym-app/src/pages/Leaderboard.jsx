import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../hooks/useScrollLock';
import { List as VirtualList } from 'react-window';
import { Trophy, BarChart2, Flame, Dumbbell, MapPin, TrendingUp, Target, ChevronRight, ChevronDown, Sparkles, Award, CheckCircle2, X, Swords, UserPlus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import EmptyState from '../components/EmptyState';
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
import { usePostHog } from '@posthog/react';
import { useQueryClient } from '@tanstack/react-query';
import posthogClient from 'posthog-js';

// ── Helpers ─────────────────────────────────────────────────
const DISPLAY_FONT = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const ACCENT = 'var(--color-accent, #2EC4C4)';
const GOLD   = 'var(--color-accent, #2EC4C4)';
const MEDAL  = [GOLD, 'var(--color-text-muted)', '#92400E'];
const CARD_SHADOW = '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)';

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
  streak:        { icon: Flame,    color: '#FF5A2E', label: (d, t) => t('milestones.dayStreak', { days: d?.days }) },
  first_pr:      { icon: Trophy,   color: GOLD,      label: (d, t) => t('milestones.firstPR', { exercise: d?.exercise_name }) },
  pr_count:      { icon: Award,    color: '#6D5FDB', label: (d, t) => t('milestones.totalPRs', { count: d?.count }) },
};

// ── Challenge a Friend Modal ─────────────────────────────────
const ChallengeModal = ({ entry, metric, metricLabel, gymId, userId, userName, isFriend, onClose, onSendFriendRequest, t }) => {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { showToast } = useToast();
  useScrollLock(true); // lock background scroll while this modal is mounted

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
    } catch {
      showToast(t('leaderboard.challengeError', 'Could not send challenge'));
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
        className="w-[85%] max-w-[380px] rounded-[22px] overflow-hidden border"
        style={{ background: 'var(--color-bg-primary)', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', borderColor: 'var(--color-border, rgba(200,200,200,0.1))' }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 overflow-hidden" style={{ background: 'var(--color-bg-elevated, var(--color-bg-card))' }}>
            {entry.avatar ? (
              <img src={entry.avatar} alt={entry.name || t('leaderboard.userAvatar', { defaultValue: 'User avatar' })} className="w-full h-full object-cover" width={56} height={56} loading="lazy" />
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
          <div className="mx-5 mb-4 rounded-[14px] p-3 space-y-2 border" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border, rgba(200,200,200,0.1))' }}>
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
              <span className="text-[12px] font-bold" style={{ color: ACCENT }}>+50 pts</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-full text-[13px] font-semibold text-[var(--color-text-muted)] transition-colors min-h-[44px]"
            style={{ background: 'var(--color-bg-elevated, var(--color-bg-card))' }}
          >
            {t('leaderboard.challengeFriend.cancel')}
          </button>
          {isFriend ? (
            <button
              onClick={handleChallenge}
              disabled={sending || sent}
              className="flex-1 py-3 rounded-full text-[13px] font-bold text-[var(--color-text-on-accent,#fff)] transition-all min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-60"
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
              className="flex-1 py-3 rounded-full text-[13px] font-bold text-white transition-all min-h-[44px] flex items-center justify-center gap-2"
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
    <div className="flex items-center gap-2.5 py-2" style={rank > 1 ? { borderTop: '1px solid var(--color-border, rgba(200,200,200,0.08))' } : undefined}>
      <div className="w-6 flex items-center justify-center flex-shrink-0">
        {rank <= 3 ? (
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color, fontVariantNumeric: 'tabular-nums', fontFamily: DISPLAY_FONT }}>
            {rank}
          </div>
        ) : (
          <span className="text-[11px] font-bold text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums', fontFamily: DISPLAY_FONT }}>{rank}</span>
        )}
      </div>
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: 'var(--color-bg-elevated, var(--color-bg-card))' }}>
        {entry.avatar ? (
          <img src={entry.avatar} alt={entry.name || t('leaderboard.userAvatar', { defaultValue: 'User avatar' })} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] font-bold text-[var(--color-text-muted)]">{entry.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
        )}
      </div>
      <p className={`flex-1 text-[12px] font-medium truncate ${isMe ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
        {isMe ? t('leaderboard.you') : entry.name}
      </p>
      <span className={`text-[12px] font-bold flex-shrink-0 ${rank === 1 ? '' : 'text-[var(--color-text-muted)]'}`} style={{ fontVariantNumeric: 'tabular-nums', fontFamily: DISPLAY_FONT, ...(rank === 1 ? { color: ACCENT } : {}) }}>
        {/* Most Improved now returns the absolute delta (lbs/sessions), not a
            percentage — render with the metric's unit so newcomers and
            improvers are comparable on the same scale. Consistency stays as a %. */}
        {isImproved ? `+${formatStatNumber(entry.score)}` : isConsistency ? `${entry.score}%` : formatStatNumber(entry.score)}
        {unit && !isConsistency && <span className="text-[10px] font-normal text-[var(--color-text-subtle)] ml-0.5">{unit}</span>}
      </span>
    </div>
  );
};

// ── Category preview card ───────────────────────────────────
const CategoryCard = ({ icon: Icon, iconColor, title, subtitle, entries, loading, userId, unit, isImproved, isConsistency, myEntry, onExpand, t }) => (
  <div className="rounded-[22px] overflow-hidden transition-colors duration-200 border" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border, rgba(200,200,200,0.1))', boxShadow: CARD_SHADOW }}>
    {/* Header */}
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${iconColor} 10%, transparent)` }}>
          <Icon size={15} style={{ color: iconColor }} />
        </div>
        <div>
          <p className="text-[17px] text-[var(--color-text-primary)]" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.3px' }}>{title}</p>
          <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">{subtitle}</p>
        </div>
      </div>
      <button onClick={onExpand} className="flex items-center gap-0.5 text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors min-h-[44px] focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none rounded-lg px-2">
        {t('leaderboard.seeAll')} <ChevronRight size={12} />
      </button>
    </div>

    {/* Content */}
    <div className="px-5 pb-4">
      {loading ? (
        <div className="space-y-2 py-2">{[1,2,3].map(i => <div key={i} className="h-8 rounded-lg animate-pulse" style={{ background: 'var(--color-bg-elevated, var(--color-bg-card))' }} />)}</div>
      ) : !entries || entries.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-subtle)] py-4 text-center">{t('leaderboard.noActivityYet')}</p>
      ) : (
        <>
          {entries.slice(0, 3).map((e, i) => (
            <MiniEntry key={e.id} entry={e} rank={i + 1} userId={userId} unit={unit} isImproved={isImproved} isConsistency={isConsistency} t={t} />
          ))}
          {/* Show my position if not in top 3 */}
          {myEntry && !entries.slice(0, 3).some(e => e.id === userId) && (
            <div className="mt-1 pt-1" style={{ borderTop: '1px dashed var(--color-border, rgba(200,200,200,0.08))' }}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>{t('leaderboard.yourPosition')}</span>
              </div>
              <MiniEntry entry={myEntry.entry} rank={myEntry.rank} userId={userId} unit={unit} isImproved={isImproved} isConsistency={isConsistency} t={t} />
            </div>
          )}
        </>
      )}
    </div>
  </div>
);

// ── Virtualized row for the expanded list ──────────────────
// Memoized so react-window can recycle DOM nodes without re-rendering rows
// whose props haven't changed. Row height is fixed at 60px (12px padding ×2
// + 36px avatar) — keep ROW_HEIGHT in sync with the padding/avatar values.
const ROW_HEIGHT = 60;

const ExpandedListRow = React.memo(function ExpandedListRow({ index, style, entries, userId, unit, isImproved, isConsistency, friendIds, pendingIds, canChallenge, onChallenge, t }) {
  const entry = entries[index];
  const rank = index + 1;
  const isMe = entry.id === userId;
  const isLast = index === entries.length - 1;
  const isFriend = friendIds.has(entry.id);
  const isPending = pendingIds?.has(entry.id) ?? false;

  return (
    <div
      style={{
        ...style,
        display: 'flex', alignItems: 'center', padding: '12px 16px',
        background: isMe ? 'color-mix(in srgb, var(--color-accent, #2EC4C4) 8%, var(--color-bg-card))' : 'transparent',
        ...(!isLast ? { borderBottom: '1px solid var(--color-border, rgba(200,200,200,0.08))' } : {}),
        boxSizing: 'border-box',
      }}
    >
      {/* Rank number */}
      <span style={{ width: 28, textAlign: 'center', fontFamily: DISPLAY_FONT, fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
      {/* Avatar */}
      <div style={{ width: 36, height: 36, borderRadius: 999, marginLeft: 10, marginRight: 10, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: rank <= 3 ? ['#FFD166','var(--color-border-strong, #888)','#CD7F32'][rank-1] : 'var(--color-bg-elevated, var(--color-bg-card))' }}>
        {entry.avatar ? (
          <img src={entry.avatar} alt={entry.name || t('leaderboard.userAvatar', { defaultValue: 'User avatar' })} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: rank === 1 ? '#1D1D1F' : rank <= 3 ? '#fff' : 'var(--color-text-muted)' }}>{entry.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
        )}
      </div>
      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isMe ? t('leaderboard.you') : entry.name}
          {isMe && <span style={{ fontSize: 10, fontWeight: 800, color: ACCENT, letterSpacing: 0.8, marginLeft: 6 }}>{t('leaderboard.you')}</span>}
        </p>
        {isConsistency && entry.actual_days != null && (
          <p style={{ fontSize: 10, color: 'var(--color-text-subtle)' }}>{t('leaderboard.ofDays', { actual: entry.actual_days, planned: entry.planned_days })}</p>
        )}
        {isImproved && entry.previous_value != null && (
          <p style={{ fontSize: 10, color: 'var(--color-text-subtle)' }}>{formatStatNumber(Math.round(entry.previous_value))} → {formatStatNumber(Math.round(entry.current_value))}</p>
        )}
      </div>
      {/* Score */}
      <span style={{ fontFamily: DISPLAY_FONT, fontSize: 16, fontWeight: 800, color: ACCENT, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {isImproved ? `+${formatStatNumber(entry.score)}` : isConsistency ? `${entry.score}%` : formatStatNumber(entry.score)}
        {unit && !isConsistency && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-subtle)', marginLeft: 4 }}>{unit}</span>}
      </span>
      {/* Challenge / Add Friend / Pending button.
          Shows: a pill with "Pending" while a sent-but-not-accepted request
          is in flight (or already pending from earlier in the session); a
          swords icon for accepted friends (challenge); a UserPlus icon to
          send a new friend request. The pending state is intentionally wider
          than the icon-only buttons so the localized label fits.
          Anonymized (non-friend) rows show no action — you can't add someone
          you can't see; friends are never anonymized so they keep Challenge. */}
      {!isMe && canChallenge && !entry.anon && (
        isPending && !isFriend ? (
          <span
            aria-label={t('leaderboard.friendRequestPending', 'Pending')}
            style={{
              height: 32,
              padding: '0 10px',
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginLeft: 8,
              background: 'color-mix(in srgb, var(--color-text-muted) 12%, transparent)',
              color: 'var(--color-text-muted)',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: DISPLAY_FONT,
              letterSpacing: 0.2,
            }}
          >
            {t('leaderboard.friendRequestPending', 'Pending')}
          </span>
        ) : (
          <button
            onClick={() => onChallenge(entry, isFriend)}
            aria-label={isFriend ? t('leaderboard.challengeFriend.challenge') : t('leaderboard.challengeFriend.addFriend')}
            className="focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none"
            style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 8, transition: 'background 0.2s', background: isFriend ? 'color-mix(in srgb, var(--color-accent) 7%, transparent)' : 'color-mix(in srgb, var(--color-blue) 7%, transparent)', border: 'none', cursor: 'pointer' }}
          >
            {isFriend ? (
              <Swords size={13} style={{ color: 'var(--color-accent)' }} />
            ) : (
              <UserPlus size={13} style={{ color: 'var(--color-blue)' }} />
            )}
          </button>
        )
      )}
    </div>
  );
});

// ── Expanded full list modal ────────────────────────────────
const ExpandedList = ({ title, icon: Icon, iconColor, entries, loading, userId, unit, isImproved, isConsistency, onClose, timeRange, setTimeRange, availableTimes, boardKey, friendIds, pendingIds, gymId, userName, onChallenge, onSendFriendRequest, t }) => {
  useScrollLock(true); // lock background scroll while the expanded board modal is open
  const metric = BOARD_TO_METRIC[boardKey];
  const canChallenge = !!metric; // Only volume, workouts, prs can be challenged

  // rowProps passed to react-window — memoized so memoized rows skip re-renders
  // when the list re-renders for unrelated reasons (e.g. timeRange button hover).
  // react-window v2 spreads these props onto the row component (alongside index/style).
  const rowProps = useMemo(() => ({
    entries: entries || [],
    userId,
    unit,
    isImproved,
    isConsistency,
    friendIds,
    pendingIds,
    canChallenge,
    onChallenge,
    t,
  }), [entries, userId, unit, isImproved, isConsistency, friendIds, pendingIds, canChallenge, onChallenge, t]);

  // Compute virtualized list height: viewport minus header chrome (~250px
  // covers status bar, modal header, time tabs, padding). Falls back for SSR.
  // Capped at 60vh because the modal itself maxes at 85vh.
  const listHeight = typeof window !== 'undefined'
    ? Math.max(300, Math.min(window.innerHeight - 280, Math.round(window.innerHeight * 0.6)))
    : 500;

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
        style={{ width: '92%', maxWidth: 500, maxHeight: '85vh', background: 'var(--color-bg-primary)', borderRadius: 22, border: '1px solid var(--color-border, rgba(200,200,200,0.1))', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}
      >
      {/* Header — not scrollable */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--color-border, rgba(200,200,200,0.1))' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${iconColor} 10%, transparent)` }}>
              <Icon size={15} style={{ color: iconColor }} />
            </div>
            <h2 id="leaderboard-expanded-title" className="text-[var(--color-text-primary)]" style={{ fontSize: 18, fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.4px' }}>{title}</h2>
          </div>
          <button onClick={onClose} aria-label={t('leaderboard.closeLeaderboard', { defaultValue: 'Close leaderboard' })} className="w-11 h-11 rounded-full flex items-center justify-center transition-colors duration-200 focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none" style={{ background: 'var(--color-bg-elevated, var(--color-bg-card))' }}>
            <X size={16} className="text-[var(--color-text-muted)]" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <div style={{ display: 'flex', background: 'var(--color-bg-elevated, var(--color-bg-card))', borderRadius: 12, padding: 3 }}>
            {availableTimes.map(opt => (
              <button
                key={opt.key}
                onClick={() => setTimeRange(opt.key)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '8px 0',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  transition: 'all 0.2s',
                  border: 'none',
                  cursor: 'pointer',
                  ...(timeRange === opt.key
                    ? { background: 'var(--color-bg-card, #fff)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', color: 'var(--color-text-primary)' }
                    : { background: 'transparent', color: 'var(--color-text-muted)' }),
                }}
              >
                {t(`leaderboard.timeOptions.${opt.key}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable list — virtualization handles its own scrolling so the
          outer wrapper no longer needs overflow:auto. Loading/empty states
          stay non-virtualized since they have a fixed small render cost. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {loading ? (
          <div className="px-4 pt-3 pb-28" style={{ padding: '12px 16px 112px', overflowY: 'auto' }}>
            <div className="space-y-2">{[1,2,3,4,5,6,7,8].map(i => <div key={i} className="h-[52px] rounded-[14px] animate-pulse" style={{ background: 'var(--color-bg-card)' }} />)}</div>
          </div>
        ) : !entries || entries.length === 0 ? (
          <div className="text-center py-20">
            <Trophy size={28} className="text-[var(--color-text-subtle)] mx-auto mb-2" />
            <p className="text-[13px] text-[var(--color-text-muted)]">{t('leaderboard.noActivityPeriod')}</p>
          </div>
        ) : (
          <div style={{ flex: 1, padding: '12px 16px 16px', minHeight: 0, display: 'flex' }}>
            <div style={{ flex: 1, borderRadius: 22, overflow: 'hidden', background: 'var(--color-bg-card)', border: '1px solid var(--color-border, rgba(200,200,200,0.1))', height: listHeight }}>
              <VirtualList
                rowComponent={ExpandedListRow}
                rowCount={entries.length}
                rowHeight={ROW_HEIGHT}
                rowProps={rowProps}
                overscanCount={4}
                style={{ height: '100%', width: '100%' }}
              />
            </div>
          </div>
        )}
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
  const { showToast } = useToast();
  const gymId = profile?.gym_id;
  const uid = user?.id;

  const posthog = usePostHog();
  const queryClient = useQueryClient();
  useEffect(() => { document.title = `${t('leaderboard.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Realtime — when anyone in the gym finishes a workout, hits a PR, or
  // checks in, invalidate every leaderboard cache so the page repaints with
  // the new standings without the user having to leave & re-enter.
  // Same channel covers workout_sessions, personal_records, check_ins inserts
  // so we keep a single Realtime connection open per page mount.
  useEffect(() => {
    if (!gymId) return;
    // Coalesce bursts (a busy gym fires workout/PR/check-in inserts constantly)
    // into a single trailing invalidation, and skip entirely while the app is
    // backgrounded — Leaderboard is keep-alive, so without this every gym event
    // refetched up to ~13 leaderboard RPCs with nobody looking.
    let invalidateTimer;
    const invalidateAll = () => {
      clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        if (document.hidden) return;
        const keys = [
          'leaderboard',
          'leaderboard-improved',
          'leaderboard-consistency',
          'leaderboard-prs',
          'leaderboard-checkins',
          'leaderboard-newcomers',
        ];
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: [key], exact: false });
        }
      }, 4000);
    };
    const channel = supabase
      .channel(`leaderboard-${gymId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'workout_sessions',
        filter: `gym_id=eq.${gymId}`,
      }, invalidateAll)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'personal_records',
        filter: `gym_id=eq.${gymId}`,
      }, invalidateAll)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'check_ins',
        filter: `gym_id=eq.${gymId}`,
      }, invalidateAll)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'streak_cache',
        filter: `gym_id=eq.${gymId}`,
      }, invalidateAll)
      .subscribe();
    return () => { clearTimeout(invalidateTimer); supabase.removeChannel(channel); };
  }, [gymId, queryClient]);

  const [expanded, setExpanded] = useState(null); // which board is expanded
  const [exTimeRange, setExTimeRange] = useState('weekly');
  const [challengeTarget, setChallengeTarget] = useState(null); // { entry, isFriend }
  const [friendIds, setFriendIds] = useState(new Set());
  // Tracks user ids the viewer has sent a friend request to during this
  // session. Lets us flip the row's "Add friend" affordance to "Pending"
  // immediately after the insert succeeds, without re-fetching friendships.
  const [pendingFriendRequests, setPendingFriendRequests] = useState(new Set());

  // Fetch friend IDs for the current user
  useEffect(() => {
    if (!uid) return;
    // SECURITY: uid comes from supabase.auth (user.id), not user input.
    // Validate UUID format as a defense-in-depth measure before interpolating into .or() filter.
    if (!/^[0-9a-f-]{36}$/i.test(uid)) return;
    supabase
      .from('friendships')
      .select('requester_id, addressee_id, status')
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
      .in('status', ['accepted', 'pending'])
      .then(({ data }) => {
        if (!data) return;
        const accepted = new Set();
        const pending = new Set();
        for (const f of data) {
          const other = f.requester_id === uid ? f.addressee_id : f.requester_id;
          if (f.status === 'accepted') accepted.add(other);
          else pending.add(other);
        }
        setFriendIds(accepted);
        // Seed PRE-EXISTING pending requests (either direction). The
        // optimistic set only knew about requests sent THIS session, so
        // members with an older pending row still showed "Add friend" and
        // tapping it blew up on friendships_unique (23505).
        setPendingFriendRequests(prev => new Set([...prev, ...pending]));
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
  // Only the currently-expanded board fetches. Passing null gymId disables the
  // hook (each is `enabled: !!gymId`), so opening Leaderboard no longer fires
  // ~7 extra RPCs up front — they load on demand when a board is opened.
  const exVolume     = useLeaderboard(expanded === 'volume' ? gymId : null, 'volume', exStart);
  const exWorkouts   = useLeaderboard(expanded === 'workouts' ? gymId : null, 'workouts', exStart);
  const exStreak     = useLeaderboard(expanded === 'streak' ? gymId : null, 'streak', null);
  const exImproved   = useLeaderboardMostImproved(expanded === 'improved' ? gymId : null, 'volume', exPeriod);
  const exConsistency = useLeaderboardConsistency(expanded === 'consistency' ? gymId : null, exPeriod);
  const exPrs        = useLeaderboardPrs(expanded === 'prs' ? gymId : null, exStart);
  const exCheckins   = useLeaderboardCheckins(expanded === 'checkins' ? gymId : null, exStart);

  // Normalize streak entries
  const normalizeStreak = (data) => {
    if (!data) return [];
    return data.map(s => s.profile_id ? { id: s.profile_id, name: s.profiles?.full_name || s.profiles?.username || t('leaderboard.unknownUser', { defaultValue: 'Unknown' }), avatar: s.profiles?.avatar_url, score: s.current_streak_days } : s);
  };

  const streakEntries   = useMemo(() => normalizeStreak(streak.data), [streak.data]);
  const exStreakEntries  = useMemo(() => normalizeStreak(exStreak.data), [exStreak.data]);

  // ── Privacy: reveal identity only for the viewer + their friends ──────────
  // The leaderboard RPCs return every gym member's real name + avatar, but a
  // member should only RECOGNIZE themselves and their friends — everyone else
  // shows as an anonymous "Member" (their rank + score stay visible so the
  // ranking is intact). Applied to the DATA so every surface — podium, preview
  // cards, expanded list — is consistent. friendIds may still be empty on first
  // paint; friends reveal automatically once it loads (it's in the deps).
  // Gym leaderboards show every listed member's real name + avatar. Members who
  // don't want to appear opt out via the leaderboard-visibility toggle, which
  // the RPCs already enforce (WHERE p.leaderboard_visible = TRUE) — so everyone
  // shown has consented. (Previously non-friends were blanked to an anonymous
  // "Member", which isn't useful for a gym community.)
  const anonymize = useCallback((entries) => entries, []);

  const aVolume       = useMemo(() => anonymize(volume.data),       [volume.data, anonymize]);
  const aWorkouts     = useMemo(() => anonymize(workouts.data),     [workouts.data, anonymize]);
  const aImproved     = useMemo(() => anonymize(improved.data),     [improved.data, anonymize]);
  const aConsistency  = useMemo(() => anonymize(consistency.data),  [consistency.data, anonymize]);
  const aPrs          = useMemo(() => anonymize(prs.data),          [prs.data, anonymize]);
  const aCheckins     = useMemo(() => anonymize(checkins.data),     [checkins.data, anonymize]);
  const aStreak       = useMemo(() => anonymize(streakEntries),     [streakEntries, anonymize]);
  const aExVolume      = useMemo(() => anonymize(exVolume.data),      [exVolume.data, anonymize]);
  const aExWorkouts    = useMemo(() => anonymize(exWorkouts.data),    [exWorkouts.data, anonymize]);
  const aExImproved    = useMemo(() => anonymize(exImproved.data),    [exImproved.data, anonymize]);
  const aExConsistency = useMemo(() => anonymize(exConsistency.data), [exConsistency.data, anonymize]);
  const aExPrs         = useMemo(() => anonymize(exPrs.data),         [exPrs.data, anonymize]);
  const aExCheckins    = useMemo(() => anonymize(exCheckins.data),    [exCheckins.data, anonymize]);
  const aExStreak      = useMemo(() => anonymize(exStreakEntries),    [exStreakEntries, anonymize]);

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

  // Board configs for expansion. Unit strings are translated so the expanded
  // list ("Sesiones" / "Sessions") matches the user's locale.
  const tUnitLbs      = t('leaderboard.units.lbs', 'lbs');
  const tUnitSessions = t('leaderboard.units.sessions', 'sessions');
  const tUnitDays     = t('leaderboard.units.days', 'days');
  const tUnitPrs      = t('leaderboard.units.PRs', 'PRs');
  const BOARDS = {
    volume:      { title: t('leaderboard.categories.volume'),       icon: BarChart2,    iconColor: 'var(--color-blue)', unit: tUnitLbs,       data: aExVolume,         loading: exVolume.isLoading,      times: TIME_OPTIONS },
    workouts:    { title: t('leaderboard.categories.workouts'),     icon: Dumbbell,     iconColor: '#8B5CF6', unit: tUnitSessions,  data: aExWorkouts,       loading: exWorkouts.isLoading,    times: TIME_OPTIONS },
    streak:      { title: t('leaderboard.categories.streak'),       icon: Flame,        iconColor: 'var(--color-danger)', unit: tUnitDays,      data: aExStreak,        loading: exStreak.isLoading,      times: [TIME_OPTIONS[2]] },
    improved:    { title: t('leaderboard.categories.improved'),     icon: TrendingUp,   iconColor: ACCENT,    unit: tUnitLbs,       data: aExImproved,       loading: exImproved.isLoading,    times: TIME_OPTIONS.slice(0,2), isImproved: true },
    consistency: { title: t('leaderboard.categories.consistency'),  icon: Target,       iconColor: 'var(--color-warning)', unit: '',          data: aExConsistency,    loading: exConsistency.isLoading, times: TIME_OPTIONS.slice(0,2), isConsistency: true },
    prs:         { title: t('leaderboard.categories.prs'),          icon: Trophy,       iconColor: GOLD,      unit: tUnitPrs,       data: aExPrs,            loading: exPrs.isLoading,         times: TIME_OPTIONS },
    checkins:    { title: t('leaderboard.categories.checkins'),     icon: MapPin,       iconColor: '#06B6D4', unit: tUnitDays,      data: aExCheckins,       loading: exCheckins.isLoading,    times: TIME_OPTIONS },
  };

  const handleExpand = (key) => {
    setExTimeRange('weekly');
    setExpanded(key);
    posthog?.capture('leaderboard_viewed', { category: key });
  };

  const handleChallenge = useCallback((entry, isFriend) => {
    setChallengeTarget({ entry, isFriend });
  }, []);

  const handleSendFriendRequest = useCallback(async (targetId) => {
    if (!uid || !gymId || !targetId) return;
    // Optimistically mark the row as pending so the button flips immediately;
    // we'll roll back if the insert fails. RLS on `friendships` requires both
    // requester_id and gym_id to match the caller, so include both.
    setPendingFriendRequests(prev => {
      const next = new Set(prev);
      next.add(targetId);
      return next;
    });
    try {
      const { error } = await supabase.from('friendships').insert({
        requester_id: uid,
        addressee_id: targetId,
        gym_id: gymId,
        status: 'pending',
      });
      if (error) throw error;
      posthogClient?.capture('friend_request_sent', { source: 'leaderboard' });
      showToast(t('leaderboard.friendRequestSent', 'Friend request sent'));
    } catch (err) {
      // RLS or unique-constraint violations land here. Surface the underlying
      // error to the console so RLS misconfigurations are debuggable.
      console.error('[leaderboard] friend request insert failed:', err);
      if (String(err?.code) === '23505') {
        // A friendship row for this pair already exists (a pending request in
        // either direction). KEEP the row marked pending — rolling back just
        // re-offers a button that can never succeed.
        showToast(t('leaderboard.friendRequestExists', 'You already have a request with this member'));
        return;
      }
      setPendingFriendRequests(prev => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      showToast(t('leaderboard.friendRequestError', 'Could not send friend request'));
    }
  }, [uid, gymId, showToast, t]);

  // Metric label for the challenge modal
  const challengeMetricLabel = expanded && BOARD_TO_METRIC[expanded]
    ? t(`leaderboard.challengeFriend.metrics.${BOARD_TO_METRIC[expanded]}`)
    : '';

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[var(--color-bg-primary)] pb-28 md:pb-12'} animate-fade-in`}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4'}>

        {/* Title */}
        {!embedded && (
          <div className="pt-6 pb-5">
            <h1 className="text-[var(--color-text-primary)] truncate" style={{ fontSize: 22, fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.5px' }}>
              {t('leaderboard.title')}
            </h1>
            <p className="text-[14px] text-[var(--color-text-subtle)] mt-1">{t('leaderboard.thisWeekAtYourGym')}</p>
          </div>
        )}

        {/* ── Podium carousel ──
            Each "slide" is a 1st/2nd/3rd hero for one metric. Slides only
            render if the underlying leaderboard has ≥3 entries. Swipe or tap
            the dot indicators to switch metrics. The Volume/Workouts/PRs
            slides reset weekly; Streak is lifetime.                          */}
        <PodiumCarousel
          slides={[
            {
              id: 'volume',
              title: t('leaderboard.categories.volume', 'Volume'),
              subtitle: t('leaderboard.thisWeek', 'This week'),
              unit: t('leaderboard.units.lbs', 'lbs'),
              entries: aVolume,
            },
            {
              id: 'workouts',
              title: t('leaderboard.categories.workouts', 'Workouts'),
              subtitle: t('leaderboard.thisWeek', 'This week'),
              unit: t('leaderboard.units.sessions', 'sessions'),
              entries: aWorkouts,
            },
            {
              id: 'improved',
              title: t('leaderboard.categories.improved', 'Most Improved'),
              subtitle: t('leaderboard.thisWeek', 'This week'),
              unit: t('leaderboard.units.lbs', 'lbs'),
              entries: aImproved,
            },
            {
              id: 'consistency',
              title: t('leaderboard.categories.consistency', 'Consistency'),
              subtitle: t('leaderboard.thisWeek', 'This week'),
              unit: '%',
              entries: aConsistency,
            },
            {
              id: 'streak',
              title: t('leaderboard.categories.streak', 'Streak'),
              subtitle: t('leaderboard.allTime', 'All time'),
              unit: t('leaderboard.units.days', 'days'),
              entries: aStreak,
            },
            {
              id: 'prs',
              title: t('leaderboard.categories.prs', 'PRs'),
              subtitle: t('leaderboard.thisWeek', 'This week'),
              unit: t('leaderboard.units.prs', 'PRs'),
              entries: aPrs,
            },
            {
              id: 'checkins',
              title: t('leaderboard.categories.checkins', 'Check-ins'),
              subtitle: t('leaderboard.thisWeek', 'This week'),
              unit: t('leaderboard.units.days', 'days'),
              entries: aCheckins,
            },
          ]}
          shadow={CARD_SHADOW}
          displayFont={DISPLAY_FONT}
          t={t}
        />


        {/* ── Category Cards ── */}
        {!volume.isLoading && !workouts.isLoading && !streak.isLoading &&
         !improved.isLoading && !consistency.isLoading && !prs.isLoading && !checkins.isLoading &&
         (!volume.data?.length && !workouts.data?.length && !streakEntries?.length &&
          !improved.data?.length && !consistency.data?.length && !prs.data?.length && !checkins.data?.length) ? (
          <EmptyState
            icon={Trophy}
            title={t('leaderboard.emptyTitle', 'No leaderboard entries yet')}
            description={t('leaderboard.emptyDescription', 'Start working out to appear on the leaderboard!')}
          />
        ) : null}
        <div className="space-y-6">
          <CategoryCard
            icon={BarChart2} iconColor="var(--color-blue)" title={t('leaderboard.categories.volume')} subtitle={t('leaderboard.categories.volume_sub')}
            entries={aVolume} loading={volume.isLoading} userId={uid} unit={tUnitLbs}
            myEntry={findMe(aVolume)} onExpand={() => handleExpand('volume')} t={t}
          />
          <CategoryCard
            icon={Dumbbell} iconColor="#8B5CF6" title={t('leaderboard.categories.workouts')} subtitle={t('leaderboard.categories.workouts_sub')}
            entries={aWorkouts} loading={workouts.isLoading} userId={uid} unit={tUnitSessions}
            myEntry={findMe(aWorkouts)} onExpand={() => handleExpand('workouts')} t={t}
          />
          <CategoryCard
            icon={TrendingUp} iconColor={ACCENT} title={t('leaderboard.categories.improved')} subtitle={t('leaderboard.categories.improved_sub')}
            entries={aImproved} loading={improved.isLoading} userId={uid} isImproved unit={tUnitLbs}
            myEntry={findMe(aImproved)} onExpand={() => handleExpand('improved')} t={t}
          />
          <CategoryCard
            icon={Target} iconColor="var(--color-warning)" title={t('leaderboard.categories.consistency')} subtitle={t('leaderboard.categories.consistency_sub')}
            entries={aConsistency} loading={consistency.isLoading} userId={uid} isConsistency
            myEntry={findMe(aConsistency)} onExpand={() => handleExpand('consistency')} t={t}
          />
          <CategoryCard
            icon={Flame} iconColor="var(--color-danger)" title={t('leaderboard.categories.streak')} subtitle={t('leaderboard.categories.streak_sub')}
            entries={aStreak} loading={streak.isLoading} userId={uid} unit={tUnitDays}
            myEntry={findMe(aStreak)} onExpand={() => handleExpand('streak')} t={t}
          />
          <CategoryCard
            icon={Trophy} iconColor={GOLD} title={t('leaderboard.categories.prs')} subtitle={t('leaderboard.categories.prs_sub')}
            entries={aPrs} loading={prs.isLoading} userId={uid} unit={tUnitPrs}
            myEntry={findMe(aPrs)} onExpand={() => handleExpand('prs')} t={t}
          />
          <CategoryCard
            icon={MapPin} iconColor="#06B6D4" title={t('leaderboard.categories.checkins')} subtitle={t('leaderboard.categories.checkins_sub')}
            entries={aCheckins} loading={checkins.isLoading} userId={uid} unit={tUnitDays}
            myEntry={findMe(aCheckins)} onExpand={() => handleExpand('checkins')} t={t}
          />
        </div>

        {/* ── Highlights Feed ── */}
        {milestones.data && milestones.data.length > 0 && (
          <div className="mt-6">
            <p className="mb-3 px-1 text-[var(--color-text-muted)]" style={{ fontSize: 17, fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.3px' }}>{t('leaderboard.recentHighlights')}</p>
            <div className="rounded-[22px] overflow-hidden transition-colors duration-200 border" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border, rgba(200,200,200,0.1))', boxShadow: CARD_SHADOW }}>
              <div className="px-5 py-2">
                {milestones.data.slice(0, 5).map(entry => {
                  const cfg = MILESTONE_CFG[entry.type] ?? { icon: Sparkles, color: ACCENT, label: (d, t) => t('leaderboard.milestone') };
                  const MIcon = cfg.icon;
                  // Real names: get_milestone_feed already opt-in filters by
                  // leaderboard_visible, so everyone shown has consented.
                  const displayName = entry.name;
                  return (
                    <div key={entry.id} className="flex items-center gap-3 py-2.5 last:border-0" style={{ borderBottom: '1px solid var(--color-border, rgba(200,200,200,0.08))' }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${cfg.color} 10%, transparent)` }}>
                        <MIcon size={14} style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-[var(--color-text-primary)] truncate">{displayName}</p>
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
          pendingIds={pendingFriendRequests}
          gymId={gymId}
          userName={profile?.full_name || profile?.username || t('leaderboard.someoneFallback', { defaultValue: 'Someone' })}
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
          userName={profile?.full_name || profile?.username || t('leaderboard.someoneFallback', { defaultValue: 'Someone' })}
          isFriend={challengeTarget.isFriend}
          onClose={() => setChallengeTarget(null)}
          onSendFriendRequest={handleSendFriendRequest}
          t={t}
        />
      )}
    </div>
  );
};

// ── PodiumCarousel ────────────────────────────────────────────────────────
// Swipeable hero showing 1st/2nd/3rd for the active leaderboard metric.
// Renders with ANY number of entries (1, 2, or 3): missing positions show
// as "—" placeholder pedestals so the visual layout still reads as a
// podium. Swipe horizontally on mobile or tap the dots to switch metrics.
const PodiumCarousel = ({ slides, shadow, displayFont, t }) => {
  const [activeIdx, setActiveIdx] = React.useState(0);
  const startRef = React.useRef(null);

  // Only need at least one entry to be worth showing.
  const validSlides = React.useMemo(
    () => (slides || []).filter(s => Array.isArray(s.entries) && s.entries.length >= 1),
    [slides]
  );

  // If the active slide drops out of the valid list (e.g. data refresh),
  // snap back to the first one rather than showing a blank carousel.
  React.useEffect(() => {
    if (activeIdx >= validSlides.length) setActiveIdx(0);
  }, [validSlides.length, activeIdx]);

  // Horizontal swipe — same primitive used elsewhere; inlined to avoid
  // pulling a hook out of a modal that lives in /components.
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = (e) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    const dt = Date.now() - startRef.current.t;
    startRef.current = null;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.7) return;
    if (dt > 600) return;
    if (dx < 0 && activeIdx < validSlides.length - 1) setActiveIdx(activeIdx + 1);
    else if (dx > 0 && activeIdx > 0) setActiveIdx(activeIdx - 1);
  };

  if (validSlides.length === 0) return null;

  const slide = validSlides[Math.min(activeIdx, validSlides.length - 1)];
  const top3 = slide.entries.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]]; // 2nd | 1st | 3rd
  const PODIUM_HEIGHTS = [60, 80, 45];
  const PODIUM_BG = [
    'var(--color-border-strong, #888)',
    '#FFD166',
    'color-mix(in srgb, var(--color-accent, #2EC4C4) 18%, var(--color-bg-card))',
  ];
  const AVATAR_SIZES = [44, 54, 44];
  const RANKS_ORDERED = [2, 1, 3];
  // Brand-aware avatar ring backgrounds for the podium. Order: [2nd, 1st, 3rd]
  // matching RANKS_ORDERED above. Gold (1st) is intentionally semantic yellow,
  // not the gym accent — competition gold is universally understood. Silver uses
  // --color-border-strong to adapt light/dark. Bronze is standard #CD7F32.
  const AVATAR_COLORS = ['var(--color-border-strong, #888)', '#FFD166', '#CD7F32'];

  return (
    <div
      className="mb-4 overflow-hidden border"
      style={{
        borderRadius: 22,
        padding: 20,
        background: 'var(--color-bg-card)',
        borderColor: 'var(--color-border, rgba(200,200,200,0.1))',
        boxShadow: shadow,
        touchAction: 'pan-y', // claim horizontal, let vertical scroll through
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* Slide header — title + subtitle change with the active metric */}
      <div style={{ marginBottom: 14, textAlign: 'center' }}>
        <p style={{
          fontFamily: displayFont,
          fontSize: 15, fontWeight: 800, letterSpacing: -0.3,
          color: 'var(--color-text-primary)',
        }}>
          {slide.title}
        </p>
        <p style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginTop: 2,
        }}>
          {slide.subtitle}
        </p>
      </div>

      {/* Podium pedestals — keyed by slide.id so React re-mounts and any
          subtle entry animation runs on swap. */}
      <div
        key={slide.id}
        style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 8 }}
      >
        {podiumOrder.map((entry, i) => {
          const rank = RANKS_ORDERED[i];
          const avatarSize = AVATAR_SIZES[i];
          const isFirst = rank === 1;
          // Placeholder pedestal when this rank isn't filled — preserves
          // the podium silhouette in small / new gyms.
          if (!entry) {
            return (
              <div
                key={`${slide.id}-empty-${rank}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 0.45 }}
              >
                <div style={{
                  width: avatarSize, height: avatarSize, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginBottom: 6,
                  background: 'transparent',
                  border: '2px dashed var(--color-border-strong, rgba(120,120,120,0.5))',
                  color: 'var(--color-text-muted)',
                  fontSize: 18, fontWeight: 800,
                }}>—</div>
                <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)' }}>
                  {t('leaderboard.emptySlot', { defaultValue: '—' })}
                </p>
                <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  &nbsp;
                </p>
                <div style={{
                  width: '100%', height: PODIUM_HEIGHTS[i], marginTop: 8,
                  background: PODIUM_BG[i],
                  borderRadius: '8px 8px 0 0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0.55,
                }}>
                  <span style={{
                    fontFamily: displayFont,
                    fontSize: 22, fontWeight: 800,
                    color: isFirst ? '#000' : 'var(--color-text-primary)',
                    opacity: 0.5,
                  }}>{rank}</span>
                </div>
              </div>
            );
          }
          return (
            <div
              key={`${slide.id}-${entry.id}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              <div style={{
                width: avatarSize, height: avatarSize, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0, marginBottom: 6,
                background: AVATAR_COLORS[i],
                ...(isFirst ? { border: '3px solid #FFD166' } : {}),
              }}>
                {entry.avatar ? (
                  <img
                    src={entry.avatar}
                    alt={entry.name || t('leaderboard.userAvatar', { defaultValue: 'User avatar' })}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                  />
                ) : (
                  <span style={{ fontSize: isFirst ? 18 : 14, fontWeight: 800, color: '#fff' }}>
                    {entry.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                )}
              </div>
              <p style={{
                fontSize: 11, fontWeight: 800,
                color: 'var(--color-text-primary)',
                textAlign: 'center', lineHeight: 1.2,
                maxWidth: '100%', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {entry.name}
              </p>
              <p style={{
                fontSize: 10, fontWeight: 600,
                color: 'var(--color-text-muted)',
                textAlign: 'center', marginTop: 2,
              }}>
                {formatStatNumber(entry.score)} {slide.unit}
              </p>
              <div style={{
                width: '100%', height: PODIUM_HEIGHTS[i], marginTop: 8,
                background: PODIUM_BG[i],
                borderRadius: '8px 8px 0 0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: displayFont,
                  fontSize: 22, fontWeight: 800,
                  color: isFirst ? '#000' : 'var(--color-text-primary)',
                  opacity: isFirst ? 0.7 : 0.5,
                }}>
                  {rank}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dot indicators — only show if more than one slide is available */}
      {validSlides.length > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          marginTop: 16,
        }}>
          {validSlides.map((s, i) => {
            const isActive = i === activeIdx;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveIdx(i)}
                aria-label={t('leaderboard.viewSlide', { slide: s.title, defaultValue: `View ${s.title}` })}
                aria-current={isActive ? 'true' : 'false'}
                style={{
                  width: isActive ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  border: 'none',
                  padding: 0,
                  background: isActive
                    ? 'var(--color-accent, #2EC4C4)'
                    : 'var(--color-border-subtle, rgba(15,20,25,0.16))',
                  cursor: 'pointer',
                  transition: 'width 200ms cubic-bezier(0.2,0.8,0.2,1), background 200ms',
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
