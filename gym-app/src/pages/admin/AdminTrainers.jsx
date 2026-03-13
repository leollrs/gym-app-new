import { useEffect, useState } from 'react';
import {
  Users, ChevronRight, ChevronDown, Dumbbell, TrendingUp,
  UserPlus, X, Search, Check, Plus, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { Download } from 'lucide-react';

export default function AdminTrainers() {
  const { profile } = useAuth();
  const [loading, setLoading]       = useState(true);
  const [trainers, setTrainers]     = useState([]);
  const [expanded, setExpanded]     = useState(null); // trainer id
  const [clientMap, setClientMap]   = useState({});   // trainerId → [{ ...client }]
  const [allMembers, setAllMembers] = useState([]);
  const [showAssign, setShowAssign] = useState(null); // trainer id
  const [search, setSearch]         = useState('');
  const [assigning, setAssigning]   = useState(false);

  // Add trainer modal state
  const [showAddTrainer, setShowAddTrainer] = useState(false);
  const [addSearch, setAddSearch]   = useState('');
  const [promoting, setPromoting]   = useState(null); // member id being promoted
  const [confirmDemote, setConfirmDemote] = useState(null); // trainer id to demote

  useEffect(() => {
    if (!profile?.gym_id) return;
    load();
  }, [profile?.gym_id]);

  const load = async () => {
    setLoading(true);
    const gymId = profile.gym_id;
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
    setAllMembers(members);

    const memberMap = {};
    members.forEach(m => { memberMap[m.id] = m; });

    // Churn scores by member
    const churnMap = {};
    (churnRows || []).forEach(r => { churnMap[r.profile_id] = r; });

    // Sessions per member
    const activeMembers = new Set();
    const sessionCountMap = {};
    (recentSessions || []).forEach(s => {
      activeMembers.add(s.profile_id);
      sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1;
    });

    // Build client map and trainer stats
    const relationships = tcRows || [];
    const cMap = {};

    const trainerStats = (trainerRows || []).map(t => {
      const clients = relationships.filter(tc => tc.trainer_id === t.id);
      const activeClients = clients.filter(tc => tc.is_active);
      const clientCount = activeClients.length;

      cMap[t.id] = activeClients.map(tc => {
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

    trainerStats.sort((a, b) => b.clientCount - a.clientCount);
    setClientMap(cMap);
    setTrainers(trainerStats);
    setLoading(false);
  };

  // Assign a member to a trainer
  const assignClient = async (trainerId, memberId) => {
    setAssigning(true);
    await supabase.from('trainer_clients').upsert({
      trainer_id: trainerId,
      client_id: memberId,
      gym_id: profile.gym_id,
      is_active: true,
    }, { onConflict: 'trainer_id,client_id' });
    await load();
    setAssigning(false);
  };

  // Unassign a client from a trainer
  const unassignClient = async (trainerId, clientId) => {
    await supabase
      .from('trainer_clients')
      .update({ is_active: false })
      .eq('trainer_id', trainerId)
      .eq('client_id', clientId)
      .eq('gym_id', profile.gym_id);
    await load();
  };

  // Promote a member to trainer role
  const promoteToTrainer = async (memberId) => {
    setPromoting(memberId);
    await supabase
      .from('profiles')
      .update({ role: 'trainer' })
      .eq('id', memberId)
      .eq('gym_id', profile.gym_id);
    setPromoting(null);
    setShowAddTrainer(false);
    setAddSearch('');
    await load();
  };

  // Demote trainer back to member
  const demoteToMember = async (trainerId) => {
    // Remove all active client relationships first
    await supabase
      .from('trainer_clients')
      .update({ is_active: false })
      .eq('trainer_id', trainerId)
      .eq('gym_id', profile.gym_id);
    // Change role back to member
    await supabase
      .from('profiles')
      .update({ role: 'member' })
      .eq('id', trainerId)
      .eq('gym_id', profile.gym_id);
    setConfirmDemote(null);
    setExpanded(null);
    await load();
  };

  // Filter members for "Add Trainer" search
  const promotableMembers = allMembers.filter(m =>
    addSearch.length > 0 &&
    (m.full_name?.toLowerCase().includes(addSearch.toLowerCase()) || m.email?.toLowerCase().includes(addSearch.toLowerCase()))
  );

  // Members not assigned to this trainer
  const unassignedMembers = (trainerId) => {
    const assigned = new Set((clientMap[trainerId] || []).map(c => c.id));
    return allMembers.filter(m =>
      !assigned.has(m.id) &&
      (m.full_name?.toLowerCase().includes(search.toLowerCase()) || m.email?.toLowerCase().includes(search.toLowerCase()))
    );
  };

  const tierColor = (tier) => {
    if (tier === 'critical') return { text: '#DC2626', bg: 'bg-red-500/10' };
    if (tier === 'high') return { text: '#EF4444', bg: 'bg-red-400/10' };
    if (tier === 'medium') return { text: '#F59E0B', bg: 'bg-amber-400/10' };
    return { text: '#10B981', bg: 'bg-emerald-400/10' };
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

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Trainers</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Manage trainers and their client assignments</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
          >
            <Download size={13} />
            Export
          </button>
          <button
            onClick={() => { setShowAddTrainer(true); setAddSearch(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-[#D4AF37] text-[#0A0D14] hover:bg-[#E5C44D] transition-colors"
          >
            <Plus size={13} />
            Add Trainer
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : trainers.length === 0 ? (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-12 text-center">
          <Users size={28} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#9CA3AF] font-medium">No trainers yet</p>
          <p className="text-[12px] text-[#6B7280] mt-1">Promote a member to get started</p>
          <button
            onClick={() => { setShowAddTrainer(true); setAddSearch(''); }}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37] text-[#0A0D14] hover:bg-[#E5C44D] transition-colors"
          >
            <Plus size={13} />
            Add Trainer
          </button>
        </div>
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
              <div key={i} className="bg-[#0F172A] border border-white/6 rounded-xl p-4 border-l-2 hover:border-white/10 transition-colors duration-300" style={{ borderLeftColor: s.color }}>
                <p className="text-[22px] font-bold text-[#E5E7EB] leading-none tabular-nums">{s.value}</p>
                <p className="text-[12px] text-[#9CA3AF] mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Trainer cards */}
          <div className="space-y-3">
            {trainers.map(t => {
              const isExpanded = expanded === t.id;
              const clients = clientMap[t.id] || [];
              return (
                <div key={t.id} className="bg-[#0F172A] border border-white/6 rounded-xl hover:border-white/10 transition-colors duration-300">
                  {/* Trainer header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer"
                    onClick={() => setExpanded(isExpanded ? null : t.id)}
                  >
                    <div className="w-9 h-9 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-[13px] font-bold text-[#D4AF37]">{t.name[0]?.toUpperCase()}</span>
                    </div>
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
                          <p className="text-[12px] font-semibold text-[#9CA3AF]">
                            Clients ({clients.length})
                          </p>
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
                                  <div className="w-6 h-6 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                                    <span className="text-[9px] font-bold text-[#9CA3AF]">{m.full_name?.[0]?.toUpperCase() || '?'}</span>
                                  </div>
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
                                  <div className="w-7 h-7 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                                    <span className="text-[10px] font-bold text-[#9CA3AF]">{c.name[0]?.toUpperCase() || '?'}</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{c.name}</p>
                                    <p className="text-[10px] text-[#6B7280] truncate">{c.email}</p>
                                  </div>
                                  <div className="flex items-center gap-3">
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
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* ── Add Trainer Modal ───────────────────────────────── */}
      {showAddTrainer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4" onClick={() => setShowAddTrainer(false)}>
          <div className="w-full max-w-md my-8 md:my-16" onClick={e => e.stopPropagation()}>
            <div role="dialog" aria-modal="true" aria-labelledby="add-trainer-title" className="bg-[#0F172A] border border-white/8 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/6 flex items-center justify-between">
                <div>
                  <h2 id="add-trainer-title" className="text-[16px] font-bold text-[#E5E7EB]">Add Trainer</h2>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">Promote an existing member to the trainer role</p>
                </div>
                <button onClick={() => setShowAddTrainer(false)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                  <X size={16} className="text-[#9CA3AF]" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b border-white/6">
                <div className="flex items-center gap-2 bg-[#111827] border border-white/6 rounded-lg px-3 py-2">
                  <Search size={14} className="text-[#6B7280] flex-shrink-0" />
                  <input
                    type="text"
                    value={addSearch}
                    onChange={e => setAddSearch(e.target.value)}
                    placeholder="Search members by name or email..."
                    aria-label="Search members by name or email"
                    className="flex-1 bg-transparent text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none"
                    autoFocus
                  />
                  {addSearch && (
                    <button onClick={() => setAddSearch('')} className="text-[#6B7280] hover:text-[#9CA3AF]">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Results */}
              <div className="max-h-72 overflow-y-auto">
                {addSearch.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <Search size={20} className="text-[#4B5563] mx-auto mb-2" />
                    <p className="text-[12px] text-[#6B7280]">Type a name or email to find members</p>
                  </div>
                ) : promotableMembers.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <p className="text-[12px] text-[#6B7280]">No matching members found</p>
                  </div>
                ) : (
                  <div className="py-1">
                    {promotableMembers.slice(0, 15).map(m => (
                      <button
                        key={m.id}
                        disabled={promoting === m.id}
                        onClick={() => promoteToTrainer(m.id)}
                        className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.03] transition-colors disabled:opacity-50 text-left"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-bold text-[#9CA3AF]">{m.full_name?.[0]?.toUpperCase() || '?'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                          <p className="text-[11px] text-[#6B7280] truncate">{m.email}</p>
                        </div>
                        {promoting === m.id ? (
                          <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin flex-shrink-0" />
                        ) : (
                          <span className="text-[11px] font-medium text-[#D4AF37] flex-shrink-0 px-2 py-0.5 rounded-md bg-[#D4AF37]/10">
                            Promote
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer note */}
              <div className="px-5 py-3 border-t border-white/6 bg-[#0A0D14]/50">
                <p className="text-[10px] text-[#4B5563]">
                  Promoting a member changes their role to trainer. They'll get access to the trainer dashboard and can manage clients.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Demote Modal ──────────────────────────────── */}
      {confirmDemote && (() => {
        const trainer = trainers.find(t => t.id === confirmDemote);
        if (!trainer) return null;
        const clientCount = (clientMap[confirmDemote] || []).length;
        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmDemote(null)}>
            <div className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div role="dialog" aria-modal="true" aria-labelledby="remove-trainer-title" className="bg-[#0F172A] border border-white/8 rounded-xl overflow-hidden">
                <div className="px-5 py-5 text-center">
                  <div className="w-10 h-10 rounded-full bg-[#EF4444]/10 flex items-center justify-center mx-auto mb-3">
                    <AlertTriangle size={18} className="text-[#EF4444]" />
                  </div>
                  <h3 id="remove-trainer-title" className="text-[15px] font-bold text-[#E5E7EB]">Remove Trainer</h3>
                  <p className="text-[12px] text-[#9CA3AF] mt-2">
                    This will demote <span className="font-semibold text-[#E5E7EB]">{trainer.name}</span> back to a regular member.
                  </p>
                  {clientCount > 0 && (
                    <p className="text-[11px] text-[#F59E0B] mt-2 bg-[#F59E0B]/10 rounded-lg px-3 py-1.5 inline-block">
                      {clientCount} client{clientCount !== 1 ? 's' : ''} will be unassigned
                    </p>
                  )}
                </div>
                <div className="px-5 pb-5 flex gap-2">
                  <button
                    onClick={() => setConfirmDemote(null)}
                    className="flex-1 py-2 rounded-lg text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => demoteToMember(confirmDemote)}
                    className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-[#EF4444] text-white hover:bg-[#DC2626] transition-colors"
                  >
                    Remove Trainer
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
