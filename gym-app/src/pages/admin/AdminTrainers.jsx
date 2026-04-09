import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, ChevronDown, UserPlus, X, Search, Plus, Download,
  ClipboardList, BarChart3, ArrowRightLeft, Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format, subDays } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { PageHeader, AdminCard, Avatar, SectionLabel, ErrorCard, Skeleton, AdminTabs, AdminModal } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import AddTrainerModal from './components/AddTrainerModal';
import ConfirmDemoteModal from './components/ConfirmDemoteModal';

// ── Fetch function ────────────────────────────────────────────────────────

const fetchTrainerData = async (gymId) => {
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const results = await Promise.allSettled([
    supabase.from('profiles').select('id, full_name, username, created_at').eq('gym_id', gymId).eq('role', 'trainer'),
    supabase.from('trainer_clients').select('trainer_id, client_id, is_active, notes, assigned_at').eq('gym_id', gymId),
    supabase.from('workout_sessions').select('profile_id').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', thirtyDaysAgo),
    supabase.from('profiles').select('id, full_name, username').eq('gym_id', gymId).eq('role', 'member'),
    supabase.from('churn_risk_scores').select('profile_id, score, risk_tier').eq('gym_id', gymId),
  ]);

  const extract = (r) => (r.status === 'fulfilled' ? r.value?.data ?? [] : []);
  const trainerRows = extract(results[0]);
  const tcRows = extract(results[1]);
  const recentSessions = extract(results[2]);
  const memberRows = extract(results[3]);
  const churnRows = extract(results[4]);

  const members = memberRows || [];

  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });

  const churnMap = {};
  (churnRows || []).forEach(r => { churnMap[r.profile_id] = r; });

  const activeMembers = new Set();
  const sessionCountMap = {};
  (recentSessions || []).forEach(s => {
    activeMembers.add(s.profile_id);
    sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1;
  });

  const relationships = tcRows || [];
  const clientMap = {};

  const trainers = (trainerRows || []).map(t => {
    const clients = relationships.filter(tc => tc.trainer_id === t.id);
    const activeClients = clients.filter(tc => tc.is_active);
    const clientCount = activeClients.length;

    clientMap[t.id] = activeClients.map(tc => {
      const member = memberMap[tc.client_id];
      const churn = churnMap[tc.client_id];
      return {
        id: tc.client_id,
        name: member?.full_name || 'Unknown',
        username: member?.username || '',
        sessions30d: sessionCountMap[tc.client_id] || 0,
        isActive: activeMembers.has(tc.client_id),
        churnScore: churn?.score ?? null,
        churnTier: churn?.risk_tier ?? null,
        assignedAt: tc.assigned_at,
        notes: tc.notes,
      };
    });

    const clientsWithWorkout = activeClients.filter(tc => activeMembers.has(tc.client_id)).length;
    const retention = clientCount > 0 ? Math.round((clientsWithWorkout / clientCount) * 100) : 0;
    const totalClientSessions = activeClients.reduce((sum, tc) => sum + (sessionCountMap[tc.client_id] || 0), 0);
    const avgWorkouts = clientCount > 0 ? (totalClientSessions / clientCount / 4.33).toFixed(1) : '0.0';

    return {
      id: t.id,
      name: t.full_name || 'Unnamed',
      username: t.username || '',
      createdAt: t.created_at,
      clientCount,
      retention,
      avgWorkouts,
      totalSessions: totalClientSessions,
    };
  });

  trainers.sort((a, b) => b.clientCount - a.clientCount);

  return { trainers, clientMap, allMembers: members };
};

// ── Helpers ───────────────────────────────────────────────────────────────

const tierColor = (tier) => {
  if (tier === 'critical') return { text: '#DC2626', bg: 'bg-red-500/10' };
  if (tier === 'high') return { text: '#EF4444', bg: 'bg-red-400/10' };
  if (tier === 'medium') return { text: '#F59E0B', bg: 'bg-amber-400/10' };
  return { text: '#10B981', bg: 'bg-emerald-400/10' };
};

// ── MAIN ──────────────────────────────────────────────────────────────────

export default function AdminTrainers() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const { showToast } = useToast();

  useEffect(() => { document.title = t('admin.trainers.pageTitle', 'Admin - Trainers | TuGymPR'); }, [t]);

  const [trainersTab, setTrainersTab]   = useState('roster');
  const [expanded, setExpanded]         = useState(null);
  const [showAssign, setShowAssign]     = useState(null);
  const [search, setSearch]             = useState('');
  const [assigning, setAssigning]       = useState(false);
  const [showAddTrainer, setShowAddTrainer] = useState(false);
  const [confirmDemote, setConfirmDemote]   = useState(null);
  const [confirmUnassign, setConfirmUnassign] = useState(null); // { trainerId, clientId, clientName }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: adminKeys.trainers(gymId),
    queryFn: () => fetchTrainerData(gymId),
    enabled: !!gymId,
  });

  const trainers   = data?.trainers ?? [];
  const clientMap  = data?.clientMap ?? {};
  const allMembers = data?.allMembers ?? [];

  // Assign a member to a trainer
  const assignClient = async (trainerId, memberId) => {
    setAssigning(true);
    try {
      const { error } = await supabase.from('trainer_clients').upsert({
        trainer_id: trainerId,
        client_id: memberId,
        gym_id: gymId,
        is_active: true,
      }, { onConflict: 'trainer_id,client_id' });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.assignError', 'Failed to assign client'), 'error');
    } finally {
      setAssigning(false);
    }
  };

  // Unassign a client from a trainer
  const unassignClient = async (trainerId, clientId) => {
    try {
      const { error } = await supabase
        .from('trainer_clients')
        .update({ is_active: false })
        .eq('trainer_id', trainerId)
        .eq('client_id', clientId)
        .eq('gym_id', gymId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.unassignError', 'Failed to unassign client'), 'error');
    }
  };

  // Promote a member to trainer role
  const promoteToTrainer = async (memberId) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'trainer' })
        .eq('id', memberId)
        .eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('add_trainer', 'trainer', memberId);
      setShowAddTrainer(false);
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.promoteError', 'Failed to promote member'), 'error');
    }
  };

  // Demote trainer back to member
  const demoteToMember = async (trainerId) => {
    try {
      const { error: deactivateErr } = await supabase
        .from('trainer_clients')
        .update({ is_active: false })
        .eq('trainer_id', trainerId)
        .eq('gym_id', gymId);
      if (deactivateErr) throw deactivateErr;
      const { error: demoteErr } = await supabase
        .from('profiles')
        .update({ role: 'member' })
        .eq('id', trainerId)
        .eq('gym_id', gymId);
      if (demoteErr) throw demoteErr;
      logAdminAction('demote_trainer', 'trainer', trainerId);
      setConfirmDemote(null);
      setExpanded(null);
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.demoteError', 'Failed to demote trainer'), 'error');
    }
  };

  // Members not assigned to this trainer
  const unassignedMembers = (trainerId) => {
    const assigned = new Set((clientMap[trainerId] || []).map(c => c.id));
    return allMembers.filter(m =>
      !assigned.has(m.id) &&
      (m.full_name?.toLowerCase().includes(search.toLowerCase()) || m.username?.toLowerCase().includes(search.toLowerCase()))
    );
  };

  const handleExport = () => {
    const rows = [];
    trainers.forEach(tr => {
      (clientMap[tr.id] || []).forEach(c => {
        rows.push({
          trainer: tr.name,
          client: c.name,
          username: c.username,
          sessions30d: c.sessions30d,
          churnScore: c.churnScore ?? '',
          churnTier: c.churnTier ?? '',
        });
      });
    });
    exportCSV({
      filename: 'trainers',
      columns: [
        { key: 'trainer', label: t('admin.trainers.csvTrainer') },
        { key: 'client', label: t('admin.trainers.csvClient') },
        { key: 'email', label: t('admin.trainers.csvEmail') },
        { key: 'sessions30d', label: t('admin.trainers.csvSessions30d') },
        { key: 'churnScore', label: t('admin.trainers.csvChurnScore') },
        { key: 'churnTier', label: t('admin.trainers.csvChurnTier') },
      ],
      data: rows,
    });
  };

  const demoteTrainer = confirmDemote ? trainers.find(tr => tr.id === confirmDemote) : null;
  const demoteClientCount = confirmDemote ? (clientMap[confirmDemote] || []).length : 0;

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto overflow-x-hidden">
      <PageHeader
        title={t('admin.trainers.title')}
        subtitle={t('admin.trainers.subtitle')}
        className="mb-6"
        actions={
          <>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap"
            >
              <Download size={13} />
              {t('admin.trainers.export')}
            </button>
            <button
              onClick={() => setShowAddTrainer(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-[#D4AF37] text-[#0A0D14] hover:bg-[#E5C44D] transition-colors whitespace-nowrap"
            >
              <Plus size={13} />
              {t('admin.trainers.addTrainer')}
            </button>
          </>
        }
      />

      {/* Top metrics row */}
      {!isLoading && !error && trainers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          {[
            { label: t('admin.trainers.totalTrainers', 'Total Trainers'), value: trainers.length, color: '#D4AF37' },
            { label: t('admin.trainers.totalClients', 'Assigned Clients'), value: trainers.reduce((s, tr) => s + tr.clientCount, 0), color: '#3B82F6' },
            { label: t('admin.trainers.avgClientsPerTrainer', 'Avg Clients / Trainer'), value: trainers.length > 0 ? (trainers.reduce((s, tr) => s + tr.clientCount, 0) / trainers.length).toFixed(1) : '0', color: '#10B981' },
          ].map((s, i) => (
            <AdminCard key={i} hover borderLeft={s.color}>
              <p className="text-[18px] md:text-[22px] font-bold text-[#E5E7EB] leading-none tabular-nums truncate">{s.value}</p>
              <p className="text-[11px] md:text-[11px] text-[#9CA3AF] mt-1 truncate">{s.label}</p>
            </AdminCard>
          ))}
        </div>
      )}

      {/* No tabs — single view */}

      {isLoading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <ErrorCard message={t('admin.trainers.loadError')} onRetry={refetch} />
      ) : trainers.length === 0 ? (
        <AdminCard className="p-12 text-center">
          <Users size={28} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#9CA3AF] font-medium">{t('admin.trainers.emptyTitle')}</p>
          <p className="text-[12px] text-[#6B7280] mt-1">{t('admin.trainers.emptyDesc')}</p>
          <button
            onClick={() => setShowAddTrainer(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37] text-[#0A0D14] hover:bg-[#E5C44D] transition-colors whitespace-nowrap"
          >
            <Plus size={13} />
            {t('admin.trainers.addTrainer')}
          </button>
        </AdminCard>
      ) : (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {trainers.map(tr => {
                const isExpanded = expanded === tr.id;
                const clients = clientMap[tr.id] || [];
                const atRiskCount = clients.filter(c => c.churnTier === 'critical' || c.churnTier === 'high').length;
                return (
                  <AdminCard key={tr.id} hover padding="p-0" className="overflow-hidden">
                    {/* Trainer header */}
                    <div
                      className="flex items-center gap-3 px-5 py-4 cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : tr.id)}
                    >
                      <Avatar name={tr.name} size="md" variant="accent" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{tr.name}</p>
                        {tr.username && <p className="text-[11px] text-[#6B7280] truncate">@{tr.username}</p>}
                      </div>
                      <div className="flex items-center gap-3 md:gap-4 mr-2">
                        <div className="text-center min-w-[36px]">
                          <p className="text-[16px] md:text-[18px] font-bold text-[#E5E7EB] leading-none tabular-nums">{tr.clientCount}</p>
                          <p className="text-[9px] md:text-[10px] text-[#6B7280] mt-1">{t('admin.trainers.clients', 'Clientes')}</p>
                        </div>
                        <div className="text-center min-w-[36px]">
                          <p className="text-[16px] md:text-[18px] font-bold text-[#10B981] leading-none tabular-nums">{tr.retention}%</p>
                          <p className="text-[9px] md:text-[10px] text-[#6B7280] mt-1">{t('admin.trainers.retention', 'Retención')}</p>
                        </div>
                        {atRiskCount > 0 && (
                          <div className="text-center min-w-[36px]">
                            <p className="text-[16px] md:text-[18px] font-bold text-[#EF4444] leading-none tabular-nums">{atRiskCount}</p>
                            <p className="text-[9px] md:text-[10px] text-[#6B7280] mt-1">{t('admin.trainers.atRisk', 'En Riesgo')}</p>
                          </div>
                        )}
                      </div>
                      <ChevronDown size={16} className={`text-[#6B7280] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>

                    {/* Expanded: client list */}
                    <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                      <div className="overflow-hidden">
                        <div className="px-4 pb-4 border-t border-white/6">
                          <div className="flex items-center justify-between mt-3 mb-2">
                            <SectionLabel>{t('admin.trainers.clientsCount', { count: clients.length })}</SectionLabel>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDemote(tr.id); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap"
                                style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                              >
                                <X size={12} />
                                {t('admin.trainers.removeTrainer')}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowAssign(showAssign === tr.id ? null : tr.id); setSearch(''); }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#D4AF37]/10 text-[#D4AF37] hover:bg-[#D4AF37]/20 transition-colors whitespace-nowrap"
                              >
                                <UserPlus size={12} />
                                {t('admin.trainers.assignClient')}
                              </button>
                            </div>
                          </div>

                          {/* Assign client dropdown */}
                          {showAssign === tr.id && (
                            <div className="mb-3 bg-[#111827] border border-white/8 rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Search size={13} className="text-[#6B7280]" />
                                <input
                                  type="text"
                                  value={search}
                                  onChange={e => setSearch(e.target.value)}
                                  placeholder={t('admin.trainers.searchMembers')}
                                  aria-label={t('admin.trainers.searchMembers')}
                                  className="flex-1 bg-transparent text-[12px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none"
                                  autoFocus
                                />
                                <button onClick={() => setShowAssign(null)} aria-label={t('admin.trainers.closeMemberSearch')} className="text-[#6B7280] hover:text-[#9CA3AF] min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                                  <X size={14} />
                                </button>
                              </div>
                              <div className="max-h-40 overflow-y-auto space-y-0.5">
                                {unassignedMembers(tr.id).slice(0, 20).map(m => (
                                  <button
                                    key={m.id}
                                    disabled={assigning}
                                    onClick={() => assignClient(tr.id, m.id)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-white/5 transition-colors disabled:opacity-50"
                                  >
                                    <Avatar name={m.full_name} size="sm" variant="neutral" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] text-[#E5E7EB] truncate">{m.full_name}</p>
                                      {m.username && <p className="text-[10px] text-[#6B7280] truncate">@{m.username}</p>}
                                    </div>
                                    <UserPlus size={12} className="text-[#6B7280] flex-shrink-0" />
                                  </button>
                                ))}
                                {unassignedMembers(tr.id).length === 0 && (
                                  <p className="text-[11px] text-[#6B7280] text-center py-2">
                                    {search ? t('admin.trainers.noMatchingMembers') : t('admin.trainers.allMembersAssigned')}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Client rows */}
                          {clients.length === 0 ? (
                            <p className="text-[12px] text-[#6B7280] text-center py-4">{t('admin.trainers.noClientsAssigned')}</p>
                          ) : (
                            <div className="space-y-1">
                              {clients.map(c => {
                                const tier = c.churnTier ? tierColor(c.churnTier) : null;
                                return (
                                  <div key={c.id} className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-white/[0.02] transition-colors group">
                                    <Avatar name={c.name} size="sm" variant="neutral" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{c.name}</p>
                                      {c.username && <p className="text-[10px] text-[#6B7280] truncate">@{c.username}</p>}
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <div className="text-right hidden md:block">
                                        <p className="text-[11px] text-[#6B7280]">{c.assignedAt ? format(new Date(c.assignedAt), 'MMM d, yyyy') : '—'}</p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-[12px] font-semibold text-[#E5E7EB] tabular-nums">{c.sessions30d}</p>
                                        <p className="text-[9px] text-[#6B7280]">{t('admin.trainers.sessions')}</p>
                                      </div>
                                      {tier && c.churnScore !== null && (
                                        <span
                                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tier.bg}`}
                                          style={{ color: tier.text }}
                                        >
                                          {c.churnScore}%
                                        </span>
                                      )}
                                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.isActive ? 'bg-emerald-400' : 'bg-[#4B5563]'}`}
                                        title={c.isActive ? t('admin.trainers.active30d') : t('admin.trainers.inactive')}
                                      />
                                      <button
                                        onClick={() => setConfirmUnassign({ trainerId: tr.id, clientId: c.id, clientName: c.name })}
                                        className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors flex-shrink-0"
                                        style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#EF4444' }}
                                        title={t('admin.trainers.unassignClient', 'Quitar cliente')}
                                        aria-label={t('admin.trainers.unassignClient', 'Quitar cliente')}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </AdminCard>
                );
              })}
            </div>
        </>
      )}

      {/* Add Trainer Modal */}
      <AddTrainerModal
        isOpen={showAddTrainer}
        onClose={() => setShowAddTrainer(false)}
        allMembers={allMembers}
        onPromote={promoteToTrainer}
      />

      {/* Confirm Unassign Client Modal */}
      {confirmUnassign && (
        <AdminModal isOpen onClose={() => setConfirmUnassign(null)} title={t('admin.trainers.unassignClientTitle', 'Quitar Cliente')} size="sm"
          footer={
            <>
              <button onClick={() => setConfirmUnassign(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
                style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                {t('admin.trainers.cancel', 'Cancelar')}
              </button>
              <button onClick={async () => { await unassignClient(confirmUnassign.trainerId, confirmUnassign.clientId); setConfirmUnassign(null); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                style={{ backgroundColor: '#EF4444', color: '#fff' }}>
                <Trash2 size={14} /> {t('admin.trainers.unassignConfirm', 'Quitar Cliente')}
              </button>
            </>
          }>
          <p className="text-[13px] text-center" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.trainers.unassignDesc', '¿Desasignar a')} <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{confirmUnassign.clientName}</span>{t('admin.trainers.unassignDescEnd', ' de este entrenador?')}
          </p>
        </AdminModal>
      )}

      {/* Confirm Demote Modal */}
      <ConfirmDemoteModal
        isOpen={!!confirmDemote}
        onClose={() => setConfirmDemote(null)}
        trainer={demoteTrainer}
        clientCount={demoteClientCount}
        onConfirm={demoteToMember}
      />
    </div>
  );
}
