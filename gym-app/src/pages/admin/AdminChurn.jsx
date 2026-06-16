import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Search, Phone, Filter, Users, Clock, RotateCcw,
  CheckCircle, MessageSquare, Download, Square, CheckSquare, Send,
  UserPlus, X, Sparkles, FlaskConical, Trophy, StopCircle, Plus, ChevronDown, MoreHorizontal, Trash2,
  RefreshCw, Target, Activity, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { loadGymChurnScores, estimateChurnScoreFallback, fetchChurnFallback, autoDetectReturns } from '../../lib/churnScore';
import { exportCSV } from '../../lib/csvExport';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';

// Shared components
import { PageHeader, Avatar, FilterBar, StatCard, SkeletonRow, AdminTable, AdminPageShell, AdminTabs, AdminModal } from '../../components/admin';
import FollowUpSettings from './components/FollowUpSettings';
import AdminPagination from '../../components/admin/AdminPagination';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { ScoreBar, RiskBadge } from '../../components/admin/StatusBadge';

import { translateSignal, translateSignalName } from '../../lib/churn/signalI18n';

// Sub-components
import WinBackModal from './components/WinBackModal';
import ContactPanel from './components/ContactPanel';
import CreateCampaignModal from './components/CreateCampaignModal';
import BulkMessageModal from './components/BulkMessageModal';
import MemberDetailPanel from './components/MemberDetailPanel';
import { outcomeConfig, METHOD_I18N } from './components/churnDisplay';

// ── Data fetcher ──────────────────────────────────────────
async function fetchChurnData(gymId) {
  let scored;
  try {
    scored = await loadGymChurnScores(gymId, supabase);
    logger.debug('[Churn] v2 scoring returned:', scored?.length, 'members');
  } catch (err) {
    logger.error('[Churn] v2 scoring THREW:', err);
    scored = [];
  }

  if (!scored || scored.length === 0) {
    logger.debug('[Churn] v2 empty, trying fallback...');
    try {
      scored = await fetchChurnFallback(gymId, supabase);
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
    const result = await autoDetectReturns(winBackRows, gymId, supabase);
    processedWinBacks = result.attempts;
    autoDetected = result.autoDetected;
  } catch (_) {}

  // Fetch the most recent computed_at timestamp for staleness indicator
  let lastComputedAt = null;
  try {
    const { data: latestScore } = await supabase
      .from('churn_risk_scores')
      .select('computed_at')
      .eq('gym_id', gymId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestScore?.computed_at) lastComputedAt = latestScore.computed_at;
  } catch (_) {}

  // Automated follow-up (drip) config + steps — feeds the FollowUpSettings panel
  // on the Campaigns tab. Tables may be unapplied in some envs → resilient.
  let followupSettings = null;
  let followupSteps = [];
  try {
    const r = await supabase.from('churn_followup_settings').select('*').eq('gym_id', gymId).maybeSingle();
    if (!r.error && r.data) followupSettings = r.data;
  } catch (_) {}
  try {
    const r = await supabase.from('drip_campaign_steps').select('*').eq('gym_id', gymId).order('step_number');
    if (!r.error && r.data) followupSteps = r.data;
  } catch (_) {}

  return {
    members: scored,
    challenges,
    winBackAttempts: processedWinBacks,
    autoDetectedReturns: autoDetected,
    contactLogs: contactLogRows,
    campaigns: campaignRows,
    followupSettings,
    followupSteps,
    lastComputedAt,
  };
}

const CHURN_PAGE_SIZE = 7;
const CHURN_SORT_VALUES = {
  full_name: (m) => (m.full_name || '').toLowerCase(),
  churnScore: (m) => m.churnScore ?? 0,
  daysInactive: (m) => ((m.daysSinceLastCheckIn ?? m.daysSinceLastActivity) ?? 9999),
};

export default function AdminChurn() {
  const { profile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');

  const gymId = profile?.gym_id;
  const adminId = profile?.id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  useEffect(() => { document.title = `${t('admin.churn.title', 'Admin - Churn')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const [tab, setTab] = useState('task-board');
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('needs-action');
  const [tableSort, setTableSort] = useState({ key: null, dir: 'asc' });
  const [churnPage, setChurnPage] = useState(1);
  const [msgModal, setMsgModal] = useState(null);
  const [winBackModal, setWinBackModal] = useState(null);
  const [contactPanel, setContactPanel] = useState(null);
  const [savingOutcome, setSavingOutcome] = useState(null);
  const [winBackPage, setWinBackPage] = useState(1);
  const [deletingAttempt, setDeletingAttempt] = useState(null);
  // Win-back attempts modal: shows the full history for one member.
  const [attemptsModalUserId, setAttemptsModalUserId] = useState(null);

  const handleDeleteAttempt = async (attemptId) => {
    try {
      const { error } = await supabase.from('win_back_attempts').delete().eq('id', attemptId).eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('delete_win_back_attempt', 'win_back_attempt', attemptId);
      await queryClient.invalidateQueries({ queryKey: adminKeys.churn.all(gymId) });
      setDeletingAttempt(null);
      showToast(t('admin.churn.attemptDeleted', 'Attempt deleted'), 'success');
    } catch (err) {
      logger.error('Delete win-back attempt failed', err);
      showToast(err.message || 'Error', 'error');
    }
  };

  const [selectedMember, setSelectedMember] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Lock body scroll while the mobile member-detail sheet is open
  useEffect(() => {
    if (!mobileDetailOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileDetailOpen]);

  // A/B campaign state
  const [createCampaignModal, setCreateCampaignModal] = useState(false);

  // Bulk action state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMsgModal, setBulkMsgModal] = useState(false);
  const [bulkChallengeId, setBulkChallengeId] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const overflowMenuRef = useRef(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: adminKeys.churn.all(gymId),
    queryFn: () => fetchChurnData(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Scores come from the v3 engine: loadGymChurnScores reads the nightly
  // precompute (compute-churn-scores edge fn) or recomputes live (retention.js)
  // via the useQuery above. We intentionally DON'T call the legacy
  // compute_churn_scores SQL RPC anymore — it wrote a v1/v2 model that flagged
  // every never-active member 95 ("never logged a workout"), conflicting with v3.

  // Manual refresh scores
  const [refreshingScores, setRefreshingScores] = useState(false);
  const handleRefreshScores = useCallback(async () => {
    if (!gymId || refreshingScores) return;
    setRefreshingScores(true);
    try {
      // Recompute live via the v3 engine (the nightly edge fn persists the
      // precompute; this button just re-resolves fresh).
      await refetch();
      showToast(t('admin.churn.scoresRefreshed', 'Scores refreshed'), 'success');
    } catch (err) {
      logger.error('Refresh churn scores:', err);
      showToast(err.message || 'Error refreshing scores', 'error');
    } finally {
      setRefreshingScores(false);
    }
  }, [gymId, refreshingScores, refetch, showToast, t]);

  // Staleness indicator
  const lastComputedAt = data?.lastComputedAt;
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const isStale = lastComputedAt ? (Date.now() - new Date(lastComputedAt).getTime()) > TWO_HOURS_MS : false;
  const dateFnsLocaleOpt = i18n.language?.startsWith('es') ? { locale: esLocale } : {};

  // Close overflow menu on click outside
  useEffect(() => {
    if (!overflowMenuOpen) return;
    const handleClickOutside = (e) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) {
        setOverflowMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [overflowMenuOpen]);

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
  const followupSettings = data?.followupSettings || null;
  const followupSteps = data?.followupSteps || [];
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
      const { error } = await supabase.from('winback_campaigns').update({
        is_active: false, ended_at: new Date().toISOString(),
      }).eq('id', campaignId).eq('gym_id', gymId);
      if (error) {
        logger.error('Failed to end campaign', error);
        showToast(t('admin.churn.endCampaignError', { defaultValue: 'Failed to end campaign' }), 'error');
      } else {
        refetch();
      }
    } catch (err) {
      logger.error('Failed to end campaign', err);
      showToast(t('admin.churn.endCampaignError', { defaultValue: 'Failed to end campaign' }), 'error');
    }
  };

  const atRiskMembers = useMemo(() => {
    // Exclude churned (60d+ → "lost" tab) and paused (vacation/hold) from the action queue.
    let list = members.filter(m => m.churnScore >= 30 && m.state !== 'churned' && m.state !== 'paused');
    if (riskFilter === 'needs-action') list = list.filter(m => !contactedIds.has(m.id));
    else if (riskFilter === 'critical') list = list.filter(m => m.churnScore >= 80);
    else if (riskFilter === 'high') list = list.filter(m => m.churnScore >= 55 && m.churnScore < 80);
    else if (riskFilter === 'medium') list = list.filter(m => m.churnScore >= 30 && m.churnScore < 55);
    else if (riskFilter === 'contacted') list = list.filter(m => contactedIds.has(m.id));
    else if (riskFilter === 'returned') {
      const returnedUserIds = new Set(winBackAttempts.filter(a => a.outcome === 'returned').map(a => a.user_id));
      list = list.filter(m => returnedUserIds.has(m.id));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        (m.full_name || '').toLowerCase().includes(q) ||
        (m.username || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [members, riskFilter, search, contactedIds, winBackAttempts]);

  // Controlled sort lifted to the page so sorting spans every page, then we
  // paginate (7/row, no internal scroll). AdminTable renders data as-is when
  // onSortChange is provided.
  const handleTableSort = useCallback((key) => {
    setTableSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }, []);
  const sortedAtRisk = useMemo(() => {
    const fn = tableSort.key ? CHURN_SORT_VALUES[tableSort.key] : null;
    if (!fn) return atRiskMembers;
    return [...atRiskMembers].sort((a, b) => {
      const av = fn(a), bv = fn(b);
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return tableSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [atRiskMembers, tableSort]);
  const churnTotalPages = Math.max(1, Math.ceil(sortedAtRisk.length / CHURN_PAGE_SIZE));
  const churnSafePage = Math.min(churnPage, churnTotalPages);
  const churnPageStart = (churnSafePage - 1) * CHURN_PAGE_SIZE;
  const churnPageItems = sortedAtRisk.slice(churnPageStart, churnPageStart + CHURN_PAGE_SIZE);
  useEffect(() => { setChurnPage(1); }, [riskFilter, search, tab, tableSort]);
  // Reset the win-back list to page 1 when switching tabs (its only "filter").
  useEffect(() => { setWinBackPage(1); }, [tab]);

  // "Churned"/"Lost" = v3 churned state (60d+ dark). Dormant members (30–60d) stay
  // in the actionable at-risk queue per the ghost-threshold refinement.
  const churnedMembers = useMemo(() => (
    members.filter((m) => m.state === 'churned')
  ), [members]);

  const { criticalCount, highRiskCount, medRiskCount } = useMemo(() => {
    let critical = 0, high = 0, med = 0;
    for (const m of members) {
      if (m.state === 'churned' || m.state === 'paused') continue;
      if (m.churnScore >= 80) critical++;
      else if (m.churnScore >= 55) high++;
      else if (m.churnScore >= 30) med++;
    }
    return { criticalCount: critical, highRiskCount: high, medRiskCount: med };
  }, [members]);
  const contactedCount = contactedIds.size;
  const returnedCount = useMemo(() => winBackAttempts.filter(a => a.outcome === 'returned').length, [winBackAttempts]);

  // "Needs Action" = at-risk members who have NOT been contacted
  const needsActionMembers = useMemo(() => {
    return members.filter(m => m.churnScore >= 30 && !contactedIds.has(m.id) && m.state !== 'churned' && m.state !== 'paused');
  }, [members, contactedIds]);

  // "Recently Contacted" = at-risk members who HAVE been contacted
  const recentlyContactedMembers = useMemo(() => {
    return members.filter(m => m.churnScore >= 30 && contactedIds.has(m.id) && m.state !== 'churned' && m.state !== 'paused');
  }, [members, contactedIds]);

  // "Returned" = members with a returned win-back outcome
  const returnedMembers = useMemo(() => {
    const returnedUserIds = new Set(winBackAttempts.filter(a => a.outcome === 'returned').map(a => a.user_id));
    return members.filter(m => returnedUserIds.has(m.id));
  }, [members, winBackAttempts]);

  // Single highest-risk member still needing action — drives the priority banner.
  const topRiskMember = useMemo(() => (
    needsActionMembers.reduce((top, m) => (m.churnScore > (top?.churnScore ?? -1) ? m : top), null)
  ), [needsActionMembers]);

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

  // Pause / resume churn alerts (vacation hold) — prevents the recency-decay
  // false positive for a loyal member who's just traveling.
  const handlePauseToggle = useCallback(async (member) => {
    const pausedByHold = member.churn_pause_until && new Date(member.churn_pause_until) > new Date();
    const until = pausedByHold ? null : new Date(Date.now() + 30 * 86400000).toISOString();
    try {
      const { error } = await supabase.from('profiles').update({ churn_pause_until: until }).eq('id', member.id).eq('gym_id', gymId);
      if (error) throw error;
      showToast(pausedByHold ? t('admin.churn.alertsResumed', 'Alerts resumed') : t('admin.churn.alertsPaused', 'Paused 30 days (vacation)'), 'success');
      refetch();
    } catch {
      showToast(t('admin.churn.pauseFailed', 'Could not update'), 'error');
    }
  }, [gymId, refetch, showToast, t]);

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
  const selectAllVisible = () => {
    setSelectedIds(new Set(atRiskMembers.map(m => m.id)));
  };
  const allVisibleSelected = atRiskMembers.length > 0 && atRiskMembers.every(m => selectedIds.has(m.id));

  const handleBulkAddToChallenge = async (challengeId) => {
    if (!challengeId || selectedMembers.length === 0) return;
    setBulkActionLoading(true);
    try {
      const rows = selectedMembers.map(m => ({ profile_id: m.id, challenge_id: challengeId, gym_id: gymId, score: 0 }));
      const { error } = await supabase.from('challenge_participants').upsert(rows, { onConflict: 'profile_id,challenge_id', ignoreDuplicates: true });
      if (error) {
        logger.error('Bulk add to challenge failed', error);
        showToast(t('admin.churn.bulkChallengeError', { defaultValue: 'Failed to add members to challenge. Please try again.' }), 'error');
      } else {
        showToast(t('admin.churn.bulkChallengeSuccess', { count: selectedMembers.length, defaultValue: '{{count}} members added to challenge' }), 'success');
        clearSelection();
      }
    } catch (err) {
      logger.error('Bulk add to challenge failed', err);
      showToast(t('admin.churn.bulkChallengeError', { defaultValue: 'Failed to add members to challenge. Please try again.' }), 'error');
    }
    finally { setBulkActionLoading(false); setBulkChallengeId(''); }
  };

  const handleBulkMarkContacted = async () => {
    try {
      const entries = selectedMembers.map(m => ({ admin_id: adminId, member_id: m.id, gym_id: gymId, method: 'manual', note: 'Bulk mark contacted' }));
      const { error } = await supabase.from('admin_contact_log').insert(entries);
      if (error) {
        logger.error('Bulk mark contacted failed', error);
        showToast(t('admin.churn.bulkContactError', { defaultValue: 'Failed to mark members as contacted' }), 'error');
      } else {
        showToast(t('admin.churn.bulkContactSuccess', { count: selectedMembers.length, defaultValue: '{{count}} members marked as contacted' }), 'success');
        clearSelection();
        refetch();
      }
    } catch (err) {
      logger.error('Bulk mark contacted failed', err);
      showToast(t('admin.churn.bulkContactError', { defaultValue: 'Failed to mark members as contacted' }), 'error');
    }
  };

  // DB-backed contact logging
  const handleMarkContacted = useCallback(async (memberId, method = 'manual', note = null) => {
    try {
      const { error } = await supabase.from('admin_contact_log').insert({ admin_id: adminId, member_id: memberId, gym_id: gymId, method, note });
      if (error) {
        logger.error('Failed to log contact', error);
        showToast(t('admin.churn.markContactedError', { defaultValue: 'Failed to mark as contacted' }), 'error');
        return;
      }
      refetch();
    } catch (err) {
      logger.error('Failed to log contact', err);
      showToast(t('admin.churn.markContactedError', { defaultValue: 'Failed to mark as contacted' }), 'error');
    }
  }, [adminId, gymId, refetch, showToast, t]);

  const handleUnmarkContacted = useCallback(async (memberId) => {
    try {
      const { error } = await supabase.from('admin_contact_log').delete().eq('member_id', memberId).eq('gym_id', gymId);
      if (error) {
        logger.error('Failed to unmark contact', error);
        showToast(t('admin.churn.unmarkContactedError', { defaultValue: 'Failed to unmark contacted' }), 'error');
        return;
      }
      refetch();
    } catch (err) {
      logger.error('Failed to unmark contact', err);
      showToast(t('admin.churn.unmarkContactedError', { defaultValue: 'Failed to unmark contacted' }), 'error');
    }
  }, [gymId, refetch, showToast, t]);

  const handleAddToChallenge = async (member, challengeId) => {
    if (!challengeId) return;
    try {
      const { error } = await supabase.from('challenge_participants').upsert(
        { profile_id: member.id, challenge_id: challengeId, gym_id: gymId, score: 0 },
        { onConflict: 'profile_id,challenge_id', ignoreDuplicates: true }
      );
      if (error) {
        logger.error('Add to challenge failed', error);
        showToast(t('admin.churn.addChallengeError', { defaultValue: 'Failed to add member to challenge' }), 'error');
      }
    } catch (err) {
      logger.error('Add to challenge failed', err);
      showToast(t('admin.churn.addChallengeError', { defaultValue: 'Failed to add member to challenge' }), 'error');
    }
  };

  const handleMarkOutcome = async (attemptId, outcome) => {
    setSavingOutcome(attemptId);
    try {
      const { error } = await supabase.from('win_back_attempts').update({ outcome }).eq('id', attemptId).eq('gym_id', gymId);
      if (error) {
        logger.error('Mark outcome failed', error);
        showToast(t('admin.churn.outcomeError', { defaultValue: 'Failed to update outcome' }), 'error');
      } else {
        logAdminAction('update_win_back_outcome', 'win_back_attempt', attemptId, { outcome });
        setWinBackAttempts(prev => prev.map(a => a.id === attemptId ? { ...a, outcome } : a));
      }
    } catch (err) {
      logger.error('Mark outcome failed', err);
      showToast(t('admin.churn.outcomeError', { defaultValue: 'Failed to update outcome' }), 'error');
    } finally { setSavingOutcome(null); }
  };

  const handleExport = () => {
    const visibleData = tab === 'task-board' ? atRiskMembers : tab === 'churned' ? churnedMembers : winBackAttempts;
    // Translate signals and velocity labels for the CSV
    const translatedData = visibleData.map(m => ({
      ...m,
      keySignals: Array.isArray(m.keySignals)
        ? m.keySignals.map(s => translateSignal(t, s)).join(', ')
        : m.keySignal ? translateSignal(t, m.keySignal) : '',
      velocityLabel: m.velocityLabel ? translateSignal(t, m.velocityLabel) : '',
    }));
    exportCSV({
      filename: `churn-${tab}`,
      columns: [
        { key: 'full_name', label: t('admin.churn.csvName', 'Name') },
        { key: 'churnScore', label: t('admin.churn.csvScore', 'Score') },
        { key: 'risk_tier', label: t('admin.churn.csvRiskTier', 'Risk Tier') },
        { key: 'keySignals', label: t('admin.churn.csvSignals', 'Key Signals') },
        { key: 'daysSinceLastCheckIn', label: t('admin.churn.csvDaysInactive', 'Days Inactive') },
        { key: 'velocityLabel', label: t('admin.churn.csvVelocity', 'Velocity') },
      ],
      data: translatedData,
    });
  };

  const PRIMARY_TABS = [
    // Shorter inline default — Spanish "Panel de Retención" was wrapping to 3
    // lines in the AdminTabs strip at active state. Kept the same i18n key so
    // ES JSON (owned by the i18n agents) stays in control of the Spanish copy.
    { key: 'task-board', label: t('admin.churn.tabTaskBoard', 'Retention'), count: needsActionMembers.length },
  ];
  const SECONDARY_TABS = [
    { key: 'churned', label: t('admin.churn.tabChurned', 'Churned'), count: churnedMembers.length },
    { key: 'win-back', label: t('admin.churn.tabWinBack', 'Win-Back'), count: winBackAttempts.length },
    { key: 'campaigns', label: t('admin.churn.tabCampaigns', 'Campaigns'), count: campaigns.length },
  ];
  const TABS = [...PRIMARY_TABS, ...SECONDARY_TABS];

  // Filter chips for the Retention tab. `tone` drives the colored pill style
  // (matches the admin-pill--{tone} variants in admin.css). Selected filter
  // gets a ring outline; non-selected stays colored at base intensity so the
  // bar reads as a quick visual breakdown of where members sit.
  const QUEUE_FILTERS = [
    { key: 'needs-action', label: t('admin.churn.filterNeedsAction', 'Needs Action'), count: needsActionMembers.length, tone: 'accent' },
    { key: 'critical',     label: t('admin.churn.filterCritical', 'Critical'),         count: criticalCount,                  tone: 'hot' },
    { key: 'high',         label: t('admin.churn.filterHigh', 'High'),                 count: highRiskCount,                  tone: 'warn' },
    { key: 'contacted',    label: t('admin.churn.filterContacted', 'Recently Contacted'), count: recentlyContactedMembers.length, tone: 'info' },
    { key: 'returned',     label: t('admin.churn.filterReturned', 'Returned'),         count: returnedMembers.length,         tone: 'good' },
  ];

  // Helper: get top N signals for a member as { name, label } pairs
  const getTopSignals = (m, count = 2) => {
    // NB: dormant/churned/insufficient/paused members carry signals = {} (empty
    // but truthy). Guard on length, otherwise we'd take this branch, find nothing,
    // and never fall through to keySignals — rendering "--" for a 95% dormant row.
    if (m.signals && Object.keys(m.signals).length > 0) {
      return Object.entries(m.signals)
        .filter(([, s]) => s.score > 0)
        .sort((a, b) => (b[1].weightedScore ?? b[1].score) - (a[1].weightedScore ?? a[1].score))
        .slice(0, count)
        .map(([key, s]) => ({ name: translateSignalName(t, key), pct: s.maxPts > 0 ? Math.min(100, (s.score / s.maxPts) * 100) : 0 }));
    }
    return (m.keySignals || [m.keySignal]).filter(Boolean).slice(0, count).map(sig => ({ name: translateSignal(t, sig), pct: 50 }));
  };

  // Helper: check if member has returned (check-in or workout after being at-risk)
  const returnedUserIds = useMemo(() => new Set(winBackAttempts.filter(a => a.outcome === 'returned').map(a => a.user_id)), [winBackAttempts]);

  // Helper: contact count per member
  const contactCountMap = useMemo(() => {
    const map = {};
    for (const log of contactLogs) {
      map[log.member_id] = (map[log.member_id] || 0) + 1;
    }
    return map;
  }, [contactLogs]);

  const atRiskTableColumns = [
    {
      key: 'select',
      label: '',
      width: '44px',
      render: (m) => (
        <button onClick={(e) => { e.stopPropagation(); toggleSelected(m.id); }} aria-label={selectedIds.has(m.id) ? t('admin.churn.deselectMember', 'Deselect member') : t('admin.churn.selectMember', 'Select member')} className="text-[var(--color-admin-text-faint)] hover:text-[var(--color-accent)] transition-colors">
          {selectedIds.has(m.id) ? <CheckSquare size={16} className="text-[var(--color-accent)]" /> : <Square size={16} />}
        </button>
      ),
    },
    {
      key: 'full_name',
      label: t('admin.churn.colMember', 'Member'),
      sortable: true,
      sortValue: (m) => m.full_name?.toLowerCase() || '',
      render: (m) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={m.full_name} />
          <span className="text-[13px] font-semibold text-[var(--color-admin-text)] truncate">{m.full_name}</span>
        </div>
      ),
    },
    {
      key: 'churnScore',
      label: t('admin.churn.retentionRisk', 'Retention Risk'),
      sortable: true,
      sortValue: (m) => m.churnScore ?? 0,
      width: '128px',
      render: (m) => {
        const s = Math.round(m.churnScore || 0);
        const color = s >= 80 ? 'var(--color-danger)' : s >= 55 ? 'var(--color-warning)' : 'var(--color-success)';
        const TrendIcon = m.trend === 'declining' ? TrendingUp : m.trend === 'improving' ? TrendingDown : null;
        const trendColor = m.trend === 'declining' ? 'var(--color-danger)' : 'var(--color-success)';
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ width: 46, background: 'var(--color-admin-panel)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, s)}%`, background: color }} />
            </div>
            <span className="admin-mono text-[11px] font-bold flex-shrink-0" style={{ color }}>{s}%</span>
            {TrendIcon && <TrendIcon size={12} style={{ color: trendColor, flexShrink: 0 }} aria-label={m.trend} />}
          </div>
        );
      },
    },
    {
      key: 'signals',
      label: t('admin.churn.colSignals', 'Top Signals'),
      width: '160px',
      render: (m) => {
        const pills = getTopSignals(m, 2);
        return (
          <div className="flex flex-wrap gap-1" style={{ maxWidth: 230 }}>
            {pills.map((p, i) => {
              const toneClass = p.pct >= 70 ? 'admin-pill--hot' : p.pct >= 40 ? 'admin-pill--warn' : 'admin-pill--outline';
              return (
                <span key={i} className={`admin-pill ${toneClass}`} style={{ whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.3, maxWidth: '100%' }}>
                  {p.name}
                </span>
              );
            })}
            {pills.length === 0 && <span className="text-[10px] italic" style={{ color: 'var(--color-admin-text-faint)' }}>--</span>}
          </div>
        );
      },
    },
    {
      key: 'daysInactive',
      label: t('admin.churn.daysInactive', 'Days Inactive'),
      sortable: true,
      align: 'center',
      width: '76px',
      sortValue: (m) => (m.daysSinceLastCheckIn ?? m.daysSinceLastActivity) ?? 9999,
      render: (m) => {
        const rawDays = m.daysSinceLastCheckIn ?? m.daysSinceLastActivity;
        const days = rawDays != null ? Math.round(rawDays) : null;
        const color = days === null ? 'var(--color-admin-text-muted)' : days < 7 ? 'var(--color-success)' : days < 14 ? 'var(--color-warning)' : 'var(--color-danger)';
        return (
          <span className="admin-mono text-[13px] font-bold" style={{ color }}>
            {days != null ? `${days}d` : '--'}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      width: '124px',
      render: (m) => {
        const isContacted = contactedIds.has(m.id);
        const contactCount = contactCountMap[m.id] || 0;
        const hasReturned = returnedUserIds.has(m.id);
        return (
          <div className="flex items-center justify-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
            {hasReturned && (
              <span className="admin-pill admin-pill--good whitespace-nowrap">
                {t('admin.churn.returnedBadge', 'Returned')}
              </span>
            )}
            {isContacted && (
              <span className="admin-pill admin-pill--coach whitespace-nowrap">
                {contactCount > 1 ? t('admin.churn.contactCountBadge', { count: contactCount, defaultValue: '{{count}} contacts' }) : t('admin.churn.contacted', 'Contacted')}
              </span>
            )}
            <button onClick={() => setContactPanel(m)} title={t('admin.churn.contact', 'Contact')}
              aria-label={t('admin.churn.contact', 'Contact')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}>
              <Phone size={13} /> {t('admin.churn.contact', 'Contact')}
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
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger)' }}>{t('admin.churn.accessDenied')}</p>
      </div>
    );
  }

  return (
    <AdminPageShell>
      <div data-admin-tour="churn">
      <PageHeader
        title={t('admin.churn.title', 'Churn Intelligence')}
        subtitle={loading ? t('admin.churn.analyzing', 'Analyzing member activity…') : `${criticalCount} ${t('admin.churn.critical', 'critical')} · ${highRiskCount} ${t('admin.churn.highRisk', 'high risk')} · ${medRiskCount} ${t('admin.churn.mediumRisk', 'medium risk')} · ${churnedMembers.length} ${t('admin.churn.churned', 'churned')}`}
        actions={
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
            <button onClick={handleRefreshScores} disabled={refreshingScores}
              className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap disabled:opacity-50"
              title={t('admin.churn.refreshScores', 'Refresh Scores')}>
              <RefreshCw size={13} className={refreshingScores ? 'animate-spin' : ''} /> {t('admin.churn.refreshScores', 'Refresh Scores')}
            </button>
            {/* Export columns are churn-shaped (score/tier/signals) → only valid
                on the member-list tabs. Win-Back/Campaigns rows would emit blank
                churn columns, so the button is hidden there. */}
            {(tab === 'task-board' || tab === 'churned') && (
              <button onClick={handleExport}
                className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
                <Download size={13} /> {t('admin.churn.export', 'Export')}
              </button>
            )}
          </div>
        }
      />
      </div>

      {/* Scores freshness strip */}
      {!loading && lastComputedAt && (
        <div className="flex items-center gap-2.5 mt-2" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--color-bg-subtle)', border: `1px solid ${isStale ? 'color-mix(in srgb, var(--color-warning) 30%, transparent)' : 'var(--color-admin-border)'}` }}>
          <div className="grid place-items-center flex-shrink-0" style={{ width: 26, height: 26, borderRadius: 8, background: isStale ? 'var(--color-warning-soft)' : 'var(--color-accent-soft)' }}>
            <Clock size={14} style={{ color: isStale ? 'var(--color-warning)' : 'var(--color-accent-dark, var(--color-accent))' }} />
          </div>
          <span className="admin-mono flex-1 text-[11px] md:text-[12.5px]" style={{ color: 'var(--color-admin-text-sub)', fontWeight: 600 }}>
            {t('admin.churn.lastUpdated', 'Scores last updated')}: {formatDistanceToNow(new Date(lastComputedAt), { addSuffix: true, ...dateFnsLocaleOpt })}
          </span>
          {isStale ? (
            <span className="admin-pill admin-pill--warn flex-shrink-0">{t('admin.churn.scoresOutdated', 'Scores may be outdated')}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 flex-shrink-0 text-[11.5px] font-bold" style={{ color: 'var(--color-success)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--color-success)' }} /> {t('admin.churn.live', 'Live')}
            </span>
          )}
        </div>
      )}

      {/* Acción prioritaria de hoy — single most-urgent follow-up */}
      {!loading && topRiskMember && (
        <div className="flex items-center gap-3 md:gap-4 flex-wrap mt-3" style={{ padding: '16px 18px', borderRadius: 16, background: 'linear-gradient(100deg, var(--color-danger-soft), color-mix(in srgb, var(--color-warning-soft) 55%, transparent))', border: '1px solid var(--color-danger-soft)' }}>
          <div className="grid place-items-center flex-shrink-0" style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--color-admin-panel)' }}>
            <Target size={22} style={{ color: 'var(--color-danger)' }} />
          </div>
          <div className="flex-1" style={{ minWidth: 220 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: 'var(--color-danger)', textTransform: 'uppercase', marginBottom: 3 }}>{t('admin.churn.priorityEyebrow', "Today's priority action")}</div>
            <div style={{ fontSize: 14, color: 'var(--color-admin-text)', fontWeight: 600, lineHeight: 1.4 }}>
              {t('admin.churn.priorityBanner', {
                count: needsActionMembers.length,
                name: topRiskMember.full_name,
                score: Math.round(topRiskMember.churnScore),
                days: topRiskMember.daysSinceLastCheckIn != null ? Math.round(topRiskMember.daysSinceLastCheckIn) : 0,
                defaultValue: '{{count}} members need follow-up. Highest risk is {{name}} — score {{score}}, {{days}}d without check-in.',
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setContactPanel(topRiskMember)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px] font-bold transition-opacity hover:opacity-90" style={{ background: 'var(--color-danger)', color: '#fff' }}>
              <Phone size={14} /> {t('admin.churn.callMember', { name: (topRiskMember.full_name || '').split(' ')[0], defaultValue: 'Call {{name}}' })}
            </button>
            <button onClick={() => { const ids = needsActionMembers.map(m => m.id).slice(0, 500).join(','); if (ids) navigate(`/admin/outreach?audience=member&ids=${ids}`); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold transition-colors" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}>
              <Send size={14} /> {t('admin.churn.bulkMessage', 'Batch message')}
            </button>
          </div>
        </div>
      )}

      {/* KPI row */}
      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3 mt-3">
          <StatCard label={t('admin.churn.filterCritical', 'Critical')} value={criticalCount} sub={t('admin.churn.kpiCriticalSub', 'score ≥ 80')} borderColor="var(--color-danger)" icon={AlertTriangle} delay={0} onClick={() => { setTab('task-board'); setRiskFilter('critical'); }} />
          <StatCard label={t('admin.churn.filterHigh', 'High')} value={highRiskCount} sub={t('admin.churn.kpiHighSub', 'score 55–79')} borderColor="var(--color-warning)" icon={Activity} delay={50} onClick={() => { setTab('task-board'); setRiskFilter('high'); }} />
          <StatCard label={t('admin.churn.contacted', 'Contacted')} value={contactedCount} sub={t('admin.churn.kpiContactedSub', 'follow-up done')} borderColor="var(--color-coach)" icon={MessageSquare} delay={100} onClick={() => { setTab('task-board'); setRiskFilter('contacted'); }} />
          <StatCard label={t('admin.churn.filterReturned', 'Returned')} value={returnedCount} sub={t('admin.churn.kpiReturnedSub', 'came back')} borderColor="var(--color-success)" icon={CheckCircle} delay={150} onClick={() => { setTab('task-board'); setRiskFilter('returned'); }} />
        </div>
      )}

      {/* Tab Bar */}
      <AdminTabs tabs={TABS} active={tab} onChange={setTab} className="mb-4" />

      <SwipeableTabContent tabs={TABS} active={tab} onChange={setTab}>
        {(tabKey) => {
          if (tabKey === 'task-board') return (
        <div>
          {/* Queue Filters — single horizontal scrollable row */}
          <div className="flex flex-col gap-3 mb-4">
            {/* px-3/py-1.5 give the active filter's ring (boxShadow below)
                breathing room. No negative margin: pushing past the parent
                gets clipped by AdminPageShell's overflow-x:hidden, which
                covered the left edge of the first pill. Living inside the
                parent's padding box keeps every pill fully visible. */}
            <div className="flex overflow-x-auto scrollbar-hide gap-1.5 px-3 py-1.5">
              {QUEUE_FILTERS.map(f => {
                const active = riskFilter === f.key;
                const dot = { accent: 'var(--color-accent)', hot: 'var(--color-danger)', warn: 'var(--color-warning)', info: 'var(--color-info)', good: 'var(--color-success)' }[f.tone] || 'var(--color-admin-text-faint)';
                const ink = { accent: 'var(--color-accent-dark, var(--color-accent))', hot: 'var(--color-danger)', warn: 'var(--color-warning-ink, var(--color-warning))', info: 'var(--color-info)', good: 'var(--color-success)' }[f.tone] || 'var(--color-admin-text-sub)';
                return (
                  <button
                    key={f.key}
                    onClick={() => setRiskFilter(f.key)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 transition-colors"
                    style={{
                      padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, letterSpacing: -0.1,
                      background: active ? 'var(--color-admin-text)' : 'var(--color-admin-panel)',
                      border: `1px solid ${active ? 'transparent' : 'var(--color-admin-border)'}`,
                      // Active text/dot use the panel color (light in light mode,
                      // dark in dark mode) — the inverse of the --color-admin-text
                      // pill background — so the label stays readable in BOTH themes.
                      // Hardcoded #fff went invisible on the light pill in dark mode.
                      color: active ? 'var(--color-admin-panel)' : ink,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'var(--color-admin-panel)' : dot }} />
                    {f.label}
                    <span className="admin-mono" style={{ fontWeight: 700, color: active ? 'color-mix(in srgb, var(--color-admin-panel) 82%, transparent)' : 'var(--color-admin-text-muted)' }}>{f.count}</span>
                  </button>
                );
              })}
            </div>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-admin-text-faint)]" />
              <input type="text" placeholder={t('admin.churn.searchMembers', 'Search members…')} aria-label={t('admin.churn.searchMembers', 'Search members')} value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder-[var(--color-admin-text-faint)] outline-none focus:border-[var(--color-accent)]" />
            </div>
          </div>

          {/* Bulk action bar — only visible when members are selected */}
          {!loading && atRiskMembers.length > 0 && selectedCount > 0 && (
            <div className="mb-4 px-3 md:px-4 py-3 rounded-xl flex items-center gap-2 md:gap-3 bg-[var(--color-accent-soft)] border border-[var(--color-accent)] overflow-x-auto scrollbar-hide">
              <button onClick={allVisibleSelected ? clearSelection : selectAllVisible}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-admin-text)] transition-colors whitespace-nowrap flex-shrink-0">
                {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                {t('admin.churn.selectAllVisible', 'Select All')}
              </button>
              <div className="h-4 w-px bg-[var(--color-accent-soft)] flex-shrink-0" />
              <span className="text-[12px] font-semibold text-[var(--color-accent)] whitespace-nowrap flex-shrink-0">
                {t('admin.churn.selectedCount', { count: selectedCount, defaultValue: '{{count}} selected' })}
              </span>
              <div className="h-4 w-px bg-[var(--color-accent-soft)] flex-shrink-0" />
              <button onClick={() => {
                  const ids = selectedMembers.map(m => m.id).join(',');
                  navigate(`/admin/outreach?audience=member&ids=${ids}`);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors whitespace-nowrap flex-shrink-0">
                <MessageSquare size={12} /> {t('admin.churn.messageSelected', 'Message Selected')}
              </button>
              <button onClick={() => { if (selectedCount > 0) { setWinBackModal(selectedMembers[0]); } }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors whitespace-nowrap flex-shrink-0">
                <RotateCcw size={12} /> {t('admin.churn.winBackSelected', 'Win-Back Selected')}
              </button>
              {/* Overflow menu for secondary actions */}
              <div className="relative ml-auto flex-shrink-0" ref={overflowMenuRef}>
                <button onClick={() => setOverflowMenuOpen(prev => !prev)}
                  aria-label={t('admin.churn.moreActions', 'More actions')}
                  className="p-1.5 rounded-lg text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors">
                  <MoreHorizontal size={16} />
                </button>
                {overflowMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[var(--color-admin-panel)] border border-[var(--color-admin-border)] rounded-xl shadow-xl overflow-hidden">
                    {challenges.length > 0 && (
                      <div className="border-b border-[var(--color-admin-border)]">
                        <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider">{t('admin.churn.addAllToChallenge', 'Add to Challenge')}</p>
                        {challenges.map(c => (
                          <button key={c.id} onClick={() => { handleBulkAddToChallenge(c.id); setOverflowMenuOpen(false); }}
                            className="w-full text-left px-3 py-2 text-[12px] text-[var(--color-admin-text)] hover:bg-[var(--color-bg-hover)] transition-colors truncate">
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => { handleBulkMarkContacted(); setOverflowMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-[var(--color-success)] hover:bg-[var(--color-bg-hover)] transition-colors">
                      <CheckCircle size={13} /> {t('admin.churn.markAllContacted', 'Mark Contacted')}
                    </button>
                    <button onClick={() => { clearSelection(); setOverflowMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-[var(--color-danger)] hover:bg-[var(--color-bg-hover)] transition-colors">
                      <X size={13} /> {t('admin.churn.clearSelection', 'Clear Selection')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-hidden">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : atRiskMembers.length === 0 ? (
            <div className="admin-card p-12 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: 'var(--color-success-soft)' }}>
                <CheckCircle size={22} style={{ color: 'var(--color-success)' }} />
              </div>
              <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--color-admin-text)' }}>{t('admin.churn.noAtRisk', 'No at-risk members')}</p>
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.churn.retentionHealthy', 'Your member retention is looking healthy right now.')}</p>
            </div>
          ) : (
            <div>
              {/* Desktop table */}
              <div className="hidden md:flex gap-4 items-start">
                <div className="w-full lg:w-[60%] lg:flex-shrink-0">
                  <AdminTable columns={atRiskTableColumns} data={churnPageItems} sort={tableSort} onSortChange={handleTableSort} onRowClick={(m) => setSelectedMember(m)} activeRowId={selectedMember?.id} fixedLayout />
                  <AdminPagination page={churnSafePage} pageSize={CHURN_PAGE_SIZE} total={sortedAtRisk.length} onPageChange={setChurnPage} />
                </div>
                <div className="hidden lg:block flex-1 min-w-0 sticky top-4">
                  <div className="w-full bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-hidden">
                    <MemberDetailPanel
                      member={selectedMember}
                      contactLogs={contactLogs}
                      contactedIds={contactedIds}
                      winBackAttempts={winBackAttempts}
                      onMessage={(m) => setMsgModal(m)}
                      onContact={(m) => setContactPanel(m)}
                      onWinBack={(m) => setWinBackModal(m)}
                      onPause={handlePauseToggle}
                      t={t}
                      dateFnsLocaleOpt={dateFnsLocaleOpt}
                    />
                  </div>
                </div>
              </div>
              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {churnPageItems.map(m => {
                  const isContacted = contactedIds.has(m.id);
                  const mContactCount = contactCountMap[m.id] || 0;
                  const isSelected = selectedIds.has(m.id);
                  const hasReturned = returnedUserIds.has(m.id);
                  const pills = getTopSignals(m, 2);
                  const daysInactive = (m.daysSinceLastCheckIn ?? m.daysSinceLastActivity) != null ? Math.round(m.daysSinceLastCheckIn ?? m.daysSinceLastActivity) : null;
                  const daysColor = daysInactive === null ? 'var(--color-text-muted)' : daysInactive < 7 ? 'var(--color-success, #10B981)' : daysInactive < 14 ? 'var(--color-warning)' : 'var(--color-danger, #EF4444)';
                  return (
                    <div key={m.id} onClick={() => { setSelectedMember(m); setMobileDetailOpen(true); }}
                      role="button" tabIndex={0} aria-label={t('admin.churn.viewMemberDetails', { name: m.full_name, defaultValue: 'View details for {{name}}' })}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMember(m); setMobileDetailOpen(true); } }}
                      className={`admin-card p-3 hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer ${isSelected ? 'bg-[var(--color-accent-soft)]' : ''}`}>
                      <div className="flex items-start gap-3">
                        <button onClick={(e) => { e.stopPropagation(); toggleSelected(m.id); }} aria-label={isSelected ? t('admin.churn.deselectMember', 'Deselect member') : t('admin.churn.selectMember', 'Select member')} className="mt-1 flex-shrink-0 text-[var(--color-admin-text-faint)] hover:text-[var(--color-accent)] transition-colors">
                          {isSelected ? <CheckSquare size={16} className="text-[var(--color-accent)]" /> : <Square size={16} />}
                        </button>
                        <Avatar name={m.full_name} />
                        <div className="flex-1 min-w-0">
                          {/* Row 1: Name + badges */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                            <p className="text-[13px] font-semibold text-[var(--color-admin-text)]">{m.full_name}</p>
                            {m.username && (
                              <span className="text-[11px] text-[var(--color-admin-text-faint)] truncate">@{m.username}</span>
                            )}
                            <RiskBadge tier={m.churnScore >= 80 ? 'critical' : m.churnScore >= 55 ? 'high' : 'medium'} />
                            {hasReturned && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[var(--color-success)]">
                                {t('admin.churn.returnedBadge', 'Returned')}
                              </span>
                            )}
                            {isContacted && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]">
                                {mContactCount > 1 ? t('admin.churn.contactCountBadge', { count: mContactCount, defaultValue: '{{count}} contacts' }) : t('admin.churn.contacted', 'Contacted')}
                              </span>
                            )}
                          </div>
                          {/* Row 2: Score bar */}
                          <div className="mb-1.5"><ScoreBar score={m.churnScore} /></div>
                          {/* Row 3: Top signal pills + days inactive */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            {pills.map((p, i) => {
                              const pillColor = p.pct >= 70 ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[var(--color-danger)]' : p.pct >= 40 ? 'bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning)]' : 'bg-[var(--color-bg-hover)] text-[var(--color-admin-text-muted)] border-[var(--color-admin-border)]';
                              return (
                                <span key={i} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border truncate max-w-[130px] ${pillColor}`}>
                                  {p.name}
                                </span>
                              );
                            })}
                            <span className="text-[11px] font-bold tabular-nums ml-auto" style={{ color: daysColor }}>
                              {daysInactive != null ? t('admin.churn.daysInactiveShort', { days: daysInactive, defaultValue: '{{days}}d inactive' }) : t('admin.churn.neverActive', 'Never active')}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Action row */}
                      <div className="flex items-center gap-2 mt-2.5 pl-[68px] flex-wrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setMsgModal(m)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors">
                          <MessageSquare size={12} /> {t('admin.churn.message', 'Message')}
                        </button>
                        <button onClick={() => setContactPanel(m)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--color-bg-hover)] text-[var(--color-admin-text-muted)] border border-[var(--color-admin-border)] hover:text-[var(--color-admin-text)] transition-colors">
                          <Phone size={12} /> {t('admin.churn.contact', 'Contact')}
                        </button>
                        {m.churnScore >= 60 && (
                          <button onClick={() => setWinBackModal(m)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors">
                            <RotateCcw size={12} /> {t('admin.churn.winBack', 'Win Back')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="md:hidden">
                <AdminPagination page={churnSafePage} pageSize={CHURN_PAGE_SIZE} total={sortedAtRisk.length} onPageChange={setChurnPage} />
              </div>
            </div>
          )}
        </div>
          );
          if (tabKey === 'churned') return (
        <div>
          {loading ? (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-hidden">{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : churnedMembers.length === 0 ? (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-success-soft)] flex items-center justify-center mx-auto mb-4"><Users size={22} className="text-[var(--color-success)]" /></div>
              <p className="text-[15px] font-semibold text-[var(--color-admin-text)] mb-1">{t('admin.churn.noChurned', 'No churned members')}</p>
              <p className="text-[13px] text-[var(--color-admin-text-faint)]">{t('admin.churn.allActive', 'All members have been active in the last 30 days.')}</p>
            </div>
          ) : (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto] items-center gap-3 md:gap-4 px-4 py-2.5 border-b border-[var(--color-admin-border)]">
                <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider">{t('admin.churn.colMember', 'Member')}</p>
                <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider hidden sm:block">{t('admin.churn.colLastSeen', 'Last Seen')}</p>
                <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider hidden sm:block">{t('admin.churn.colTenure', 'Tenure')}</p>
                <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider">{t('admin.churn.colAction', 'Action')}</p>
              </div>
              <div className="divide-y divide-[var(--color-admin-border)]">
                {churnedMembers.map(m => {
                  const lastSeen = m.lastActivityAt
                    ? formatDistanceToNow(new Date(m.lastActivityAt), { addSuffix: true, ...dateFnsLocaleOpt })
                    : t('admin.churn.noRecentActivity', 'No recent activity');
                  const tenureLabel = m.tenureMonths < 1 ? t('admin.churn.lessThanMonth', 'Less than 1 month') : `${Math.round(m.tenureMonths)} ${t('admin.churn.months', 'months')}`;
                  return (
                    <div key={m.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto] items-center gap-3 md:gap-4 px-4 py-3.5 hover:bg-[var(--color-bg-hover)] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={m.full_name} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[var(--color-admin-text)] truncate">{m.full_name}</p>
                          <p className="text-[11px] text-[var(--color-admin-text-faint)] sm:hidden">{lastSeen}</p>
                        </div>
                      </div>
                      <div className="hidden sm:block text-right"><p className="text-[12px] text-[var(--color-admin-text-muted)]">{lastSeen}</p></div>
                      <div className="hidden sm:block text-right"><p className="text-[12px] text-[var(--color-admin-text-muted)]">{tenureLabel}</p></div>
                      <button onClick={() => setWinBackModal(m)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors flex-shrink-0">
                        <RotateCcw size={12} /> {t('admin.churn.winBack', 'Win Back')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
          );
          if (tabKey === 'win-back') return (
        <div>
          {!loading && winBackAttempts.length > 0 && Object.keys(attributionStats).length > 0 && (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] p-4 mb-4">
              <p className="text-[12px] font-semibold text-[var(--color-admin-text)] mb-2">{t('admin.churn.attributionTitle', 'Outreach Attribution')}</p>
              <div className="flex flex-wrap gap-3">
                {Object.entries(attributionStats).map(([method, stats]) => {
                  // Coerce to integers — defends against any malformed stats object
                  // returned by the engine (which would otherwise propagate NaN
                  // into the rendered "NaN%" badge).
                  const sent = Number.isFinite(Number(stats?.sent)) ? Number(stats.sent) : 0;
                  const returned = Number.isFinite(Number(stats?.returned)) ? Number(stats.returned) : 0;
                  const rate = sent > 0 ? Math.round((returned / sent) * 100) : 0;
                  return (
                    <span key={method} className="text-[11px] text-[var(--color-admin-text-muted)]">
                      <span className="font-semibold text-[var(--color-admin-text)]">{METHOD_I18N[method] ? t(METHOD_I18N[method]) : method}:</span>{' '}
                      {t('admin.churn.sentCount', { count: sent, defaultValue: '{{count}} sent' })},{' '}
                      <span className={returned > 0 ? 'text-[var(--color-success)]' : ''}>{t('admin.churn.returnedCount', { count: returned, defaultValue: '{{count}} returned' })}</span>{' '}
                      ({rate}%)
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {loading ? (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-hidden">{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : winBackAttempts.length === 0 ? (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent-soft)] flex items-center justify-center mx-auto mb-4"><RotateCcw size={22} className="text-[var(--color-accent)]" /></div>
              <p className="text-[15px] font-semibold text-[var(--color-admin-text)] mb-1">{t('admin.churn.noWinBacks', 'No win-back attempts yet')}</p>
              <p className="text-[13px] text-[var(--color-admin-text-faint)]">{t('admin.churn.useChurnedTab', 'Use the Churned tab to send win-back messages to inactive members.')}</p>
            </div>
          ) : (() => {
            // Group win-back attempts by member. One row per member, summary stats inline,
            // click row → modal showing all attempts for that member with the per-attempt edit/delete actions.
            const groupedByMember = winBackAttempts.reduce((acc, att) => {
              if (!acc[att.user_id]) acc[att.user_id] = [];
              acc[att.user_id].push(att);
              return acc;
            }, {});
            const groupedRows = Object.entries(groupedByMember)
              .map(([userId, attempts]) => {
                const sorted = [...attempts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                const last = sorted[0];
                const total = sorted.length;
                const counts = sorted.reduce((acc, a) => {
                  const o = a.outcome || 'pending';
                  acc[o] = (acc[o] || 0) + 1;
                  return acc;
                }, {});
                const returned = counts.returned || 0;
                const effectiveness = total > 0 ? Math.round((returned / total) * 100) : 0;
                return { userId, attempts: sorted, last, total, counts, returned, effectiveness };
              })
              .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));

            // Page the grouped win-back rows (replaces the old "show more" reveal).
            const WINBACK_PAGE_SIZE = 10;
            const winBackTotalPages = Math.max(1, Math.ceil(groupedRows.length / WINBACK_PAGE_SIZE));
            const winBackSafePage = Math.min(winBackPage, winBackTotalPages);
            const winBackRows = groupedRows.slice((winBackSafePage - 1) * WINBACK_PAGE_SIZE, (winBackSafePage - 1) * WINBACK_PAGE_SIZE + WINBACK_PAGE_SIZE);

            return (
              <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-hidden">
                <div className="grid grid-cols-[1fr_auto] items-center gap-2 md:gap-4 px-4 py-2.5 border-b border-[var(--color-admin-border)]">
                  <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider">
                    {t('admin.churn.colMember', 'Member')}
                  </p>
                  <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider">
                    {t('admin.churn.colAttempts', 'Attempts')}
                  </p>
                </div>
                <div className="divide-y divide-[var(--color-admin-border)]">
                  {winBackRows.map(row => {
                    const m = members.find(mem => mem.id === row.userId);
                    const memberName = m?.full_name ?? t('admin.churn.unknownMember', 'Unknown Member');
                    const lastOutcome = row.last.outcome || 'pending';
                    const lastOutcomeCfg = outcomeConfig[lastOutcome] ?? outcomeConfig.pending;
                    return (
                      <button
                        key={row.userId}
                        type="button"
                        onClick={() => setAttemptsModalUserId(row.userId)}
                        className="w-full text-left px-4 py-3.5 hover:bg-[var(--color-bg-hover)] transition-colors"
                      >
                        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={memberName} src={m?.avatar_url} />
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-[var(--color-admin-text)] truncate">{memberName}</p>
                              <p className="text-[11px] text-[var(--color-admin-text-faint)] truncate">
                                {t('admin.churn.lastAttempt', 'Last attempt')}: {formatDistanceToNow(new Date(row.last.created_at), { addSuffix: true, ...dateFnsLocaleOpt })}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color: lastOutcomeCfg.color, background: lastOutcomeCfg.bg, borderColor: `${lastOutcomeCfg.color}33` }}>
                                  {t(lastOutcomeCfg.i18nKey)}
                                </span>
                                {row.returned > 0 && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] whitespace-nowrap">
                                    {row.effectiveness}% {t('admin.churn.effective', 'effective')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-[15px] font-bold text-[var(--color-admin-text)] tabular-nums leading-none">{row.total}</p>
                              <p className="text-[10px] text-[var(--color-admin-text-faint)] uppercase tracking-wider mt-0.5">
                                {row.total === 1 ? t('admin.churn.attemptSingular', 'attempt') : t('admin.churn.attemptPlural', 'attempts')}
                              </p>
                            </div>
                            <ChevronDown size={14} className="text-[var(--color-admin-text-faint)] -rotate-90" />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {winBackTotalPages > 1 && (
                  <div className="px-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                    <AdminPagination page={winBackSafePage} pageSize={WINBACK_PAGE_SIZE} total={groupedRows.length} onPageChange={setWinBackPage} />
                  </div>
                )}
                <p className="text-[11px] text-center py-2" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border-subtle)' }}>
                  {groupedRows.length} {t('admin.churn.members', 'members')}
                  {' · '}
                  {winBackAttempts.length} {t('admin.churn.totalAttempts', 'total attempts')}
                </p>
              </div>
            );
          })()}
        </div>
          );
          if (tabKey === 'campaigns') return (
        <div className="space-y-4">
          {/* Automated follow-up (drip) — at-risk members get scheduled nudges.
              Tables/cron already exist; this panel is its control surface. */}
          <FollowUpSettings
            gymId={gymId}
            initialSettings={followupSettings}
            initialSteps={followupSteps}
            atRiskCount={atRiskMembers?.length || 0}
          />
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FlaskConical size={15} className="text-[var(--color-accent)]" />
              <p className="text-[14px] font-semibold text-[var(--color-admin-text)]">{t('admin.churn.ab.title', 'A/B Campaigns')}</p>
            </div>
            <button onClick={() => setCreateCampaignModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-[var(--color-admin-border)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors">
              <Plus size={13} /> {t('admin.churn.ab.newCampaign', 'New Campaign')}
            </button>
          </div>
          {campaigns.length === 0 ? (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent-soft)] flex items-center justify-center mx-auto mb-4"><FlaskConical size={22} className="text-[var(--color-accent)]" /></div>
              <p className="text-[15px] font-semibold text-[var(--color-admin-text)] mb-1">{t('admin.churn.noCampaigns', 'No campaigns yet')}</p>
              <p className="text-[13px] text-[var(--color-admin-text-faint)] mb-4">{t('admin.churn.createCampaignHint', 'Create an A/B campaign to test different win-back strategies.')}</p>
              <button
                onClick={() => setCreateCampaignModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-colors hover:brightness-110"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}
              >
                <Plus size={14} /> {t('admin.churn.createFirstCampaign', 'Create your first campaign')}
              </button>
            </div>
          ) : (
            campaigns.map(campaign => {
              const stats = campaignStats[campaign.id] || { a: { sent: 0, responded: 0, returned: 0, responseRate: 0, returnRate: 0 }, b: { sent: 0, responded: 0, returned: 0, responseRate: 0, returnRate: 0 } };
              const aWins = stats.a.returnRate > stats.b.returnRate;
              const bWins = stats.b.returnRate > stats.a.returnRate;
              const tied = stats.a.returnRate === stats.b.returnRate;
              const totalSent = stats.a.sent + stats.b.sent;

              return (
                <div key={campaign.id} className="bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-admin-border)]">
                    <div className="flex items-center gap-2.5">
                      <FlaskConical size={14} className="text-[var(--color-accent)]" />
                      <div>
                        <p className="text-[13px] font-semibold text-[var(--color-admin-text)]">{campaign.name}</p>
                        <p className="text-[10px] text-[var(--color-admin-text-faint)]">
                          {t(`admin.churn.campaign.tier.${campaign.target_tier}`, campaign.target_tier)} {t('admin.churn.ab.tier', 'tier')}
                          {' · '}{totalSent} {t('admin.churn.ab.sent', 'sent')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${campaign.is_active ? 'bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[var(--color-success)]' : 'bg-[var(--color-bg-hover)] text-[var(--color-admin-text-faint)] border border-[var(--color-admin-border)]'}`}>
                        {campaign.is_active ? t('admin.churn.ab.active', 'Active') : t('admin.churn.ab.ended', 'Ended')}
                      </span>
                      {campaign.is_active && totalSent >= 2 && (
                        <button onClick={() => handleEndCampaign(campaign.id, aWins ? 'A' : 'B')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors">
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
                      <div key={v.key} className={`rounded-xl p-3.5 border transition-colors ${v.isWinner ? 'bg-[var(--color-success-soft)] border-[var(--color-success)]' : 'bg-[var(--color-admin-panel)] border-[var(--color-admin-border)]'}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <p className="text-[12px] font-semibold text-[var(--color-admin-text)]">{v.label}</p>
                          {v.isWinner && (
                            <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)]">
                              <Trophy size={10} /> {t('admin.churn.ab.winner', 'Winner')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--color-admin-text-muted)] mb-0.5 truncate">
                          {v.data.offer_type || t('admin.churn.ab.noOffer', 'No offer')}
                          {v.data.discount_pct ? ` (${v.data.discount_pct}%)` : ''}
                          {v.data.free_days ? ` · ${v.data.free_days}d ${t('admin.churn.ab.free', 'free')}` : ''}
                        </p>
                        {v.data.message && (
                          <p className="text-[10px] text-[var(--color-admin-text-faint)] line-clamp-2 mb-3">{v.data.message}</p>
                        )}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[var(--color-admin-text-faint)]">{t('admin.churn.ab.numSent', 'Sent')}</span>
                            <span className="text-[12px] font-semibold text-[var(--color-admin-text)]">{v.stat.sent}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[var(--color-admin-text-faint)]">{t('admin.churn.ab.responseRate', 'Response Rate')}</span>
                            <span className={`text-[12px] font-semibold ${v.stat.responseRate > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-admin-text-faint)]'}`}>{v.stat.responseRate}%</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[var(--color-admin-text-faint)]">{t('admin.churn.ab.returnRate', 'Return Rate')}</span>
                            <span className={`text-[12px] font-bold ${v.stat.returnRate > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-admin-text-faint)]'}`}>{v.stat.returnRate}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
          );
          return null;
        }}
      </SwipeableTabContent>

      {/* Mobile detail sheet */}
      {mobileDetailOpen && selectedMember && createPortal(
        <div className="lg:hidden fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setMobileDetailOpen(false)}>
          <div className="w-full max-w-md max-h-[85vh] bg-[var(--color-bg-card)] border border-[var(--color-admin-border)] rounded-[14px] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <MemberDetailPanel
              member={selectedMember}
              contactLogs={contactLogs}
              contactedIds={contactedIds}
              winBackAttempts={winBackAttempts}
              onMessage={(m) => { setMobileDetailOpen(false); setMsgModal(m); }}
              onContact={(m) => { setMobileDetailOpen(false); setContactPanel(m); }}
              onWinBack={(m) => { setMobileDetailOpen(false); setWinBackModal(m); }}
              onPause={(m) => { setMobileDetailOpen(false); handlePauseToggle(m); }}
              t={t}
              dateFnsLocaleOpt={dateFnsLocaleOpt}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* Modals */}
      {msgModal && <ContactPanel member={msgModal} gymId={gymId} adminId={adminId}
        isContacted={contactedIds.has(msgModal.id)}
        contactedAt={contactedMap[msgModal.id]?.created_at}
        onMarkContacted={handleMarkContacted}
        onUnmarkContacted={handleUnmarkContacted}
        defaultChannel="message"
        onClose={() => setMsgModal(null)} />}
      {winBackModal && <WinBackModal member={winBackModal} gymId={gymId} adminId={adminId} activeCampaign={activeCampaign} onClose={() => setWinBackModal(null)}
        onSent={() => { setWinBackModal(null); handleMarkContacted(winBackModal.id, 'win_back'); refetch(); }} />}
      {contactPanel && <ContactPanel member={contactPanel} gymId={gymId} adminId={adminId}
        isContacted={contactedIds.has(contactPanel.id)}
        contactedAt={contactedMap[contactPanel.id]?.created_at}
        onMarkContacted={handleMarkContacted}
        onUnmarkContacted={handleUnmarkContacted}
        onClose={() => setContactPanel(null)} />}
      {bulkMsgModal && <BulkMessageModal members={selectedMembers} gymId={gymId} adminId={adminId}
        onClose={() => setBulkMsgModal(false)} onSent={() => { clearSelection(); refetch(); }} />}
      {createCampaignModal && <CreateCampaignModal gymId={gymId}
        onClose={() => setCreateCampaignModal(false)} onCreated={() => { setCreateCampaignModal(false); refetch(); }} />}

      {/* Per-member win-back attempts history modal */}
      {attemptsModalUserId && (() => {
        const targetMember = members.find(m => m.id === attemptsModalUserId);
        const memberName = targetMember?.full_name ?? t('admin.churn.unknownMember', 'Unknown Member');
        const memberAttempts = winBackAttempts
          .filter(a => a.user_id === attemptsModalUserId)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const total = memberAttempts.length;
        const counts = memberAttempts.reduce((acc, a) => {
          const o = a.outcome || 'pending';
          acc[o] = (acc[o] || 0) + 1;
          return acc;
        }, {});
        const returned = counts.returned || 0;
        const effectiveness = total > 0 ? Math.round((returned / total) * 100) : 0;

        return (
          <AdminModal
            isOpen
            onClose={() => setAttemptsModalUserId(null)}
            title={memberName}
            subtitle={t('admin.churn.attemptsHistorySubtitle', { count: total, defaultValue: '{{count}} win-back attempts' })}
            titleIcon={RotateCcw}
            size="md"
          >
            {/* Effectiveness summary */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-xl p-3 text-center" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
                <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{total}</p>
                <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('admin.churn.attemptsLabel', 'Attempts')}</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'color-mix(in srgb, var(--color-success) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-success) 18%, transparent)' }}>
                <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--color-success)' }}>{returned}</p>
                <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'color-mix(in srgb, var(--color-success) 80%, var(--color-text-primary))' }}>{t('admin.churn.outcomeReturned', 'Returned')}</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
                <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--color-accent)' }}>{effectiveness}%</p>
                <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'color-mix(in srgb, var(--color-accent) 80%, var(--color-text-primary))' }}>{t('admin.churn.effective', 'Effective')}</p>
              </div>
            </div>

            {/* Attempts list — same edit/delete actions as the old per-row UI */}
            <div className="space-y-3">
              {memberAttempts.map(attempt => {
                const outcome = attempt.outcome ?? 'pending';
                const outcomeCfg = outcomeConfig[outcome] ?? outcomeConfig.pending;
                const isSaving = savingOutcome === attempt.id;
                const relatedLog = contactLogs.find(l => l.member_id === attempt.user_id && Math.abs(new Date(l.created_at) - new Date(attempt.created_at)) < 3600000);
                const contactMethod = relatedLog?.method;
                return (
                  <div key={attempt.id} className="rounded-xl p-3" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                            {format(new Date(attempt.created_at), 'PPp', dateFnsLocaleOpt)}
                          </p>
                          {contactMethod && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-admin-text-muted)]">
                              {METHOD_I18N[contactMethod] ? t(METHOD_I18N[contactMethod]) : contactMethod}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] mt-1 break-words" style={{ color: 'var(--color-text-secondary)' }}>{attempt.message}</p>
                        {attempt.offer && <p className="text-[11px] mt-1" style={{ color: 'var(--color-accent)' }}>{t('admin.churn.offer', 'Offer')}: {attempt.offer}</p>}
                        {attempt._autoDetected && attempt._returnedAt && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Sparkles size={11} className="text-[var(--color-success)]" />
                            <span className="text-[10px] font-semibold text-[var(--color-success)]">
                              {t('admin.churn.autoDetected', { date: format(new Date(attempt._returnedAt), 'MMM d, yyyy', dateFnsLocaleOpt), defaultValue: 'Auto-detected: Member returned on {{date}}' })}
                            </span>
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full border whitespace-nowrap flex-shrink-0" style={{ color: outcomeCfg.color, background: outcomeCfg.bg, borderColor: `${outcomeCfg.color}33` }}>
                        {t(outcomeCfg.i18nKey)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {outcome !== 'returned' && (
                        <>
                          <button onClick={() => handleMarkOutcome(attempt.id, 'returned')} disabled={isSaving}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[var(--color-success)] hover:bg-[var(--color-success-soft)] transition-colors disabled:opacity-40">
                            <CheckCircle size={11} /> {t('admin.churn.markReturned', 'Mark Returned')}
                          </button>
                          {outcome !== 'no_response' && (
                            <button onClick={() => handleMarkOutcome(attempt.id, 'no_response')} disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--color-bg-hover)] text-[var(--color-admin-text-muted)] border border-[var(--color-admin-border)] hover:text-[var(--color-admin-text)] transition-colors disabled:opacity-40">
                              {t('admin.churn.noResponse', 'No Response')}
                            </button>
                          )}
                          {outcome !== 'still_inactive' && (
                            <button onClick={() => handleMarkOutcome(attempt.id, 'still_inactive')} disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[var(--color-warning)] hover:bg-[var(--color-warning-soft)] transition-colors disabled:opacity-40">
                              {t('admin.churn.stillInactive', 'Still Inactive')}
                            </button>
                          )}
                        </>
                      )}
                      {deletingAttempt === attempt.id ? (
                        <div className="flex gap-1.5 ml-auto">
                          <button onClick={() => handleDeleteAttempt(attempt.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors">
                            <Trash2 size={11} /> {t('admin.churn.confirmDelete', 'Confirm?')}
                          </button>
                          <button onClick={() => setDeletingAttempt(null)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[var(--color-admin-text-muted)] border border-[var(--color-admin-border)] hover:text-[var(--color-admin-text)] transition-colors">
                            {t('admin.churn.bulkCancel')}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setDeletingAttempt(attempt.id)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors ml-auto">
                          <Trash2 size={11} /> {t('admin.churn.deleteAttempt', 'Delete')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </AdminModal>
        );
      })()}
    </AdminPageShell>
  );
}
