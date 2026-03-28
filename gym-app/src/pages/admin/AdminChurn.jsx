import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Search, Phone, Filter, Users, Clock, RotateCcw,
  CheckCircle, MessageSquare, Download,
} from 'lucide-react';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { fetchMembersWithChurnScores } from '../../lib/churnScore';
import { exportCSV } from '../../lib/csvExport';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';

// Shared components
import { PageHeader, Avatar, FilterBar, StatCard, SkeletonRow } from '../../components/admin';
import { ScoreBar, RiskBadge } from '../../components/admin/StatusBadge';

// Sub-components
import SendMessageModal from './components/SendMessageModal';
import WinBackModal from './components/WinBackModal';
import ContactPanel from './components/ContactPanel';

// ── Fallback scoring when v2 pipeline fails ──────────────
async function fetchChurnFallback(gymId) {
  const now = new Date();
  const MS_PER_DAY = 86400000;
  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const [membersRes, checkInsRes, sessionsRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, username, email, created_at, last_active_at, membership_status').eq('gym_id', gymId).eq('role', 'member'),
    supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', thirtyDaysAgo).order('checked_in_at', { ascending: false }),
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', fourteenDaysAgo),
  ]);

  const memberRows = membersRes.data || [];
  if (!memberRows.length) return [];

  const lastCheckInMap = {};
  (checkInsRes.data || []).forEach(r => { if (!lastCheckInMap[r.profile_id]) lastCheckInMap[r.profile_id] = r.checked_in_at; });
  const sessionsLast14 = {};
  (sessionsRes.data || []).forEach(s => { sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1; });

  const nowMs = Date.now();
  return memberRows.map(m => {
    const lastCheckIn = lastCheckInMap[m.id] ?? null;
    const lastActive = m.last_active_at ?? lastCheckIn ?? m.created_at;
    const daysInactive = Math.floor((nowMs - new Date(lastActive)) / MS_PER_DAY);
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const neverActive = !m.last_active_at && !lastCheckIn;
    const tenureMonths = (nowMs - new Date(m.created_at)) / (MS_PER_DAY * 30.44);
    const daysSinceLastCheckIn = lastCheckIn ? (nowMs - new Date(lastCheckIn)) / MS_PER_DAY : null;

    let score;
    if (neverActive || daysInactive > 30) score = 95;
    else if (daysInactive > 14) score = recentWorkouts === 0 ? 85 : 70;
    else if (daysInactive > 7) score = recentWorkouts === 0 ? 45 : 30;
    else score = Math.max(0, 20 - recentWorkouts * 5);
    score = Math.min(100, Math.max(0, score));

    const keySignals = [];
    if (neverActive) keySignals.push('Never logged a workout');
    else if (daysInactive > 30) keySignals.push('No activity in 30+ days');
    else if (daysInactive > 14) keySignals.push('No activity in 14+ days');
    if (recentWorkouts === 0 && !neverActive) keySignals.push('No workouts in last 14 days');
    if (keySignals.length === 0) keySignals.push('Engagement looks healthy');

    return {
      ...m,
      username: m.username || m.full_name,
      churnScore: score,
      riskTier: score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low',
      keySignals,
      keySignal: keySignals[0],
      daysSinceLastCheckIn,
      lastCheckInAt: lastCheckIn,
      tenureMonths,
      velocityTrend: 'stable',
      velocityLabel: 'Not enough history',
    };
  }).sort((a, b) => b.churnScore - a.churnScore);
}

// ── Data fetcher ──────────────────────────────────────────
async function fetchChurnData(gymId) {
  let scored;
  try {
    scored = await fetchMembersWithChurnScores(gymId, supabase);
  } catch (err) {
    logger.error('AdminChurn: v2 scoring failed, using fallback:', err);
    scored = [];
  }

  // If v2 pipeline returned empty, use fallback estimation
  if (!scored || scored.length === 0) {
    try {
      scored = await fetchChurnFallback(gymId);
    } catch (err) {
      logger.error('AdminChurn: fallback scoring failed:', err);
      scored = [];
    }
  }

  const [challengeRes, winBackRes] = await Promise.all([
    supabase.from('challenges').select('id, name').eq('gym_id', gymId).gte('end_date', new Date().toISOString()).order('name'),
    supabase.from('win_back_attempts').select('id, user_id, message, offer, outcome, created_at').eq('gym_id', gymId).order('created_at', { ascending: false }),
  ]);
  return {
    members: scored,
    challenges: challengeRes.data || [],
    winBackAttempts: !winBackRes.error ? (winBackRes.data || []) : [],
  };
}

const outcomeConfig = {
  returned:       { label: 'Returned',       color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  no_response:    { label: 'No Response',    color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)' },
  still_inactive: { label: 'Still Inactive', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  pending:        { label: 'Pending',        color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
};

export default function AdminChurn() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  // SECURITY: Always derive gymId from the authenticated user's profile.
  // Never accept gymId from URL params, query strings, or other user input.
  const gymId = profile?.gym_id;
  const adminId = profile?.id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  useEffect(() => { document.title = 'Admin - Churn | TuGymPR'; }, []);

  const [tab, setTab] = useState('at-risk');
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [msgModal, setMsgModal] = useState(null);
  const [winBackModal, setWinBackModal] = useState(null);
  const [contactPanel, setContactPanel] = useState(null);
  const [savingOutcome, setSavingOutcome] = useState(null);

  const [contactedMap, setContactedMap] = useState(() => {
    try { const s = localStorage.getItem(`churn_contacted_${gymId}`); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  });
  const contactedIds = useMemo(() => new Set(Object.keys(contactedMap)), [contactedMap]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: adminKeys.churn.all(gymId),
    queryFn: () => fetchChurnData(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Auto-trigger server-side churn scoring once to populate DB for velocity/history
  const churnComputeTriggered = useRef(false);
  useEffect(() => {
    if (!gymId || churnComputeTriggered.current) return;
    churnComputeTriggered.current = true;
    supabase.rpc('compute_churn_scores', { p_gym_id: gymId })
      .then(({ error }) => {
        if (error) logger.error('Auto compute_churn_scores:', error);
        else refetch();
      });
  }, [gymId]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = data?.members || [];
  const challenges = data?.challenges || [];
  const [winBackAttempts, setWinBackAttempts] = useState([]);

  // Sync win-back attempts from query
  useEffect(() => {
    if (data?.winBackAttempts) setWinBackAttempts(data.winBackAttempts);
  }, [data?.winBackAttempts]);

  // Derived lists
  const atRiskMembers = useMemo(() => {
    let list = members.filter(m => m.churnScore >= 30);
    if (riskFilter === 'critical') list = list.filter(m => m.churnScore >= 80);
    if (riskFilter === 'high') list = list.filter(m => m.churnScore >= 55);
    if (riskFilter === 'medium') list = list.filter(m => m.churnScore >= 30 && m.churnScore < 55);
    if (search) { const q = search.toLowerCase(); list = list.filter(m => m.full_name.toLowerCase().includes(q)); }
    return list;
  }, [members, riskFilter, search]);

  const churnedMembers = useMemo(() => {
    return members.filter(m => m.daysSinceLastCheckIn === null || m.daysSinceLastCheckIn >= 30);
  }, [members]);

  const criticalCount = members.filter(m => m.churnScore >= 80).length;
  const highRiskCount = members.filter(m => m.churnScore >= 55 && m.churnScore < 80).length;
  const medRiskCount = members.filter(m => m.churnScore >= 30 && m.churnScore < 55).length;

  // Actions
  const handleMarkContacted = (memberId) => {
    setContactedMap(prev => {
      const next = { ...prev, [memberId]: new Date().toISOString() };
      try { localStorage.setItem(`churn_contacted_${gymId}`, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleUnmarkContacted = (memberId) => {
    setContactedMap(prev => {
      const next = { ...prev };
      delete next[memberId];
      try { localStorage.setItem(`churn_contacted_${gymId}`, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleAddToChallenge = async (member, challengeId) => {
    if (!challengeId) return;
    await supabase.from('challenge_participants').upsert(
      { profile_id: member.id, challenge_id: challengeId, gym_id: gymId, score: 0 },
      { onConflict: 'profile_id,challenge_id', ignoreDuplicates: true }
    );
  };

  const handleMarkOutcome = async (attemptId, outcome) => {
    setSavingOutcome(attemptId);
    try {
      await supabase.from('win_back_attempts').update({ outcome }).eq('id', attemptId);
      setWinBackAttempts(prev => prev.map(a => a.id === attemptId ? { ...a, outcome } : a));
    } catch (_) {} finally { setSavingOutcome(null); }
  };

  const handleExport = () => {
    const visibleData = tab === 'at-risk' ? atRiskMembers : tab === 'churned' ? churnedMembers : winBackAttempts;
    exportCSV({
      filename: `churn-${tab}`,
      columns: [
        { key: 'full_name', label: 'Name' }, { key: 'churnScore', label: 'Score' },
        { key: 'risk_tier', label: 'Risk Tier' }, { key: 'keySignals', label: 'Key Signals' },
        { key: 'daysSinceLastCheckIn', label: 'Days Inactive' }, { key: 'velocityLabel', label: 'Velocity' },
      ],
      data: visibleData,
    });
  };

  const TABS = [
    { key: 'at-risk', label: 'At Risk', count: atRiskMembers.length },
    { key: 'churned', label: 'Churned', count: churnedMembers.length },
    { key: 'win-back', label: 'Win-Back', count: winBackAttempts.length },
  ];

  const loading = isLoading;

  // Guard: only admins/super_admins with a valid gym_id may access this page
  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[#EF4444] text-[14px] font-semibold">Access denied. You are not authorized to view this page.</p>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Churn Intelligence"
        subtitle={loading ? 'Analyzing member activity…' : `${criticalCount} critical · ${highRiskCount} high risk · ${medRiskCount} medium risk · ${churnedMembers.length} churned`}
        actions={
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors">
            <Download size={13} /> Export
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-6">
        {[
          { label: 'Critical', value: loading ? '—' : criticalCount, color: '#DC2626', sub: 'score ≥ 80' },
          { label: 'High Risk', value: loading ? '—' : highRiskCount, color: '#EF4444', sub: 'score 55–79' },
          { label: 'Medium Risk', value: loading ? '—' : medRiskCount, color: '#F59E0B', sub: 'score 30–54' },
          { label: 'Churned', value: loading ? '—' : churnedMembers.length, color: '#9CA3AF', sub: '30+ days gone' },
        ].map(card => (
          <div key={card.label} className="bg-[#0F172A] border border-white/8 rounded-[14px] p-4 border-l-2" style={{ borderLeftColor: card.color }}>
            <p className="text-[26px] font-bold leading-none" style={{ color: card.color }}>{card.value}</p>
            <p className="text-[12px] font-semibold text-[#E5E7EB] mt-1.5">{card.label}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="sticky top-0 z-20 bg-[#05070B]/95 backdrop-blur-xl -mx-4 md:-mx-8 px-4 md:px-8 py-3 mb-4 border-b border-white/6">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
                tab === t.key ? 'bg-[#D4AF37]/12 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/4'
              }`}>
              {t.label}
              {t.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/8 text-[#6B7280]'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* AT RISK TAB */}
      {tab === 'at-risk' && (
        <div>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
              <input type="text" placeholder="Search members…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <FilterBar
              options={[{ key: 'all', label: 'All' }, { key: 'critical', label: 'Critical' }, { key: 'high', label: 'High' }, { key: 'medium', label: 'Medium' }]}
              active={riskFilter} onChange={setRiskFilter}
            />
          </div>

          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : atRiskMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={22} className="text-[#10B981]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">No at-risk members</p>
              <p className="text-[13px] text-[#6B7280]">Your member retention is looking healthy right now.</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden divide-y divide-white/4">
              {atRiskMembers.map(m => {
                const isContacted = contactedIds.has(m.id);
                return (
                  <div key={m.id} className="px-4 py-4 hover:bg-white/[0.03] transition-all">
                    <div className="flex items-start gap-3">
                      <Avatar name={m.full_name} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-[14px] font-semibold text-[#E5E7EB]">{m.full_name}</p>
                          <RiskBadge tier={m.churnScore >= 80 ? 'critical' : m.churnScore >= 55 ? 'high' : 'medium'} />
                          {isContacted && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20">Contacted</span>
                          )}
                        </div>
                        <div className="mb-2"><ScoreBar score={m.churnScore} /></div>
                        <div className="mb-1 space-y-0.5">
                          {(m.keySignals || [m.keySignal]).slice(0, 3).map((sig, i) => (
                            <p key={i} className="text-[12px] text-[#9CA3AF]">
                              <span className="text-[#6B7280]">{i === 0 ? 'Signal: ' : '· '}</span>{sig}
                            </p>
                          ))}
                        </div>
                        <p className="text-[11px] text-[#6B7280]">
                          {m.daysSinceLastCheckIn === null ? 'Never checked in' : m.daysSinceLastCheckIn < 1 ? 'Checked in today' : `Last visit ${Math.round(m.daysSinceLastCheckIn)}d ago`}
                          {' · '}{Math.round(m.tenureMonths)}mo tenure
                          {m.velocityTrend && m.velocityTrend !== 'stable' && (
                            <span className={m.velocityTrend === 'rising' ? 'text-[#EF4444] ml-1.5' : 'text-[#10B981] ml-1.5'}>
                              {m.velocityTrend === 'rising' ? '↑' : '↓'} {m.velocityLabel}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 pl-12 flex-wrap">
                      <button onClick={() => setMsgModal(m)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors">
                        <MessageSquare size={12} /> Message
                      </button>
                      {challenges.length > 0 && (
                        <select defaultValue="" onChange={e => handleAddToChallenge(m, e.target.value)}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#1E293B] text-[#9CA3AF] border border-white/8 outline-none focus:border-[#D4AF37]/40 cursor-pointer hover:border-white/12 transition-colors">
                          <option value="" disabled>+ Add to Challenge</option>
                          {challenges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => setContactPanel(m)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                          isContacted ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20 hover:bg-[#10B981]/18' : 'bg-white/4 text-[#9CA3AF] border-white/8 hover:text-[#E5E7EB]'
                        }`}>
                        <Phone size={12} /> {isContacted ? 'Contacted' : 'Contact'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CHURNED TAB */}
      {tab === 'churned' && (
        <div>
          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : churnedMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
                <Users size={22} className="text-[#10B981]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">No churned members</p>
              <p className="text-[13px] text-[#6B7280]">All members have been active in the last 30 days.</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Member</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">Last Seen</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">Tenure</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Action</p>
              </div>
              <div className="divide-y divide-white/4">
                {churnedMembers.map(m => {
                  const lastSeen = m.lastCheckInAt ? formatDistanceToNow(new Date(m.lastCheckInAt), { addSuffix: true }) : 'Never checked in';
                  const tenureLabel = m.tenureMonths < 1 ? 'Less than 1 month' : `${Math.round(m.tenureMonths)} months`;
                  return (
                    <div key={m.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={m.full_name} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
                          <p className="text-[11px] text-[#6B7280] sm:hidden">{lastSeen}</p>
                        </div>
                      </div>
                      <div className="hidden sm:block text-right"><p className="text-[12px] text-[#9CA3AF]">{lastSeen}</p></div>
                      <div className="hidden sm:block text-right"><p className="text-[12px] text-[#9CA3AF]">{tenureLabel}</p></div>
                      <button onClick={() => setWinBackModal(m)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors flex-shrink-0">
                        <RotateCcw size={12} /> Win Back
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* WIN-BACK TAB */}
      {tab === 'win-back' && (
        <div>
          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : winBackAttempts.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4">
                <RotateCcw size={22} className="text-[#D4AF37]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">No win-back attempts yet</p>
              <p className="text-[13px] text-[#6B7280]">Use the Churned tab to send win-back messages to inactive members.</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Member / Message</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Date</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Outcome</p>
              </div>
              <div className="divide-y divide-white/4">
                {winBackAttempts.map(attempt => {
                  const m = members.find(mem => mem.id === attempt.user_id);
                  const memberName = m?.full_name ?? 'Unknown Member';
                  const outcome = attempt.outcome ?? 'pending';
                  const outcomeCfg = outcomeConfig[outcome] ?? outcomeConfig.pending;
                  const isSaving = savingOutcome === attempt.id;

                  return (
                    <div key={attempt.id} className="px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <div className="grid grid-cols-[1fr_auto_auto] items-start gap-4">
                        <div>
                          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-0.5">{memberName}</p>
                          <p className="text-[11px] text-[#6B7280] line-clamp-2">{attempt.message}</p>
                          {attempt.offer && <p className="text-[11px] text-[#D4AF37] mt-0.5">Offer: {attempt.offer}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[12px] text-[#9CA3AF]">{format(new Date(attempt.created_at), 'MMM d')}</p>
                          <p className="text-[10px] text-[#4B5563]">{format(new Date(attempt.created_at), 'yyyy')}</p>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="text-[11px] font-semibold px-2 py-1 rounded-full border"
                            style={{ color: outcomeCfg.color, background: outcomeCfg.bg, borderColor: `${outcomeCfg.color}33` }}>
                            {outcomeCfg.label}
                          </span>
                        </div>
                      </div>
                      {outcome !== 'returned' && (
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => handleMarkOutcome(attempt.id, 'returned')} disabled={isSaving}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 hover:bg-[#10B981]/18 transition-colors disabled:opacity-40">
                            <CheckCircle size={11} /> Mark Returned
                          </button>
                          {outcome !== 'no_response' && (
                            <button onClick={() => handleMarkOutcome(attempt.id, 'no_response')} disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors disabled:opacity-40">
                              No Response
                            </button>
                          )}
                          {outcome !== 'still_inactive' && (
                            <button onClick={() => handleMarkOutcome(attempt.id, 'still_inactive')} disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F59E0B]/8 text-[#F59E0B] border border-[#F59E0B]/15 hover:bg-[#F59E0B]/15 transition-colors disabled:opacity-40">
                              Still Inactive
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {msgModal && <SendMessageModal member={msgModal} gymId={gymId} adminId={adminId} onClose={() => setMsgModal(null)} onSent={() => { setMsgModal(null); handleMarkContacted(msgModal.id); }} />}
      {winBackModal && <WinBackModal member={winBackModal} gymId={gymId} adminId={adminId} onClose={() => setWinBackModal(null)}
        onSent={() => { setWinBackModal(null); refetch(); }} />}
      {contactPanel && <ContactPanel member={contactPanel} gymId={gymId} adminId={adminId}
        isContacted={contactedIds.has(contactPanel.id)}
        contactedAt={contactedMap[contactPanel.id]}
        onMarkContacted={handleMarkContacted}
        onUnmarkContacted={handleUnmarkContacted}
        onOpenMessage={() => { setContactPanel(null); setMsgModal(contactPanel); }}
        onClose={() => setContactPanel(null)} />}
    </div>
  );
}
