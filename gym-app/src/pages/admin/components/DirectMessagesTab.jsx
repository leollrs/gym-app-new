import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Search, Plus, CheckCircle, Eye,
  ArrowLeft, Trash2, MoreVertical, Archive, ArchiveRestore, Ban, ShieldOff,
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { AdminModal, FadeIn } from '../../../components/admin';
import UserAvatar from '../../../components/UserAvatar';
import { encryptMessage, decryptMessage } from '../../../lib/messageEncryption';
import { sanitize } from '../../../lib/sanitize';
import { logAdminAction } from '../../../lib/adminAudit';

// Capacitor Keyboard plugin — native only. Same pattern used in member Messages.jsx.
let Keyboard = null;
if (Capacitor.isNativePlatform()) {
  import('@capacitor/keyboard').then((mod) => { Keyboard = mod.Keyboard; }).catch(() => {});
}

// ── Helpers (shared inside this file) ─────────────────────

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

function getMemberId(convo, adminId) {
  return convo.participant_1 === adminId ? convo.participant_2 : convo.participant_1;
}

// ── Action dropdown for conversations ──────────────────
function ConversationActionMenu({ convoId, memberId, isArchived, isBlocked, onArchive, onUnarchive, onDelete, onBlock, onUnblock, t }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label={t('admin.messaging.actionsAria', 'Actions')}
        className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/[0.06] transition-colors flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-[80] w-[min(13rem,calc(100vw-32px))] max-w-[13rem] rounded-xl shadow-xl overflow-hidden"
          style={{ backgroundColor: '#fff', border: '1px solid rgba(0,0,0,0.1)' }}
          onClick={(e) => e.stopPropagation()}>
          {isArchived ? (
            <button onClick={() => { onUnarchive(convoId); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-[#1F2937] hover:bg-gray-100 transition-colors text-left">
              <ArchiveRestore size={14} className="text-[#6B7280]" />
              {t('admin.messaging.unarchive', 'Desarchivar')}
            </button>
          ) : (
            <button onClick={() => { onArchive(convoId); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-[#1F2937] hover:bg-gray-100 transition-colors text-left">
              <Archive size={14} className="text-[#6B7280]" />
              {t('admin.messaging.archive', 'Archivar')}
            </button>
          )}
          <button onClick={() => { onDelete(convoId); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-red-500 hover:bg-red-50 transition-colors text-left">
            <Trash2 size={14} />
            {t('admin.messaging.deleteConversation', 'Eliminar conversación')}
          </button>
          <div className="h-px bg-gray-200" />
          {isBlocked ? (
            <button onClick={() => { onUnblock(memberId); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-[#1F2937] hover:bg-gray-100 transition-colors text-left">
              <ShieldOff size={14} className="text-[#6B7280]" />
              {t('admin.messaging.unblockUser', 'Desbloquear usuario')}
            </button>
          ) : (
            <button onClick={() => { onBlock(memberId, convoId); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-red-500 hover:bg-red-50 transition-colors text-left">
              <Ban size={14} />
              {t('admin.messaging.blockUser', 'Bloquear usuario')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Direct Messages" tab of AdminMessaging — admin-to-member 1:1 chat.
 *
 * Two-pane layout: conversation list on the left, active thread on the right
 * (single pane on mobile, toggled by `mobileShowThread`). Wires up:
 *   - Conversation list with last-message preview + unread badge
 *   - Realtime subscription for new messages + read receipts
 *   - Server-side member search for the "New Message" picker (debounced)
 *   - Archive/block/delete actions via ConversationActionMenu
 *   - Encrypted message storage (encryptMessage + decryptMessage)
 *
 * Note: Archive state is currently per-browser via localStorage. The audit
 * flagged this — a second admin won't see the same archive state. Phase X
 * will move it to a server-side admin_conversation_state table.
 */
export default function DirectMessagesTab({ gymId, adminId, gym, searchParams, t, dateFnsLocale }) {
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
  const [membersError, setMembersError] = useState(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedIds, setArchivedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_archived_conversations') || '[]'); }
    catch { return []; }
  });
  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const threadEndRef = useRef(null);
  const inputRef = useRef(null);
  const convoIdsRef = useRef([]);
  const seedMapRef = useRef({});
  // Latest activeConvoId for the realtime handler, kept in a ref so the
  // direct_messages subscription does NOT tear down + re-subscribe every time
  // the admin clicks a different conversation (that was a WS re-subscribe storm
  // on normal inbox navigation).
  const activeConvoIdRef = useRef(activeConvoId);

  // ── Load conversations + member list ──────────────────
  const loadConversations = useCallback(async () => {
    if (!gymId || !adminId) return;

    // Members are NOT preloaded here — at 300+ members per gym that's
    // expensive and almost always wasted. The New Message picker drives
    // its own debounced server-side search via fetchMembers().
    const convoRes = await supabase.from('conversations')
      .select('*, p1:profiles!conversations_participant_1_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value, role), p2:profiles!conversations_participant_2_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value, role)')
      .or(`participant_1.eq.${adminId},participant_2.eq.${adminId}`)
      .eq('gym_id', gymId)
      .order('last_message_at', { ascending: false });

    if (convoRes.error) logger.error('AdminMessaging: convos:', convoRes.error);

    const convos = convoRes.data || [];

    const enriched = await Promise.all(convos.map(async (c) => {
      try {
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
      } catch (err) {
        logger.error('AdminMessaging: enrich convo failed:', err);
        return { ...c, last_message_preview: null, last_message_sender_id: null, unread_count: 0 };
      }
    }));

    setConversations(enriched);
    convoIdsRef.current = enriched.map(c => c.id);
    seedMapRef.current = Object.fromEntries(convos.map(c => [c.id, c.encryption_seed]));
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

  // ── Server-side member search (used by the New Message modal) ──
  // Lazy: only runs when the modal is opened. Empty query returns every
  // profile in the gym (alphabetical); typing narrows it via ILIKE on
  // full_name + username. The bulk fetch is fine because the upfront
  // load on every page mount has been removed — a 300-row response only
  // hits the wire when the admin actually opens the picker.
  const fetchMembers = useCallback(async (query = '') => {
    if (!gymId || !adminId) return;
    setMembersLoading(true);
    setMembersError(null);

    let req = supabase.from('profiles')
      .select('id, full_name, username, avatar_url, avatar_type, avatar_value, role')
      .eq('gym_id', gymId)
      .neq('id', adminId)
      .neq('role', 'super_admin')
      .order('full_name');

    const q = query.trim();
    if (q) {
      // Escape PostgREST special chars so a stray comma doesn't break the .or()
      const safe = q.replace(/[%,()*]/g, '\\$&');
      req = req.or(`full_name.ilike.%${safe}%,username.ilike.%${safe}%`);
    }

    const { data, error } = await req;
    if (error) {
      logger.error('AdminMessaging: fetchMembers:', error);
      setMembersError(error.message || String(error));
    } else {
      setMembers(data || []);
    }
    setMembersLoading(false);
  }, [gymId, adminId]);

  // Debounce the search input → server query (300ms). Also fires once on
  // modal open with an empty query so the picker shows an initial roster.
  useEffect(() => {
    if (!showNewMsg) return;
    const handle = setTimeout(() => { fetchMembers(newMsgSearch); }, 300);
    return () => clearTimeout(handle);
  }, [showNewMsg, newMsgSearch, fetchMembers]);

  // ── Load blocked users ───────────────────────────────
  useEffect(() => {
    if (!adminId) return;
    supabase.from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', adminId)
      .then(({ data }) => {
        if (data) setBlockedUserIds(data.map(r => r.blocked_id));
      });
  }, [adminId]);

  // ── Archive / Unarchive ──────────────────────────────
  const handleArchive = useCallback((convoId) => {
    setArchivedIds(prev => {
      const next = [...prev, convoId];
      localStorage.setItem('admin_archived_conversations', JSON.stringify(next));
      return next;
    });
    if (activeConvoId === convoId) {
      setActiveConvoId(null);
      setActiveMember(null);
      setMobileShowThread(false);
    }
    showToast(t('admin.messaging.archived', 'Archivado'), 'success');
  }, [activeConvoId, showToast, t]);

  const handleUnarchive = useCallback((convoId) => {
    setArchivedIds(prev => {
      const next = prev.filter(id => id !== convoId);
      localStorage.setItem('admin_archived_conversations', JSON.stringify(next));
      return next;
    });
    showToast(t('admin.messaging.unarchive', 'Desarchivar'), 'success');
  }, [showToast, t]);

  // ── Delete conversation ──────────────────────────────
  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteConfirmId) return;
    const convoId = deleteConfirmId;
    setDeleteConfirmId(null);

    // Delete all messages then the conversation
    const { error: msgErr } = await supabase.from('direct_messages')
      .delete().eq('conversation_id', convoId);
    if (msgErr) { logger.error('AdminMessaging: delete msgs:', msgErr); showToast(t('common:error', 'Error'), 'error'); return; }

    const { error: convoErr } = await supabase.from('conversations')
      .delete().eq('id', convoId).eq('gym_id', gymId);
    if (convoErr) { logger.error('AdminMessaging: delete convo:', convoErr); showToast(t('common:error', 'Error'), 'error'); return; }

    logAdminAction('delete_conversation', 'conversation', convoId);

    // Remove from local state
    setConversations(prev => prev.filter(c => c.id !== convoId));
    setArchivedIds(prev => {
      const next = prev.filter(id => id !== convoId);
      localStorage.setItem('admin_archived_conversations', JSON.stringify(next));
      return next;
    });
    if (activeConvoId === convoId) {
      setActiveConvoId(null);
      setActiveMember(null);
      setMobileShowThread(false);
    }
    showToast(t('admin.messaging.deleteConversation', 'Eliminada'), 'success');
  }, [deleteConfirmId, activeConvoId, showToast, t, gymId]);

  // ── Block / Unblock ──────────────────────────────────
  const handleBlock = useCallback(async (memberId, convoId) => {
    const { error } = await supabase.from('blocked_users')
      .insert({ blocker_id: adminId, blocked_id: memberId });
    if (error && !error.message?.includes('duplicate')) {
      logger.error('AdminMessaging: block:', error);
      showToast(t('common:error', 'Error'), 'error');
      return;
    }
    logAdminAction('block_user', 'member', memberId, { conversation_id: convoId });
    setBlockedUserIds(prev => [...prev, memberId]);
    // Auto-archive the conversation
    handleArchive(convoId);
    showToast(t('admin.messaging.blocked', 'Bloqueado'), 'success');
  }, [adminId, handleArchive, showToast, t]);

  const handleUnblock = useCallback(async (memberId) => {
    const { error } = await supabase.from('blocked_users')
      .delete()
      .eq('blocker_id', adminId)
      .eq('blocked_id', memberId);
    if (error) {
      logger.error('AdminMessaging: unblock:', error);
      showToast(t('common:error', 'Error'), 'error');
      return;
    }
    logAdminAction('unblock_user', 'member', memberId);
    setBlockedUserIds(prev => prev.filter(id => id !== memberId));
    showToast(t('admin.messaging.unblockUser', 'Desbloqueado'), 'success');
  }, [adminId, showToast, t]);

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

  // Auto-scroll on new messages — smooth.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-scroll on conversation switch — instant, jumps straight to the latest
  // message so deep-linking from a push notification lands you at the bottom of
  // the thread, not the top. Retries after the next paint to outlast lazy renders.
  useEffect(() => {
    if (!activeConvoId) return;
    const jumpToBottom = () => threadEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    jumpToBottom();
    const t1 = setTimeout(jumpToBottom, 50);
    const t2 = setTimeout(jumpToBottom, 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [activeConvoId]);

  // WebView resizes natively when the keyboard opens (capacitor.config
  // Keyboard.resize="native"); we only listen so we can snap the thread to the
  // newest message once the viewport settles.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Keyboard) return;
    const listeners = [];
    Keyboard.addListener('keyboardWillShow', () => {
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    }).then((h) => listeners.push(h));
    return () => { listeners.forEach((h) => h.remove()); };
  }, []);

  // ── Realtime subscription ─────────────────────────────
  useEffect(() => { activeConvoIdRef.current = activeConvoId; }, [activeConvoId]);

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

      if (newMsg.conversation_id === activeConvoIdRef.current) {
        decryptMessage(newMsg.body, activeConvoIdRef.current, seedMapRef.current[activeConvoIdRef.current]).then(decryptedBody => {
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            // Reconcile with optimistic temp messages from same sender + body.
            const tempIdx = prev.findIndex(m =>
              m._pending
              && m.sender_id === newMsg.sender_id
              && m.body === decryptedBody
              && Math.abs(new Date(m.created_at).getTime() - new Date(newMsg.created_at).getTime()) < 60000
            );
            if (tempIdx >= 0) {
              const next = [...prev];
              next[tempIdx] = { ...newMsg, body: decryptedBody };
              return next;
            }
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
                unread_count: c.id === activeConvoIdRef.current ? 0 : c.unread_count + 1,
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
          if (payload.new.conversation_id === activeConvoIdRef.current) {
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
    // activeConvoId intentionally NOT a dep — read via activeConvoIdRef so the
    // channel stays subscribed across conversation switches.
  }, [gymId, adminId]);

  // ── Send message ──────────────────────────────────────
  const handleSend = async () => {
    if (!compose.trim() || !activeConvoId || !activeMember) return;
    setSending(true);
    const body = compose.trim();
    setCompose('');

    const tempId = crypto.randomUUID();
    const now = new Date().toISOString();
    // Mark _pending so the realtime handler swaps the temp row for the
    // real DB row instead of duplicating it.
    setMessages(prev => [...prev, {
      id: tempId,
      _pending: true,
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
      // Tail tasks — fire-and-forget so the input becomes interactive again
      // immediately. Network failures here don't undo the delivered message.
      supabase.from('conversations')
        .update({ last_message_at: now })
        .eq('id', activeConvoId)
        .then(() => {});

      const recipientId = activeMember.id;
      supabase.functions.invoke('send-push-user', {
        body: {
          profile_id: recipientId,
          gym_id: gymId,
          title: gym?.name || t('admin.messaging.newMessageFallback', 'New Message'),
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
    let list = conversations;
    // Archive filter
    if (showArchived) {
      list = list.filter(c => archivedIds.includes(c.id));
    } else {
      list = list.filter(c => !archivedIds.includes(c.id));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => {
        const other = getOtherParticipant(c, adminId);
        return other?.full_name?.toLowerCase().includes(q) || other?.username?.toLowerCase().includes(q);
      });
    }
    return list;
  }, [conversations, search, adminId, showArchived, archivedIds]);

  const filteredMembers = useMemo(() => {
    // Server already does the search and 20-row cap; client just hides blocked users
    // (small set, no point sending it to the server). They stay unreachable until
    // the admin unblocks them from the conversation actions menu.
    const blockedSet = new Set(blockedUserIds);
    return members.filter(m => !blockedSet.has(m.id));
  }, [members, blockedUserIds]);

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

  return (
    <FadeIn>
      <div
        className="admin-card overflow-hidden h-[calc(100vh-220px)] md:h-[calc(100vh-260px)]"
        style={{ minHeight: '500px', padding: 0, backgroundColor: 'var(--color-admin-panel)' }}
      >
        <div className="flex h-full">

          {/* ── Conversation List (left panel) ────────── */}
          <div className={`w-full md:w-[320px] flex-shrink-0 border-r border-white/6 flex flex-col ${mobileShowThread ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-3 border-b border-white/6 flex gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                <input type="text" placeholder={t('admin.messaging.searchConversations')} aria-label={t('admin.messaging.searchConversations')} value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
              </div>
              <button onClick={() => setShowArchived(!showArchived)}
                aria-label={showArchived ? t('admin.messaging.hideArchived', 'Ocultar archivados') : t('admin.messaging.showArchived', 'Ver archivados')}
                title={showArchived ? t('admin.messaging.hideArchived', 'Ocultar archivados') : t('admin.messaging.showArchived', 'Ver archivados')}
                className={`px-3 py-2 rounded-lg border transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                  showArchived ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30' : 'bg-white/[0.03] text-[#6B7280] border-white/6 hover:text-[#E5E7EB]'
                }`}>
                <Archive size={14} />
              </button>
              <button onClick={() => setShowNewMsg(true)}
                aria-label={t('admin.messaging.newMessage')}
                className="px-3 py-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                <Plus size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto" data-scroll-container>
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
                  const membId = getMemberId(c, adminId);
                  const isActive = c.id === activeConvoId;
                  const isMemberBlocked = blockedUserIds.includes(membId);
                  const isConvoArchived = archivedIds.includes(c.id);
                  const previewText = c.last_message_preview
                    ? (c.last_message_sender_id === adminId ? `${t('admin.messaging.you')}: ` : '') +
                      sanitize(c.last_message_preview.length > 50 ? c.last_message_preview.slice(0, 50) + '...' : c.last_message_preview)
                    : t('admin.messaging.noMessagesYet');
                  return (
                    <div key={c.id} className={`flex items-center transition-colors ${
                      isActive ? 'bg-[#D4AF37]/8' : 'hover:bg-white/[0.03]'
                    }`}>
                      <button onClick={() => { setActiveConvoId(c.id); setActiveMember(member); setMobileShowThread(true); }}
                        className="flex-1 flex items-center gap-3 px-3 py-3 text-left min-w-0">
                        <UserAvatar user={member || {}} size={36} />
                        <div className="flex-1 min-w-0">
                          {/* Row 1: name (+ role) and the "time since" — kept alone so the
                              timestamp can never collide with status chips. */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <p className={`text-[13px] font-semibold truncate ${isActive ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                                {member?.full_name || member?.username || t('admin.messaging.unknown')}
                              </p>
                              {member?.role && member.role !== 'member' && (
                                <span
                                  className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                                  style={{
                                    background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                                    color: 'var(--color-accent)',
                                  }}
                                >
                                  {member.role === 'super_admin'
                                    ? t('admin.messaging.roleSuperAdmin', 'Super Admin')
                                    : member.role === 'admin'
                                      ? t('admin.messaging.roleAdmin', 'Admin')
                                      : t('admin.messaging.roleTrainer', 'Trainer')}
                                </span>
                              )}
                            </div>
                            {c.last_message_at && (
                              <p className="text-[10px] text-[#6B7280] flex-shrink-0">
                                {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false, ...dateFnsLocale })}
                              </p>
                            )}
                          </div>
                          {/* Row 2: status chips (blocked / archived) live here, prefixing the
                              preview — they no longer share the timestamp's row. */}
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              {isMemberBlocked && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/10 text-red-400">
                                  {t('admin.messaging.blocked', 'Bloqueado')}
                                </span>
                              )}
                              {isConvoArchived && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/6 text-[#6B7280]">
                                  {t('admin.messaging.archived', 'Archivado')}
                                </span>
                              )}
                              <p className="text-[11px] text-[#6B7280] truncate">{previewText}</p>
                            </div>
                            {c.unread_count > 0 && (
                              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#D4AF37] text-[#05070B] text-[10px] font-bold flex items-center justify-center">
                                {c.unread_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      <div className="flex-shrink-0 pr-2">
                        <ConversationActionMenu
                          convoId={c.id}
                          memberId={membId}
                          isArchived={isConvoArchived}
                          isBlocked={isMemberBlocked}
                          onArchive={handleArchive}
                          onUnarchive={handleUnarchive}
                          onDelete={(id) => setDeleteConfirmId(id)}
                          onBlock={handleBlock}
                          onUnblock={handleUnblock}
                          t={t}
                        />
                      </div>
                    </div>
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
                    <div className="flex items-center gap-1.5">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{activeMember?.full_name || activeMember?.username || t('admin.messaging.member')}</p>
                      {activeMember?.role && activeMember.role !== 'member' && (
                        <span
                          className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                          style={{
                            background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                            color: 'var(--color-accent)',
                          }}
                        >
                          {activeMember.role === 'super_admin'
                            ? t('admin.messaging.roleSuperAdmin', 'Super Admin')
                            : activeMember.role === 'admin'
                              ? t('admin.messaging.roleAdmin', 'Admin')
                              : t('admin.messaging.roleTrainer', 'Trainer')}
                        </span>
                      )}
                      {blockedUserIds.includes(getMemberId(conversations.find(c => c.id === activeConvoId) || {}, adminId)) && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/10 text-red-400">
                          {t('admin.messaging.blocked', 'Bloqueado')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {activeMember?.username ? `@${activeMember.username}` : t('admin.messaging.member')}
                    </p>
                  </div>
                  {activeConvoId && (() => {
                    const activeConvo = conversations.find(c => c.id === activeConvoId);
                    if (!activeConvo) return null;
                    const membId = getMemberId(activeConvo, adminId);
                    return (
                      <ConversationActionMenu
                        convoId={activeConvoId}
                        memberId={membId}
                        isArchived={archivedIds.includes(activeConvoId)}
                        isBlocked={blockedUserIds.includes(membId)}
                        onArchive={handleArchive}
                        onUnarchive={handleUnarchive}
                        onDelete={(id) => setDeleteConfirmId(id)}
                        onBlock={handleBlock}
                        onUnblock={handleUnblock}
                        t={t}
                      />
                    );
                  })()}
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
                              <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{sanitize(item.body)}</p>
                              <div className={`flex items-center gap-1 mt-1 ${isSent ? 'justify-end' : 'justify-start'}`}>
                                <p className="text-[10px] text-[#6B7280]">{format(new Date(item.created_at), 'h:mm a')}</p>
                                {isSent && <ReadIndicator readAt={item.read_at} />}
                              </div>
                            </div>
                          </div>
                          {isLastSent && (
                            <p className={`text-[10px] text-right mr-1 ${item.read_at ? 'text-[#10B981]' : 'text-[#6B7280]'}`}>
                              {item.read_at ? t('admin.messaging.read') : t('admin.messaging.delivered')}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Compose bar — native WebView shrinks above the keyboard,
                    so the bar lands above it without manual offsets. */}
                <div
                  className="px-4 py-3 border-t border-white/6 flex-shrink-0"
                >
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
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {membersLoading && (
              <p className="text-center py-6 text-[13px] text-[#6B7280]">
                {t('common:loading', 'Cargando...')}
              </p>
            )}
            {!membersLoading && membersError && (
              <div className="py-4 text-center">
                <p className="text-[12px] text-red-400 mb-2">
                  {t('admin.messaging.membersLoadFailed', 'No se pudo cargar la lista. ')}
                  <span className="opacity-70">{membersError}</span>
                </p>
                <button
                  onClick={() => fetchMembers(newMsgSearch)}
                  className="text-[12px] font-semibold text-[#D4AF37] hover:underline"
                >
                  {t('common:retry', 'Reintentar')}
                </button>
              </div>
            )}
            {!membersLoading && !membersError && filteredMembers.map(m => (
              <button key={m.id} onClick={() => handleNewConversation(m)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/[0.04] transition-colors text-left">
                <UserAvatar user={m} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                  <p className="text-[10px] text-[#6B7280]">{m.username ? `@${m.username}` : t('admin.messaging.member')}</p>
                </div>
                {m.role && m.role !== 'member' && (
                  <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', fontWeight: 700 }}>
                    {m.role === 'super_admin'
                      ? t('admin.messaging.roleSuperAdmin', 'Super Admin')
                      : m.role === 'admin'
                        ? t('admin.messaging.roleAdmin', 'Admin')
                        : t('admin.messaging.roleTrainer', 'Trainer')}
                  </span>
                )}
              </button>
            ))}
            {!membersLoading && !membersError && filteredMembers.length === 0 && (
              <p className="text-center py-6 text-[13px] text-[#6B7280]">{t('admin.messaging.noMembersFound')}</p>
            )}
          </div>
        </AdminModal>
      )}

      {/* ── Delete Conversation Confirmation Modal ───── */}
      {deleteConfirmId && (
        <AdminModal
          isOpen={!!deleteConfirmId}
          onClose={() => setDeleteConfirmId(null)}
          title={t('admin.messaging.deleteConversation', 'Eliminar conversacion')}
          titleIcon={Trash2}
          size="sm"
          footer={
            <>
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-[#9CA3AF] text-[13px] font-semibold hover:bg-white/[0.04] transition-colors min-h-[44px]"
              >
                {t('admin.messaging.cancel', 'Cancelar')}
              </button>
              <button
                onClick={handleDeleteConfirmed}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/12 text-red-400 border border-red-500/25 text-[13px] font-semibold hover:bg-red-500/20 transition-colors min-h-[44px]"
              >
                {t('admin.messaging.deleteConversation', 'Eliminar conversacion')}
              </button>
            </>
          }
        >
          <p className="text-[13px] text-[#9CA3AF]">
            {t('admin.messaging.confirmDelete', 'Eliminar esta conversacion? Esta accion no se puede deshacer.')}
          </p>
        </AdminModal>
      )}
    </FadeIn>
  );
}
