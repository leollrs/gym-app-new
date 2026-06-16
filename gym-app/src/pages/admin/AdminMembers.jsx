import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, ChevronLeft, Users, Download, Link, Copy, Trash2, Clock, KeyRound, CheckCircle, XCircle, UserPlus, Mail, Phone, ChevronDown, CheckSquare, Square, X, AlertTriangle, RefreshCw, MessageSquare, Send, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { sendNotification } from '../../lib/notifications';
import { format, formatDistanceToNow, differenceInDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { exportCSV } from '../../lib/csvExport';
import { exportGymWorkoutHistory, exportGymPersonalRecords, exportGymBodyMetrics, exportSelectedMembersCSV } from '../../lib/exportData';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';

// Shared components
import { PageHeader, FilterBar, Avatar, TableSkeleton, AdminPageShell, AdminTable, StatCard, AdminTabs } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { StatusBadge, StatusDot } from '../../components/admin/StatusBadge';

// Sub-components
import InviteModal from './components/InviteModal';
import CreateInviteModal from './components/CreateInviteModal';
import MemberDetail from './components/MemberDetail';
import PasswordResetApprovalModal from './components/PasswordResetApprovalModal';

import { translateSignal as translateChurnSignal } from '../../lib/churn/signalI18n';
import { fetchMembers, fetchAllInvites, getInviteStatus, MEMBERS_PAGE_SIZE } from '../../lib/admin/memberQueries';
export { translateChurnSignal };

// Members directory page size for the numbered pagination. 7 rows render in full
// with no scrolling inside the table.
const PAGE_SIZE = 7;

// Sort accessors for the directory columns — used to sort the FULL filtered set
// before paginating (so column-header sort spans every page, not just the
// current one). Keyed by the AdminTable column `key`.
const MEMBER_SORTS = {
  full_name: (m) => (m.full_name || '').toLowerCase(),
  membership_status: (m) => m.membership_status || '',
  last_seen: (m) => new Date(m.last_active_at ?? m.lastSessionAt ?? m.created_at).getTime(),
};

// Windowed page-number list: 1 … (cur-1) cur (cur+1) … N, collapsing long runs.
function getPageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push('ellipsis-l');
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push('ellipsis-r');
  out.push(total);
  return out;
}

export default function AdminMembers() {
  const { profile, availableRoles } = useAuth();
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
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [tab, setTab] = useState('members'); // 'members' | 'invites' | 'resets'
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [resetApprovalId, setResetApprovalId] = useState(null);
  const [inviteFilter, setInviteFilter] = useState('pending');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null); // 'message' | 'freeze' | 'export' | 'assign_trainer'
  const [membersPage, setMembersPage] = useState(0);
  const [allMembers, setAllMembers] = useState([]);
  const [hasMoreMembers, setHasMoreMembers] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [quickMsgMemberId, setQuickMsgMemberId] = useState(null);

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

  useEffect(() => { document.title = `${t('admin.members.pageTitle', 'Admin - Members')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

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
      // Strict `>` so a page that returns exactly MEMBERS_PAGE_SIZE doesn't keep
      // showing "Load more" with no actual remaining rows — server returns at most
      // PAGE_SIZE items per fetch, so a full page is the only signal we have that
      // *more* might exist. False positives mean one extra empty fetch; that's
      // acceptable. The previous `>=` always over-promised by one fetch.
      setHasMoreMembers(moreMembers.length > 0 && moreMembers.length === MEMBERS_PAGE_SIZE);
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
  const [qrInvite, setQrInvite] = useState(null); // invite object to show QR for
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(null);
  const exportMenuRef = useRef(null);

  // Lock body scroll while any bulk action / quick message / QR invite modal is open
  const anyAdminMembersModalOpen = !!qrInvite || !!bulkAction || !!quickMsgMemberId;
  useEffect(() => {
    if (!anyAdminMembersModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [anyAdminMembersModalOpen]);

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

  // Lifecycle-only counts. At-risk / critical / watch / healthy churn buckets
  // live in AdminChurn — this page is a clean directory and intentionally
  // stays neutral about retention signals.
  const activeCount = members.filter(m => m.membership_status === 'active').length;
  const frozenCount = members.filter(m => m.membership_status === 'frozen').length;

  // When every selected member is already frozen, the bulk "Freeze" button flips
  // to "Unfreeze" (freezing a frozen member is a no-op — e.g. selecting rows
  // under the Congelados filter). Defined after `members` to avoid a TDZ.
  const selectedAllFrozen = selectedIds.size > 0
    && members.filter(m => selectedIds.has(m.id)).every(m => m.membership_status === 'frozen');
  const unonboardedCount = members.filter(m => m.is_onboarded === false).length;

  const filtered = useMemo(() => {
    let list = members;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(m => (m.full_name || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q));
    }
    if (filter === 'active') list = list.filter(m => m.membership_status === 'active');
    else if (filter === 'frozen') list = list.filter(m => m.membership_status === 'frozen');
    else if (filter === 'unonboarded') list = list.filter(m => m.is_onboarded === false);
    // Directory sort: alphabetical by name. The previous "sort by score"
    // tied the directory to churn signals; AdminChurn handles urgency-based
    // ordering. Here we want a stable, predictable A-Z list.
    list = [...list].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    return list;
  }, [members, debouncedSearch, filter]);

  // Numbered page pagination over the loaded+filtered set. Column-header sort is
  // controlled here (sort the full set, THEN slice the page) so it spans every
  // page, not just the current one. When the local cache is exhausted and the
  // server has more, the Next control falls through to handleLoadMore().
  const [page, setPage] = useState(1);
  const [tableSort, setTableSort] = useState({ key: null, dir: 'asc' });
  const handleTableSort = (key) =>
    setTableSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const sortedFiltered = useMemo(() => {
    const fn = tableSort.key && MEMBER_SORTS[tableSort.key];
    if (!fn) return filtered;
    return [...filtered].sort((a, b) => {
      const av = fn(a), bv = fn(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return tableSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, tableSort]);

  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [debouncedSearch, filter, tab]);
  useEffect(() => { setPage(p => Math.min(p, totalPages)); }, [totalPages]);
  const pageItems = useMemo(() => sortedFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sortedFiltered, page]);

  const handleBulkFreeze = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) { setBulkAction(null); return; }
    try {
      // Prefer RPC if available so freeze logic stays server-side.
      // TODO: add `admin_bulk_freeze(p_ids uuid[])` RPC to centralise audit
      // logging + status transitions; for now we fall back to a direct update
      // (RLS already restricts this to gym admins).
      const { error: rpcError } = await supabase.rpc('admin_bulk_freeze', { p_ids: ids });
      let updateError = null;
      if (rpcError) {
        // Fallback: direct profile update gated by RLS + explicit gym_id check
        const { error } = await supabase
          .from('profiles')
          .update({ membership_status: 'frozen' })
          .in('id', ids)
          .eq('gym_id', gymId);
        updateError = error;
      }
      if (updateError) {
        logger.error('Bulk freeze failed', updateError);
        showToast(t('admin.members.bulkFreezeError', { defaultValue: 'Failed to freeze members. Please try again.' }), 'error');
        return;
      }
      ids.forEach(id => logAdminAction('bulk_freeze', 'member', id));
      posthog?.capture('admin_member_frozen', { bulk: true, count: ids.length });
      showToast(t('admin.members.bulkFreezeSuccess', { count: ids.length, defaultValue: '{{count}} members frozen' }), 'success');
      refetch();
      clearSelection();
      setBulkAction(null);
    } catch (err) {
      logger.error('Bulk freeze failed', err);
      showToast(t('admin.members.bulkFreezeError', { defaultValue: 'Failed to freeze members. Please try again.' }), 'error');
    }
  };

  const handleBulkUnfreeze = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) { setBulkAction(null); return; }
    try {
      // Direct update gated by RLS + explicit gym_id; only flips rows that are
      // actually frozen → active, and stamps the status timestamp.
      const { error } = await supabase
        .from('profiles')
        .update({ membership_status: 'active', membership_status_updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('gym_id', gymId)
        .eq('membership_status', 'frozen');
      if (error) {
        logger.error('Bulk unfreeze failed', error);
        showToast(t('admin.members.bulkUnfreezeError', { defaultValue: 'Failed to unfreeze members. Please try again.' }), 'error');
        return;
      }
      ids.forEach(id => logAdminAction('bulk_unfreeze', 'member', id));
      posthog?.capture('admin_member_unfrozen', { bulk: true, count: ids.length });
      showToast(t('admin.members.bulkUnfreezeSuccess', { count: ids.length, defaultValue: '{{count}} members unfrozen' }), 'success');
      refetch();
      clearSelection();
      setBulkAction(null);
    } catch (err) {
      logger.error('Bulk unfreeze failed', err);
      showToast(t('admin.members.bulkUnfreezeError', { defaultValue: 'Failed to unfreeze members. Please try again.' }), 'error');
    }
  };

  const handleBulkExportSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await exportSelectedMembersCSV(ids);
      ids.forEach(id => logAdminAction('bulk_export', 'member', id));
      showToast(t('admin.members.bulkExportSuccess', { count: ids.length, defaultValue: 'Exported {{count}} members' }), 'success');
    } catch (err) {
      logger.error('Bulk export failed', err);
      showToast(t('admin.members.bulkExportError', { defaultValue: 'Failed to export members. Please try again.' }), 'error');
    }
    clearSelection();
  };

  const handleBulkMessage = async (message) => {
    const ids = [...selectedIds];
    const total = ids.length;
    let successCount = 0;
    for (const id of ids) {
      try {
        await sendNotification(id, gymId, { type: 'admin_message', title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: message, data: { source: 'admin_bulk_message' } });
        logAdminAction('bulk_message', 'member', id);
        successCount++;
      } catch (err) {
        logger.error('Bulk message failed for member:', id, err);
      }
    }
    if (successCount === 0) {
      showToast(t('admin.members.bulkMessageError', { defaultValue: "Couldn't send — try again" }), 'error');
    } else if (successCount < total) {
      showToast(t('admin.members.bulkPartialResult', { success: successCount, total, defaultValue: 'Sent to {{success}} of {{total}} members' }), 'warning');
    } else {
      showToast(t('admin.members.bulkMessageSuccess', { count: successCount, defaultValue: 'Message sent to {{count}} members' }), 'success');
    }
    clearSelection();
    setBulkAction(null);
  };

  const handleQuickMessage = async (memberId, message) => {
    if (!message?.trim()) return;
    try {
      await sendNotification(memberId, gymId, { type: 'admin_message', title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: message, data: { source: 'admin_quick_message' } });
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
    { key: 'active', label: t('admin.members.filterActive', 'Active'), count: activeCount },
    { key: 'frozen', label: t('admin.members.filterFrozen', 'Frozen'), count: frozenCount },
    { key: 'unonboarded', label: t('admin.members.filterUnonboarded', 'Not signed up'), count: unonboardedCount },
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
          className="transition-colors"
          style={{ color: 'var(--color-admin-text-muted)' }}
          aria-label={selectedIds.has(m.id) ? t('admin.members.deselectMember', 'Deselect member') : t('admin.members.selectMember', 'Select member')}
        >
          {selectedIds.has(m.id) ? (
            <CheckSquare size={16} style={{ color: 'var(--color-accent)' }} />
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
          <Avatar name={m.full_name} src={m.checkin_photo_url} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>{m.full_name}</p>
            <p className="text-[12px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
              {m.lastActivityAt
                ? t('admin.members.activeAgo', { time: formatDistanceToNow(new Date(m.lastActivityAt), { addSuffix: true, ...dateFnsLocale }), defaultValue: 'Active {{time}}' })
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
      render: (m) => <StatusDot status={m.membership_status} />,
      className: 'text-center',
      headerClassName: 'text-center',
    },
    {
      key: 'last_seen',
      label: t('admin.members.colLastActive', 'Last Active'),
      sortable: true,
      sortValue: (m) => new Date(m.lastActivityAt ?? m.created_at).getTime(),
      render: (m) => (
        <span className="text-[12px]" style={{ color: 'var(--color-admin-text-sub)' }}>
          {m.lastActivityAt
            ? formatDistanceToNow(new Date(m.lastActivityAt), { addSuffix: true, ...dateFnsLocale })
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
      <div data-admin-tour="members">
      <PageHeader
        title={`${t('admin.members.title', 'Members')} (${members.length})`}
        subtitle={t('admin.members.subtitleDirectory', { total: members.length, defaultValue: '{{total}} total members' })}
        actions={
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap pb-1 md:pb-0">
            {(tab === 'members' || tab === 'invites') && (
              <>
                <button onClick={() => setShowInvite(true)}
                  className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
                  style={{ color: 'var(--color-accent)', borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                  <Link size={13} /> {k('inviteMember')}
                </button>
                <button onClick={() => setShowCreateInvite(true)}
                  className="admin-pill admin-pill--dark flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
                  <UserPlus size={13} /> {k('addMember')}
                </button>
              </>
            )}
          </div>
        }
      />
      </div>

      {/* Top summary row -- visible on all tabs.
          Risk-tier cards (Critical, At Risk) moved to AdminChurn — this page
          is a directory, not a retention dashboard. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mt-6 mb-6">
        <StatCard
          label={t('admin.members.statTotal', 'Total Members')}
          value={members.length}
          borderColor="var(--color-info)"
          icon={Users}
          delay={0}
        />
        <StatCard
          label={t('admin.members.statFrozen', 'Frozen')}
          value={frozenCount}
          borderColor="var(--color-info)"
          icon={Clock}
          delay={0.05}
          onClick={() => { setTab('members'); setFilter('frozen'); }}
        />
        <StatCard
          label={t('admin.members.statPendingInvites', 'Pending Invites')}
          value={pendingCount}
          borderColor="var(--color-accent)"
          icon={UserPlus}
          delay={0.1}
          onClick={() => { setTab('invites'); }}
        />
        <StatCard
          label={t('admin.members.statPendingResets', 'Pending Resets')}
          value={resetCount}
          borderColor="var(--color-coach)"
          icon={KeyRound}
          delay={0.15}
          onClick={() => { setTab('resets'); }}
        />
      </div>

      {/* Tab strip */}
      <AdminTabs tabs={tabOptions} active={tab} onChange={(key) => { setTab(key); setSearch(''); setFilter('all'); clearSelection(); }} className="mb-4" />

      <SwipeableTabContent tabs={tabOptions} active={tab} onChange={(key) => { setTab(key); setSearch(''); setFilter('all'); clearSelection(); }}>
        {(tabKey) => {
          if (tabKey === 'members') return (
        <>
          {/* Churn-workflow discovery hint: shown only when an external link
              still points at the old ?filter=at-risk surface. One-time
              redirect cue — not a permanent banner. */}
          {searchParams.get('filter') === 'at-risk' && (
            <div className="mb-3 px-4 py-2.5 rounded-xl text-[12px] flex items-center gap-2 justify-between"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)', color: 'var(--color-accent)' }}>
              <span className="flex items-center gap-2 min-w-0">
                <AlertTriangle size={14} className="flex-shrink-0" />
                <span className="truncate">{t('admin.members.churnMovedHint', 'At-risk member workflows moved to Churn Intel.')}</span>
              </span>
              <button
                onClick={() => navigate('/admin/churn')}
                className="admin-pill admin-pill--outline flex-shrink-0 whitespace-nowrap"
                style={{ color: 'var(--color-accent)', borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                {t('admin.members.openChurn', 'Open Churn Intel')}
              </button>
            </div>
          )}
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
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-admin-panel) 95%, transparent)' }}>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input type="text" placeholder={t('admin.members.searchPlaceholder')} aria-label={t('admin.members.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
                className="w-full rounded-xl pl-9 pr-4 py-2.5 text-[13px] outline-none transition-all duration-200"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
            <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 lg:mx-0 lg:px-0 lg:overflow-visible">
              <FilterBar options={filterOptions} active={filter} onChange={setFilter} />
            </div>
            <div className="relative flex-shrink-0" ref={exportMenuRef}>
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

          <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl mb-4 transition-all duration-300 overflow-x-auto scrollbar-hide"
            style={{
              backgroundColor: selectedIds.size > 0 ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-bg-deep)',
              border: selectedIds.size > 0 ? '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' : '1px solid var(--color-border-subtle)',
            }}>
            <span className="text-[12px] md:text-[13px] font-semibold flex-shrink-0 whitespace-nowrap" style={{ color: selectedIds.size > 0 ? 'var(--color-accent)' : 'var(--color-text-faint)' }}>
              {selectedIds.size > 0
                ? t('admin.members.selectedCount', { count: selectedIds.size, defaultValue: '{{count}} selected' })
                : t('admin.members.bulkActions', { defaultValue: 'Select members for bulk actions' })}
            </span>
            <div className="flex-1 hidden md:block" />
            <button onClick={handleBulkExportSelected} disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 whitespace-nowrap transition-all duration-200 hover:scale-[1.03] disabled:opacity-30 disabled:pointer-events-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              <Download size={12} /> {t('admin.members.export', 'Export')}
            </button>
            <button onClick={() => setBulkAction('message')} disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 whitespace-nowrap transition-all duration-200 hover:scale-[1.03] disabled:opacity-30 disabled:pointer-events-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              <Mail size={12} /> {t('admin.members.message', 'Message')}
            </button>
            <button onClick={() => setBulkAction(selectedAllFrozen ? 'unfreeze' : 'freeze')} disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 whitespace-nowrap transition-all duration-200 hover:scale-[1.03] disabled:opacity-30 disabled:pointer-events-none"
              style={selectedAllFrozen
                ? { backgroundColor: 'color-mix(in srgb, var(--color-info) 12%, transparent)', color: 'var(--color-info)' }
                : { backgroundColor: 'color-mix(in srgb, var(--color-danger) 10%, transparent)', color: 'var(--color-danger)' }}>
              {selectedAllFrozen ? t('admin.members.unfreeze', 'Unfreeze') : t('admin.members.freeze', 'Freeze')}
            </button>
            {selectedIds.size > 0 && (
              <button onClick={clearSelection}
                aria-label={t('admin.members.clearSelection', 'Clear selection')}
                className="transition-colors p-1 flex-shrink-0"
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
              {/* Desktop table */}
              <div className="hidden md:block">
                <AdminTable
                  columns={memberTableColumns}
                  data={pageItems}
                  onRowClick={(m) => setSelected(m)}
                  sort={tableSort}
                  onSortChange={handleTableSort}
                />
              </div>
              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {pageItems.map(m => (
                  <div key={m.id} role="button" tabIndex={0} onClick={() => setSelected(m)}
                    onKeyDown={e => { if (e.key === 'Enter') setSelected(m); }}
                    className="admin-card p-3 flex items-center gap-3 cursor-pointer group">
                    <div onClick={e => { e.stopPropagation(); toggleSelect(m.id); }}
                      role="button" tabIndex={0} aria-label={selectedIds.has(m.id) ? t('admin.members.deselectMember', 'Deselect member') : t('admin.members.selectMember', 'Select member')}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSelect(m.id); } }}
                      className="flex items-center justify-center w-5 h-5 flex-shrink-0 cursor-pointer">
                      {selectedIds.has(m.id) ? (
                        <CheckSquare size={16} style={{ color: 'var(--color-accent)' }} />
                      ) : (
                        <Square size={16} style={{ color: 'var(--color-text-faint)' }} className="group-hover:opacity-80" />
                      )}
                    </div>
                    <Avatar name={m.full_name} src={m.checkin_photo_url} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{m.full_name}</p>
                        <StatusBadge status={m.membership_status} />
                        {m.admin_note && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 60%, transparent)' }} title={t('admin.members.hasNote', 'Has note')} />}
                      </div>
                      {m.username && (
                        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-faint)' }}>@{m.username}</p>
                      )}
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {m.lastActivityAt
                          ? t('admin.members.activeAgo', { time: formatDistanceToNow(new Date(m.lastActivityAt), { addSuffix: true, ...dateFnsLocale }), defaultValue: 'Active {{time}}' })
                          : t('admin.members.neverActive', 'Never active')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 flex-shrink-0">
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
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Numbered page pagination — range on the left, page numbers + prev/next
              on the right. On the last loaded page, Next falls through to a server
              fetch when the gym has more than the loaded set (200 rows per fetch). */}
          {!isLoading && filtered.length > 0 && (() => {
            const total = sortedFiltered.length;
            const startIdx = (page - 1) * PAGE_SIZE;
            const endIdx = Math.min(startIdx + PAGE_SIZE, total);
            const showNav = totalPages > 1 || hasMoreMembers;
            const nextDisabled = (page >= totalPages && !hasMoreMembers) || loadingMore;
            const goNext = async () => {
              if (page < totalPages) { setPage(p => p + 1); }
              else if (hasMoreMembers) { await handleLoadMore(); setPage(p => p + 1); }
            };
            return (
              <div className="flex items-center justify-between gap-3 flex-wrap mt-4 pt-3"
                style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                <span className="text-[12px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.members.showingRange', {
                    from: total === 0 ? 0 : startIdx + 1,
                    to: endIdx,
                    total: hasMoreMembers ? `${total}+` : total,
                    defaultValue: '{{from}}–{{to}} of {{total}}',
                  })}
                </span>
                {showNav && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      aria-label={t('admin.members.pagePrev', 'Previous page')}
                      className="w-8 h-8 flex items-center justify-center rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      style={{ border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                      <ChevronLeft size={15} />
                    </button>
                    {getPageWindow(page, totalPages).map(n => (
                      typeof n === 'string' ? (
                        <span key={n} className="w-7 h-8 flex items-center justify-center text-[12px]" style={{ color: 'var(--color-text-faint)' }}>…</span>
                      ) : (
                        <button key={n} onClick={() => setPage(n)} aria-current={n === page ? 'page' : undefined}
                          className="min-w-[32px] h-8 px-2 flex items-center justify-center rounded-lg text-[12px] font-semibold transition-colors"
                          style={n === page
                            ? { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)', border: '1px solid var(--color-accent)' }
                            : { border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}>
                          {n}
                        </button>
                      )
                    ))}
                    <button
                      onClick={goNext}
                      disabled={nextDisabled}
                      aria-label={t('admin.members.pageNext', 'Next page')}
                      className="w-8 h-8 flex items-center justify-center rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      style={{ border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                      {loadingMore ? <RefreshCw size={14} className="animate-spin" /> : <ChevronRight size={15} />}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </>
          );
          if (tabKey === 'invites') return (
        invitesLoading ? (
          <TableSkeleton rows={6} />
        ) : (
          <div className="space-y-4">
            {/* Invite sub-filter tabs */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-1">
              {[
                { key: 'pending', label: k('filterPending'), count: pendingInvites.length },
                { key: 'claimed', label: k('filterClaimed'), count: claimedInvites.length },
                { key: 'all', label: k('filterAll'), count: allInvites.length },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setInviteFilter(opt.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold flex-shrink-0 whitespace-nowrap transition-colors border ${
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
                            <p className="text-[14px] font-semibold text-[var(--color-admin-text)] truncate">{inv.member_name || k('unnamed')}</p>
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
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-[var(--color-bg-hover)] border border-[var(--color-admin-border)] text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] hover:border-[var(--color-admin-border)] transition-colors">
                            <Copy size={12} />
                            {copiedId === inv.id ? k('copied') : k('copy')}
                          </button>
                          <button onClick={() => setQrInvite(inv)}
                            title={t('admin.members.qrCodeTitle', 'QR Code')}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-semibold bg-[var(--color-bg-hover)] border border-[var(--color-admin-border)] text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] hover:border-[var(--color-admin-border)] transition-colors">
                            <QrCode size={12} />
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
                      <p className="text-[14px] font-semibold text-[var(--color-admin-text)] truncate">
                        {r.profiles?.full_name || t('admin.members.unknown', 'Unknown')}
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

      {/* QR Code modal for invites */}
      {qrInvite && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 pt-[calc(56px+env(safe-area-inset-top)+12px)] pb-[calc(80px+env(safe-area-inset-bottom)+12px)] md:p-6 px-4" onClick={() => setQrInvite(null)}>
          <div className="w-full max-w-[320px] p-6 rounded-2xl text-center" onClick={e => e.stopPropagation()}
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>{qrInvite.member_name}</p>
            <p className="text-[22px] font-mono font-bold tracking-[0.2em] mb-4" style={{ color: 'var(--color-accent)' }}>{qrInvite.invite_code}</p>
            <div className="bg-white p-4 rounded-xl inline-block mb-4">
              <QRCodeSVG value={`https://tugympr.app/invite/${qrInvite.invite_code}`} size={180} level="H" />
            </div>
            <p className="text-[11px] font-mono mb-4 break-all" style={{ color: 'var(--color-text-muted)' }}>
              tugympr.app/invite/{qrInvite.invite_code}
            </p>
            <button onClick={() => setQrInvite(null)}
              className="px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
              {t('common:close', 'Close')}
            </button>
          </div>
        </div>
      )}

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
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 pt-[calc(56px+env(safe-area-inset-top)+12px)] pb-[calc(80px+env(safe-area-inset-bottom)+12px)] md:p-6">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <h3 className="text-[16px] font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>{t('admin.members.messageCount', { count: selectedIds.size })}</h3>
            <textarea id="bulk-msg" rows={4} placeholder={t('admin.members.typeMessage')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none mb-4 transition-colors"
              style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            <div className="flex gap-2">
              <button onClick={() => setBulkAction(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>{t('admin.members.cancel')}</button>
              <button onClick={() => { const msg = document.getElementById('bulk-msg').value; if (msg.trim()) handleBulkMessage(msg); }}
                className="flex-1 py-2.5 rounded-xl font-bold text-[13px] transition-all hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>{t('admin.members.send')}</button>
            </div>
          </div>
        </div>
      )}

      {bulkAction === 'freeze' && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 pt-[calc(56px+env(safe-area-inset-top)+12px)] pb-[calc(80px+env(safe-area-inset-bottom)+12px)] md:p-6">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <h3 className="text-[16px] font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('admin.members.freezeConfirmTitle', { count: selectedIds.size, defaultValue: 'Freeze {{count}} members?' })}</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.members.freezeConfirmDesc', 'This will set their membership status to frozen. They can be reactivated later.')}</p>
            <div className="flex gap-2">
              <button onClick={() => setBulkAction(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>{t('admin.members.cancel')}</button>
              <button onClick={handleBulkFreeze}
                className="flex-1 py-2.5 rounded-xl font-bold text-[13px] text-white transition-all hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--color-danger, #EF4444)' }}>{t('admin.members.freezeAll')}</button>
            </div>
          </div>
        </div>
      )}

      {bulkAction === 'unfreeze' && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 pt-[calc(56px+env(safe-area-inset-top)+12px)] pb-[calc(80px+env(safe-area-inset-bottom)+12px)] md:p-6">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <h3 className="text-[16px] font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('admin.members.unfreezeConfirmTitle', { count: selectedIds.size, defaultValue: 'Unfreeze {{count}} members?' })}</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.members.unfreezeConfirmDesc', 'This reactivates their membership.')}</p>
            <div className="flex gap-2">
              <button onClick={() => setBulkAction(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>{t('admin.members.cancel')}</button>
              <button onClick={handleBulkUnfreeze}
                className="flex-1 py-2.5 rounded-xl font-bold text-[13px] text-white transition-all hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--color-info, #4A7AE6)' }}>{t('admin.members.unfreezeAll', 'Unfreeze all')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Quick message modal for individual member */}
      {quickMsgMemberId && (() => {
        const targetMember = members.find(m => m.id === quickMsgMemberId);
        return (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 pt-[calc(56px+env(safe-area-inset-top)+12px)] pb-[calc(80px+env(safe-area-inset-bottom)+12px)] md:p-6"
            onClick={() => setQuickMsgMemberId(null)}>
            <div className="w-full max-w-md mx-4 p-6 rounded-2xl shadow-2xl"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <Avatar name={targetMember?.full_name} src={targetMember?.checkin_photo_url} />
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {t('admin.members.messageToMember', { name: targetMember?.full_name?.split(' ')[0] || '', defaultValue: 'Message {{name}}' })}
                  </h3>
                  <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.members.sentAsNotification', { defaultValue: 'Sent as in-app notification' })}</p>
                </div>
              </div>
              <textarea id="quick-msg" rows={3} autoFocus placeholder={t('admin.members.typeMessage')}
                className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none mb-4 transition-colors"
                style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
              <div className="flex gap-2">
                <button onClick={() => setQuickMsgMemberId(null)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>{t('admin.members.cancel')}</button>
                <button onClick={() => { const msg = document.getElementById('quick-msg').value; if (msg.trim()) handleQuickMessage(quickMsgMemberId, msg); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-[13px] transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>
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
