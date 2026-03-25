import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Users, Download, Link } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { createNotification } from '../../lib/notifications';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { getRiskTier } from '../../lib/churnScore';
import { exportCSV } from '../../lib/csvExport';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';

// Shared components
import { PageHeader, FilterBar, Avatar, TableSkeleton } from '../../components/admin';
import { StatusBadge } from '../../components/admin/StatusBadge';

// Sub-components
import InviteModal from './components/InviteModal';
import MemberDetail from './components/MemberDetail';

// ── Churn risk badge ──────────────────────────────────────
const ChurnRiskBadge = ({ member, navigate }) => {
  const score = member.score ?? 0;
  const tier = getRiskTier(score >= 61 ? 72 : score >= 31 ? 50 : 20);
  if (score < 31) return null;
  return (
    <button onClick={e => { e.stopPropagation(); navigate('/admin/churn'); }}
      title={`${tier.label} — click to view in Churn Intel`}
      className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 flex-shrink-0"
      style={{ color: tier.color, background: tier.bg, borderColor: `${tier.color}33` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tier.color }} />
      {tier.label}
    </button>
  );
};

// ── Fallback churn score when DB has no computed row ──────
function estimateChurnScore(daysInactive, recentWorkouts, neverActive) {
  let score;
  if (neverActive || daysInactive > 30) score = 95;
  else if (daysInactive > 14) score = recentWorkouts === 0 ? 85 : 70;
  else if (daysInactive > 7) score = recentWorkouts === 0 ? 45 : 30;
  else score = Math.max(0, 20 - recentWorkouts * 5);
  score = Math.min(100, Math.max(0, score));
  const risk_tier = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  const key_signals = [];
  if (neverActive) key_signals.push('Never logged a workout');
  else if (daysInactive > 30) key_signals.push('No activity in 30+ days');
  else if (daysInactive > 14) key_signals.push('No activity in 14+ days');
  if (recentWorkouts === 0 && !neverActive) key_signals.push('No workouts in last 14 days');
  return { score, risk_tier, key_signals };
}

// ── Data fetcher ──────────────────────────────────────────
async function fetchMembers(gymId) {
  const [membersRes, churnRes, sessionsRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, username, last_active_at, created_at, admin_note, membership_status, qr_code_payload, qr_external_id').eq('gym_id', gymId).eq('role', 'member').order('last_active_at', { ascending: false, nullsFirst: false }).limit(200),
    supabase.from('churn_risk_scores').select('profile_id, score, risk_tier, key_signals').eq('gym_id', gymId).order('score', { ascending: false }),
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', subDays(new Date(), 14).toISOString()),
  ]);

  if (membersRes.error) logger.error('AdminMembers: members:', membersRes.error);
  if (churnRes.error) logger.error('AdminMembers: churn:', churnRes.error);
  if (sessionsRes.error) logger.error('AdminMembers: sessions:', sessionsRes.error);

  const churnMap = {};
  (churnRes.data || []).forEach(row => { if (!churnMap[row.profile_id]) churnMap[row.profile_id] = row; });

  const sessionsLast14 = {};
  const lastSessionAt = {};
  (sessionsRes.data || []).forEach(s => {
    sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
    if (!lastSessionAt[s.profile_id] || s.started_at > lastSessionAt[s.profile_id]) lastSessionAt[s.profile_id] = s.started_at;
  });

  const nowMs = Date.now();
  return (membersRes.data || []).map(m => {
    const churn = churnMap[m.id];
    const effectiveLast = m.last_active_at ?? lastSessionAt[m.id] ?? m.created_at;
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const daysInactive = Math.floor((nowMs - new Date(effectiveLast)) / 86400000);
    const neverActive = !m.last_active_at && !lastSessionAt[m.id];

    // Use DB score if available, otherwise estimate from activity data
    const fallback = !churn ? estimateChurnScore(daysInactive, recentWorkouts, neverActive) : null;

    return {
      ...m,
      recentWorkouts,
      lastSessionAt: lastSessionAt[m.id] ?? null,
      score: churn?.score ?? fallback.score,
      risk_tier: churn?.risk_tier ?? fallback.risk_tier,
      key_signals: churn?.key_signals ?? fallback.key_signals,
      _hasDbScore: !!churn,
      membership_status: m.membership_status ?? 'active',
      daysInactive,
      neverActive,
    };
  });
}

export default function AdminMembers() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gymId = profile?.gym_id;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);

  useEffect(() => { document.title = 'Admin - Members | TuGymPR'; }, []);

  const { data: members = [], isLoading, refetch } = useQuery({
    queryKey: adminKeys.members.all(gymId),
    queryFn: () => fetchMembers(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Auto-trigger server-side churn scoring once when most members lack DB scores
  const churnComputeTriggered = useRef(false);
  useEffect(() => {
    if (!gymId || members.length === 0 || churnComputeTriggered.current) return;
    const hasDbScore = members.filter(m => m._hasDbScore).length;
    if (hasDbScore < members.length * 0.5) {
      churnComputeTriggered.current = true;
      supabase.rpc('compute_churn_scores', { p_gym_id: gymId })
        .then(({ error }) => {
          if (error) logger.error('Auto compute_churn_scores:', error);
          else refetch();
        });
    }
  }, [gymId, members.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNoteSaved = (memberId, newNote) => {
    setSelected(prev => prev?.id === memberId ? { ...prev, admin_note: newNote } : prev);
  };

  const handleStatusChanged = (memberId, newStatus) => {
    setSelected(prev => prev?.id === memberId ? { ...prev, membership_status: newStatus } : prev);
  };

  const atRiskCount = members.filter(m => m.score >= 61).length;
  const watchCount = members.filter(m => m.score >= 31 && m.score < 61).length;
  const healthyCount = members.filter(m => m.score < 31).length;

  const filtered = useMemo(() => {
    let list = members;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => m.full_name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q));
    }
    if (filter === 'at-risk') list = list.filter(m => m.score >= 61);
    else if (filter === 'watch') list = list.filter(m => m.score >= 31 && m.score < 61);
    else if (filter === 'healthy') list = list.filter(m => m.score < 31);
    return list;
  }, [members, search, filter]);

  const atRiskFiltered = filtered.filter(m => m.score >= 61);

  const handleBulkFollowup = async () => {
    if (!gymId) return;
    setBulkSending(true);
    for (const m of atRiskFiltered) {
      const msg = `Hey ${m.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together.`;
      await createNotification({ profileId: m.id, gymId, type: 'churn_followup', title: 'Message from your gym', body: msg, data: { source: 'admin_bulk_followup' } });
    }
    if (atRiskFiltered.length > 0) {
      await supabase.from('churn_risk_scores').update({ followup_sent_at: new Date().toISOString() }).in('profile_id', atRiskFiltered.map(m => m.id)).eq('gym_id', gymId);
    }
    setBulkSending(false);
    setBulkConfirm(false);
  };

  const handleExport = () => {
    exportCSV({
      filename: 'members',
      columns: [
        { key: 'full_name', label: 'Name' }, { key: 'membership_status', label: 'Status' },
        { key: 'created_at', label: 'Joined' }, { key: 'last_active_at', label: 'Last Active' },
        { key: 'score', label: 'Churn Score' }, { key: 'risk_tier', label: 'Risk Tier' },
        { key: 'recentWorkouts', label: 'Workouts (14d)' },
      ],
      data: filtered,
    });
  };

  const filterOptions = [
    { key: 'all', label: 'All', count: members.length },
    { key: 'at-risk', label: 'At Risk', count: atRiskCount },
    { key: 'watch', label: 'Watch', count: watchCount },
    { key: 'healthy', label: 'Healthy', count: healthyCount },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <PageHeader
        title="Members"
        subtitle={`${members.length} total · ${atRiskCount} at risk`}
        actions={
          <>
            {filter === 'at-risk' && atRiskFiltered.length > 0 && (
              bulkConfirm ? (
                <div className="flex items-center gap-2">
                  <p className="text-[12px] text-[#9CA3AF]">Send to {atRiskFiltered.length} members?</p>
                  <button onClick={handleBulkFollowup} disabled={bulkSending}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40">
                    {bulkSending ? 'Sending…' : 'Confirm'}
                  </button>
                  <button onClick={() => setBulkConfirm(false)}
                    className="px-3 py-2 rounded-xl text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setBulkConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors">
                  <Users size={13} /> Bulk Follow-up
                </button>
              )
            )}
            <button onClick={() => setShowInvite(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors">
              <Link size={13} /> Invite Member
            </button>
          </>
        }
      />

      {/* Search + filter */}
      <div className="md:sticky md:top-0 md:z-20 md:bg-[#05070B]/95 md:backdrop-blur-xl md:-mx-8 md:px-8 md:py-3 flex flex-col sm:flex-row gap-3 mt-6 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input type="text" placeholder="Search members…" aria-label="Search members" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
        </div>
        <button onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors">
          <Download size={13} /> Export
        </button>
        <FilterBar options={filterOptions} active={filter} onChange={setFilter} />
      </div>

      {/* Member list */}
      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#6B7280] text-[14px]">No members found</p>
        </div>
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
          <div className="divide-y divide-white/4">
            {filtered.map(m => {
              const tier = getRiskTier(m.score);
              return (
                <button key={m.id} onClick={() => setSelected(m)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03] transition-all text-left group">
                  <Avatar name={m.full_name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
                      <StatusBadge status={m.membership_status} />
                      <ChurnRiskBadge member={m} navigate={navigate} />
                      {m.admin_note && <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 flex-shrink-0" title="Has note" />}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {(m.last_active_at || m.lastSessionAt)
                        ? `Active ${formatDistanceToNow(new Date(m.last_active_at ?? m.lastSessionAt), { addSuffix: true })}`
                        : 'Never active'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <div className="text-right hidden md:block">
                      <p className="text-[12px] text-[#9CA3AF]">{format(new Date(m.created_at), 'MMM yyyy')}</p>
                      <p className="text-[10px] text-[#4B5563]">joined</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-[12px] font-semibold text-[#9CA3AF]">{m.recentWorkouts}w / 14d</p>
                    </div>
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                      style={{ color: tier.color, background: tier.bg, borderColor: `${tier.color}33` }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tier.color }} />
                      {m.score}%
                    </span>
                    <ChevronRight size={14} className="text-[#4B5563]" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <MemberDetail key={selected.id} member={selected} gymId={gymId}
          onClose={() => setSelected(null)} onNoteSaved={handleNoteSaved} onStatusChanged={handleStatusChanged} />
      )}

      {showInvite && <InviteModal gymId={gymId} onClose={() => setShowInvite(false)} />}
    </div>
  );
}
