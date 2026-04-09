import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageCircle, Trophy, Dumbbell, Zap, Send, Clock,
  Search, UserPlus, Check, X, Users, Flag, Gift,
  Image, Link, MoreHorizontal, EyeOff, VolumeX,
  AlertTriangle, Trash2, PenSquare, Ban,
  Footprints, Bike, Waves, CircleDot, TrendingUp,
  Droplets, PersonStanding, Flame,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';
import ReactionPicker from '../components/ReactionPicker';
import ProfilePreview from '../components/ProfilePreview';
import UserAvatar from '../components/UserAvatar';
import SwipeableTabView from '../components/SwipeableTabView';
import UnderlineTabs from '../components/UnderlineTabs';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import LoadMoreButton from '../components/LoadMoreButton';
import { timeAgoFine as timeAgo, fmtDuration } from '../lib/dateUtils';
import { takePhoto } from '../lib/takePhoto';

import { sanitize } from '../lib/sanitize';
import { validateImageFile } from '../lib/validateImage';
import { stripExif } from '../lib/stripExif';
import { ACHIEVEMENT_DEFS } from '../lib/achievements';
import { exName } from '../lib/exerciseName';

// ── Muted users (localStorage) ──────────────────────────────────────────────
const MUTED_KEY = 'social_muted_users';
const getMutedUsers = () => {
  try { return JSON.parse(localStorage.getItem(MUTED_KEY) || '[]'); } catch { return []; }
};
const addMutedUser = (userId) => {
  const list = getMutedUsers();
  if (!list.includes(userId)) { list.push(userId); localStorage.setItem(MUTED_KEY, JSON.stringify(list)); }
  return list;
};

// ── Report reasons ──────────────────────────────────────────────────────────
const REPORT_REASONS = ['spam', 'inappropriate', 'harassment', 'other'];

// ── Report Modal ────────────────────────────────────────────────────────────
const ReportModal = ({ open, onClose, onSubmit, t }) => {
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    await onSubmit(selected);
    setSelected(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={t('social.report.title')} onClick={handleClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="presentation" />
      <div
        className="relative w-full max-w-[420px] mx-4 mb-4 sm:mb-0 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-bg-card)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
            <AlertTriangle size={20} className="text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('social.report.title')}</h3>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('social.report.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('social.report.cancel')}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Reason options */}
        <div className="px-5 pb-3 flex flex-col gap-2">
          {REPORT_REASONS.map(reason => (
            <button
              key={reason}
              type="button"
              onClick={() => setSelected(reason)}
              className={`w-full text-left px-4 py-3 rounded-xl text-[14px] font-medium transition-all duration-150 border ${
                selected === reason
                  ? 'bg-red-500/15 border-red-500/40 text-red-300'
                  : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.06]'
              }`}
              style={selected !== reason ? { color: 'var(--color-text-primary)' } : undefined}
            >
              {t(`social.report.reasons.${reason}`)}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 pb-5 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold bg-white/[0.06] hover:bg-white/[0.08] transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('social.report.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selected || submitting}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? t('social.report.submitting') : t('social.report.submit')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Engagement-based ranking ────────────────────────────────────────────────
const scoreFeedItem = (item, friendIds) => {
  const ageMs = Date.now() - new Date(item.created_at).getTime();
  const ageHours = ageMs / 3_600_000;
  // Recency: 10 points at 0h, decays to 0 over 24h
  const recency = Math.max(0, 10 * (1 - ageHours / 24));
  const reactionCount = Object.values(item.reactionCounts ?? {}).reduce((a, b) => a + b, 0);
  const commentCount = item.commentCount ?? 0;
  const isFriend = friendIds.has(item.actor_id) ? 5 : 0;
  const isPR = item.type === 'pr_hit' ? 3 : 0;
  return recency + reactionCount * 2 + commentCount * 3 + isFriend + isPR;
};

// ── Mention parser ──────────────────────────────────────────────────────────
const MENTION_RE = /@(\w+)/g;
const parseMentions = (text) => {
  const parts = [];
  let lastIdx = 0;
  let match;
  while ((match = MENTION_RE.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push({ type: 'text', value: text.slice(lastIdx, match.index) });
    parts.push({ type: 'mention', value: match[1] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push({ type: 'text', value: text.slice(lastIdx) });
  return parts;
};

const RichText = ({ text }) => {
  const parts = parseMentions(text);
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'mention' ? (
          <span key={i} className="text-[#D4AF37] font-semibold cursor-pointer">@{p.value}</span>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtVolume = (lbs, unit = 'lbs') => {
  if (!lbs) return `0 ${unit}`;
  return lbs >= 1000 ? `${(lbs / 1000).toFixed(1)}k ${unit}` : `${Math.round(lbs)} ${unit}`;
};

// ── Feed item content ─────────────────────────────────────────────────────────
const FeedContent = ({ type, data, t }) => {
  if (type === 'workout_completed') {
    return (
      <div className="rounded-2xl p-4 border-l-4 border-[#D4AF37] bg-white/[0.05]">
        <p className="font-bold text-[16px] leading-tight mb-3" style={{ color: 'var(--color-text-primary)' }}>
          {sanitize(data.routine_name ?? t('social.feedContent.workout'))}
        </p>
        <div className="flex flex-wrap gap-4">
          {data.duration_seconds > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Clock size={12} /> {fmtDuration(data.duration_seconds)}
            </span>
          )}
          {data.total_volume_lbs > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Zap size={12} /> {fmtVolume(data.total_volume_lbs, t('common:lbs'))}
            </span>
          )}
          {data.exercise_count > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Dumbbell size={12} /> {data.exercise_count} {data.exercise_count !== 1 ? t('social.feedContent.exercises') : t('social.feedContent.exercise')}
            </span>
          )}
          {data.set_count > 0 && (
            <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{data.set_count} {t('social.feedContent.setsLabel')}</span>
          )}
        </div>
      </div>
    );
  }

  if (type === 'pr_hit') {
    // Use localized exercise name: prefer exName helper if exercise object shape is available
    const localizedExName = exName({ name: data.exercise_name, name_es: data.exercise_name_es }) || data.exercise_name;
    return (
      <div className="rounded-2xl p-4 border-l-4 border-[#D4AF37] bg-white/[0.05]">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={14} className="text-[#D4AF37] flex-shrink-0" />
          <p className="font-bold text-[13px] text-[#D4AF37]">{t('social.feedContent.newPR')}</p>
        </div>
        <p className="font-black text-[20px]" style={{ color: 'var(--color-text-primary)' }}>{sanitize(localizedExName)}</p>
        <p className="text-[15px] font-semibold mt-1 text-[#D4AF37]">
          {data.weight_lbs} lbs × {data.reps}{' '}
          {data.estimated_1rm > 0 && (
            <span className="font-normal text-[13px]" style={{ color: 'var(--color-text-muted)' }}>· e1RM {Math.round(data.estimated_1rm)} lbs</span>
          )}
        </p>
      </div>
    );
  }

  if (type === 'achievement_unlocked') {
    // Use i18n keys stored in the feed item data; fall back to raw English strings
    const achDef = ACHIEVEMENT_DEFS.find(d => d.key === data.achievement_key);
    const achName = achDef?.labelKey
        ? t(achDef.labelKey, achDef.label)
        : data.achievement_name ?? t('social.feedContent.newAchievement');
    const achDesc = achDef?.descKey
        ? t(achDef.descKey, achDef.desc)
        : data.achievement_desc;
    return (
      <div className="rounded-2xl p-4 border-l-4 border-purple-500 bg-purple-900/20">
        <p className="font-bold text-[13px] mb-1" style={{ color: 'var(--color-text-primary)' }}>{t('social.feedContent.achievementUnlocked')} 🎖️</p>
        <p className="font-bold text-[16px]" style={{ color: 'var(--color-text-primary)' }}>{sanitize(achName)}</p>
        {achDesc && (
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{sanitize(achDesc)}</p>
        )}
      </div>
    );
  }

  if (type === 'cardio_completed') {
    const CARDIO_ICONS = {
      running: Footprints, cycling: Bike, rowing: Waves, elliptical: CircleDot,
      stair_climber: TrendingUp, jump_rope: Zap, swimming: Droplets,
      walking: PersonStanding, hiit: Flame,
    };
    const CardioIcon = CARDIO_ICONS[data.cardio_type] || Footprints;
    const durationMin = data.duration_seconds ? Math.round(data.duration_seconds / 60) : 0;
    const typeName = t(`cardio.types.${data.cardio_type}`, data.cardio_type);
    return (
      <div className="rounded-2xl p-4 border-l-4 border-emerald-400 bg-emerald-900/20">
        <div className="flex items-center gap-2 mb-2">
          <CardioIcon size={16} className="text-emerald-400 flex-shrink-0" />
          <p className="font-bold text-[13px] text-emerald-400">
            {t('cardio.feedCompleted', { duration: durationMin, type: typeName })}
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          {data.distance_km > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('cardio.feedDistance', { distance: data.distance_km.toFixed(1) })}
            </span>
          )}
          {data.calories_burned > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Flame size={12} /> {t('cardio.feedCalories', { calories: data.calories_burned })}
            </span>
          )}
          {durationMin > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Clock size={12} /> {durationMin} min
            </span>
          )}
        </div>
      </div>
    );
  }

  if (type === 'check_in') {
    return (
      <div className="rounded-2xl p-4 border-l-4 border-emerald-500 bg-emerald-900/20">
        <p className="font-semibold text-[15px]" style={{ color: 'var(--color-text-primary)' }}>
          ✅ {t('social.feedContent.checkedIn')}{data.gym_name ? ` — ${sanitize(data.gym_name)}` : ''}
        </p>
      </div>
    );
  }

  if (type === 'program_started') {
    return (
      <div className="rounded-2xl p-4 border-l-4 border-blue-500 bg-blue-900/20">
        <p className="font-semibold text-[15px]" style={{ color: 'var(--color-text-primary)' }}>
          {t('social.feedContent.started')} <span className="font-bold">{sanitize(data.program_name ?? t('social.feedContent.aNewProgram'))}</span>
        </p>
      </div>
    );
  }

  if (type === 'user_post') {
    return (
      <div className="space-y-3">
        {data.body && (
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text-primary)' }}>
            <RichText text={sanitize(data.body)} />
          </p>
        )}
        {data.photo_url && (
          <img
            src={data.photo_url}
            alt={data.body ? `${t('social.postImage')}: ${data.body.slice(0, 80)}` : t('social.postImage')}
            className="w-full rounded-xl object-cover max-h-[400px]"
            loading="lazy"
          />
        )}
        {data.workout_name && (
          <div className="rounded-2xl p-3 border-l-4 border-[#D4AF37] bg-white/[0.05]">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{sanitize(data.workout_name)}</p>
            <div className="flex gap-3 mt-1">
              {data.duration_seconds > 0 && (
                <span className="text-[12px] flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}><Clock size={11} /> {fmtDuration(data.duration_seconds)}</span>
              )}
              {data.total_volume_lbs > 0 && (
                <span className="text-[12px] flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}><Zap size={11} /> {fmtVolume(data.total_volume_lbs, t('common:lbs'))}</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--color-bg-card)' }}>
      <p className="text-[14px]" style={{ color: 'var(--color-text-muted)' }}>{type.replace(/_/g, ' ')}</p>
    </div>
  );
};

// ── Avatar (delegates to shared UserAvatar) ──────────────────────────────────
const Avatar = React.memo(({ src, name, size = 44, avatarType, avatarValue }) => {
  const user = {
    avatar_url: src,
    avatar_type: avatarType || (src ? 'photo' : 'color'),
    avatar_value: avatarValue || '#6366F1',
    full_name: name,
  };
  return <UserAvatar user={user} size={size} />;
});

// ── Friend status badge ───────────────────────────────────────────────────────
const FriendButton = ({ status, onAdd, onAccept, t }) => {
  if (status === 'accepted') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
        <Check size={12} strokeWidth={2.5} /> {t('social.friendStatus.friends')}
      </span>
    );
  }
  if (status === 'pending_sent') {
    return (
      <span className="flex items-center gap-1 text-[12px] font-medium flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
        <Clock size={12} /> {t('social.friendStatus.pending')}
      </span>
    );
  }
  if (status === 'pending_received' && onAccept) {
    return (
      <button
        type="button"
        onClick={onAccept}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 bg-emerald-500 text-white hover:bg-emerald-600"
      >
        <Check size={12} strokeWidth={2.5} /> {t('social.friendStatus.accept')}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 bg-[#D4AF37] text-black hover:opacity-90"
    >
      <UserPlus size={12} strokeWidth={2} /> {t('social.friendStatus.add')}
    </button>
  );
};

// ── Comment Item ──────────────────────────────────────────────────────────────
const CommentRow = ({ comment }) => (
  <div className="flex gap-3 py-2">
    <Avatar src={comment.profiles?.avatar_url} name={comment.profiles?.full_name ?? '?'} size={32} avatarType={comment.profiles?.avatar_type} avatarValue={comment.profiles?.avatar_value} />
    <div className="flex-1 rounded-2xl px-4 py-2.5 border border-white/[0.06]" style={{ background: 'var(--color-bg-card)' }}>
      <span className="font-semibold text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
        {comment.profiles?.full_name ?? 'Member'}{' '}
      </span>
      <span className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}><RichText text={sanitize(comment.content)} /></span>
    </div>
  </div>
);

// ── Feed Card ─────────────────────────────────────────────────────────────────
const FeedCard = React.memo(({ item, currentUserId, onToggleLike, onReact, onReport, onHide, onMute, onBlock, onDelete, onProfilePreview, reportedIds, t }) => {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments]         = useState(null);
  const [commentText, setCommentText]   = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [commentError, setCommentError] = useState('');
  const [showMenu, setShowMenu]         = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionResults, setMentionResults] = useState([]);
  const inputRef = useRef(null);
  const lastCommentTime = useRef(0);
  const menuRef = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  // Mention autocomplete — search friends when user types @
  useEffect(() => {
    if (mentionQuery === null || mentionQuery.length < 1) { setMentionResults([]); return; }
    const timer = setTimeout(async () => {
      const cleanQuery = mentionQuery.replace(/[%_\\,()."']/g, '');
      if (!cleanQuery) { setMentionResults([]); return; }
      const pattern = `%${cleanQuery}%`;
      const { data } = await supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
        .ilike('username', pattern)
        .limit(5);
      setMentionResults(data ?? []);
    }, 200);
    return () => clearTimeout(timer);
  }, [mentionQuery]);

  const handleCommentChange = (e) => {
    const val = e.target.value;
    setCommentText(val);
    // Detect @mention at caret
    const caret = e.target.selectionStart;
    const before = val.slice(0, caret);
    const atMatch = before.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
    } else {
      setMentionQuery(null);
      setMentionResults([]);
    }
  };

  const insertMention = (username) => {
    const caret = inputRef.current?.selectionStart ?? commentText.length;
    const before = commentText.slice(0, caret);
    const after = commentText.slice(caret);
    const atIdx = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@${username} ` + after;
    setCommentText(newText);
    setMentionQuery(null);
    setMentionResults([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const loadComments = async () => {
    if (comments !== null) return;
    const { data } = await supabase
      .from('feed_comments')
      .select('id, content, created_at, profiles(full_name, avatar_url)')
      .eq('feed_item_id', item.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .limit(50);
    setComments(data ?? []);
  };

  const handleToggleComments = () => {
    if (!showComments) loadComments();
    setShowComments(s => !s);
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || submitting) return;
    setCommentError('');
    const content = commentText.trim();

    // Rate limit: 5 seconds between comments
    const now = Date.now();
    if (now - lastCommentTime.current < 5000) {
      setCommentError(t('social.commentRateLimit', 'Please wait a few seconds between comments'));
      return;
    }

    // Max length validation
    if (content.length > 500) {
      setCommentError(t('social.commentTooLong', 'Comment must be 500 characters or less'));
      return;
    }

    lastCommentTime.current = now;
    setSubmitting(true);
    setCommentText('');
    setMentionQuery(null);
    setMentionResults([]);
    const { data: newComment, error } = await supabase
      .from('feed_comments')
      .insert({ feed_item_id: item.id, profile_id: currentUserId, content })
      .select('id, content, created_at, profiles(full_name, avatar_url)')
      .single();
    if (!error && newComment) {
      setComments(prev => [...(prev ?? []), newComment]);
      // Send notifications for @mentions
      const mentions = [...content.matchAll(/@(\w+)/g)].map(m => m[1]);
      if (mentions.length > 0) {
        const { data: mentionedUsers } = await supabase
          .from('gym_member_profiles_safe')
          .select('id, username')
          .in('username', mentions)
          .limit(10);
        for (const mu of (mentionedUsers ?? [])) {
          if (mu.id !== currentUserId) {
            supabase.from('notifications').insert({
              profile_id: mu.id,
              type: 'mention',
              title: 'You were mentioned',
              body: content.slice(0, 100),
              data: { feed_item_id: item.id, commenter_id: currentUserId },
              dedup_key: `mention_${newComment.id}_${mu.id}`,
            }).then(() => {});
          }
        }
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06] transition-colors duration-200 hover:bg-white/[0.06]">

      {/* Header */}
      <div className="flex items-center gap-4 p-5 pb-4">
        <button type="button" onClick={() => onProfilePreview?.(item.actor_id)} aria-label={t('social.viewProfile', { name: item.profiles?.full_name ?? 'Gym Member' })} className="flex-shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
          <Avatar src={item.profiles?.avatar_url} name={item.profiles?.full_name ?? '?'} avatarType={item.profiles?.avatar_type} avatarValue={item.profiles?.avatar_value} />
        </button>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onProfilePreview?.(item.actor_id)}
            className="font-semibold text-[15px] leading-snug truncate max-w-[140px] block text-left hover:text-[#D4AF37] transition-colors focus:outline-none focus:ring-2 focus:ring-[#D4AF37] rounded"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {item.profiles?.full_name ?? 'Gym Member'}
          </button>
          <button
            type="button"
            onClick={() => onProfilePreview?.(item.actor_id)}
            className="text-[12px] mt-0.5 hover:text-[#D4AF37] transition-colors text-left focus:outline-none rounded block"
            style={{ color: 'var(--color-text-muted)' }}
          >
            @{item.profiles?.username ?? '—'} · {timeAgo(item.created_at)}
          </button>
        </div>
        {/* More menu */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setShowMenu(s => !s)}
            aria-label={t('social.moreOptions')}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <MoreHorizontal size={18} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-10 z-30 w-48 rounded-xl border border-white/10 shadow-xl overflow-hidden" style={{ background: 'var(--color-bg-card)' }}>
              <button
                type="button"
                onClick={() => { onHide(item.id); setShowMenu(false); }}
                className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] hover:bg-white/[0.06] transition-colors text-left"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <EyeOff size={15} style={{ color: 'var(--color-text-muted)' }} />
                {t('social.hidePost')}
              </button>
              {item.actor_id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => { onMute(item.actor_id, item.profiles?.full_name); setShowMenu(false); }}
                  className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] hover:bg-white/[0.06] transition-colors text-left border-t border-white/[0.06]"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <VolumeX size={15} style={{ color: 'var(--color-text-muted)' }} />
                  {t('social.muteUser', { name: item.profiles?.full_name?.split(' ')[0] ?? '' })}
                </button>
              )}
              {item.actor_id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => { onBlock(item.actor_id, item.profiles?.full_name); setShowMenu(false); }}
                  className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors text-left border-t border-white/[0.06]"
                >
                  <Ban size={15} className="text-red-400" />
                  {t('social.blockUser', { name: item.profiles?.full_name?.split(' ')[0] ?? '' })}
                </button>
              )}
              {item.actor_id === currentUserId && (
                <button
                  type="button"
                  onClick={() => { setConfirmDelete(true); setShowMenu(false); }}
                  className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors text-left border-t border-white/[0.06]"
                >
                  <Trash2 size={15} className="text-red-400" />
                  {t('social.deletePost')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-4">
        <FeedContent type={item.type} data={item.data ?? {}} t={t} />
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-6 px-5 py-3 border-t border-white/[0.06]">
        <ReactionPicker
          feedItemId={item.id}
          currentUserId={currentUserId}
          currentReaction={item.currentReaction ?? null}
          reactionCounts={item.reactionCounts ?? {}}
          onReact={onReact}
        />
        <button
          type="button"
          onClick={handleToggleComments}
          aria-label={t('social.comment')}
          aria-expanded={showComments}
          className={`flex items-center gap-2 text-[13px] font-semibold transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg ${showComments ? 'text-blue-400' : ''}`}
          style={!showComments ? { color: 'var(--color-text-subtle)' } : undefined}
        >
          <MessageCircle size={16} />
          {item.commentCount > 0 ? item.commentCount : t('social.comment')}
        </button>
        {item.actor_id !== currentUserId && (
          <button
            type="button"
            onClick={() => onReport(item.id)}
            aria-label={t('social.reportPost', 'Report post')}
            className={`flex items-center gap-2 text-[13px] font-semibold transition-colors ml-auto min-w-[44px] min-h-[44px] justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg ${
              reportedIds?.has(item.id) ? 'text-red-500' : 'text-[var(--color-text-muted,#6B7280)] hover:text-red-400'
            }`}
          >
            <Flag size={14} fill={reportedIds?.has(item.id) ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="px-5 py-4 border-t border-red-500/20 bg-red-900/10">
          <p className="text-[13px] text-red-300 font-semibold mb-3">{t('social.deleteConfirm')}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/[0.06] hover:bg-white/[0.08] transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {t('social.report.cancel')}
            </button>
            <button
              type="button"
              onClick={() => { onDelete(item.id); setConfirmDelete(false); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors"
            >
              {t('social.deletePost')}
            </button>
          </div>
        </div>
      )}

      {/* Comments section */}
      {showComments && (
        <div className="px-5 pb-5 pt-1 border-t border-white/[0.06]" style={{ background: 'color-mix(in srgb, var(--color-bg-card) 50%, transparent)' }}>
          <div className="pt-3 flex flex-col">
            {comments === null ? (
              <p className="text-[13px] py-3 text-center" role="status" aria-busy={true} style={{ color: 'var(--color-text-muted)' }}>{t('social.loading')}</p>
            ) : comments.length === 0 ? (
              <p className="text-[13px] py-2" style={{ color: 'var(--color-text-muted)' }}>{t('social.noCommentsYet')}</p>
            ) : (
              comments.map(c => <CommentRow key={c.id} comment={c} />)
            )}
          </div>
          {commentError && (
            <p className="text-[12px] text-red-400 mt-2 px-1">{commentError}</p>
          )}
          <div className="relative">
            {/* Mention autocomplete dropdown */}
            {mentionResults.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 rounded-xl border border-white/10 shadow-xl overflow-hidden z-20 max-h-[180px] overflow-y-auto" style={{ background: 'var(--color-bg-card)' }}>
                {mentionResults.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => insertMention(u.username)}
                    aria-label={`${t('social.mention', 'Mention')} @${u.username}`}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors"
                  >
                    <Avatar src={u.avatar_url} name={u.full_name ?? '?'} size={28} avatarType={u.avatar_type} avatarValue={u.avatar_value} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{u.full_name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>@{u.username}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={commentText}
                onChange={handleCommentChange}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmitComment()}
                placeholder={t('social.writeComment')}
                maxLength={500}
                aria-label={t('social.writeComment')}
                className="flex-1 rounded-xl px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37] border border-white/[0.06]"
                style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
              />
              <button
                type="button"
                onClick={handleSubmitComment}
                disabled={!commentText.trim() || submitting}
                aria-label={t('social.sendComment', 'Send comment')}
                className="w-11 h-11 rounded-xl flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all bg-[#D4AF37] text-black font-semibold focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Helper: get friendship status toward another profile ─────────────────────
const getFriendStatus = (friendships, userId, otherId) => {
  const f = friendships.find(
    (x) =>
      (x.requester_id === userId && x.addressee_id === otherId) ||
      (x.addressee_id === userId && x.requester_id === otherId)
  );
  if (!f) return 'none';
  if (f.status === 'accepted') return 'accepted';
  if (f.requester_id === userId) return 'pending_sent';
  return 'pending_received';
};

// ── Friends Panel ─────────────────────────────────────────────────────────────
const FriendsPanel = ({ userId, gymId, friendships, loadFriendships, onClose, t }) => {
  const [profiles, setProfiles] = useState({});
  const [requesters, setRequesters] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);

  const accepted = friendships.filter((f) => f.status === 'accepted');
  const incoming = friendships.filter((f) => f.addressee_id === userId && f.status === 'pending');

  // Load profiles for accepted friends
  useEffect(() => {
    if (!accepted.length) return;
    const ids = accepted.map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id));
    supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
      .in('id', ids)
      .limit(200)
      .then(({ data, error }) => {
        if (error) return;
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setProfiles(map);
      });
  }, [accepted, userId]);

  // Load requester profiles for incoming
  useEffect(() => {
    if (!incoming.length) return;
    const ids = incoming.map((f) => f.requester_id);
    supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
      .in('id', ids)
      .limit(100)
      .then(({ data, error }) => {
        if (error) return;
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setRequesters(map);
      });
  }, [incoming]);

  // Search gym members — debounced 300ms to reduce egress
  useEffect(() => {
    if (!gymId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      const raw = searchQuery.trim();
      const clean = raw.replace(/[%_\\,()."']/g, '');
      const pattern = `%${clean}%`;
      supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
        .neq('id', userId)
        .in('role', ['member', 'trainer'])
        .or(`full_name.ilike.${pattern},username.ilike.${pattern}`)
        .limit(20)
        .then(({ data, error }) => {
          setSearching(false);
          if (error) return;
          setSearchResults(data ?? []);
        })
        .catch(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [gymId, userId, searchQuery]);

  const handleAccept = async (friendshipId) => {
    setAcceptingId(friendshipId);
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    await loadFriendships();
    setAcceptingId(null);
  };

  const handleAddFriend = async (addresseeId) => {
    if (!gymId) return;
    setAddingId(addresseeId);
    await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: addresseeId,
      gym_id: gymId,
      status: 'pending',
    });
    await loadFriendships();
    setAddingId(null);
  };

  const incomingWithRequester = incoming.map((f) => ({ ...f, requester: requesters[f.requester_id] }));

  return (
    <div className="rounded-2xl overflow-hidden mb-6 bg-white/[0.04] border border-white/[0.06]">

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <p className="font-semibold text-[18px] truncate" style={{ color: 'var(--color-text-primary)' }}>
          {t('social.friendsButton')}
          {accepted.length > 0 && (
            <span className="font-normal ml-1.5" style={{ color: 'var(--color-text-subtle)' }}>· {accepted.length}</span>
          )}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('social.closeFriendsPanel', 'Close friends panel')}
          className="w-11 h-11 rounded-xl hover:bg-white/[0.06] transition-colors duration-200 flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-5 pb-5 space-y-6">
        {/* Add Friends — search same-gym members only */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('social.addFriends')}</p>
          <p className="text-[12px] mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('social.searchMembers')}</p>
          {!gymId ? (
            <div className="rounded-2xl bg-white/[0.05] border border-[#D4AF37]/30 px-4 py-3 text-[13px] text-[#D4AF37]">
              {t('social.noGymForFriends')}
            </div>
          ) : (
            <>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-subtle)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('social.searchPlaceholder')}
              aria-label={t('social.addFriends')}
              className="w-full rounded-xl border border-white/[0.06] pl-11 pr-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
            />
          </div>
          {searching && (
            <div className="mt-3 flex justify-center py-4" role="status" aria-busy={true} aria-label={t('social.searching', 'Searching')}>
              <div className="w-5 h-5 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          )}
          {!searching && searchQuery.trim() && (
            <div className="mt-3 space-y-1 max-h-[240px] overflow-y-auto">
              {searchResults.length === 0 ? (
                <p className="text-[13px] py-4 text-center" style={{ color: 'var(--color-text-muted)' }}>{t('social.noSearchResults')}</p>
              ) : (
                searchResults.map((p) => {
                  const status = getFriendStatus(friendships, userId, p.id);
                  const isAdding = addingId === p.id;
                  return (
                    <div key={p.id} className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-white/[0.06] transition-colors">
                      <Avatar src={p.avatar_url} name={p.full_name} size={40} avatarType={p.avatar_type} avatarValue={p.avatar_value} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{p.full_name}</p>
                        {p.username && (
                          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>@{p.username}</p>
                        )}
                      </div>
                      {status === 'accepted' ? (
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
                          <Check size={12} strokeWidth={2.5} /> {t('social.friendStatus.friends')}
                        </span>
                      ) : status === 'pending_sent' ? (
                        <span className="flex items-center gap-1 text-[12px] font-medium flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                          <Clock size={12} /> {t('social.friendStatus.pending')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddFriend(p.id)}
                          disabled={isAdding}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-[#D4AF37] text-black hover:opacity-90"
                        >
                          <UserPlus size={12} strokeWidth={2} /> {isAdding ? '…' : t('social.friendStatus.add')}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
            </>
          )}
        </div>

        {/* Incoming requests */}
        {incomingWithRequester.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('social.requests')}</p>
            <div className="space-y-1">
              {incomingWithRequester.map((f) => (
                <IncomingRequestRow
                  key={f.id}
                  friendship={f}
                  onAccept={() => handleAccept(f.id)}
                  isAccepting={acceptingId === f.id}
                  t={t}
                />
              ))}
            </div>
          </div>
        )}

        {/* Your friends list */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('social.yourFriends')}</p>
          {accepted.length === 0 ? (
            <div className="py-8 text-center rounded-2xl" style={{ background: 'var(--color-bg-card)' }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--color-bg-card)' }}>
                <Users size={24} style={{ color: 'var(--color-text-subtle)' }} />
              </div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('social.noFriendsYet')}</p>
              <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('social.noFriendsHint')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {accepted.map((f) => {
                const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id;
                const p = profiles[otherId];
                return (
                  <div key={f.id} className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-white/[0.06] transition-colors">
                    <Avatar src={p?.avatar_url} name={p?.full_name ?? '?'} size={44} avatarType={p?.avatar_type} avatarValue={p?.avatar_value} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {p?.full_name ?? <span style={{ color: 'var(--color-text-subtle)' }}>Loading…</span>}
                      </p>
                      {p?.username && (
                        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>@{p.username}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
                      <Check size={12} strokeWidth={2.5} /> {t('social.friendStatus.friends')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Incoming Request Row ───────────────────────────────────────────────────────
const IncomingRequestRow = ({ friendship, onAccept, isAccepting, t }) => {
  const p = friendship.requester;
  if (!p) return null;

  return (
    <div className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-white/[0.06] transition-colors">
      <Avatar src={p.avatar_url} name={p.full_name} size={40} avatarType={p.avatar_type} avatarValue={p.avatar_value} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{p.full_name}</p>
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>@{p.username}</p>
      </div>
      <button
        type="button"
        onClick={onAccept}
        disabled={isAccepting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-emerald-500 text-white hover:bg-emerald-600"
      >
        <Check size={12} strokeWidth={2.5} /> {isAccepting ? '…' : t('social.friendStatus.accept')}
      </button>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const SocialFeed = ({ embedded = false }) => {
  const { t } = useTranslation('pages');
  const { user, profile, gymName, gymLogoUrl } = useAuth();
  const { showToast } = useToast();
  const [feed, setFeed]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(true);
  const [friendships, setFriendships] = useState([]);
  const [showFriends, setShowFriends]   = useState(false);
  const FEED_TABS = ['forYou', 'mine'];
  const [tab, setTab]                 = useState('forYou');
  const [friendStreaks, setFriendStreaks] = useState([]);
  const [reportedIds, setReportedIds] = useState(new Set());
  const [hiddenIds, setHiddenIds]     = useState(new Set());
  const [mutedUsers, setMutedUsers]   = useState(() => new Set(getMutedUsers()));
  const [blockedUsers, setBlockedUsers] = useState(new Set());
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [previewUserId, setPreviewUserId] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const feedTabIndex = FEED_TABS.indexOf(tab);
  const handleFeedSwipe = (i) => setTab(FEED_TABS[i]);

  useEffect(() => { document.title = `Social Feed | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

  // Pre-load previously reported feed item IDs so flags render red on mount
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('content_reports')
      .select('feed_item_id')
      .eq('reporter_id', user.id)
      .eq('content_type', 'activity')
      .in('status', ['pending', 'reviewed'])
      .not('feed_item_id', 'is', null)
      .then(({ data }) => {
        if (data?.length) {
          setReportedIds(new Set(data.map(r => r.feed_item_id)));
        }
      });
  }, [user?.id]);

  // Load blocked users from DB
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', user.id)
      .then(({ data }) => {
        if (data?.length) setBlockedUsers(new Set(data.map(b => b.blocked_id)));
      });
  }, [user?.id]);

  // Load friendships for current user
  const loadFriendships = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    setFriendships(data ?? []);
  }, [user]);

  const PAGE_SIZE = 30;

  // Load feed — uses server-side RPCs (join-based) instead of .in() queries
  const loadFeed = useCallback(async (_fships, cursor = null) => {
    if (!user || !profile) return;

    // Fetch feed items and friend streaks in parallel (streaks only on first load)
    const [{ data: items }, streakResult] = await Promise.all([
      supabase.rpc('get_friend_feed', { p_limit: PAGE_SIZE, p_cursor: cursor || null }),
      !cursor ? supabase.rpc('get_friend_streaks') : Promise.resolve({ data: [] }),
    ]);

    if (!cursor && streakResult.data) {
      setFriendStreaks(streakResult.data);
    }

    if (!items?.length) {
      if (!cursor) setFeed([]);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    setHasMore(items.length === PAGE_SIZE);

    // Enrich with reactions + comment counts via server-side RPC
    const itemIds = items.map(i => i.id);
    const { data: enrichment } = await supabase.rpc('get_feed_enrichment', { p_item_ids: itemIds });

    const enrichmentMap = {};
    (enrichment ?? []).forEach(e => { enrichmentMap[e.feed_item_id] = e; });

    // Sign photo URLs for items that have storage paths (not full URLs)
    const photoPaths = items
      .filter(i => i.photo_url && !i.photo_url.startsWith('http'))
      .map(i => i.photo_url);
    const signedUrlMap = {};
    if (photoPaths.length > 0) {
      const { data: signedUrls } = await supabase.storage.from('social-posts').createSignedUrls(photoPaths, 3600);
      (signedUrls ?? []).forEach(s => {
        if (s.signedUrl) signedUrlMap[s.path] = s.signedUrl;
      });
    }

    const enriched = items.map(item => {
      const e = enrichmentMap[item.id] ?? {};
      return {
        ...item,
        // Replace storage paths with signed URLs; leave full URLs (legacy) as-is
        photo_url: item.photo_url
          ? (signedUrlMap[item.photo_url] || item.photo_url)
          : null,
        reactionCounts:  e.reaction_counts ?? {},
        currentReaction: e.my_reaction ?? null,
        commentCount:    e.comment_count ?? 0,
      };
    });

    if (cursor) {
      setFeed(prev => [...prev, ...enriched]);
    } else {
      setFeed(enriched);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [user, profile]);

  useEffect(() => {
    if (!user || !profile) return;
    const init = async () => {
      setLoading(true);
      const { data: fships } = await supabase
        .from('friendships')
        .select('id, requester_id, addressee_id, status')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .limit(500);
      const resolved = fships ?? [];
      setFriendships(resolved);
      await loadFeed(resolved);
    };
    init();
  }, [user, profile]);

  // When friendships change (accept/add), reload feed
  const handleFriendshipsChange = (updater) => {
    setFriendships(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Reload feed if new accepted friendship was added
      loadFeed(next);
      return next;
    });
  };

  const handleReact = async (feedItemId, reactionType) => {
    setFeed(prev => prev.map(item => {
      if (item.id !== feedItemId) return item;
      const counts = { ...(item.reactionCounts ?? {}) };
      const prev_reaction = item.currentReaction;

      if (prev_reaction === reactionType) {
        // Remove reaction (toggle off)
        counts[reactionType] = Math.max((counts[reactionType] ?? 1) - 1, 0);
        if (counts[reactionType] === 0) delete counts[reactionType];
        return { ...item, currentReaction: null, reactionCounts: counts };
      }
      // Remove old reaction if any
      if (prev_reaction) {
        counts[prev_reaction] = Math.max((counts[prev_reaction] ?? 1) - 1, 0);
        if (counts[prev_reaction] === 0) delete counts[prev_reaction];
      }
      // Add new reaction
      counts[reactionType] = (counts[reactionType] ?? 0) + 1;
      return { ...item, currentReaction: reactionType, reactionCounts: counts };
    }));

    // Find the current reaction before this action
    const currentItem = feed.find(i => i.id === feedItemId);
    const prevReaction = currentItem?.currentReaction;

    if (prevReaction === reactionType) {
      // Toggle off — delete
      await supabase.from('feed_reactions').delete()
        .eq('feed_item_id', feedItemId)
        .eq('profile_id', user.id);
    } else {
      // Upsert reaction
      if (prevReaction) {
        await supabase.from('feed_reactions').delete()
          .eq('feed_item_id', feedItemId)
          .eq('profile_id', user.id);
      }
      await supabase.from('feed_reactions').insert({
        feed_item_id: feedItemId,
        profile_id: user.id,
        reaction_type: reactionType,
      });
    }
  };

  const handleReport = useCallback(async (feedItemId) => {
    if (reportedIds.has(feedItemId)) {
      // Unflag — remove the report
      const { error, count } = await supabase
        .from('content_reports')
        .delete({ count: 'exact' })
        .eq('reporter_id', user.id)
        .eq('feed_item_id', feedItemId);
      if (!error && count > 0) {
        setReportedIds(prev => { const next = new Set(prev); next.delete(feedItemId); return next; });
        showToast(t('social.report.removed', 'Report removed'), 'success');
      } else if (!error && count === 0) {
        // Row was already gone (e.g. admin dismissed it) — clear local flag anyway
        setReportedIds(prev => { const next = new Set(prev); next.delete(feedItemId); return next; });
      } else {
        showToast(t('social.report.error', 'Could not remove report'), 'error');
      }
      return;
    }
    setReportTarget(feedItemId);
  }, [reportedIds, user?.id, showToast, t]);

  const handleReportSubmit = async (reason) => {
    if (!reportTarget) return;
    // Use only columns from the original content_reports table (migration 0038):
    // id, reporter_id, feed_item_id, gym_id, reason, status, created_at, reviewed_at
    const payload = {
      reporter_id: user.id,
      feed_item_id: reportTarget,
      gym_id: profile.gym_id,
      reason: reason || 'inappropriate',
    };

    const { error } = await supabase.from('content_reports').insert(payload);

    if (error) {
      if (error.code === '23505') {
        setReportedIds(prev => new Set([...prev, reportTarget]));
        showToast(t('social.report.alreadyReported'), 'info');
      } else {
        showToast(t('social.report.error'), 'error');
      }
    } else {
      setReportedIds(prev => new Set([...prev, reportTarget]));
      setHiddenIds(prev => new Set([...prev, reportTarget]));
      showToast(t('social.report.success'), 'success');
    }
    setReportTarget(null);
  };

  const handleHide = useCallback((itemId) => {
    setHiddenIds(prev => new Set([...prev, itemId]));
  }, []);

  const handleMute = useCallback((userId) => {
    const updated = addMutedUser(userId);
    setMutedUsers(new Set(updated));
  }, []);

  const handleBlock = useCallback(async (userId, name) => {
    await supabase.from('blocked_users').upsert(
      { blocker_id: user.id, blocked_id: userId },
      { onConflict: 'blocker_id,blocked_id' }
    );
    setBlockedUsers(prev => new Set([...prev, userId]));
    // Also remove from friends if they were friends
    await supabase.from('friendships').delete()
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${user.id})`);
    showToast(t('social.userBlocked', { name: name?.split(' ')[0] ?? '' }), 'success');
  }, [user?.id, showToast, t]);

  const handleDelete = useCallback(async (itemId) => {
    const { error } = await supabase
      .from('activity_feed_items')
      .delete()
      .eq('id', itemId)
      .eq('actor_id', user.id);
    if (!error) {
      setFeed(prev => prev.filter(item => item.id !== itemId));
      showToast(t('social.postDeleted'), 'success');
    } else {
      showToast(t('social.deleteError'), 'error');
    }
  }, [user, showToast, t]);

  const handleCreatePost = async ({ body, photoFile, workoutSession }) => {
    if (!user || !profile) return;
    let photo_url = null;
    let signedPhotoUrl = null;
    let storagePath = null;
    if (photoFile) {
      const validation = await validateImageFile(photoFile);
      if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
      }
      // Strip EXIF metadata (GPS, device info) before uploading
      const cleanPhoto = await stripExif(photoFile);
      storagePath = `social-posts/${user.id}/${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage.from('social-posts').upload(storagePath, cleanPhoto, { contentType: 'image/jpeg' });
      if (!uploadErr) {
        // Use signed URL (1 hour expiry) instead of public URL
        const { data: signedData } = await supabase.storage.from('social-posts').createSignedUrl(storagePath, 3600);
        signedPhotoUrl = signedData?.signedUrl ?? null;
        // Store the storage path in DB (not the signed URL)
        photo_url = storagePath;
      }
    }
    const itemData = {
      body: body || null,
      photo_url,
      ...(workoutSession ? {
        workout_name: workoutSession.routine_name,
        duration_seconds: workoutSession.duration_seconds,
        total_volume_lbs: workoutSession.total_volume_lbs,
        session_id: workoutSession.id,
      } : {}),
    };
    const { data: newItem, error } = await supabase
      .from('activity_feed_items')
      .insert({
        actor_id: user.id,
        gym_id: profile.gym_id,
        type: 'user_post',
        post_type: 'user',
        data: itemData,
        body: body || null,
        photo_url,
      })
      .select('id, actor_id, gym_id, type, data, body, photo_url, created_at, post_type, profiles(full_name, username, avatar_url, avatar_type, avatar_value)')
      .single();
    if (!error && newItem) {
      setFeed(prev => [{
        ...newItem,
        // Use signed URL in state for immediate display
        photo_url: signedPhotoUrl || newItem.photo_url,
        reactionCounts: {},
        currentReaction: null,
        commentCount: 0,
      }, ...prev]);
    }
    setShowCreatePost(false);
  };

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || feed.length === 0) return;
    setLoadingMore(true);
    const lastItem = feed[feed.length - 1];
    loadFeed(friendships, lastItem.created_at);
  }, [feed, friendships, loadingMore, hasMore, loadFeed]);

  const pendingIncoming = friendships.filter(
    f => f.addressee_id === user?.id && f.status === 'pending'
  ).length;

  // Build friend IDs set for scoring
  const friendIds = useMemo(() => {
    const ids = new Set();
    friendships.filter(f => f.status === 'accepted').forEach(f => {
      ids.add(f.requester_id === user?.id ? f.addressee_id : f.requester_id);
    });
    return ids;
  }, [friendships, user?.id]);

  // Filter hidden and muted
  const visibleFeed = useMemo(
    () => feed.filter(item => !hiddenIds.has(item.id) && !mutedUsers.has(item.actor_id) && !blockedUsers.has(item.actor_id)),
    [feed, hiddenIds, mutedUsers, blockedUsers]
  );

  // Ranked feed (For You) — engagement scored
  const rankedFeed = useMemo(() => {
    const items = visibleFeed.filter(item => item.actor_id !== user?.id);
    return [...items].sort((a, b) => scoreFeedItem(b, friendIds) - scoreFeedItem(a, friendIds));
  }, [visibleFeed, friendIds, user?.id]);

  const myFeed = useMemo(
    () => visibleFeed.filter(item => item.actor_id === user?.id),
    [visibleFeed, user?.id]
  );

  const activeFeed = tab === 'forYou' ? rankedFeed : myFeed;

  return (
    <div className={`${embedded ? '' : 'min-h-screen pb-28 md:pb-12'}`} style={!embedded ? { background: 'var(--color-bg-primary)' } : undefined}>
      <div className={`${embedded ? '' : 'max-w-5xl lg:max-w-6xl mx-auto px-4 md:px-6 lg:px-8 pt-6 pb-8'}`}>

        {/* Header */}
        {!embedded && (
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {gymLogoUrl ? (
              <img src={gymLogoUrl} alt={`${gymName || 'Gym'} logo`} className="w-12 h-12 rounded-2xl object-cover" width={48} height={48} loading="lazy" />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] flex items-center justify-center">
                <Users size={24} className="text-[#D4AF37]" strokeWidth={2} />
              </div>
            )}
            <div>
              <h1 className="text-[22px] font-bold tracking-tight truncate" style={{ color: 'var(--color-text-primary)' }}>{t('social.title')}</h1>
              <p className="text-[14px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('social.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowFriends(s => !s)}
            className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-semibold whitespace-nowrap active:scale-95 transition-all flex-shrink-0 ${
              showFriends
                ? 'bg-[#D4AF37] text-black'
                : 'border border-white/[0.06]'
            }`}
            style={!showFriends ? { background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' } : undefined}
          >
            <Users size={16} />
            {t('social.friendsButton')}
            {pendingIncoming > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center text-white bg-red-500">
                {pendingIncoming}
              </span>
            )}
          </button>
        </header>
        )}

        {/* Find Friends panel */}
        {showFriends && (
          <FriendsPanel
            userId={user.id}
            gymId={profile?.gym_id}
            friendships={friendships}
            loadFriendships={loadFriendships}
            onClose={() => setShowFriends(false)}
            t={t}
          />
        )}

        {/* Invite a Friend Card */}
        {!embedded && !showFriends && (
          <div className="mb-4 rounded-2xl bg-gradient-to-r from-[#D4AF37]/10 to-[#D4AF37]/5 border border-[#D4AF37]/20 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                <Gift size={20} className="text-[#D4AF37]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('social.inviteTitle')}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('social.inviteSubtitle')}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const referralCode = user.id.slice(0, 8);
                  const text = `Join me at ${profile?.gym_name || 'our gym'}! Use my referral code: ${referralCode}`;
                  if (navigator.share) {
                    navigator.share({ title: t('social.joinTheGym'), text }).catch(() => {});
                  } else {
                    navigator.clipboard?.writeText(text);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-[#D4AF37] text-black text-[12px] font-bold whitespace-nowrap flex-shrink-0 active:scale-95 transition-transform"
              >
                {t('social.invite')}
              </button>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="mb-6">
          <UnderlineTabs
            tabs={[
              { key: 'forYou', label: t('social.tabs.forYou') },
              { key: 'mine', label: t('social.tabs.mine') },
            ]}
            activeIndex={feedTabIndex}
            onChange={handleFeedSwipe}
          />
        </div>

        {/* Friends Streaks (shared, above swipeable area) */}
        {friendStreaks.length > 0 && (
          <div className="mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('social.friendsStreaks')}</p>
            <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide">
              {friendStreaks.map(f => (
                <button key={f.id} type="button" onClick={() => setPreviewUserId(f.id)} aria-label={`${f.name} - ${t('social.streak', { count: f.streak })}`} className="flex flex-col items-center flex-shrink-0 bg-transparent border-0 p-0 cursor-pointer" style={{ width: 64 }}>
                  <Avatar src={f.avatar_url} name={f.name ?? '?'} size={40} avatarType={f.avatar_type} avatarValue={f.avatar_value} />
                  <p className="text-[11px] mt-1.5 truncate w-full text-center" style={{ color: 'var(--color-text-muted)' }}>{f.name.split(' ')[0]}</p>
                  <p className="text-[11px] font-semibold text-[#D4AF37]">{t('social.streak', { count: f.streak })}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div role="status" aria-busy={true} aria-label={t('social.loading')}>
            <Skeleton variant="feed" count={3} />
          </div>
        )}

        {/* Global empty state */}
        {!loading && feed.length === 0 && (
          <EmptyState
            icon={Users}
            title={t('socialFeed.emptyTitle')}
            description={t('socialFeed.emptyDescription')}
            actionLabel={t('social.findFriends')}
            onAction={() => setShowFriends(true)}
          />
        )}

        {/* Swipeable feed panels */}
        {!loading && feed.length > 0 && (
          <SwipeableTabView activeIndex={feedTabIndex} onChangeIndex={handleFeedSwipe} tabKeys={['forYou', 'mine']}>
            {/* For You tab (ranked) */}
            <div>
              {rankedFeed.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={t('social.noFriendActivity')}
                  description={t('social.noFriendActivityHint')}
                  actionLabel={t('social.findFriends')}
                  onAction={() => setShowFriends(true)}
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {rankedFeed.map((item) => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      currentUserId={user.id}
                      onToggleLike={handleReact}
                      onReact={handleReact}
                      onReport={handleReport}
                      onHide={handleHide}
                      onMute={handleMute}
                      onBlock={handleBlock}
                      onDelete={handleDelete}
                      onProfilePreview={setPreviewUserId}
                      reportedIds={reportedIds}
                      t={t}
                    />
                  ))}
                  <LoadMoreButton hasMore={hasMore} loading={loadingMore} onLoadMore={handleLoadMore} />
                  {!hasMore && <p className="text-center text-[13px] py-8 font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('social.allCaughtUp')}</p>}
                </div>
              )}
            </div>

            {/* My Posts tab */}
            <div>
              {/* Create post button */}
              <button
                type="button"
                onClick={() => setShowCreatePost(true)}
                className="w-full flex items-center justify-center gap-2 py-3 mb-5 rounded-2xl active:scale-[0.98] transition-all"
                style={{ backgroundColor: 'var(--color-accent, #D4AF37)' }}
              >
                <PenSquare size={16} className="text-black" />
                <span className="text-[14px] font-semibold text-black">{t('social.createPost')}</span>
              </button>
              {myFeed.length === 0 ? (
                <EmptyState
                  icon={Dumbbell}
                  title={t('social.noPostsYet')}
                  description={t('social.noPostsHint')}
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {myFeed.map((item) => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      currentUserId={user.id}
                      onToggleLike={handleReact}
                      onReact={handleReact}
                      onReport={handleReport}
                      onHide={handleHide}
                      onMute={handleMute}
                      onBlock={handleBlock}
                      onDelete={handleDelete}
                      onProfilePreview={setPreviewUserId}
                      reportedIds={reportedIds}
                      t={t}
                    />
                  ))}
                  <LoadMoreButton hasMore={hasMore} loading={loadingMore} onLoadMore={handleLoadMore} />
                  {!hasMore && <p className="text-center text-[13px] py-8 font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('social.allCaughtUp')}</p>}
                </div>
              )}
            </div>

          </SwipeableTabView>
        )}

        {/* Create Post Modal */}
        {showCreatePost && (
          <CreatePostModal
            onClose={() => setShowCreatePost(false)}
            onSubmit={handleCreatePost}
            userId={user.id}
            t={t}
          />
        )}

        {/* Profile Preview Popup */}
        <ProfilePreview
          userId={previewUserId}
          isOpen={!!previewUserId}
          onClose={() => setPreviewUserId(null)}
        />

        {/* Report Modal */}
        {!!reportTarget && <ReportModal
          open={!!reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmit={handleReportSubmit}
          t={t}
        />}
      </div>
    </div>
  );
};

// ── Create Post Modal ───────────────────────────────────────────────────────
const CreatePostModal = ({ onClose, onSubmit, userId, t }) => {
  const [body, setBody] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [workoutSession, setWorkoutSession] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Load recent workout sessions for tagging
    supabase
      .from('workout_sessions')
      .select('id, routine_name, duration_seconds, total_volume_lbs, created_at')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setRecentSessions(data ?? []));
  }, [userId]);

  const handlePhoto = async () => {
    const file = await takePhoto();
    if (file) {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async () => {
    if (!body.trim() && !photoFile) return;
    setSubmitting(true);
    await onSubmit({ body: body.trim(), photoFile, workoutSession });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('social.createPost')} onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 overflow-hidden"
        style={{ background: 'var(--color-bg-card, #0F172A)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('social.createPost')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('social.report.cancel')}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/[0.06]"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t('social.postPlaceholder')}
            aria-label={t('social.postPlaceholder')}
            maxLength={500}
            rows={4}
            className="w-full rounded-xl px-4 py-3 text-[14px] border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-[#D4AF37] resize-none"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{body.length}/500</span>
          </div>

          {/* Photo preview */}
          {photoPreview && (
            <div className="relative">
              <img src={photoPreview} alt={t('social.photoPreview', 'Photo preview for post')} className="w-full max-h-[200px] object-cover rounded-xl" loading="lazy" />
              <button
                type="button"
                onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                aria-label={t('social.removePhoto', 'Remove photo')}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Tagged workout */}
          {workoutSession && (
            <div className="rounded-xl p-3 border border-[#D4AF37]/30 bg-white/[0.05] flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{workoutSession.routine_name}</p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  {workoutSession.duration_seconds > 0 && fmtDuration(workoutSession.duration_seconds)}
                  {workoutSession.total_volume_lbs > 0 && ` · ${fmtVolume(workoutSession.total_volume_lbs, t('common:lbs'))}`}
                </p>
              </div>
              <button type="button" onClick={() => setWorkoutSession(null)} aria-label={t('social.removeWorkout', 'Remove tagged workout')} style={{ color: 'var(--color-text-subtle)' }}><X size={14} /></button>
            </div>
          )}

          {/* Workout picker */}
          {showWorkoutPicker && (
            <div className="rounded-xl border border-white/[0.06] max-h-[160px] overflow-y-auto" style={{ background: 'var(--color-bg-card)' }}>
              {recentSessions.length === 0 ? (
                <p className="text-[13px] text-center py-4" style={{ color: 'var(--color-text-subtle)' }}>{t('social.noRecentWorkouts')}</p>
              ) : (
                recentSessions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setWorkoutSession(s); setShowWorkoutPicker(false); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-white/[0.06] transition-colors border-b border-white/[0.04] last:border-0"
                  >
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.routine_name ?? 'Workout'}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{timeAgo(s.created_at)}</p>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePhoto}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] hover:bg-white/[0.06] transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <Image size={16} /> {t('social.addPhoto')}
            </button>
            <button
              type="button"
              onClick={() => setShowWorkoutPicker(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] hover:bg-white/[0.06] transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <Link size={16} /> {t('social.tagWorkout')}
            </button>
          </div>
        </div>

        {/* Submit */}
        <div className="px-5 py-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || (!body.trim() && !photoFile)}
            className="w-full py-3 rounded-xl bg-[#D4AF37] text-black font-bold text-[15px] disabled:opacity-40 active:scale-[0.98] transition-all"
          >
            {submitting ? t('social.posting') : t('social.post')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SocialFeed;
