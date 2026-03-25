import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MessageSquare, Send, Search, Plus, Phone, CheckCircle, Clock,
  AlertCircle, ArrowLeft, User,
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';

import { PageHeader, Avatar } from '../../components/admin';

// ── Status icons for message delivery ────────────────────
const StatusIcon = ({ status }) => {
  switch (status) {
    case 'delivered': return <CheckCircle size={10} className="text-[#10B981]" />;
    case 'sent': return <CheckCircle size={10} className="text-[#6B7280]" />;
    case 'failed': return <AlertCircle size={10} className="text-[#EF4444]" />;
    case 'queued': return <Clock size={10} className="text-[#4B5563]" />;
    default: return null;
  }
};

// ── Date grouping label ──────────────────────────────────
function dateLabel(dateStr) {
  const d = new Date(dateStr);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d, yyyy');
}

export default function AdminMessaging() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const gymId = profile?.gym_id;

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

  useEffect(() => { document.title = 'Admin - Messages | TuGymPR'; }, []);

  // Load conversations + member list
  useEffect(() => {
    if (!gymId) return;
    const load = async () => {
      const [convoRes, memberRes] = await Promise.all([
        supabase.from('sms_conversations').select('*, profiles!sms_conversations_member_id_fkey(id, full_name, username, phone_number, email)')
          .eq('gym_id', gymId).eq('is_archived', false).order('last_message_at', { ascending: false }),
        supabase.from('profiles').select('id, full_name, username, phone_number, email')
          .eq('gym_id', gymId).eq('role', 'member').order('full_name'),
      ]);
      if (convoRes.error) logger.error('AdminMessaging: convos:', convoRes.error);
      if (memberRes.error) logger.error('AdminMessaging: members:', memberRes.error);
      setConversations(convoRes.data || []);
      setMembers(memberRes.data || []);
      setLoading(false);

      // Open specific member conversation from URL params
      const memberId = searchParams.get('member');
      if (memberId && convoRes.data) {
        const existing = convoRes.data.find(c => c.member_id === memberId);
        if (existing) {
          setActiveConvoId(existing.id);
          setActiveMember(existing.profiles);
          setMobileShowThread(true);
        }
      }
    };
    load();
  }, [gymId, searchParams]);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConvoId) { setMessages([]); return; }
    setMsgsLoading(true);
    const load = async () => {
      const { data, error } = await supabase.from('sms_messages')
        .select('*').eq('conversation_id', activeConvoId)
        .order('created_at', { ascending: true }).limit(200);
      if (error) logger.error('AdminMessaging: messages:', error);
      setMessages(data || []);
      setMsgsLoading(false);

      // Mark as read
      await supabase.from('sms_conversations').update({ unread_count: 0 }).eq('id', activeConvoId);
      setConversations(prev => prev.map(c => c.id === activeConvoId ? { ...c, unread_count: 0 } : c));
    };
    load();
  }, [activeConvoId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!gymId) return;
    const channel = supabase.channel('sms_messages_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages', filter: `gym_id=eq.${gymId}` },
        (payload) => {
          const newMsg = payload.new;
          if (newMsg.conversation_id === activeConvoId) {
            setMessages(prev => [...prev, newMsg]);
          }
          // Update conversation preview
          setConversations(prev => prev.map(c =>
            c.id === newMsg.conversation_id
              ? { ...c, last_message_at: newMsg.created_at, last_message_preview: newMsg.body, unread_count: c.id === activeConvoId ? 0 : c.unread_count + 1 }
              : c
          ).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)));
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gymId, activeConvoId]);

  const handleSend = async () => {
    if (!compose.trim() || !activeConvoId || !activeMember) return;
    setSending(true);
    const body = compose.trim();
    setCompose('');

    // Insert message directly (edge function would handle actual Twilio send)
    const { data: gymConfig } = await supabase.from('gym_twilio_config')
      .select('twilio_phone_number').eq('gym_id', gymId).single();

    const fromNumber = gymConfig?.twilio_phone_number || 'app';
    const toNumber = activeMember.phone_number || 'unknown';

    const { error } = await supabase.from('sms_messages').insert({
      conversation_id: activeConvoId,
      gym_id: gymId,
      direction: 'outbound',
      status: 'sent',
      body,
      from_number: fromNumber,
      to_number: toNumber,
      sent_by: profile.id,
    });

    if (error) logger.error('AdminMessaging: send failed:', error);
    else {
      // Update conversation
      await supabase.from('sms_conversations').update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body,
      }).eq('id', activeConvoId);

      // Increment usage
      await supabase.rpc('increment_sms_usage', { p_gym_id: gymId, p_direction: 'sent', p_segments: Math.ceil(body.length / 160) });
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleNewConversation = async (member) => {
    // Check if conversation already exists
    const existing = conversations.find(c => c.member_id === member.id);
    if (existing) {
      setActiveConvoId(existing.id);
      setActiveMember(member);
      setShowNewMsg(false);
      setMobileShowThread(true);
      return;
    }

    // Create new conversation
    const { data, error } = await supabase.from('sms_conversations').insert({
      gym_id: gymId, member_id: member.id,
    }).select('*, profiles!sms_conversations_member_id_fkey(id, full_name, username, phone_number, email)').single();

    if (error) { logger.error('AdminMessaging: create convo:', error); return; }
    setConversations(prev => [data, ...prev]);
    setActiveConvoId(data.id);
    setActiveMember(member);
    setShowNewMsg(false);
    setMobileShowThread(true);
  };

  const filteredConvos = useMemo(() => {
    if (!search) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(c => c.profiles?.full_name?.toLowerCase().includes(q));
  }, [conversations, search]);

  const filteredMembers = useMemo(() => {
    if (!newMsgSearch) return members.slice(0, 20);
    const q = newMsgSearch.toLowerCase();
    return members.filter(m => m.full_name?.toLowerCase().includes(q) || m.phone_number?.includes(q)).slice(0, 20);
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
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <PageHeader title="Messages" subtitle={`${conversations.length} conversation${conversations.length !== 1 ? 's' : ''}${totalUnread > 0 ? ` · ${totalUnread} unread` : ''}`} />

      <div className="mt-6 bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
        <div className="flex h-full">

          {/* ── Conversation List (left panel) ─────────────── */}
          <div className={`w-full md:w-[320px] flex-shrink-0 border-r border-white/6 flex flex-col ${mobileShowThread ? 'hidden md:flex' : 'flex'}`}>
            {/* Search + New */}
            <div className="p-3 border-b border-white/6 flex gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
              </div>
              <button onClick={() => setShowNewMsg(true)}
                className="px-3 py-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors">
                <Plus size={14} />
              </button>
            </div>

            {/* Conversation items */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-1 p-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-white/4 rounded-lg animate-pulse" />)}</div>
              ) : filteredConvos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <MessageSquare size={28} className="text-[#4B5563] mb-3" />
                  <p className="text-[13px] text-[#6B7280]">{search ? 'No matching conversations' : 'No conversations yet'}</p>
                  <button onClick={() => setShowNewMsg(true)}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                    <Plus size={12} /> New Message
                  </button>
                </div>
              ) : (
                filteredConvos.map(c => {
                  const member = c.profiles;
                  const isActive = c.id === activeConvoId;
                  return (
                    <button key={c.id} onClick={() => { setActiveConvoId(c.id); setActiveMember(member); setMobileShowThread(true); }}
                      className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors ${
                        isActive ? 'bg-[#D4AF37]/8' : 'hover:bg-white/[0.03]'
                      }`}>
                      <Avatar name={member?.full_name || '?'} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-[13px] font-semibold truncate ${isActive ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                            {member?.full_name || 'Unknown'}
                          </p>
                          <p className="text-[10px] text-[#4B5563] flex-shrink-0 ml-2">
                            {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false })}
                          </p>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-[11px] text-[#6B7280] truncate">{c.last_message_preview || 'No messages yet'}</p>
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

          {/* ── Message Thread (right panel) ──────────────── */}
          <div className={`flex-1 flex flex-col ${mobileShowThread ? 'flex' : 'hidden md:flex'}`}>
            {!activeConvoId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
                  <MessageSquare size={28} className="text-[#4B5563]" />
                </div>
                <p className="text-[15px] font-semibold text-[#6B7280]">Select a conversation</p>
                <p className="text-[12px] text-[#4B5563] mt-1">or start a new message</p>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/6 flex-shrink-0">
                  <button onClick={() => setMobileShowThread(false)} className="md:hidden text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
                    <ArrowLeft size={18} />
                  </button>
                  <Avatar name={activeMember?.full_name || '?'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{activeMember?.full_name}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {activeMember?.phone_number || activeMember?.email || 'No contact info'}
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
                            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{item.label}</p>
                            <div className="flex-1 h-px bg-white/6" />
                          </div>
                        );
                      }
                      const isOutbound = item.direction === 'outbound';
                      return (
                        <div key={item.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1.5`}>
                          <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl ${
                            isOutbound
                              ? 'bg-[#D4AF37]/15 text-[#E5E7EB] rounded-br-md'
                              : 'bg-[#111827] text-[#E5E7EB] rounded-bl-md'
                          }`}>
                            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{item.body}</p>
                            <div className={`flex items-center gap-1 mt-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                              <p className="text-[10px] text-[#4B5563]">{format(new Date(item.created_at), 'h:mm a')}</p>
                              {isOutbound && <StatusIcon status={item.status} />}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Compose bar */}
                <div className="px-4 py-3 border-t border-white/6 flex-shrink-0">
                  <div className="flex gap-2">
                    <input ref={inputRef} type="text" value={compose} onChange={e => setCompose(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                      placeholder="Type a message…"
                      className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
                    <button onClick={handleSend} disabled={sending || !compose.trim()}
                      className="px-4 py-2.5 rounded-xl bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── New Message Modal ─────────────────────────────── */}
      {showNewMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowNewMsg(false)}>
          <div className="bg-[#0F172A] border border-white/8 rounded-[14px] w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-white/6">
              <p className="text-[15px] font-bold text-[#E5E7EB]">New Message</p>
              <button onClick={() => setShowNewMsg(false)} className="text-[#6B7280] hover:text-[#E5E7EB] text-[18px]">&times;</button>
            </div>
            <div className="p-3">
              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                <input type="text" placeholder="Search members…" value={newMsgSearch} onChange={e => setNewMsgSearch(e.target.value)} autoFocus
                  className="w-full bg-[#111827] border border-white/6 rounded-xl pl-8 pr-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
              </div>
              <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                {filteredMembers.map(m => (
                  <button key={m.id} onClick={() => handleNewConversation(m)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left">
                    <Avatar name={m.full_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                      <p className="text-[10px] text-[#6B7280]">{m.phone_number || m.email || 'No contact info'}</p>
                    </div>
                    {m.phone_number && <Phone size={12} className="text-[#4B5563] flex-shrink-0" />}
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
