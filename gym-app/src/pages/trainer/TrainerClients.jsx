import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { selectInBatches } from '../../lib/churn/batchedSelect';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, X, ChevronRight, Search, SortAsc, ExternalLink, UserPlus, Loader2, MessageSquare, MessageCircle, CheckSquare, Square, ClipboardList, Send, UserMinus, Ban, AlertTriangle, ShieldBan, MoreHorizontal, CheckCheck, Activity, Plus, SlidersHorizontal } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { encryptMessage } from '../../lib/messageEncryption';
import { openWhatsApp, hasWhatsApp } from '../../lib/whatsapp';
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
  const statusTone = isActive ? 'good' : isAtRisk ? 'warn' : 'neutral';
  const statusDot = isActive ? TT.good : isAtRisk ? TT.warn : TT.textFaint;

  const statCardStyle = {
    background: TT.surface2, borderRadius: 14, padding: 12,
  };
  const statLabelStyle = {
    fontSize: 10, color: TT.textMute, textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 2, fontWeight: 700,
  };
  const statValueStyle = {
    fontSize: 15, fontWeight: 700, color: TT.text,
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="client-preview-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        ref={focusTrapRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: TT.surface, borderRadius: 18,
          width: '100%', maxWidth: 380, overflow: 'hidden',
          boxShadow: TT.shadowLg,
        }}
      >
        {/* Close button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 12px 0' }}>
          <button
            onClick={onClose}
            aria-label={t('trainerClients.close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999, border: 'none',
              background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Avatar + Name + Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 20px 16px' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <TAvatar name={client.full_name || '?'} size={80} idx={avatarIdx(client.id)} src={client.avatar_url} />
            <span style={{
              position: 'absolute', bottom: 2, right: 2, width: 14, height: 14,
              borderRadius: 999, background: statusDot, border: `2px solid ${TT.surface}`,
            }} />
          </div>
          <p id="client-preview-title" style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, textAlign: 'center', letterSpacing: -0.3 }}>
            {client.full_name}
          </p>
          <TPill tone={statusTone} size="m" style={{ marginTop: 6 }}>{statusLabel}</TPill>
          {/* Summary line */}
          <p style={{ marginTop: 8, fontSize: 12, color: TT.textMute, textAlign: 'center' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 20px 20px' }}>
          {/* Last active */}
          <div style={statCardStyle}>
            <p style={statLabelStyle}>{t('trainerClients.lastActive', 'Last Active')}</p>
            <p style={statValueStyle}>
              {client.last_active_at
                ? formatDistanceToNow(new Date(client.last_active_at), { addSuffix: true, locale: dateFnsLocale })
                : t('trainerClients.never', 'Never')}
            </p>
          </div>

          {/* Recent workouts */}
          <div style={statCardStyle}>
            <p style={statLabelStyle}>{t('trainerClients.recentWorkouts', 'Workouts (14d)')}</p>
            <p style={statValueStyle}>{client.recentWorkouts ?? 0}</p>
          </div>

          {/* Program */}
          <div style={statCardStyle}>
            <p style={statLabelStyle}>{t('trainerClients.program', 'Program')}</p>
            <p style={{ ...statValueStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {client.assigned_program_id
                ? t('trainerClients.assigned', 'Assigned')
                : t('trainerClients.none', 'None')}
            </p>
          </div>

          {/* Churn risk */}
          <div style={statCardStyle}>
            <p style={statLabelStyle}>{t('trainerClients.churnRisk', 'Churn Risk')}</p>
            {churnScore && churnScore.score >= 30 ? (
              <p style={{
                ...statValueStyle,
                color: churnScore.score >= 80 ? TT.hot : churnScore.score >= 55 ? TT.warn : TT.warnInk,
              }}>
                {Math.round(churnScore.score)}%
              </p>
            ) : (
              <p style={{ ...statValueStyle, color: TT.goodInk }}>{t('trainerClients.low', 'Low')}</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 20px 20px' }}>
          <button
            onClick={() => { onClose(); onMessage(client.id); }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: TT.surface2, color: TT.textSub, border: 'none',
              fontWeight: 700, borderRadius: 12, padding: '12px 0', fontSize: 14,
              minHeight: 44, cursor: 'pointer',
            }}
          >
            <MessageSquare size={16} />
            {t('trainerClients.message', 'Message')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onOpen}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: TT.accent, color: '#06363B', border: 'none',
                fontFamily: TFont.display, fontWeight: 800, borderRadius: 12,
                padding: '14px 0', fontSize: 15, minHeight: 48, cursor: 'pointer',
              }}
            >
              <ExternalLink size={16} />
              {t('trainerClients.openClient', 'Open Client')}
            </button>
            {/* More options menu */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowMoreMenu(prev => !prev)}
                aria-label={t('trainerClients.moreOptions', 'More options')}
                style={{
                  width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: TT.surface2, color: TT.textMute, borderRadius: 12,
                  border: `1px solid ${TT.borderSolid}`, cursor: 'pointer',
                }}
              >
                <MoreHorizontal size={18} />
              </button>
              {showMoreMenu && (
                <div style={{
                  position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, width: 192,
                  background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 12,
                  boxShadow: TT.shadowLg, overflow: 'hidden', zIndex: 10,
                }}>
                  <button
                    onClick={() => { setShowMoreMenu(false); onClose(); onRemove(client); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TT.textSub,
                      background: 'transparent', border: 'none', textAlign: 'left', minHeight: 44, cursor: 'pointer',
                    }}
                  >
                    <UserMinus size={15} color={TT.textMute} />
                    {t('trainerClients.removeClient', 'Remove Client')}
                  </button>
                  <div style={{ margin: '0 12px', borderTop: `1px solid ${TT.border}` }} />
                  <button
                    onClick={() => { setShowMoreMenu(false); onClose(); onBlock(client); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TT.hot,
                      background: 'transparent', border: 'none', textAlign: 'left', minHeight: 44, cursor: 'pointer',
                    }}
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
    <div
      role="dialog" aria-modal="true" aria-labelledby="add-client-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        ref={focusTrapRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: TT.surface, borderRadius: 18,
          width: '100%', maxWidth: 448, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: TT.shadowLg,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 12px', flexShrink: 0,
        }}>
          <h2 id="add-client-title" style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
            {t('trainerClients.addClient', 'Add Client')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('trainerClients.close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999, border: 'none',
              background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: 42, background: TT.surface2, borderRadius: 12,
            border: `1px solid ${TT.borderSolid}`, padding: '0 12px',
          }}>
            <Search size={16} color={TT.textMute} strokeWidth={2} />
            <input
              value={memberSearch}
              onChange={handleSearchChange}
              placeholder={t('trainerClients.searchMembersHint', 'Type at least 2 characters to search…')}
              autoFocus
              aria-label={t('trainerClients.searchMembers', 'Search gym members')}
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, color: TT.text, minWidth: 0,
              }}
            />
          </div>
        </div>

        {/* Member list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loadingMembers ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <Loader2 size={24} className="animate-spin" color={TT.accent} />
            </div>
          ) : memberSearch.trim().length < 2 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Search size={24} color={TT.textMute} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClients.typeToSearch', 'Type at least 2 characters to search')}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Users size={24} color={TT.textMute} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClients.noMembersFound', 'No members found')}
              </p>
            </div>
          ) : (
            filtered.map(m => (
              <div
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', background: TT.surface2,
                  border: `1px solid ${TT.border}`, borderRadius: 12,
                }}
              >
                <TAvatar name={m.full_name || '?'} size={36} idx={avatarIdx(m.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: TT.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name}</p>
                  {m.username && (
                    <p style={{ fontSize: 11, color: TT.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{m.username}</p>
                  )}
                </div>
                <button
                  onClick={() => handleAdd(m.id)}
                  disabled={addingId === m.id}
                  style={{
                    minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 12, border: 'none', background: TT.accentSoft, color: TT.accentInk,
                    cursor: addingId === m.id ? 'default' : 'pointer', opacity: addingId === m.id ? 0.5 : 1,
                  }}
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
    <div
      role="dialog" aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: TT.surface, borderRadius: 18,
          width: '100%', maxWidth: 380, overflow: 'hidden',
          boxShadow: TT.shadowLg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px' }}>
          <h2 style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
            {t('trainerClients.assignProgram', 'Assign Program')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('trainerClients.close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999, border: 'none',
              background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '0 20px 8px' }}>
          <p style={{ fontSize: 12, color: TT.textMute }}>
            {t('trainerClients.assignProgramDesc', 'Select a program to assign to {{count}} selected clients', { count: selectedClients.length })}
          </p>
        </div>
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <Loader2 size={20} className="animate-spin" color={TT.accent} />
            </div>
          ) : programs.length === 0 ? (
            <p style={{ fontSize: 13, color: TT.textMute, textAlign: 'center', padding: '24px 0' }}>{t('trainerClients.noPrograms', 'No published programs')}</p>
          ) : (
            programs.map(p => {
              const sel = selectedProgram === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProgram(p.id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12,
                    border: `1px solid ${sel ? TT.accent : TT.border}`,
                    background: sel ? TT.accentSoft : TT.surface2, cursor: 'pointer',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 700, color: sel ? TT.accentInk : TT.text }}>{p.name}</p>
                </button>
              );
            })
          )}
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          <button
            onClick={handleAssign}
            disabled={!selectedProgram || assigning}
            style={{
              width: '100%', padding: '12px 0', background: TT.accent, color: '#06363B',
              fontFamily: TFont.display, fontWeight: 800, borderRadius: 12, fontSize: 14, border: 'none',
              minHeight: 48, cursor: (!selectedProgram || assigning) ? 'default' : 'pointer',
              opacity: (!selectedProgram || assigning) ? 0.5 : 1,
            }}
          >
            {assigning ? (
              <Loader2 size={16} className="animate-spin" style={{ margin: '0 auto' }} />
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
    <div
      role="dialog" aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        ref={focusTrapRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: TT.surface, borderRadius: 18,
          width: '100%', maxWidth: 380, overflow: 'hidden',
          boxShadow: TT.shadowLg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px' }}>
          <h2 style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
            {t('trainerClients.messageAll', 'Message All')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('trainerClients.close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999, border: 'none',
              background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '0 20px 8px' }}>
          <p style={{ fontSize: 12, color: TT.textMute }}>
            {t('trainerClients.messageAllDesc', 'Send a direct message to {{count}} selected clients', { count: selectedClients.length })}
          </p>
        </div>
        <div style={{ padding: '0 20px 12px' }}>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={t('trainerClients.typeMessage', 'Type your message...')}
            autoFocus
            rows={3}
            style={{
              width: '100%', background: TT.surface2, border: `1px solid ${TT.borderSolid}`,
              borderRadius: 12, padding: '12px 14px', fontSize: 13, color: TT.text,
              outline: 'none', resize: 'none', minHeight: 90, fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            style={{
              width: '100%', padding: '12px 0', background: TT.accent, color: '#06363B',
              fontFamily: TFont.display, fontWeight: 800, borderRadius: 12, fontSize: 14, border: 'none',
              minHeight: 48, cursor: (!message.trim() || sending) ? 'default' : 'pointer',
              opacity: (!message.trim() || sending) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {sending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {progress.total > 0 && (
                  <span style={{ fontSize: 13 }}>
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
            id, full_name, username, last_active_at, created_at, assigned_program_id, phone_number
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

      const { data: recentSessions, error: recSessError } = await selectInBatches(
        (ids) => supabase.from('workout_sessions').select('profile_id')
          .in('profile_id', ids).eq('status', 'completed').gte('started_at', fourteenDaysAgo),
        clientIds,
      );
      if (recSessError) logger.error('TrainerClients: failed to load recent sessions:', recSessError);

      const recentCounts = {};
      (recentSessions || []).forEach(s => {
        recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1;
      });

      // Fetch churn risk scores
      const { data: churnRows, error: churnError } = await selectInBatches(
        (ids) => supabase.from('churn_risk_scores').select('profile_id, score, key_signals, computed_at')
          .in('profile_id', ids),
        clientIds,
      );
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
              <SortAsc size={14} style={{ color: TT.text }} />
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
              const canWA = hasWhatsApp(c.phone_number);
              const openWA = (e) => {
                e.stopPropagation();
                const firstName = (c.full_name || '').split(' ')[0];
                openWhatsApp(c.phone_number, t('trainerClients.waGreeting', 'Hi {{name}}!', { name: firstName || '' }));
              };
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
                  {canWA && !selectMode && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={openWA}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openWA(e); }}
                      aria-label={t('trainerClients.whatsapp', 'WhatsApp {{name}}', { name: c.full_name || '' })}
                      style={{
                        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                        background: '#25D366', color: '#fff',
                        display: 'grid', placeItems: 'center', cursor: 'pointer',
                      }}
                    >
                      <MessageCircle size={17} strokeWidth={2.4} />
                    </span>
                  )}
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
        <div
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)]"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
            background: TT.surface, border: `1px solid ${TT.borderSolid}`,
            borderRadius: 18, boxShadow: TT.shadowLg,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: TT.textSub, marginRight: 4, whiteSpace: 'nowrap' }}>
            {t('trainerClients.selectedCount', '{{count}} selected', { count: bulkSelected.size })}
          </span>
          <button
            onClick={() => setShowAssignProgram(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
              background: TT.accent, color: '#06363B', fontWeight: 700,
              borderRadius: 12, fontSize: 12, border: 'none', minHeight: 44, cursor: 'pointer',
            }}
          >
            <ClipboardList size={14} />
            {t('trainerClients.assignProgram', 'Assign Program')}
          </button>
          <button
            onClick={() => setShowComposeMessage(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
              background: TT.surface2, color: TT.textSub, fontWeight: 700,
              borderRadius: 12, fontSize: 12, border: `1px solid ${TT.border}`, minHeight: 44, cursor: 'pointer',
            }}
          >
            <Send size={14} />
            {t('trainerClients.messageAll', 'Message All')}
          </button>
          <button
            onClick={() => { setBulkSelected(new Set()); setSelectMode(false); }}
            style={{
              padding: 8, color: TT.textMute, borderRadius: 10, background: 'transparent', border: 'none',
              minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
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
        <div
          role="dialog" aria-modal="true"
          onClick={() => setRemoveTarget(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: TT.surface, borderRadius: 18,
              width: '100%', maxWidth: 380, overflow: 'hidden', boxShadow: TT.shadowLg,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 20px 16px' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 999, background: TT.warnSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <AlertTriangle size={24} color={TT.warn} />
              </div>
              <h2 style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, textAlign: 'center', letterSpacing: -0.3 }}>
                {t('trainerClients.removeConfirmTitle', 'Remove Client')}
              </h2>
              <p style={{ fontSize: 13, color: TT.textMute, textAlign: 'center', marginTop: 8 }}>
                {t('trainerClients.removeConfirmDesc', 'Are you sure you want to remove {{name}} from your client list? This will not delete their account.', { name: removeTarget.full_name })}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 20px 20px' }}>
              <button
                onClick={() => setRemoveTarget(null)}
                style={{
                  flex: 1, padding: '12px 0', background: TT.surface2, color: TT.textSub,
                  fontWeight: 700, borderRadius: 12, fontSize: 14, border: 'none', minHeight: 48, cursor: 'pointer',
                }}
              >
                {t('trainerClients.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleRemoveClient}
                disabled={removingClient}
                style={{
                  flex: 1, padding: '12px 0', background: TT.warn, color: '#fff',
                  fontWeight: 800, borderRadius: 12, fontSize: 14, border: 'none', minHeight: 48,
                  cursor: removingClient ? 'default' : 'pointer', opacity: removingClient ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
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
        <div
          role="dialog" aria-modal="true"
          onClick={() => setBlockTarget(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: TT.surface, borderRadius: 18,
              width: '100%', maxWidth: 380, overflow: 'hidden', boxShadow: TT.shadowLg,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 20px 16px' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 999, background: TT.hotSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <ShieldBan size={24} color={TT.hot} />
              </div>
              <h2 style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, textAlign: 'center', letterSpacing: -0.3 }}>
                {t('trainerClients.blockConfirmTitle', 'Block Client')}
              </h2>
              <p style={{ fontSize: 13, color: TT.textMute, textAlign: 'center', marginTop: 8 }}>
                {t('trainerClients.blockConfirmDesc', 'Are you sure you want to block {{name}}? They will be removed from your client list and will not be able to send you messages.', { name: blockTarget.full_name })}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 20px 20px' }}>
              <button
                onClick={() => setBlockTarget(null)}
                style={{
                  flex: 1, padding: '12px 0', background: TT.surface2, color: TT.textSub,
                  fontWeight: 700, borderRadius: 12, fontSize: 14, border: 'none', minHeight: 48, cursor: 'pointer',
                }}
              >
                {t('trainerClients.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleBlockClient}
                disabled={blockingClient}
                style={{
                  flex: 1, padding: '12px 0', background: TT.hot, color: '#fff',
                  fontWeight: 800, borderRadius: 12, fontSize: 14, border: 'none', minHeight: 48,
                  cursor: blockingClient ? 'default' : 'pointer', opacity: blockingClient ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
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
