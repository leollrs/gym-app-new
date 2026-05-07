import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, X, ChevronRight, Search, SortAsc, ExternalLink, UserPlus, Loader2, MessageSquare, CheckSquare, Square, ClipboardList, Send, UserMinus, Ban, AlertTriangle, ShieldBan, MoreHorizontal, CheckCheck, Activity, Plus, SlidersHorizontal } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { encryptMessage } from '../../lib/messageEncryption';
import posthog from 'posthog-js';
import logger from '../../lib/logger';
import { formatDistanceToNow, subDays } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import useFocusTrap from '../../hooks/useFocusTrap';
import Skeleton from '../../components/Skeleton';
import TrainerEmptyState from './components/TrainerEmptyState';
import { TT, TFont, statusTone, avatarIdx } from './components/designTokens';
import { TCard, TPill, TAvatar, TRing, TEyebrow, TPageTitle, TDarkButton, TIconButton, TTabPill } from './components/designPrimitives';

// ── Client quick-preview modal ──────────────────────────────────────────────
const ClientPreview = ({ client, churnScore, onClose, onOpen, onMessage, onRemove, onBlock }) => {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const focusTrapRef = useFocusTrap(true, onClose);

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
        ref={focusTrapRef}
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
              ? t('trainerClients.lastSeen', 'Last seen {{time}}', { time: formatDistanceToNow(new Date(client.last_active_at), { addSuffix: true, locale: dateFnsLocale }) })
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
                ? formatDistanceToNow(new Date(client.last_active_at), { addSuffix: true, locale: dateFnsLocale })
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
            onClick={() => { onClose(); onMessage(client.id); }}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] font-semibold rounded-xl py-3 text-[14px] transition-colors min-h-[44px]"
          >
            <MessageSquare size={16} />
            {t('trainerClients.message', 'Message')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onOpen}
              className="flex-1 flex items-center justify-center gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl py-3.5 text-[15px] transition-colors min-h-[48px]"
            >
              <ExternalLink size={16} />
              {t('trainerClients.openClient', 'Open Client')}
            </button>
            {/* More options menu */}
            <div className="relative">
              <button
                onClick={() => setShowMoreMenu(prev => !prev)}
                aria-label={t('trainerClients.moreOptions', 'More options')}
                className="w-[48px] h-[48px] flex items-center justify-center bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] rounded-xl border border-[var(--color-border-subtle)] transition-colors"
              >
                <MoreHorizontal size={18} />
              </button>
              {showMoreMenu && (
                <div className="absolute bottom-full right-0 mb-1.5 w-48 bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-xl shadow-lg overflow-hidden z-10 animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <button
                    onClick={() => { setShowMoreMenu(false); onClose(); onRemove(client); }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-left min-h-[44px]"
                  >
                    <UserMinus size={15} className="text-[var(--color-text-muted)]" />
                    {t('trainerClients.removeClient', 'Remove Client')}
                  </button>
                  <div className="mx-3 border-t border-[var(--color-border-subtle)]" />
                  <button
                    onClick={() => { setShowMoreMenu(false); onClose(); onBlock(client); }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-red-400 hover:bg-red-500/5 transition-colors text-left min-h-[44px]"
                  >
                    <ShieldBan size={15} />
                    {t('trainerClients.blockClient', 'Block Client')}
                  </button>
                </div>
              )}
            </div>
          </div>
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
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const debounceRef = useRef(null);
  const focusTrapRef = useFocusTrap(true, onClose);

  const searchMembers = useCallback(async (query) => {
    if (query.trim().length < 2) {
      setMembers([]);
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    const pattern = `%${query.trim()}%`;
    const { data, error } = await supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username, last_active_at')
      .eq('role', 'member')
      .or(`full_name.ilike.${pattern},username.ilike.${pattern}`)
      .order('full_name')
      .limit(50);
    if (error) logger.error('AddClientModal: failed to search members:', error);
    setMembers(data || []);
    setLoadingMembers(false);
  }, [gymId]);

  const handleSearchChange = useCallback((e) => {
    const val = e.target.value;
    setMemberSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchMembers(val), 300);
  }, [searchMembers]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const filtered = useMemo(() => {
    const excluded = new Set(existingClientIds);
    return members.filter(m => !excluded.has(m.id));
  }, [members, existingClientIds]);

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
      posthog?.capture('trainer_client_added');
      onAdded(memberId);
    } catch (err) {
      logger.error('AddClientModal: failed to assign client:', err);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-client-title"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden mx-auto"
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
              onChange={handleSearchChange}
              placeholder={t('trainerClients.searchMembersHint', 'Type at least 2 characters to search…')}
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
          ) : memberSearch.trim().length < 2 ? (
            <div className="text-center py-10">
              <Search size={24} className="text-[var(--color-text-muted)] mx-auto mb-2" />
              <p className="text-[13px] text-[var(--color-text-muted)]">
                {t('trainerClients.typeToSearch', 'Type at least 2 characters to search')}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Users size={24} className="text-[var(--color-text-muted)] mx-auto mb-2" />
              <p className="text-[13px] text-[var(--color-text-muted)]">
                {t('trainerClients.noMembersFound', 'No members found')}
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
      posthog?.capture('trainer_program_assigned', { client_count: selectedClients.length });
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
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-[92vw] sm:max-w-sm overflow-hidden mx-auto"
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
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const focusTrapRef = useFocusTrap(true, onClose);

  const handleSend = async () => {
    const text = message.trim();
    if (!text) return;
    setSending(true);
    const total = selectedClients.length;
    setProgress({ sent: 0, total });
    let successCount = 0;
    let failCount = 0;
    const BATCH_SIZE = 5;

    try {
      for (let i = 0; i < selectedClients.length; i += BATCH_SIZE) {
        const batch = selectedClients.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (client) => {
            try {
              const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: client.id });
              if (!convId) return false;
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
              return true;
            } catch (err) {
              logger.error('ComposeMessage: failed for client', client.id, err);
              return false;
            }
          })
        );
        const batchSuccess = results.filter(Boolean).length;
        successCount += batchSuccess;
        failCount += results.length - batchSuccess;
        setProgress({ sent: Math.min(i + BATCH_SIZE, total), total });
      }

      if (failCount > 0) {
        showToast(
          t('trainerClients.messageSentPartial', '{{success}} sent, {{failed}} failed', { success: successCount, failed: failCount }),
          'warning'
        );
      } else {
        showToast(t('trainerClients.messageSentSuccess', 'Message sent to {{count}} clients', { count: successCount }), 'success');
      }
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
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-[92vw] sm:max-w-sm overflow-hidden mx-auto"
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
              <>
                <Loader2 size={16} className="animate-spin" />
                {progress.total > 0 && (
                  <span className="text-[13px]">
                    {t('trainerClients.sendingProgress', 'Sending {{sent}}/{{total}}...', { sent: progress.sent, total: progress.total })}
                  </span>
                )}
              </>
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
const SORT_DEFAULTS = { last_active: 'Last active', name: 'Name', workouts: 'Workouts', adherence: 'Adherence', streak: 'Streak', churn: 'Churn risk' };

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerClients() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
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
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [showAssignProgram, setShowAssignProgram] = useState(false);
  const [showComposeMessage, setShowComposeMessage] = useState(false);
  // Remove / Block client
  const [removeTarget, setRemoveTarget] = useState(null);
  const [blockTarget, setBlockTarget] = useState(null);
  const [removingClient, setRemovingClient] = useState(false);
  const [blockingClient, setBlockingClient] = useState(false);

  const handleMessageClient = async (clientId) => {
    try {
      const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
      if (convId) navigate(`/trainer/messages/${convId}`);
    } catch (err) {
      logger.error('Error opening conversation:', err);
      showToast(t('trainerClients.messageError', 'Could not open conversation'), 'error');
    }
  };

  const handleRemoveClient = async () => {
    if (!removeTarget) return;
    setRemovingClient(true);
    try {
      const { error } = await supabase
        .from('trainer_clients')
        .update({ is_active: false })
        .eq('trainer_id', profile.id)
        .eq('client_id', removeTarget.id);
      if (error) throw error;
      setClients(prev => prev.filter(c => c.id !== removeTarget.id));
      showToast(t('trainerClients.clientRemoved', '{{name}} has been removed from your clients', { name: removeTarget.full_name }), 'success');
    } catch (err) {
      logger.error('RemoveClient: error', err);
      showToast(err.message, 'error');
    } finally {
      setRemovingClient(false);
      setRemoveTarget(null);
    }
  };

  const handleBlockClient = async () => {
    if (!blockTarget) return;
    setBlockingClient(true);
    try {
      // 1. Block the user (prevents messaging)
      const { error: blockErr } = await supabase
        .from('blocked_users')
        .upsert({ blocker_id: profile.id, blocked_id: blockTarget.id }, { onConflict: 'blocker_id,blocked_id' });
      if (blockErr) throw blockErr;
      // 2. Also deactivate the trainer-client relationship
      await supabase
        .from('trainer_clients')
        .update({ is_active: false })
        .eq('trainer_id', profile.id)
        .eq('client_id', blockTarget.id);
      setClients(prev => prev.filter(c => c.id !== blockTarget.id));
      showToast(t('trainerClients.clientBlocked', '{{name}} has been blocked', { name: blockTarget.full_name }), 'success');
    } catch (err) {
      logger.error('BlockClient: error', err);
      showToast(err.message, 'error');
    } finally {
      setBlockingClient(false);
      setBlockTarget(null);
    }
  };

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

  useEffect(() => { document.title = t('trainerClients.pageTitle', `Trainer - Clients | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

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

  // ── Compute funnel counts + status mapping ─────────────────
  const now = Date.now();
  const isActiveClient = (c) => c.last_active_at && (now - new Date(c.last_active_at).getTime()) / 86400000 <= 7;
  const isChurnClient = (c) => {
    const churn = churnScores[c.id];
    if (churn && churn.score >= 80) return true;
    return c.last_active_at ? (now - new Date(c.last_active_at).getTime()) / 86400000 > 30 : true;
  };
  const isAtRiskClient = (c) => {
    if (isChurnClient(c)) return false;
    const churn = churnScores[c.id];
    if (churn) return churn.score >= 30;
    return c.last_active_at ? (now - new Date(c.last_active_at).getTime()) / 86400000 > 14 : false;
  };
  const onTrackCount = clients.filter(c => isActiveClient(c) && !isAtRiskClient(c) && !isChurnClient(c)).length;
  const atRiskCount  = clients.filter(c => isAtRiskClient(c)).length;
  const churnCount   = clients.filter(c => isChurnClient(c)).length;

  // Status tab definitions reuse existing FILTER_KEYS to preserve filter state behaviour.
  const STATUS_TABS = [
    { key: 'all',         label: t('trainerClients.tabAll', 'All') },
    { key: 'active',      label: t('trainerClients.tabOnTrack', 'On track') },
    { key: 'at_risk',     label: t('trainerClients.tabAtRisk', 'At risk') },
    { key: 'no_program',  label: t('trainerClients.tabNoPlan', 'No plan') },
    { key: 'has_program', label: t('trainerClients.tabHasProgram', 'On program') },
  ];

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }} className="pb-2">
      <style>{`
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div style={{ padding: '6px 16px 12px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <TEyebrow>{t('trainerClients.roster', 'Roster · {{count}}', { count: clients.length })}</TEyebrow>
            <TPageTitle>{t('trainerClients.title', 'Clients')}</TPageTitle>
          </div>
          <TDarkButton onClick={() => setShowAddClient(true)} aria-label={t('trainerClients.addClient', 'Add Client')}>
            <Plus size={15} strokeWidth={2.4} />
            {t('trainerClients.add', 'Add')}
          </TDarkButton>
        </div>

        {/* Funnel strip */}
        {!loading && clients.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 12 }}>
            {[
              { lbl: t('trainerClients.funnel.onTrack', 'On track'), n: onTrackCount, tone: TT.good, soft: TT.goodSoft, filter: 'active' },
              { lbl: t('trainerClients.funnel.atRisk', 'At risk'),   n: atRiskCount,  tone: TT.warn, soft: TT.warnSoft, filter: 'at_risk' },
              { lbl: t('trainerClients.funnel.churn', 'Churn'),      n: churnCount,   tone: TT.hot,  soft: TT.hotSoft,  filter: 'at_risk' },
            ].map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setFilter(s.filter)}
                style={{
                  padding: 12, borderRadius: 14, background: s.soft,
                  border: 'none', textAlign: 'left', cursor: 'pointer',
                  minHeight: 64,
                }}
              >
                <div style={{ fontFamily: TFont.display, fontSize: 22, fontWeight: 800, color: s.tone, letterSpacing: -0.5, lineHeight: 1 }}>
                  {s.n}
                </div>
                <div style={{ fontSize: 11, color: s.tone, fontWeight: 700, marginTop: 4 }}>{s.lbl}</div>
              </button>
            ))}
          </div>
        )}

        {/* Search + filter row */}
        {!loading && clients.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div
              style={{
                flex: 1, height: 40, background: TT.surface, borderRadius: 12,
                border: `1px solid ${TT.borderSolid}`,
                display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
              }}
            >
              <Search size={16} color={TT.textMute} strokeWidth={2} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('trainerClients.searchPlaceholder', 'Search clients…')}
                aria-label={t('trainerClients.searchClients', 'Search clients')}
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 13, color: TT.text, minWidth: 0,
                }}
              />
            </div>
            <button
              type="button"
              aria-label={t('trainerClients.sortBtn', 'Sort')}
              onClick={() => {
                const idx = SORT_KEYS.indexOf(sortBy);
                setSortBy(SORT_KEYS[(idx + 1) % SORT_KEYS.length]);
              }}
              title={`${t('trainerClients.sortPrefix', 'Sort')}: ${t(`trainerClients.sort_${sortBy}`, SORT_DEFAULTS[sortBy] || sortBy)}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 40, padding: '0 12px', borderRadius: 12,
                background: TT.surface2, border: `1px solid ${TT.border}`,
                color: TT.text, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              <SortAsc size={14} color={TT.text} />
              {t(`trainerClients.sort_${sortBy}`, SORT_DEFAULTS[sortBy] || sortBy)}
            </button>
            <TIconButton
              size={40}
              ariaLabel={selectMode ? t('trainerClients.exitSelect', 'Exit select') : t('trainerClients.selectClients', 'Select clients')}
              onClick={() => {
                if (selectMode) { setSelectMode(false); setBulkSelected(new Set()); }
                else setSelectMode(true);
              }}
              style={selectMode ? { background: TT.accentSoft, borderColor: TT.accent } : undefined}
            >
              <SlidersHorizontal size={16} color={selectMode ? TT.accentInk : TT.text} />
            </TIconButton>
          </div>
        )}

        {/* Status tabs */}
        {!loading && clients.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }} className="scrollbar-hide">
            {STATUS_TABS.map((tab) => (
              <TTabPill
                key={tab.key}
                active={filter === tab.key}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
              </TTabPill>
            ))}
          </div>
        )}

        {/* Client list */}
        {loading ? (
          <div className="space-y-3 py-2">
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
          </div>
        ) : clients.length === 0 ? (
          <TrainerEmptyState
            icon={Users}
            title={t('trainerClients.noClients', 'No clients assigned yet')}
            description={t('trainerClients.emptyDesc', 'Add a client from your gym roster to start tracking their journey.')}
            actionLabel={t('trainerClients.addFirstClient', 'Add your first client')}
            actionIcon={UserPlus}
            onAction={() => setShowAddClient(true)}
          />
        ) : filtered.length === 0 ? (
          <TrainerEmptyState
            icon={Search}
            title={t('trainerClients.noMatchingClients', 'No clients match your filters')}
            description={t('trainerClients.noMatchDesc', 'Try widening the filter or clearing your search.')}
            actionLabel={t('trainerClients.clearFilters', 'Clear filters')}
            onAction={() => { setSearch(''); setFilter('all'); }}
            compact
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {filtered.map((c, idx) => {
              const status = isChurnClient(c) ? 'churn' : isAtRiskClient(c) ? 'at_risk' : 'on_track';
              const tone = statusTone(status);
              const churn = churnScores[c.id];
              const adherenceVal = (() => {
                const wk = c.recentWorkouts || 0;
                return Math.max(0, Math.min(1, wk / 6));
              })();
              const adherencePct = Math.round(adherenceVal * 100);
              const sessionsLabel = `${c.recentWorkouts || 0}/${6}`;
              const sessionsRatio = Math.max(0, Math.min(1, (c.recentWorkouts || 0) / 6));
              const programLabel = c.assigned_program_id
                ? t('trainerClients.programAssigned', 'Program assigned')
                : t('trainerClients.noProgram', 'No program');
              const lastActiveLabel = c.last_active_at
                ? formatDistanceToNow(new Date(c.last_active_at), { addSuffix: true, locale: dateFnsLocale })
                : t('trainerClients.neverActive', 'Never active');
              const isSelected = bulkSelected.has(c.id);
              return (
                <motion.button
                  key={c.id}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(idx * 0.03, 0.3) }}
                  onClick={() => selectMode ? toggleBulkSelect(c.id) : navigate(`/trainer/clients/${c.id}`)}
                  aria-label={c.full_name}
                  style={{
                    background: TT.surface,
                    borderRadius: 18,
                    border: `1px solid ${isSelected ? TT.accent : TT.border}`,
                    boxShadow: TT.shadow,
                    padding: 14,
                    color: TT.text,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {selectMode && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleBulkSelect(c.id); }}
                      aria-label={t('trainerClients.selectClient', 'Select')}
                      style={{
                        minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer',
                        flexShrink: 0, color: isSelected ? TT.accent : TT.textMute,
                        animation: 'slideInLeft 0.15s ease-out',
                      }}
                    >
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                  )}
                  <TAvatar name={c.full_name || '?'} size={44} idx={avatarIdx(c.id)} src={c.avatar_url} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: TT.text }}>
                        {c.full_name}
                      </div>
                      {status === 'churn' && (
                        <TPill tone="hot" size="s">
                          {churn ? `${Math.round(churn.score)}%` : t('trainerClients.churnPill', 'Churn')}
                        </TPill>
                      )}
                      {status === 'at_risk' && (
                        <TPill tone="warn" size="s">
                          {churn ? `${Math.round(churn.score)}%` : t('trainerClients.riskPill', 'Risk')}
                        </TPill>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {programLabel} · {lastActiveLabel}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 10.5, color: TT.textMute, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                        {t('trainerClients.sessionsLabel', 'Sessions')}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: TFont.mono, color: TT.text, fontWeight: 700 }}>
                        {sessionsLabel}
                      </span>
                      <span style={{ flex: 1, height: 4, background: TT.surface2, borderRadius: 999, overflow: 'hidden', minWidth: 20 }}>
                        <span style={{ display: 'block', width: `${sessionsRatio * 100}%`, height: '100%', background: tone }} />
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <TRing value={adherenceVal} size={40} stroke={4} color={tone} label={`${adherencePct}`} />
                    <div style={{ fontSize: 9, color: TT.textMute, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                      {t('trainerClients.adhAbbr', 'Adh')}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <ClientPreview
          client={selected}
          churnScore={churnScores[selected.id]}
          onClose={() => setSelected(null)}
          onOpen={() => {
            setSelected(null);
            navigate(`/trainer/clients/${selected.id}`);
          }}
          onMessage={handleMessageClient}
          onRemove={(client) => setRemoveTarget(client)}
          onBlock={(client) => setBlockTarget(client)}
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
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl shadow-lg backdrop-blur-sm max-w-[calc(100vw-2rem)]">
          <span className="text-[12px] font-semibold text-[var(--color-text-secondary)] mr-1 whitespace-nowrap">
            {t('trainerClients.selectedCount', '{{count}} selected', { count: bulkSelected.size })}
          </span>
          <button
            onClick={() => setShowAssignProgram(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-semibold rounded-xl text-[12px] transition-colors min-h-[44px]"
          >
            <ClipboardList size={14} />
            {t('trainerClients.assignProgram', 'Assign Program')}
          </button>
          <button
            onClick={() => setShowComposeMessage(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] font-semibold rounded-xl text-[12px] transition-colors min-h-[44px] border border-[var(--color-border-subtle)]"
          >
            <Send size={14} />
            {t('trainerClients.messageAll', 'Message All')}
          </button>
          <button
            onClick={() => { setBulkSelected(new Set()); setSelectMode(false); }}
            className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
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
            setSelectMode(false);
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
            setSelectMode(false);
          }}
        />
      )}

      {/* Remove Client Confirmation */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setRemoveTarget(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-[92vw] sm:max-w-sm overflow-hidden mx-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center px-5 pt-6 pb-4">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mb-3">
                <AlertTriangle size={24} className="text-amber-400" />
              </div>
              <h2 className="text-[16px] font-bold text-[var(--color-text-primary)] text-center">
                {t('trainerClients.removeConfirmTitle', 'Remove Client')}
              </h2>
              <p className="text-[13px] text-[var(--color-text-muted)] text-center mt-2">
                {t('trainerClients.removeConfirmDesc', 'Are you sure you want to remove {{name}} from your client list? This will not delete their account.', { name: removeTarget.full_name })}
              </p>
            </div>
            <div className="px-5 pb-5 flex gap-2.5">
              <button
                onClick={() => setRemoveTarget(null)}
                className="flex-1 py-3 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] font-semibold rounded-xl text-[14px] transition-colors min-h-[48px]"
              >
                {t('trainerClients.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleRemoveClient}
                disabled={removingClient}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-[14px] transition-colors min-h-[48px] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {removingClient ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    <UserMinus size={16} />
                    {t('trainerClients.confirmRemove', 'Remove')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Client Confirmation */}
      {blockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setBlockTarget(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-[92vw] sm:max-w-sm overflow-hidden mx-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center px-5 pt-6 pb-4">
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
                <ShieldBan size={24} className="text-red-400" />
              </div>
              <h2 className="text-[16px] font-bold text-[var(--color-text-primary)] text-center">
                {t('trainerClients.blockConfirmTitle', 'Block Client')}
              </h2>
              <p className="text-[13px] text-[var(--color-text-muted)] text-center mt-2">
                {t('trainerClients.blockConfirmDesc', 'Are you sure you want to block {{name}}? They will be removed from your client list and will not be able to send you messages.', { name: blockTarget.full_name })}
              </p>
            </div>
            <div className="px-5 pb-5 flex gap-2.5">
              <button
                onClick={() => setBlockTarget(null)}
                className="flex-1 py-3 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] font-semibold rounded-xl text-[14px] transition-colors min-h-[48px]"
              >
                {t('trainerClients.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleBlockClient}
                disabled={blockingClient}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-[14px] transition-colors min-h-[48px] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {blockingClient ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    <ShieldBan size={16} />
                    {t('trainerClients.confirmBlock', 'Block')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
