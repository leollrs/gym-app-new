import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { selectInBatches } from '../../lib/churn/batchedSelect';
import { readTrainerCache, writeTrainerCache } from '../../lib/trainerCache';
import { useNavigate } from 'react-router-dom';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { Users, X, Search, SortAsc, ExternalLink, UserPlus, Loader2, MessageSquare, MessageCircle, CheckSquare, Square, ClipboardList, Send, UserMinus, AlertTriangle, ShieldBan, MoreHorizontal, MoreVertical, Plus, SlidersHorizontal, RotateCcw, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { encryptMessage } from '../../lib/messageEncryption';
import { openWhatsApp, hasWhatsApp } from '../../lib/whatsapp';
import posthog from 'posthog-js';
import logger from '../../lib/logger';
import { formatDistanceToNow, subDays, startOfWeek } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import useFocusTrap from '../../hooks/useFocusTrap';
import Skeleton from '../../components/Skeleton';
import TrainerEmptyState from './components/TrainerEmptyState';
import { TT, TFont, statusTone, avatarIdx } from './components/designTokens';
import { TCard, TPill, TAvatar, TRing, TPrimaryButton, TIconButton } from './components/designPrimitives';
import { deriveClientStatus, weeklyAdherence } from '../../lib/clientStatus';

// ── Client quick-preview modal ──────────────────────────────────────────────
const ClientPreview = ({ client, churnScore, onClose, onOpen, onMessage, onRemove, onBlock }) => {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const focusTrapRef = useFocusTrap(true, onClose);

  // Same canonical model as the roster list + chips (lib/clientStatus) so the
  // preview never disagrees with the row that opened it.
  const status = deriveClientStatus({
    lastActiveAt: client.last_active_at,
    createdAt: client.created_at,
    churnScore: churnScore?.score,
    churnComputedAt: churnScore?.computed_at,
  });
  const statusLabel = {
    on_track: t('trainerClients.tabOnTrack', 'On track'),
    at_risk: t('trainerClients.tabAtRisk', 'At risk'),
    churn: t('trainerClients.tabChurn', 'Churn'),
    new: t('trainerClients.statusNew', 'New'),
  }[status];
  const statusPillTone = { on_track: 'good', at_risk: 'warn', churn: 'hot', new: 'teal' }[status];
  const statusDot = { on_track: TT.good, at_risk: TT.warn, churn: TT.hot, new: TT.accent }[status];

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
          <TPill tone={statusPillTone} size="m" style={{ marginTop: 6 }}>{statusLabel}</TPill>
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
            {churnScore && (status === 'churn' || status === 'at_risk') ? (
              <p style={{ ...statValueStyle, color: status === 'churn' ? TT.hot : TT.warnInk }}>
                {Math.round(churnScore.score)}%
              </p>
            ) : (
              <p style={{ ...statValueStyle, color: status === 'churn' || status === 'at_risk' ? TT.warnInk : TT.goodInk }}>
                {status === 'churn' || status === 'at_risk'
                  ? statusLabel
                  : t('trainerClients.low', 'Low')}
              </p>
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
  const { showToast } = useToast();
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [addedIds, setAddedIds] = useState(() => new Set());
  const [coachedIds, setCoachedIds] = useState(() => new Set());
  const debounceRef = useRef(null);
  const focusTrapRef = useFocusTrap(true, onClose);

  const searchMembers = useCallback(async (query) => {
    // Commas/parens break the PostgREST .or() filter grammar (they are its
    // delimiters) — strip them before interpolating so "Pérez, Ana (la de
    // CrossFit)" doesn't silently 400 into an empty list.
    const sanitized = query.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (sanitized.length < 2) {
      setMembers([]);
      setCoachedIds(new Set());
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    const pattern = `%${sanitized}%`;
    const { data, error } = await supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username')
      .eq('role', 'member')
      .or(`full_name.ilike.${pattern},username.ilike.${pattern}`)
      .order('full_name')
      .limit(50);
    if (error) logger.error('AddClientModal: failed to search members:', error);
    const rows = data || [];
    setMembers(rows);
    setLoadingMembers(false);

    // Informational "already has a coach" tag — best-effort batch check via
    // the 0530 RPC (trainer_clients RLS hides other trainers' rows, so a
    // direct select can't see them). On error: no tags, still addable.
    if (rows.length > 0) {
      const { data: coached, error: coachedErr } = await supabase
        .rpc('get_clients_with_other_trainer', { p_client_ids: rows.map(r => r.id) });
      if (coachedErr) {
        logger.warn('AddClientModal: other-trainer check unavailable:', coachedErr);
        setCoachedIds(new Set());
      } else {
        setCoachedIds(new Set((coached || []).map(r => r.client_id)));
      }
    } else {
      setCoachedIds(new Set());
    }
  }, []);

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
    // Keep just-added members visible (marked "Added") even after the parent
    // roster refresh folds them into existingClientIds.
    return members.filter(m => addedIds.has(m.id) || !excluded.has(m.id));
  }, [members, existingClientIds, addedIds]);

  const handleAdd = async (member) => {
    setAddingId(member.id);
    const { error } = await supabase.from('trainer_clients').upsert({
      trainer_id: trainerId,
      client_id: member.id,
      gym_id: gymId,
      is_active: true,
    }, { onConflict: 'trainer_id,client_id' });
    if (error) {
      logger.error('AddClientModal: failed to assign client:', error);
      showToast(t('trainerClients.addClientFailed', 'Could not add client. Try again.'), 'error');
    } else {
      posthog?.capture('trainer_client_added');
      setAddedIds(prev => new Set(prev).add(member.id));
      showToast(t('trainerClients.clientAdded', '{{name}} added to your clients', { name: member.full_name || '' }), 'success');
      // Refresh the roster behind the modal; modal stays open for multi-add.
      onAdded(member.id);
    }
    setAddingId(null);
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
            filtered.map(m => {
              const isAdded = addedIds.has(m.id);
              const hasCoach = coachedIds.has(m.id);
              return (
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {m.username && (
                        <p style={{ fontSize: 11, color: TT.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{m.username}</p>
                      )}
                      {hasCoach && !isAdded && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: TT.warnInk, background: TT.warnSoft,
                          borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                          {t('trainerClients.hasCoach', 'Has a coach')}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdded ? (
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                      borderRadius: 12, padding: '8px 12px', minHeight: 36,
                      background: TT.goodSoft, color: TT.goodInk, fontSize: 12, fontWeight: 700,
                    }}>
                      <Check size={14} strokeWidth={2.6} />
                      {t('trainerClients.added', 'Added')}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAdd(m)}
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
                  )}
                </div>
              );
            })
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
  const focusTrapRef = useFocusTrap(true, onClose);

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
    let successCount = 0;
    let failCount = 0;
    try {
      for (const c of selectedClients) {
        // Update the profile's assigned_program_id via secure RPC — the roster
        // labels/filters read assigned_program_id, so this is what makes the
        // assignment visible (mirrors TrainerClientDetail handleAssignProgram).
        const { error: rpcErr } = await supabase.rpc('trainer_assign_program', { p_member_id: c.id, p_program_id: selectedProgram });
        if (rpcErr) {
          logger.error('AssignProgram: RPC failed for client', c.id, rpcErr);
          failCount += 1;
          continue;
        }
        // Upsert enrollment. The conflict path (re-assigning a program the client
        // already enrolled in) is an UPDATE under RLS — policy ships in migration
        // 0526. Until it's applied, fall back to keeping the existing row
        // (ignoreDuplicates → ON CONFLICT DO NOTHING, insert-only RLS).
        const { error: enrollErr } = await supabase.from('gym_program_enrollments').upsert({
          program_id: selectedProgram,
          profile_id: c.id,
          gym_id: gymId,
          enrolled_at: new Date().toISOString(),
        }, { onConflict: 'program_id,profile_id' });
        if (enrollErr) {
          const { error: retryErr } = await supabase.from('gym_program_enrollments').upsert({
            program_id: selectedProgram,
            profile_id: c.id,
            gym_id: gymId,
          }, { onConflict: 'program_id,profile_id', ignoreDuplicates: true });
          if (retryErr) {
            // Enrollment never landed — this client is NOT assigned, count it
            // as a failure instead of toasting success.
            logger.error('AssignProgram: enrollment upsert failed for client', c.id, retryErr);
            failCount += 1;
            continue;
          }
        }
        successCount += 1;
      }

      if (successCount > 0) {
        posthog?.capture('trainer_program_assigned', { client_count: successCount });
      }
      if (failCount === 0) {
        showToast(t('trainerClients.programAssignedSuccess', 'Program assigned to {{count}} clients', { count: successCount }), 'success');
        onDone();
      } else if (successCount > 0) {
        showToast(t('trainerClients.programAssignedPartial', 'Assigned to {{success}} clients, {{failed}} failed', { success: successCount, failed: failCount }), 'warning');
        onDone();
      } else {
        showToast(t('trainerClients.programAssignFailed', 'Could not assign the program. Try again.'), 'error');
      }
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
              const { data: convId, error: convErr } = await supabase.rpc('get_or_create_conversation', { p_other_user: client.id });
              if (convErr || !convId) {
                logger.error('ComposeMessage: conversation failed for client', client.id, convErr);
                return false;
              }
              // A failed seed read MUST skip this client — encrypting with an
              // undefined seed produces ciphertext the recipient can't decrypt.
              const { data: conv, error: seedErr } = await supabase
                .from('conversations')
                .select('encryption_seed')
                .eq('id', convId)
                .single();
              if (seedErr) {
                logger.error('ComposeMessage: seed fetch failed for client', client.id, seedErr);
                return false;
              }
              const encrypted = await encryptMessage(text, convId, conv?.encryption_seed);
              const { error: insertErr } = await supabase.from('direct_messages').insert({
                conversation_id: convId,
                sender_id: senderId,
                body: encrypted,
              });
              if (insertErr) {
                logger.error('ComposeMessage: insert failed for client', client.id, insertErr);
                return false;
              }
              // Reorder the recipient's/our thread list (same as the thread composer).
              const { error: bumpErr } = await supabase
                .from('conversations')
                .update({ last_message_at: new Date().toISOString() })
                .eq('id', convId);
              if (bumpErr) logger.warn('ComposeMessage: last_message_at bump failed', convId, bumpErr);
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

      if (successCount === 0) {
        showToast(t('trainerClients.messageSendFailed', 'Could not send messages. Try again.'), 'error');
        return; // keep the modal open so the trainer can retry
      }
      if (failCount > 0) {
        showToast(
          t('trainerClients.messageSentPartial', '{{success}} sent · {{failed}} failed', { success: successCount, failed: failCount }),
          'warning'
        );
      } else {
        showToast(t('trainerClients.messageSentSuccess', 'Sent to {{count}}', { count: successCount }), 'success');
      }
      onDone();
    } catch (err) {
      logger.error('ComposeMessage: error', err);
      showToast(t('trainerClients.messageSendFailed', 'Could not send messages. Try again.'), 'error');
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
            maxLength={1400}
            style={{
              width: '100%', background: TT.surface2, border: `1px solid ${TT.borderSolid}`,
              borderRadius: 12, padding: '12px 14px', fontSize: 13, color: TT.text,
              outline: 'none', resize: 'none', minHeight: 90, fontFamily: 'inherit',
            }}
          />
          {/* The ciphertext CHECK on direct_messages.body is ≤2000 chars
              (≈1450 plaintext) — 1400 keeps every send under it, same cap as
              the thread composer. */}
          <p style={{
            marginTop: 4, fontSize: 11, textAlign: 'right',
            color: message.length >= 1300 ? TT.warnInk : TT.textMute,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {message.length}/1400
          </p>
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
// Status filters map 1:1 to deriveClientStatus() values (lib/clientStatus) so
// every chip count equals what its filter shows.
const STATUS_FILTERS = ['on_track', 'at_risk', 'churn', 'new'];
const SORT_KEYS = ['last_active', 'name', 'workouts'];
const SORT_DEFAULTS = { last_active: 'Last active', name: 'Name', workouts: 'Workouts' };

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerClients() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const { showToast } = useToast();
  // Instant-load cache so returning to the list doesn't flash a spinner.
  const clientsCacheKey = `clients:${profile?.id || 'x'}`;
  const clientsCache = useMemo(() => readTrainerCache(clientsCacheKey), [clientsCacheKey]);
  const [clients,  setClients]  = useState(() => clientsCache?.clients || []);
  const [loading,  setLoading]  = useState(!clientsCache);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sortBy,   setSortBy]   = useState('last_active');
  const [churnScores, setChurnScores] = useState(() => clientsCache?.churnScores || {});
  const [showAddClient, setShowAddClient] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Removed (is_active=false) clients — loaded on demand for the chip
  const [removedClients, setRemovedClients] = useState(null); // null = not loaded yet
  const [removedLoading, setRemovedLoading] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
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
  const removeTrapRef = useFocusTrap(!!removeTarget, () => setRemoveTarget(null));
  const blockTrapRef = useFocusTrap(!!blockTarget, () => setBlockTarget(null));

  const handleMessageClient = async (clientId) => {
    const { data: convId, error } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
    if (error || !convId) {
      logger.error('Error opening conversation:', error);
      showToast(t('trainerClients.messageError', 'Could not open conversation'), 'error');
      return;
    }
    navigate(`/trainer/messages/${convId}`);
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
      showToast(t('trainerClients.removeFailed', 'Could not remove client. Try again.'), 'error');
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
      const { error: deactivateErr } = await supabase
        .from('trainer_clients')
        .update({ is_active: false })
        .eq('trainer_id', profile.id)
        .eq('client_id', blockTarget.id);
      if (deactivateErr) throw deactivateErr;
      setClients(prev => prev.filter(c => c.id !== blockTarget.id));
      showToast(t('trainerClients.clientBlocked', '{{name}} has been blocked', { name: blockTarget.full_name }), 'success');
    } catch (err) {
      logger.error('BlockClient: error', err);
      showToast(t('trainerClients.blockFailed', 'Could not block client. Try again.'), 'error');
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

  // Composed in code — the old trainerClients.pageTitle JSON value hardcoded
  // "TuGymPR", so white-label gyms never saw their own name in the tab.
  useEffect(() => { document.title = `${t('trainerClients.title', 'Clients')} · ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    const load = async () => {
      // Spinner only on a true cold load; with cache present, keep the list on
      // screen and revalidate silently so revisiting is instant.
      if (!readTrainerCache(clientsCacheKey)) setLoading(true);
      const fourteenDaysAgo = subDays(new Date(), 14).toISOString();

      // Fetch only assigned clients via trainer_clients join
      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select(`
          client_id,
          profiles!trainer_clients_client_id_fkey (
            id, full_name, username, avatar_url, last_active_at, created_at, assigned_program_id, phone_number, membership_status
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
        (ids) => supabase.from('workout_sessions').select('profile_id, started_at')
          .in('profile_id', ids).eq('status', 'completed').gte('started_at', fourteenDaysAgo),
        clientIds,
      );
      if (recSessError) logger.error('TrainerClients: failed to load recent sessions:', recSessError);

      const weekStartMs = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
      const recentCounts = {};
      const weekCounts = {};
      (recentSessions || []).forEach(s => {
        recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1;
        if (s.started_at && new Date(s.started_at).getTime() >= weekStartMs) {
          weekCounts[s.profile_id] = (weekCounts[s.profile_id] || 0) + 1;
        }
      });

      // Plan days/week for the adherence ring — real target per client
      // (member_onboarding trainer read policy: onboarding_trainer_read, 0002).
      const { data: onboardingRows, error: onboardingError } = await selectInBatches(
        (ids) => supabase.from('member_onboarding').select('profile_id, training_days_per_week')
          .in('profile_id', ids),
        clientIds,
      );
      if (onboardingError) logger.error('TrainerClients: failed to load training days:', onboardingError);
      const planDaysMap = {};
      (onboardingRows || []).forEach(r => { planDaysMap[r.profile_id] = r.training_days_per_week; });

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

      setClients(assignedClients.map(m => ({
        ...m,
        recentWorkouts: recentCounts[m.id] ?? 0,
        weekSessions: weekCounts[m.id] ?? 0,
        planDaysPerWeek: planDaysMap[m.id] ?? null,
      })));
      setLoading(false);
    };
    load();
  }, [profile?.gym_id, profile?.id, reloadKey]);

  // Write-through cache for instant loads on the next visit.
  useEffect(() => {
    if (loading) return;
    writeTrainerCache(clientsCacheKey, { clients, churnScores });
  }, [loading, clients, churnScores, clientsCacheKey]);

  // ── Removed clients (is_active = false) — fetched when the chip is opened ──
  useEffect(() => {
    if (filter !== 'removed' || !profile?.id) return undefined;
    let cancelled = false;
    const loadRemoved = async () => {
      setRemovedLoading(true);
      const { data: rows, error } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('trainer_id', profile.id)
        .eq('is_active', false);
      if (error) {
        logger.error('TrainerClients: failed to load removed clients:', error);
        if (!cancelled) { setRemovedClients([]); setRemovedLoading(false); }
        return;
      }
      const ids = (rows || []).map(r => r.client_id);
      if (ids.length === 0) {
        if (!cancelled) { setRemovedClients([]); setRemovedLoading(false); }
        return;
      }
      // The full-PII profiles policy only covers ACTIVE clients (is_trainer_of),
      // so resolve removed clients' names through the same-gym safe view.
      const { data: profs, error: profErr } = await selectInBatches(
        (batch) => supabase.from('gym_member_profiles_safe')
          .select('id, full_name, username, avatar_url, last_active_at, created_at')
          .in('id', batch),
        ids,
      );
      if (profErr) logger.error('TrainerClients: failed to load removed client profiles:', profErr);
      const byId = {};
      (profs || []).forEach(p => { byId[p.id] = p; });
      if (!cancelled) {
        setRemovedClients(ids.map(id => byId[id] || { id, full_name: null }));
        setRemovedLoading(false);
      }
    };
    loadRemoved();
    return () => { cancelled = true; };
  }, [filter, profile?.id, reloadKey]);

  const handleRestoreClient = async (client) => {
    setRestoringId(client.id);
    const { error } = await supabase
      .from('trainer_clients')
      .update({ is_active: true })
      .eq('trainer_id', profile.id)
      .eq('client_id', client.id);
    if (error) {
      logger.error('RestoreClient: error', error);
      showToast(t('trainerClients.restoreFailed', 'Could not restore the client. Try again.'), 'error');
    } else {
      setRemovedClients(prev => (prev || []).filter(c => c.id !== client.id));
      setReloadKey(k => k + 1);
      showToast(t('trainerClients.restored', '{{name}} is back on your roster', { name: client.full_name || '' }), 'success');
    }
    setRestoringId(null);
  };

  // ── Canonical status per client (single model: lib/clientStatus) ──────────
  const statusById = useMemo(() => {
    const map = {};
    clients.forEach(c => {
      const churn = churnScores[c.id];
      map[c.id] = deriveClientStatus({
        lastActiveAt: c.last_active_at,
        createdAt: c.created_at,
        churnScore: churn?.score,
        churnComputedAt: churn?.computed_at, // stale scores are ignored by the helper
      });
    });
    return map;
  }, [clients, churnScores]);

  // Client-side search, filter, sort
  const filtered = useMemo(() => {
    let list = filter === 'removed' ? [...(removedClients || [])] : [...clients];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.full_name?.toLowerCase().includes(q) ||
        c.username?.toLowerCase().includes(q)
      );
    }

    // Filter — status chips use the SAME predicate as their counts
    if (STATUS_FILTERS.includes(filter)) {
      list = list.filter(c => statusById[c.id] === filter);
    } else if (filter === 'has_program') {
      list = list.filter(c => c.assigned_program_id);
    } else if (filter === 'no_program') {
      list = list.filter(c => !c.assigned_program_id);
    }

    // Sort
    if (sortBy === 'name') {
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    } else if (sortBy === 'workouts') {
      list.sort((a, b) => (b.recentWorkouts || 0) - (a.recentWorkouts || 0));
    } else {
      list.sort((a, b) => {
        const aT = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
        const bT = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
        return bT - aT;
      });
    }

    return list;
  }, [clients, removedClients, search, filter, sortBy, statusById]);

  // Chip counts derive from statusById — by construction they always equal
  // what the chip's filter lists.
  const statusCount = (key) => clients.reduce((n, c) => n + (statusById[c.id] === key ? 1 : 0), 0);
  const STATUS_CHIPS = [
    { id: 'all',         label: t('trainerClients.tabAll', 'All'),               count: clients.length },
    { id: 'on_track',    label: t('trainerClients.tabOnTrack', 'On track'),      count: statusCount('on_track') },
    { id: 'at_risk',     label: t('trainerClients.tabAtRisk', 'At risk'),        count: statusCount('at_risk') },
    { id: 'churn',       label: t('trainerClients.tabChurn', 'Churn'),           count: statusCount('churn') },
    { id: 'new',         label: t('trainerClients.tabNew', 'New'),               count: statusCount('new') },
    { id: 'no_program',  label: t('trainerClients.tabNoPlan', 'No plan'),        count: clients.filter(c => !c.assigned_program_id).length },
    { id: 'has_program', label: t('trainerClients.tabHasProgram', 'On program'), count: clients.filter(c => c.assigned_program_id).length },
    { id: 'removed',     label: t('trainerClients.tabRemoved', 'Removed'),       count: removedClients ? removedClients.length : null },
  ];

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }} className="pb-2">
      <style>{`
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div style={{ padding: '8px 20px 12px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
          <div style={{ fontFamily: TFont.display, fontSize: 30, fontWeight: 800, color: TT.text, letterSpacing: -1, lineHeight: 1 }}>
            {t('trainerClients.title', 'Clients')}
          </div>
          <TPrimaryButton
            onClick={() => setShowAddClient(true)}
            aria-label={t('trainerClients.addClient', 'Add Client')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px' }}
          >
            <Plus size={16} strokeWidth={2.4} />
            {t('trainerClients.add', 'Add')}
          </TPrimaryButton>
        </div>

        {/* Search + sort + select row */}
        {!loading && (clients.length > 0 || filter === 'removed') && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div
              style={{
                flex: 1, minWidth: 0, height: 46, background: TT.surface, borderRadius: 14,
                boxShadow: 'inset 0 0 0 1px var(--tt-border)',
                display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px',
              }}
            >
              <Search size={17} color={TT.textMute} strokeWidth={2} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('trainerClients.searchPlaceholder', 'Search clients…')}
                aria-label={t('trainerClients.searchClients', 'Search clients')}
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 14, color: TT.text, minWidth: 0,
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
              className="tt-tap"
              style={{
                // Shrinkable (minWidth 0 + ellipsis) — a long locale label
                // ("Última actividad") must never push the select button
                // off-screen.
                display: 'flex', alignItems: 'center', gap: 6,
                height: 46, padding: '0 13px', borderRadius: 14,
                background: TT.surface, boxShadow: 'inset 0 0 0 1px var(--tt-border)',
                color: TT.text, fontSize: 12.5, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
                flexShrink: 1, minWidth: 0,
              }}
            >
              <SortAsc size={15} style={{ color: TT.text, flexShrink: 0 }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t(`trainerClients.sort_${sortBy}`, SORT_DEFAULTS[sortBy] || sortBy)}
              </span>
            </button>
            <TIconButton
              size={46}
              ariaLabel={selectMode ? t('trainerClients.exitSelect', 'Exit select') : t('trainerClients.selectClients', 'Select clients')}
              onClick={() => {
                if (selectMode) { setSelectMode(false); setBulkSelected(new Set()); }
                else setSelectMode(true);
              }}
              style={selectMode
                ? { background: TT.accentSoft, border: 'none', boxShadow: `inset 0 0 0 1px ${TT.accent}`, flexShrink: 0 }
                : { background: TT.surface, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', flexShrink: 0 }}
            >
              <SlidersHorizontal size={17} color={selectMode ? TT.accentInk : TT.text} />
            </TIconButton>
          </div>
        )}

        {/* Filter chips */}
        {!loading && (clients.length > 0 || filter === 'removed') && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto' }} className="scrollbar-hide">
            {STATUS_CHIPS.map((chip) => {
              const isOn = filter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilter(chip.id)}
                  className="tt-tap"
                  style={{
                    padding: '8px 14px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                    fontFamily: TFont.display, fontSize: 12.5, fontWeight: 700, border: 'none',
                    background: isOn ? TT.text : TT.surface,
                    color: isOn ? TT.onInverse : TT.textSub,
                    boxShadow: isOn ? 'none' : 'inset 0 0 0 1px var(--tt-border)',
                    cursor: 'pointer',
                  }}
                >
                  {chip.label}{chip.count != null ? ` ${chip.count}` : ''}
                </button>
              );
            })}
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
        ) : filter === 'removed' ? (
          removedLoading || removedClients === null ? (
            <div className="space-y-3 py-2">
              <Skeleton variant="list-item" />
              <Skeleton variant="list-item" />
            </div>
          ) : filtered.length === 0 ? (
            <TrainerEmptyState
              icon={Users}
              title={t('trainerClients.noRemovedClients', 'No removed clients')}
              description={t('trainerClients.noRemovedDesc', 'Clients you remove land here so you can bring them back anytime.')}
              actionLabel={t('trainerClients.clearFilters', 'Clear filters')}
              onAction={() => { setSearch(''); setFilter('all'); }}
              compact
            />
          ) : (
            <TCard padded={0} style={{ overflow: 'hidden' }}>
              {filtered.map((c, idx) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 13,
                    padding: '13px 15px',
                    borderTop: idx > 0 ? '1px solid var(--tt-border)' : 'none',
                  }}
                >
                  <TAvatar name={c.full_name || '?'} size={42} idx={avatarIdx(c.id)} src={c.avatar_url} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.full_name || t('trainerClients.formerClient', 'Former client')}
                    </div>
                    <div style={{ fontSize: 12, color: TT.textSub, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t('trainerClients.removedTag', 'Removed')}
                      {c.last_active_at
                        ? ` · ${formatDistanceToNow(new Date(c.last_active_at), { addSuffix: true, locale: dateFnsLocale })}`
                        : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestoreClient(c)}
                    disabled={restoringId === c.id}
                    className="tt-tap"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                      padding: '9px 13px', borderRadius: 12, border: 'none',
                      background: TT.accentSoft, color: TT.accentInk,
                      fontWeight: 700, fontSize: 12.5, minHeight: 44,
                      cursor: restoringId === c.id ? 'default' : 'pointer',
                      opacity: restoringId === c.id ? 0.6 : 1,
                    }}
                  >
                    {restoringId === c.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RotateCcw size={14} strokeWidth={2.4} />
                    )}
                    {t('trainerClients.restore', 'Restore')}
                  </button>
                </div>
              ))}
            </TCard>
          )
        ) : clients.length === 0 ? (
          <>
            <TrainerEmptyState
              icon={Users}
              title={t('trainerClients.noClients', 'No clients assigned yet')}
              description={t('trainerClients.emptyDesc', 'Add a client from your gym roster to start tracking their journey.')}
              actionLabel={t('trainerClients.addFirstClient', 'Add your first client')}
              actionIcon={UserPlus}
              onAction={() => setShowAddClient(true)}
            />
            <button
              type="button"
              onClick={() => setFilter('removed')}
              className="tt-tap"
              style={{
                display: 'block', margin: '10px auto 0', padding: '10px 14px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12.5, fontWeight: 700, color: TT.textMute, textDecoration: 'underline',
              }}
            >
              {t('trainerClients.viewRemoved', 'View removed clients')}
            </button>
          </>
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
          <TCard padded={0} style={{ overflow: 'hidden' }}>
            {filtered.map((c, idx) => {
              const status = statusById[c.id];
              const tone = statusTone(status);
              const churn = churnScores[c.id];
              // Real weekly compliance: sessions this week vs the client's own
              // plan days/week (member_onboarding), not a hardcoded /6.
              const adherence = weeklyAdherence(c.weekSessions, c.planDaysPerWeek);
              const membershipFlag = c.membership_status && c.membership_status !== 'active'
                ? ({
                    frozen: t('trainerClients.membershipPaused', 'Paused'),
                    cancelled: t('trainerClients.membershipCancelled', 'Cancelled'),
                  }[c.membership_status] || t('trainerClients.membershipInactive', 'Inactive'))
                : null;
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
              const openOptions = (e) => {
                e.stopPropagation();
                e.preventDefault();
                setSelected(c);
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
                  className="tt-tap"
                  style={{
                    background: isSelected ? TT.accentSoft : 'transparent',
                    border: 'none',
                    borderTop: idx > 0 ? '1px solid var(--tt-border)' : 'none',
                    padding: '13px 15px',
                    color: TT.text,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 13,
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {selectMode && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); toggleBulkSelect(c.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggleBulkSelect(c.id); } }}
                      aria-label={t('trainerClients.selectClient', 'Select')}
                      style={{
                        minWidth: 28, minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 8, background: 'transparent', cursor: 'pointer',
                        flexShrink: 0, color: isSelected ? TT.accent : TT.textMute,
                        animation: 'slideInLeft 0.15s ease-out',
                      }}
                    >
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </span>
                  )}
                  <TAvatar name={c.full_name || '?'} size={42} idx={avatarIdx(c.id)} src={c.avatar_url} />
                  {/* Name + (pills · subtitle) live in the one column that is
                      allowed to shrink — pills can never push the name off
                      screen or shove the trailing controls past the edge. */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.full_name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 }}>
                      {membershipFlag && (
                        <TPill tone="warn" size="s" style={{ flexShrink: 0 }}>{membershipFlag}</TPill>
                      )}
                      {status === 'churn' && (
                        <TPill tone="hot" size="s" style={{ flexShrink: 0 }}>
                          {churn ? `${Math.round(churn.score)}%` : t('trainerClients.churnPill', 'Churn')}
                        </TPill>
                      )}
                      {status === 'at_risk' && (
                        <TPill tone="warn" size="s" style={{ flexShrink: 0 }}>
                          {churn ? `${Math.round(churn.score)}%` : t('trainerClients.riskPill', 'Risk')}
                        </TPill>
                      )}
                      {status === 'new' && (
                        <TPill tone="teal" size="s" style={{ flexShrink: 0 }}>{t('trainerClients.statusNew', 'New')}</TPill>
                      )}
                      <span style={{ fontSize: 12, color: TT.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                        {programLabel} · {lastActiveLabel}
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
                        width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                        background: '#25D366', color: '#fff',
                        display: 'grid', placeItems: 'center', cursor: 'pointer',
                      }}
                    >
                      <MessageCircle size={16} strokeWidth={2.4} />
                    </span>
                  )}
                  <TRing
                    value={adherence.target ? adherence.done / adherence.target : 0}
                    size={40} stroke={4} color={tone}
                    label={`${adherence.done}/${adherence.target}`}
                  />
                  {!selectMode && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={openOptions}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openOptions(e); }}
                      aria-label={t('trainerClients.moreOptions', 'More options')}
                      style={{
                        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                        marginLeft: -4, color: TT.textMute,
                        display: 'grid', placeItems: 'center', cursor: 'pointer',
                      }}
                    >
                      <MoreVertical size={17} strokeWidth={2.2} />
                    </span>
                  )}
                </motion.button>
              );
            })}
          </TCard>
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
          // Stays open for multi-add — each add just refreshes the roster
          onAdded={() => setReloadKey(k => k + 1)}
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
            ref={removeTrapRef}
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
            ref={blockTrapRef}
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
