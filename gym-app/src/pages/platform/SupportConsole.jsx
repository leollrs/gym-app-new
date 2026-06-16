import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { useTranslation } from 'react-i18next';
import { logAdminAction } from '../../lib/adminAudit';
import { saveBlob } from '../../lib/saveBlob';
import {
  Search, ExternalLink, Shield, UserCog, X,
  Building2, RefreshCw, KeyRound, UserX, Plus,
  Clock, AlertTriangle, ChevronRight, Copy, Check, Download, Trash2, ArrowRightLeft,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import FadeIn from '../../components/platform/FadeIn';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import UserAvatar from '../../components/UserAvatar';

// ── Badges ───────────────────────────────────────────────────
const roleBadge = {
  super_admin: 'bg-[#D4AF37]/15 text-[#D4AF37]',
  admin:       'bg-indigo-500/15 text-indigo-400',
  trainer:     'bg-purple-500/15 text-purple-400',
  member:      'bg-white/5 text-[#9CA3AF]',
};

const statusBadge = {
  active:      'bg-emerald-500/15 text-emerald-400',
  frozen:      'bg-amber-500/15 text-amber-400',
  deactivated: 'bg-orange-500/15 text-orange-400',
  cancelled:   'bg-red-500/15 text-red-400',
  banned:      'bg-red-500/15 text-red-400',
};

function Badge({ label, variant }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${variant}`}>
      {label}
    </span>
  );
}

function Spinner() {
  return <PlatformSpinner />;
}

function relativeDate(dateStr, t, dateFnsLocale) {
  if (!dateStr) return t('platform.support.never', 'Never');
  try { return formatDistanceToNow(new Date(dateStr), { addSuffix: true, ...(dateFnsLocale || {}) }); } catch { return t('platform.support.unknown', 'Unknown'); }
}

function formatDate(dateStr, dateFnsLocale) {
  if (!dateStr) return '—';
  try { return format(new Date(dateStr), 'MMM d, yyyy', dateFnsLocale || {}); } catch { return '—'; }
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const churnTierColor = (tier) => {
  if (!tier) return 'text-[#6B7280]';
  switch (tier.toLowerCase()) {
    case 'high': return 'text-red-400';
    case 'medium': return 'text-amber-400';
    case 'low': return 'text-emerald-400';
    default: return 'text-[#9CA3AF]';
  }
};

// ── Main component ───────────────────────────────────────────
export default function SupportConsole() {
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const navigate = useNavigate();
  const inputRef = useRef(null);

  useEffect(() => {
    document.title = `${t('platform.support.title', 'Support')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);

  // Grouped results
  const [members, setMembers] = useState([]);
  const [gymResults, setGymResults] = useState([]);
  const [invites, setInvites] = useState([]);

  // Detail pane
  const [selectedMember, setSelectedMember] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Recent lookups (session-only)
  const [recentLookups, setRecentLookups] = useState([]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setMembers([]);
      setGymResults([]);
      setInvites([]);
      setHasSearched(false);
      setSearchError(false);
      return;
    }
    const timeout = setTimeout(() => { performSearch(query.trim()); }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  // Pre-0543 the email RPC / member_invites super_admin arm don't exist yet —
  // treat "missing DB object" as feature-unavailable, not a search failure.
  const isMissingDbObject = (e) => e && (
    e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === '42703'
    || /does not exist|could not find/i.test(e.message || '')
  );

  const performSearch = async (term) => {
    setSearching(true);
    setHasSearched(true);
    const safeTerm = term.replace(/[%_\\,()."']/g, '');
    const pattern = `%${safeTerm}%`;
    const looksLikeEmail = term.includes('@');

    const profileSelect = 'id, gym_id, full_name, username, role, created_at, last_active_at, membership_status, is_onboarded, avatar_url, avatar_type, avatar_value, gyms(id, name, slug)';

    const [membersRes, gymsRes, gymInvitesRes, memberInvitesRes, emailRes] = await Promise.all([
      supabase
        .from('profiles')
        .select(profileSelect)
        .or(`full_name.ilike.${pattern},username.ilike.${pattern}`)
        .limit(30)
        .order('full_name', { ascending: true }),
      supabase
        .from('gyms')
        .select('id, name, slug, is_active, owner_user_id, created_at')
        .or(`name.ilike.${pattern},slug.ilike.${pattern}`)
        .limit(10)
        .order('name', { ascending: true }),
      supabase
        .from('gym_invites')
        .select('id, token, invite_code, gym_id, role, used_at, expires_at, created_at, gyms(id, name)')
        .or(`token.ilike.${pattern},invite_code.ilike.${pattern}`)
        .limit(10),
      // Admins hand out member_invites.invite_code — search that system too.
      supabase
        .from('member_invites')
        .select('id, invite_code, gym_id, status, member_name, claimed_at, expires_at, created_at, gyms(id, name)')
        .ilike('invite_code', pattern)
        .limit(10),
      // Email lookup (profiles has no email column — auth.users does).
      looksLikeEmail
        ? supabase.rpc('admin_lookup_by_email', { p_email: term })
        : Promise.resolve({ data: null, error: null }),
    ]);

    // Honest failure: a query error is NOT "no results".
    const hardErrors = [membersRes.error, gymsRes.error, gymInvitesRes.error]
      .concat([memberInvitesRes.error, emailRes.error].filter(e => e && !isMissingDbObject(e)))
      .filter(Boolean);
    if (hardErrors.length > 0) console.error('[SupportConsole] search failed:', hardErrors[0]);
    let failed = hardErrors.length > 0;

    // Merge email matches into the member results (hydrated to full profile
    // rows so the detail pane works identically for both paths).
    let memberRows = membersRes.data || [];
    const emailMatches = emailRes.data || [];
    const missingIds = emailMatches.map(r => r.profile_id).filter(id => id && !memberRows.some(m => m.id === id));
    if (missingIds.length > 0) {
      const { data: hydrated, error: hydrateError } = await supabase
        .from('profiles')
        .select(profileSelect)
        .in('id', missingIds);
      if (hydrateError) {
        console.error('[SupportConsole] email hydrate failed:', hydrateError);
        failed = true;
      } else if (hydrated?.length) {
        memberRows = [...memberRows, ...hydrated];
      }
    }

    // Normalize both invite systems into one list.
    const now = new Date();
    const normalizedInvites = [
      ...(gymInvitesRes.data || []).map(inv => ({
        id: `gym_${inv.id}`,
        code: inv.invite_code || inv.token,
        gymName: inv.gyms?.name,
        detail: inv.role,
        isUsed: !!inv.used_at,
        isExpired: !inv.used_at && inv.expires_at && new Date(inv.expires_at) < now,
      })),
      ...(memberInvitesRes.data || []).map(inv => ({
        id: `member_${inv.id}`,
        code: inv.invite_code,
        gymName: inv.gyms?.name,
        detail: inv.member_name || 'member',
        isUsed: inv.status === 'claimed',
        isExpired: inv.status === 'expired' || inv.status === 'revoked'
          || (inv.status === 'pending' && inv.expires_at && new Date(inv.expires_at) < now),
      })),
    ];

    setSearchError(failed);
    setMembers(memberRows);
    setGymResults(gymsRes.data || []);
    setInvites(normalizedInvites);
    setSearching(false);
  };

  const openMemberDetail = async (member) => {
    setSelectedMember(member);
    setDetailLoading(true);

    setRecentLookups(prev => {
      const filtered = prev.filter(r => r.id !== member.id);
      return [{ id: member.id, name: member.full_name, gym: member.gyms?.name, role: member.role }, ...filtered].slice(0, 8);
    });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [sessionsRes, recentSessionsRes, checkInsRes, streakRes, churnRes] = await Promise.all([
      supabase
        .from('workout_sessions')
        .select('id, started_at, duration_seconds, total_volume_lbs, status')
        .eq('profile_id', member.id)
        .eq('status', 'completed'),
      supabase
        .from('workout_sessions')
        .select('id, started_at, duration_seconds, total_volume_lbs')
        .eq('profile_id', member.id)
        .eq('status', 'completed')
        .gte('started_at', thirtyDaysAgo)
        .order('started_at', { ascending: false })
        .limit(5),
      supabase
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', member.id)
        .gte('checked_in_at', thirtyDaysAgo),
      // Streak: cross-gym visibility relies on 0541's streak_cache
      // super_admin SELECT arm (pre-apply this reads 0 for other gyms).
      supabase
        .from('streak_cache')
        .select('current_streak_days')
        .eq('profile_id', member.id)
        .maybeSingle(),
      supabase
        .from('churn_risk_scores')
        .select('score, risk_tier, computed_at')
        .eq('profile_id', member.id)
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const detailError = [sessionsRes, recentSessionsRes, checkInsRes, streakRes, churnRes]
      .some(r => r.error);
    if (detailError) {
      console.error('[SupportConsole] detail fetch failed:',
        [sessionsRes, recentSessionsRes, checkInsRes, streakRes, churnRes].find(r => r.error)?.error);
    }

    const allSessions = sessionsRes.data || [];
    const totalVolume = allSessions.reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
    const sessionsLast30 = recentSessionsRes.data || [];

    setDetailData({
      totalSessions: allSessions.length,
      sessionsLast30d: sessionsLast30.length,
      totalVolume,
      recentSessions: sessionsLast30,
      checkIns30d: checkInsRes.count || 0,
      currentStreak: streakRes.data?.current_streak_days || 0,
      churnScore: churnRes.data?.score ?? null,
      churnTier: churnRes.data?.risk_tier || null,
      hadError: detailError,
    });
    setDetailLoading(false);
  };

  // ── Modal state ────────────────────────────────────────────
  const [roleModal, setRoleModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [resetModal, setResetModal] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [modalSaving, setModalSaving] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [copied, setCopied] = useState(false);

  // ── Move member to another gym (atomic via admin_move_member_to_gym) ──────
  const [moveModal, setMoveModal] = useState(false);
  const [moveGymQuery, setMoveGymQuery] = useState('');
  const [moveGymResults, setMoveGymResults] = useState([]);
  const [moveGymSearching, setMoveGymSearching] = useState(false);
  const [moveTarget, setMoveTarget] = useState(null); // chosen target gym
  const [moving, setMoving] = useState(false);

  const openMoveModal = () => {
    setMoveGymQuery('');
    setMoveGymResults([]);
    setMoveTarget(null);
    setMoveModal(true);
  };

  // Debounced target-gym search (excludes the member's current gym).
  useEffect(() => {
    if (!moveModal) return;
    const term = moveGymQuery.trim();
    if (term.length < 2) { setMoveGymResults([]); setMoveGymSearching(false); return; }
    setMoveGymSearching(true);
    const safe = term.replace(/[%_\\,()."']/g, '');
    const pattern = `%${safe}%`;
    const timeout = setTimeout(async () => {
      const { data, error } = await supabase
        .from('gyms')
        .select('id, name, slug, is_active')
        .or(`name.ilike.${pattern},slug.ilike.${pattern}`)
        .order('name', { ascending: true })
        .limit(8);
      if (error) { setMoveGymResults([]); setMoveGymSearching(false); return; }
      setMoveGymResults((data || []).filter(g => g.id !== selectedMember?.gym_id));
      setMoveGymSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [moveGymQuery, moveModal, selectedMember?.gym_id]);

  const handleMoveMember = async () => {
    if (!selectedMember || !moveTarget) return;
    if (selectedMember.role === 'super_admin') {
      showToast(t('platform.support.protectedAccount', 'Protected account — super admin role and status can only be changed in the database'), 'error');
      return;
    }
    setMoving(true);
    const { data, error } = await supabase.rpc('admin_move_member_to_gym', {
      p_user_id: selectedMember.id,
      p_target_gym_id: moveTarget.id,
    });
    setMoving(false);
    if (error) { showToast(error.message, 'error'); return; }
    logAdminAction('move_member', 'member', selectedMember.id, { from_gym: selectedMember.gym_id, to_gym: moveTarget.id, gym_name: moveTarget.name }, moveTarget.id);
    // Reflect the move locally: gym pointer + embedded gym summary.
    const movedGym = { id: moveTarget.id, name: moveTarget.name, slug: moveTarget.slug };
    setSelectedMember(prev => prev ? { ...prev, gym_id: moveTarget.id, gyms: movedGym } : prev);
    setMembers(prev => prev.map(m => m.id === selectedMember.id ? { ...m, gym_id: moveTarget.id, gyms: movedGym } : m));
    const restamped = data?.rows_restamped ?? 0;
    const cleared = data?.rows_cleared ?? 0;
    showToast(t('platform.support.moveDone', { gym: moveTarget.name, restamped, cleared, defaultValue: 'Moved to {{gym}} — {{restamped}} records transferred, {{cleared}} old-gym links reset' }), 'success');
    setMoveModal(false);
  };

  const openRoleModal = () => { setNewRole(selectedMember?.role || 'member'); setRoleModal(true); };
  const openStatusModal = () => { setNewStatus(selectedMember?.membership_status || 'active'); setStatusReason(''); setStatusModal(true); };

  const handleChangeRole = async () => {
    if (!selectedMember || newRole === selectedMember.role) return;
    // A8: never demote FROM super_admin either — the omnibox can surface the
    // founder's own row, and flipping it locks them out of /platform with no
    // break-glass. (The buttons are disabled too; this is belt-and-suspenders.)
    if (selectedMember.role === 'super_admin') {
      showToast(t('platform.support.protectedAccount', 'Protected account — super admin role and status can only be changed in the database'), 'error');
      setRoleModal(false);
      return;
    }
    // Block super_admin escalation from support console
    if (newRole === 'super_admin') {
      showToast(t('platform.support.superAdminBlocked', 'Super admin can only be assigned via database'), 'error');
      setRoleModal(false);
      return;
    }
    setModalSaving(true);
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', selectedMember.id);
    setModalSaving(false);
    if (error) {
      showToast(error.message, 'error');
    } else {
      logAdminAction('change_role', 'member', selectedMember.id, { from: selectedMember.role, to: newRole }, selectedMember.gym_id);
      showToast(t('platform.support.roleChanged', 'Role changed successfully'), 'success');
      setSelectedMember({ ...selectedMember, role: newRole });
      setMembers(prev => prev.map(m => m.id === selectedMember.id ? { ...m, role: newRole } : m));
    }
    setRoleModal(false);
  };

  const handleChangeStatus = async () => {
    if (!selectedMember || newStatus === selectedMember.membership_status) return;
    // A8: membership_status gates app access — same lockout vector as role.
    if (selectedMember.role === 'super_admin') {
      showToast(t('platform.support.protectedAccount', 'Protected account — super admin role and status can only be changed in the database'), 'error');
      setStatusModal(false);
      return;
    }
    setModalSaving(true);
    const updatePayload = { membership_status: newStatus };
    if (newStatus === 'active') {
      // Back to active: the old freeze/cancel reason no longer applies — clear
      // it instead of letting stale reasons accumulate on the profile.
      updatePayload.membership_status_reason = null;
    } else if (statusReason.trim()) {
      updatePayload.membership_status_reason = statusReason.trim();
    }
    const { error } = await supabase.from('profiles').update(updatePayload).eq('id', selectedMember.id);
    setModalSaving(false);
    if (error) {
      showToast(error.message, 'error');
    } else {
      logAdminAction('change_status', 'member', selectedMember.id, { from: selectedMember.membership_status, to: newStatus }, selectedMember.gym_id);
      showToast(t('platform.support.statusChanged', 'Status changed successfully'), 'success');
      setSelectedMember({ ...selectedMember, membership_status: newStatus });
      setMembers(prev => prev.map(m => m.id === selectedMember.id ? { ...m, membership_status: newStatus } : m));
    }
    setStatusModal(false);
  };

  const handleResetPassword = async () => {
    if (!selectedMember) return;
    setResetCode('');
    setCopied(false);
    setResetModal(true);
    setModalSaving(true);
    const { data, error } = await supabase.rpc('admin_generate_password_reset', { p_profile_id: selectedMember.id });
    setModalSaving(false);
    if (error) {
      setResetModal(false);
      showToast(error.message, 'error');
    } else {
      setResetCode(data || 'No code returned');
      logAdminAction('reset_password', 'member', selectedMember.id, {}, selectedMember.gym_id);
    }
  };

  const copyResetCode = async () => {
    try {
      await navigator.clipboard.writeText(resetCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // ── Invite codes (replaces the dead "Resend Invite" — there is no
  //    admin-invite-member edge fn and no invite_token_regenerated_at
  //    column; codes are the real currency here) ────────────────────
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteFetchError, setInviteFetchError] = useState(false);
  const [memberInviteRows, setMemberInviteRows] = useState([]);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState('');

  const openInviteModal = async () => {
    if (!selectedMember) return;
    setInviteModal(true);
    setInviteFetchError(false);
    setCopiedCode('');
    setInviteLoading(true);

    const safeName = (selectedMember.full_name || '').replace(/[%_\\,()."']/g, '').trim();
    const namePattern = safeName ? `%${safeName}%` : null;
    const canMatchPending = !!(selectedMember.gym_id && namePattern);

    // Codes tied to this member: the one they claimed, plus any unclaimed
    // codes created under their name in their gym.
    const [claimedGymRes, claimedMemberRes, pendingGymRes, pendingMemberRes] = await Promise.all([
      supabase
        .from('gym_invites')
        .select('id, token, invite_code, used_at, expires_at, created_at')
        .eq('used_by', selectedMember.id)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('member_invites')
        .select('id, invite_code, status, claimed_at, expires_at, created_at')
        .eq('claimed_by', selectedMember.id)
        .order('created_at', { ascending: false })
        .limit(5),
      canMatchPending
        ? supabase
            .from('gym_invites')
            .select('id, token, invite_code, used_at, expires_at, created_at')
            .eq('gym_id', selectedMember.gym_id)
            .is('used_at', null)
            .ilike('member_name', namePattern)
            .order('created_at', { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null }),
      canMatchPending
        ? supabase
            .from('member_invites')
            .select('id, invite_code, status, claimed_at, expires_at, created_at')
            .eq('gym_id', selectedMember.gym_id)
            .eq('status', 'pending')
            .ilike('member_name', namePattern)
            .order('created_at', { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const hardErrors = [claimedGymRes.error, claimedMemberRes.error, pendingGymRes.error, pendingMemberRes.error]
      .filter(e => e && !isMissingDbObject(e));
    if (hardErrors.length > 0) {
      console.error('[SupportConsole] invite lookup failed:', hardErrors[0]);
      setInviteFetchError(true);
    }

    const now = new Date();
    const rows = [];
    (pendingGymRes.data || []).forEach(r => rows.push({
      id: `pg_${r.id}`,
      code: r.invite_code || r.token,
      status: (r.expires_at && new Date(r.expires_at) < now) ? 'expired' : 'pending',
      createdAt: r.created_at,
    }));
    (pendingMemberRes.data || []).forEach(r => rows.push({
      id: `pm_${r.id}`,
      code: r.invite_code,
      status: (r.expires_at && new Date(r.expires_at) < now) ? 'expired' : 'pending',
      createdAt: r.created_at,
    }));
    (claimedGymRes.data || []).forEach(r => rows.push({
      id: `cg_${r.id}`,
      code: r.invite_code || r.token,
      status: 'claimed',
      createdAt: r.created_at,
    }));
    (claimedMemberRes.data || []).forEach(r => rows.push({
      id: `cm_${r.id}`,
      code: r.invite_code,
      status: r.status === 'claimed' ? 'claimed' : (r.status || 'claimed'),
      createdAt: r.created_at,
    }));

    // De-dup by code (the same code can surface from both lookups)
    const seen = new Set();
    setMemberInviteRows(rows.filter(r => {
      if (!r.code || seen.has(r.code)) return false;
      seen.add(r.code);
      return true;
    }));
    setInviteLoading(false);
  };

  // Single-member data export (DSAR) — super_admin reads the member's own
  // gym-scoped rows and downloads them as JSON.
  const handleExportMember = async () => {
    if (!selectedMember) return;
    try {
      const id = selectedMember.id;
      const [prof, sessions, prs, body, checkins, goals] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
        supabase.from('workout_sessions').select('*').eq('profile_id', id),
        supabase.from('personal_records').select('*').eq('profile_id', id),
        supabase.from('body_measurements').select('*').eq('profile_id', id),
        supabase.from('check_ins').select('*').eq('profile_id', id),
        supabase.from('member_goals').select('*').eq('profile_id', id),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        profile: prof.data ?? null,
        workout_sessions: sessions.data ?? [],
        personal_records: prs.data ?? [],
        body_measurements: body.data ?? [],
        check_ins: checkins.data ?? [],
        goals: goals.data ?? [],
      };
      const safe = String(selectedMember.full_name || selectedMember.username || id).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await saveBlob(`member-export-${safe}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      logAdminAction('export_member', 'member', id, {}, selectedMember.gym_id);
      showToast(t('platform.support.exportDone', 'Member data exported'), 'success');
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    }
  };

  // Permanent member delete (right-to-erasure) — reuses the cross-gym RPC the
  // GymDetail member list uses.
  const handleDeleteMember = async () => {
    if (!selectedMember) return;
    const name = selectedMember.full_name || selectedMember.username || 'this member';
    if (!window.confirm(t('platform.support.deleteConfirm', { name, defaultValue: `Permanently delete ${name} and all their data? This cannot be undone.` }))) return;
    const { error } = await supabase.rpc('admin_delete_gym_member', { p_user_id: selectedMember.id });
    if (error) { showToast(error.message, 'error'); return; }
    logAdminAction('delete_member', 'member', selectedMember.id, { name }, selectedMember.gym_id);
    setMembers(prev => prev.filter(m => m.id !== selectedMember.id));
    setSelectedMember(null);
    showToast(t('platform.support.memberDeleted', 'Member deleted'), 'success');
  };

  // Generate a fresh code via the existing admin_create_invite_code RPC.
  // It is is_admin()-gated (super_admin included) and takes p_gym_id with no
  // own-gym check, so it already works cross-gym (0305/0465 — verified).
  const handleGenerateInvite = async () => {
    if (!selectedMember?.gym_id) {
      showToast(t('platform.support.inviteNoGym', 'This member has no gym — assign a gym first'), 'error');
      return;
    }
    setGeneratingInvite(true);
    const { data, error } = await supabase.rpc('admin_create_invite_code', {
      p_gym_id: selectedMember.gym_id,
      p_member_name: selectedMember.full_name || selectedMember.username || 'Member',
      p_role: selectedMember.role === 'trainer' ? 'trainer' : 'member',
    });
    setGeneratingInvite(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    const code = data?.invite_code;
    if (!code) {
      showToast(t('platform.support.inviteGenerateFailed', 'Could not generate an invite code'), 'error');
      return;
    }
    setMemberInviteRows(prev => [
      { id: `new_${Date.now()}`, code, status: 'pending', createdAt: new Date().toISOString(), isNew: true },
      ...prev,
    ]);
    logAdminAction('generate_invite_code', 'member', selectedMember.id, { invite_code: code }, selectedMember.gym_id);
    copyInviteCode(code);
  };

  const copyInviteCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(c => (c === code ? '' : c)), 2000);
    } catch { /* ignore */ }
  };

  // ── Deactivate ─────────────────────────────────────────────
  const handleDeactivate = async () => {
    if (!selectedMember) return;
    // A8: deactivating a super_admin row = self-lockout with no break-glass.
    if (selectedMember.role === 'super_admin') {
      showToast(t('platform.support.protectedAccount', 'Protected account — super admin role and status can only be changed in the database'), 'error');
      return;
    }
    const confirmMsg = t(
      'platform.support.deactivateConfirm',
      'Deactivate {{name}}? They will lose app access until reactivated.',
      { name: selectedMember.full_name || selectedMember.username || 'this member' },
    );
    // eslint-disable-next-line no-alert
    if (!window.confirm(confirmMsg)) return;
    // membership_status enum supports 'deactivated' (migration 0067)
    const { error } = await supabase
      .from('profiles')
      .update({ membership_status: 'deactivated' })
      .eq('id', selectedMember.id);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    logAdminAction('deactivate_member', 'member', selectedMember.id, {
      from: selectedMember.membership_status,
    }, selectedMember.gym_id);
    showToast(t('platform.support.memberDeactivated', 'Member deactivated'), 'success');
    setSelectedMember({ ...selectedMember, membership_status: 'deactivated' });
    setMembers(prev => prev.map(m => m.id === selectedMember.id ? { ...m, membership_status: 'deactivated' } : m));
  };

  const totalResults = members.length + gymResults.length + invites.length;

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-6xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('platform.support.title', 'Support')}</h1>
          <p className="text-[12px] text-[#6B7280] mt-0.5">{t('platform.support.subtitle', 'Search and repair member, admin, and gym issues')}</p>
        </div>
      </FadeIn>

      {/* Omnibox */}
      <FadeIn delay={50}>
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4B5563]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('platform.support.searchPlaceholder', 'Search by name, username, gym, or invite code...')}
            className="bg-[#111827] border border-white/6 rounded-xl pl-12 pr-10 py-3.5 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 w-full transition-colors"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setSelectedMember(null); setDetailData(null); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4B5563] hover:text-[#9CA3AF] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </FadeIn>

      {/* Layout: results left, detail pane right */}
      <div className="flex gap-4 items-start">
        {/* Left: search results */}
        <div className={`flex-1 min-w-0 ${selectedMember ? 'hidden md:block md:max-w-[55%]' : ''}`}>
          {searching && <Spinner />}

          {/* Honest failure state — a failed search is not "no results" */}
          {!searching && hasSearched && searchError && (
            <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
              <AlertTriangle size={15} className="text-red-400 flex-shrink-0" />
              <p className="text-[12px] text-red-400 flex-1 min-w-0">
                {t('platform.support.searchFailed', 'Search failed — results may be incomplete.')}
              </p>
              <button
                onClick={() => performSearch(query.trim())}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors flex-shrink-0"
              >
                {t('platform.support.retry', 'Retry')}
              </button>
            </div>
          )}

          {!searching && !hasSearched && (
            <FadeIn delay={100}>
              <div className="space-y-4">
                {recentLookups.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-2">{t('platform.support.recentLookups', 'Recent Lookups')}</p>
                    <div className="space-y-1">
                      {recentLookups.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setQuery(r.name || '')}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-white/4 hover:border-white/10 transition-colors text-left"
                          style={{ background: '#0F172A' }}
                        >
                          <UserAvatar user={{ full_name: r.name }} size={28} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{r.name}</p>
                            <p className="text-[10px] text-[#6B7280] truncate">{r.gym || t('platform.support.noGym', 'No gym')} &middot; {r.role}</p>
                          </div>
                          <ChevronRight size={12} className="text-[#4B5563] flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                    <Search className="w-6 h-6 text-[#4B5563]" />
                  </div>
                  <p className="text-[14px] text-[#6B7280]">{t('platform.support.emptyTitle', 'Search for any member, gym, or invite code')}</p>
                  <p className="text-[12px] text-[#4B5563] mt-1">{t('platform.support.emptySubtitle', 'Search by name, username, gym name, slug, or invite code')}</p>
                </div>
              </div>
            </FadeIn>
          )}

          {!searching && hasSearched && totalResults === 0 && !searchError && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="w-10 h-10 text-[#1F2937] mb-3" />
              <p className="text-[14px] text-[#6B7280]">{t('platform.support.noResults', 'No results for "{{query}}"', { query })}</p>
            </div>
          )}

          {/* Grouped results */}
          {!searching && hasSearched && totalResults > 0 && (
            <div className="space-y-5">
              <p className="text-[12px] text-[#6B7280]">{t('platform.support.resultsCount', { count: totalResults, defaultValue: '{{count}} result' })}</p>

              {/* Members */}
              {members.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-2 flex items-center gap-2">
                    {t('platform.support.members', 'Members')}
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/5 text-[#6B7280]">{members.length}</span>
                  </p>
                  <div className="space-y-1">
                    {members.map((member) => {
                      const isSelected = selectedMember?.id === member.id;
                      return (
                        <button
                          key={member.id}
                          onClick={() => openMemberDetail(member)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                            isSelected
                              ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/20'
                              : 'border border-white/4 hover:border-white/10'
                          }`}
                          style={isSelected ? undefined : { background: '#0F172A' }}
                        >
                          <UserAvatar user={member} size={36} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[#E5E7EB] truncate">{member.full_name || t('platform.support.noName', 'No name')}</span>
                              {member.username && <span className="text-[11px] text-[#6B7280] truncate">@{member.username}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-[#9CA3AF] truncate">{member.gyms?.name || t('platform.support.noGym', 'No gym')}</span>
                              <Badge label={member.role || 'member'} variant={roleBadge[member.role] || roleBadge.member} />
                              <Badge label={member.membership_status || 'active'} variant={statusBadge[member.membership_status] || statusBadge.active} />
                            </div>
                          </div>
                          <div className="hidden sm:flex flex-col items-end flex-shrink-0 mr-1">
                            <span className="text-[10px] text-[#6B7280]">{relativeDate(member.last_active_at, t, dateFnsLocale)}</span>
                          </div>
                          <ChevronRight size={14} className="text-[#4B5563] flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Gyms */}
              {gymResults.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-2 flex items-center gap-2">
                    {t('platform.support.gyms', 'Gyms')}
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/5 text-[#6B7280]">{gymResults.length}</span>
                  </p>
                  <div className="space-y-1">
                    {gymResults.map((gym) => (
                      <button
                        key={gym.id}
                        onClick={() => navigate(`/platform/gym/${gym.id}`)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/4 hover:border-white/10 transition-colors text-left"
                        style={{ background: '#0F172A' }}
                      >
                        <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                          <Building2 size={15} className="text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{gym.name}</p>
                          <p className="text-[11px] text-[#6B7280] truncate">{gym.slug}</p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          gym.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {gym.is_active ? t('platform.support.active', 'Active') : t('platform.support.inactive', 'Inactive')}
                        </span>
                        <ChevronRight size={14} className="text-[#4B5563] flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Invites */}
              {invites.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-2 flex items-center gap-2">
                    {t('platform.support.invites', 'Invites')}
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/5 text-[#6B7280]">{invites.length}</span>
                  </p>
                  <div className="space-y-1">
                    {invites.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0F172A] border border-white/4">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                          <KeyRound size={15} className="text-purple-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[#E5E7EB] font-mono truncate">{inv.code}</p>
                          <p className="text-[11px] text-[#6B7280] truncate">{inv.gymName || t('platform.support.unknownGym', 'Unknown gym')} &middot; {inv.detail}</p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          inv.isUsed
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : inv.isExpired
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}>
                          {inv.isUsed ? t('platform.support.claimed', 'Claimed') : inv.isExpired ? t('platform.support.expired', 'Expired') : t('platform.support.pending', 'Pending')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: detail pane */}
        {selectedMember && (
          <div className={`${selectedMember ? 'fixed inset-0 z-50 bg-[#05070B] md:static md:z-auto md:bg-transparent overflow-y-auto' : ''} md:w-[45%] md:sticky md:top-6 md:max-h-[calc(100vh-48px)] md:overflow-y-auto`}>
            <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-white/6">
              <button onClick={() => { setSelectedMember(null); setDetailData(null); }} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
                <X size={20} />
              </button>
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('platform.support.memberDetails', 'Member Details')}</span>
            </div>

            <div className="bg-[#0F172A] border border-white/6 rounded-none md:rounded-xl overflow-hidden">
              {/* Member header */}
              <div className="p-4 border-b border-white/6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <UserAvatar user={selectedMember} size={44} />
                    <div>
                      <p className="text-[15px] font-semibold text-[#E5E7EB]">{selectedMember.full_name || t('platform.support.noName', 'No name')}</p>
                      {selectedMember.username && <p className="text-[12px] text-[#6B7280]">@{selectedMember.username}</p>}
                    </div>
                  </div>
                  <button onClick={() => { setSelectedMember(null); setDetailData(null); }} className="hidden md:block text-[#6B7280] hover:text-[#E5E7EB] transition-colors p-1">
                    <X size={16} />
                  </button>
                </div>

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <Badge label={selectedMember.role || 'member'} variant={roleBadge[selectedMember.role] || roleBadge.member} />
                  <Badge label={selectedMember.membership_status || 'active'} variant={statusBadge[selectedMember.membership_status] || statusBadge.active} />
                  {selectedMember.gyms?.name && (
                    <span className="text-[11px] text-[#9CA3AF] flex items-center gap-1"><Building2 size={10} />{selectedMember.gyms.name}</span>
                  )}
                  {!selectedMember.is_onboarded && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{t('platform.support.notOnboarded', 'Not onboarded')}</span>
                  )}
                </div>

                <div className="flex items-center gap-4 mt-3 text-[11px] text-[#6B7280]">
                  <span className="flex items-center gap-1"><Clock size={10} />{t('platform.support.activePrefix', 'Active')} {relativeDate(selectedMember.last_active_at, t, dateFnsLocale)}</span>
                  <span>{t('platform.support.joinedPrefix', 'Joined')} {formatDate(selectedMember.created_at, dateFnsLocale)}</span>
                </div>
              </div>

              {/* Detail content */}
              <div className="p-4">
                {detailLoading ? (
                  <Spinner />
                ) : detailData ? (
                  <div className="space-y-4">
                    {detailData.hadError && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
                        <p className="text-[11px] text-amber-400">{t('platform.support.detailPartial', 'Some stats failed to load — numbers below may be incomplete.')}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-[#111827] rounded-lg p-3">
                        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">{t('platform.support.totalSessions', 'Total Sessions')}</p>
                        <p className="text-[18px] font-bold text-[#E5E7EB]">{detailData.totalSessions}</p>
                      </div>
                      <div className="bg-[#111827] rounded-lg p-3">
                        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">{t('platform.support.last30Days', 'Last 30 Days')}</p>
                        <p className="text-[18px] font-bold text-[#E5E7EB]">{detailData.sessionsLast30d}</p>
                      </div>
                      <div className="bg-[#111827] rounded-lg p-3">
                        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">{t('platform.support.totalVolume', 'Total Volume')}</p>
                        <p className="text-[18px] font-bold text-[#E5E7EB]">
                          {detailData.totalVolume >= 1000 ? `${(detailData.totalVolume / 1000).toFixed(1)}k` : detailData.totalVolume}
                          <span className="text-[11px] font-normal text-[#6B7280] ml-1">lbs</span>
                        </p>
                      </div>
                      <div className="bg-[#111827] rounded-lg p-3">
                        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">{t('platform.support.checkIns30d', 'Check-ins (30d)')}</p>
                        <p className="text-[18px] font-bold text-[#E5E7EB]">{detailData.checkIns30d}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-[#111827] rounded-lg p-3">
                        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">{t('platform.support.streak', 'Streak')}</p>
                        <p className="text-[18px] font-bold text-[#D4AF37]">
                          {detailData.currentStreak} <span className="text-[11px] font-normal text-[#6B7280]">{t('platform.support.daysUnit', 'days')}</span>
                        </p>
                      </div>
                      <div className="bg-[#111827] rounded-lg p-3">
                        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">{t('platform.support.churnRisk', 'Churn Risk')}</p>
                        {detailData.churnScore !== null ? (
                          <div className="flex items-baseline gap-2">
                            <p className="text-[18px] font-bold text-[#E5E7EB]">{Math.round(detailData.churnScore * 100)}%</p>
                            <span className={`text-[11px] font-medium capitalize ${churnTierColor(detailData.churnTier)}`}>{detailData.churnTier}</span>
                          </div>
                        ) : (
                          <p className="text-[13px] text-[#4B5563]">{t('platform.support.noData', 'No data')}</p>
                        )}
                      </div>
                    </div>

                    {detailData.recentSessions.length > 0 && (
                      <div>
                        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-2">{t('platform.support.recentSessions', 'Recent Sessions')}</p>
                        <div className="space-y-1">
                          {detailData.recentSessions.map((s) => (
                            <div key={s.id} className="flex items-center justify-between bg-[#111827] rounded-lg px-3 py-2">
                              <span className="text-[12px] text-[#E5E7EB]">{formatDate(s.started_at, dateFnsLocale)}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-[#9CA3AF]">{formatDuration(s.duration_seconds)}</span>
                                <span className="text-[11px] text-[#9CA3AF]">{s.total_volume_lbs ? `${s.total_volume_lbs.toLocaleString()} lbs` : '—'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Support actions — A8: super_admin rows are protected
                        (role/status/deactivate would lock the founder out of
                        /platform with no break-glass). */}
                    {(() => { const isProtected = selectedMember.role === 'super_admin'; return (
                    <div className="pt-3 border-t border-white/6">
                      <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-2">{t('platform.support.quickActions', 'Quick Actions')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedMember.gyms?.id && (
                          <button onClick={() => navigate(`/platform/gym/${selectedMember.gyms.id}`)} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors" style={{ background: '#111827' }}>
                            <ExternalLink size={13} />{t('platform.support.viewGym', 'View Gym')}
                          </button>
                        )}
                        <button onClick={openRoleModal} disabled={isProtected} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#9CA3AF] disabled:hover:border-white/6" style={{ background: '#111827' }}>
                          <Shield size={13} />{t('platform.support.changeRole', 'Change Role')}
                        </button>
                        <button onClick={openStatusModal} disabled={isProtected} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#9CA3AF] disabled:hover:border-white/6" style={{ background: '#111827' }}>
                          <UserCog size={13} />{t('platform.support.changeStatus', 'Change Status')}
                        </button>
                        <button onClick={handleResetPassword} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors" style={{ background: '#111827' }}>
                          <RefreshCw size={13} />{t('platform.support.resetPassword', 'Reset Password')}
                        </button>
                        <button onClick={openInviteModal} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors" style={{ background: '#111827' }}>
                          <KeyRound size={13} />{t('platform.support.inviteCodes', 'Invite Codes')}
                        </button>
                        <button onClick={openMoveModal} disabled={isProtected} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#9CA3AF] disabled:hover:border-white/6" style={{ background: '#111827' }}>
                          <ArrowRightLeft size={13} />{t('platform.support.moveToGym', 'Move to gym')}
                        </button>
                        <button onClick={handleDeactivate} disabled={isProtected} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-red-400/70 hover:text-red-400 hover:border-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-red-400/70 disabled:hover:border-white/6" style={{ background: '#111827' }}>
                          <UserX size={13} />{t('platform.support.deactivate', 'Deactivate')}
                        </button>
                        <button onClick={handleExportMember} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors" style={{ background: '#111827' }}>
                          <Download size={13} />{t('platform.support.exportMember', 'Export data')}
                        </button>
                        <button onClick={handleDeleteMember} disabled={isProtected} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 text-[12px] text-red-400/70 hover:text-red-400 hover:border-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-red-400/70 disabled:hover:border-white/6" style={{ background: '#111827' }}>
                          <Trash2 size={13} />{t('platform.support.deleteMember', 'Delete member')}
                        </button>
                      </div>
                      {isProtected && (
                        <p className="flex items-center gap-1.5 text-[11px] text-[#6B7280] mt-2">
                          <Shield size={11} className="text-[#D4AF37] flex-shrink-0" />
                          {t('platform.support.protectedAccount', 'Protected account — super admin role and status can only be changed in the database')}
                        </p>
                      )}
                    </div>
                    ); })()}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Change Role Modal ──────────────────────────────── */}
      {roleModal && selectedMember && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" onClick={() => setRoleModal(false)}>
          <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.support.changeRole', 'Change Role')}</h3>
              <button onClick={() => setRoleModal(false)} className="text-[#6B7280] hover:text-[#E5E7EB]"><X size={16} /></button>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-[#6B7280] uppercase tracking-wider">{t('platform.support.currentRole', 'Current Role')}</p>
              <Badge label={selectedMember.role || 'member'} variant={roleBadge[selectedMember.role] || roleBadge.member} />
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-[#6B7280] uppercase tracking-wider">{t('platform.support.newRole', 'New Role')}</p>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                className="w-full bg-[#111827] border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
              >
                <option value="member">{t('platform.support.roleMember', 'Member')}</option>
                <option value="trainer">{t('platform.support.roleTrainer', 'Trainer')}</option>
                <option value="admin">{t('platform.support.roleAdmin', 'Admin')}</option>
              </select>
              <p className="text-[10px] text-[#4B5563]">{t('platform.support.superAdminNote', 'Super admin can only be assigned via database')}</p>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setRoleModal(false)} className="flex-1 px-3 py-2 rounded-lg bg-white/5 text-[12px] text-[#9CA3AF] hover:bg-white/10 transition-colors">
                {t('platform.support.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleChangeRole}
                disabled={modalSaving || newRole === selectedMember.role}
                className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ background: '#D4AF37', color: '#0F172A' }}
              >
                {modalSaving ? t('platform.support.saving', 'Saving...') : t('platform.support.confirm', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Status Modal ────────────────────────────── */}
      {statusModal && selectedMember && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" onClick={() => setStatusModal(false)}>
          <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.support.changeStatus', 'Change Status')}</h3>
              <button onClick={() => setStatusModal(false)} className="text-[#6B7280] hover:text-[#E5E7EB]"><X size={16} /></button>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-[#6B7280] uppercase tracking-wider">{t('platform.support.currentStatus', 'Current Status')}</p>
              <Badge label={selectedMember.membership_status || 'active'} variant={statusBadge[selectedMember.membership_status] || statusBadge.active} />
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-[#6B7280] uppercase tracking-wider">{t('platform.support.newStatus', 'New Status')}</p>
              <div className="flex gap-2">
                {['active', 'frozen', 'cancelled'].map(s => (
                  <button
                    key={s}
                    onClick={() => setNewStatus(s)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                      newStatus === s
                        ? `${statusBadge[s]} ring-1 ring-current`
                        : 'bg-white/5 text-[#6B7280] hover:bg-white/10'
                    }`}
                  >
                    {t(`platform.support.status_${s}`, s.charAt(0).toUpperCase() + s.slice(1))}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-[#6B7280] uppercase tracking-wider">{t('platform.support.reason', 'Reason')} <span className="normal-case text-[#4B5563]">({t('platform.support.optional', 'optional')})</span></p>
              <textarea
                value={statusReason}
                onChange={e => setStatusReason(e.target.value)}
                rows={2}
                placeholder={t('platform.support.reasonPlaceholder', 'Why is this status changing?')}
                className="w-full bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setStatusModal(false)} className="flex-1 px-3 py-2 rounded-lg bg-white/5 text-[12px] text-[#9CA3AF] hover:bg-white/10 transition-colors">
                {t('platform.support.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleChangeStatus}
                disabled={modalSaving || newStatus === selectedMember.membership_status}
                className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ background: '#D4AF37', color: '#0F172A' }}
              >
                {modalSaving ? t('platform.support.saving', 'Saving...') : t('platform.support.confirm', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Password Modal ───────────────────────────── */}
      {resetModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" onClick={() => setResetModal(false)}>
          <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.support.resetPassword', 'Reset Password')}</h3>
              <button onClick={() => setResetModal(false)} className="text-[#6B7280] hover:text-[#E5E7EB]"><X size={16} /></button>
            </div>

            {modalSaving ? (
              <PlatformSpinner />
            ) : resetCode ? (
              <div className="space-y-3">
                <p className="text-[12px] text-[#9CA3AF]">{t('platform.support.resetCodeLabel', 'Share this reset code with the member:')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-[#111827] border border-white/10 rounded-lg px-3 py-2.5 text-[15px] font-mono text-[#D4AF37] tracking-wider text-center select-all">
                    {resetCode}
                  </code>
                  <button
                    onClick={copyResetCode}
                    className="p-2.5 rounded-lg border border-white/10 text-[#9CA3AF] hover:text-[#D4AF37] hover:border-[#D4AF37]/30 transition-colors"
                    style={{ background: '#111827' }}
                  >
                    {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            ) : null}

            <button onClick={() => setResetModal(false)} className="w-full px-3 py-2 rounded-lg bg-white/5 text-[12px] text-[#9CA3AF] hover:bg-white/10 transition-colors">
              {t('platform.support.close', 'Close')}
            </button>
          </div>
        </div>
      )}

      {/* ── Invite Codes Modal ─────────────────────────────── */}
      {inviteModal && selectedMember && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" onClick={() => setInviteModal(false)}>
          <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.support.inviteCodes', 'Invite Codes')}</h3>
              <button onClick={() => setInviteModal(false)} className="text-[#6B7280] hover:text-[#E5E7EB]"><X size={16} /></button>
            </div>

            {inviteFetchError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                <p className="text-[11px] text-red-400">{t('platform.support.inviteLookupFailed', 'Could not load existing codes — you can still generate a new one.')}</p>
              </div>
            )}

            {inviteLoading ? (
              <PlatformSpinner />
            ) : (
              <div className="space-y-2">
                {memberInviteRows.length === 0 ? (
                  <p className="text-[12px] text-[#6B7280]">{t('platform.support.noInviteCodes', 'No invite codes linked to this member yet.')}</p>
                ) : (
                  <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                    {memberInviteRows.map((row) => (
                      <div key={row.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${row.isNew ? 'bg-[#D4AF37]/10 border-[#D4AF37]/25' : 'bg-[#111827] border-white/8'}`}>
                        <code className={`flex-1 text-[13px] font-mono tracking-wider truncate ${row.isNew ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{row.code}</code>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                          row.status === 'claimed'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : row.status === 'pending'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}>
                          {row.status === 'claimed'
                            ? t('platform.support.claimed', 'Claimed')
                            : row.status === 'pending'
                            ? t('platform.support.pending', 'Pending')
                            : t('platform.support.expired', 'Expired')}
                        </span>
                        <button
                          onClick={() => copyInviteCode(row.code)}
                          title={t('platform.support.copyCode', 'Copy code')}
                          className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#D4AF37] hover:bg-white/5 transition-colors flex-shrink-0"
                        >
                          {copiedCode === row.code ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={handleGenerateInvite}
                disabled={generatingInvite || !selectedMember.gym_id}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ background: '#D4AF37', color: '#0F172A' }}
              >
                {generatingInvite
                  ? <><RefreshCw size={13} className="animate-spin" />{t('platform.support.generating', 'Generating...')}</>
                  : <><Plus size={13} />{t('platform.support.generateNewCode', 'Generate new code')}</>}
              </button>
              {!selectedMember.gym_id && (
                <p className="text-[10px] text-[#6B7280] text-center">{t('platform.support.inviteNoGym', 'This member has no gym — assign a gym first')}</p>
              )}
              <button onClick={() => setInviteModal(false)} className="w-full px-3 py-2 rounded-lg bg-white/5 text-[12px] text-[#9CA3AF] hover:bg-white/10 transition-colors">
                {t('platform.support.close', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Move to Gym Modal ──────────────────────────────── */}
      {moveModal && selectedMember && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" onClick={() => setMoveModal(false)}>
          <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.support.moveToGym', 'Move to gym')}</h3>
              <button onClick={() => setMoveModal(false)} className="text-[#6B7280] hover:text-[#E5E7EB]"><X size={16} /></button>
            </div>

            {/* From → To */}
            <div className="flex items-center gap-2 text-[12px]">
              <span className="flex-1 min-w-0 truncate px-2.5 py-1.5 rounded-lg bg-[#111827] border border-white/8 text-[#9CA3AF]">
                {selectedMember.gyms?.name || t('platform.support.noGym', 'No gym')}
              </span>
              <ArrowRightLeft size={14} className="text-[#4B5563] flex-shrink-0" />
              <span className={`flex-1 min-w-0 truncate px-2.5 py-1.5 rounded-lg border ${moveTarget ? 'bg-[#D4AF37]/10 border-[#D4AF37]/25 text-[#D4AF37]' : 'bg-[#111827] border-white/8 text-[#4B5563]'}`}>
                {moveTarget?.name || t('platform.support.moveSelectTarget', 'Select a gym…')}
              </span>
            </div>

            {/* Target search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4B5563]" />
              <input
                type="text"
                value={moveGymQuery}
                onChange={e => { setMoveGymQuery(e.target.value); setMoveTarget(null); }}
                placeholder={t('platform.support.moveSearchPlaceholder', 'Search gym by name or slug…')}
                className="w-full bg-[#111827] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              />
            </div>

            {moveGymSearching ? (
              <p className="text-[12px] text-[#6B7280] text-center py-2">{t('platform.support.searching', 'Searching…')}</p>
            ) : moveGymResults.length > 0 ? (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {moveGymResults.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setMoveTarget(g)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${
                      moveTarget?.id === g.id ? 'bg-[#D4AF37]/10 border-[#D4AF37]/25' : 'bg-[#111827] border-white/8 hover:border-white/15'
                    }`}
                  >
                    <Building2 size={14} className="text-[#6B7280] flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12px] font-medium text-[#E5E7EB] truncate">{g.name}</span>
                      <span className="block text-[10px] text-[#6B7280] truncate">{g.slug}</span>
                    </span>
                    {!g.is_active && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 flex-shrink-0">{t('platform.support.inactive', 'Inactive')}</span>}
                    {moveTarget?.id === g.id && <Check size={14} className="text-[#D4AF37] flex-shrink-0" />}
                  </button>
                ))}
              </div>
            ) : moveGymQuery.trim().length >= 2 ? (
              <p className="text-[12px] text-[#6B7280] text-center py-2">{t('platform.support.moveNoGyms', 'No other gyms found')}</p>
            ) : null}

            {/* What transfers vs resets */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/15">
              <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-400/90 leading-relaxed">
                {t('platform.support.moveExplainer', 'Their workout history, PRs, body data, goals, achievements and points transfer to the new gym. Old-gym program enrollment, challenge entries, class bookings, leaderboard standing, friendships and trainer assignment are reset.')}
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setMoveModal(false)} className="flex-1 px-3 py-2 rounded-lg bg-white/5 text-[12px] text-[#9CA3AF] hover:bg-white/10 transition-colors">
                {t('platform.support.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleMoveMember}
                disabled={moving || !moveTarget}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ background: '#D4AF37', color: '#0F172A' }}
              >
                {moving ? <><RefreshCw size={13} className="animate-spin" />{t('platform.support.moving', 'Moving…')}</> : t('platform.support.moveConfirm', 'Move member')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
