import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, ChevronDown, UserPlus, X, Search, Plus, Download,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, Avatar, SectionLabel, ErrorCard, Skeleton } from '../../components/admin';
import AddTrainerModal from './components/AddTrainerModal';
import ConfirmDemoteModal from './components/ConfirmDemoteModal';

// ── Fetch function ────────────────────────────────────────────────────────

const fetchTrainerData = async (gymId) => {
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const [
    { data: trainerRows },
    { data: tcRows },
    { data: recentSessions },
    { data: memberRows },
    { data: churnRows },
  ] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, created_at').eq('gym_id', gymId).eq('role', 'trainer'),
    supabase.from('trainer_clients').select('trainer_id, client_id, is_active, notes, created_at').eq('gym_id', gymId),
    supabase.from('workout_sessions').select('profile_id').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', thirtyDaysAgo),
    supabase.from('profiles').select('id, full_name, email').eq('gym_id', gymId).eq('role', 'member'),
    supabase.from('churn_risk_scores').select('profile_id, score, risk_tier').eq('gym_id', gymId),
  ]);

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
        email: member?.email || '',
        sessions30d: sessionCountMap[tc.client_id] || 0,
        isActive: activeMembers.has(tc.client_id),
        churnScore: churn?.score ?? null,
        churnTier: churn?.risk_tier ?? null,
        assignedAt: tc.created_at,
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
      email: t.email || '',
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
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  useEffect(() => { document.title = 'Admin - Trainers | TuGymPR'; }, []);

  const [expanded, setExpanded]         = useState(null);
  const [showAssign, setShowAssign]     = useState(null);
  const [search, setSearch]             = useState('');
  const [assigning, setAssigning]       = useState(false);
  const [showAddTrainer, setShowAddTrainer] = useState(false);
  const [confirmDemote, setConfirmDemote]   = useState(null);

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
    await supabase.from('trainer_clients').upsert({
      trainer_id: trainerId,
      client_id: memberId,
      gym_id: gymId,
      is_active: true,
    }, { onConflict: 'trainer_id,client_id' });
    await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    setAssigning(false);
  };

  // Unassign a client from a trainer
  const unassignClient = async (trainerId, clientId) => {
    await supabase
      .from('trainer_clients')
      .update({ is_active: false })
      .eq('trainer_id', trainerId)
      .eq('client_id', clientId)
      .eq('gym_id', gymId);
    await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
  };

  // Promote a member to trainer role
  const promoteToTrainer = async (memberId) => {
    await supabase
      .from('profiles')
      .update({ role: 'trainer' })
      .eq('id', memberId)
      .eq('gym_id', gymId);
    setShowAddTrainer(false);
    await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
  };

  // Demote trainer back to member
  const demoteToMember = async (trainerId) => {
    await supabase
      .from('trainer_clients')
      .update({ is_active: false })
      .eq('trainer_id', trainerId)
      .eq('gym_id', gymId);
    await supabase
      .from('profiles')
      .update({ role: 'member' })
      .eq('id', trainerId)
      .eq('gym_id', gymId);
    setConfirmDemote(null);
    setExpanded(null);
    await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
  };

  // Members not assigned to this trainer
  const unassignedMembers = (trainerId) => {
    const assigned = new Set((clientMap[trainerId] || []).map(c => c.id));
    return allMembers.filter(m =>
      !assigned.has(m.id) &&
      (m.full_name?.toLowerCase().includes(search.toLowerCase()) || m.email?.toLowerCase().includes(search.toLowerCase()))
    );
  };

  const handleExport = () => {
    const rows = [];
    trainers.forEach(t => {
      (clientMap[t.id] || []).forEach(c => {
        rows.push({
          trainer: t.name,
          client: c.name,
          email: c.email,
          sessions30d: c.sessions30d,
          churnScore: c.churnScore ?? '',
          churnTier: c.churnTier ?? '',
        });
      });
    });
    exportCSV({
      filename: 'trainers',
      columns: [
        { key: 'trainer', label: 'Trainer' },
        { key: 'client', label: 'Client' },
        { key: 'email', label: 'Email' },
        { key: 'sessions30d', label: 'Sessions (30d)' },
        { key: 'churnScore', label: 'Churn Score' },
        { key: 'churnTier', label: 'Churn Tier' },
      ],
      data: rows,
    });
  };

  const demoteTrainer = confirmDemote ? trainers.find(t => t.id === confirmDemote) : null;
  const demoteClientCount = confirmDemote ? (clientMap[confirmDemote] || []).length : 0;

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <PageHeader
        title="Trainers"
        subtitle="Manage trainers and their client assignments"
        className="mb-6"
        actions={
          <>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
            >
              <Download size={13} />
              Export
            </button>
            <button
              onClick={() => setShowAddTrainer(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-[#D4AF37] text-[#0A0D14] hover:bg-[#E5C44D] transition-colors"
            >
              <Plus size={13} />
              Add Trainer
            </button>
          </>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <ErrorCard message="Failed to load trainer data" onRetry={refetch} />
      ) : trainers.length === 0 ? (
        <AdminCard className="p-12 text-center">
          <Users size={28} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#9CA3AF] font-medium">No trainers yet</p>
          <p className="text-[12px] text-[#6B7280] mt-1">Promote a member to get started</p>
          <button
            onClick={() => setShowAddTrainer(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37] text-[#0A0D14] hover:bg-[#E5C44D] transition-colors"
          >
            <Plus size={13} />
            Add Trainer
          </button>
        </AdminCard>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Total Trainers', value: trainers.length, color: '#D4AF37' },
              { label: 'Total Clients', value: trainers.reduce((s, t) => s + t.clientCount, 0), color: '#3B82F6' },
              { label: 'Avg Client Retention', value: `${trainers.length > 0 ? Math.round(trainers.reduce((s, t) => s + t.retention, 0) / trainers.length) : 0}%`, color: '#10B981' },
              { label: 'Client Sessions (30d)', value: trainers.reduce((s, t) => s + t.totalSessions, 0), color: '#8B5CF6' },
            ].map((s, i) => (
              <AdminCard key={i} hover borderLeft={s.color}>
                <p className="text-[22px] font-bold text-[#E5E7EB] leading-none tabular-nums">{s.value}</p>
                <p className="text-[12px] text-[#9CA3AF] mt-1">{s.label}</p>
              </AdminCard>
            ))}
          </div>

          {/* Trainer cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {trainers.map(t => {
              const isExpanded = expanded === t.id;
              const clients = clientMap[t.id] || [];
              return (
                <AdminCard key={t.id} hover padding="p-0">
                  {/* Trainer header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer"
                    onClick={() => setExpanded(isExpanded ? null : t.id)}
                  >
                    <Avatar name={t.name} size="md" variant="accent" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{t.name}</p>
                      <p className="text-[11px] text-[#6B7280]">{t.email}</p>
                    </div>
                    <div className="flex items-center gap-4 mr-2">
                      <div className="text-center">
                        <p className="text-[16px] font-bold text-[#E5E7EB] leading-none tabular-nums">{t.clientCount}</p>
                        <p className="text-[10px] text-[#6B7280] mt-0.5">clients</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[16px] font-bold text-[#10B981] leading-none tabular-nums">{t.retention}%</p>
                        <p className="text-[10px] text-[#6B7280] mt-0.5">retention</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[16px] font-bold text-[#E5E7EB] leading-none tabular-nums">{t.avgWorkouts}</p>
                        <p className="text-[10px] text-[#6B7280] mt-0.5">wk/client</p>
                      </div>
                    </div>
                    <ChevronDown size={16} className={`text-[#6B7280] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Expanded: client list */}
                  <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4 border-t border-white/6">
                        <div className="flex items-center justify-between mt-3 mb-2">
                          <SectionLabel>Clients ({clients.length})</SectionLabel>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDemote(t.id); }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[#EF4444]/70 hover:bg-[#EF4444]/10 hover:text-[#EF4444] transition-colors"
                            >
                              <X size={12} />
                              Remove Trainer
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowAssign(showAssign === t.id ? null : t.id); setSearch(''); }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#D4AF37]/10 text-[#D4AF37] hover:bg-[#D4AF37]/20 transition-colors"
                            >
                              <UserPlus size={12} />
                              Assign Client
                            </button>
                          </div>
                        </div>

                        {/* Assign client dropdown */}
                        {showAssign === t.id && (
                          <div className="mb-3 bg-[#111827] border border-white/8 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Search size={13} className="text-[#6B7280]" />
                              <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search members..."
                                aria-label="Search members"
                                className="flex-1 bg-transparent text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none"
                                autoFocus
                              />
                              <button onClick={() => setShowAssign(null)} className="text-[#6B7280] hover:text-[#9CA3AF]">
                                <X size={14} />
                              </button>
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-0.5">
                              {unassignedMembers(t.id).slice(0, 20).map(m => (
                                <button
                                  key={m.id}
                                  disabled={assigning}
                                  onClick={() => assignClient(t.id, m.id)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-white/5 transition-colors disabled:opacity-50"
                                >
                                  <Avatar name={m.full_name} size="sm" variant="neutral" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] text-[#E5E7EB] truncate">{m.full_name}</p>
                                    <p className="text-[10px] text-[#6B7280] truncate">{m.email}</p>
                                  </div>
                                  <UserPlus size={12} className="text-[#4B5563] flex-shrink-0" />
                                </button>
                              ))}
                              {unassignedMembers(t.id).length === 0 && (
                                <p className="text-[11px] text-[#6B7280] text-center py-2">
                                  {search ? 'No matching members' : 'All members assigned'}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Client rows */}
                        {clients.length === 0 ? (
                          <p className="text-[12px] text-[#6B7280] text-center py-4">No clients assigned</p>
                        ) : (
                          <div className="space-y-1">
                            {clients.map(c => {
                              const tier = c.churnTier ? tierColor(c.churnTier) : null;
                              return (
                                <div key={c.id} className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-white/[0.02] transition-colors group">
                                  <Avatar name={c.name} size="sm" variant="neutral" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{c.name}</p>
                                    <p className="text-[10px] text-[#6B7280] truncate">{c.email}</p>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="text-right hidden md:block">
                                      <p className="text-[11px] text-[#6B7280]">{c.assignedAt ? format(new Date(c.assignedAt), 'MMM d, yyyy') : '—'}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-[12px] font-semibold text-[#E5E7EB] tabular-nums">{c.sessions30d}</p>
                                      <p className="text-[9px] text-[#6B7280]">sessions</p>
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
                                      title={c.isActive ? 'Active (30d)' : 'Inactive'}
                                    />
                                    <button
                                      onClick={() => unassignClient(t.id, c.id)}
                                      className="opacity-0 group-hover:opacity-100 text-[#6B7280] hover:text-[#EF4444] transition-all"
                                      title="Unassign client"
                                    >
                                      <X size={13} />
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
