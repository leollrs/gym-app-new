import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MessageSquare, Send, Search, Plus, CheckCircle, Clock,
  ArrowLeft, Eye,
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';

import { PageHeader } from '../../components/admin';
import UserAvatar from '../../components/UserAvatar';

// ── Read-receipt indicator ───────────────────────────────
const ReadIndicator = ({ readAt }) => {
  if (readAt) return <Eye size={10} className="text-[#10B981]" />;
  return <CheckCircle size={10} className="text-[#6B7280]" />;
};

// ── Date grouping label ──────────────────────────────────
function dateLabel(dateStr) {
  const d = new Date(dateStr);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d, yyyy');
}

// ── Helper: get the "other" participant from a conversation ──
function getOtherParticipant(convo, adminId) {
  if (convo.participant_1 === adminId) return convo.p2;
  return convo.p1;
}

export default function AdminMessaging() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const gymId = profile?.gym_id;
  const adminId = profile?.id;

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

  useEffect(() => { document.title = 'Admin - Messages | TuGymPR'; }, []);

  // Load conversations + member list
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

    // Enrich each conversation with last message preview and unread count
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

      return {
        ...c,
        last_message_preview: lastMsgRes.data?.body || null,
        last_message_sender_id: lastMsgRes.data?.sender_id || null,
        unread_count: unreadRes.count || 0,
      };
    }));

    setConversations(enriched);
    convoIdsRef.current = enriched.map(c => c.id);
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

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConvoId) { setMessages([]); return; }
    setMsgsLoading(true);
    const load = async () => {
      const { data, error } = await supabase.from('direct_messages')
        .select('*').eq('conversation_id', activeConvoId)
        .order('created_at', { ascending: true }).limit(200);
      if (error) logger.error('AdminMessaging: messages:', error);
      setMessages(data || []);
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Realtime subscription for new messages across all admin conversations
  useEffect(() => {
    if (!gymId || !adminId) return;

    const channel = supabase.channel('admin_dm_realtime')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        (payload) => {
          const newMsg = payload.new;

          // Only handle messages in admin's conversations
          if (!convoIdsRef.current.includes(newMsg.conversation_id)) return;

          if (newMsg.conversation_id === activeConvoId) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            // Auto-mark as read if from the other person
            if (newMsg.sender_id !== adminId) {
              supabase.from('direct_messages')
                .update({ read_at: new Date().toISOString() })
                .eq('id', newMsg.id)
                .then(() => {});
            }
          }

          // Update conversation preview
          setConversations(prev => prev.map(c =>
            c.id === newMsg.conversation_id
              ? {
                  ...c,
                  last_message_at: newMsg.created_at,
                  last_message_preview: newMsg.body,
                  last_message_sender_id: newMsg.sender_id,
                  unread_count: c.id === activeConvoId ? 0 : c.unread_count + 1,
                }
              : c
          ).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)));
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'direct_messages' },
        (payload) => {
          // Real-time read receipts for messages we sent
          if (payload.new.read_at && payload.new.sender_id === adminId) {
            setMessages(prev => prev.map(m =>
              m.id === payload.new.id ? { ...m, read_at: payload.new.read_at } : m
            ));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gymId, adminId, activeConvoId]);

  const handleSend = async () => {
    if (!compose.trim() || !activeConvoId || !activeMember) return;
    setSending(true);
    const body = compose.trim();
    setCompose('');

    // Optimistic update
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

    // Insert message as plain text (no encryption for admin messages)
    const { error } = await supabase.from('direct_messages').insert({
      conversation_id: activeConvoId,
      sender_id: adminId,
      body,
    });

    if (error) {
      logger.error('AdminMessaging: send failed:', error);
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } else {
      // Update conversation last_message_at
      await supabase.from('conversations').update({
        last_message_at: now,
      }).eq('id', activeConvoId);
    }

    setSending(false);
    inputRef.current?.focus();
  };

  const handleNewConversation = async (member) => {
    // Check if conversation already exists
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

    // Use the RPC to create or get a conversation
    const { data: convoId, error } = await supabase.rpc('get_or_create_conversation', {
      p_other_user: member.id,
    });

    if (error) { logger.error('AdminMessaging: create convo:', error); return; }

    // Reload conversations to get the enriched data
    setShowNewMsg(false);
    setActiveConvoId(convoId);
    setActiveMember(member);
    setMobileShowThread(true);

    // Refresh the conversation list
    await loadConversations();
  };

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

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups = [];
    let currentDate = null;
    messages.forEach(msg => {
      const d = dateLabel(msg.created_at);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ type: 'date', label: d });
      }
      groups.push({ type: 'message', ...msg });
    });
    return groups;
  }, [messages]);

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader title="Messages" subtitle={`${conversations.length} conversation${conversations.length !== 1 ? 's' : ''}${totalUnread > 0 ? ` · ${totalUnread} unread` : ''}`} />

      <div className="mt-6 bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
        <div className="flex h-full">

          {/* -- Conversation List (left panel) -- */}
          <div className={`w-full md:w-[320px] flex-shrink-0 border-r border-white/6 flex flex-col ${mobileShowThread ? 'hidden md:flex' : 'flex'}`}>
            {/* Search + New */}
            <div className="p-3 border-b border-white/6 flex gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                <input type="text" placeholder="Search…" aria-label="Search conversations" value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
              </div>
              <button onClick={() => setShowNewMsg(true)}
                aria-label="New message"
                className="px-3 py-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                <Plus size={14} />
              </button>
            </div>

            {/* Conversation items */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-1 p-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-white/4 rounded-lg animate-pulse" />)}</div>
              ) : filteredConvos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <MessageSquare size={28} className="text-[#6B7280] mb-3" />
                  <p className="text-[13px] text-[#6B7280]">{search ? 'No matching conversations' : 'No conversations yet'}</p>
                  <button onClick={() => setShowNewMsg(true)}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                    <Plus size={12} /> New Message
                  </button>
                </div>
              ) : (
                filteredConvos.map(c => {
                  const member = getOtherParticipant(c, adminId);
                  const isActive = c.id === activeConvoId;
                  const previewText = c.last_message_preview
                    ? (c.last_message_sender_id === adminId ? 'You: ' : '') +
                      (c.last_message_preview.length > 50 ? c.last_message_preview.slice(0, 50) + '…' : c.last_message_preview)
                    : 'No messages yet';
                  return (
                    <button key={c.id} onClick={() => { setActiveConvoId(c.id); setActiveMember(member); setMobileShowThread(true); }}
                      className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors ${
                        isActive ? 'bg-[#D4AF37]/8' : 'hover:bg-white/[0.03]'
                      }`}>
                      <UserAvatar user={member || {}} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-[13px] font-semibold truncate ${isActive ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                            {member?.full_name || member?.username || 'Unknown'}
                          </p>
                          {c.last_message_at && (
                            <p className="text-[10px] text-[#6B7280] flex-shrink-0 ml-2">
                              {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false })}
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

          {/* -- Message Thread (right panel) -- */}
          <div className={`flex-1 flex flex-col ${mobileShowThread ? 'flex' : 'hidden md:flex'}`}>
            {!activeConvoId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
                  <MessageSquare size={28} className="text-[#6B7280]" />
                </div>
                <p className="text-[15px] font-semibold text-[#6B7280]">Select a conversation</p>
                <p className="text-[12px] text-[#6B7280] mt-1">or start a new message</p>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/6 flex-shrink-0">
                  <button onClick={() => setMobileShowThread(false)} aria-label="Back to conversations" className="md:hidden text-[#6B7280] hover:text-[#E5E7EB] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                    <ArrowLeft size={18} />
                  </button>
                  <UserAvatar user={activeMember || {}} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{activeMember?.full_name || activeMember?.username || 'Member'}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {activeMember?.username ? `@${activeMember.username}` : activeMember?.email || 'Member'}
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
                      <p className="text-[13px] text-[#6B7280]">No messages yet. Send the first one below.</p>
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
                      // Find if this is the last sent message (for showing read receipt)
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
                              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{item.body}</p>
                              <div className={`flex items-center gap-1 mt-1 ${isSent ? 'justify-end' : 'justify-start'}`}>
                                <p className="text-[10px] text-[#6B7280]">{format(new Date(item.created_at), 'h:mm a')}</p>
                                {isSent && <ReadIndicator readAt={item.read_at} />}
                              </div>
                            </div>
                          </div>
                          {/* Read receipt label on last sent message */}
                          {isLastSent && (
                            <p className="text-[10px] text-right mr-1" style={{ color: item.read_at ? '#10B981' : '#6B7280' }}>
                              {item.read_at ? 'Read' : 'Delivered'}
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
                    <input ref={inputRef} type="text" aria-label="Type a message" value={compose} onChange={e => setCompose(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                      placeholder="Type a message…" maxLength={2000}
                      className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors" />
                    <button onClick={handleSend} disabled={sending || !compose.trim()}
                      aria-label="Send message"
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

      {/* -- New Message Modal -- */}
      {showNewMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowNewMsg(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="new-message-title" className="bg-[#0F172A] border border-white/8 rounded-[14px] w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-white/6">
              <p id="new-message-title" className="text-[15px] font-bold text-[#E5E7EB]">New Message</p>
              <button onClick={() => setShowNewMsg(false)} aria-label="Close new message dialog" className="text-[#6B7280] hover:text-[#E5E7EB] text-[18px] min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">&times;</button>
            </div>
            <div className="p-3">
              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                <input type="text" placeholder="Search members…" aria-label="Search members" value={newMsgSearch} onChange={e => setNewMsgSearch(e.target.value)} autoFocus
                  className="w-full bg-[#111827] border border-white/6 rounded-xl pl-8 pr-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
              </div>
              <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                {filteredMembers.map(m => (
                  <button key={m.id} onClick={() => handleNewConversation(m)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left">
                    <UserAvatar user={m} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                      <p className="text-[10px] text-[#6B7280]">{m.username ? `@${m.username}` : m.email || 'Member'}</p>
                    </div>
                  </button>
                ))}
                {filteredMembers.length === 0 && (
                  <p className="text-center py-6 text-[13px] text-[#6B7280]">No members found</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
