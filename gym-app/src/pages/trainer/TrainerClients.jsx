import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, X, ChevronRight, Search, SortAsc, ExternalLink, UserPlus, Loader2, MessageSquare, CheckSquare, Square, ClipboardList, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { encryptMessage } from '../../lib/messageEncryption';
import logger from '../../lib/logger';
import { formatDistanceToNow, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import UnderlineTabs from '../../components/UnderlineTabs';

// ── Client quick-preview modal ──────────────────────────────────────────────
const ClientPreview = ({ client, churnScore, onClose, onOpen }) => {
  const { t } = useTranslation('pages');

  const daysInactive = client.last_active_at
    ? Math.floor((Date.now() - new Date(client.last_active_at)) / 86400000)
    : null;
  const isActive = daysInactive !== null && daysInactive <= 7;
  const isAtRisk = churnScore
    ? churnScore.score >= 30
    : (daysInactive === null || daysInactive > 14);

  const statusLabel = isActive
    ? t('trainerClients.statusActive', 'Active')
    : isAtRisk
      ? t('trainerClients.statusAtRisk', 'At Risk')
      : t('trainerClients.statusInactive', 'Inactive');
  const statusColor = isActive
    ? 'text-emerald-400 bg-emerald-500/10'
    : isAtRisk
      ? 'text-amber-400 bg-amber-500/10'
      : 'text-[var(--color-text-muted)] bg-[var(--color-bg-subtle)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-preview-title"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-[92vw] sm:max-w-sm overflow-hidden mx-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <div className="flex justify-end p-3 pb-0">
          <button
            onClick={onClose}
            aria-label={t('trainerClients.close', 'Close')}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Avatar + Name + Summary */}
        <div className="flex flex-col items-center px-5 pb-4">
          <div className="w-20 h-20 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center mb-3 relative">
            <span className="text-[28px] font-bold text-[var(--color-text-secondary)]">{(client.full_name || 'U')[0]}</span>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--color-bg-card)] ${
              isActive ? 'bg-emerald-400' : isAtRisk ? 'bg-amber-400' : 'bg-[var(--color-bg-inset)]'
            }`} />
          </div>
          <p id="client-preview-title" className="text-[18px] font-bold text-[var(--color-text-primary)] text-center">{client.full_name}</p>
          <span className={`mt-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusColor}`}>
            {statusLabel}
          </span>
          {/* Summary line */}
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)] text-center">
            {client.created_at
              ? t('trainerClients.memberSince', 'Member since {{date}}', { date: new Date(client.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) })
              : null}
            {client.created_at && client.last_active_at ? ' · ' : ''}
            {client.last_active_at
              ? t('trainerClients.lastSeen', 'Last seen {{time}}', { time: formatDistanceToNow(new Date(client.last_active_at), { addSuffix: true }) })
              : null}
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 mx-5 mb-5">
          {/* Last active */}
          <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3">
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">{t('trainerClients.lastActive', 'Last Active')}</p>
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {client.last_active_at
                ? formatDistanceToNow(new Date(client.last_active_at), { addSuffix: true })
                : t('trainerClients.never', 'Never')}
            </p>
          </div>

          {/* Recent workouts */}
          <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3">
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">{t('trainerClients.recentWorkouts', 'Workouts (14d)')}</p>
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{client.recentWorkouts ?? 0}</p>
          </div>

          {/* Program */}
          <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3">
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">{t('trainerClients.program', 'Program')}</p>
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)] truncate">
              {client.assigned_program_id
                ? t('trainerClients.assigned', 'Assigned')
                : t('trainerClients.none', 'None')}
            </p>
          </div>

          {/* Churn risk */}
          <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3">
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">{t('trainerClients.churnRisk', 'Churn Risk')}</p>
            {churnScore && churnScore.score >= 30 ? (
              <p className={`text-[15px] font-semibold ${
                churnScore.score >= 80 ? 'text-red-400' : churnScore.score >= 55 ? 'text-orange-400' : 'text-yellow-400'
              }`}>
                {Math.round(churnScore.score)}%
              </p>
            ) : (
              <p className="text-[15px] font-semibold text-emerald-400">{t('trainerClients.low', 'Low')}</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-5 pb-5 space-y-2.5">
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] font-semibold rounded-xl py-3 text-[14px] transition-colors min-h-[44px]"
          >
            <MessageSquare size={16} />
            {t('trainerClients.message', 'Message')}
          </button>
          <button
            onClick={onOpen}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl py-3.5 text-[15px] transition-colors min-h-[48px]"
          >
            <ExternalLink size={16} />
            {t('trainerClients.openClient', 'Open Client')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Add Client from Gym modal ──────────────────────────────────────────────
const AddClientModal = ({ trainerId, gymId, existingClientIds, onClose, onAdded }) => {
  const { t } = useTranslation('pages');
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    const fetchMembers = async () => {
      setLoadingMembers(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, last_active_at')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .order('full_name');
      if (error) logger.error('AddClientModal: failed to load members:', error);
      setMembers(data || []);
      setLoadingMembers(false);
    };
    fetchMembers();
  }, [gymId]);

  const filtered = useMemo(() => {
    const excluded = new Set(existingClientIds);
    let list = members.filter(m => !excluded.has(m.id));
    if (memberSearch.trim()) {
      const q = memberSearch.toLowerCase();
      list = list.filter(m =>
        m.full_name?.toLowerCase().includes(q) ||
        m.username?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [members, memberSearch, existingClientIds]);

  const handleAdd = async (memberId) => {
    setAddingId(memberId);
    try {
      const { error } = await supabase.from('trainer_clients').upsert({
        trainer_id: trainerId,
        client_id: memberId,
        gym_id: gymId,
        is_active: true,
      }, { onConflict: 'trainer_id,client_id' });
      if (error) throw error;
      onAdded(memberId);
    } catch (err) {
      logger.error('AddClientModal: failed to assign client:', err);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm px-0 sm:px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-client-title"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] sm:max-h-[80vh] flex flex-col overflow-hidden mx-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 id="add-client-title" className="text-[16px] font-bold text-[var(--color-text-primary)]">
            {t('trainerClients.addClient', 'Add Client')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('trainerClients.close', 'Close')}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              placeholder={t('trainerClients.searchMembers', 'Search gym members…')}
              autoFocus
              aria-label={t('trainerClients.searchMembers', 'Search gym members')}
              className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>
        </div>

        {/* Member list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1.5">
          {loadingMembers ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-accent-glow)', borderTopColor: 'var(--color-accent)' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Users size={24} className="text-[var(--color-text-muted)] mx-auto mb-2" />
              <p className="text-[13px] text-[var(--color-text-muted)]">
                {memberSearch.trim()
                  ? t('trainerClients.noMembersMatch', 'No members match your search')
                  : t('trainerClients.allMembersAssigned', 'All gym members are already assigned')}
              </p>
            </div>
          ) : (
            filtered.map(m => (
              <div
                key={m.id}
                className="flex items-center gap-3 px-3.5 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl"
              >
                <div className="w-9 h-9 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center flex-shrink-0">
                  <span className="text-[13px] font-bold text-[var(--color-text-secondary)]">{(m.full_name || 'U')[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">{m.full_name}</p>
                  {m.username && (
                    <p className="text-[11px] text-[var(--color-text-muted)] truncate">@{m.username}</p>
                  )}
                </div>
                <button
                  onClick={() => handleAdd(m.id)}
                  disabled={addingId === m.id}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[var(--color-accent)] hover:brightness-110 transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-accent-glow)' }}
                  aria-label={t('trainerClients.addMember', 'Add {{name}}', { name: m.full_name })}
                >
                  {addingId === m.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <UserPlus size={16} />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ── Assign Program Modal ──────────────────────────────────────────────────
const AssignProgramModal = ({ selectedClients, gymId, onClose, onDone }) => {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    supabase
      .from('gym_programs')
      .select('id, name')
      .eq('gym_id', gymId)
      .eq('is_published', true)
      .order('name')
      .then(({ data }) => { setPrograms(data || []); setLoading(false); });
  }, [gymId]);

  const handleAssign = async () => {
    if (!selectedProgram) return;
    setAssigning(true);
    try {
      const rows = selectedClients.map(c => ({
        profile_id: c.id,
        program_id: selectedProgram,
        gym_id: gymId,
      }));
      const { error } = await supabase.from('gym_program_enrollments').upsert(rows, { onConflict: 'program_id,profile_id' });
      if (error) throw error;
      showToast(t('trainerClients.programAssignedSuccess', 'Program assigned to {{count}} clients', { count: selectedClients.length }), 'success');
      onDone();
    } catch (err) {
      logger.error('AssignProgram: error', err);
      showToast(err.message, 'error');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-sm overflow-hidden mx-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">
            {t('trainerClients.assignProgram', 'Assign Program')}
          </h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pb-2">
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {t('trainerClients.assignProgramDesc', 'Select a program to assign to {{count}} selected clients', { count: selectedClients.length })}
          </p>
        </div>
        <div className="px-5 pb-5 space-y-2 max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-accent-glow)', borderTopColor: 'var(--color-accent)' }} />
            </div>
          ) : programs.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-muted)] text-center py-6">{t('trainerClients.noPrograms', 'No published programs')}</p>
          ) : (
            programs.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProgram(p.id)}
                className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all ${
                  selectedProgram === p.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-border-strong)]'
                }`}
              >
                <p className={`text-[13px] font-semibold ${selectedProgram === p.id ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>{p.name}</p>
              </button>
            ))
          )}
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={handleAssign}
            disabled={!selectedProgram || assigning}
            className="w-full py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl text-[14px] transition-colors min-h-[48px] disabled:opacity-50"
          >
            {assigning ? (
              <Loader2 size={16} className="animate-spin mx-auto" />
            ) : (
              t('trainerClients.assignProgram', 'Assign Program')
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Compose Message Modal (bulk DM) ──────────────────────────────────────
const ComposeMessageModal = ({ selectedClients, onClose, onDone, senderId }) => {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const text = message.trim();
    if (!text) return;
    setSending(true);
    let successCount = 0;
    try {
      for (const client of selectedClients) {
        try {
          const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: client.id });
          if (!convId) continue;
          // Fetch encryption seed
          const { data: conv } = await supabase
            .from('conversations')
            .select('encryption_seed')
            .eq('id', convId)
            .single();
          const encrypted = await encryptMessage(text, convId, conv?.encryption_seed);
          await supabase.from('direct_messages').insert({
            conversation_id: convId,
            sender_id: senderId,
            body: encrypted,
          });
          successCount++;
        } catch (err) {
          logger.error('ComposeMessage: failed for client', client.id, err);
        }
      }
      showToast(t('trainerClients.messageSentSuccess', 'Message sent to {{count}} clients', { count: successCount }), 'success');
      onDone();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-sm overflow-hidden mx-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">
            {t('trainerClients.messageAll', 'Message All')}
          </h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pb-2">
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {t('trainerClients.messageAllDesc', 'Send a direct message to {{count}} selected clients', { count: selectedClients.length })}
          </p>
        </div>
        <div className="px-5 pb-3">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={t('trainerClients.typeMessage', 'Type your message...')}
            autoFocus
            rows={3}
            className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] transition-colors resize-none min-h-[80px] sm:min-h-[100px]"
          />
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="w-full py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl text-[14px] transition-colors min-h-[48px] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <Send size={16} />
                {t('trainerClients.sendToAll', 'Send to All')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Filter / sort constants ──────────────────────────────────────────────────
const FILTER_KEYS = ['all', 'active', 'at_risk', 'has_program', 'no_program'];
const SORT_KEYS = ['last_active', 'name', 'workouts'];

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerClients() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [clients,  setClients]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sortBy,   setSortBy]   = useState('last_active');
  const [churnScores, setChurnScores] = useState({});
  const [showAddClient, setShowAddClient] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Bulk selection
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [showAssignProgram, setShowAssignProgram] = useState(false);
  const [showComposeMessage, setShowComposeMessage] = useState(false);

  const toggleBulkSelect = (clientId) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const bulkSelectedClients = useMemo(
    () => clients.filter(c => bulkSelected.has(c.id)),
    [clients, bulkSelected]
  );

  function getChurnLevel(score) {
    if (score >= 80) return { label: t('trainerClients.churnCritical', 'Critical'), color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
    if (score >= 55) return { label: t('trainerClients.churnHigh', 'High'), color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' };
    return { label: t('trainerClients.churnMedium', 'Medium'), color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' };
  }

  useEffect(() => { document.title = 'Trainer - Clients | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    const load = async () => {
      setLoading(true);
      const fourteenDaysAgo = subDays(new Date(), 14).toISOString();

      // Fetch only assigned clients via trainer_clients join
      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select(`
          client_id,
          notes,
          profiles!trainer_clients_client_id_fkey (
            id, full_name, username, last_active_at, created_at, assigned_program_id
          )
        `)
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
      if (tcError) logger.error('TrainerClients: failed to load clients:', tcError);

      const assignedClients = (tcRows || [])
        .map(tc => tc.profiles)
        .filter(Boolean);

      if (assignedClients.length === 0) {
        setClients([]);
        setLoading(false);
        return;
      }

      const clientIds = assignedClients.map(c => c.id);

      const { data: recentSessions, error: recSessError } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .in('profile_id', clientIds)
        .eq('status', 'completed')
        .gte('started_at', fourteenDaysAgo);
      if (recSessError) logger.error('TrainerClients: failed to load recent sessions:', recSessError);

      const recentCounts = {};
      (recentSessions || []).forEach(s => {
        recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1;
      });

      // Fetch churn risk scores
      const { data: churnRows, error: churnError } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, score, key_signals, computed_at')
        .in('profile_id', clientIds);
      if (churnError) logger.error('TrainerClients: failed to load churn scores:', churnError);

      const churnMap = {};
      (churnRows || []).forEach(row => { churnMap[row.profile_id] = row; });
      setChurnScores(churnMap);

      setClients(assignedClients.map(m => ({ ...m, recentWorkouts: recentCounts[m.id] ?? 0 })));
      setLoading(false);
    };
    load();
  }, [profile?.gym_id, profile?.id, reloadKey]);

  // Client-side search, filter, sort
  const filtered = useMemo(() => {
    let list = [...clients];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.full_name?.toLowerCase().includes(q) ||
        c.username?.toLowerCase().includes(q)
      );
    }

    // Filter
    const now = Date.now();
    if (filter === 'active') {
      list = list.filter(c => c.last_active_at && (now - new Date(c.last_active_at)) / 86400000 <= 7);
    } else if (filter === 'at_risk') {
      list = list.filter(c => {
        const churn = churnScores[c.id];
        if (churn) return churn.score >= 30;
        return !c.last_active_at || (now - new Date(c.last_active_at)) / 86400000 > 14;
      });
    } else if (filter === 'has_program') {
      list = list.filter(c => c.assigned_program_id);
    } else if (filter === 'no_program') {
      list = list.filter(c => !c.assigned_program_id);
    }

    // Sort
    if (sortBy === 'name') {
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    } else if (sortBy === 'workouts') {
      list.sort((a, b) => b.recentWorkouts - a.recentWorkouts);
    } else {
      list.sort((a, b) => {
        const aT = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
        const bT = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
        return bT - aT;
      });
    }

    return list;
  }, [clients, search, filter, sortBy, churnScores]);

  return (
    <div className="px-4 md:px-6 py-6 w-full max-w-5xl mx-auto pb-24 md:pb-12">
      <div className="sticky top-0 z-20 backdrop-blur-2xl -mx-4 md:-mx-6 px-4 md:px-6 py-3 mb-4"
        style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 92%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent)' }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--color-accent)' }}>
          {clients.length === 1
            ? t('trainerClients.assignedCountOne', '{{count}} assigned client', { count: clients.length })
            : t('trainerClients.assignedCountOther', '{{count}} assigned clients', { count: clients.length })}
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
            {t('trainerClients.title', 'My Clients')}
          </h1>
          <button
            onClick={() => setShowAddClient(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl text-[13px] transition-colors min-h-[44px] shrink-0"
          >
            <UserPlus size={16} />
            {t('trainerClients.addClient', 'Add Client')}
          </button>
        </div>
      </div>

      {/* Search + inline filter pills + sort cycle button */}
      {!loading && clients.length > 0 && (
        <div className="mb-4 space-y-2 md:sticky md:top-0 md:z-10 md:pb-2" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
          {/* Search + sort in one row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('trainerClients.searchClients', 'Search clients…')}
                aria-label={t('trainerClients.searchClients', 'Search clients')}
                className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl pl-10 pr-4 py-2.5 text-[14px] sm:text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>
            <button
              onClick={() => {
                const idx = SORT_KEYS.indexOf(sortBy);
                setSortBy(SORT_KEYS[(idx + 1) % SORT_KEYS.length]);
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-medium bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors shrink-0 border border-[var(--color-border-subtle)]"
              title={`${t('trainerClients.sortPrefix', 'Sort')}: ${t('trainerClients.sort_' + sortBy, sortBy)}`}
            >
              <SortAsc size={14} />
              <span>{t('trainerClients.sort_' + sortBy, sortBy)}</span>
            </button>
          </div>

          {/* Always-visible compact filter */}
          <UnderlineTabs
            tabs={FILTER_KEYS.map(fk => ({ key: fk, label: t('trainerClients.filter_' + fk, fk) }))}
            activeIndex={Math.max(0, FILTER_KEYS.indexOf(filter))}
            onChange={(i) => setFilter(FILTER_KEYS[i])}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-accent-glow)', borderTopColor: 'var(--color-accent)' }} />
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-20">
          <Users size={32} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-[14px] text-[var(--color-text-muted)]">{t('trainerClients.noClients', 'No clients assigned yet')}</p>
          <button
            onClick={() => setShowAddClient(true)}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl text-[13px] transition-colors min-h-[44px]"
          >
            <UserPlus size={16} />
            {t('trainerClients.addFirstClient', 'Add Your First Client')}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Search size={24} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-[14px] text-[var(--color-text-muted)]">{t('trainerClients.noMatchingClients', 'No clients match your filters')}</p>
          <button onClick={() => { setSearch(''); setFilter('all'); }}
            className="text-[12px] text-[var(--color-accent)] mt-2 hover:text-[var(--color-accent-soft)] transition-colors">
            {t('trainerClients.clearFilters', 'Clear filters')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(c => {
              const daysInactive = c.last_active_at
                ? Math.floor((Date.now() - new Date(c.last_active_at)) / 86400000)
                : null;
              const isActive = daysInactive !== null && daysInactive <= 7;
              const churn = churnScores[c.id];
              const isAtRisk = churn
                ? churn.score >= 30
                : (daysInactive === null || daysInactive > 14);
              const riskLevel = churn && churn.score >= 30 ? getChurnLevel(churn.score) : null;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full flex items-center gap-3 px-3.5 sm:px-4 py-4 sm:py-3.5 bg-[var(--color-bg-card)] border rounded-2xl hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)] transition-all text-left overflow-hidden ${
                    bulkSelected.has(c.id) ? 'border-[var(--color-accent)]/40' : 'border-[var(--color-border-subtle)]'
                  }`}
                >
                  {/* Bulk select checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleBulkSelect(c.id); }}
                    aria-label={t('trainerClients.selectClient', 'Select')}
                    className="min-w-[36px] min-h-[36px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors flex-shrink-0"
                  >
                    {bulkSelected.has(c.id) ? (
                      <CheckSquare size={18} className="text-[var(--color-accent)]" />
                    ) : (
                      <Square size={18} />
                    )}
                  </button>
                  <div className="w-9 h-9 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center flex-shrink-0 relative">
                    <span className="text-[13px] font-bold text-[var(--color-text-secondary)]">{(c.full_name || 'U')[0]}</span>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg-primary)] ${
                      isActive ? 'bg-emerald-400' : isAtRisk ? 'bg-amber-400' : 'bg-[var(--color-bg-inset)]'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[14px] font-semibold text-[var(--color-text-primary)] truncate">{c.full_name}</p>
                      {riskLevel && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${riskLevel.bg} ${riskLevel.color}`}>
                          {Math.round(churn.score)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      {c.last_active_at
                        ? t('trainerClients.activeAgo', 'Active {{time}}', { time: formatDistanceToNow(new Date(c.last_active_at), { addSuffix: true }) })
                        : t('trainerClients.neverActive', 'Never active')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                    {/* Condensed stat pill on mobile, full stat block on md+ */}
                    <div className="text-right block">
                      <div className="md:hidden">
                        <span className="inline-flex items-center text-[10px] font-semibold text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded-full">
                          {c.recentWorkouts}w
                        </span>
                      </div>
                      <div className="hidden md:block">
                        <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">{t('trainerClients.workoutsSummary', '{{count}}w / 14d', { count: c.recentWorkouts })}</p>
                        {c.assigned_program_id && (
                          <p className="text-[10px] text-[var(--color-accent)]">{t('trainerClients.programAssigned', 'Program assigned')}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: c.id });
                          if (convId) navigate(`/trainer/messages/${convId}`);
                        } catch (err) { logger.error('Error opening conversation:', err); }
                      }}
                      aria-label={t('trainerClients.messageClient', 'Message')}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
                    >
                      <MessageSquare size={15} />
                    </button>
                    <ChevronRight size={14} className="text-[var(--color-text-muted)] hidden sm:block" />
                  </div>
                </button>
              );
            })}

        </div>
      )}

      {selected && (
        <ClientPreview
          client={selected}
          churnScore={churnScores[selected.id]}
          onClose={() => setSelected(null)}
          onOpen={() => {
            setSelected(null);
            navigate(`/trainer/clients/${selected.id}`);
          }}
        />
      )}

      {showAddClient && (
        <AddClientModal
          trainerId={profile.id}
          gymId={profile.gym_id}
          existingClientIds={clients.map(c => c.id)}
          onClose={() => setShowAddClient(false)}
          onAdded={() => {
            setShowAddClient(false);
            setReloadKey(k => k + 1);
          }}
        />
      )}

      {/* Bulk action bar */}
      {bulkSelected.size > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl shadow-lg backdrop-blur-sm">
          <span className="text-[12px] font-semibold text-[var(--color-text-secondary)] mr-1">
            {t('trainerClients.selectedCount', '{{count}} selected', { count: bulkSelected.size })}
          </span>
          <button
            onClick={() => setShowAssignProgram(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-semibold rounded-xl text-[12px] transition-colors min-h-[36px]"
          >
            <ClipboardList size={14} />
            {t('trainerClients.assignProgram', 'Assign Program')}
          </button>
          <button
            onClick={() => setShowComposeMessage(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] font-semibold rounded-xl text-[12px] transition-colors min-h-[36px] border border-[var(--color-border-subtle)]"
          >
            <Send size={14} />
            {t('trainerClients.messageAll', 'Message All')}
          </button>
          <button
            onClick={() => setBulkSelected(new Set())}
            className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors rounded-lg"
            aria-label={t('trainerClients.clearSelection', 'Clear selection')}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showAssignProgram && (
        <AssignProgramModal
          selectedClients={bulkSelectedClients}
          gymId={profile.gym_id}
          onClose={() => setShowAssignProgram(false)}
          onDone={() => {
            setShowAssignProgram(false);
            setBulkSelected(new Set());
            setReloadKey(k => k + 1);
          }}
        />
      )}

      {showComposeMessage && (
        <ComposeMessageModal
          selectedClients={bulkSelectedClients}
          senderId={profile.id}
          onClose={() => setShowComposeMessage(false)}
          onDone={() => {
            setShowComposeMessage(false);
            setBulkSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
