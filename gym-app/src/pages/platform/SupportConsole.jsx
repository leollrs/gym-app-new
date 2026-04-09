import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { useTranslation } from 'react-i18next';
import { logAdminAction } from '../../lib/adminAudit';
import {
  Search, ChevronDown, ChevronUp, ExternalLink, Shield, UserCog, Eye, X,
  Building2, Mail, RefreshCw, KeyRound, UserX, UserCheck, Link2,
  Activity, Clock, AlertTriangle, Dumbbell, ChevronRight, Copy, Check,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

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
  return (
    <div className="flex justify-center py-8">
      <div className="w-7 h-7 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );
}

const FadeIn = ({ delay = 0, children, className = '' }) => (
  <div
    className={`animate-fade-in-up ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
  >
    {children}
  </div>
);

function relativeDate(dateStr) {
  if (!dateStr) return 'Never';
  try { return formatDistanceToNow(new Date(dateStr), { addSuffix: true }); } catch { return 'Unknown'; }
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try { return format(new Date(dateStr), 'MMM d, yyyy'); } catch { return '—'; }
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
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

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
      return;
    }
    const timeout = setTimeout(() => { performSearch(query.trim()); }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const performSearch = async (term) => {
    setSearching(true);
    setHasSearched(true);
    const safeTerm = term.replace(/[%_\\,()."']/g, '');
    const pattern = `%${safeTerm}%`;

    const [membersRes, gymsRes, invitesRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, gym_id, full_name, username, role, created_at, last_active_at, membership_status, is_onboarded, gyms(id, name, slug)')
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
        .select('id, code, gym_id, role, is_used, expires_at, created_at, gyms(id, name)')
        .ilike('code', pattern)
        .limit(10),
    ]);

    setMembers(membersRes.data || []);
    setGymResults(gymsRes.data || []);
    setInvites(invitesRes.data || []);
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
      supabase
        .from('streak_cache')
        .select('current_streak')
        .eq('profile_id', member.id)
        .single(),
      supabase
        .from('churn_risk_scores')
        .select('score, risk_tier, computed_at')
        .eq('profile_id', member.id)
        .order('computed_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const allSessions = sessionsRes.data || [];
    const totalVolume = allSessions.reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
    const sessionsLast30 = recentSessionsRes.data || [];

    setDetailData({
      totalSessions: allSessions.length,
      sessionsLast30d: sessionsLast30.length,
      totalVolume,
      recentSessions: sessionsLast30,
      checkIns30d: checkInsRes.count || 0,
      currentStreak: streakRes.data?.current_streak || 0,
      churnScore: churnRes.data?.score ?? null,
      churnTier: churnRes.data?.risk_tier || null,
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

  const openRoleModal = () => { setNewRole(selectedMember?.role || 'member'); setRoleModal(true); };
  const openStatusModal = () => { setNewStatus(selectedMember?.membership_status || 'active'); setStatusReason(''); setStatusModal(true); };

  const handleChangeRole = async () => {
    if (!selectedMember || newRole === selectedMember.role) return;
    setModalSaving(true);
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', selectedMember.id);
    setModalSaving(false);
    if (error) {
      showToast(error.message, 'error');
    } else {
      logAdminAction('change_role', 'member', selectedMember.id, { from: selectedMember.role, to: newRole });
      showToast(t('platform.support.roleChanged', 'Role changed successfully'), 'success');
      setSelectedMember({ ...selectedMember, role: newRole });
      setMembers(prev => prev.map(m => m.id === selectedMember.id ? { ...m, role: newRole } : m));
    }
    setRoleModal(false);
  };

  const handleChangeStatus = async () => {
    if (!selectedMember || newStatus === selectedMember.membership_status) return;
    setModalSaving(true);
    const updatePayload = { membership_status: newStatus };
    if (statusReason.trim()) updatePayload.membership_status_reason = statusReason.trim();
    const { error } = await supabase.from('profiles').update(updatePayload).eq('id', selectedMember.id);
    setModalSaving(false);
    if (error) {
      showToast(error.message, 'error');
    } else {
      logAdminAction('change_status', 'member', selectedMember.id, { from: selectedMember.membership_status, to: newStatus });
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
      logAdminAction('reset_password', 'member', selectedMember.id, {});
    }
  };

  const copyResetCode = async () => {
    try {
      await navigator.clipboard.writeText(resetCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
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
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0F172A] border border-white/4 hover:border-white/10 hover:bg-[#111827] transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[11px] font-semibold text-[#D4AF37]">{(r.name || '?')[0].toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{r.name}</p>
                            <p className="text-[10px] text-[#6B7280] truncate">{r.gym || 'No gym'} &middot; {r.role}</p>
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

          {!searching && hasSearched && totalResults === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="w-10 h-10 text-[#1F2937] mb-3" />
              <p className="text-[14px] text-[#6B7280]">{t('platform.support.noResults', 'No results for "{{query}}"', { query })}</p>
            </div>
          )}

          {/* Grouped results */}
          {!searching && hasSearched && totalResults > 0 && (
            <div className="space-y-5">
              <p className="text-[12px] text-[#6B7280]">{totalResults} result{totalResults !== 1 ? 's' : ''}</p>

              {/* Members */}
              {members.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-2 flex items-center gap-2">
                    {t('platform.support.members', 'Members')}
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/5 text-[#6B7280]">{members.length}</span>
                  </p>
                  <div className="space-y-1">
                    {members.map((member) => {
                      const initial = (member.full_name || member.username || '?').charAt(0).toUpperCase();
                      const isSelected = selectedMember?.id === member.id;
                      return (
                        <button
                          key={member.id}
                          onClick={() => openMemberDetail(member)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                            isSelected
                              ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/20'
                              : 'bg-[#0F172A] border border-white/4 hover:border-white/10 hover:bg-[#111827]'
                          }`}
                        >
                          <div className="w-9 h-9 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-[13px] font-semibold text-[#D4AF37]">{initial}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[#E5E7EB] truncate">{member.full_name || 'No name'}</span>
                              {member.username && <span className="text-[11px] text-[#6B7280] truncate">@{member.username}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-[#9CA3AF] truncate">{member.gyms?.name || 'No gym'}</span>
                              <Badge label={member.role || 'member'} variant={roleBadge[member.role] || roleBadge.member} />
                              <Badge label={member.membership_status || 'active'} variant={statusBadge[member.membership_status] || statusBadge.active} />
                            </div>
                          </div>
                          <div className="hidden sm:flex flex-col items-end flex-shrink-0 mr-1">
                            <span className="text-[10px] text-[#6B7280]">{relativeDate(member.last_active_at)}</span>
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
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0F172A] border border-white/4 hover:border-white/10 hover:bg-[#111827] transition-colors text-left"
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
                          <p className="text-[11px] text-[#6B7280] truncate">{inv.gyms?.name || 'Unknown gym'} &middot; {inv.role}</p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          inv.is_used
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : new Date(inv.expires_at) < new Date()
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}>
                          {inv.is_used ? t('platform.support.claimed', 'Claimed') : new Date(inv.expires_at) < new Date() ? t('platform.support.expired', 'Expired') : t('platform.support.pending', 'Pending')}
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
                    <div className="w-11 h-11 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-[16px] font-bold text-[#D4AF37]">{(selectedMember.full_name || '?')[0].toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-[15px] font-semibold text-[#E5E7EB]">{selectedMember.full_name || 'No name'}</p>
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
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Not onboarded</span>
                  )}
                </div>

                <div className="flex items-center gap-4 mt-3 text-[11px] text-[#6B7280]">
                  <span className="flex items-center gap-1"><Clock size={10} />Active {relativeDate(selectedMember.last_active_at)}</span>
                  <span>Joined {formatDate(selectedMember.created_at)}</span>
                </div>
              </div>

              {/* Detail content */}
              <div className="p-4">
                {detailLoading ? (
                  <Spinner />
                ) : detailData ? (
                  <div className="space-y-4">
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
                          {detailData.currentStreak} <span className="text-[11px] font-normal text-[#6B7280]">days</span>
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
                              <span className="text-[12px] text-[#E5E7EB]">{formatDate(s.started_at)}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-[#9CA3AF]">{formatDuration(s.duration_seconds)}</span>
                                <span className="text-[11px] text-[#9CA3AF]">{s.total_volume_lbs ? `${s.total_volume_lbs.toLocaleString()} lbs` : '—'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Support actions */}
                    <div className="pt-3 border-t border-white/6">
                      <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-2">{t('platform.support.quickActions', 'Quick Actions')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedMember.gyms?.id && (
                          <button onClick={() => navigate(`/platform/gym/${selectedMember.gyms.id}`)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors">
                            <ExternalLink size={13} />{t('platform.support.viewGym', 'View Gym')}
                          </button>
                        )}
                        <button onClick={openRoleModal} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors">
                          <Shield size={13} />{t('platform.support.changeRole', 'Change Role')}
                        </button>
                        <button onClick={openStatusModal} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors">
                          <UserCog size={13} />{t('platform.support.changeStatus', 'Change Status')}
                        </button>
                        <button onClick={handleResetPassword} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors">
                          <RefreshCw size={13} />{t('platform.support.resetPassword', 'Reset Password')}
                        </button>
                        <button onClick={() => showToast(t('platform.support.comingSoon', 'Coming soon'), 'info')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors">
                          <Mail size={13} />{t('platform.support.resendInvite', 'Resend Invite')}
                        </button>
                        <button onClick={() => showToast(t('platform.support.comingSoon', 'Coming soon'), 'info')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-red-400/70 hover:text-red-400 hover:border-red-500/20 transition-colors">
                          <UserX size={13} />{t('platform.support.deactivate', 'Deactivate')}
                        </button>
                      </div>
                    </div>
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
                className="flex-1 px-3 py-2 rounded-lg bg-[#D4AF37] text-[12px] font-medium text-[#0F172A] hover:bg-[#C4A030] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                className="flex-1 px-3 py-2 rounded-lg bg-[#D4AF37] text-[12px] font-medium text-[#0F172A] hover:bg-[#C4A030] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
              </div>
            ) : resetCode ? (
              <div className="space-y-3">
                <p className="text-[12px] text-[#9CA3AF]">{t('platform.support.resetCodeLabel', 'Share this reset code with the member:')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-[#111827] border border-white/10 rounded-lg px-3 py-2.5 text-[15px] font-mono text-[#D4AF37] tracking-wider text-center select-all">
                    {resetCode}
                  </code>
                  <button
                    onClick={copyResetCode}
                    className="p-2.5 rounded-lg bg-[#111827] border border-white/10 text-[#9CA3AF] hover:text-[#D4AF37] hover:border-[#D4AF37]/30 transition-colors"
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
    </div>
  );
}
