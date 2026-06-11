import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle, Send, ArrowLeft, Search, Plus, X, ChevronLeft, ChevronDown, Archive, ArchiveRestore, RotateCcw, Trash2, MoreHorizontal, Ban, Lock, Dumbbell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { selectInBatches } from '../lib/churn/batchedSelect';
import UserAvatar from '../components/UserAvatar';
import EmptyState from '../components/EmptyState';
import ContentActionMenu from '../components/ContentActionMenu';
import { encryptMessage, decryptMessage } from '../lib/messageEncryption';
import { checkContentBeforeSend } from '../lib/moderationFilter';
import { sanitize } from '../lib/sanitize';
import { Capacitor } from '@capacitor/core';
import { usePostHog } from '@posthog/react';
import posthogClient from 'posthog-js';

// Keyboard plugin — only available on native platforms
let Keyboard = null;
if (Capacitor.isNativePlatform()) {
  import('@capacitor/keyboard').then(mod => { Keyboard = mod.Keyboard; }).catch(() => {});
}

// One-time DM encryption disclosure key (localStorage)
const DM_DISCLOSURE_KEY = 'dm_encryption_disclosure_seen_v1';

// ── Helpers ──────────────────────────────────────────────────────
// Pass `lang` (i18next language) so dates render in the user-selected app
// language, not whatever the OS / browser locale happens to be.
const formatTime = (dateStr, t, lang) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const oneDay = 86400000;
  const locale = lang || undefined;

  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return t('messages.yesterday');
  }

  if (diff < 7 * oneDay) {
    return d.toLocaleDateString(locale, { weekday: 'short' });
  }

  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

const formatTimestamp = (dateStr, t, lang) => {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const locale = lang || undefined;

  let dayPart;
  if (d.toDateString() === now.toDateString()) {
    dayPart = '';
  } else if (d.toDateString() === yesterday.toDateString()) {
    dayPart = t('messages.yesterday') + ' ';
  } else {
    dayPart = d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }) + ' ';
  }
  return dayPart + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
};

/** Returns true if two timestamps are more than 5 minutes apart. */
const shouldShowTimestamp = (prevDateStr, currDateStr) => {
  if (!prevDateStr) return true;
  const diff = Math.abs(new Date(currDateStr) - new Date(prevDateStr));
  return diff >= 5 * 60 * 1000;
};

// ── Trainer workout-share token ──────────────────────────────────
// Trainers drop a `[workout:<planId>:<dayIndex>]` token into a DM
// (TrainerMessages → WorkoutShareModal). Members must see a friendly card,
// never the raw token. Mirrors the WORKOUT_TOKEN renderer on the trainer side.
const WORKOUT_TOKEN = /\[workout:([0-9a-fA-F-]{36}):(\d+)\]/;

// Member-themed share card. The plan row is readable by the assigned client
// via the `trainer_plans_client_select` RLS policy (migration 0036); any
// fetch failure (deleted plan, RLS-denied, offline) falls back to a
// detail-less "shared with you" card. Tapping the card expands that day's
// exercise list inline — there is no member-side trainer-plan viewer page
// to navigate to.
const WorkoutShareCard = ({ planId, dayIndex }) => {
  const { t, i18n } = useTranslation('pages');
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  // id → localized exercise name; null until the first expand resolves them.
  const [exNames, setExNames] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // supabase-js v2 never throws — failures land on { error }.
      const { data, error } = await supabase
        .from('trainer_workout_plans')
        .select('id, name, weeks')
        .eq('id', planId)
        .maybeSingle();
      if (cancelled) return;
      setPlan(error ? null : data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [planId]);

  // weeks JSONB: { "1": [{ name, exercises: [{ id, sets, reps, ... }] }] }.
  // dayIndex indexes week 1's day array.
  const day = plan?.weeks?.['1']?.[dayIndex] || null;
  const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
  const dayName = day?.name || t('messages.workoutShare.dayN', { n: dayIndex + 1, defaultValue: 'Day {{n}}' });
  const interactive = !!plan && exercises.length > 0;

  // Plan JSONB stores exercise ids only — lazily resolve names from the
  // exercises table on first expand. On failure, rows fall back to
  // "Exercise N" labels (sets×reps still shown).
  useEffect(() => {
    if (!expanded || exNames) return;
    let cancelled = false;
    (async () => {
      const ids = [...new Set(exercises.map(ex => ex?.id).filter(Boolean))];
      if (ids.length === 0) { setExNames({}); return; }
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, name_es')
        .in('id', ids);
      if (cancelled) return;
      const map = {};
      if (!error) {
        const useEs = (i18n.language || '').startsWith('es');
        (data || []).forEach(e => { map[e.id] = (useEs && e.name_es) || e.name; });
      }
      setExNames(map);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, exNames, plan, dayIndex, i18n.language]);

  if (loading) {
    return (
      <div
        className="rounded-xl p-3 w-[230px] max-w-full space-y-2"
        style={{ background: 'color-mix(in srgb, var(--color-accent, #D4AF37) 10%, transparent)' }}
      >
        <div className="h-3 w-3/4 rounded animate-pulse bg-white/[0.12]" />
        <div className="h-3 w-1/2 rounded animate-pulse bg-white/[0.12]" />
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden w-[240px] max-w-full"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 40%, transparent)',
      }}
    >
      <button
        type="button"
        onClick={interactive ? () => setExpanded(v => !v) : undefined}
        disabled={!interactive}
        className="w-full text-left p-3"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--color-accent, #D4AF37) 18%, transparent)' }}
          >
            <Dumbbell size={13} style={{ color: 'var(--color-accent, #D4AF37)' }} />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent, #D4AF37)' }}>
            {t('messages.workoutShare.cardLabel', { defaultValue: 'Workout plan' })}
          </p>
        </div>
        {plan ? (
          <>
            <p className="text-[14px] font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
              {sanitize(plan.name || '')}
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {sanitize(dayName)} · {t('messages.workoutShare.exerciseCount', { count: exercises.length, defaultValue: '{{count}} exercises' })}
            </p>
            {interactive && (
              <p className="text-[11px] font-semibold mt-1.5 flex items-center gap-1" style={{ color: 'var(--color-accent, #D4AF37)' }}>
                {expanded
                  ? t('messages.workoutShare.hideExercises', { defaultValue: 'Hide exercises' })
                  : t('messages.workoutShare.showExercises', { defaultValue: 'See exercises' })}
                <ChevronDown size={12} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
              </p>
            )}
          </>
        ) : (
          <p className="text-[12px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
            {t('messages.workoutShare.fallback', { defaultValue: 'Your trainer shared a workout plan with you.' })}
          </p>
        )}
      </button>
      {expanded && interactive && (
        <div className="px-3 pb-3 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {exercises.map((ex, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 pt-1.5">
              <p className="text-[12px] min-w-0 flex-1 leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                {sanitize(
                  (exNames && ex?.id && exNames[ex.id])
                    || t('messages.workoutShare.exerciseFallback', { n: i + 1, defaultValue: 'Exercise {{n}}' })
                )}
              </p>
              {(ex?.sets || ex?.reps) && (
                <p className="text-[11px] flex-shrink-0 font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                  {ex?.sets ?? '–'}×{ex?.reps ?? '–'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Splits a message body around the workout token: surrounding text renders
// sanitized as before, the token itself renders as the share card. Bodies
// without a token render exactly as they always did.
const MessageBody = ({ body }) => {
  const match = WORKOUT_TOKEN.exec(body || '');
  if (!match) return sanitize(body || '');
  const [token, planId, dayIdx] = match;
  const before = body.slice(0, match.index).trim();
  const after = body.slice(match.index + token.length).trim();
  return (
    <div className="space-y-2">
      {before && <p className="whitespace-pre-wrap">{sanitize(before)}</p>}
      <WorkoutShareCard planId={planId} dayIndex={parseInt(dayIdx, 10) || 0} />
      {after && <p className="whitespace-pre-wrap">{sanitize(after)}</p>}
    </div>
  );
};

// ── Block User Confirm Modal (center-aligned) ──────────────────────
const BlockUserModal = ({ open, name, onClose, onConfirm, t }) => {
  const [submitting, setSubmitting] = useState(false);
  if (!open) return null;
  const firstName = name?.split(' ')[0] ?? '';
  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    await onConfirm();
    setSubmitting(false);
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('social.confirmBlock.title', { name: firstName })}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="presentation" />
      <div
        className="relative w-full max-w-[420px] rounded-[28px] border border-white/10 overflow-hidden"
        style={{ background: 'var(--color-bg-card)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
            <Ban size={20} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {t('social.confirmBlock.title', { name: firstName })}
            </h3>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('social.confirmBlock.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold bg-white/[0.06] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('social.report.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {submitting ? t('social.report.submitting') : t('social.confirmBlock.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Member Picker Modal ──────────────────────────────────────────
const MemberPicker = ({ isOpen, onClose, onSelect }) => {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  // Set of user ids the viewer has blocked OR who have blocked the viewer.
  // Loaded once on mount so blocked members can never appear in the friend
  // picker for starting a new conversation.
  const [hiddenIds, setHiddenIds] = useState(() => new Set());

  useEffect(() => {
    if (!isOpen) { setQuery(''); setResults([]); return; }
  }, [isOpen]);

  // Load blocked-user ids (both directions) so the friend picker can
  // exclude them from search results.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const [outgoing, incoming] = await Promise.all([
        supabase.from('blocked_users').select('blocked_id').eq('blocker_id', user.id),
        supabase.from('blocked_users').select('blocker_id').eq('blocked_id', user.id),
      ]);
      if (cancelled) return;
      const ids = new Set();
      (outgoing.data || []).forEach((r) => r.blocked_id && ids.add(r.blocked_id));
      (incoming.data || []).forEach((r) => r.blocker_id && ids.add(r.blocker_id));
      setHiddenIds(ids);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);

      // Fetch friend IDs first
      const { data: friendships } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted');

      const friendIds = (friendships || []).map(f =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      );

      if (friendIds.length === 0) {
        setResults([]);
        setLoading(false);
        return;
      }

      // Search within friends only (batched: friend list can exceed 150 for
      // social-heavy users, which would push a plain .in() past the URL limit)
      const safeQuery = query.replace(/[%_\\,()."']/g, '');
      const { data } = await selectInBatches(
        (ids) => supabase
          .from('gym_member_profiles_safe')
          .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role')
          .in('id', ids)
          .or(`full_name.ilike.%${safeQuery}%,username.ilike.%${safeQuery}%`)
          .limit(20),
        friendIds,
      );
      // Belt-and-suspenders client filter: blocked users (either direction)
      // must never appear in the new-conversation picker.
      const filtered = (data || []).filter((m) => !hiddenIds.has(m.id));
      setResults(filtered);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, user.id, hiddenIds]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-20 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-white/[0.06] overflow-hidden flex flex-col"
        style={{ background: 'var(--color-bg-card)', maxHeight: '60vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('messages.newMessage')}
          </h3>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center hover:bg-white/[0.06]" style={{ color: 'var(--color-text-subtle)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-subtle)' }} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('messages.searchMembers', { defaultValue: 'Search members...' })}
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-[14px] border border-white/[0.06] bg-white/[0.04] outline-none focus:border-[#D4AF37]/40 transition-colors"
              style={{ color: 'var(--color-text-primary)' }}
            />
          </div>
          <p className="text-[12px] mt-1.5 px-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('messages.searchFriends', { defaultValue: 'Search your friends' })}
          </p>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 px-2 pb-4" style={{ maxHeight: '50vh' }}>
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-center text-[13px] py-8" style={{ color: 'var(--color-text-subtle)' }}>
              {t('messages.noResults', { defaultValue: 'No members found' })}
            </p>
          )}
          {results.map(member => (
            <button
              key={member.id}
              onClick={() => onSelect(member)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors text-left min-h-[48px]"
            >
              <UserAvatar user={member} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {member.full_name || member.username || t('messages.member', { defaultValue: 'Member' })}
                </p>
                {member.username && (
                  <p className="text-[12px] truncate" style={{ color: 'var(--color-text-subtle)' }}>@{member.username}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Chat View (iMessage style) ──────────────────────────────────
const ChatView = ({ conversationId, onBack }) => {
  const { t, i18n } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const posthog = usePostHog();
  const [messages, setMessages] = useState([]);
  const [otherUser, setOtherUser] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);
  const encryptionSeedRef = useRef(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const headerMenuRef = useRef(null);
  const [showDisclosure, setShowDisclosure] = useState(() => {
    try { return !localStorage.getItem(DM_DISCLOSURE_KEY); } catch { return false; }
  });
  const dismissDisclosure = useCallback(() => {
    try { localStorage.setItem(DM_DISCLOSURE_KEY, '1'); } catch {}
    setShowDisclosure(false);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!showHeaderMenu) return;
    const handleClick = (e) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setShowHeaderMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showHeaderMenu]);

  const handleBlockOther = useCallback(async () => {
    if (!otherUser?.id || !user?.id) return;
    const { error: blockError } = await supabase.from('blocked_users').upsert(
      { blocker_id: user.id, blocked_id: otherUser.id },
      { onConflict: 'blocker_id,blocked_id' }
    );
    if (blockError) {
      // Block didn't persist — keep the confirm modal open so the user can retry
      showToast(t('common:somethingWentWrong'), 'error');
      return;
    }
    // Drop friendship if any (mirrors SocialFeed behavior)
    const { error: friendshipError } = await supabase.from('friendships').delete()
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${otherUser.id}),and(requester_id.eq.${otherUser.id},addressee_id.eq.${user.id})`);
    if (friendshipError) {
      // Block is in place but the friendship removal failed — retry is idempotent
      showToast(t('common:somethingWentWrong'), 'error');
      return;
    }
    posthogClient?.capture('user_blocked', { source: 'dm' });
    showToast(t('social.userBlocked', { name: otherUser?.full_name?.split(' ')[0] ?? '' }), 'success');
    setConfirmBlock(false);
    onBack();
  }, [otherUser, user?.id, showToast, t, onBack]);

  // Native keyboard events — WebView already resizes natively (capacitor.config
  // Keyboard.resize="native"), so we only listen for the side effect of
  // scrolling the conversation to its latest message when the keyboard opens.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Keyboard) return;
    const listeners = [];
    Keyboard.addListener('keyboardWillShow', () => {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    }).then(h => listeners.push(h));
    return () => { listeners.forEach(h => h.remove()); };
  }, []);

  // Fetch conversation details + messages
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const { data: conv } = await supabase
        .from('conversations')
        .select('participant_1, participant_2, encryption_seed')
        .eq('id', conversationId)
        .single();

      if (cancelled || !conv) return;

      const seed = conv.encryption_seed;
      encryptionSeedRef.current = seed;

      const otherId = conv.participant_1 === user.id ? conv.participant_2 : conv.participant_1;

      const { data: profile } = await supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role')
        .eq('id', otherId)
        .single();

      if (!cancelled) setOtherUser(profile);

      const { data: msgs } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (!cancelled) {
        const decrypted = await Promise.all(
          (msgs || []).map(async (m) => ({ ...m, body: await decryptMessage(m.body, conversationId, seed) }))
        );
        setMessages(decrypted);
        setLoading(false);
      }

      // Mark the whole conversation read via the RLS-proof RPC. A direct UPDATE
      // on direct_messages can be silently blocked by the gym-scoped
      // messages_update policy, which left the unread bubble stuck. Then notify
      // the nav badge / list to recount.
      await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
      try { window.dispatchEvent(new CustomEvent('dm:read', { detail: { conversationId } })); } catch { /* no-op */ }
    };

    load();
    return () => { cancelled = true; };
  }, [conversationId, user.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length <= 20 ? 'auto' : 'smooth' });
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`dm-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          decryptMessage(payload.new.body, conversationId, encryptionSeedRef.current)
            .then(decryptedBody => {
              setMessages(prev => {
                // Already inserted via realtime
                if (prev.some(m => m.id === payload.new.id)) return prev;
                // Reconcile with optimistic temp messages: if we sent something
                // moments ago that matches this real row, swap the temp for the
                // real one instead of duplicating.
                const tempIdx = prev.findIndex(m =>
                  m._pending
                  && m.sender_id === payload.new.sender_id
                  && m.body === decryptedBody
                  && Math.abs(new Date(m.created_at).getTime() - new Date(payload.new.created_at).getTime()) < 60000
                );
                if (tempIdx >= 0) {
                  const next = [...prev];
                  next[tempIdx] = { ...payload.new, body: decryptedBody };
                  return next;
                }
                return [...prev, { ...payload.new, body: decryptedBody }];
              });
            })
            .catch(() => {
              // Decryption failed (legacy/corrupted ciphertext). Insert a
              // placeholder so the message still appears — never let the
              // rejection bubble up and crash the WebView.
              setMessages(prev => {
                if (prev.some(m => m.id === payload.new.id)) return prev;
                return [...prev, { ...payload.new, body: '' }];
              });
            });

          if (payload.new.sender_id !== user.id) {
            // We're actively viewing — mark the conversation read (RPC bypasses
            // the gym-scoped RLS) and ping the nav badge to recount live.
            supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).then(() => {
              try { window.dispatchEvent(new CustomEvent('dm:read', { detail: { conversationId } })); } catch { /* no-op */ }
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          // Real-time read receipt: update read_at on messages we sent
          if (payload.new.read_at && payload.new.sender_id === user.id) {
            setMessages(prev => prev.map(m =>
              m.id === payload.new.id ? { ...m, read_at: payload.new.read_at } : m
            ));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, user.id]);

  const handleSend = async () => {
    const plaintext = input.trim();
    if (!plaintext || sending) return;

    // Optimistic-first: clear the input + render the bubble before any await,
    // so the UI feels instant. We mark the temp message as _pending so the
    // realtime handler can swap it for the real row when the insert lands.
    const tempId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const tempMessage = {
      id: tempId,
      _pending: true,
      conversation_id: conversationId,
      sender_id: user.id,
      body: plaintext,
      read_at: null,
      created_at: nowIso,
    };
    setMessages(prev => [...prev, tempMessage]);
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    setSending(true);

    // Pre-publication content moderation. DMs are encrypted at rest, so a DB
    // trigger cannot scan them — we run the same wordlist via RPC before
    // encrypt + insert. Severity 2 hard-blocks; severity 1 lets it through
    // (admin sees it post-hoc via the regular report flow if a recipient flags).
    const moderation = await checkContentBeforeSend(supabase, plaintext);
    if (!moderation.allowed) {
      // Roll back the optimistic bubble + restore the input so the user can edit.
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setInput(plaintext);
      setSending(false);
      showToast(
        t('moderation.contentBlocked', { defaultValue: 'Message blocked: content violates community guidelines.' }),
        'error',
      );
      return;
    }

    let body;
    try {
      body = await encryptMessage(plaintext, conversationId, encryptionSeedRef.current);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setInput(plaintext);
      setSending(false);
      showToast(t('messages.sendFailed', { defaultValue: 'Could not send message.' }), 'error');
      return;
    }

    const { error } = await supabase.from('direct_messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    });

    if (error) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setInput(plaintext);
      setSending(false);
      showToast(t('messages.sendFailed', { defaultValue: 'Could not send message.' }), 'error');
      return;
    }

    posthog?.capture('dm_sent', { is_first_message: messages.length === 0 });

    // Best-effort tail tasks — don't block the user. Conversation timestamp
    // bump + push to recipient. Errors are logged but not surfaced; the
    // message is already delivered.
    supabase
      .from('conversations')
      .update({ last_message_at: nowIso })
      .eq('id', conversationId)
      .then(() => {});

    if (otherUser?.id) {
      supabase.functions.invoke('send-push-user', {
        body: {
          profile_id: otherUser.id,
          gym_id: profile?.gym_id,
          title: profile?.full_name || t('messages.newMessage', { defaultValue: 'New message' }),
          body: plaintext.substring(0, 100),
          data: { type: 'direct_message', conversation_id: conversationId },
        },
      }).catch(() => { /* non-fatal */ });
    }

    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Build grouped items with timestamps only when 5+ min gap
  const chatItems = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prevMsg = i > 0 ? messages[i - 1] : null;
    const nextMsg = i < messages.length - 1 ? messages[i + 1] : null;

    // Show timestamp if 5+ min gap from previous message
    if (shouldShowTimestamp(prevMsg?.created_at, msg.created_at)) {
      chatItems.push({ type: 'timestamp', label: formatTimestamp(msg.created_at, t, i18n.language), key: `ts-${msg.id}` });
    }

    const isSent = msg.sender_id === user.id;
    const prevSameSender = prevMsg && prevMsg.sender_id === msg.sender_id && !shouldShowTimestamp(prevMsg.created_at, msg.created_at);
    const nextSameSender = nextMsg && nextMsg.sender_id === msg.sender_id && !shouldShowTimestamp(msg.created_at, nextMsg.created_at);

    // Determine if this is the last sent message (for read receipt)
    const isLastSent = isSent && (i === messages.length - 1 || messages.slice(i + 1).every(m => m.sender_id !== user.id));

    chatItems.push({
      type: 'message',
      data: msg,
      key: msg.id,
      isSent,
      prevSameSender,
      nextSameSender,
      isLastSent,
    });
  }

  const displayName = otherUser?.full_name || otherUser?.username || t('messages.member', { defaultValue: 'Member' });

  return (
    <div className="fixed left-0 right-0 top-0 bottom-0 z-[60] flex flex-col" style={{ background: 'var(--color-bg-primary)', paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))' }}>
      {/* Header — iMessage style: back left, name centered, avatar right */}
      <div
        className="flex items-center px-2 py-2 border-b border-white/[0.06] flex-shrink-0"
        style={{ background: 'var(--color-bg-card)' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-0.5 px-1 py-2 rounded-lg transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] justify-center"
          style={{ color: 'var(--color-accent, #D4AF37)' }}
          aria-label={t('messages.back', { defaultValue: 'Back' })}
        >
          <ChevronLeft size={28} strokeWidth={2.5} />
        </button>
        <div className="flex-1 text-center min-w-0">
          <p className="text-[17px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {displayName}
          </p>
          {(() => {
            const role = otherUser?.role;
            if (!role || role === 'member') return null;
            const labelKey = role === 'super_admin'
              ? 'messages.superAdmin'
              : role === 'admin'
                ? 'messages.admin'
                : 'messages.trainer';
            const label = role === 'super_admin'
              ? t(labelKey, { defaultValue: 'Super Admin' })
              : role === 'admin'
                ? t(labelKey, { defaultValue: 'Admin' })
                : t(labelKey, { defaultValue: 'Trainer' });
            return (
              <p className="text-[11px] font-semibold" style={{ color: 'var(--color-accent, #D4AF37)' }}>
                {label}
              </p>
            );
          })()}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          {otherUser && <UserAvatar user={otherUser} size={32} />}
          {otherUser && (
            <div className="relative" ref={headerMenuRef}>
              <button
                type="button"
                onClick={() => setShowHeaderMenu(s => !s)}
                aria-label={t('social.moreOptions')}
                aria-haspopup="menu"
                aria-expanded={showHeaderMenu}
                className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                <MoreHorizontal size={18} />
              </button>
              {showHeaderMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-12 z-30 w-52 rounded-xl border border-white/10 shadow-xl overflow-hidden"
                  style={{ background: 'var(--color-bg-card)' }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setShowHeaderMenu(false); setConfirmBlock(true); }}
                    className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors text-left"
                  >
                    <Ban size={15} className="text-red-400" />
                    {t('social.blockUser', { name: otherUser?.full_name?.split(' ')[0] ?? '' })}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <BlockUserModal
        open={confirmBlock}
        name={otherUser?.full_name}
        onClose={() => setConfirmBlock(false)}
        onConfirm={handleBlockOther}
        t={t}
      />

      {/* First-DM-open encryption disclosure banner (one-time) */}
      {showDisclosure && (
        <div
          className="flex items-start gap-2.5 mx-3 mt-2 mb-1 px-3 py-2.5 rounded-xl border"
          style={{
            background: 'var(--color-bg-card)',
            borderColor: 'var(--color-border-subtle, rgba(127,127,127,0.18))',
          }}
          role="status"
        >
          <Lock size={14} style={{ color: 'var(--color-accent, #D4AF37)', marginTop: 2, flexShrink: 0 }} />
          <p className="text-[12px] leading-snug flex-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('dm.encryptionBannerBody', {
              defaultValue: 'Messages are encrypted at rest. They are accessible to TuGymPR for safety and moderation, not to other gyms or third parties.',
            })}
          </p>
          <button
            type="button"
            onClick={dismissDisclosure}
            className="text-[12px] font-semibold flex-shrink-0 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
            style={{ color: 'var(--color-accent, #D4AF37)' }}
          >
            {t('dm.encryptionBannerDismiss', { defaultValue: 'Got it' })}
          </button>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
              <MessageCircle size={24} style={{ color: 'var(--color-text-subtle)' }} />
            </div>
            <p className="text-[14px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>
              {t('messages.noMessages')}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('messages.startConversation')}
            </p>
          </div>
        ) : (
          chatItems.map(item => {
            if (item.type === 'timestamp') {
              return (
                <div key={item.key} className="flex items-center justify-center py-2">
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                    {item.label}
                  </span>
                </div>
              );
            }

            const { data: msg, isSent, prevSameSender, nextSameSender, isLastSent } = item;

            // Tight spacing (2px) between same-sender consecutive messages, larger (8px) between different senders
            const marginTop = prevSameSender ? 'mt-[2px]' : 'mt-2';

            return (
              <div key={item.key} className={`${marginTop}`}>
                <div className={`flex items-end gap-1 ${isSent ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`px-3.5 py-2 text-[15px] leading-relaxed break-words max-w-[75%] ${
                      isSent
                        ? 'bg-[var(--color-accent,#D4AF37)] text-[var(--color-text-on-accent,#000)] rounded-2xl rounded-br-sm'
                        : 'bg-white/[0.08] rounded-2xl rounded-bl-sm'
                    } ${msg._pending ? 'opacity-60' : ''}`}
                    style={isSent ? undefined : { color: 'var(--color-text-primary)' }}
                  >
                    <MessageBody body={msg.body} />
                  </div>
                  {/* Per-message Report lives in the header overflow now —
                      the per-bubble dots felt cluttered on every message. */}
                </div>
                {/* Read receipt — only on the last sent message */}
                {isLastSent && (
                  <p className="text-[10px] text-right mt-0.5 mr-1" style={{ color: msg.read_at ? 'var(--color-accent, #D4AF37)' : 'var(--color-text-muted)' }}>
                    {msg.read_at ? t('messages.read', { defaultValue: 'Read' }) : t('messages.delivered', { defaultValue: 'Delivered' })}
                  </p>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar — pill style, sits above keyboard via native Capacitor events */}
      <div
        className="flex items-end gap-2 px-3 py-2 border-t border-white/[0.06] flex-shrink-0"
        style={{ background: 'var(--color-bg-card)', paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <textarea
          ref={inputRef}
          value={input}
          // direct_messages.body CHECK caps the ENCRYPTED ciphertext at 2000
          // chars (≈1450 plaintext) — 1400 keeps every send under the limit.
          maxLength={1400}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('messages.typeMessage', { defaultValue: 'Message...' })}
          rows={1}
          className="flex-1 resize-none px-4 py-3 rounded-full text-[15px] bg-white/[0.06] outline-none focus:bg-white/[0.08] transition-colors"
          style={{ color: 'var(--color-text-primary)', maxHeight: '120px', minHeight: '44px' }}
          onInput={e => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="w-[44px] h-[44px] rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-95 disabled:opacity-30"
          style={{ backgroundColor: 'var(--color-accent, #D4AF37)' }}
          aria-label={t('messages.send')}
        >
          <Send size={18} className="text-[var(--color-text-on-accent,#000)] ml-0.5" />
        </button>
      </div>
    </div>
  );
};

// ── Swipeable Row (Apple-style swipe actions) ──────────────────
// Generic swipe-to-reveal row. `actions` is an ordered list of
// { key, icon, label, confirmLabel?, bg, color, destructive? onClick } rendered
// right-to-left behind the row. A full left-swipe fires the destructive action
// (or the last one). Actions with a confirmLabel require a second tap.
const SwipeableRow = ({ children, actions = [], openRowId, setOpenRowId, rowId }) => {
  const rowRef = useRef(null);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const [offsetX, setOffsetX] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [confirmKey, setConfirmKey] = useState(null);
  const [transitioning, setTransitioning] = useState(false);

  const SNAP_THRESHOLD = 80;
  const FULL_SWIPE_THRESHOLD = 200;
  const OPEN_WIDTH = Math.max(1, actions.length) * 75; // 75px per button
  const fullSwipeAction = actions.find(a => a.destructive) || actions[actions.length - 1];

  // Close when another row opens
  useEffect(() => {
    if (openRowId !== rowId && isOpen) {
      setTransitioning(true);
      setOffsetX(0);
      setIsOpen(false);
      setConfirmKey(null);
      setTimeout(() => setTransitioning(false), 300);
    }
  }, [openRowId, rowId, isOpen]);

  const handleStart = useCallback((clientX) => {
    startXRef.current = clientX;
    currentXRef.current = clientX;
    isDraggingRef.current = false;
    setTransitioning(false);
  }, []);

  const handleMove = useCallback((clientX) => {
    const diff = startXRef.current - clientX;
    if (Math.abs(diff) > 10) {
      isDraggingRef.current = true;
    }
    if (!isDraggingRef.current) return;

    currentXRef.current = clientX;
    // Only allow swiping left (positive diff = reveal actions)
    const newOffset = isOpen ? Math.max(0, OPEN_WIDTH + diff) : Math.max(0, diff);
    setOffsetX(Math.min(newOffset, 280));
  }, [isOpen]);

  const handleEnd = useCallback(() => {
    if (!isDraggingRef.current) return;

    setTransitioning(true);
    setTimeout(() => setTransitioning(false), 300);

    if (offsetX > FULL_SWIPE_THRESHOLD) {
      // Full swipe — trigger the destructive action directly
      setOffsetX(0);
      setIsOpen(false);
      setConfirmKey(null);
      fullSwipeAction?.onClick?.();
      return;
    }

    if (offsetX > SNAP_THRESHOLD) {
      // Snap open
      setOffsetX(OPEN_WIDTH);
      setIsOpen(true);
      setOpenRowId(rowId);
    } else {
      // Snap closed
      setOffsetX(0);
      setIsOpen(false);
      setConfirmKey(null);
    }
  }, [offsetX, fullSwipeAction, rowId, setOpenRowId, OPEN_WIDTH]);

  const handleClose = useCallback(() => {
    setTransitioning(true);
    setOffsetX(0);
    setIsOpen(false);
    setConfirmKey(null);
    setTimeout(() => setTransitioning(false), 300);
  }, []);

  const handleActionClick = useCallback((e, action) => {
    e.stopPropagation();
    if (action.confirmLabel && confirmKey !== action.key) {
      setConfirmKey(action.key);
      return;
    }
    handleClose();
    action.onClick?.();
  }, [confirmKey, handleClose]);

  // Touch events
  const onTouchStart = useCallback((e) => handleStart(e.touches[0].clientX), [handleStart]);
  const onTouchMove = useCallback((e) => handleMove(e.touches[0].clientX), [handleMove]);
  const onTouchEnd = useCallback(() => handleEnd(), [handleEnd]);

  // Mouse events for desktop
  const onMouseDown = useCallback((e) => {
    handleStart(e.clientX);
    const onMouseMove = (ev) => handleMove(ev.clientX);
    const onMouseUp = () => {
      handleEnd();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [handleStart, handleMove, handleEnd]);

  // Prevent child click when dragging
  const onClickCapture = useCallback((e) => {
    if (isDraggingRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return (
    <div ref={rowRef} style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Action buttons (revealed behind the row) */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        height: '100%',
      }}>
        {actions.map((action) => {
          const ActionIcon = action.icon;
          const confirming = action.confirmLabel && confirmKey === action.key;
          return (
            <button
              key={action.key}
              onClick={(e) => handleActionClick(e, action)}
              style={{
                width: confirming ? 100 : 75,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: action.bg,
                color: action.color || '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                transition: 'width 0.2s ease',
              }}
            >
              <ActionIcon size={20} />
              <span>{confirming ? action.confirmLabel : action.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sliding row content */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(-${offsetX}px)`,
          transition: transitioning ? 'transform 0.3s ease' : 'none',
          position: 'relative',
          zIndex: 1,
          background: 'var(--color-bg-primary, #111)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  );
};

// Recently-deleted chats are restorable for this long; after that the daily
// cron purges them. Kept in sync with migration 0449's 30-day window.
const RECENTLY_DELETED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Which list a conversation belongs in, from the user's per-conversation state.
function conversationBucket(state) {
  if (!state) return 'active';
  if (state.purged_at) return 'purged';
  if (state.deleted_at) {
    return (Date.now() - new Date(state.deleted_at).getTime() <= RECENTLY_DELETED_WINDOW_MS)
      ? 'deleted'
      : 'purged';
  }
  if (state.archived_at) return 'archived';
  return 'active';
}

// ── Conversation List View (iMessage style) ─────────────────────
const ConversationList = ({ onSelectConversation, onNewMessage, onGoBack, headerExtra }) => {
  const { t, i18n } = useTranslation('pages');
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openRowId, setOpenRowId] = useState(null);
  // Per-conversation state (archived/deleted/purged) keyed by conversation id,
  // sourced from conversation_member_state. Drives which tab each chat lands in.
  const [stateMap, setStateMap] = useState({});
  // Which list we're viewing: 'active' | 'archived' | 'deleted'.
  const [tab, setTab] = useState('active');

  const loadConversations = useCallback(async () => {
    setLoading(true);

    const { data: convs } = await supabase
      .from('conversations')
      .select('id, participant_1, participant_2, last_message_at, encryption_seed')
      .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
      .order('last_message_at', { ascending: false });

    if (!convs || convs.length === 0) {
      setConversations([]);
      setStateMap({});
      setLoading(false);
      return;
    }

    // Per-user archive / soft-delete state (RLS scopes rows to this user).
    const { data: stateRows } = await supabase
      .from('conversation_member_state')
      .select('conversation_id, archived_at, deleted_at, purged_at');
    const sMap = {};
    (stateRows || []).forEach(s => { sMap[s.conversation_id] = s; });
    setStateMap(sMap);

    const otherIds = convs.map(c => c.participant_1 === user.id ? c.participant_2 : c.participant_1);
    const uniqueIds = [...new Set(otherIds)];

    // Batched: a user's conversation-partner list grows unbounded; plain .in()
    // would exceed the URL limit past ~390 unique participants.
    const { data: profiles } = await selectInBatches(
      (ids) => supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role')
        .in('id', ids),
      uniqueIds,
    );

    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = p; });

    const enriched = await Promise.all(convs.map(async (conv) => {
      const otherId = conv.participant_1 === user.id ? conv.participant_2 : conv.participant_1;

      const { data: lastMsg } = await supabase
        .from('direct_messages')
        .select('body, sender_id, created_at, read_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: unreadCount } = await supabase
        .from('direct_messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', user.id)
        .is('read_at', null);

      const decryptedBody = lastMsg?.body ? await decryptMessage(lastMsg.body, conv.id, conv.encryption_seed) : null;

      return {
        ...conv,
        otherUser: profileMap[otherId] || null,
        lastMessage: lastMsg ? { ...lastMsg, body: decryptedBody } : null,
        unreadCount: unreadCount || 0,
      };
    }));

    setConversations(enriched);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { document.title = t('messages.title'); }, [t]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Realtime: reload when new messages arrive (debounced to prevent excessive refetches)
  useEffect(() => {
    let debounceTimer;
    // This listens to ALL gym direct_messages (no per-user filter possible here)
    // and Messages is keep-alive, so skip the full conversation-list reload while
    // backgrounded/hidden and catch up on the next foreground.
    const channel = supabase
      .channel('dm-list')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => { if (!document.hidden) loadConversations(); }, 2000);
        }
      )
      .subscribe();
    const onVisible = () => { if (!document.hidden) loadConversations(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => { clearTimeout(debounceTimer); document.removeEventListener('visibilitychange', onVisible); supabase.removeChannel(channel); };
  }, [loadConversations]);

  // Close swipe row when tapping outside
  const handleListClick = useCallback(() => {
    if (openRowId) setOpenRowId(null);
  }, [openRowId]);

  // Optimistically patch a conversation's local state, then persist via RPC.
  // The row jumps to its new tab instantly; loadConversations reconciles later.
  const applyState = useCallback((convId, patch) => {
    setStateMap(prev => ({ ...prev, [convId]: { ...(prev[convId] || {}), ...patch } }));
  }, []);

  const handleArchive = useCallback((convId) => {
    applyState(convId, { archived_at: new Date().toISOString(), deleted_at: null, purged_at: null });
    supabase.rpc('set_conversation_archived', { p_conversation_id: convId, p_archived: true }).then(() => {});
  }, [applyState]);

  const handleUnarchive = useCallback((convId) => {
    applyState(convId, { archived_at: null, deleted_at: null, purged_at: null });
    supabase.rpc('set_conversation_archived', { p_conversation_id: convId, p_archived: false }).then(() => {});
  }, [applyState]);

  const handleSoftDelete = useCallback((convId) => {
    applyState(convId, { deleted_at: new Date().toISOString(), archived_at: null, purged_at: null });
    supabase.rpc('soft_delete_conversation', { p_conversation_id: convId }).then(() => {});
  }, [applyState]);

  const handleRestore = useCallback((convId) => {
    applyState(convId, { archived_at: null, deleted_at: null, purged_at: null });
    supabase.rpc('restore_conversation', { p_conversation_id: convId }).then(() => {});
  }, [applyState]);

  const handlePurge = useCallback((convId) => {
    applyState(convId, { purged_at: new Date().toISOString() });
    supabase.rpc('purge_conversation', { p_conversation_id: convId }).then(() => {});
  }, [applyState]);

  // Count conversations per tab (for the segmented control badges).
  const tabCounts = useMemo(() => {
    const counts = { active: 0, archived: 0, deleted: 0 };
    conversations.forEach(c => {
      const b = conversationBucket(stateMap[c.id]);
      if (counts[b] !== undefined) counts[b] += 1;
    });
    return counts;
  }, [conversations, stateMap]);

  // Conversations in the current tab, then filtered by search.
  const filteredConversations = useMemo(() => {
    let result = conversations.filter(c => conversationBucket(stateMap[c.id]) === tab);
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter(conv => {
      const name = (conv.otherUser?.full_name || '').toLowerCase();
      const username = (conv.otherUser?.username || '').toLowerCase();
      const lastMsg = (conv.lastMessage?.body || '').toLowerCase();
      return name.includes(q) || username.includes(q) || lastMsg.includes(q);
    });
  }, [conversations, stateMap, tab, searchQuery]);

  return (
    <div className="overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {onGoBack && (
            <button
              onClick={onGoBack}
              className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center hover:bg-white/[0.06] transition-colors flex-shrink-0"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label={t('messages.back', { defaultValue: 'Back' })}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h1 className="text-[28px] font-black truncate" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
            {t('messages.title')}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {headerExtra}
          <button
            onClick={onNewMessage}
            className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            style={{ color: 'var(--color-accent, #D4AF37)' }}
            aria-label={t('messages.newMessage')}
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Folder tabs: Inbox / Archived / Recently Deleted */}
      {!loading && conversations.length > 0 && (
        <div className="px-4 pb-2 flex items-center gap-2 overflow-x-auto">
          {[
            { key: 'active', label: t('messages.tabActive', { defaultValue: 'Inbox' }) },
            { key: 'archived', label: t('messages.tabArchived', { defaultValue: 'Archived' }) },
            { key: 'deleted', label: t('messages.tabDeleted', { defaultValue: 'Deleted' }) },
          ].map(({ key, label }) => {
            const selected = tab === key;
            const count = tabCounts[key];
            return (
              <button
                key={key}
                onClick={() => { setTab(key); setOpenRowId(null); setSearchQuery(''); }}
                className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 flex-shrink-0"
                style={{
                  background: selected ? 'var(--color-accent, #D4AF37)' : 'rgba(255,255,255,0.05)',
                  color: selected ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                }}
              >
                {label}
                {count > 0 && (
                  <span className="text-[10px] font-bold" style={{ opacity: selected ? 0.7 : 0.9 }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Search bar */}
      {!loading && conversations.length > 0 && (
        <div className="px-4 pb-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-subtle)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('messages.searchConversations', { defaultValue: 'Search conversations...' })}
              className="w-full pl-10 pr-9 py-2.5 rounded-xl text-[14px] border border-white/[0.06] bg-white/[0.04] outline-none focus:border-[var(--color-accent,#D4AF37)]/40 transition-colors"
              style={{ color: 'var(--color-text-primary)' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-[44px] h-[44px] rounded-full flex items-center justify-center"
              >
                <span className="w-5 h-5 rounded-full bg-white/[0.1] flex items-center justify-center">
                  <X size={12} style={{ color: 'var(--color-text-muted)' }} />
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title={t('messages.emptyTitle')}
          description={t('messages.emptyDescription')}
        />
      ) : filteredConversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 px-4 text-center">
          {searchQuery ? (
            <>
              <Search size={24} style={{ color: 'var(--color-text-subtle)' }} />
              <p className="text-[14px]" style={{ color: 'var(--color-text-subtle)' }}>
                {t('messages.noSearchResults', { defaultValue: 'No conversations match your search' })}
              </p>
            </>
          ) : (
            <>
              {tab === 'archived'
                ? <Archive size={24} style={{ color: 'var(--color-text-subtle)' }} />
                : tab === 'deleted'
                  ? <Trash2 size={24} style={{ color: 'var(--color-text-subtle)' }} />
                  : <MessageCircle size={24} style={{ color: 'var(--color-text-subtle)' }} />}
              <p className="text-[14px]" style={{ color: 'var(--color-text-subtle)' }}>
                {tab === 'archived'
                  ? t('messages.emptyArchived', { defaultValue: 'No archived conversations' })
                  : tab === 'deleted'
                    ? t('messages.emptyDeleted', { defaultValue: 'Nothing in Recently Deleted' })
                    : t('messages.emptyActive', { defaultValue: 'No conversations here' })}
              </p>
            </>
          )}
        </div>
      ) : (
        <div onClick={handleListClick}>
          {tab === 'deleted' && (
            <p className="px-4 py-2 text-[11.5px]" style={{ color: 'var(--color-text-subtle)' }}>
              {t('messages.recentlyDeletedNote', { defaultValue: 'Deleted chats are kept for 30 days, then permanently removed.' })}
            </p>
          )}
          {filteredConversations.map((conv, idx) => {
            const other = conv.otherUser;
            const displayName = other?.full_name || other?.username || t('messages.member', { defaultValue: 'Member' });
            // Replace a raw workout-share token with a friendly label so the
            // list preview never shows `[workout:<uuid>:<n>]` gibberish.
            const previewSrc = (conv.lastMessage?.body || '')
              .replace(WORKOUT_TOKEN, t('messages.workoutShare.cardLabel', { defaultValue: 'Workout plan' }))
              .trim();
            const preview = previewSrc
              ? sanitize(previewSrc.length > 60 ? previewSrc.slice(0, 60) + '...' : previewSrc)
              : '';
            const isSentByMe = conv.lastMessage?.sender_id === user.id;
            const hasUnread = conv.unreadCount > 0;

            const deleteAction = {
              key: 'delete', icon: Trash2, destructive: true,
              label: t('messages.deleteConversation', { defaultValue: 'Delete' }),
              confirmLabel: t('messages.deleteConfirm', { defaultValue: 'Delete?' }),
              bg: 'var(--color-danger, #EF4444)', color: '#fff',
              onClick: () => handleSoftDelete(conv.id),
            };
            const rowActions = tab === 'archived'
              ? [
                  { key: 'unarchive', icon: ArchiveRestore,
                    label: t('messages.unarchive', { defaultValue: 'Unarchive' }),
                    bg: 'var(--color-bg-elevated, #374151)', color: 'var(--color-text-primary, #fff)',
                    onClick: () => handleUnarchive(conv.id) },
                  deleteAction,
                ]
              : tab === 'deleted'
                ? [
                    { key: 'restore', icon: RotateCcw,
                      label: t('messages.restore', { defaultValue: 'Restore' }),
                      bg: 'var(--color-bg-elevated, #374151)', color: 'var(--color-text-primary, #fff)',
                      onClick: () => handleRestore(conv.id) },
                    { key: 'purge', icon: Trash2, destructive: true,
                      label: t('messages.deleteForever', { defaultValue: 'Delete' }),
                      confirmLabel: t('messages.deleteForeverConfirm', { defaultValue: 'Forever?' }),
                      bg: 'var(--color-danger, #EF4444)', color: '#fff',
                      onClick: () => handlePurge(conv.id) },
                  ]
                : [
                    { key: 'archive', icon: Archive,
                      label: t('messages.archive', { defaultValue: 'Archive' }),
                      bg: 'var(--color-bg-elevated, #374151)', color: 'var(--color-text-primary, #fff)',
                      onClick: () => handleArchive(conv.id) },
                    deleteAction,
                  ];

            return (
              <SwipeableRow
                key={conv.id}
                rowId={conv.id}
                openRowId={openRowId}
                setOpenRowId={setOpenRowId}
                actions={rowActions}
              >
                <button
                  onClick={() => onSelectConversation(conv.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left active:bg-white/[0.05] min-h-[56px]"
                  style={idx < filteredConversations.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.04)' } : undefined}
                >
                  {/* Avatar — 48px */}
                  <div className="relative flex-shrink-0">
                    {other && <UserAvatar user={other} size={48} />}
                    {hasUnread && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-[var(--color-accent,#D4AF37)] text-[var(--color-text-on-accent,#000)] text-[10px] font-bold flex items-center justify-center">
                        {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {/* Name + role + time on same line */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className={`text-[16px] truncate ${hasUnread ? 'font-bold' : 'font-semibold'}`} style={{ color: 'var(--color-text-primary)' }}>
                          {displayName}
                        </p>
                        {other?.role && other.role !== 'member' && (
                          <span
                            className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0"
                            style={{
                              background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                              color: 'var(--color-accent, #D4AF37)',
                              fontWeight: 700,
                            }}
                          >
                            {other.role === 'super_admin'
                              ? t('messages.superAdmin', { defaultValue: 'Super Admin' })
                              : other.role === 'admin'
                                ? t('messages.admin', { defaultValue: 'Admin' })
                                : t('messages.trainer', { defaultValue: 'Trainer' })}
                          </span>
                        )}
                      </div>
                      {conv.lastMessage && (
                        <span className="text-[12px] flex-shrink-0" style={{ color: hasUnread ? 'var(--color-accent, #D4AF37)' : 'var(--color-text-muted)' }}>
                          {formatTime(conv.lastMessage.created_at, t, i18n.language)}
                        </span>
                      )}
                    </div>
                    {/* Message preview — gray */}
                    {preview && (
                      <p className={`text-[14px] truncate mt-0.5 ${hasUnread ? 'font-medium' : ''}`} style={{ color: hasUnread ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                        {isSentByMe && <span style={{ color: 'var(--color-text-muted)' }}>{t('messages.you', { defaultValue: 'You' })}: </span>}
                        {preview}
                      </p>
                    )}
                  </div>

                  {/* Chevron */}
                  <ChevronLeft size={16} className="rotate-180 flex-shrink-0 opacity-30" style={{ color: 'var(--color-text-muted)' }} />
                </button>
              </SwipeableRow>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Main Messages Page ───────────────────────────────────────────
const Messages = ({ embedded = false, hideBackButton = false, headerExtra = null }) => {
  const { conversationId: routeConvId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const posthog = usePostHog();
  const [showPicker, setShowPicker] = useState(false);
  const [embeddedConvId, setEmbeddedConvId] = useState(null);

  const basePath = location.pathname.startsWith('/trainer') ? '/trainer/messages' : '/messages';
  const conversationId = embedded ? embeddedConvId : routeConvId;

  const handleSelectConversation = (id) => {
    if (embedded) {
      setEmbeddedConvId(id);
    } else {
      navigate(`${basePath}/${id}`);
    }
  };

  const handleBack = () => {
    if (embedded) {
      setEmbeddedConvId(null);
    } else {
      navigate(basePath);
    }
  };

  const handleNewMessage = () => {
    setShowPicker(true);
  };

  const handleSelectMember = async (member) => {
    setShowPicker(false);
    const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: member.id });
    if (convId) {
      posthog?.capture('conversation_started');
      handleSelectConversation(convId);
    }
  };

  if (conversationId) {
    return <ChatView conversationId={conversationId} onBack={handleBack} />;
  }

  return (
    <>
      <ConversationList
        onSelectConversation={handleSelectConversation}
        onNewMessage={handleNewMessage}
        onGoBack={hideBackButton ? null : () => navigate(location.pathname.startsWith('/trainer') ? '/trainer' : '/')}
        headerExtra={headerExtra}
      />
      {showPicker && <MemberPicker
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleSelectMember}
      />}
    </>
  );
};

export default Messages;
