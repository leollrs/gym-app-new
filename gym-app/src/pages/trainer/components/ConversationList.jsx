import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Search, MessageCircle, Pin, Archive, Trash2, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import UserAvatar from '../../../components/UserAvatar';
import EmptyState from '../../../components/EmptyState';
import UnderlineTabs from '../../../components/UnderlineTabs';
import { TT } from './designTokens';
import { TCard } from './designPrimitives';

const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ACTION_WIDTH = 80; // px per action button (Archive / Delete / Block)
const REVEAL_WIDTH = ACTION_WIDTH * 3;
const SWIPE_THRESHOLD = -50; // drag past this → snap open

function formatRelative(dateStr, t, lang) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const oneDay = 86400000;
  // Use the i18next language so dates render in Spanish ("abr 29") for an
  // ES-locale user even when the OS / browser locale is English.
  const locale = lang || undefined;
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return t('trainerMessages.list.yesterday', 'Yesterday');
  }
  if (diff < 7 * oneDay) {
    return d.toLocaleDateString(locale, { weekday: 'short' });
  }
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

// ── Swipe row ──────────────────────────────────────────────────────────────
// One conversation row with iOS-style swipe-left to reveal Archive / Delete /
// Block actions. Tap the row body to open the conversation; tap an action to
// invoke its handler. Swiping a different row collapses this one.
function SwipeRow({ lang,
  conv,
  isActive,
  isPinned,
  isOnline,
  isArchived,
  isOpen,
  isFirst,
  onOpenSwipe,
  onCollapseSwipe,
  onSelect,
  onTogglePin,
  onArchive,
  onDelete,
  onBlock,
  renderTime,
  t,
}) {
  const u = conv.otherUser;
  const name = u?.full_name || u?.username || t('trainerMessages.list.clientFallback', 'Client');
  const lastBody = conv.lastMessage?.body || '';
  const hadWorkoutToken = /\[workout:[^\]]+\]/.test(lastBody);
  const cleanedPreview = lastBody.replace(/\[workout:[^\]]+\]/g, '').trim()
    || (hadWorkoutToken
      ? t('trainerMessages.list.workoutShared', 'Workout plan')
      : t('trainerMessages.list.noMessages', 'No messages'));

  const x = useMotionValue(0);
  const draggingRef = useRef(false);

  // Sync motion value when parent toggles open/closed (e.g. another row was
  // swiped, collapsing this one).
  useEffect(() => {
    const target = isOpen ? -REVEAL_WIDTH : 0;
    const controls = animate(x, target, { type: 'spring', stiffness: 380, damping: 36 });
    return () => controls.stop();
  }, [isOpen, x]);

  const handleDragEnd = (_e, info) => {
    draggingRef.current = false;
    if (info.offset.x < SWIPE_THRESHOLD || info.velocity.x < -200) {
      onOpenSwipe();
    } else {
      onCollapseSwipe();
    }
  };

  const handleRowTap = () => {
    if (draggingRef.current) return;
    if (isOpen) {
      onCollapseSwipe();
      return;
    }
    onSelect(conv.id);
  };

  return (
    <div
      className="relative"
      style={{ overflow: 'hidden', borderTop: isFirst ? 'none' : '1px solid var(--tt-border)' }}
    >
      {/* Action layer (sits behind the row, revealed on swipe) */}
      <div
        className="absolute top-0 right-0 bottom-0 flex"
        style={{ width: REVEAL_WIDTH, pointerEvents: isOpen ? 'auto' : 'none' }}
        aria-hidden={!isOpen}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          aria-label={t('trainerMessages.list.archive', 'Archive')}
          style={{
            width: ACTION_WIDTH,
            background: '#6B7280',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 4, fontSize: 11, fontWeight: 700,
          }}
        >
          <Archive size={18} />
          {isArchived
            ? t('trainerMessages.list.unarchive', 'Unarchive')
            : t('trainerMessages.list.archive', 'Archive')}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={t('trainerMessages.list.delete', 'Delete')}
          style={{
            width: ACTION_WIDTH,
            background: '#EF4444',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 4, fontSize: 11, fontWeight: 700,
          }}
        >
          <Trash2 size={18} />
          {t('trainerMessages.list.delete', 'Delete')}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onBlock(); }}
          aria-label={t('trainerMessages.list.block', 'Block')}
          style={{
            width: ACTION_WIDTH,
            background: '#111827',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 4, fontSize: 11, fontWeight: 700,
          }}
        >
          <Ban size={18} />
          {t('trainerMessages.list.block', 'Block')}
        </button>
      </div>

      {/* Foreground row — drags horizontally to reveal actions */}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -REVEAL_WIDTH, right: 0 }}
        dragElastic={0.04}
        onDragStart={() => { draggingRef.current = true; }}
        onDragEnd={handleDragEnd}
        style={{ x, position: 'relative', background: TT.surface, touchAction: 'pan-y' }}
      >
        <button
          type="button"
          onClick={handleRowTap}
          className="w-full flex items-center gap-3 text-left transition-colors"
          style={{
            background: isActive ? TT.accentSoft : 'transparent',
            boxShadow: isActive ? `inset 3px 0 0 ${TT.accent}` : 'none',
            border: 'none',
            padding: '13px 15px',
            minHeight: 64,
            cursor: 'pointer',
          }}
        >
          <div className="relative shrink-0">
            <UserAvatar user={u || {}} size={44} />
            {isOnline && (
              <span
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
                style={{ borderColor: TT.surface, background: TT.good }}
                aria-label={t('trainerMessages.list.onlineAria', 'Online')}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14.5px] font-bold truncate" style={{ color: TT.text }}>
                {name}
              </p>
              {isPinned && <Pin size={11} style={{ color: TT.accent }} />}
              <span className="ml-auto text-[11px] shrink-0" style={{ color: TT.textMute }}>
                {formatRelative(conv.last_message_at, t, lang)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p
                className="text-[12.5px] truncate flex-1"
                style={{
                  color: conv.unreadCount > 0 ? TT.text : TT.textSub,
                  fontWeight: conv.unreadCount > 0 ? 600 : 400,
                }}
              >
                {cleanedPreview}
              </p>
              {conv.unreadCount > 0 && (
                <span
                  className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold"
                  style={{ background: TT.accent, color: '#063B36' }}
                >
                  {conv.unreadCount}
                </span>
              )}
            </div>
          </div>
        </button>
        {/* Pin shortcut (kept for desktop hover; hidden visually on swipe-open) */}
        {!isOpen && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            className="absolute top-1.5 right-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg opacity-0 hover:opacity-100 focus:opacity-100"
            style={{ color: isPinned ? TT.accent : TT.textMute }}
            aria-label={isPinned
              ? t('trainerMessages.list.unpinAria', 'Unpin')
              : t('trainerMessages.list.pinAria', 'Pin')}
          >
            <Pin size={13} />
          </button>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Renders the trainer messages left pane:
 *   – Hero header with title + unread badge + new conversation button
 *   – Debounced search (parent owns query state)
 *   – Tabs: All / Unread / Pinned / Archived
 *   – Per-conversation rows with iOS-style swipe-left → Archive / Delete / Block
 *
 * Props:
 *   conversations[]    — { id, otherUser, lastMessage, unreadCount, pinned }
 *   activeId           — currently-open conversation id
 *   loading            — initial-load flag
 *   query, onQueryChange
 *   tabIndex, onTabChange
 *   pinnedIds          — Set<string>
 *   archivedIds        — Set<string>
 *   archivedCount      — number (visible non-hidden archived rows)
 *   onTogglePin(id)
 *   onSelect(id)
 *   onNewMessage()     — opens client picker
 *   swipedConvId       — id of the row currently swiped open (null if none)
 *   onSwipeOpen(id|null)
 *   onArchive(id), onDelete(id), onBlock(conv)
 *   t                  — translation fn (pages namespace)
 */
export default function ConversationList({
  conversations,
  activeId,
  loading,
  query,
  onQueryChange,
  tabIndex,
  onTabChange,
  pinnedIds,
  archivedIds = new Set(),
  archivedCount = 0,
  onTogglePin,
  onSelect,
  onNewMessage,
  swipedConvId = null,
  onSwipeOpen = () => {},
  onArchive = () => {},
  onDelete = () => {},
  onBlock = () => {},
  t,
}) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const totalUnread = useMemo(
    () => conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    [conversations]
  );

  // Sampled "now" for the online indicator — refreshed every 60s so the green
  // dot fades out without re-rendering on every mouse-move/keystroke.
  const [renderTime, setRenderTime] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setRenderTime(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const tabs = [
    { key: 'all',      label: t('trainerMessages.list.tabAll', 'All') },
    { key: 'unread',   label: t('trainerMessages.list.tabUnread', 'Unread'), count: totalUnread || null },
    { key: 'pinned',   label: t('trainerMessages.list.tabPinned', 'Pinned'), count: pinnedIds.size || null },
    { key: 'archived', label: t('trainerMessages.list.tabArchived', 'Archived'), count: archivedCount || null },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Search + tabs */}
      <div
        className="px-4 sm:px-5 pt-2 pb-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${TT.border}` }}
      >
        {/* Search */}
        <div
          className="flex items-center gap-2 px-3 rounded-xl"
          style={{ background: TT.surface2, border: `1px solid ${TT.border}` }}
        >
          <Search size={14} style={{ color: TT.textMute }} />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('trainerMessages.list.searchPlaceholder', 'Search conversations…')}
            maxLength={100}
            className="flex-1 bg-transparent outline-none text-[13px] py-2.5"
            style={{ color: TT.text }}
            aria-label={t('trainerMessages.list.searchPlaceholder', 'Search conversations…')}
          />
        </div>

        {/* Tabs */}
        <div className="mt-2 -mx-1">
          <UnderlineTabs tabs={tabs} activeIndex={tabIndex} onChange={onTabChange} />
        </div>
      </div>

      {/* List body */}
      <div className="flex-1 overflow-y-auto" onScroll={() => onSwipeOpen(null)}>
        {loading && (
          <div className="px-3 py-3 space-y-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: TT.surface2 }} />
            ))}
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <EmptyState
            icon={MessageCircle}
            title={t('trainerMessages.list.emptyTitle', 'No messages yet')}
            description={t('trainerMessages.list.emptyDesc', 'Start a conversation with a client')}
            actionLabel={t('trainerMessages.list.newBtn', 'New conversation')}
            onAction={onNewMessage}
            compact
          />
        )}

        {!loading && conversations.length > 0 && (
          <div style={{ padding: '12px 20px 28px' }}>
            <TCard padded={0} style={{ overflow: 'hidden' }}>
              {conversations.map((conv, i) => {
                const u = conv.otherUser;
                const isActive = activeId === conv.id;
                const isOnline = u?.last_active_at
                  && (renderTime - new Date(u.last_active_at).getTime()) < ONLINE_WINDOW_MS;
                const isPinned = pinnedIds.has(conv.id);
                const isArchived = archivedIds.has(conv.id);
                const isOpen = swipedConvId === conv.id;

                return (
                  <SwipeRow
                    key={conv.id}
                    conv={conv}
                    isActive={isActive}
                    isPinned={isPinned}
                    isOnline={isOnline}
                    isArchived={isArchived}
                    isOpen={isOpen}
                    isFirst={i === 0}
                    onOpenSwipe={() => onSwipeOpen(conv.id)}
                    onCollapseSwipe={() => onSwipeOpen(null)}
                    onSelect={onSelect}
                    onTogglePin={() => onTogglePin(conv.id)}
                    onArchive={() => onArchive(conv.id)}
                    onDelete={() => onDelete(conv.id)}
                    onBlock={() => onBlock(conv)}
                    renderTime={renderTime}
                    t={t}
                    lang={lang}
                  />
                );
              })}
            </TCard>
          </div>
        )}
      </div>
    </div>
  );
}
