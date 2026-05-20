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
import { es as esLocale } from 'date-fns/locale/es';
import { exportCSV } from '../../lib/csvExport';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { PageHeader, AdminCard, StatCard, Avatar, SectionLabel, ErrorCard, Skeleton, AdminTabs, AdminModal } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import AddTrainerModal from './components/AddTrainerModal';
import ConfirmDemoteModal from './components/ConfirmDemoteModal';
import usePagedVisible from '../../hooks/usePagedVisible';
import PaginationFooter from '../../components/admin/PaginationFooter';

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
  if (tier === 'critical') return { text: 'var(--color-danger)', bg: 'bg-red-500/10' };
  if (tier === 'high') return { text: 'var(--color-danger)', bg: 'bg-red-400/10' };
  if (tier === 'medium') return { text: 'var(--color-warning)', bg: 'bg-amber-400/10' };
  return { text: 'var(--color-success)', bg: 'bg-emerald-400/10' };
};

// ── MAIN ──────────────────────────────────────────────────────────────────

export default function AdminTrainers() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsOpts = isEs ? { locale: esLocale } : undefined;
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const { showToast } = useToast();

  useEffect(() => { document.title = t('admin.trainers.pageTitle', `Admin - Trainers | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

  const [trainersTab, setTrainersTab]   = useState('roster');
  const [expanded, setExpanded]         = useState(null);
  // Cap rendered trainer cards at 10 + load-more so large gyms don't paint
  // hundreds of expandable cards on first render.
  const trainerPager = usePagedVisible({ initial: 10, step: 10 });
  const [showAssign, setShowAssign]     = useState(null);
  const [search, setSearch]             = useState('');
  const [assigning, setAssigning]       = useState(false);
  const [showAddTrainer, setShowAddTrainer] = useState(false);
  const [confirmDemote, setConfirmDemote]   = useState(null);
  const [confirmUnassign, setConfirmUnassign] = useState(null); // { trainerId, clientId, clientName }
  const [unassigning, setUnassigning] = useState(false);
  const [demoting, setDemoting] = useState(false);

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
    if (!gymId) {
      showToast(t('admin.trainers.unassignError', 'Failed to unassign client'), 'error');
      return;
    }
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
    if (demoting || !gymId) return;
    setDemoting(true);
    try {
      // Prefer the atomic RPC (migration 0358). Falls back to the legacy two-step
      // flow with compensating rollback if the RPC isn't deployed yet (e.g. on a
      // gym still on an older migration), so demote keeps working either way.
      const { error: rpcErr } = await supabase.rpc('demote_trainer_atomically', { p_trainer_id: trainerId });
      if (rpcErr) {
        // Function-not-found errors come back as 42883 / PGRST202 / 'function ... does not exist'.
        // Treat these as "RPC not available, fall back" — anything else is a real error.
        const rpcMissing = (
          rpcErr.code === '42883'
          || rpcErr.code === 'PGRST202'
          || /does not exist/i.test(rpcErr.message || '')
        );
        if (!rpcMissing) throw rpcErr;
        let deactivatedTrainerClients = false;
        try {
          const { error: deactivateErr } = await supabase
            .from('trainer_clients')
            .update({ is_active: false })
            .eq('trainer_id', trainerId)
            .eq('gym_id', gymId);
          if (deactivateErr) throw deactivateErr;
          deactivatedTrainerClients = true;
          const { error: demoteErr } = await supabase
            .from('profiles')
            .update({ role: 'member' })
            .eq('id', trainerId)
            .eq('gym_id', gymId);
          if (demoteErr) throw demoteErr;
        } catch (innerErr) {
          if (deactivatedTrainerClients) {
            await supabase
              .from('trainer_clients')
              .update({ is_active: true })
              .eq('trainer_id', trainerId)
              .eq('gym_id', gymId)
              .catch(() => {});
          }
          throw innerErr;
        }
      }
      logAdminAction('demote_trainer', 'trainer', trainerId);
      setConfirmDemote(null);
      setExpanded(null);
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.demoteError', 'Failed to demote trainer'), 'error');
    } finally {
      setDemoting(false);
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
        // Header label and the actual data column must agree — rows expose
        // `username`, not `email`. Previously the CSV said "Email" and showed usernames.
        { key: 'username', label: t('admin.trainers.csvUsername', 'Username') },
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
    <div className="admin-shell px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto overflow-x-hidden">
      <PageHeader
        title={t('admin.trainers.title')}
        subtitle={t('admin.trainers.subtitle')}
        className="mb-5"
        actions={
          <>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors whitespace-nowrap"
              style={{
                border: '1px solid var(--color-admin-border)',
                color: 'var(--color-admin-text-sub)',
                background: 'var(--color-bg-card)',
              }}
            >
              <Download size={13} />
              {t('admin.trainers.export')}
            </button>
            <button
              onClick={() => setShowAddTrainer(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors whitespace-nowrap"
              style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
            >
              <Plus size={13} />
              {t('admin.trainers.addTrainer')}
            </button>
          </>
        }
      />

      {/* Top metrics row */}
      {!isLoading && !error && trainers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3 mb-5">
          <StatCard
            label={t('admin.trainers.totalTrainers', 'Total Trainers')}
            value={trainers.length}
            borderColor="var(--color-accent)"
            icon={Users}
            delay={0}
          />
          <StatCard
            label={t('admin.trainers.totalClients', 'Assigned Clients')}
            value={trainers.reduce((s, tr) => s + tr.clientCount, 0)}
            borderColor="var(--color-info)"
            icon={UserPlus}
            delay={0.05}
          />
          <StatCard
            label={t('admin.trainers.avgClientsPerTrainer', 'Avg Clients / Trainer')}
            value={trainers.length > 0 ? (trainers.reduce((s, tr) => s + tr.clientCount, 0) / trainers.length).toFixed(1) : '0'}
            borderColor="var(--color-success)"
            icon={BarChart3}
            delay={0.1}
          />
        </div>
      )}

      {/* No tabs — single view */}

      {isLoading ? (
        <div className="flex justify-center py-24">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{
              borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
              borderTopColor: 'var(--color-accent)',
            }}
          />
        </div>
      ) : error ? (
        <ErrorCard message={t('admin.trainers.loadError')} onRetry={refetch} />
      ) : trainers.length === 0 ? (
        <AdminCard className="p-12 text-center">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'var(--color-admin-panel)' }}
          >
            <Users size={24} style={{ color: 'var(--color-admin-text-muted)' }} />
          </div>
          <p className="text-[14px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{t('admin.trainers.emptyTitle')}</p>
          <p className="text-[12.5px] mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.emptyDesc')}</p>
          <button
            onClick={() => setShowAddTrainer(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold transition-colors whitespace-nowrap"
            style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
          >
            <Plus size={13} />
            {t('admin.trainers.addTrainer')}
          </button>
        </AdminCard>
      ) : (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              {trainers.slice(0, trainerPager.visibleCount).map(tr => {
                const isExpanded = expanded === tr.id;
                const clients = clientMap[tr.id] || [];
                const atRiskCount = clients.filter(c => c.churnTier === 'critical' || c.churnTier === 'high').length;
                return (
                  <AdminCard key={tr.id} hover padding="p-0" className="overflow-hidden">
                    {/* Trainer header */}
                    <div
                      className="px-4 py-4 cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : tr.id)}
                    >
                      <div className="flex items-center gap-3.5">
                        <Avatar name={tr.name} size="md" variant="accent" />
                        <div className="flex-1 min-w-0">
                          <p className="admin-page-title text-[15px] truncate" style={{ letterSpacing: '-0.015em' }}>{tr.name}</p>
                          {tr.username && <p className="text-[11.5px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>@{tr.username}</p>}
                        </div>
                        {/* Desktop inline stats */}
                        <div className="hidden md:flex items-center gap-4 mr-2">
                          <div className="text-right min-w-[40px]">
                            <p className="admin-kpi text-[20px] leading-none">{tr.clientCount}</p>
                            <p className="text-[10px] mt-1 uppercase tracking-[0.06em] font-bold" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.clients', 'Clients')}</p>
                          </div>
                          <div className="text-right min-w-[40px]">
                            <p
                              className="admin-kpi text-[20px] leading-none"
                              style={{ color: tr.retention >= 80 ? 'var(--color-success)' : 'var(--color-admin-text-muted)' }}
                            >
                              {tr.retention}%
                            </p>
                            <p className="text-[10px] mt-1 uppercase tracking-[0.06em] font-bold" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.retention', 'Retention')}</p>
                          </div>
                          {atRiskCount > 0 && (
                            <div className="text-right min-w-[40px]">
                              <p className="admin-kpi text-[20px] leading-none" style={{ color: 'var(--color-danger)' }}>{atRiskCount}</p>
                              <p className="text-[10px] mt-1 uppercase tracking-[0.06em] font-bold" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.atRisk', 'At Risk')}</p>
                            </div>
                          )}
                        </div>
                        <button
                          className="flex items-center justify-center flex-shrink-0"
                          style={{
                            width: 30, height: 30, borderRadius: 8,
                            border: '1px solid var(--color-admin-border)',
                            background: 'var(--color-bg-card)',
                            color: 'var(--color-admin-text-sub)',
                          }}
                          aria-hidden="true"
                        >
                          <ChevronDown size={13} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                      {/* Mobile stats mini-grid */}
                      <div className={`grid ${atRiskCount > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 mt-3 md:hidden`}>
                        <div
                          className="rounded-lg px-2.5 py-2"
                          style={{ background: 'var(--color-admin-panel)' }}
                        >
                          <p className="admin-kpi text-[18px] leading-none">{tr.clientCount}</p>
                          <p className="text-[10px] mt-1 uppercase tracking-[0.06em] font-bold" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.clients', 'Clients')}</p>
                        </div>
                        <div
                          className="rounded-lg px-2.5 py-2"
                          style={{ background: 'var(--color-admin-panel)' }}
                        >
                          <p
                            className="admin-kpi text-[18px] leading-none"
                            style={{ color: tr.retention >= 80 ? 'var(--color-success)' : 'var(--color-admin-text)' }}
                          >
                            {tr.retention}%
                          </p>
                          <p className="text-[10px] mt-1 uppercase tracking-[0.06em] font-bold" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.retention', 'Retention')}</p>
                        </div>
                        {atRiskCount > 0 && (
                          <div
                            className="rounded-lg px-2.5 py-2"
                            style={{ background: 'var(--color-danger-soft)' }}
                          >
                            <p className="admin-kpi text-[18px] leading-none" style={{ color: 'var(--color-danger)' }}>{atRiskCount}</p>
                            <p className="text-[10px] mt-1 uppercase tracking-[0.06em] font-bold" style={{ color: 'var(--color-danger)' }}>{t('admin.trainers.atRisk', 'At Risk')}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expanded: client list */}
                    <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                      <div className="overflow-hidden">
                        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
                          <div className="flex items-center justify-between mt-3 mb-2 gap-2 flex-wrap">
                            <SectionLabel>{t('admin.trainers.clientsCount', { count: clients.length })}</SectionLabel>
                            <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowAssign(showAssign === tr.id ? null : tr.id); setSearch(''); }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap"
                                style={{
                                  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                                  color: 'var(--color-accent)',
                                }}
                              >
                                <UserPlus size={12} />
                                {t('admin.trainers.assignClient')}
                              </button>
                              {/* Remove Trainer is a destructive action — push it away from Assign Client
                                  with ml-auto, give it a stronger danger border, and tighten the danger color. */}
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDemote(tr.id); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ml-auto"
                                style={{
                                  backgroundColor: 'var(--color-danger-soft)',
                                  color: 'var(--color-danger)',
                                  border: '1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)',
                                }}
                              >
                                <X size={12} />
                                {t('admin.trainers.removeTrainer')}
                              </button>
                            </div>
                          </div>

                          {/* Assign client dropdown */}
                          {showAssign === tr.id && (
                            <div
                              className="mb-3 rounded-lg p-3"
                              style={{
                                background: 'var(--color-admin-panel)',
                                border: '1px solid var(--color-admin-border)',
                              }}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Search size={13} style={{ color: 'var(--color-admin-text-muted)' }} />
                                <input
                                  type="text"
                                  value={search}
                                  onChange={e => setSearch(e.target.value)}
                                  placeholder={t('admin.trainers.searchMembers')}
                                  aria-label={t('admin.trainers.searchMembers')}
                                  className="flex-1 bg-transparent text-[12px] outline-none"
                                  style={{ color: 'var(--color-admin-text)' }}
                                  autoFocus
                                />
                                <button onClick={() => setShowAssign(null)} aria-label={t('admin.trainers.closeMemberSearch')} className="min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus:ring-2"
                                  style={{ color: 'var(--color-admin-text-muted)' }}>
                                  <X size={14} />
                                </button>
                              </div>
                              <div className="max-h-40 overflow-y-auto space-y-0.5">
                                {unassignedMembers(tr.id).slice(0, 20).map(m => (
                                  <button
                                    key={m.id}
                                    disabled={assigning}
                                    onClick={() => assignClient(tr.id, m.id)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors disabled:opacity-50"
                                    style={{ background: 'transparent' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <Avatar name={m.full_name} size="sm" variant="neutral" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] truncate" style={{ color: 'var(--color-admin-text)' }}>{m.full_name}</p>
                                      {m.username && <p className="text-[10px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>@{m.username}</p>}
                                    </div>
                                    <UserPlus size={12} className="flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }} />
                                  </button>
                                ))}
                                {unassignedMembers(tr.id).length === 0 && (
                                  <p className="text-[11px] text-center py-2" style={{ color: 'var(--color-admin-text-muted)' }}>
                                    {search ? t('admin.trainers.noMatchingMembers') : t('admin.trainers.allMembersAssigned')}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Client rows */}
                          {clients.length === 0 ? (
                            <p className="text-[12px] text-center py-4" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.noClientsAssigned')}</p>
                          ) : (
                            <div className="space-y-1">
                              {clients.map(c => {
                                const tier = c.churnTier ? tierColor(c.churnTier) : null;
                                return (
                                  <div key={c.id} className="flex items-center gap-2.5 py-2 px-2 rounded-lg transition-colors group"
                                    style={{ background: 'transparent' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <Avatar name={c.name} size="sm" variant="neutral" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{c.name}</p>
                                      {c.username && <p className="text-[10px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>@{c.username}</p>}
                                    </div>
                                    <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
                                      <div className="text-right hidden md:block">
                                        <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{c.assignedAt ? format(new Date(c.assignedAt), 'MMM d, yyyy', dateFnsOpts) : '—'}</p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-[12px] font-semibold admin-mono" style={{ color: 'var(--color-admin-text)' }}>{c.sessions30d}</p>
                                        <p className="text-[9px] hidden sm:block" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.sessions')}</p>
                                      </div>
                                      {tier && c.churnScore !== null && (
                                        <span
                                          className="text-[10px] font-bold px-2 py-0.5 rounded-full admin-mono"
                                          style={{ color: tier.text, background: tier.bg.includes('red-500') ? 'var(--color-danger-soft)' : tier.bg.includes('red-400') ? 'var(--color-danger-soft)' : tier.bg.includes('amber') ? 'var(--color-warning-soft)' : 'var(--color-success-soft)' }}
                                        >
                                          {c.churnScore}%
                                        </span>
                                      )}
                                      <div className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ background: c.isActive ? 'var(--color-success)' : 'var(--color-admin-text-muted)' }}
                                        title={c.isActive ? t('admin.trainers.active30d') : t('admin.trainers.inactive')}
                                      />
                                      <button
                                        onClick={() => setConfirmUnassign({ trainerId: tr.id, clientId: c.id, clientName: c.name })}
                                        className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors flex-shrink-0"
                                        style={{ backgroundColor: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
                                        title={t('admin.trainers.unassignClient', 'Unassign client')}
                                        aria-label={t('admin.trainers.unassignClient', 'Unassign client')}
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

            <PaginationFooter pager={trainerPager} total={trainers.length} />
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
        <AdminModal isOpen onClose={() => setConfirmUnassign(null)} title={t('admin.trainers.unassignClientTitle', 'Unassign Client')} size="sm"
          footer={
            <>
              <button onClick={() => setConfirmUnassign(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
                style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                {t('admin.trainers.cancel', 'Cancel')}
              </button>
              <button
                onClick={async () => {
                  if (unassigning) return;
                  setUnassigning(true);
                  try { await unassignClient(confirmUnassign.trainerId, confirmUnassign.clientId); }
                  finally { setUnassigning(false); setConfirmUnassign(null); }
                }}
                disabled={unassigning}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-danger)', color: '#fff' }}>
                <Trash2 size={14} /> {unassigning ? t('admin.trainers.unassigning', 'Unassigning…') : t('admin.trainers.unassignConfirm', 'Unassign Client')}
              </button>
            </>
          }>
          <p className="text-[13px] text-center" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.trainers.unassignDesc', 'Unassign')} <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{confirmUnassign.clientName}</span>{t('admin.trainers.unassignDescEnd', ' from this trainer?')}
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
