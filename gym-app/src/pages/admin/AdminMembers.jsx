import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, Users, Download, Link, Copy, Trash2, Clock, KeyRound, CheckCircle, XCircle, UserPlus, Mail, Phone, ChevronDown, CheckSquare, Square, X, AlertTriangle, Activity, Snowflake, RefreshCw, MessageSquare, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { createNotification } from '../../lib/notifications';
import { format, subDays, formatDistanceToNow, differenceInDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { getRiskTier, fetchMembersWithChurnScores } from '../../lib/churnScore';
import { exportCSV } from '../../lib/csvExport';
import { exportGymWorkoutHistory, exportGymPersonalRecords, exportGymBodyMetrics } from '../../lib/exportData';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';

// Shared components
import { PageHeader, FilterBar, Avatar, TableSkeleton, AdminPageShell, AdminTable, StatCard, AdminTabs } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { StatusBadge } from '../../components/admin/StatusBadge';

// Sub-components
import InviteModal from './components/InviteModal';
import CreateInviteModal from './components/CreateInviteModal';
import MemberDetail from './components/MemberDetail';
import PasswordResetApprovalModal from './components/PasswordResetApprovalModal';

// ── Churn signal translation ─────────────────────────
import { translateSignal as translateChurnSignal } from '../../lib/churn/signalI18n';
export { translateChurnSignal };

// ── Churn risk badge ──────────────────────────────────────
const ChurnRiskBadge = ({ member, navigate }) => {
  const score = member.score ?? 0;
  const tier = getRiskTier(score);
  if (score < 31) return null;
  return (
    <span onClick={e => { e.stopPropagation(); navigate('/admin/churn'); }}
      role="link"
      tabIndex={0}
      title={`${tier.label} — click to view in Churn Intel`}
      className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 flex-shrink-0 cursor-pointer"
      style={{ color: tier.color, background: tier.bg, borderColor: `${tier.color}33` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tier.color }} />
      {tier.label}
    </span>
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

const MEMBERS_PAGE_SIZE = 200;

// ── Data fetcher ──────────────────────────────────────────
async function fetchMembers(gymId, page = 0) {
  const from = page * MEMBERS_PAGE_SIZE;
  const to = from + MEMBERS_PAGE_SIZE - 1;
  const [membersRes, followupRes, sessionsRes, scoredAll] = await Promise.all([
    supabase.from('profiles').select('id, full_name, username, last_active_at, created_at, admin_note, membership_status, membership_status_updated_at, qr_code_payload, qr_external_id').eq('gym_id', gymId).eq('role', 'member').order('last_active_at', { ascending: false, nullsFirst: false }).range(from, to),
    supabase.from('churn_risk_scores').select('profile_id, followup_sent_at, computed_at').eq('gym_id', gymId).order('computed_at', { ascending: false }),
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', subDays(new Date(), 14).toISOString()).limit(5000),
    fetchMembersWithChurnScores(gymId, supabase).catch((err) => {
      logger.error('AdminMembers: fetchMembersWithChurnScores:', err);
      return [];
    }),
  ]);

  if (membersRes.error) logger.error('AdminMembers: members:', membersRes.error);
  if (followupRes.error) logger.error('AdminMembers: churn followup:', followupRes.error);
  if (sessionsRes.error) logger.error('AdminMembers: sessions:', sessionsRes.error);

  const scoredMap = Object.fromEntries((scoredAll || []).map((s) => [s.id, s]));
  const followupMap = {};
  (followupRes.data || []).forEach((row) => {
    const prev = followupMap[row.profile_id];
    if (!prev || new Date(row.computed_at) > new Date(prev.computed_at)) followupMap[row.profile_id] = row;
  });

  const sessionsLast14 = {};
  const lastSessionAt = {};
  (sessionsRes.data || []).forEach(s => {
    sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
    if (!lastSessionAt[s.profile_id] || s.started_at > lastSessionAt[s.profile_id]) lastSessionAt[s.profile_id] = s.started_at;
  });

  const nowMs = Date.now();
  return (membersRes.data || []).map(m => {
    const scored = scoredMap[m.id];
    const effectiveLast = m.last_active_at ?? lastSessionAt[m.id] ?? m.created_at;
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const daysInactive = Math.floor((nowMs - new Date(effectiveLast)) / 86400000);
    const neverActive = !m.last_active_at && !lastSessionAt[m.id];

    const fallback = !scored ? estimateChurnScore(daysInactive, recentWorkouts, neverActive) : null;
    const follow = followupMap[m.id];

    return {
      ...m,
      recentWorkouts,
      lastSessionAt: lastSessionAt[m.id] ?? null,
      score: scored?.churnScore ?? fallback.score,
      risk_tier: scored?.riskTier?.tier ?? fallback.risk_tier,
      key_signals: scored?.keySignals ?? fallback.key_signals,
      followup_sent_at: follow?.followup_sent_at ?? null,
      membership_status: m.membership_status ?? 'active',
      daysInactive,
      neverActive,
    };
  });
}

// ── All invites fetcher ──────────────────────────────────
async function fetchAllInvites(gymId) {
  const { data, error } = await supabase
    .from('gym_invites')
    .select('id, member_name, phone, email, invite_code, created_at, expires_at, used_by, used_at')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false });

  if (error) logger.error('AdminMembers: invites:', error);
  return data || [];
}

function getInviteStatus(invite) {
  if (invite.used_by) return 'claimed';
  const now = new Date();
  const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
  if (expiresAt && expiresAt < now) return 'expired';
  return 'pending';
}

export default function AdminMembers() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const k = (key) => t(`admin.memberInvites.${key}`);
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  // SECURITY: Always derive gymId from the authenticated user's profile.
  // Never accept gymId from URL params, query strings, or other user input.
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  const [tab, setTab] = useState('members'); // 'members' | 'invites' | 'resets'
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [resetApprovalId, setResetApprovalId] = useState(null);
  const [inviteFilter, setInviteFilter] = useState('pending');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null); // 'message' | 'freeze' | 'export' | 'assign_trainer'
  const [membersPage, setMembersPage] = useState(0);
  const [allMembers, setAllMembers] = useState([]);
  const [hasMoreMembers, setHasMoreMembers] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [quickMsgMemberId, setQuickMsgMemberId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(10);

  // Auto-open member detail from ?member=ID query param
  useEffect(() => {
    const memberId = searchParams.get('member');
    if (memberId && allMembers.length > 0 && !selected) {
      const found = allMembers.find(m => m.id === memberId);
      if (found) {
        setSelected(found);
        searchParams.delete('member');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [searchParams, allMembers, selected, setSearchParams]);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(m => m.id)));
  };

  const clearSelection = () => { setSelectedIds(new Set()); setBulkAction(null); };

  useEffect(() => { document.title = `Admin - Members | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

  const { data: initialMembers = [], isLoading, refetch } = useQuery({
    queryKey: adminKeys.members.all(gymId),
    queryFn: async () => {
      const result = await fetchMembers(gymId, 0);
      setMembersPage(0);
      setHasMoreMembers(result.length >= MEMBERS_PAGE_SIZE);
      setAllMembers(result);
      return result;
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  const members = allMembers.length > 0 ? allMembers : initialMembers;

  const handleLoadMore = async () => {
    if (loadingMore || !hasMoreMembers) return;
    setLoadingMore(true);
    try {
      const nextPage = membersPage + 1;
      const moreMembers = await fetchMembers(gymId, nextPage);
      setMembersPage(nextPage);
      setHasMoreMembers(moreMembers.length >= MEMBERS_PAGE_SIZE);
      // NOTE: allMembers grows unbounded across pages. If gyms reach very high member counts,
      // consider capping or virtualizing the list to avoid excessive memory usage.
      setAllMembers(prev => [...prev, ...moreMembers]);
    } catch (err) {
      logger.error('AdminMembers: load more failed:', err);
    }
    setLoadingMore(false);
  };

  const { data: allInvites = [], isLoading: invitesLoading, refetch: refetchInvites } = useQuery({
    queryKey: [...adminKeys.members.all(gymId), 'all-invites'],
    queryFn: () => fetchAllInvites(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Derived invite lists
  const pendingInvites = useMemo(() => allInvites.filter(i => getInviteStatus(i) === 'pending'), [allInvites]);
  const claimedInvites = useMemo(() => allInvites.filter(i => getInviteStatus(i) === 'claimed'), [allInvites]);
  const filteredInvites = useMemo(() => {
    if (inviteFilter === 'all') return allInvites;
    return allInvites.filter(i => getInviteStatus(i) === inviteFilter);
  }, [allInvites, inviteFilter]);

  // Pending password reset requests
  const { data: pendingResets = [], refetch: refetchResets } = useQuery({
    queryKey: [...adminKeys.members.all(gymId), 'pending-resets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('password_reset_requests')
        .select('id, profile_id, status, created_at, expires_at, profiles!inner(full_name, username, avatar_url)')
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return [];
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 30_000,
    retry: false,
  });

  const [copiedId, setCopiedId] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(null);
  const exportMenuRef = useRef(null);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClick = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showExportMenu]);

  const handleExportWorkouts = async () => {
    setExporting('workouts');
    try { await exportGymWorkoutHistory(gymId); } catch (e) { logger.error('Export workouts failed:', e); }
    setExporting(null);
    setShowExportMenu(false);
  };

  const handleExportPRs = async () => {
    setExporting('prs');
    try { await exportGymPersonalRecords(gymId); } catch (e) { logger.error('Export PRs failed:', e); }
    setExporting(null);
    setShowExportMenu(false);
  };

  const handleExportBodyMetrics = async () => {
    setExporting('body');
    try { await exportGymBodyMetrics(gymId); } catch (e) { logger.error('Export body metrics failed:', e); }
    setExporting(null);
    setShowExportMenu(false);
  };

  const handleCopyCode = async (invite) => {
    try {
      await navigator.clipboard.writeText(invite.invite_code);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      logger.error('Failed to copy invite code:', err);
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    const { error } = await supabase.from('gym_invites').delete().eq('id', inviteId).eq('gym_id', gymId);
    if (error) logger.error('Failed to revoke invite:', error);
    else {
      logAdminAction('revoke_invite', 'invite', inviteId);
      refetchInvites();
    }
  };

  const handleNoteSaved = (memberId, newNote) => {
    setSelected(prev => prev?.id === memberId ? { ...prev, admin_note: newNote } : prev);
  };

  const handleStatusChanged = (memberId, newStatus) => {
    setSelected(prev => prev?.id === memberId ? { ...prev, membership_status: newStatus } : prev);
  };

  const atRiskCount = members.filter(m => m.score >= 61).length;
  const watchCount = members.filter(m => m.score >= 31 && m.score < 61).length;
  const frozenCount = members.filter(m => m.membership_status === 'frozen').length;
  // "Low Risk" count: members with churn score < 31 (consistent with the filter logic)
  const lowRiskCount = members.filter(m => m.score < 31).length;

  const filtered = useMemo(() => {
    let list = members;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => (m.full_name || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q));
    }
    if (filter === 'at-risk') list = list.filter(m => m.score >= 61);
    else if (filter === 'watch') list = list.filter(m => m.score >= 31 && m.score < 61);
    else if (filter === 'healthy') list = list.filter(m => m.score < 31);
    return list;
  }, [members, search, filter]);

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(10); }, [search, filter]);

  const visibleMembers = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const atRiskFiltered = filtered.filter(m => m.score >= 61);

  const handleBulkFollowup = async () => {
    if (!gymId) return;
    setBulkSending(true);
    const total = atRiskFiltered.length;
    let successCount = 0;
    const succeeded = [];
    for (const m of atRiskFiltered) {
      try {
        const msg = `Hey ${(m.full_name || 'Member').split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together.`;
        await createNotification({ profileId: m.id, gymId, type: 'churn_followup', title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: msg, data: { source: 'admin_bulk_followup' } });
        logAdminAction('bulk_followup', 'member', m.id);
        successCount++;
        succeeded.push(m);
      } catch (err) {
        logger.error('Bulk followup failed for member:', m.id, err);
      }
    }
    if (succeeded.length > 0) {
      const ts = new Date().toISOString();
      const rows = succeeded.map((m) => ({
        profile_id: m.id,
        gym_id: gymId,
        score: m.score,
        risk_tier: m.risk_tier,
        key_signals: m.key_signals ?? [],
        computed_at: ts,
        followup_sent_at: ts,
      }));
      const { error: upsertError } = await supabase.from('churn_risk_scores').upsert(rows, { onConflict: 'profile_id,gym_id' });
      if (upsertError) {
        logger.error('Bulk followup: churn_risk_scores upsert failed', upsertError);
        showToast(t('admin.members.bulkScoreUpdateFailed', { defaultValue: 'Follow-ups sent but failed to update risk scores. Please refresh.' }), 'warning');
      }
    }
    if (successCount < total) {
      showToast(t('admin.members.bulkPartialResult', { success: successCount, total, defaultValue: 'Sent to {{success}} of {{total}} members' }), 'warning');
    } else if (successCount > 0) {
      showToast(t('admin.members.bulkFollowupSuccess', { count: successCount, defaultValue: 'Follow-up sent to {{count}} members' }), 'success');
    }
    setBulkSending(false);
    setBulkConfirm(false);
  };

  const handleBulkFreeze = async () => {
    const ids = [...selectedIds];
    try {
      const { error } = await supabase.from('profiles').update({ membership_status: 'frozen' }).in('id', ids).eq('gym_id', gymId);
      if (error) {
        logger.error('Bulk freeze failed', error);
        showToast(t('admin.members.bulkFreezeError', { defaultValue: 'Failed to freeze members. Please try again.' }), 'error');
        return;
      }
      ids.forEach(id => logAdminAction('bulk_freeze', 'member', id));
      posthog?.capture('admin_member_frozen', { bulk: true, count: ids.length });
      showToast(t('admin.members.bulkFreezeSuccess', { count: ids.length, defaultValue: '{{count}} members frozen' }), 'success');
      refetch();
      clearSelection();
    } catch (err) {
      logger.error('Bulk freeze failed', err);
      showToast(t('admin.members.bulkFreezeError', { defaultValue: 'Failed to freeze members. Please try again.' }), 'error');
    }
  };

  const handleBulkExportSelected = () => {
    const selected = filtered.filter(m => selectedIds.has(m.id));
    exportCSV({
      filename: 'selected_members',
      columns: [
        { key: 'full_name', label: t('admin.members.csvName', 'Name') },
        { key: 'membership_status', label: t('admin.members.csvStatus', 'Status') },
        { key: 'created_at', label: t('admin.members.csvJoined', 'Joined') },
        { key: 'last_active_at', label: t('admin.members.csvLastActive', 'Last Active') },
        { key: 'score', label: t('admin.members.csvChurnScore', 'Churn Score') },
        { key: 'risk_tier', label: t('admin.members.csvRiskTier', 'Risk Tier') },
      ],
      data: selected,
    });
    clearSelection();
  };

  const handleBulkMessage = async (message) => {
    const ids = [...selectedIds];
    const total = ids.length;
    let successCount = 0;
    for (const id of ids) {
      try {
        await createNotification({ profileId: id, gymId, type: 'admin_message', title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: message, data: { source: 'admin_bulk_message' } });
        logAdminAction('bulk_message', 'member', id);
        successCount++;
      } catch (err) {
        logger.error('Bulk message failed for member:', id, err);
      }
    }
    if (successCount < total) {
      showToast(t('admin.members.bulkPartialResult', { success: successCount, total, defaultValue: 'Sent to {{success}} of {{total}} members' }), 'warning');
    } else if (successCount > 0) {
      showToast(t('admin.members.bulkMessageSuccess', { count: successCount, defaultValue: 'Message sent to {{count}} members' }), 'success');
    }
    clearSelection();
  };

  const handleQuickMessage = async (memberId, message) => {
    if (!message?.trim()) return;
    try {
      await createNotification({ profileId: memberId, gymId, type: 'admin_message', title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: message, data: { source: 'admin_quick_message' } });
      logAdminAction('quick_message', 'member', memberId);
      showToast(t('admin.members.messageSent', { defaultValue: 'Message sent' }), 'success');
    } catch (err) {
      logger.error('Quick message failed for member:', memberId, err);
      showToast(t('admin.members.messageFailed', { defaultValue: 'Failed to send message' }), 'error');
    }
    setQuickMsgMemberId(null);
  };

  const handleExport = () => {
    exportCSV({
      filename: 'members',
      columns: [
        { key: 'full_name', label: t('admin.members.csvName', 'Name') },
        { key: 'membership_status', label: t('admin.members.csvStatus', 'Status') },
        { key: 'created_at', label: t('admin.members.csvJoined', 'Joined') },
        { key: 'last_active_at', label: t('admin.members.csvLastActive', 'Last Active') },
        { key: 'score', label: t('admin.members.csvChurnScore', 'Churn Score') },
        { key: 'risk_tier', label: t('admin.members.csvRiskTier', 'Risk Tier') },
        { key: 'recentWorkouts', label: t('admin.members.csvWorkouts', 'Workouts (14d)') },
      ],
      data: filtered,
    });
  };

  const pendingCount = pendingInvites.length;
  const totalInviteCount = allInvites.length;

  const resetCount = pendingResets.length;

  const filterOptions = [
    { key: 'all', label: t('admin.members.filterAll', 'All'), count: members.length },
    { key: 'at-risk', label: t('admin.members.filterAtRisk', 'At Risk'), count: atRiskCount },
    { key: 'watch', label: t('admin.members.filterWatch', 'Watch'), count: watchCount },
    { key: 'healthy', label: t('admin.members.filterLowRisk', 'Low Risk'), count: lowRiskCount },
  ];

  const tabOptions = [
    { key: 'members', label: t('admin.members.tabMembers', 'Members'), count: members.length },
    { key: 'invites', label: t('admin.members.tabInvites', 'Invites'), count: pendingCount },
    { key: 'resets', label: t('admin.members.tabResets', 'Resets'), count: resetCount },
  ];

  const memberTableColumns = [
    {
      key: 'select',
      label: '',
      width: '52px',
      render: (m) => (
        <button
          onClick={(e) => { e.stopPropagation(); toggleSelect(m.id); }}
          className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
          aria-label={selectedIds.has(m.id) ? 'Deselect member' : 'Select member'}
        >
          {selectedIds.has(m.id) ? (
            <CheckSquare size={16} className="text-[#D4AF37]" />
          ) : (
            <Square size={16} />
          )}
        </button>
      ),
    },
    {
      key: 'full_name',
      label: t('admin.members.colMember', 'Member'),
      sortable: true,
      sortValue: (m) => m.full_name?.toLowerCase() || '',
      render: (m) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={m.full_name} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
            <p className="text-[12px] text-[#6B7280] truncate">
              {(m.last_active_at || m.lastSessionAt)
                ? t('admin.members.activeAgo', { time: formatDistanceToNow(new Date(m.last_active_at ?? m.lastSessionAt), { addSuffix: true, ...dateFnsLocale }), defaultValue: 'Active {{time}}' })
                : t('admin.members.neverActive', 'Never active')}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'membership_status',
      label: t('admin.members.colStatus', 'Status'),
      sortable: true,
      render: (m) => <StatusBadge status={m.membership_status} />,
      className: 'text-center',
      headerClassName: 'text-center',
    },
    {
      key: 'score',
      label: t('admin.members.colRisk', 'Risk'),
      sortable: true,
      sortValue: (m) => m.score ?? 0,
      render: (m) => {
        const tier = getRiskTier(m.score);
        return (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
            style={{ color: tier.color, background: tier.bg, borderColor: `${tier.color}33` }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tier.color }} />
            {m.score}%
          </span>
        );
      },
    },
    {
      key: 'last_seen',
      label: t('admin.members.colLastActive', 'Last Active'),
      sortable: true,
      sortValue: (m) => new Date(m.last_active_at ?? m.lastSessionAt ?? m.created_at).getTime(),
      render: (m) => (
        <span className="text-[12px] text-[#9CA3AF]">
          {(m.last_active_at || m.lastSessionAt)
            ? formatDistanceToNow(new Date(m.last_active_at ?? m.lastSessionAt), { addSuffix: true, ...dateFnsLocale })
            : t('admin.members.never', 'Never')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '48px',
      render: (m) => (
        <button
          onClick={(e) => { e.stopPropagation(); setQuickMsgMemberId(m.id); }}
          className="p-1.5 rounded-lg transition-all duration-200 hover:scale-110"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-accent) 12%, transparent)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          title={t('admin.members.message', 'Message')}
          aria-label={t('admin.members.messageMember', { name: m.full_name, defaultValue: 'Message {{name}}' })}
        >
          <MessageSquare size={14} />
        </button>
      ),
    },
  ];

  // Guard: only admins/super_admins with a valid gym_id may access this page
  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger, #EF4444)' }}>{t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}</p>
      </div>
    );
  }

  return (
    <AdminPageShell>
      <PageHeader
        title={`${t('admin.members.title', 'Members')} (${members.length})`}
        subtitle={t('admin.members.subtitle', { total: members.length, atRisk: atRiskCount, defaultValue: '{{total}} total \u00b7 {{atRisk}} at risk' })}
        actions={
          <>
            {tab === 'members' && filter === 'at-risk' && atRiskFiltered.length > 0 && (
              bulkConfirm ? (
                <div className="flex items-center gap-2">
                  <p className="text-[12px] text-[#9CA3AF]">{t('admin.members.sendToCount', { count: atRiskFiltered.length })}</p>
                  <button onClick={handleBulkFollowup} disabled={bulkSending}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40">
                    {bulkSending ? t('admin.members.sending', 'Sending\u2026') : t('admin.members.confirm', 'Confirm')}
                  </button>
                  <button onClick={() => setBulkConfirm(false)}
                    className="px-3 py-2 rounded-xl text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
                    {t('admin.members.cancel')}
                  </button>
                </div>
              ) : (
                <button onClick={() => setBulkConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors">
                  <Users size={13} /> {t('admin.members.bulkFollowup', 'Bulk Follow-up')}
                </button>
              )
            )}
            {(tab === 'members' || tab === 'invites') && (
              <>
                <button onClick={() => setShowInvite(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors">
                  <Link size={13} /> {k('inviteMember')}
                </button>
                <button onClick={() => setShowCreateInvite(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37] transition-colors"
                  style={{ color: '#000' }}>
                  <UserPlus size={13} /> {k('addMember')}
                </button>
              </>
            )}
          </>
        }
      />

      {/* Top summary row -- visible on all tabs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-6 mb-6">
        <StatCard
          label={t('admin.members.statTotal', 'Total Members')}
          value={members.length}
          borderColor="#60A5FA"
          icon={Users}
          delay={0}
        />
        <StatCard
          label={t('admin.members.statAtRisk', 'At Risk')}
          value={atRiskCount}
          borderColor="#EF4444"
          icon={AlertTriangle}
          delay={0.05}
        />
        <StatCard
          label={t('admin.members.statFrozen', 'Frozen')}
          value={frozenCount}
          borderColor="#60A5FA"
          icon={Snowflake}
          delay={0.1}
        />
        <button className="text-left w-full" onClick={() => { setTab('invites'); }}>
          <StatCard
            label={t('admin.members.statPendingInvites', 'Pending Invites')}
            value={pendingCount}
            borderColor="#D4AF37"
            icon={UserPlus}
            delay={0.15}
          />
        </button>
        <button className="text-left w-full" onClick={() => { setTab('resets'); }}>
          <StatCard
            label={t('admin.members.statPendingResets', 'Pending Resets')}
            value={resetCount}
            borderColor="#8B5CF6"
            icon={KeyRound}
            delay={0.2}
          />
        </button>
      </div>

      {/* Tab strip */}
      <AdminTabs tabs={tabOptions} active={tab} onChange={(key) => { setTab(key); setSearch(''); setFilter('all'); clearSelection(); }} className="mb-4" />

      <SwipeableTabContent tabs={tabOptions} active={tab} onChange={(key) => { setTab(key); setSearch(''); setFilter('all'); clearSelection(); }}>
        {(tabKey) => {
          if (tabKey === 'members') return (
        <>
          {/* Member limit warning */}
          {!hasMoreMembers && members.length >= MEMBERS_PAGE_SIZE && (
            <div className="mb-3 px-4 py-2.5 rounded-xl text-[12px] flex items-center gap-2"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)', color: 'var(--color-warning)' }}>
              <AlertTriangle size={14} className="flex-shrink-0" />
              {t('admin.members.memberLimitWarning', 'All loaded members are shown. Use search to find specific members.')}
            </div>
          )}
          {/* Search + filter */}
          <div className="lg:sticky lg:top-0 lg:z-20 lg:backdrop-blur-xl lg:py-3 flex flex-col lg:flex-row gap-3 mb-4"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-base) 95%, transparent)' }}>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input type="text" placeholder={t('admin.members.searchPlaceholder')} aria-label={t('admin.members.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
                className="w-full rounded-xl pl-9 pr-4 py-2.5 text-[13px] outline-none transition-all duration-200"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
            <FilterBar options={filterOptions} active={filter} onChange={setFilter} />
            <div className="relative" ref={exportMenuRef}>
              <button onClick={() => setShowExportMenu(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all duration-200 hover:scale-[1.02]"
                style={{ border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                <Download size={13} /> {(search || filter !== 'all') ? t('admin.members.exportFiltered', { count: filtered.length, defaultValue: 'Export Filtered ({{count}})' }) : t('admin.members.exportAllCount', { count: members.length, defaultValue: 'Export All ({{count}})' })} <ChevronDown size={11} />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 rounded-xl shadow-2xl z-50 overflow-hidden"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                  <button onClick={handleExport}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] hover:bg-white/[0.05] dark:hover:bg-white/[0.05] transition-colors text-left"
                    style={{ color: 'var(--color-text-primary)' }}>
                    <Users size={13} style={{ color: 'var(--color-text-muted)' }} /> {t('admin.members.exportMembers')}
                  </button>
                  <button onClick={handleExportWorkouts} disabled={!!exporting}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] hover:bg-white/[0.05] transition-colors text-left disabled:opacity-40"
                    style={{ color: 'var(--color-text-primary)' }}>
                    <Download size={13} style={{ color: 'var(--color-text-muted)' }} /> {exporting === 'workouts' ? t('admin.members.exporting', 'Exporting\u2026') : t('admin.memberInvites.exportWorkouts')}
                  </button>
                  <button onClick={handleExportPRs} disabled={!!exporting}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] hover:bg-white/[0.05] transition-colors text-left disabled:opacity-40"
                    style={{ color: 'var(--color-text-primary)' }}>
                    <Download size={13} style={{ color: 'var(--color-text-muted)' }} /> {exporting === 'prs' ? t('admin.members.exporting', 'Exporting\u2026') : t('admin.memberInvites.exportPRs')}
                  </button>
                  <button onClick={handleExportBodyMetrics} disabled={!!exporting}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] hover:bg-white/[0.05] transition-colors text-left disabled:opacity-40"
                    style={{ color: 'var(--color-text-primary)' }}>
                    <Download size={13} style={{ color: 'var(--color-text-muted)' }} /> {exporting === 'body' ? t('admin.members.exporting', 'Exporting\u2026') : t('admin.memberInvites.exportBodyMetrics')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl mb-4 transition-all duration-300"
            style={{
              backgroundColor: selectedIds.size > 0 ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-bg-deep)',
              border: selectedIds.size > 0 ? '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' : '1px solid var(--color-border-subtle)',
            }}>
            <span className="text-[12px] md:text-[13px] font-semibold" style={{ color: selectedIds.size > 0 ? 'var(--color-accent)' : 'var(--color-text-faint)' }}>
              {selectedIds.size > 0
                ? t('admin.members.selectedCount', { count: selectedIds.size, defaultValue: '{{count}} selected' })
                : t('admin.members.bulkActions', { defaultValue: 'Select members for bulk actions' })}
            </span>
            <div className="flex-1" />
            <button onClick={handleBulkExportSelected} disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 hover:scale-[1.03] disabled:opacity-30 disabled:pointer-events-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              <Download size={12} /> {t('admin.members.export', 'Export')}
            </button>
            <button onClick={() => setBulkAction('message')} disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 hover:scale-[1.03] disabled:opacity-30 disabled:pointer-events-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              <Mail size={12} /> {t('admin.members.message', 'Message')}
            </button>
            <button onClick={() => setBulkAction('freeze')} disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 hover:scale-[1.03] disabled:opacity-30 disabled:pointer-events-none"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 10%, transparent)', color: 'var(--color-danger)' }}>
              {t('admin.members.freeze', 'Freeze')}
            </button>
            {selectedIds.size > 0 && (
              <button onClick={clearSelection}
                aria-label={t('admin.members.clearSelection', 'Clear selection')}
                className="transition-colors p-1"
                style={{ color: 'var(--color-text-muted)' }}>
                <X size={14} />
              </button>
            )}
          </div>

          {/* Member list */}
          {isLoading ? (
            <TableSkeleton rows={8} />
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Users size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
              <p className="text-[14px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.members.noMembersFound', 'No members found')}</p>
            </div>
          ) : (
            <div>
              {/* Showing X of Y */}
              <div className="flex items-center justify-between mb-3 px-1">
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.members.showingCount', { visible: visibleMembers.length, total: filtered.length, defaultValue: 'Showing {{visible}} of {{total}} members' })}
                </p>
              </div>
              <div className="hidden lg:block">
                <AdminTable
                  columns={memberTableColumns}
                  data={visibleMembers}
                  onRowClick={(m) => setSelected(m)}
                  stickyHeader
                />
              </div>
              <div className="lg:hidden rounded-[14px] overflow-hidden"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  {visibleMembers.map(m => {
                    const tier = getRiskTier(m.score);
                    return (
                      <button key={m.id} onClick={() => setSelected(m)}
                        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-all duration-200 text-left group">
                        <div onClick={e => { e.stopPropagation(); toggleSelect(m.id); }}
                          role="button" tabIndex={0} aria-label={selectedIds.has(m.id) ? 'Deselect member' : 'Select member'}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSelect(m.id); } }}
                          className="flex items-center justify-center w-5 h-5 flex-shrink-0 cursor-pointer">
                          {selectedIds.has(m.id) ? (
                            <CheckSquare size={16} style={{ color: 'var(--color-accent)' }} />
                          ) : (
                            <Square size={16} style={{ color: 'var(--color-text-faint)' }} className="group-hover:opacity-80" />
                          )}
                        </div>
                        <Avatar name={m.full_name} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{m.full_name}</p>
                            <StatusBadge status={m.membership_status} />
                            <ChurnRiskBadge member={m} navigate={navigate} />
                            {m.admin_note && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 60%, transparent)' }} title={t('admin.members.hasNote', 'Has note')} />}
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                            {(m.last_active_at || m.lastSessionAt)
                              ? t('admin.members.activeAgo', { time: formatDistanceToNow(new Date(m.last_active_at ?? m.lastSessionAt), { addSuffix: true, ...dateFnsLocale }), defaultValue: 'Active {{time}}' })
                              : t('admin.members.neverActive', 'Never active')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                            style={{ color: tier.color, background: tier.bg, borderColor: `${tier.color}33` }}>
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tier.color }} />
                            {m.score}%
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setQuickMsgMemberId(m.id); }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--color-text-muted)' }}
                            title={t('admin.members.message', 'Message')}
                            aria-label={t('admin.members.messageMember', { name: m.full_name, defaultValue: 'Message {{name}}' })}
                          >
                            <MessageSquare size={14} />
                          </button>
                          <ChevronRight size={14} style={{ color: 'var(--color-text-faint)' }} className="group-hover:translate-x-0.5 transition-transform duration-200" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Show more paginated members */}
              {visibleCount < filtered.length && (
                <div className="flex justify-center mt-4">
                  <button
                    onClick={() => setVisibleCount(v => v + 10)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 hover:scale-[1.02]"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
                  >
                    <ChevronDown size={14} />
                    {t('admin.members.showMore', { count: Math.min(10, filtered.length - visibleCount), defaultValue: 'Show {{count}} more' })}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Load More button */}
          {hasMoreMembers && !isLoading && filtered.length > 0 && (
            <div className="flex justify-center mt-4 mb-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 hover:scale-[1.02] disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              >
                {loadingMore ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    {t('admin.members.loadingMore', 'Loading...')}
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} />
                    {t('admin.members.loadMore', 'Load More Members')}
                  </>
                )}
              </button>
            </div>
          )}
        </>
          );
          if (tabKey === 'invites') return (
        invitesLoading ? (
          <TableSkeleton rows={6} />
        ) : (
          <div className="space-y-4">
            {/* Invite sub-filter tabs */}
            <div className="flex items-center gap-2">
              {[
                { key: 'pending', label: k('filterPending'), count: pendingInvites.length },
                { key: 'claimed', label: k('filterClaimed'), count: claimedInvites.length },
                { key: 'all', label: k('filterAll'), count: allInvites.length },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setInviteFilter(opt.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors border ${
                    inviteFilter === opt.key
                      ? 'bg-[#D4AF37]/12 text-[#D4AF37] border-[#D4AF37]/25'
                      : 'bg-white/4 text-[#6B7280] border-white/6 hover:text-[#9CA3AF]'
                  }`}
                >
                  {opt.label}
                  <span className="text-[10px] opacity-70">{opt.count}</span>
                </button>
              ))}
            </div>

            {filteredInvites.length === 0 ? (
              <div className="text-center py-16">
                <UserPlus size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
                <p className="text-[14px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{k('noInvitesFound')}</p>
              </div>
            ) : (
              <div className="rounded-[14px] overflow-hidden"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  {filteredInvites.map(inv => {
                    const status = getInviteStatus(inv);
                    const now = new Date();
                    const expiresAt = inv.expires_at ? new Date(inv.expires_at) : null;
                    const daysLeft = expiresAt && status === 'pending' ? differenceInDays(expiresAt, now) : null;

                    const statusColors = {
                      pending: { bg: 'bg-[#D4AF37]/12', text: 'text-[#D4AF37]', border: 'border-[#D4AF37]/25' },
                      claimed: { bg: 'bg-[#10B981]/12', text: 'text-[#10B981]', border: 'border-[#10B981]/25' },
                      expired: { bg: 'bg-[#EF4444]/12', text: 'text-[#EF4444]', border: 'border-[#EF4444]/25' },
                    };
                    const sc = statusColors[status] || statusColors.pending;

                    return (
                      <div key={inv.id}
                        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03] transition-all">
                        <div className="w-9 h-9 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center flex-shrink-0">
                          {status === 'claimed' ? (
                            <CheckCircle size={15} className="text-[#10B981]" />
                          ) : (
                            <Clock size={15} className="text-[#D4AF37]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{inv.member_name || k('unnamed')}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text} border ${sc.border}`}>
                              {status === 'pending' && daysLeft !== null
                                ? `${k('statusPending')} · ${daysLeft}${k('daysLeftShort')}`
                                : status === 'claimed'
                                ? k('statusClaimed')
                                : status === 'expired'
                                ? k('statusExpired')
                                : k('statusPending')}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#6B7280]">
                            {inv.email && <span className="inline-flex items-center gap-0.5 mr-2"><Mail size={9} /> {inv.email}</span>}
                            {inv.phone && <span className="inline-flex items-center gap-0.5 mr-2"><Phone size={9} /> {inv.phone}</span>}
                            {!inv.email && !inv.phone && k('noContact')}
                            {' · '}{format(new Date(inv.created_at), 'MMM d, yyyy', dateFnsLocale)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <code className="text-[12px] font-mono text-[#D4AF37] bg-[#D4AF37]/8 px-2.5 py-1 rounded-lg border border-[#D4AF37]/15 hidden sm:block">
                            {inv.invite_code}
                          </code>
                          <button onClick={() => handleCopyCode(inv)}
                            title={k('copyInviteCode')}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors">
                            <Copy size={12} />
                            {copiedId === inv.id ? k('copied') : k('copy')}
                          </button>
                          {status === 'pending' && (
                            <button onClick={() => handleRevokeInvite(inv.id)}
                              title={k('revokeInvite')}
                              aria-label={k('revokeInvite')}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-semibold bg-[#EF4444]/8 border border-[#EF4444]/15 text-[#EF4444]/70 hover:text-[#EF4444] hover:border-[#EF4444]/30 transition-colors min-w-[44px] min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )
          );
          if (tabKey === 'resets') return (
        pendingResets.length === 0 ? (
          <div className="text-center py-16">
            <KeyRound size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
            <p className="text-[14px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.members.noPendingResets', 'No pending password resets')}</p>
          </div>
        ) : (
          <div className="rounded-[14px] overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
              {pendingResets.map(r => (
                <div
                  key={r.id}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03] transition-all cursor-pointer"
                  onClick={() => setResetApprovalId(r.id)}
                >
                  <div className="w-9 h-9 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center flex-shrink-0">
                    <KeyRound size={15} className="text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">
                        {r.profiles?.full_name || 'Unknown'}
                      </p>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25">
                        {t('admin.members.pendingReset', 'Pending Reset')}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {r.profiles?.username ? `@${r.profiles.username} · ` : ''}
                      {t('admin.members.requested', 'Requested')} {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, ...dateFnsLocale })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setResetApprovalId(r.id); }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/18 transition-colors"
                    >
                      <CheckCircle size={12} />
                      {t('admin.members.review', 'Review')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
          );
          return null;
        }}
      </SwipeableTabContent>

      {selected && (
        <MemberDetail key={selected.id} member={selected} gymId={gymId}
          onClose={() => setSelected(null)} onNoteSaved={handleNoteSaved} onStatusChanged={handleStatusChanged} />
      )}

      {showInvite && <InviteModal gymId={gymId} onClose={() => setShowInvite(false)} />}

      {showCreateInvite && (
        <CreateInviteModal
          gymId={gymId}
          onClose={() => setShowCreateInvite(false)}
          onCreated={() => refetchInvites()}
        />
      )}

      {resetApprovalId && (
        <PasswordResetApprovalModal
          requestId={resetApprovalId}
          onClose={() => setResetApprovalId(null)}
          onComplete={() => {
            setResetApprovalId(null);
            refetchResets();
          }}
        />
      )}

      {bulkAction === 'message' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <h3 className="text-[16px] font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>{t('admin.members.messageCount', { count: selectedIds.size })}</h3>
            <textarea id="bulk-msg" rows={4} placeholder={t('admin.members.typeMessage')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none mb-4 transition-colors"
              style={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            <div className="flex gap-2">
              <button onClick={() => setBulkAction(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                style={{ backgroundColor: 'var(--color-bg-base)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>{t('admin.members.cancel')}</button>
              <button onClick={() => { const msg = document.getElementById('bulk-msg').value; if (msg.trim()) handleBulkMessage(msg); }}
                className="flex-1 py-2.5 rounded-xl font-bold text-[13px] transition-all hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-base)' }}>{t('admin.members.send')}</button>
            </div>
          </div>
        </div>
      )}

      {bulkAction === 'freeze' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <h3 className="text-[16px] font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('admin.members.freezeConfirmTitle', { count: selectedIds.size, defaultValue: 'Freeze {{count}} members?' })}</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.members.freezeConfirmDesc', 'This will set their membership status to frozen. They can be reactivated later.')}</p>
            <div className="flex gap-2">
              <button onClick={() => setBulkAction(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                style={{ backgroundColor: 'var(--color-bg-base)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>{t('admin.members.cancel')}</button>
              <button onClick={handleBulkFreeze}
                className="flex-1 py-2.5 rounded-xl font-bold text-[13px] text-white transition-all hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--color-danger, #EF4444)' }}>{t('admin.members.freezeAll')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Quick message modal for individual member */}
      {quickMsgMemberId && (() => {
        const targetMember = members.find(m => m.id === quickMsgMemberId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setQuickMsgMemberId(null)}>
            <div className="w-full max-w-md mx-4 p-6 rounded-2xl shadow-2xl"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <Avatar name={targetMember?.full_name} />
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {t('admin.members.messageToMember', { name: targetMember?.full_name?.split(' ')[0] || '', defaultValue: 'Message {{name}}' })}
                  </h3>
                  <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.members.sentAsNotification', { defaultValue: 'Sent as in-app notification' })}</p>
                </div>
              </div>
              <textarea id="quick-msg" rows={3} autoFocus placeholder={t('admin.members.typeMessage')}
                className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none mb-4 transition-colors"
                style={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
              <div className="flex gap-2">
                <button onClick={() => setQuickMsgMemberId(null)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-base)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>{t('admin.members.cancel')}</button>
                <button onClick={() => { const msg = document.getElementById('quick-msg').value; if (msg.trim()) handleQuickMessage(quickMsgMemberId, msg); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-[13px] transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-base)' }}>
                  <Send size={13} /> {t('admin.members.send')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </AdminPageShell>
  );
}
