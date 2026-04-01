import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Search, Phone, Filter, Users, Clock, RotateCcw,
  CheckCircle, MessageSquare, Download, Square, CheckSquare, Send,
  UserPlus, X, Sparkles, FlaskConical, Trophy, StopCircle, Plus,
} from 'lucide-react';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { fetchMembersWithChurnScores } from '../../lib/churnScore';
import { exportCSV } from '../../lib/csvExport';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';

// Shared components
import { PageHeader, Avatar, FilterBar, StatCard, SkeletonRow, AdminTable, AdminPageShell } from '../../components/admin';
import { ScoreBar, RiskBadge } from '../../components/admin/StatusBadge';

// Sub-components
import SendMessageModal from './components/SendMessageModal';
import WinBackModal from './components/WinBackModal';
import ContactPanel from './components/ContactPanel';
import CreateCampaignModal from './components/CreateCampaignModal';

// ── Fallback scoring when v2 pipeline fails ──────────────
async function fetchChurnFallback(gymId) {
  const now = new Date();
  const MS_PER_DAY = 86400000;
  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const [membersRes, checkInsRes, sessionsRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, username, created_at').eq('gym_id', gymId).eq('role', 'member'),
    supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', thirtyDaysAgo).order('checked_in_at', { ascending: false }),
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', fourteenDaysAgo),
  ]);

  const memberRows = membersRes.data || [];
  logger.debug('[ChurnFallback] gymId:', gymId, 'membersRes.error:', membersRes.error, 'memberRows:', memberRows.length);
  if (!memberRows.length) return [];

  const lastCheckInMap = {};
  (checkInsRes.data || []).forEach(r => { if (!lastCheckInMap[r.profile_id]) lastCheckInMap[r.profile_id] = r.checked_in_at; });
  const sessionsLast14 = {};
  (sessionsRes.data || []).forEach(s => { sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1; });

  const nowMs = Date.now();
  return memberRows.map(m => {
    const lastCheckIn = lastCheckInMap[m.id] ?? null;
    const lastActive = lastCheckIn ?? m.created_at;
    const daysInactive = Math.floor((nowMs - new Date(lastActive)) / MS_PER_DAY);
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const neverActive = !lastCheckIn && recentWorkouts === 0;
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

// ── Auto-detect returned members in win-back attempts ────
async function autoDetectReturns(winBackAttempts, gymId) {
  const pending = winBackAttempts.filter(a => a.outcome === 'pending' || a.outcome === 'no_response');
  if (!pending.length) return { attempts: winBackAttempts, autoDetected: [] };

  const memberIds = [...new Set(pending.map(a => a.user_id))];

  const [sessionsRes, checkInsRes] = await Promise.all([
    supabase.from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId).eq('status', 'completed')
      .in('profile_id', memberIds)
      .order('started_at', { ascending: true }),
    supabase.from('check_ins')
      .select('profile_id, checked_in_at')
      .eq('gym_id', gymId)
      .in('profile_id', memberIds)
      .order('checked_in_at', { ascending: true }),
  ]);

  const sessions = sessionsRes.data || [];
  const checkIns = checkInsRes.data || [];
  const autoDetected = [];
  const toUpdate = [];

  const updated = winBackAttempts.map(a => {
    if (a.outcome !== 'pending' && a.outcome !== 'no_response') return a;

    const memberSessions = sessions.filter(s => s.profile_id === a.user_id && new Date(s.started_at) > new Date(a.created_at));
    const memberCheckIns = checkIns.filter(c => c.profile_id === a.user_id && new Date(c.checked_in_at) > new Date(a.created_at));

    if (memberSessions.length > 0 || memberCheckIns.length > 0) {
      const earliestReturn = [...memberSessions.map(s => s.started_at), ...memberCheckIns.map(c => c.checked_in_at)]
        .sort((x, y) => new Date(x) - new Date(y))[0];

      toUpdate.push(a.id);
      autoDetected.push({ attemptId: a.id, memberId: a.user_id, returnedAt: earliestReturn });
      return { ...a, outcome: 'returned', _autoDetected: true, _returnedAt: earliestReturn };
    }
    return a;
  });

  if (toUpdate.length > 0) {
    try {
      await Promise.all(toUpdate.map(id =>
        supabase.from('win_back_attempts').update({ outcome: 'returned' }).eq('id', id)
      ));
    } catch (err) {
      logger.error('Auto-detect returns: batch update failed', err);
    }
  }

  return { attempts: updated, autoDetected };
}

// ── Data fetcher ──────────────────────────────────────────
async function fetchChurnData(gymId) {
  let scored;
  try {
    scored = await fetchMembersWithChurnScores(gymId, supabase);
    logger.debug('[Churn] v2 scoring returned:', scored?.length, 'members');
  } catch (err) {
    logger.error('[Churn] v2 scoring THREW:', err);
    scored = [];
  }

  if (!scored || scored.length === 0) {
    logger.debug('[Churn] v2 empty, trying fallback...');
    try {
      scored = await fetchChurnFallback(gymId);
      logger.debug('[Churn] fallback returned:', scored?.length, 'members');
    } catch (err) {
      logger.error('[Churn] fallback THREW:', err);
      scored = [];
    }
  }

  // Core queries — challenges + win-backs (original, always work)
  let challenges = [];
  let winBackRows = [];
  let contactLogRows = [];
  let campaignRows = [];

  try {
    const [challengeRes, winBackRes] = await Promise.all([
      supabase.from('challenges').select('id, name').eq('gym_id', gymId).gte('end_date', new Date().toISOString()).order('name'),
      supabase.from('win_back_attempts').select('id, user_id, message, offer, outcome, created_at').eq('gym_id', gymId).order('created_at', { ascending: false }),
    ]);
    challenges = challengeRes.data || [];
    winBackRows = winBackRes.data || [];
  } catch (err) {
    logger.error('AdminChurn: core queries failed:', err);
  }

  // Optional queries — tables/columns may not exist before migrations
  try {
    const r = await supabase.from('admin_contact_log').select('id, admin_id, member_id, method, note, created_at').eq('gym_id', gymId).order('created_at', { ascending: false });
    if (!r.error) contactLogRows = r.data || [];
  } catch (_) {}

  try {
    const r = await supabase.from('win_back_attempts').select('id, variant, message_template, responded_at').eq('gym_id', gymId);
    if (!r.error && r.data) {
      const extMap = {};
      for (const row of r.data) extMap[row.id] = row;
      winBackRows = winBackRows.map(w => ({ ...w, ...(extMap[w.id] || {}) }));
    }
  } catch (_) {}

  try {
    const r = await supabase.from('winback_campaigns').select('*').eq('gym_id', gymId).order('created_at', { ascending: false });
    if (!r.error && r.data) campaignRows = r.data;
  } catch (_) {}

  // Auto-detect returned members
  let processedWinBacks = winBackRows;
  let autoDetected = [];
  try {
    const result = await autoDetectReturns(winBackRows, gymId);
    processedWinBacks = result.attempts;
    autoDetected = result.autoDetected;
  } catch (_) {}

  return {
    members: scored,
    challenges,
    winBackAttempts: processedWinBacks,
    autoDetectedReturns: autoDetected,
    contactLogs: contactLogRows,
    campaigns: campaignRows,
  };
}

const outcomeConfig = {
  returned:       { label: 'Returned',       color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  no_response:    { label: 'No Response',    color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)' },
  still_inactive: { label: 'Still Inactive', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  pending:        { label: 'Pending',        color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
};

const METHOD_LABELS = {
  in_app_message: 'Message',
  email: 'Email',
  push: 'Push',
  sms: 'SMS',
  win_back: 'Win-Back',
  manual: 'Manual',
};

// ── Bulk Message Modal ────────────────────────────────────
function BulkMessageModal({ members, gymId, adminId, onClose, onSent }) {
  const { t } = useTranslation('pages');
  const [msg, setMsg] = useState(t('adminChurn.bulk.defaultMessage', { defaultValue: "Hey! We noticed you haven't been in for a while. We miss you — come back and crush your goals!" }));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      const notifications = members.map(m => ({
        profile_id: m.id, gym_id: gymId, type: 'admin_message',
        title: 'Message from your gym', body: msg, data: { source: 'bulk_churn_intel' },
      }));
      await supabase.from('notifications').insert(notifications);

      const winBackLogs = members.map(m => ({
        user_id: m.id, gym_id: gymId, admin_id: adminId,
        message: msg, offer: null, outcome: 'pending', created_at: new Date().toISOString(),
      }));
      await supabase.from('win_back_attempts').insert(winBackLogs);

      // Log contacts to admin_contact_log
      const contactEntries = members.map(m => ({
        admin_id: adminId, member_id: m.id, gym_id: gymId,
        method: 'in_app_message', note: 'Bulk message from churn intelligence',
      }));
      await supabase.from('admin_contact_log').insert(contactEntries);

      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      logger.error('Bulk message failed', err);
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-[#0F172A] border border-white/10 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-[#D4AF37]" />
            <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('adminChurn.bulk.messageTitle', { defaultValue: 'Bulk Message' })}</h3>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-[12px] text-[#9CA3AF]">{t('adminChurn.bulk.messageSubtitle', { count: members.length, defaultValue: `Sending to ${members.length} member(s)` })}</p>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          <p className="text-[11px] text-[#4B5563]">{t('adminChurn.bulk.messageHint', { defaultValue: 'Each member will receive this as an in-app notification.' })}</p>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-white/6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
            {t('adminChurn.bulk.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 ${sent ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/25' : 'bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20'}`}>
            {sent ? <><CheckCircle size={14} /> {t('adminChurn.bulk.sent', { defaultValue: 'Sent!' })}</> : sending ? t('adminChurn.bulk.sending', { defaultValue: 'Sending...' }) : <><Send size={13} /> {t('adminChurn.bulk.sendAll', { count: members.length, defaultValue: `Send to ${members.length}` })}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminChurn() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');

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

  // A/B campaign state
  const [createCampaignModal, setCreateCampaignModal] = useState(false);

  // Bulk action state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMsgModal, setBulkMsgModal] = useState(false);
  const [bulkChallengeId, setBulkChallengeId] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: adminKeys.churn.all(gymId),
    queryFn: () => fetchChurnData(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

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
  const contactLogs = data?.contactLogs || [];
  const [winBackAttempts, setWinBackAttempts] = useState([]);

  useEffect(() => {
    if (data?.winBackAttempts) setWinBackAttempts(data.winBackAttempts);
  }, [data?.winBackAttempts]);

  // Build contacted map from DB contact logs (keyed by member_id -> latest log)
  const contactedMap = useMemo(() => {
    const map = {};
    for (const log of contactLogs) {
      if (!map[log.member_id] || new Date(log.created_at) > new Date(map[log.member_id].created_at)) {
        map[log.member_id] = log;
      }
    }
    return map;
  }, [contactLogs]);
  const contactedIds = useMemo(() => new Set(Object.keys(contactedMap)), [contactedMap]);

  const campaigns = data?.campaigns || [];
  const activeCampaign = useMemo(() => campaigns.find(c => c.is_active), [campaigns]);

  // Campaign stats: compute per-variant metrics from win_back_attempts
  const campaignStats = useMemo(() => {
    if (!campaigns.length) return {};
    const stats = {};
    for (const campaign of campaigns) {
      const cAttempts = winBackAttempts.filter(a => a.message_template === campaign.id);
      const aAttempts = cAttempts.filter(a => a.variant === 'A');
      const bAttempts = cAttempts.filter(a => a.variant === 'B');
      const calcStats = (attempts) => {
        const sent = attempts.length;
        const responded = attempts.filter(a => a.responded_at).length;
        const returned = attempts.filter(a => a.outcome === 'returned').length;
        return {
          sent,
          responded,
          returned,
          responseRate: sent > 0 ? Math.round((responded / sent) * 100) : 0,
          returnRate: sent > 0 ? Math.round((returned / sent) * 100) : 0,
        };
      };
      stats[campaign.id] = { a: calcStats(aAttempts), b: calcStats(bAttempts) };
    }
    return stats;
  }, [campaigns, winBackAttempts]);

  const handleEndCampaign = async (campaignId, winnerVariant) => {
    try {
      await supabase.from('winback_campaigns').update({
        is_active: false, ended_at: new Date().toISOString(),
      }).eq('id', campaignId);
      refetch();
    } catch (err) { logger.error('Failed to end campaign', err); }
  };

  const atRiskMembers = useMemo(() => {
    let list = members.filter(m => m.churnScore >= 30);
    if (riskFilter === 'critical') list = list.filter(m => m.churnScore >= 80);
    if (riskFilter === 'high') list = list.filter(m => m.churnScore >= 55);
    if (riskFilter === 'medium') list = list.filter(m => m.churnScore >= 30 && m.churnScore < 55);
    if (search) { const q = search.toLowerCase(); list = list.filter(m => m.full_name.toLowerCase().includes(q)); }
    return list;
  }, [members, riskFilter, search]);

  const churnedMembers = useMemo(() => {
    const MS_PER_DAY = 86400000;
    return members.filter((m) => {
      const joinDays = (Date.now() - new Date(m.created_at)) / MS_PER_DAY;
      if (joinDays < 7) return false;
      const d = m.daysSinceLastActivity;
      if (d != null) return d >= 30;
      return joinDays >= 30;
    });
  }, [members]);

  const criticalCount = members.filter(m => m.churnScore >= 80).length;
  const highRiskCount = members.filter(m => m.churnScore >= 55 && m.churnScore < 80).length;
  const medRiskCount = members.filter(m => m.churnScore >= 30 && m.churnScore < 55).length;

  // Attribution breakdown for win-back tab
  const attributionStats = useMemo(() => {
    const stats = {};
    for (const attempt of winBackAttempts) {
      const relatedLogs = contactLogs.filter(
        l => l.member_id === attempt.user_id
          && Math.abs(new Date(l.created_at) - new Date(attempt.created_at)) < 3600000
      );
      const method = relatedLogs.length > 0 ? relatedLogs[0].method : 'in_app_message';
      if (!stats[method]) stats[method] = { sent: 0, returned: 0 };
      stats[method].sent++;
      if (attempt.outcome === 'returned') stats[method].returned++;
    }
    return stats;
  }, [winBackAttempts, contactLogs]);

  // Bulk action helpers
  const selectedCount = selectedIds.size;
  const selectedMembers = useMemo(() => atRiskMembers.filter(m => selectedIds.has(m.id)), [atRiskMembers, selectedIds]);
  const toggleSelected = (id) => { setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const selectAllByTier = (tier) => {
    const tierMembers = atRiskMembers.filter(m => {
      if (tier === 'critical') return m.churnScore >= 80;
      if (tier === 'high') return m.churnScore >= 55 && m.churnScore < 80;
      if (tier === 'medium') return m.churnScore >= 30 && m.churnScore < 55;
      return false;
    });
    setSelectedIds(prev => { const next = new Set(prev); tierMembers.forEach(m => next.add(m.id)); return next; });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkAddToChallenge = async (challengeId) => {
    if (!challengeId || selectedMembers.length === 0) return;
    setBulkActionLoading(true);
    try {
      const rows = selectedMembers.map(m => ({ profile_id: m.id, challenge_id: challengeId, gym_id: gymId, score: 0 }));
      await supabase.from('challenge_participants').upsert(rows, { onConflict: 'profile_id,challenge_id', ignoreDuplicates: true });
      clearSelection();
    } catch (err) { logger.error('Bulk add to challenge failed', err); }
    finally { setBulkActionLoading(false); setBulkChallengeId(''); }
  };

  const handleBulkMarkContacted = async () => {
    try {
      const entries = selectedMembers.map(m => ({ admin_id: adminId, member_id: m.id, gym_id: gymId, method: 'manual', note: 'Bulk mark contacted' }));
      await supabase.from('admin_contact_log').insert(entries);
      clearSelection();
      refetch();
    } catch (err) { logger.error('Bulk mark contacted failed', err); }
  };

  // DB-backed contact logging
  const handleMarkContacted = useCallback(async (memberId, method = 'manual', note = null) => {
    try {
      await supabase.from('admin_contact_log').insert({ admin_id: adminId, member_id: memberId, gym_id: gymId, method, note });
      refetch();
    } catch (err) { logger.error('Failed to log contact', err); }
  }, [adminId, gymId, refetch]);

  const handleUnmarkContacted = useCallback(async (memberId) => {
    try {
      await supabase.from('admin_contact_log').delete().eq('member_id', memberId).eq('gym_id', gymId);
      refetch();
    } catch (err) { logger.error('Failed to unmark contact', err); }
  }, [gymId, refetch]);

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
    { key: 'at-risk', label: t('admin.churn.tabAtRisk', 'At Risk'), count: atRiskMembers.length },
    { key: 'churned', label: t('admin.churn.tabChurned', 'Churned'), count: churnedMembers.length },
    { key: 'win-back', label: t('admin.churn.tabWinBack', 'Win-Back'), count: winBackAttempts.length },
  ];

  const atRiskTableColumns = [
    {
      key: 'select',
      label: '',
      width: '52px',
      render: (m) => (
        <button onClick={(e) => { e.stopPropagation(); toggleSelected(m.id); }} className="text-[#6B7280] hover:text-[#D4AF37] transition-colors">
          {selectedIds.has(m.id) ? <CheckSquare size={18} className="text-[#D4AF37]" /> : <Square size={18} />}
        </button>
      ),
    },
    {
      key: 'full_name',
      label: t('admin.churn.colMember', 'Member'),
      sortable: true,
      sortValue: (m) => m.full_name?.toLowerCase() || '',
      render: (m) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={m.full_name} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
            <p className="text-[12px] text-[#6B7280]">
              {m.daysSinceLastCheckIn === null ? 'Never checked in' : m.daysSinceLastCheckIn < 1 ? 'Checked in today' : `Last visit ${Math.round(m.daysSinceLastCheckIn)}d ago`}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'churnScore',
      label: t('admin.churn.score', 'Score'),
      sortable: true,
      sortValue: (m) => m.churnScore ?? 0,
      render: (m) => (
        <div className="min-w-[140px]">
          <ScoreBar score={m.churnScore} />
        </div>
      ),
    },
    {
      key: 'riskTier',
      label: t('admin.churn.risk', 'Risk'),
      sortable: true,
      render: (m) => <RiskBadge tier={m.churnScore >= 80 ? 'critical' : m.churnScore >= 55 ? 'high' : 'medium'} />,
    },
    {
      key: 'keySignals',
      label: t('admin.churn.signals', 'Signals'),
      render: (m) => (
        <p className="text-[12px] text-[#9CA3AF] max-w-[320px] truncate">
          {(m.keySignals || [m.keySignal]).slice(0, 2).join(' · ')}
        </p>
      ),
    },
    {
      key: 'actions',
      label: t('admin.churn.colAction', 'Action'),
      render: (m) => {
        const isContacted = contactedIds.has(m.id);
        return (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setMsgModal(m); }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors"
            >
              {t('admin.churn.message', 'Message')}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setContactPanel(m); }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${isContacted ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20' : 'bg-white/4 text-[#9CA3AF] border-white/8 hover:text-[#E5E7EB]'}`}
            >
              {isContacted ? t('admin.churn.contacted', 'Contacted') : t('admin.churn.contact', 'Contact')}
            </button>
          </div>
        );
      },
    },
  ];

  const loading = isLoading;

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[#EF4444] text-[14px] font-semibold">Access denied. You are not authorized to view this page.</p>
      </div>
    );
  }

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.churn.title', 'Churn Intelligence')}
        subtitle={loading ? t('admin.churn.analyzing', 'Analyzing member activity…') : `${criticalCount} ${t('admin.churn.critical', 'critical')} · ${highRiskCount} ${t('admin.churn.highRisk', 'high risk')} · ${medRiskCount} ${t('admin.churn.mediumRisk', 'medium risk')} · ${churnedMembers.length} ${t('admin.churn.churned', 'churned')}`}
        actions={
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors">
            <Download size={13} /> {t('admin.churn.export', 'Export')}
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-6">
        {[
          { label: t('admin.churn.critical', 'Critical'), value: loading ? '—' : criticalCount, color: '#DC2626', sub: t('admin.churn.scoreGte80', 'score ≥ 80') },
          { label: t('admin.churn.highRisk', 'High Risk'), value: loading ? '—' : highRiskCount, color: '#EF4444', sub: t('admin.churn.score5579', 'score 55–79') },
          { label: t('admin.churn.mediumRisk', 'Medium Risk'), value: loading ? '—' : medRiskCount, color: '#F59E0B', sub: t('admin.churn.score3054', 'score 30–54') },
          { label: t('admin.churn.churned', 'Churned'), value: loading ? '—' : churnedMembers.length, color: '#9CA3AF', sub: t('admin.churn.thirtyPlusDays', '30+ days gone') },
        ].map(card => (
          <div key={card.label} className="bg-[#0F172A] border border-white/8 rounded-[14px] p-4 border-l-2 overflow-hidden" style={{ borderLeftColor: card.color }}>
            <p className="text-[24px] font-bold leading-none truncate" style={{ color: card.color }}>{card.value}</p>
            <p className="text-[12px] font-semibold text-[#E5E7EB] mt-1.5 truncate">{card.label}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* A/B CAMPAIGN MANAGER */}
      {campaigns.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical size={15} className="text-[#D4AF37]" />
              <p className="text-[14px] font-semibold text-[#E5E7EB]">{t('admin.churn.ab.title', 'A/B Campaigns')}</p>
            </div>
            <button onClick={() => setCreateCampaignModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors">
              <Plus size={13} /> {t('admin.churn.ab.newCampaign', 'New Campaign')}
            </button>
          </div>
          {campaigns.map(campaign => {
            const stats = campaignStats[campaign.id] || { a: { sent: 0, responded: 0, returned: 0, responseRate: 0, returnRate: 0 }, b: { sent: 0, responded: 0, returned: 0, responseRate: 0, returnRate: 0 } };
            const aWins = stats.a.returnRate > stats.b.returnRate;
            const bWins = stats.b.returnRate > stats.a.returnRate;
            const tied = stats.a.returnRate === stats.b.returnRate;
            const totalSent = stats.a.sent + stats.b.sent;

            return (
              <div key={campaign.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
                  <div className="flex items-center gap-2.5">
                    <FlaskConical size={14} className="text-[#D4AF37]" />
                    <div>
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">{campaign.name}</p>
                      <p className="text-[10px] text-[#6B7280]">
                        {t(`admin.churn.campaign.tier.${campaign.target_tier}`, campaign.target_tier)} {t('admin.churn.ab.tier', 'tier')}
                        {' · '}{totalSent} {t('admin.churn.ab.sent', 'sent')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${campaign.is_active ? 'bg-[#10B981]/12 text-[#10B981] border border-[#10B981]/20' : 'bg-white/6 text-[#6B7280] border border-white/8'}`}>
                      {campaign.is_active ? t('admin.churn.ab.active', 'Active') : t('admin.churn.ab.ended', 'Ended')}
                    </span>
                    {campaign.is_active && totalSent >= 2 && (
                      <button onClick={() => handleEndCampaign(campaign.id, aWins ? 'A' : 'B')}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors">
                        <StopCircle size={11} /> {t('admin.churn.ab.endCampaign', 'End')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 p-4">
                  {[
                    { key: 'A', label: t('admin.churn.ab.variantA', 'Variant A'), data: campaign.variant_a, stat: stats.a, isWinner: aWins && !tied && totalSent >= 2 },
                    { key: 'B', label: t('admin.churn.ab.variantB', 'Variant B'), data: campaign.variant_b, stat: stats.b, isWinner: bWins && !tied && totalSent >= 2 },
                  ].map(v => (
                    <div key={v.key} className={`rounded-xl p-3.5 border transition-colors ${v.isWinner ? 'bg-[#10B981]/5 border-[#10B981]/25' : 'bg-[#111827] border-white/6'}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <p className="text-[12px] font-semibold text-[#E5E7EB]">{v.label}</p>
                        {v.isWinner && (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981]">
                            <Trophy size={10} /> {t('admin.churn.ab.winner', 'Winner')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#9CA3AF] mb-0.5 truncate">
                        {v.data.offer_type || t('admin.churn.ab.noOffer', 'No offer')}
                        {v.data.discount_pct ? ` (${v.data.discount_pct}%)` : ''}
                        {v.data.free_days ? ` · ${v.data.free_days}d ${t('admin.churn.ab.free', 'free')}` : ''}
                      </p>
                      {v.data.message && (
                        <p className="text-[10px] text-[#6B7280] line-clamp-2 mb-3">{v.data.message}</p>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#6B7280]">{t('admin.churn.ab.numSent', 'Sent')}</span>
                          <span className="text-[12px] font-semibold text-[#E5E7EB]">{v.stat.sent}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#6B7280]">{t('admin.churn.ab.responseRate', 'Response Rate')}</span>
                          <span className={`text-[12px] font-semibold ${v.stat.responseRate > 0 ? 'text-[#D4AF37]' : 'text-[#6B7280]'}`}>{v.stat.responseRate}%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#6B7280]">{t('admin.churn.ab.returnRate', 'Return Rate')}</span>
                          <span className={`text-[12px] font-bold ${v.stat.returnRate > 0 ? 'text-[#10B981]' : 'text-[#6B7280]'}`}>{v.stat.returnRate}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No campaigns yet — show create button */}
      {!loading && campaigns.length === 0 && (
        <div className="mb-6">
          <button onClick={() => setCreateCampaignModal(true)}
            className="w-full bg-[#0F172A] border border-dashed border-white/10 rounded-[14px] p-5 flex items-center justify-center gap-2 text-[13px] font-semibold text-[#6B7280] hover:text-[#D4AF37] hover:border-[#D4AF37]/30 transition-colors">
            <FlaskConical size={15} /> {t('admin.churn.ab.createFirst', 'Create your first A/B win-back campaign')}
          </button>
        </div>
      )}

      <div className="lg:sticky lg:top-0 lg:z-20 lg:bg-[#05070B]/95 lg:backdrop-blur-xl lg:py-3 mb-4 border-b border-white/6">
        <div className="flex gap-1">
          {TABS.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${tab === tb.key ? 'bg-[#D4AF37]/12 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/4'}`}>
              {tb.label}
              {tb.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === tb.key ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/8 text-[#6B7280]'}`}>{tb.count}</span>
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
              <input type="text" placeholder={t('admin.churn.searchMembers', 'Search members…')} value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <FilterBar options={[{ key: 'all', label: 'All' }, { key: 'critical', label: 'Critical' }, { key: 'high', label: 'High' }, { key: 'medium', label: 'Medium' }]} active={riskFilter} onChange={setRiskFilter} />
          </div>

          {!loading && atRiskMembers.length > 0 && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[11px] text-[#6B7280] font-medium">{t('adminChurn.bulk.quickSelect', { defaultValue: 'Quick select:' })}</span>
              {[
                { tier: 'critical', label: t('adminChurn.bulk.selectCritical', { defaultValue: 'Select All Critical' }) },
                { tier: 'high', label: t('adminChurn.bulk.selectHigh', { defaultValue: 'Select All High' }) },
                { tier: 'medium', label: t('adminChurn.bulk.selectMedium', { defaultValue: 'Select All Medium' }) },
              ].map(s => (
                <button key={s.tier} onClick={() => selectAllByTier(s.tier)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/12 transition-colors">{s.label}</button>
              ))}
              {selectedCount > 0 && (
                <button onClick={clearSelection} className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors">
                  {t('adminChurn.bulk.clearSelection', { defaultValue: 'Clear' })} ({selectedCount})
                </button>
              )}
            </div>
          )}

          {selectedCount > 0 && (
            <div className="mb-4 px-4 py-3 bg-[#D4AF37]/8 border border-[#D4AF37]/20 rounded-xl flex items-center gap-3 flex-wrap">
              <span className="text-[12px] font-semibold text-[#D4AF37]">{selectedCount} selected</span>
              <div className="h-4 w-px bg-[#D4AF37]/20" />
              <button onClick={() => setBulkMsgModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors">
                <MessageSquare size={12} /> Message All ({selectedCount})
              </button>
              {challenges.length > 0 && (
                <select value={bulkChallengeId} onChange={e => { setBulkChallengeId(e.target.value); handleBulkAddToChallenge(e.target.value); }}
                  disabled={bulkActionLoading}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#1E293B] text-[#9CA3AF] border border-white/8 outline-none focus:border-[#D4AF37]/40 cursor-pointer hover:border-white/12 transition-colors disabled:opacity-50">
                  <option value="" disabled>Add All to Challenge</option>
                  {challenges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <button onClick={handleBulkMarkContacted}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 hover:bg-[#10B981]/18 transition-colors">
                <CheckCircle size={12} /> Mark All Contacted
              </button>
            </div>
          )}

          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : atRiskMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4"><CheckCircle size={22} className="text-[#10B981]" /></div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">{t('admin.churn.noAtRisk', 'No at-risk members')}</p>
              <p className="text-[13px] text-[#6B7280]">{t('admin.churn.retentionHealthy', 'Your member retention is looking healthy right now.')}</p>
            </div>
          ) : (
            <div>
              <div className="hidden lg:block">
                <AdminTable columns={atRiskTableColumns} data={atRiskMembers} stickyHeader />
              </div>
              <div className="lg:hidden bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden divide-y divide-white/4">
                {atRiskMembers.map(m => {
                  const isContacted = contactedIds.has(m.id);
                  const lastContact = contactedMap[m.id];
                  const lastContactDate = lastContact ? format(new Date(lastContact.created_at), 'MMM d') : null;
                  const isSelected = selectedIds.has(m.id);
                  return (
                    <div key={m.id} className={`px-4 py-4 hover:bg-white/[0.03] transition-all ${isSelected ? 'bg-[#D4AF37]/[0.04]' : ''}`}>
                      <div className="flex items-start gap-3">
                        <button onClick={() => toggleSelected(m.id)} className="mt-1 flex-shrink-0 text-[#6B7280] hover:text-[#D4AF37] transition-colors">
                          {isSelected ? <CheckSquare size={18} className="text-[#D4AF37]" /> : <Square size={18} />}
                        </button>
                        <Avatar name={m.full_name} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-[14px] font-semibold text-[#E5E7EB]">{m.full_name}</p>
                            <RiskBadge tier={m.churnScore >= 80 ? 'critical' : m.churnScore >= 55 ? 'high' : 'medium'} />
                            {isContacted && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20">
                                {t('admin.churn.contacted', 'Contacted')}{lastContactDate ? ` · ${lastContactDate}` : ''}
                              </span>
                            )}
                          </div>
                          <div className="mb-2"><ScoreBar score={m.churnScore} /></div>
                          <div className="mb-1 space-y-0.5">
                            {(m.keySignals || [m.keySignal]).slice(0, 3).map((sig, i) => (
                              <p key={i} className="text-[12px] text-[#9CA3AF]"><span className="text-[#6B7280]">{i === 0 ? 'Signal: ' : '· '}</span>{sig}</p>
                            ))}
                          </div>
                          <p className="text-[11px] text-[#6B7280]">
                            {m.lastActivityAt
                              ? (m.daysSinceLastActivity < 1
                                ? t('admin.churn.activeToday', 'Active today')
                                : t('admin.churn.lastActivityDaysAgo', { days: Math.round(m.daysSinceLastActivity), defaultValue: `Last activity {{days}}d ago` }))
                              : t('admin.churn.noRecentActivity', 'No workouts or check-ins in tracked window')}
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
                        <button onClick={() => setMsgModal(m)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors">
                          <MessageSquare size={12} /> {t('admin.churn.message', 'Message')}
                        </button>
                        {challenges.length > 0 && (
                          <select defaultValue="" onChange={e => handleAddToChallenge(m, e.target.value)}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#1E293B] text-[#9CA3AF] border border-white/8 outline-none focus:border-[#D4AF37]/40 cursor-pointer hover:border-white/12 transition-colors">
                            <option value="" disabled>+ {t('admin.churn.addToChallenge', 'Add to Challenge')}</option>
                            {challenges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                        <button onClick={() => setContactPanel(m)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${isContacted ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20 hover:bg-[#10B981]/18' : 'bg-white/4 text-[#9CA3AF] border-white/8 hover:text-[#E5E7EB]'}`}>
                          <Phone size={12} /> {isContacted ? t('admin.churn.contacted', 'Contacted') : t('admin.churn.contact', 'Contact')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CHURNED TAB */}
      {tab === 'churned' && (
        <div>
          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : churnedMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4"><Users size={22} className="text-[#10B981]" /></div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">{t('admin.churn.noChurned', 'No churned members')}</p>
              <p className="text-[13px] text-[#6B7280]">{t('admin.churn.allActive', 'All members have been active in the last 30 days.')}</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colMember', 'Member')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">{t('admin.churn.colLastSeen', 'Last Seen')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">{t('admin.churn.colTenure', 'Tenure')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colAction', 'Action')}</p>
              </div>
              <div className="divide-y divide-white/4">
                {churnedMembers.map(m => {
                  const lastSeen = m.lastActivityAt
                    ? formatDistanceToNow(new Date(m.lastActivityAt), { addSuffix: true })
                    : t('admin.churn.noRecentActivity', 'No recent activity');
                  const tenureLabel = m.tenureMonths < 1 ? t('admin.churn.lessThanMonth', 'Less than 1 month') : `${Math.round(m.tenureMonths)} ${t('admin.churn.months', 'months')}`;
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
                        <RotateCcw size={12} /> {t('admin.churn.winBack', 'Win Back')}
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
          {!loading && winBackAttempts.length > 0 && Object.keys(attributionStats).length > 0 && (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 mb-4">
              <p className="text-[12px] font-semibold text-[#E5E7EB] mb-2">{t('admin.churn.attributionTitle', 'Outreach Attribution')}</p>
              <div className="flex flex-wrap gap-3">
                {Object.entries(attributionStats).map(([method, stats]) => {
                  const rate = stats.sent > 0 ? Math.round((stats.returned / stats.sent) * 100) : 0;
                  return (
                    <span key={method} className="text-[11px] text-[#9CA3AF]">
                      <span className="font-semibold text-[#E5E7EB]">{METHOD_LABELS[method] || method}:</span>{' '}
                      {t('admin.churn.sentCount', { count: stats.sent, defaultValue: '{{count}} sent' })},{' '}
                      <span className={stats.returned > 0 ? 'text-[#10B981]' : ''}>{t('admin.churn.returnedCount', { count: stats.returned, defaultValue: '{{count}} returned' })}</span>{' '}
                      ({rate}%)
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : winBackAttempts.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4"><RotateCcw size={22} className="text-[#D4AF37]" /></div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">{t('admin.churn.noWinBacks', 'No win-back attempts yet')}</p>
              <p className="text-[13px] text-[#6B7280]">{t('admin.churn.useChurnedTab', 'Use the Churned tab to send win-back messages to inactive members.')}</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colMemberMessage', 'Member / Message')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colDate', 'Date')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colOutcome', 'Outcome')}</p>
              </div>
              <div className="divide-y divide-white/4">
                {winBackAttempts.map(attempt => {
                  const m = members.find(mem => mem.id === attempt.user_id);
                  const memberName = m?.full_name ?? t('admin.churn.unknownMember', 'Unknown Member');
                  const outcome = attempt.outcome ?? 'pending';
                  const outcomeCfg = outcomeConfig[outcome] ?? outcomeConfig.pending;
                  const isSaving = savingOutcome === attempt.id;
                  const relatedLog = contactLogs.find(l => l.member_id === attempt.user_id && Math.abs(new Date(l.created_at) - new Date(attempt.created_at)) < 3600000);
                  const contactMethod = relatedLog?.method;

                  return (
                    <div key={attempt.id} className="px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <div className="grid grid-cols-[1fr_auto_auto] items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="text-[13px] font-semibold text-[#E5E7EB]">{memberName}</p>
                            {contactMethod && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/6 text-[#9CA3AF]">{METHOD_LABELS[contactMethod] || contactMethod}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#6B7280] line-clamp-2">{attempt.message}</p>
                          {attempt.offer && <p className="text-[11px] text-[#D4AF37] mt-0.5">{t('admin.churn.offer', 'Offer')}: {attempt.offer}</p>}
                          {attempt._autoDetected && attempt._returnedAt && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <Sparkles size={11} className="text-[#10B981]" />
                              <span className="text-[10px] font-semibold text-[#10B981]">
                                {t('admin.churn.autoDetected', { date: format(new Date(attempt._returnedAt), 'MMM d, yyyy'), defaultValue: 'Auto-detected: Member returned on {{date}}' })}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[12px] text-[#9CA3AF]">{format(new Date(attempt.created_at), 'MMM d')}</p>
                          <p className="text-[10px] text-[#4B5563]">{format(new Date(attempt.created_at), 'yyyy')}</p>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="text-[11px] font-semibold px-2 py-1 rounded-full border" style={{ color: outcomeCfg.color, background: outcomeCfg.bg, borderColor: `${outcomeCfg.color}33` }}>
                            {outcomeCfg.label}
                          </span>
                        </div>
                      </div>
                      {outcome !== 'returned' && (
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => handleMarkOutcome(attempt.id, 'returned')} disabled={isSaving}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 hover:bg-[#10B981]/18 transition-colors disabled:opacity-40">
                            <CheckCircle size={11} /> {t('admin.churn.markReturned', 'Mark Returned')}
                          </button>
                          {outcome !== 'no_response' && (
                            <button onClick={() => handleMarkOutcome(attempt.id, 'no_response')} disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors disabled:opacity-40">
                              {t('admin.churn.noResponse', 'No Response')}
                            </button>
                          )}
                          {outcome !== 'still_inactive' && (
                            <button onClick={() => handleMarkOutcome(attempt.id, 'still_inactive')} disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F59E0B]/8 text-[#F59E0B] border border-[#F59E0B]/15 hover:bg-[#F59E0B]/15 transition-colors disabled:opacity-40">
                              {t('admin.churn.stillInactive', 'Still Inactive')}
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
      {msgModal && <SendMessageModal member={msgModal} gymId={gymId} adminId={adminId} onClose={() => setMsgModal(null)} onSent={() => { setMsgModal(null); handleMarkContacted(msgModal.id, 'in_app_message'); }} />}
      {winBackModal && <WinBackModal member={winBackModal} gymId={gymId} adminId={adminId} activeCampaign={activeCampaign} onClose={() => setWinBackModal(null)}
        onSent={() => { setWinBackModal(null); handleMarkContacted(winBackModal.id, 'win_back'); refetch(); }} />}
      {contactPanel && <ContactPanel member={contactPanel} gymId={gymId} adminId={adminId}
        isContacted={contactedIds.has(contactPanel.id)}
        contactedAt={contactedMap[contactPanel.id]?.created_at}
        onMarkContacted={handleMarkContacted}
        onUnmarkContacted={handleUnmarkContacted}
        onOpenMessage={() => { setContactPanel(null); setMsgModal(contactPanel); }}
        onClose={() => setContactPanel(null)} />}
      {bulkMsgModal && <BulkMessageModal members={selectedMembers} gymId={gymId} adminId={adminId}
        onClose={() => setBulkMsgModal(false)} onSent={() => { clearSelection(); refetch(); }} />}
      {createCampaignModal && <CreateCampaignModal gymId={gymId}
        onClose={() => setCreateCampaignModal(false)} onCreated={() => { setCreateCampaignModal(false); refetch(); }} />}
    </AdminPageShell>
  );
}
