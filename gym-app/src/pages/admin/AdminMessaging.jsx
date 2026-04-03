import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MessageSquare, Send, Search, Plus, CheckCircle, Clock,
  ArrowLeft, Eye, Calendar, Zap, Radio, Trash2, Pencil,
  ToggleLeft, ToggleRight, AlertTriangle, Megaphone, Users,
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import logger from '../../lib/logger';

import { PageHeader, AdminCard, AdminModal, FadeIn, AdminTabs } from '../../components/admin';
import UserAvatar from '../../components/UserAvatar';
import { encryptMessage, decryptMessage } from '../../lib/messageEncryption';
import { sanitize } from '../../lib/sanitize';

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const TABS = [
  { key: 'dm', icon: MessageSquare, labelKey: 'directMessages' },
  { key: 'scheduled', icon: Calendar, labelKey: 'scheduledMessages' },
  { key: 'broadcast', icon: Radio, labelKey: 'broadcast' },
];

const TRIGGER_PRESETS = [
  { label: 'New Member Welcome', delay: 0 },
  { label: '3-Day Check-in', delay: 3 },
  { label: '7-Day Motivation', delay: 7 },
  { label: '14-Day Progress', delay: 14 },
  { label: '30-Day Milestone', delay: 30 },
  { label: 'Custom', delay: null },
];

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────

const ReadIndicator = ({ readAt }) => {
  if (readAt) return <Eye size={10} className="text-[#10B981]" />;
  return <CheckCircle size={10} className="text-[#6B7280]" />;
};

function dateLabel(dateStr, t, dateFnsLocale) {
  const d = new Date(dateStr);
  if (isToday(d)) return t('admin.messaging.today', 'Today');
  if (isYesterday(d)) return t('admin.messaging.yesterday', 'Yesterday');
  return format(d, 'MMM d, yyyy', dateFnsLocale);
}

function getOtherParticipant(convo, adminId) {
  if (convo.participant_1 === adminId) return convo.p2;
  return convo.p1;
}

// ════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════

export default function AdminMessaging() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { profile, gym } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const gymId = profile?.gym_id;
  const adminId = profile?.id;

  const [activeTab, setActiveTab] = useState('dm');

  useEffect(() => { document.title = `Admin - ${t('admin.messaging.title')} | TuGymPR`; }, [t]);

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.messaging.title')}
        subtitle={t('admin.messaging.subtitle')}
      />

      {/* ── Tab bar ──────────────────────────────────────── */}
      <AdminTabs
        tabs={TABS.map(tb => ({ key: tb.key, label: t(`admin.messaging.${tb.labelKey}`), icon: tb.icon }))}
        active={activeTab}
        onChange={setActiveTab}
        className="mt-6 mb-4"
      />

      {/* ── Tab content ──────────────────────────────────── */}
      <div className="mt-4">
        {activeTab === 'dm' && (
          <DirectMessagesTab
            gymId={gymId} adminId={adminId} gym={gym}
            searchParams={searchParams} t={t} dateFnsLocale={dateFnsLocale}
          />
        )}
        {activeTab === 'scheduled' && (
          <ScheduledMessagesTab gymId={gymId} t={t} />
        )}
        {activeTab === 'broadcast' && (
          <BroadcastTab gymId={gymId} adminId={adminId} gym={gym} t={t} />
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB 1: DIRECT MESSAGES
// ════════════════════════════════════════════════════════════

function DirectMessagesTab({ gymId, adminId, gym, searchParams, t, dateFnsLocale }) {
  const { showToast } = useToast();

  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [activeConvoId, setActiveConvoId] = useState(null);
  const [activeMember, setActiveMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [compose, setCompose] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [newMsgSearch, setNewMsgSearch] = useState('');
  const [mobileShowThread, setMobileShowThread] = useState(false);

  const threadEndRef = useRef(null);
  const inputRef = useRef(null);
  const convoIdsRef = useRef([]);
  const seedMapRef = useRef({});

  // ── Load conversations + member list ──────────────────
  const loadConversations = useCallback(async () => {
    if (!gymId || !adminId) return;

    const [convoRes, memberRes] = await Promise.all([
      supabase.from('conversations')
        .select('*, p1:profiles!conversations_participant_1_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value), p2:profiles!conversations_participant_2_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value)')
        .or(`participant_1.eq.${adminId},participant_2.eq.${adminId}`)
        .eq('gym_id', gymId)
        .order('last_message_at', { ascending: false }),
      supabase.from('profiles')
        .select('id, full_name, username, email, avatar_url, avatar_type, avatar_value')
        .eq('gym_id', gymId).eq('role', 'member').order('full_name'),
    ]);

    if (convoRes.error) logger.error('AdminMessaging: convos:', convoRes.error);
    if (memberRes.error) logger.error('AdminMessaging: members:', memberRes.error);

    const convos = convoRes.data || [];

    const enriched = await Promise.all(convos.map(async (c) => {
      const [lastMsgRes, unreadRes] = await Promise.all([
        supabase.from('direct_messages')
          .select('body, sender_id, created_at')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('direct_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', c.id)
          .neq('sender_id', adminId)
          .is('read_at', null),
      ]);

      let preview = null;
      if (lastMsgRes.data?.body) {
        try { preview = await decryptMessage(lastMsgRes.data.body, c.id, c.encryption_seed); }
        catch { preview = lastMsgRes.data.body; }
      }

      return {
        ...c,
        last_message_preview: preview,
        last_message_sender_id: lastMsgRes.data?.sender_id || null,
        unread_count: unreadRes.count || 0,
      };
    }));

    setConversations(enriched);
    convoIdsRef.current = enriched.map(c => c.id);
    seedMapRef.current = Object.fromEntries(convos.map(c => [c.id, c.encryption_seed]));
    setMembers(memberRes.data || []);
    setLoading(false);

    // Open specific member conversation from URL params
    const memberId = searchParams.get('member');
    if (memberId && enriched.length > 0) {
      const existing = enriched.find(c =>
        c.participant_1 === memberId || c.participant_2 === memberId
      );
      if (existing) {
        const other = getOtherParticipant(existing, adminId);
        setActiveConvoId(existing.id);
        setActiveMember(other);
        setMobileShowThread(true);
      }
    }
  }, [gymId, adminId, searchParams]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ── Load messages for active conversation ─────────────
  useEffect(() => {
    if (!activeConvoId) { setMessages([]); return; }
    setMsgsLoading(true);
    const load = async () => {
      const { data, error } = await supabase.from('direct_messages')
        .select('*').eq('conversation_id', activeConvoId)
        .order('created_at', { ascending: true }).limit(200);
      if (error) logger.error('AdminMessaging: messages:', error);
      const seed = seedMapRef.current[activeConvoId];
      const decrypted = await Promise.all(
        (data || []).map(async (m) => {
          try { return { ...m, body: await decryptMessage(m.body, activeConvoId, seed) }; }
          catch { return m; }
        })
      );
      setMessages(decrypted);
      setMsgsLoading(false);

      // Mark incoming messages as read
      await supabase.from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', activeConvoId)
        .neq('sender_id', adminId)
        .is('read_at', null);

      setConversations(prev => prev.map(c =>
        c.id === activeConvoId ? { ...c, unread_count: 0 } : c
      ));
    };
    load();
  }, [activeConvoId, adminId]);

  // Auto-scroll
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Realtime subscription ─────────────────────────────
  useEffect(() => {
    if (!gymId || !adminId) return;

    // Debounce helpers to prevent excessive processing from unfiltered realtime events
    let insertDebounceTimer;
    let updateDebounceTimer;
    let pendingInsert = null;
    let pendingUpdate = null;

    const processInsert = (payload) => {
      const newMsg = payload.new;
      if (!convoIdsRef.current.includes(newMsg.conversation_id)) return;

      if (newMsg.conversation_id === activeConvoId) {
        decryptMessage(newMsg.body, activeConvoId, seedMapRef.current[activeConvoId]).then(decryptedBody => {
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, { ...newMsg, body: decryptedBody }];
          });
        }).catch(() => {
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        });
        if (newMsg.sender_id !== adminId) {
          supabase.from('direct_messages')
            .update({ read_at: new Date().toISOString() })
            .eq('id', newMsg.id)
            .then(() => {});
        }
      }

      decryptMessage(newMsg.body, newMsg.conversation_id, seedMapRef.current[newMsg.conversation_id]).then(decryptedPreview => {
        setConversations(prev => prev.map(c =>
          c.id === newMsg.conversation_id
            ? {
                ...c,
                last_message_at: newMsg.created_at,
                last_message_preview: decryptedPreview,
                last_message_sender_id: newMsg.sender_id,
                unread_count: c.id === activeConvoId ? 0 : c.unread_count + 1,
              }
            : c
        ).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)));
      }).catch(() => {});
    };

    const processUpdate = (payload) => {
      if (payload.new.read_at && payload.new.sender_id === adminId) {
        setMessages(prev => prev.map(m =>
          m.id === payload.new.id ? { ...m, read_at: payload.new.read_at } : m
        ));
      }
    };

    const channel = supabase.channel('admin_dm_realtime')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        (payload) => {
          // For messages in the active conversation, process immediately
          if (payload.new.conversation_id === activeConvoId) {
            clearTimeout(insertDebounceTimer);
            processInsert(payload);
          } else {
            // For sidebar updates, debounce to reduce churn
            pendingInsert = payload;
            clearTimeout(insertDebounceTimer);
            insertDebounceTimer = setTimeout(() => {
              if (pendingInsert) processInsert(pendingInsert);
              pendingInsert = null;
            }, 2000);
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'direct_messages' },
        (payload) => {
          pendingUpdate = payload;
          clearTimeout(updateDebounceTimer);
          updateDebounceTimer = setTimeout(() => {
            if (pendingUpdate) processUpdate(pendingUpdate);
            pendingUpdate = null;
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      clearTimeout(insertDebounceTimer);
      clearTimeout(updateDebounceTimer);
      supabase.removeChannel(channel);
    };
  }, [gymId, adminId, activeConvoId]);

  // ── Send message ──────────────────────────────────────
  const handleSend = async () => {
    if (!compose.trim() || !activeConvoId || !activeMember) return;
    setSending(true);
    const body = compose.trim();
    setCompose('');

    const tempId = crypto.randomUUID();
    const now = new Date().toISOString();
    setMessages(prev => [...prev, {
      id: tempId,
      conversation_id: activeConvoId,
      sender_id: adminId,
      body,
      read_at: null,
      created_at: now,
    }]);

    let encrypted;
    try { encrypted = await encryptMessage(body, activeConvoId, seedMapRef.current[activeConvoId]); }
    catch { encrypted = body; }

    const { error } = await supabase.from('direct_messages').insert({
      conversation_id: activeConvoId,
      sender_id: adminId,
      body: encrypted,
    });

    if (error) {
      logger.error('AdminMessaging: send failed:', error);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      showToast(t('admin.messaging.sendFailed'), 'error');
    } else {
      // Update conversation timestamp
      await supabase.from('conversations').update({
        last_message_at: now,
      }).eq('id', activeConvoId);

      // Send push notification to recipient
      const recipientId = activeMember.id;
      supabase.functions.invoke('send-push-user', {
        body: {
          profile_id: recipientId,
          gym_id: gymId,
          title: gym?.name || 'New Message',
          body: body.substring(0, 100),
          data: { type: 'direct_message', conversation_id: activeConvoId },
        },
      }).catch(err => logger.error('AdminMessaging: push failed:', err));
    }

    setSending(false);
    inputRef.current?.focus();
  };

  // ── New conversation ──────────────────────────────────
  const handleNewConversation = async (member) => {
    const existing = conversations.find(c =>
      c.participant_1 === member.id || c.participant_2 === member.id
    );
    if (existing) {
      const other = getOtherParticipant(existing, adminId);
      setActiveConvoId(existing.id);
      setActiveMember(other);
      setShowNewMsg(false);
      setMobileShowThread(true);
      return;
    }

    const { data: convoId, error } = await supabase.rpc('get_or_create_conversation', {
      p_other_user: member.id,
    });

    if (error) { logger.error('AdminMessaging: create convo:', error); return; }

    // Fetch the encryption seed for the new/existing conversation so it's
    // available before messages are loaded or sent.
    const { data: convoRow } = await supabase.from('conversations')
      .select('encryption_seed').eq('id', convoId).single();
    if (convoRow) seedMapRef.current[convoId] = convoRow.encryption_seed;

    setShowNewMsg(false);
    setActiveConvoId(convoId);
    setActiveMember(member);
    setMobileShowThread(true);
    await loadConversations();
  };

  // ── Filters ───────────────────────────────────────────
  const filteredConvos = useMemo(() => {
    if (!search) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(c => {
      const other = getOtherParticipant(c, adminId);
      return other?.full_name?.toLowerCase().includes(q) || other?.username?.toLowerCase().includes(q);
    });
  }, [conversations, search, adminId]);

  const filteredMembers = useMemo(() => {
    if (!newMsgSearch) return members.slice(0, 20);
    const q = newMsgSearch.toLowerCase();
    return members.filter(m =>
      m.full_name?.toLowerCase().includes(q) || m.username?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [members, newMsgSearch]);

  const groupedMessages = useMemo(() => {
    const groups = [];
    let currentDate = null;
    messages.forEach(msg => {
      const d = dateLabel(msg.created_at, t, dateFnsLocale);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ type: 'date', label: d });
      }
      groups.push({ type: 'message', ...msg });
    });
    return groups;
  }, [messages, t, dateFnsLocale]);

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

  return (
    <FadeIn>
      <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden" style={{ height: 'calc(100vh - 260px)', minHeight: '500px' }}>
        <div className="flex h-full">

          {/* ── Conversation List (left panel) ────────── */}
          <div className={`w-full md:w-[320px] flex-shrink-0 border-r border-white/6 flex flex-col ${mobileShowThread ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-3 border-b border-white/6 flex gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                <input type="text" placeholder={t('admin.messaging.searchConversations')} aria-label={t('admin.messaging.searchConversations')} value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
              </div>
              <button onClick={() => setShowNewMsg(true)}
                aria-label={t('admin.messaging.newMessage')}
                className="px-3 py-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                <Plus size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-1 p-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-white/4 rounded-lg animate-pulse" />)}</div>
              ) : filteredConvos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <MessageSquare size={28} className="text-[#6B7280] mb-3" />
                  <p className="text-[13px] text-[#6B7280]">{search ? t('admin.messaging.noMatchingConversations') : t('admin.messaging.noConversationsYet')}</p>
                  <button onClick={() => setShowNewMsg(true)}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                    <Plus size={12} /> {t('admin.messaging.newMessage')}
                  </button>
                </div>
              ) : (
                filteredConvos.map(c => {
                  const member = getOtherParticipant(c, adminId);
                  const isActive = c.id === activeConvoId;
                  const previewText = c.last_message_preview
                    ? (c.last_message_sender_id === adminId ? `${t('admin.messaging.you')}: ` : '') +
                      sanitize(c.last_message_preview.length > 50 ? c.last_message_preview.slice(0, 50) + '...' : c.last_message_preview)
                    : t('admin.messaging.noMessagesYet');
                  return (
                    <button key={c.id} onClick={() => { setActiveConvoId(c.id); setActiveMember(member); setMobileShowThread(true); }}
                      className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors ${
                        isActive ? 'bg-[#D4AF37]/8' : 'hover:bg-white/[0.03]'
                      }`}>
                      <UserAvatar user={member || {}} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-[13px] font-semibold truncate ${isActive ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                            {member?.full_name || member?.username || t('admin.messaging.unknown')}
                          </p>
                          {c.last_message_at && (
                            <p className="text-[10px] text-[#6B7280] flex-shrink-0 ml-2">
                              {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false, ...dateFnsLocale })}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-[11px] text-[#6B7280] truncate">{previewText}</p>
                          {c.unread_count > 0 && (
                            <span className="flex-shrink-0 ml-2 w-5 h-5 rounded-full bg-[#D4AF37] text-[#05070B] text-[10px] font-bold flex items-center justify-center">
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Message Thread (right panel) ──────────── */}
          <div className={`flex-1 flex flex-col ${mobileShowThread ? 'flex' : 'hidden md:flex'}`}>
            {!activeConvoId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
                  <MessageSquare size={28} className="text-[#6B7280]" />
                </div>
                <p className="text-[15px] font-semibold text-[#6B7280]">{t('admin.messaging.selectConversation')}</p>
                <p className="text-[12px] text-[#6B7280] mt-1">{t('admin.messaging.orStartNew')}</p>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/6 flex-shrink-0">
                  <button onClick={() => setMobileShowThread(false)} aria-label={t('admin.messaging.backToConversations')} className="md:hidden text-[#6B7280] hover:text-[#E5E7EB] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                    <ArrowLeft size={18} />
                  </button>
                  <UserAvatar user={activeMember || {}} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{activeMember?.full_name || activeMember?.username || t('admin.messaging.member')}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {activeMember?.username ? `@${activeMember.username}` : activeMember?.email || t('admin.messaging.member')}
                    </p>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                  {msgsLoading ? (
                    <div className="flex justify-center py-8">
                      <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                    </div>
                  ) : groupedMessages.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-[13px] text-[#6B7280]">{t('admin.messaging.noMessagesYetSendFirst')}</p>
                    </div>
                  ) : (
                    groupedMessages.map((item, i) => {
                      if (item.type === 'date') {
                        return (
                          <div key={`date-${i}`} className="flex items-center gap-3 py-3">
                            <div className="flex-1 h-px bg-white/6" />
                            <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">{item.label}</p>
                            <div className="flex-1 h-px bg-white/6" />
                          </div>
                        );
                      }
                      const isSent = item.sender_id === adminId;
                      const isLastSent = isSent && (() => {
                        const msgItems = groupedMessages.filter(g => g.type === 'message');
                        const idx = msgItems.findIndex(m => m.id === item.id);
                        return idx === msgItems.length - 1 || msgItems.slice(idx + 1).every(m => m.sender_id !== adminId);
                      })();

                      return (
                        <div key={item.id}>
                          <div className={`flex ${isSent ? 'justify-end' : 'justify-start'} mb-1.5`}>
                            <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl ${
                              isSent
                                ? 'bg-[#D4AF37]/15 text-[#E5E7EB] rounded-br-md'
                                : 'bg-[#111827] text-[#E5E7EB] rounded-bl-md'
                            }`}>
                              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{sanitize(item.body)}</p>
                              <div className={`flex items-center gap-1 mt-1 ${isSent ? 'justify-end' : 'justify-start'}`}>
                                <p className="text-[10px] text-[#6B7280]">{format(new Date(item.created_at), 'h:mm a')}</p>
                                {isSent && <ReadIndicator readAt={item.read_at} />}
                              </div>
                            </div>
                          </div>
                          {isLastSent && (
                            <p className="text-[10px] text-right mr-1" style={{ color: item.read_at ? '#10B981' : '#6B7280' }}>
                              {item.read_at ? t('admin.messaging.read') : t('admin.messaging.delivered')}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Compose bar */}
                <div className="px-4 py-3 border-t border-white/6 flex-shrink-0">
                  <div className="flex gap-2">
                    <input ref={inputRef} type="text" aria-label={t('admin.messaging.typeMessage')} value={compose} onChange={e => setCompose(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                      placeholder={t('admin.messaging.typeMessage')} maxLength={2000}
                      className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors" />
                    <button onClick={handleSend} disabled={sending || !compose.trim()}
                      aria-label={t('admin.messaging.sendMessage')}
                      className="px-4 py-2.5 rounded-xl bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40 min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── New Message Modal ─────────────────────────── */}
      {showNewMsg && (
        <AdminModal
          isOpen={showNewMsg}
          onClose={() => setShowNewMsg(false)}
          title={t('admin.messaging.newMessage')}
          titleIcon={Plus}
          size="sm"
        >
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input type="text" placeholder={t('admin.messaging.searchMembers')} aria-label={t('admin.messaging.searchMembers')} value={newMsgSearch} onChange={e => setNewMsgSearch(e.target.value)} autoFocus
              className="w-full bg-[#111827] border border-white/6 rounded-xl pl-8 pr-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
          </div>
          <div className="max-h-[300px] overflow-y-auto space-y-0.5">
            {filteredMembers.map(m => (
              <button key={m.id} onClick={() => handleNewConversation(m)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left">
                <UserAvatar user={m} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                  <p className="text-[10px] text-[#6B7280]">{m.username ? `@${m.username}` : m.email || t('admin.messaging.member')}</p>
                </div>
              </button>
            ))}
            {filteredMembers.length === 0 && (
              <p className="text-center py-6 text-[13px] text-[#6B7280]">{t('admin.messaging.noMembersFound')}</p>
            )}
          </div>
        </AdminModal>
      )}
    </FadeIn>
  );
}

// ════════════════════════════════════════════════════════════
// TAB 2: SCHEDULED MESSAGES (Drip Campaign Steps)
// ════════════════════════════════════════════════════════════

function ScheduledMessagesTab({ gymId, t }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // ── Fetch drip campaign steps ─────────────────────────
  const { data: steps = [], isLoading } = useQuery({
    queryKey: adminKeys.messaging.scheduled(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drip_campaign_steps')
        .select('*')
        .eq('gym_id', gymId)
        .order('delay_days', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Toggle active mutation ────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase
        .from('drip_campaign_steps')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.scheduled(gymId) });
      showToast(t('admin.messaging.triggerUpdated'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  // ── Delete mutation ───────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('drip_campaign_steps')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.scheduled(gymId) });
      showToast(t('admin.messaging.triggerDeleted'), 'success');
      setDeleteConfirm(null);
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const handleEdit = (step) => {
    setEditingStep(step);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingStep(null);
    setShowModal(true);
  };

  const triggerLabel = (days) => {
    const preset = TRIGGER_PRESETS.find(p => p.delay === days);
    if (preset && preset.delay !== null) return preset.label;
    if (days === 0) return t('admin.messaging.onSignup');
    return `${t('admin.messaging.afterDays', { count: days })} (${days}d)`;
  };

  return (
    <FadeIn>
      <AdminCard padding="p-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/6">
          <div>
            <h2 className="text-[15px] font-bold text-[#E5E7EB]">{t('admin.messaging.automatedTriggers')}</h2>
            <p className="text-[12px] text-[#6B7280] mt-0.5">{t('admin.messaging.automatedTriggersDesc')}</p>
          </div>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors text-[13px] font-semibold min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <Plus size={14} />
            {t('admin.messaging.addTrigger')}
          </button>
        </div>

        {/* List */}
        <div className="divide-y divide-white/4">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-white/4 rounded-lg animate-pulse" />)}
            </div>
          ) : steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar size={32} className="text-[#6B7280] mb-3" />
              <p className="text-[14px] font-semibold text-[#6B7280]">{t('admin.messaging.noTriggersYet')}</p>
              <p className="text-[12px] text-[#6B7280] mt-1">{t('admin.messaging.noTriggersDesc')}</p>
              <button onClick={handleAdd}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                <Plus size={12} /> {t('admin.messaging.addTrigger')}
              </button>
            </div>
          ) : (
            steps.map(step => (
              <div key={step.id} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                {/* Active toggle */}
                <button
                  onClick={() => toggleMutation.mutate({ id: step.id, is_active: !step.is_active })}
                  aria-label={step.is_active ? t('admin.messaging.deactivate') : t('admin.messaging.activate')}
                  className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none"
                >
                  {step.is_active ? (
                    <ToggleRight size={24} className="text-[#10B981]" />
                  ) : (
                    <ToggleLeft size={24} className="text-[#6B7280]" />
                  )}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">
                      {triggerLabel(step.delay_days)}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      step.is_active ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-white/6 text-[#6B7280]'
                    }`}>
                      {step.is_active ? t('admin.messaging.active') : t('admin.messaging.inactive')}
                    </span>
                    {step.delay_days === 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#D4AF37]/10 text-[#D4AF37]">
                        {t('admin.messaging.instant')}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#6B7280] mt-0.5 truncate max-w-[500px]">
                    {step.message_template?.substring(0, 80)}{step.message_template?.length > 80 ? '...' : ''}
                  </p>
                  {step.message_b && (
                    <p className="text-[11px] text-[#9CA3AF] mt-0.5 italic">
                      {t('admin.messaging.abVariant')}: {step.message_b.substring(0, 50)}...
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleEdit(step)}
                    aria-label={t('admin.messaging.edit')}
                    className="p-2 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/[0.04] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(step.id)}
                    aria-label={t('admin.messaging.delete')}
                    className="p-2 rounded-lg text-[#6B7280] hover:text-red-400 hover:bg-red-500/5 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-red-400 focus:outline-none"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </AdminCard>

      {/* ── Create/Edit Modal ────────────────────────────── */}
      {showModal && (
        <ScheduledMessageModal
          isOpen={showModal}
          onClose={() => { setShowModal(false); setEditingStep(null); }}
          gymId={gymId}
          editingStep={editingStep}
          t={t}
        />
      )}

      {/* ── Delete Confirmation Modal ────────────────────── */}
      {deleteConfirm && (
        <AdminModal
          isOpen={!!deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          title={t('admin.messaging.confirmDelete')}
          titleIcon={Trash2}
          size="sm"
          footer={
            <>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-[#9CA3AF] text-[13px] font-semibold hover:bg-white/[0.04] transition-colors min-h-[44px]"
              >
                {t('admin.messaging.cancel')}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/12 text-red-400 border border-red-500/25 text-[13px] font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-40 min-h-[44px]"
              >
                {deleteMutation.isPending ? t('admin.messaging.deleting') : t('admin.messaging.deleteTrigger')}
              </button>
            </>
          }
        >
          <p className="text-[13px] text-[#9CA3AF]">
            {t('admin.messaging.deleteConfirmMessage')}
          </p>
        </AdminModal>
      )}
    </FadeIn>
  );
}

// ── Scheduled Message Create/Edit Modal ─────────────────
function ScheduledMessageModal({ isOpen, onClose, gymId, editingStep, t }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [triggerType, setTriggerType] = useState(() => {
    if (!editingStep) return TRIGGER_PRESETS[0].label;
    const preset = TRIGGER_PRESETS.find(p => p.delay === editingStep.delay_days);
    return preset && preset.delay !== null ? preset.label : 'Custom';
  });
  const [customDelay, setCustomDelay] = useState(editingStep?.delay_days ?? 0);
  const [messageTemplate, setMessageTemplate] = useState(editingStep?.message_template || '');
  const [messageB, setMessageB] = useState(editingStep?.message_b || '');
  const [isActive, setIsActive] = useState(editingStep?.is_active ?? true);
  const [showVariantB, setShowVariantB] = useState(!!editingStep?.message_b);

  const selectedPreset = TRIGGER_PRESETS.find(p => p.label === triggerType);
  const delayDays = selectedPreset?.delay !== null && selectedPreset?.delay !== undefined
    ? selectedPreset.delay
    : Number(customDelay) || 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!messageTemplate.trim()) throw new Error('Message template is required');

      const payload = {
        gym_id: gymId,
        delay_days: delayDays,
        message_template: messageTemplate.trim(),
        message_b: showVariantB && messageB.trim() ? messageB.trim() : null,
        is_active: isActive,
        step_number: delayDays,
        updated_at: new Date().toISOString(),
      };

      if (editingStep) {
        const { error } = await supabase
          .from('drip_campaign_steps')
          .update(payload)
          .eq('id', editingStep.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('drip_campaign_steps')
          .insert({ ...payload, created_at: new Date().toISOString() });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.scheduled(gymId) });
      showToast(editingStep ? t('admin.messaging.triggerUpdated') : t('admin.messaging.triggerCreated'), 'success');
      onClose();
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const placeholders = ['{{name}}', '{{gym_name}}', '{{days_since_join}}'];

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={editingStep ? t('admin.messaging.editTrigger') : t('admin.messaging.addTrigger')}
      titleIcon={Calendar}
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-[#9CA3AF] text-[13px] font-semibold hover:bg-white/[0.04] transition-colors min-h-[44px]"
          >
            {t('admin.messaging.cancel')}
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !messageTemplate.trim()}
            className="flex-1 px-4 py-2.5 rounded-lg bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 text-[13px] font-semibold hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40 min-h-[44px]"
          >
            {saveMutation.isPending
              ? t('admin.messaging.saving')
              : editingStep ? t('admin.messaging.saveChanges') : t('admin.messaging.createTrigger')
            }
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Trigger type */}
        <div>
          <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
            {t('admin.messaging.triggerType')}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TRIGGER_PRESETS.map(preset => (
              <button
                key={preset.label}
                onClick={() => setTriggerType(preset.label)}
                className={`px-3 py-2 rounded-lg text-[12px] font-semibold border transition-all min-h-[44px] ${
                  triggerType === preset.label
                    ? 'bg-[#D4AF37]/12 text-[#D4AF37] border-[#D4AF37]/25'
                    : 'bg-white/[0.02] text-[#9CA3AF] border-white/6 hover:border-white/10'
                }`}
              >
                {preset.label}
                {preset.delay !== null && (
                  <span className="block text-[10px] text-[#6B7280] mt-0.5">
                    {preset.delay === 0 ? t('admin.messaging.instant') : `${preset.delay} ${t('admin.messaging.days')}`}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Custom delay */}
        {triggerType === 'Custom' && (
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
              {t('admin.messaging.delayDays')}
            </label>
            <input
              type="number"
              min="0"
              max="365"
              value={customDelay}
              onChange={e => setCustomDelay(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
        )}

        {/* Message template */}
        <div>
          <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
            {t('admin.messaging.messageTemplate')}
          </label>
          <textarea
            value={messageTemplate}
            onChange={e => setMessageTemplate(e.target.value)}
            placeholder={t('admin.messaging.messageTemplatePlaceholder')}
            rows={4}
            maxLength={2000}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {placeholders.map(ph => (
              <button
                key={ph}
                onClick={() => setMessageTemplate(prev => prev + ph)}
                className="px-2 py-1 rounded-md bg-white/4 text-[11px] text-[#9CA3AF] hover:text-[#D4AF37] hover:bg-[#D4AF37]/8 transition-colors border border-white/6"
              >
                {ph}
              </button>
            ))}
          </div>
        </div>

        {/* A/B variant toggle */}
        <div>
          <button
            onClick={() => setShowVariantB(!showVariantB)}
            className="flex items-center gap-2 text-[12px] text-[#9CA3AF] hover:text-[#D4AF37] transition-colors"
          >
            <Zap size={12} />
            {showVariantB ? t('admin.messaging.removeVariantB') : t('admin.messaging.addVariantB')}
          </button>
          {showVariantB && (
            <textarea
              value={messageB}
              onChange={e => setMessageB(e.target.value)}
              placeholder={t('admin.messaging.variantBPlaceholder')}
              rows={3}
              maxLength={2000}
              className="w-full mt-2 bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          )}
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-[#E5E7EB]">{t('admin.messaging.activeOnSave')}</span>
          <button
            onClick={() => setIsActive(!isActive)}
            aria-label={isActive ? t('admin.messaging.deactivate') : t('admin.messaging.activate')}
            className="focus:outline-none"
          >
            {isActive ? (
              <ToggleRight size={28} className="text-[#10B981]" />
            ) : (
              <ToggleLeft size={28} className="text-[#6B7280]" />
            )}
          </button>
        </div>
      </div>
    </AdminModal>
  );
}

// ════════════════════════════════════════════════════════════
// TAB 3: BROADCAST
// ════════════════════════════════════════════════════════════

function BroadcastTab({ gymId, adminId, gym, t }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // ── Fetch recent broadcast history ────────────────────
  const { data: broadcastHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: adminKeys.messaging.broadcastHistory(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_push_log')
        .select('*')
        .eq('gym_id', gymId)
        .order('sent_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Send broadcast mutation ───────────────────────────
  const broadcastMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !body.trim()) throw new Error('Title and body are required');

      // Send push notification to all gym members
      const { error: pushError } = await supabase.functions.invoke('send-push', {
        body: { gym_id: gymId, title: title.trim(), body: body.trim() },
      });
      if (pushError) logger.error('Broadcast push error:', pushError);

      // Create in-app notifications via RPC
      const { error: rpcError } = await supabase.rpc('broadcast_notification', {
        p_gym_id: gymId,
        p_title: title.trim(),
        p_body: body.trim(),
        p_type: 'announcement',
      });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.broadcastHistory(gymId) });
      showToast(t('admin.messaging.broadcastSent'), 'success');
      setTitle('');
      setBody('');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  return (
    <FadeIn>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Compose panel ──────────────────────────────── */}
        <AdminCard>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
              <Megaphone size={15} className="text-[#D4AF37]" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#E5E7EB]">{t('admin.messaging.sendBroadcast')}</h2>
              <p className="text-[11px] text-[#6B7280]">{t('admin.messaging.sendBroadcastDesc')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                {t('admin.messaging.broadcastTitle')}
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('admin.messaging.broadcastTitlePlaceholder')}
                maxLength={100}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                {t('admin.messaging.broadcastBody')}
              </label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={t('admin.messaging.broadcastBodyPlaceholder')}
                rows={5}
                maxLength={500}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              />
              <p className="text-[11px] text-[#6B7280] mt-1 text-right">{body.length}/500</p>
            </div>

            {/* Rate limit warning */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/10">
              <AlertTriangle size={14} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#F59E0B]/80">{t('admin.messaging.rateLimitWarning')}</p>
            </div>

            <button
              onClick={() => broadcastMutation.mutate()}
              disabled={broadcastMutation.isPending || !title.trim() || !body.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 text-[13px] font-semibold hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40 min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              {broadcastMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
              ) : (
                <Radio size={15} />
              )}
              {broadcastMutation.isPending ? t('admin.messaging.sending') : t('admin.messaging.sendPushToAll')}
            </button>
          </div>
        </AdminCard>

        {/* ── Broadcast history ──────────────────────────── */}
        <AdminCard>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-xl bg-white/4 flex items-center justify-center">
              <Clock size={15} className="text-[#6B7280]" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#E5E7EB]">{t('admin.messaging.broadcastHistory')}</h2>
              <p className="text-[11px] text-[#6B7280]">{t('admin.messaging.recentBroadcasts')}</p>
            </div>
          </div>

          {historyLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-white/4 rounded-lg animate-pulse" />)}
            </div>
          ) : broadcastHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Radio size={24} className="text-[#6B7280] mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.messaging.noBroadcastsYet')}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {broadcastHistory.map(log => (
                <div key={log.id} className="px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users size={12} className="text-[#6B7280]" />
                      <span className="text-[12px] font-semibold text-[#E5E7EB]">
                        {log.total_sent ?? '?'} {t('admin.messaging.recipients')}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#6B7280]">
                      {log.sent_at ? format(new Date(log.sent_at), 'MMM d, h:mm a') : '-'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </FadeIn>
  );
}
