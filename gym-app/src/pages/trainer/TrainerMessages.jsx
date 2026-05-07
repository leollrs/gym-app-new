import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, MessageCircle, Send, Search, X, Loader2, Plus,
  Dumbbell, CalendarPlus, ExternalLink,
} from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { encryptMessage, decryptMessage } from '../../lib/messageEncryption';
import { sanitize } from '../../lib/sanitize';
import logger from '../../lib/logger';
import UserAvatar from '../../components/UserAvatar';
import EmptyState from '../../components/EmptyState';
import ConversationList from './components/ConversationList';
import WorkoutShareModal from './components/WorkoutShareModal';
import { TT } from './components/designTokens';
import { TEyebrow, TPageTitle, TIconButton } from './components/designPrimitives';

// Lazy capacitor keyboard import (mirrors Messages.jsx)
let Keyboard = null;
if (Capacitor.isNativePlatform()) {
  import('@capacitor/keyboard').then(mod => { Keyboard = mod.Keyboard; }).catch(() => {});
}

const PIN_STORAGE_KEY = 'trainer_pinned_conversations_v1';
const ARCHIVE_STORAGE_KEY = 'trainer_archived_conversations_v1';
const HIDDEN_STORAGE_KEY = 'trainer_hidden_conversations_v1';

function loadIdSet(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}

function saveIdSet(storageKey, set) {
  try { localStorage.setItem(storageKey, JSON.stringify([...set])); } catch { /* quota */ }
}

function loadPinned() { return loadIdSet(PIN_STORAGE_KEY); }
function savePinned(set) { saveIdSet(PIN_STORAGE_KEY, set); }
function loadArchived() { return loadIdSet(ARCHIVE_STORAGE_KEY); }
function saveArchived(set) { saveIdSet(ARCHIVE_STORAGE_KEY, set); }
function loadHidden() { return loadIdSet(HIDDEN_STORAGE_KEY); }
function saveHidden(set) { saveIdSet(HIDDEN_STORAGE_KEY, set); }

function shouldShowTimestamp(prev, curr) {
  if (!prev) return true;
  return Math.abs(new Date(curr) - new Date(prev)) >= 5 * 60 * 1000;
}

function formatTimestamp(dateStr, t, lang) {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  let dayPart;
  if (d.toDateString() === now.toDateString()) {
    dayPart = '';
  } else if (d.toDateString() === yesterday.toDateString()) {
    dayPart = `${t('trainerMessages.thread.yesterday')} `;
  } else {
    dayPart = `${d.toLocaleDateString(lang, { weekday: 'short', month: 'short', day: 'numeric' })} `;
  }
  return dayPart + d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

// ── Workout share bubble renderer ───────────────────────────────
const WORKOUT_TOKEN = /\[workout:([0-9a-fA-F-]{36}):(\d+)\]/;

function WorkoutShareCard({ planId, dayIndex, t }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('trainer_workout_plans')
          .select('id, name, weeks, duration_weeks')
          .eq('id', planId)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setPlan(data);
      } catch (err) {
        logger.error('WorkoutShareCard: failed to load plan', err);
        if (!cancelled) setPlan(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [planId]);

  const dayName = useMemo(() => {
    try {
      const day = plan?.weeks?.['1']?.[dayIndex];
      if (day?.name) return day.name;
    } catch { /* ignore */ }
    return t('trainerMessages.share.dayN', { n: dayIndex + 1 });
  }, [plan, dayIndex, t]);

  const exerciseCount = useMemo(() => {
    try {
      const exs = plan?.weeks?.['1']?.[dayIndex]?.exercises;
      if (Array.isArray(exs)) return exs.length;
    } catch { /* ignore */ }
    return 0;
  }, [plan, dayIndex]);

  return (
    <div
      className="rounded-2xl p-3 max-w-[280px]"
      style={{
        background: 'color-mix(in srgb, var(--color-accent) 10%, var(--color-bg-card))',
        border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}
        >
          <Dumbbell size={13} style={{ color: 'var(--color-accent)' }} />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
          {t('trainerMessages.share.cardLabel')}
        </p>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.06))' }} />
          <div className="h-3 w-1/2 rounded animate-pulse" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.06))' }} />
        </div>
      ) : plan ? (
        <>
          <p className="text-[14px] font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
            {plan.name}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {dayName} · {t('trainerMessages.share.exerciseCount', { count: exerciseCount })}
          </p>
        </>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('trainerMessages.share.cardMissing')}
        </p>
      )}
    </div>
  );
}

function MessageBody({ body, t }) {
  const match = WORKOUT_TOKEN.exec(body || '');
  if (!match) {
    return <span className="whitespace-pre-wrap">{sanitize(body || '')}</span>;
  }
  const [token, planId, dayIdx] = match;
  const before = body.slice(0, match.index).trim();
  const after  = body.slice(match.index + token.length).trim();
  return (
    <div className="space-y-2">
      {before && <p className="whitespace-pre-wrap">{sanitize(before)}</p>}
      <WorkoutShareCard planId={planId} dayIndex={parseInt(dayIdx, 10) || 0} t={t} />
      {after && <p className="whitespace-pre-wrap">{sanitize(after)}</p>}
    </div>
  );
}

// ── Coming soon mini-modal for "Schedule session" ───────────────
function ScheduleSoonModal({ open, onClose, t }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl overflow-hidden"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
      >
        <div className="px-5 py-5 text-center">
          <div
            className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
          >
            <CalendarPlus size={22} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h3 className="text-[16px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
            {t('trainerMessages.scheduleSoon.title')}
          </h3>
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('trainerMessages.scheduleSoon.body')}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-xl text-[13px] font-semibold"
              style={{ border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
            >
              {t('trainerMessages.scheduleSoon.cancel')}
            </button>
            <button
              type="button"
              onClick={() => { onClose(); navigate('/trainer/calendar'); }}
              className="flex-1 min-h-[44px] rounded-xl text-[13px] font-bold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
            >
              {t('trainerMessages.scheduleSoon.openCalendar')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Client picker (start a new chat with one of the trainer's clients) ──
function ClientPicker({ open, onClose, trainerId, onPick, t }) {
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !trainerId) return undefined;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('trainer_clients')
          .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value)')
          .eq('trainer_id', trainerId)
          .eq('is_active', true);
        if (error) throw error;
        const list = (data || []).map(r => r.profiles).filter(Boolean);
        if (!cancelled) setClients(list);
      } catch (err) {
        logger.error('ClientPicker: failed', err);
        if (!cancelled) setClients([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, trainerId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.username || '').toLowerCase().includes(q)
    );
  }, [clients, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center px-4 pt-20 sm:pt-0 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[70vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('trainerMessages.picker.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label={t('trainerMessages.picker.close')}
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-3">
          <div
            className="flex items-center gap-2 px-3 rounded-xl"
            style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', border: '1px solid var(--color-border-subtle)' }}
          >
            <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('trainerMessages.picker.searchPlaceholder')}
              autoFocus
              maxLength={100}
              className="flex-1 bg-transparent outline-none text-[13px] py-2.5"
              style={{ color: 'var(--color-text-primary)' }}
            />
          </div>
        </div>
        <div className="overflow-y-auto px-2 pb-3">
          {loading && (
            <div className="space-y-2 px-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }} />
              ))}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-[13px] py-6" style={{ color: 'var(--color-text-muted)' }}>
              {t('trainerMessages.picker.empty')}
            </p>
          )}
          {!loading && filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left min-h-[48px] rounded-lg"
            >
              <UserAvatar user={c} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {c.full_name || c.username || t('trainerMessages.list.clientFallback')}
                </p>
                {c.username && (
                  <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>@{c.username}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function TrainerMessages() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const navigate = useNavigate();
  const { conversationId: routeConvId } = useParams();

  const [conversations, setConversations] = useState([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [activeConvId, setActiveConvId] = useState(routeConvId || null);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [tabIndex, setTabIndex] = useState(0); // 0=All, 1=Unread, 2=Pinned

  const [pinnedIds, setPinnedIds] = useState(loadPinned);
  const [archivedIds, setArchivedIds] = useState(loadArchived);
  const [hiddenIds, setHiddenIds] = useState(loadHidden);
  // Tracks which conversation row is currently swiped open (only one at a
  // time, iMessage-style). null = nothing swiped.
  const [swipedConvId, setSwipedConvId] = useState(null);

  // Right-pane (active thread) state
  const [otherUser, setOtherUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const encryptionSeedRef = useRef(null);

  // Modals
  const [showShare, setShowShare] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const [kbHeight, setKbHeight] = useState(0);

  // ── Page title ─────────────
  useEffect(() => { document.title = `${t('trainerMessages.list.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // ── Sync route param → activeConvId ─────
  useEffect(() => { setActiveConvId(routeConvId || null); }, [routeConvId]);

  // ── Debounced search ─────────
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery.trim().toLowerCase()), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // ── Native keyboard ─────────
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Keyboard) return undefined;
    const listeners = [];
    Keyboard.addListener('keyboardWillShow', (info) => {
      setKbHeight(info.keyboardHeight);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    }).then(h => listeners.push(h));
    Keyboard.addListener('keyboardWillHide', () => setKbHeight(0)).then(h => listeners.push(h));
    return () => { listeners.forEach(h => h.remove()); };
  }, []);

  // ── Load conversation list ────────────
  const loadConversations = useCallback(async () => {
    if (!profile?.id) return;
    setConvsLoading(true);
    try {
      const { data: rawConvs, error } = await supabase
        .from('conversations')
        .select('id, participant_1, participant_2, last_message_at, encryption_seed')
        .or(`participant_1.eq.${profile.id},participant_2.eq.${profile.id}`)
        .order('last_message_at', { ascending: false });
      if (error) throw error;

      // Filter out any self-conversations (participant_1 === participant_2 === me).
      // Migration 0355 blocks creating new ones at the RPC layer, but legacy
      // rows may still exist — strip them from the UI.
      const convs = (rawConvs || []).filter(c => c.participant_1 !== c.participant_2);

      if (!convs || convs.length === 0) {
        setConversations([]);
        return;
      }

      const otherIds = [...new Set(convs.map(c => (c.participant_1 === profile.id ? c.participant_2 : c.participant_1)))];

      const { data: profiles } = await supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role, last_active_at')
        .in('id', otherIds);

      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.id] = p; });

      const enriched = await Promise.all(convs.map(async (conv) => {
        const otherId = conv.participant_1 === profile.id ? conv.participant_2 : conv.participant_1;

        const { data: lastMsg } = await supabase
          .from('direct_messages')
          .select('body, sender_id, created_at, read_at')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { count } = await supabase
          .from('direct_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('sender_id', profile.id)
          .is('read_at', null);

        const decryptedBody = lastMsg?.body
          ? await decryptMessage(lastMsg.body, conv.id, conv.encryption_seed)
          : null;

        return {
          ...conv,
          otherUser: profileMap[otherId] || null,
          lastMessage: lastMsg ? { ...lastMsg, body: decryptedBody } : null,
          unreadCount: count || 0,
        };
      }));

      setConversations(enriched);
    } catch (err) {
      logger.error('TrainerMessages: failed to load conversations', err);
      setConversations([]);
    } finally {
      setConvsLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Realtime subscription on the list (debounced reload)
  useEffect(() => {
    if (!profile?.id) return undefined;
    let timer;
    const channel = supabase
      .channel('trainer-dm-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => loadConversations(), 1500);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [profile?.id, loadConversations]);

  // ── Load active thread ───────────────
  useEffect(() => {
    if (!activeConvId || !profile?.id) {
      setMessages([]);
      setOtherUser(null);
      return undefined;
    }
    let cancelled = false;
    setThreadLoading(true);

    (async () => {
      try {
        const { data: conv } = await supabase
          .from('conversations')
          .select('participant_1, participant_2, encryption_seed')
          .eq('id', activeConvId)
          .single();
        if (cancelled || !conv) return;

        encryptionSeedRef.current = conv.encryption_seed;
        const otherId = conv.participant_1 === profile.id ? conv.participant_2 : conv.participant_1;

        const { data: u } = await supabase
          .from('gym_member_profiles_safe')
          .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role, last_active_at')
          .eq('id', otherId)
          .single();
        if (!cancelled) setOtherUser(u);

        const { data: msgs } = await supabase
          .from('direct_messages')
          .select('*')
          .eq('conversation_id', activeConvId)
          .order('created_at', { ascending: true });

        if (!cancelled) {
          const decrypted = await Promise.all((msgs || []).map(async m => ({
            ...m,
            body: await decryptMessage(m.body, activeConvId, conv.encryption_seed),
          })));
          setMessages(decrypted);
        }

        // Mark unread as read
        await supabase
          .from('direct_messages')
          .update({ read_at: new Date().toISOString() })
          .eq('conversation_id', activeConvId)
          .neq('sender_id', profile.id)
          .is('read_at', null);
      } catch (err) {
        logger.error('TrainerMessages: failed to load thread', err);
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeConvId, profile?.id]);

  // ── Scroll to bottom on new message ──
  useEffect(() => {
    if (!activeConvId) return;
    bottomRef.current?.scrollIntoView({ behavior: messages.length <= 20 ? 'auto' : 'smooth' });
  }, [messages, activeConvId]);

  // ── Realtime thread subscription ─────
  useEffect(() => {
    if (!activeConvId || !profile?.id) return undefined;
    const channel = supabase
      .channel(`trainer-dm-${activeConvId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${activeConvId}` },
        (payload) => {
          decryptMessage(payload.new.body, activeConvId, encryptionSeedRef.current).then(decryptedBody => {
            setMessages(prev => {
              if (prev.some(m => m.id === payload.new.id)) return prev;
              return [...prev, { ...payload.new, body: decryptedBody }];
            });
          });
          if (payload.new.sender_id !== profile.id) {
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
        { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${activeConvId}` },
        (payload) => {
          if (payload.new.read_at && payload.new.sender_id === profile.id) {
            setMessages(prev => prev.map(m =>
              m.id === payload.new.id ? { ...m, read_at: payload.new.read_at } : m
            ));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeConvId, profile?.id]);

  // ── Filter conversations by query + tab ─────
  const visibleConversations = useMemo(() => {
    // 1. Always strip locally-hidden (swipe-deleted) conversations first.
    let list = conversations.filter(c => !hiddenIds.has(c.id));
    // 2. Tab-aware: archived rows live behind the dedicated Archived tab only.
    //    For All / Unread / Pinned, archived rows are hidden.
    if (tabIndex === 3) {
      list = list.filter(c => archivedIds.has(c.id));
    } else {
      list = list.filter(c => !archivedIds.has(c.id));
    }
    if (tabIndex === 1) list = list.filter(c => (c.unreadCount || 0) > 0);
    if (tabIndex === 2) list = list.filter(c => pinnedIds.has(c.id));

    if (debouncedQuery) {
      list = list.filter(c => {
        const u = c.otherUser;
        const name = (u?.full_name || u?.username || '').toLowerCase();
        return name.includes(debouncedQuery);
      });
    }

    // Pinned first
    return [...list].sort((a, b) => {
      const aP = pinnedIds.has(a.id) ? 1 : 0;
      const bP = pinnedIds.has(b.id) ? 1 : 0;
      if (aP !== bP) return bP - aP;
      return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
    });
  }, [conversations, tabIndex, debouncedQuery, pinnedIds]);

  // ── Actions ─────────
  const togglePin = (id) => {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      savePinned(next);
      return next;
    });
  };

  // Archive: locally-stored flag, hides the row from default tabs.
  const handleArchive = (id) => {
    setArchivedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveArchived(next);
      return next;
    });
    setSwipedConvId(null);
    if (activeConvId === id) setActiveConvId(null);
  };

  // Delete: hides the conversation from this trainer's view (does not delete
  // the underlying record — preserves audit trail and the other party's copy).
  const handleDelete = (id) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      saveHidden(next);
      return next;
    });
    setSwipedConvId(null);
    if (activeConvId === id) setActiveConvId(null);
    showToast(t('trainerMessages.deleted', { defaultValue: 'Conversation removed.' }), 'info');
  };

  // Block: insert into blocked_users + hide the conversation locally. Mirrors
  // the member-side flow in Messages.jsx (handleBlockOther).
  const handleBlock = async (conv) => {
    const otherId = conv.otherUser?.id;
    if (!otherId || !profile?.id) return;
    try {
      const { error } = await supabase.from('blocked_users').upsert(
        { blocker_id: profile.id, blocked_id: otherId },
        { onConflict: 'blocker_id,blocked_id' },
      );
      if (error) throw error;
      handleDelete(conv.id);
      showToast(t('trainerMessages.blocked', {
        defaultValue: '{{name}} blocked.',
        name: conv.otherUser?.full_name?.split(' ')[0] || '',
      }), 'success');
    } catch (err) {
      logger.error('TrainerMessages handleBlock failed:', err);
      showToast(t('trainerMessages.blockError', { defaultValue: 'Could not block user.' }), 'error');
    }
  };

  const handleSelect = (id) => {
    setActiveConvId(id);
    navigate(`/trainer/messages/${id}`, { replace: false });
  };

  const handleBack = () => {
    setActiveConvId(null);
    navigate('/trainer/messages', { replace: false });
  };

  const sendText = useCallback(async (plaintext) => {
    if (!plaintext?.trim() || !activeConvId || !profile?.id) return;
    setSending(true);
    try {
      const body = await encryptMessage(plaintext, activeConvId, encryptionSeedRef.current);
      const tempId = `temp-${Date.now()}`;
      // Optimistic
      setMessages(prev => [...prev, {
        id: tempId,
        conversation_id: activeConvId,
        sender_id: profile.id,
        body: plaintext,
        read_at: null,
        created_at: new Date().toISOString(),
        _optimistic: true,
      }]);

      const { data: inserted, error } = await supabase
        .from('direct_messages')
        .insert({ conversation_id: activeConvId, sender_id: profile.id, body })
        .select()
        .single();
      if (error) throw error;

      // Replace temp row with real one (decrypted body kept)
      setMessages(prev => prev.map(m => m.id === tempId ? { ...inserted, body: plaintext } : m));

      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', activeConvId);
    } catch (err) {
      logger.error('TrainerMessages: send failed', err);
      // Mark optimistic message as failed (simple visual fade)
      setMessages(prev => prev.map(m => m._optimistic ? { ...m, _failed: true } : m));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [activeConvId, profile?.id]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    sendText(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = async (clientProfile) => {
    setShowPicker(false);
    if (!clientProfile?.id) return;
    try {
      const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientProfile.id });
      if (convId) {
        await loadConversations();
        handleSelect(convId);
      }
    } catch (err) {
      logger.error('TrainerMessages: failed to start conversation', err);
    }
  };

  // ── Build chat items with grouping for nicer bubbles ───────
  const chatItems = useMemo(() => {
    const out = [];
    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i];
      const prev = i > 0 ? messages[i - 1] : null;
      const next = i < messages.length - 1 ? messages[i + 1] : null;
      if (shouldShowTimestamp(prev?.created_at, msg.created_at)) {
        out.push({ type: 'timestamp', label: formatTimestamp(msg.created_at, t, i18n.language), key: `ts-${msg.id}` });
      }
      const isSent = msg.sender_id === profile?.id;
      const prevSame = prev && prev.sender_id === msg.sender_id && !shouldShowTimestamp(prev.created_at, msg.created_at);
      const isLastSent = isSent && (i === messages.length - 1 || messages.slice(i + 1).every(m => m.sender_id !== profile?.id));
      out.push({ type: 'message', data: msg, key: msg.id, isSent, prevSame, isLastSent, isOptimistic: !!msg._optimistic, isFailed: !!msg._failed });
      if (next && next.sender_id !== msg.sender_id) {
        // intentionally no extra spacer; CSS margins handle it
      }
    }
    return out;
  }, [messages, profile?.id, t]);

  const showThreadOnMobile = !!activeConvId;
  const trainerName = profile?.full_name || profile?.username || t('trainerMessages.list.clientFallback');
  void trainerName;

  // Hide the trainer mobile bottom nav whenever a thread is open so the
  // composer sits flush with the screen edge (iMessage-style fullscreen).
  // Pairs with `body.trainer-thread-active` rules in index.css.
  useEffect(() => {
    if (!showThreadOnMobile) return;
    document.body.classList.add('trainer-thread-active');
    return () => document.body.classList.remove('trainer-thread-active');
  }, [showThreadOnMobile]);

  return (
    <div className="trainer-messages-page" style={{ background: TT.bg }}>
      <div className="max-w-7xl mx-auto h-full md:h-[calc(100vh-2rem)]">
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] h-full overflow-hidden rounded-none lg:rounded-2xl lg:m-2"
          style={{ background: TT.bg, border: `1px solid ${TT.border}` }}
        >
          {/* Left pane — conversation list (hidden on mobile when thread open) */}
          <aside
            className={`${showThreadOnMobile ? 'hidden lg:flex' : 'flex'} flex-col h-full lg:border-r`}
            style={{ borderColor: TT.border }}
          >
            {/* Page-level header: TEyebrow + TPageTitle + TIconButton (mobile + desktop visible) */}
            <div style={{ padding: '12px 16px 6px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <TEyebrow>
                    {t('trainerMessages.list.eyebrow', 'Inbox')} · {t('messages.unreadCount', { count: conversations.reduce((a, c) => a + (c.unreadCount || 0), 0), defaultValue: '{{count}} unread' })}
                  </TEyebrow>
                  <TPageTitle>{t('trainerMessages.list.title', 'Messages')}</TPageTitle>
                </div>
                <TIconButton
                  ariaLabel={t('trainerMessages.list.newAria', 'Start new conversation')}
                  onClick={() => setShowPicker(true)}
                  size={44}
                  style={{ background: TT.accent, border: 'none' }}
                >
                  <Plus size={22} strokeWidth={2.6} color="#06363B" />
                </TIconButton>
              </div>
            </div>

            <ConversationList
              conversations={visibleConversations}
              activeId={activeConvId}
              loading={convsLoading}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              tabIndex={tabIndex}
              onTabChange={setTabIndex}
              pinnedIds={pinnedIds}
              archivedIds={archivedIds}
              archivedCount={[...archivedIds].filter(id => !hiddenIds.has(id)).length}
              onTogglePin={togglePin}
              onSelect={handleSelect}
              onNewMessage={() => setShowPicker(true)}
              swipedConvId={swipedConvId}
              onSwipeOpen={setSwipedConvId}
              onArchive={handleArchive}
              onDelete={handleDelete}
              onBlock={handleBlock}
              t={t}
            />
          </aside>

          {/* Right pane — active thread */}
          <main className={`${showThreadOnMobile ? 'flex' : 'hidden lg:flex'} flex-col h-full`}>
            {!activeConvId ? (
              <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                <EmptyState
                  icon={MessageCircle}
                  title={t('trainerMessages.thread.emptyTitle')}
                  description={t('trainerMessages.thread.emptyDesc')}
                />
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}
                >
                  <button
                    type="button"
                    onClick={handleBack}
                    className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl"
                    style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-accent)' }}
                    aria-label={t('trainerMessages.thread.back')}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="shrink-0">
                    {otherUser && <UserAvatar user={otherUser} size={40} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {otherUser?.full_name || otherUser?.username || t('trainerMessages.list.clientFallback')}
                    </p>
                    {otherUser && (
                      <button
                        type="button"
                        onClick={() => navigate(`/trainer/clients/${otherUser.id}`)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {t('trainerMessages.thread.viewProfile')}
                        <ExternalLink size={11} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick actions strip */}
                <div
                  className="flex items-center gap-2 px-3 py-2 overflow-x-auto flex-shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}
                >
                  <button
                    type="button"
                    onClick={() => setShowShare(true)}
                    className="shrink-0 min-h-[36px] h-9 px-3 rounded-xl flex items-center gap-1.5 text-[12px] font-semibold transition-colors"
                    style={{
                      background: 'var(--color-surface-hover, rgba(0,0,0,0.04))',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <Dumbbell size={13} />
                    {t('trainerMessages.actions.shareWorkout')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSchedule(true)}
                    className="shrink-0 min-h-[36px] h-9 px-3 rounded-xl flex items-center gap-1.5 text-[12px] font-semibold transition-colors"
                    style={{
                      background: 'var(--color-surface-hover, rgba(0,0,0,0.04))',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <CalendarPlus size={13} />
                    {t('trainerMessages.actions.scheduleSession')}
                  </button>
                </div>

                {/* Messages */}
                <div
                  className="flex-1 overflow-y-auto px-3 py-2"
                  style={{ paddingBottom: kbHeight ? `${kbHeight}px` : undefined }}
                >
                  {threadLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                    </div>
                  ) : messages.length === 0 ? (
                    <EmptyState
                      icon={MessageCircle}
                      title={t('trainerMessages.thread.startTitle')}
                      description={t('trainerMessages.thread.startDesc')}
                      compact
                    />
                  ) : (
                    chatItems.map(item => {
                      if (item.type === 'timestamp') {
                        return (
                          <div key={item.key} className="flex items-center justify-center py-2">
                            <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                              {item.label}
                            </span>
                          </div>
                        );
                      }
                      const { data: msg, isSent, prevSame, isLastSent, isOptimistic, isFailed } = item;
                      const marginTop = prevSame ? 'mt-[2px]' : 'mt-2';
                      return (
                        <div key={item.key} className={marginTop}>
                          <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className="px-3.5 py-2 text-[14px] leading-relaxed break-words max-w-[78%]"
                              style={isSent
                                ? {
                                    background: TT.accent,
                                    color: '#06363B',
                                    borderRadius: 18,
                                    borderBottomRightRadius: 6,
                                    opacity: isOptimistic && !isFailed ? 0.8 : 1,
                                    border: isFailed ? `1px solid ${TT.hot}` : 'none',
                                  }
                                : {
                                    background: TT.surface2,
                                    color: TT.text,
                                    border: `1px solid ${TT.border}`,
                                    borderRadius: 18,
                                    borderBottomLeftRadius: 6,
                                  }
                              }
                            >
                              <MessageBody body={msg.body} t={t} />
                            </div>
                          </div>
                          {isLastSent && (
                            <p className="text-[10px] text-right mt-0.5 mr-1"
                              style={{ color: isFailed ? TT.hot : (msg.read_at ? TT.accent : TT.textMute) }}
                            >
                              {isFailed
                                ? t('trainerMessages.thread.failed')
                                : (msg.read_at ? t('trainerMessages.thread.seen') : t('trainerMessages.thread.sent'))}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Composer */}
                <div
                  className="flex items-end gap-2 px-3 py-2 flex-shrink-0"
                  style={{
                    borderTop: '1px solid var(--color-border-subtle)',
                    background: 'var(--color-bg-card)',
                    paddingBottom: kbHeight > 0 ? '0.5rem' : 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
                  }}
                >
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('trainerMessages.thread.composerPlaceholder')}
                    rows={1}
                    maxLength={5000}
                    className="flex-1 resize-none px-4 py-3 text-[14px] outline-none transition-colors"
                    style={{
                      color: 'var(--color-text-primary)',
                      maxHeight: '120px',
                      minHeight: '44px',
                      borderRadius: 22,
                      background: 'var(--color-surface-hover, rgba(0,0,0,0.04))',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!input.trim() || sending}
                    className="shrink-0 transition-all active:scale-95 disabled:opacity-30"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      background: 'var(--color-accent)',
                      color: 'var(--color-text-on-accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    aria-label={t('trainerMessages.thread.send')}
                  >
                    <Send size={18} />
                  </button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Modals */}
      <WorkoutShareModal
        open={showShare}
        onClose={() => setShowShare(false)}
        trainerId={profile?.id}
        onShare={(text) => { setShowShare(false); sendText(text); }}
        t={t}
      />
      <ScheduleSoonModal
        open={showSchedule}
        onClose={() => setShowSchedule(false)}
        t={t}
      />
      <ClientPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        trainerId={profile?.id}
        onPick={handleNewConversation}
        t={t}
      />
    </div>
  );
}
