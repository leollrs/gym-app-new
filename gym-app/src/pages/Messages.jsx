import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle, Send, ArrowLeft, Search, Plus, X, ChevronLeft, Archive, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import UserAvatar from '../components/UserAvatar';
import EmptyState from '../components/EmptyState';
import { encryptMessage, decryptMessage } from '../lib/messageEncryption';
import { sanitize } from '../lib/sanitize';
import { Capacitor } from '@capacitor/core';
import { usePostHog } from '@posthog/react';

// Keyboard plugin — only available on native platforms
let Keyboard = null;
if (Capacitor.isNativePlatform()) {
  import('@capacitor/keyboard').then(mod => { Keyboard = mod.Keyboard; }).catch(() => {});
}

// ── Helpers ──────────────────────────────────────────────────────
const formatTime = (dateStr, t) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const oneDay = 86400000;

  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return t('messages.yesterday');
  }

  if (diff < 7 * oneDay) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatTimestamp = (dateStr, t) => {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  let dayPart;
  if (d.toDateString() === now.toDateString()) {
    dayPart = '';
  } else if (d.toDateString() === yesterday.toDateString()) {
    dayPart = t('messages.yesterday') + ' ';
  } else {
    dayPart = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' ';
  }
  return dayPart + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/** Returns true if two timestamps are more than 5 minutes apart. */
const shouldShowTimestamp = (prevDateStr, currDateStr) => {
  if (!prevDateStr) return true;
  const diff = Math.abs(new Date(currDateStr) - new Date(prevDateStr));
  return diff >= 5 * 60 * 1000;
};

// ── Member Picker Modal ──────────────────────────────────────────
const MemberPicker = ({ isOpen, onClose, onSelect }) => {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) { setQuery(''); setResults([]); return; }
  }, [isOpen]);

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

      // Search within friends only
      const safeQuery = query.replace(/[%_\\,()."']/g, '');
      const { data } = await supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role')
        .in('id', friendIds)
        .or(`full_name.ilike.%${safeQuery}%,username.ilike.%${safeQuery}%`)
        .limit(20);
      setResults(data || []);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, user.id]);

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
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const posthog = usePostHog();
  const [messages, setMessages] = useState([]);
  const [otherUser, setOtherUser] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);
  const [kbHeight, setKbHeight] = useState(0);
  const encryptionSeedRef = useRef(null);

  // Native keyboard events — get exact height from Capacitor plugin
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Keyboard) return;
    const listeners = [];
    Keyboard.addListener('keyboardWillShow', (info) => {
      setKbHeight(info.keyboardHeight);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    }).then(h => listeners.push(h));
    Keyboard.addListener('keyboardWillHide', () => {
      setKbHeight(0);
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

      await supabase
        .from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .neq('sender_id', user.id)
        .is('read_at', null);
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
          decryptMessage(payload.new.body, conversationId, encryptionSeedRef.current).then(decryptedBody => {
            setMessages(prev => {
              if (prev.some(m => m.id === payload.new.id)) return prev;
              return [...prev, { ...payload.new, body: decryptedBody }];
            });
          });

          if (payload.new.sender_id !== user.id) {
            supabase
              .from('direct_messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', payload.new.id)
              .then(() => {});
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

    setSending(true);
    setInput('');

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const body = await encryptMessage(plaintext, conversationId, encryptionSeedRef.current);
    const { error } = await supabase.from('direct_messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    });

    if (!error) {
      posthog?.capture('dm_sent', { is_first_message: messages.length === 0 });
      // Optimistic: add to local state immediately
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), // temp ID, will be replaced by realtime
        conversation_id: conversationId,
        sender_id: user.id,
        body: plaintext, // Show the decrypted text locally
        read_at: null,
        created_at: new Date().toISOString(),
      }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
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
      chatItems.push({ type: 'timestamp', label: formatTimestamp(msg.created_at, t), key: `ts-${msg.id}` });
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
    <div className="fixed left-0 right-0 top-0 z-[60] flex flex-col" style={{ background: 'var(--color-bg-primary)', paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))', bottom: kbHeight > 0 ? kbHeight + 'px' : '0px', transition: 'bottom 0.25s ease-out' }}>
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
          {otherUser?.role === 'trainer' && (
            <p className="text-[11px] font-semibold" style={{ color: 'var(--color-accent, #D4AF37)' }}>{t('messages.trainer', { defaultValue: 'Trainer' })}</p>
          )}
        </div>
        <div className="flex-shrink-0 w-[44px] flex justify-center">
          {otherUser && <UserAvatar user={otherUser} size={32} />}
        </div>
      </div>

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
                <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`px-3.5 py-2 text-[15px] leading-relaxed break-words max-w-[75%] ${
                      isSent
                        ? 'bg-[var(--color-accent,#D4AF37)] text-black rounded-2xl rounded-br-sm'
                        : 'bg-white/[0.08] rounded-2xl rounded-bl-sm'
                    }`}
                    style={!isSent ? { color: 'var(--color-text-primary)' } : undefined}
                  >
                    {sanitize(msg.body)}
                  </div>
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
        style={{ background: 'var(--color-bg-card)', paddingBottom: kbHeight > 0 ? '0.5rem' : 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <textarea
          ref={inputRef}
          value={input}
          maxLength={5000}
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
          <Send size={18} className="text-black ml-0.5" />
        </button>
      </div>
    </div>
  );
};

// ── Swipeable Row (Apple-style swipe actions) ──────────────────
const SwipeableRow = ({ children, onArchive, onDelete, openRowId, setOpenRowId, rowId, t }) => {
  const rowRef = useRef(null);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const [offsetX, setOffsetX] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const SNAP_THRESHOLD = 80;
  const FULL_SWIPE_THRESHOLD = 200;
  const OPEN_WIDTH = 150; // 75px per button

  // Close when another row opens
  useEffect(() => {
    if (openRowId !== rowId && isOpen) {
      setTransitioning(true);
      setOffsetX(0);
      setIsOpen(false);
      setDeleteConfirm(false);
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
      // Full swipe — trigger delete directly
      setOffsetX(0);
      setIsOpen(false);
      setDeleteConfirm(false);
      onDelete();
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
      setDeleteConfirm(false);
    }
  }, [offsetX, onDelete, rowId, setOpenRowId, isOpen]);

  const handleClose = useCallback(() => {
    setTransitioning(true);
    setOffsetX(0);
    setIsOpen(false);
    setDeleteConfirm(false);
    setTimeout(() => setTransitioning(false), 300);
  }, []);

  const handleArchiveClick = useCallback((e) => {
    e.stopPropagation();
    handleClose();
    onArchive();
  }, [onArchive, handleClose]);

  const handleDeleteClick = useCallback((e) => {
    e.stopPropagation();
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    handleClose();
    onDelete();
  }, [deleteConfirm, onDelete, handleClose]);

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
        <button
          onClick={handleArchiveClick}
          style={{
            width: 75,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            background: 'var(--color-bg-elevated, #374151)',
            color: 'var(--color-text-primary, #fff)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <Archive size={20} />
          <span>{t('messages.archive', { defaultValue: 'Archive' })}</span>
        </button>
        <button
          onClick={handleDeleteClick}
          style={{
            width: deleteConfirm ? 100 : 75,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            background: 'var(--color-danger, #EF4444)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            transition: 'width 0.2s ease',
          }}
        >
          <Trash2 size={20} />
          <span>{deleteConfirm ? t('messages.deleteConfirm', { defaultValue: 'Delete?' }) : t('messages.deleteConversation', { defaultValue: 'Delete' })}</span>
        </button>
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

// ── Conversation List View (iMessage style) ─────────────────────
const ConversationList = ({ onSelectConversation, onNewMessage, onGoBack, headerExtra }) => {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openRowId, setOpenRowId] = useState(null);
  const [archivedIds, setArchivedIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('archived_conversations') || '[]');
    } catch { return []; }
  });

  const loadConversations = useCallback(async () => {
    setLoading(true);

    const { data: convs } = await supabase
      .from('conversations')
      .select('id, participant_1, participant_2, last_message_at, encryption_seed')
      .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
      .order('last_message_at', { ascending: false });

    if (!convs || convs.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const otherIds = convs.map(c => c.participant_1 === user.id ? c.participant_2 : c.participant_1);
    const uniqueIds = [...new Set(otherIds)];

    const { data: profiles } = await supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role')
      .in('id', uniqueIds);

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
    const channel = supabase
      .channel('dm-list')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => loadConversations(), 2000);
        }
      )
      .subscribe();

    return () => { clearTimeout(debounceTimer); supabase.removeChannel(channel); };
  }, [loadConversations]);

  // Close swipe row when tapping outside
  const handleListClick = useCallback(() => {
    if (openRowId) setOpenRowId(null);
  }, [openRowId]);

  const handleArchive = useCallback((convId) => {
    setArchivedIds(prev => {
      const next = [...prev, convId];
      localStorage.setItem('archived_conversations', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDelete = useCallback(async (convId) => {
    // Optimistic removal from local state
    setConversations(prev => prev.filter(c => c.id !== convId));
    // Delete messages then conversation from database
    await supabase.from('direct_messages').delete().eq('conversation_id', convId);
    await supabase.from('conversations').delete().eq('id', convId);
  }, []);

  // Filter conversations by search query and exclude archived
  const filteredConversations = useMemo(() => {
    let result = conversations.filter(c => !archivedIds.includes(c.id));
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter(conv => {
      const name = (conv.otherUser?.full_name || '').toLowerCase();
      const username = (conv.otherUser?.username || '').toLowerCase();
      const lastMsg = (conv.lastMessage?.body || '').toLowerCase();
      return name.includes(q) || username.includes(q) || lastMsg.includes(q);
    });
  }, [conversations, searchQuery, archivedIds]);

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
        <div className="flex flex-col items-center justify-center py-12 gap-2 px-4">
          <Search size={24} style={{ color: 'var(--color-text-subtle)' }} />
          <p className="text-[14px]" style={{ color: 'var(--color-text-subtle)' }}>
            {t('messages.noSearchResults', { defaultValue: 'No conversations match your search' })}
          </p>
        </div>
      ) : (
        <div onClick={handleListClick}>
          {filteredConversations.map((conv, idx) => {
            const other = conv.otherUser;
            const displayName = other?.full_name || other?.username || t('messages.member', { defaultValue: 'Member' });
            const preview = conv.lastMessage?.body
              ? sanitize(conv.lastMessage.body.length > 60
                ? conv.lastMessage.body.slice(0, 60) + '...'
                : conv.lastMessage.body)
              : '';
            const isSentByMe = conv.lastMessage?.sender_id === user.id;
            const hasUnread = conv.unreadCount > 0;

            return (
              <SwipeableRow
                key={conv.id}
                rowId={conv.id}
                openRowId={openRowId}
                setOpenRowId={setOpenRowId}
                onArchive={() => handleArchive(conv.id)}
                onDelete={() => handleDelete(conv.id)}
                t={t}
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
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-[var(--color-accent,#D4AF37)] text-black text-[10px] font-bold flex items-center justify-center">
                        {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {/* Name + time on same line */}
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-[16px] truncate ${hasUnread ? 'font-bold' : 'font-semibold'}`} style={{ color: 'var(--color-text-primary)' }}>
                        {displayName}
                      </p>
                      {conv.lastMessage && (
                        <span className="text-[12px] flex-shrink-0" style={{ color: hasUnread ? 'var(--color-accent, #D4AF37)' : 'var(--color-text-muted)' }}>
                          {formatTime(conv.lastMessage.created_at, t)}
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
