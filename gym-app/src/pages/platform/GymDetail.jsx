import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Activity, Settings, Search, Shield, Crown, Building2,
  UserCog, ChevronDown, ToggleLeft, ToggleRight, Copy, ExternalLink,
  Dumbbell, MapPin, Clock, Globe, Palette, Link2, RefreshCw,
  Trophy, BookOpen, Award, Gift, Plus, X, Trash2, Edit3, ChevronRight,
  UserPlus, Eye, EyeOff, QrCode, CalendarDays, Smartphone,
  Pause, Play, AlertTriangle, ShieldOff,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import logger from '../../lib/logger';
import { logAdminAction } from '../../lib/adminAudit';
import { format, formatDistanceToNow, subDays } from 'date-fns';

// ── Role / status config ────────────────────────────────────
const roleConfig = {
  super_admin: { key: 'super_admin', bg: 'bg-[#D4AF37]/10', text: 'text-[#D4AF37]', border: 'border-[#D4AF37]/20' },
  admin:       { key: 'admin',       bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
  trainer:     { key: 'trainer',     bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  member:      { key: 'member',      bg: 'bg-white/6',       text: 'text-[#9CA3AF]',  border: 'border-white/10' },
};

const statusConfig = {
  active:      { key: 'active',      bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  frozen:      { key: 'frozen',      bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/20' },
  deactivated: { key: 'deactivated', bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/20' },
  cancelled:   { key: 'cancelled',   bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20' },
  banned:      { key: 'banned',      bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20' },
};

const RoleBadge = ({ role }) => {
  const { t } = useTranslation('pages');
  const cfg = roleConfig[role] ?? roleConfig.member;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {t(`platform.gymDetail.roles.${cfg.key}`)}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const { t } = useTranslation('pages');
  const cfg = statusConfig[status] ?? statusConfig.active;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {t(`platform.gymDetail.statuses.${cfg.key}`)}
    </span>
  );
};

const TIER_OPTIONS = ['free', 'starter', 'pro', 'enterprise'];
const ROLE_OPTIONS = ['member', 'trainer', 'admin'];
const STATUS_ACTIONS = ['active', 'deactivated', 'banned'];

const CHALLENGE_TYPES = ['consistency', 'volume', 'pr', 'team'];
const CHALLENGE_STATUS_STYLES = {
  active:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  upcoming: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  ended:    'bg-white/6 text-[#6B7280] border-white/10',
};

const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'];

// ── SMS Usage Card (platform admin view) ─────────────────────
function SmsUsageCard({ gymId }) {
  const { t } = useTranslation('pages');
  const [usage, setUsage] = useState(null);
  const [recentSms, setRecentSms] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const SMS_CAP = 200;

  useEffect(() => {
    if (!gymId) return;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Fetch current month usage
    supabase.from('sms_usage_monthly')
      .select('month, count')
      .eq('gym_id', gymId)
      .order('month', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        if (data) setUsage(data);
      });

    // Fetch recent SMS sends
    supabase.from('sms_log')
      .select('id, phone_number, body, status, source, created_at')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data) setRecentSms(data);
      });
  }, [gymId]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentUsage = usage?.find(u => u.month === currentMonth)?.count || 0;
  const pct = Math.min(100, (currentUsage / SMS_CAP) * 100);

  return (
    <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center">
            <Globe size={14} className="text-[#F59E0B]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.smsUsage', 'SMS Usage')}</p>
            <p className="text-[10px] text-[#6B7280]">{currentMonth}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-bold text-[#E5E7EB]">{currentUsage}<span className="text-[13px] font-normal text-[#6B7280]">/{SMS_CAP}</span></p>
          <p className="text-[10px] text-[#6B7280]">≈ ${(currentUsage * 0.054).toFixed(2)} cost</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-white/6 rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 90 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#10B981',
          }}
        />
      </div>

      {/* History */}
      {usage && usage.length > 1 && (
        <div className="flex gap-3 mb-3">
          {usage.filter(u => u.month !== currentMonth).map(u => (
            <div key={u.month} className="text-[10px] text-[#6B7280]">
              {u.month}: <span className="text-[#9CA3AF] font-medium">{u.count}</span> SMS
            </div>
          ))}
        </div>
      )}

      {/* Recent sends */}
      {recentSms.length > 0 && (
        <div>
          <button onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors mb-2">
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {t('platform.gymDetail.recentSends', 'Recent sends')} ({recentSms.length})
          </button>
          {expanded && (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {recentSms.map(sms => (
                <div key={sms.id} className="flex items-start gap-2 text-[10px] p-2 bg-white/[0.02] rounded-lg">
                  <span className={`flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${sms.status === 'sent' ? 'bg-emerald-400' : sms.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#9CA3AF] font-mono truncate">{sms.phone_number}</span>
                      <span className="text-[#4B5563] flex-shrink-0">{formatDistanceToNow(new Date(sms.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-[#6B7280] truncate mt-0.5">{sms.body}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${sms.source === 'automated' ? 'bg-purple-500/10 text-purple-400' : sms.source === 'win_back' ? 'bg-red-500/10 text-red-400' : 'bg-white/6 text-[#6B7280]'}`}>
                      {sms.source}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!usage?.length && !recentSms.length && (
        <p className="text-[11px] text-[#4B5563] text-center py-2">{t('platform.gymDetail.noSmsActivity', 'No SMS activity yet')}</p>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────
export default function GymDetail() {
  const { gymId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useTranslation('pages');

  const [gym, setGym] = useState(null);
  const [branding, setBranding] = useState(null);
  const [members, setMembers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [peopleSubTab, setPeopleSubTab] = useState('members');
  const [contentSubTab, setContentSubTab] = useState('challenges');
  const [search, setSearch] = useState('');
  const [editingTier, setEditingTier] = useState(false);
  const [editingGym, setEditingGym] = useState({ name: '', slug: '', qr_enabled: false, qr_payload_type: 'auto_id', qr_display_format: 'qr_code', qr_payload_template: '', classes_enabled: false, multi_admin_enabled: false, max_admin_seats: 1, sms_phone_number: '' });
  const [savingGym, setSavingGym] = useState(false);

  // New tab states
  const [challenges, setChallenges] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [rewardsAvailable, setRewardsAvailable] = useState(null); // null = unknown, false = no table, array = data

  // Modal states
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState(null);
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null);
  const [showAchievementModal, setShowAchievementModal] = useState(false);
  const [editingAchievement, setEditingAchievement] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type, id }
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);

  // Gym lifecycle modal states
  const [lifecycleModal, setLifecycleModal] = useState(null); // 'pause' | 'reactivate' | 'delete'
  const [pauseReason, setPauseReason] = useState('');
  const [deleteGymConfirmName, setDeleteGymConfirmName] = useState('');
  const [lifecycleProcessing, setLifecycleProcessing] = useState(false);

  // ── Fetch gym + branding ──────────────────────────────────
  const fetchGym = async () => {
    const { data } = await supabase
      .from('gyms')
      .select('*')
      .eq('id', gymId)
      .single();
    if (data) {
      setGym(data);
      setEditingGym({
        name: data.name,
        slug: data.slug,
        qr_enabled: data.qr_enabled ?? false,
        qr_payload_type: data.qr_payload_type ?? 'auto_id',
        qr_display_format: data.qr_display_format ?? 'qr_code',
        qr_payload_template: data.qr_payload_template ?? '',
        classes_enabled: data.classes_enabled ?? false,
        multi_admin_enabled: data.multi_admin_enabled ?? false,
        max_admin_seats: data.max_admin_seats ?? 1,
        sms_phone_number: data.sms_phone_number ?? '',
      });
    }

    const { data: b } = await supabase
      .from('gym_branding')
      .select('*')
      .eq('gym_id', gymId)
      .maybeSingle();
    setBranding(b);
  };

  // ── Fetch members ─────────────────────────────────────────
  const fetchMembers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, username, role, created_at, last_active_at, membership_status')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false });
    setMembers(data ?? []);
  };

  // ── Fetch recent activity ─────────────────────────────────
  const fetchActivity = async () => {
    const { data: sess } = await supabase
      .from('workout_sessions')
      .select('id, profile_id, status, started_at, total_volume_lbs, profiles(full_name)')
      .eq('gym_id', gymId)
      .order('started_at', { ascending: false })
      .limit(20);
    setSessions(sess ?? []);

    const { data: ci } = await supabase
      .from('check_ins')
      .select('id, profile_id, checked_in_at, profiles(full_name)')
      .eq('gym_id', gymId)
      .order('checked_in_at', { ascending: false })
      .limit(20);
    setCheckIns(ci ?? []);
  };

  // ── Fetch invites ─────────────────────────────────────────
  const fetchInvites = async () => {
    const { data } = await supabase
      .from('gym_invites')
      .select('*')
      .eq('gym_id', gymId)
      .order('expires_at', { ascending: false });
    setInvites(data ?? []);
  };

  // ── Fetch challenges ──────────────────────────────────────
  const fetchChallenges = async () => {
    const { data } = await supabase
      .from('challenges')
      .select('*, challenge_participants(id)')
      .eq('gym_id', gymId)
      .order('start_date', { ascending: false });
    setChallenges(data ?? []);
  };

  // ── Fetch programs ────────────────────────────────────────
  const fetchPrograms = async () => {
    const { data } = await supabase
      .from('gym_programs')
      .select('*')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false });
    setPrograms(data ?? []);
  };

  // ── Fetch achievements ────────────────────────────────────
  const fetchAchievements = async () => {
    const { data } = await supabase
      .from('achievement_definitions')
      .select('*, user_achievements(id)')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false });
    setAchievements(data ?? []);
  };

  // ── Fetch rewards ─────────────────────────────────────────
  const fetchRewards = async () => {
    try {
      const { data, error } = await supabase
        .from('reward_points')
        .select('*')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (error) {
        setRewardsAvailable(false);
      } else {
        setRewardsAvailable(data ?? []);
      }
    } catch {
      setRewardsAvailable(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([
        fetchGym(),
        fetchMembers(),
        fetchActivity(),
        fetchInvites(),
        fetchChallenges(),
        fetchPrograms(),
        fetchAchievements(),
        fetchRewards(),
      ]);
      setLoading(false);
    };
    load();
  }, [gymId]);

  // ── Computed stats ────────────────────────────────────────
  const stats = useMemo(() => {
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    const totalMembers = members.length;
    const activeMembers = members.filter(m => m.last_active_at && m.last_active_at >= thirtyDaysAgo).length;
    const recentSessions = sessions.filter(s => s.started_at >= thirtyDaysAgo).length;
    const avgSessions = activeMembers > 0 ? (recentSessions / activeMembers).toFixed(1) : '0';
    return { totalMembers, activeMembers, recentSessions, avgSessions };
  }, [members, sessions]);

  // ── Gym lifecycle helpers ──────────────────────────────────
  const gymStatus = !gym?.is_active && gym?.subscription_tier === 'cancelled'
    ? 'deactivated'
    : !gym?.is_active
    ? 'paused'
    : 'active';

  // ── Actions ───────────────────────────────────────────────
  const handlePauseGym = async () => {
    if (!gym || lifecycleProcessing) return;
    setLifecycleProcessing(true);

    const { error: gymErr } = await supabase
      .from('gyms')
      .update({ is_active: false })
      .eq('id', gymId);

    if (!gymErr) {
      const { error: profilesErr } = await supabase
        .from('profiles')
        .update({ membership_status: 'deactivated' })
        .eq('gym_id', gymId)
        .neq('role', 'super_admin');
      if (profilesErr) logger.error('Failed to update member statuses:', profilesErr);

      logAdminAction('pause_gym', 'gym', gymId, { gym_name: gym.name, reason: pauseReason || null });
      setGym(prev => ({ ...prev, is_active: false }));
      await fetchMembers();
    }

    setLifecycleProcessing(false);
    setLifecycleModal(null);
    setPauseReason('');
  };

  const handleReactivateGym = async () => {
    if (!gym || lifecycleProcessing) return;
    setLifecycleProcessing(true);

    const updates = { is_active: true };
    // If the gym was permanently deactivated (cancelled tier), restore to free tier
    if (gym.subscription_tier === 'cancelled') {
      updates.subscription_tier = 'free';
    }

    const { error: gymErr } = await supabase
      .from('gyms')
      .update(updates)
      .eq('id', gymId);

    if (!gymErr) {
      const { error: profilesErr } = await supabase
        .from('profiles')
        .update({ membership_status: 'active' })
        .eq('gym_id', gymId)
        .neq('role', 'super_admin');
      if (profilesErr) logger.error('Failed to update member statuses:', profilesErr);

      logAdminAction('reactivate_gym', 'gym', gymId, { gym_name: gym.name });
      setGym(prev => ({ ...prev, ...updates }));
      await fetchMembers();
    }

    setLifecycleProcessing(false);
    setLifecycleModal(null);
  };

  const handleDeleteGym = async () => {
    if (!gym || lifecycleProcessing) return;
    if (deleteGymConfirmName !== gym.name) return;
    setLifecycleProcessing(true);

    const { error: gymErr } = await supabase
      .from('gyms')
      .update({ is_active: false, subscription_tier: 'cancelled' })
      .eq('id', gymId);

    if (!gymErr) {
      const { error: profilesErr } = await supabase
        .from('profiles')
        .update({ membership_status: 'deactivated' })
        .eq('gym_id', gymId)
        .neq('role', 'super_admin');
      if (profilesErr) logger.error('Failed to update member statuses:', profilesErr);

      logAdminAction('permanently_deactivate_gym', 'gym', gymId, { gym_name: gym.name });
      setGym(prev => ({ ...prev, is_active: false, subscription_tier: 'cancelled' }));
      await fetchMembers();
    }

    setLifecycleProcessing(false);
    setLifecycleModal(null);
    setDeleteGymConfirmName('');
  };

  const updateTier = async (tier) => {
    const { error } = await supabase
      .from('gyms')
      .update({ subscription_tier: tier })
      .eq('id', gymId);
    if (!error) {
      setGym(prev => ({ ...prev, subscription_tier: tier }));
      setEditingTier(false);
    }
  };

  const updateMemberRole = async (profileId, newRole) => {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', profileId);
    if (!error) {
      setMembers(prev => prev.map(m => m.id === profileId ? { ...m, role: newRole } : m));
    }
  };

  const updateMemberStatus = async (profileId, newStatus) => {
    const { error } = await supabase
      .from('profiles')
      .update({ membership_status: newStatus })
      .eq('id', profileId);
    if (!error) {
      setMembers(prev => prev.map(m => m.id === profileId ? { ...m, membership_status: newStatus } : m));
    }
  };

  const deleteMember = async (member) => {
    if (!window.confirm(
      `Delete "${member.full_name ?? member.username}"?\n\nThis will permanently delete their account and ALL associated data (workouts, progress, check-ins, etc). This cannot be undone.`
    )) return;

    const { error } = await supabase.rpc('admin_delete_gym_member', { p_user_id: member.id });
    if (error) {
      alert('Failed to delete member: ' + error.message);
    } else {
      setMembers(prev => prev.filter(m => m.id !== member.id));
    }
  };

  const saveGymSettings = async () => {
    setSavingGym(true);
    const updates = {
      name: editingGym.name,
      slug: editingGym.slug,
      qr_enabled: editingGym.qr_enabled,
      qr_payload_type: editingGym.qr_payload_type,
      qr_display_format: editingGym.qr_display_format,
      qr_payload_template: editingGym.qr_payload_template || null,
      classes_enabled: editingGym.classes_enabled,
      multi_admin_enabled: editingGym.multi_admin_enabled,
      max_admin_seats: editingGym.max_admin_seats,
      sms_phone_number: editingGym.sms_phone_number || null,
    };
    const { error } = await supabase
      .from('gyms')
      .update(updates)
      .eq('id', gymId);
    if (!error) setGym(prev => ({ ...prev, ...updates }));
    setSavingGym(false);
  };

  // ── Challenge CRUD ────────────────────────────────────────
  const saveChallenge = async (formData) => {
    if (editingChallenge?.id) {
      const { error } = await supabase
        .from('challenges')
        .update(formData)
        .eq('id', editingChallenge.id);
      if (!error) await fetchChallenges();
    } else {
      const { error } = await supabase
        .from('challenges')
        .insert({ ...formData, gym_id: gymId });
      if (!error) await fetchChallenges();
    }
    setShowChallengeModal(false);
    setEditingChallenge(null);
  };

  const deleteChallenge = async (challengeId) => {
    const { error } = await supabase.from('challenges').delete().eq('id', challengeId);
    if (!error) setChallenges(prev => prev.filter(c => c.id !== challengeId));
    setDeleteConfirm(null);
  };

  // ── Program CRUD ──────────────────────────────────────────
  const saveProgram = async (formData) => {
    if (editingProgram?.id) {
      const { error } = await supabase
        .from('gym_programs')
        .update(formData)
        .eq('id', editingProgram.id);
      if (!error) await fetchPrograms();
    } else {
      const { error } = await supabase
        .from('gym_programs')
        .insert({ ...formData, gym_id: gymId });
      if (!error) await fetchPrograms();
    }
    setShowProgramModal(false);
    setEditingProgram(null);
  };

  const toggleProgramPublish = async (prog) => {
    const { error } = await supabase
      .from('gym_programs')
      .update({ is_published: !prog.is_published })
      .eq('id', prog.id);
    if (!error) {
      setPrograms(prev => prev.map(p => p.id === prog.id ? { ...p, is_published: !p.is_published } : p));
    }
  };

  const deleteProgram = async (programId) => {
    const { error } = await supabase.from('gym_programs').delete().eq('id', programId);
    if (!error) setPrograms(prev => prev.filter(p => p.id !== programId));
    setDeleteConfirm(null);
  };

  // ── Achievement CRUD ──────────────────────────────────────
  const saveAchievement = async (formData) => {
    if (editingAchievement?.id) {
      const { error } = await supabase
        .from('achievement_definitions')
        .update(formData)
        .eq('id', editingAchievement.id);
      if (!error) await fetchAchievements();
    } else {
      const { error } = await supabase
        .from('achievement_definitions')
        .insert({ ...formData, gym_id: gymId });
      if (!error) await fetchAchievements();
    }
    setShowAchievementModal(false);
    setEditingAchievement(null);
  };

  const deleteAchievement = async (achievementId) => {
    const { error } = await supabase.from('achievement_definitions').delete().eq('id', achievementId);
    if (!error) setAchievements(prev => prev.filter(a => a.id !== achievementId));
    setDeleteConfirm(null);
  };

  // ── Filtered members ──────────────────────────────────────
  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(m =>
      (m.full_name ?? '').toLowerCase().includes(q) ||
      (m.username ?? '').toLowerCase().includes(q) ||
      (m.role ?? '').toLowerCase().includes(q)
    );
  }, [members, search]);

  // ── Challenge status helper ───────────────────────────────
  const getChallengeStatus = (c) => {
    const now = new Date();
    if (c.status) return c.status;
    if (c.end_date && new Date(c.end_date) < now) return 'ended';
    if (c.start_date && new Date(c.start_date) > now) return 'upcoming';
    return 'active';
  };

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center" aria-busy="true">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" role="status" aria-label="Loading gym details" />
      </div>
    );
  }

  if (!gym) {
    return (
      <div className="min-h-screen bg-[#05070B] flex flex-col items-center justify-center gap-4">
        <p className="text-[#9CA3AF] text-sm">Gym not found.</p>
        <button onClick={() => navigate('/platform')} className="text-[#D4AF37] text-sm hover:underline">
          Back to Platform
        </button>
      </div>
    );
  }

  const tabs = [
    { key: 'overview',  label: 'Overview',  icon: Activity },
    { key: 'people',    label: 'People',    icon: Users },
    { key: 'activity',  label: 'Activity',  icon: Dumbbell },
    { key: 'content',   label: 'Content',   icon: Trophy },
    { key: 'settings',  label: 'Settings',  icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/platform')}
            className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#9CA3AF] text-sm mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Platform
          </button>

          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{gym.name}</h1>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  gymStatus === 'active'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : gymStatus === 'paused'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                }`}>
                  {t(`platform.gymDetail.gymStatus.${gymStatus}`)}
                </span>
              </div>
              <p className="text-[#6B7280] text-xs mt-1 font-mono">/{gym.slug}</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Subscription tier */}
              <div className="relative">
                <button
                  onClick={() => setEditingTier(!editingTier)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/20 transition-colors"
                >
                  <Crown className="w-3.5 h-3.5" />
                  {(gym.subscription_tier ?? 'free').toUpperCase()}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {editingTier && (
                  <div className="absolute right-0 top-full mt-1 bg-[#111827] border border-white/8 rounded-lg shadow-xl z-20 py-1 min-w-[120px]">
                    {TIER_OPTIONS.map(t => (
                      <button
                        key={t}
                        onClick={() => updateTier(t)}
                        className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/6 transition-colors ${
                          gym.subscription_tier === t ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'
                        }`}
                      >
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Lifecycle actions */}
              {gymStatus === 'active' ? (
                <button
                  onClick={() => setLifecycleModal('pause')}
                  className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-amber-500/20 hover:bg-amber-500/10 text-amber-400 transition-colors"
                >
                  <Pause className="w-4 h-4" />
                  {t('platform.gymDetail.lifecycle.pauseBtn')}
                </button>
              ) : (
                <button
                  onClick={() => setLifecycleModal('reactivate')}
                  className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/10 text-emerald-400 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  {t('platform.gymDetail.lifecycle.reactivateBtn')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats row ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Members', value: stats.totalMembers, icon: Users },
            { label: 'Active (30d)', value: stats.activeMembers, icon: Activity },
            { label: 'Sessions (30d)', value: stats.recentSessions, icon: Dumbbell },
            { label: 'Avg Sessions/Member', value: stats.avgSessions, icon: Clock },
          ].map(s => (
            <div key={s.label} className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className="w-4 h-4 text-[#D4AF37] flex-shrink-0" />
                <span className="text-[11px] text-[#6B7280] font-medium truncate">{s.label}</span>
              </div>
              <p className="text-[24px] font-bold text-[#E5E7EB] truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────── */}
        <div className="flex gap-1 border-b border-white/6 mb-6 overflow-x-auto scrollbar-hide">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'bg-white/[0.03] text-[#D4AF37] border-b-2 border-[#D4AF37]'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              <t.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* ── Overview tab ───────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-5">
            {/* Gym identity card */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
              <div className="flex items-start gap-4">
                {branding?.logo_url ? (
                  <img src={branding.logo_url} alt={`${gym.name} logo`} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/6" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 border border-[#D4AF37]/20">
                    <Building2 size={24} className="text-[#D4AF37]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-[#E5E7EB]">{gym.name}</p>
                  <p className="text-[12px] text-[#6B7280] font-mono">/{gym.slug}</p>
                  {branding?.palette && (
                    <span className="inline-block mt-1.5 text-[10px] text-[#9CA3AF] bg-white/5 px-2 py-0.5 rounded-full capitalize">{branding.palette.replace(/_/g, ' ')}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Owner / admin summary */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
              <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">Owner & Staff</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{members.filter(m => m.role === 'admin' || m.role === 'super_admin').length}</p>
                  <p className="text-[11px] text-[#6B7280]">Admins</p>
                </div>
                <div>
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{members.filter(m => m.role === 'trainer').length}</p>
                  <p className="text-[11px] text-[#6B7280]">Trainers</p>
                </div>
                <div>
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{members.filter(m => m.role === 'member').length}</p>
                  <p className="text-[11px] text-[#6B7280]">Members</p>
                </div>
              </div>
            </div>

            {/* Activity snapshot */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
              <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">Activity (30 days)</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{stats.recentSessions}</p>
                  <p className="text-[11px] text-[#6B7280]">Sessions</p>
                </div>
                <div>
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{stats.activeMembers}</p>
                  <p className="text-[11px] text-[#6B7280]">Active Members</p>
                </div>
                <div>
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{stats.avgSessions}</p>
                  <p className="text-[11px] text-[#6B7280]">Avg Sessions/Member</p>
                </div>
                <div>
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{checkIns.length}</p>
                  <p className="text-[11px] text-[#6B7280]">Check-ins</p>
                </div>
              </div>
            </div>

            {/* Content summary */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
              <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">Content</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onClick={() => { setTab('content'); setContentSubTab('challenges'); }} className="text-left hover:bg-white/[0.03] rounded-lg p-1 transition-colors">
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{challenges.length}</p>
                  <p className="text-[11px] text-[#6B7280]">Challenges</p>
                </button>
                <button onClick={() => { setTab('content'); setContentSubTab('programs'); }} className="text-left hover:bg-white/[0.03] rounded-lg p-1 transition-colors">
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{programs.length}</p>
                  <p className="text-[11px] text-[#6B7280]">Programs</p>
                </button>
                <button onClick={() => { setTab('content'); setContentSubTab('achievements'); }} className="text-left hover:bg-white/[0.03] rounded-lg p-1 transition-colors">
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{achievements.length}</p>
                  <p className="text-[11px] text-[#6B7280]">Achievements</p>
                </button>
                <div className="p-1">
                  <p className="text-[18px] font-bold text-[#E5E7EB]">{invites.length}</p>
                  <p className="text-[11px] text-[#6B7280]">Invites</p>
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <button onClick={() => setTab('people')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
                <Users size={16} className="text-[#D4AF37] mb-2" />
                <p className="text-[12px] font-medium text-[#9CA3AF]">Manage People</p>
              </button>
              <button onClick={() => setTab('content')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
                <Trophy size={16} className="text-[#D4AF37] mb-2" />
                <p className="text-[12px] font-medium text-[#9CA3AF]">Manage Content</p>
              </button>
              <button onClick={() => setTab('activity')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
                <Dumbbell size={16} className="text-[#D4AF37] mb-2" />
                <p className="text-[12px] font-medium text-[#9CA3AF]">View Activity</p>
              </button>
              <button onClick={() => setTab('settings')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
                <Settings size={16} className="text-[#D4AF37] mb-2" />
                <p className="text-[12px] font-medium text-[#9CA3AF]">Gym Settings</p>
              </button>
            </div>

            {/* SMS Usage */}
            <SmsUsageCard gymId={gymId} />
          </div>
        )}

        {/* ── People tab (Members + Invites) ────────────────────── */}
        {tab === 'people' && (
          <div>
            {/* Sub-tabs */}
            <div className="flex gap-1 mb-4">
              {[
                { key: 'members', label: `Members (${members.length})` },
                { key: 'staff', label: `Staff (${members.filter(m => m.role === 'admin' || m.role === 'trainer').length})` },
                { key: 'invites', label: `Invites (${invites.length})` },
              ].map(st => (
                <button
                  key={st.key}
                  onClick={() => setPeopleSubTab(st.key)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    peopleSubTab === st.key ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.02]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {peopleSubTab === 'members' && (
          <div>
            {/* Header + Add button */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4B5563]" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search members..."
                  aria-label="Search members"
                  className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
                />
              </div>
              <button
                onClick={() => setShowAddMemberModal(true)}
                className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add Member
              </button>
            </div>

            {/* Members list */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
              {/* Desktop header */}
              <div className="hidden md:grid md:grid-cols-[1fr_120px_100px_120px_120px_100px_100px_40px] gap-3 px-4 py-3 border-b border-white/6 text-[11px] text-[#6B7280] font-medium uppercase tracking-wider">
                <span>Name</span>
                <span>Username</span>
                <span>Role</span>
                <span>Joined</span>
                <span>Last Active</span>
                <span>Status</span>
                <span>Actions</span>
                <span></span>
              </div>

              {filteredMembers.length === 0 && (
                <div className="py-12 text-center text-[#6B7280] text-sm">No members found.</div>
              )}

              {filteredMembers.map(m => (
                <div
                  key={m.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_120px_100px_120px_120px_100px_100px_40px] gap-2 md:gap-3 px-4 py-3 border-b border-white/6 last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-[#D4AF37]/10 flex items-center justify-center text-[#D4AF37] text-[11px] font-bold flex-shrink-0">
                      {(m.full_name ?? '?')[0].toUpperCase()}
                    </div>
                    <span className="text-[13px] text-[#E5E7EB] truncate">{m.full_name ?? 'Unknown'}</span>
                  </div>

                  {/* Username */}
                  <div className="flex items-center">
                    <span className="text-[12px] text-[#6B7280] font-mono truncate">@{m.username ?? '\u2014'}</span>
                  </div>

                  {/* Role dropdown */}
                  <div className="flex items-center">
                    <select
                      value={m.role ?? 'member'}
                      onChange={e => updateMemberRole(m.id, e.target.value)}
                      aria-label="Member role"
                      className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r} value={r}>{t(`platform.gymDetail.roles.${r}`)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Joined */}
                  <div className="flex items-center">
                    <span className="text-[12px] text-[#6B7280]">
                      {m.created_at ? format(new Date(m.created_at), 'MMM d, yyyy') : '\u2014'}
                    </span>
                  </div>

                  {/* Last active */}
                  <div className="flex items-center">
                    <span className="text-[12px] text-[#6B7280]">
                      {m.last_active_at ? formatDistanceToNow(new Date(m.last_active_at), { addSuffix: true }) : 'Never'}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="flex items-center">
                    <StatusBadge status={m.membership_status ?? 'active'} />
                  </div>

                  {/* Status actions */}
                  <div className="flex items-center">
                    <select
                      value={m.membership_status ?? 'active'}
                      onChange={e => updateMemberStatus(m.id, e.target.value)}
                      aria-label="Member status"
                      className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                    >
                      {STATUS_ACTIONS.map(s => (
                        <option key={s} value={s}>{t(`platform.gymDetail.statuses.${s}`)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Delete */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={() => deleteMember(m)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#4B5563] hover:text-red-400 transition-colors"
                      title="Delete member"
                      aria-label="Delete member"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-[#6B7280] mt-2">
              Showing {filteredMembers.length} of {members.length} members
            </p>
          </div>
            )}

            {/* Staff sub-tab */}
            {peopleSubTab === 'staff' && (
              <div className="space-y-2">
                {members.filter(m => m.role === 'admin' || m.role === 'trainer' || m.role === 'super_admin').length === 0 ? (
                  <div className="bg-[#0F172A] border border-white/6 rounded-xl p-8 text-center">
                    <p className="text-[13px] text-[#6B7280]">No staff members</p>
                  </div>
                ) : (
                  members.filter(m => m.role === 'admin' || m.role === 'trainer' || m.role === 'super_admin').map(m => (
                    <div key={m.id} className="bg-[#0F172A] border border-white/6 rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-[12px] font-semibold text-[#D4AF37]">{(m.full_name || m.username || '?')[0].toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name || m.username}</p>
                        <p className="text-[11px] text-[#6B7280]">@{m.username}</p>
                      </div>
                      <RoleBadge role={m.role} />
                      <StatusBadge status={m.membership_status || 'active'} />
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Invites sub-tab */}
            {peopleSubTab === 'invites' && (
              <div className="space-y-2">
                {invites.length === 0 ? (
                  <div className="bg-[#0F172A] border border-white/6 rounded-xl p-8 text-center">
                    <p className="text-[13px] text-[#6B7280]">No invites</p>
                  </div>
                ) : (
                  invites.map(inv => {
                    const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
                    return (
                      <div key={inv.id} className="bg-[#0F172A] border border-white/6 rounded-xl px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[#E5E7EB] font-mono">{inv.code}</p>
                          <p className="text-[11px] text-[#6B7280]">Role: {inv.role || 'member'}</p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          inv.is_used ? 'bg-emerald-500/15 text-emerald-400' : isExpired ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                        }`}>
                          {inv.is_used ? 'Claimed' : isExpired ? 'Expired' : 'Pending'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Activity tab ───────────────────────────────────── */}
        {tab === 'activity' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent sessions */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6">
                <Dumbbell className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-[13px] font-semibold text-[#E5E7EB]">Recent Workout Sessions</h3>
              </div>
              {sessions.length === 0 ? (
                <div className="py-10 text-center text-[#6B7280] text-sm">No sessions recorded.</div>
              ) : (
                <div className="divide-y divide-white/6">
                  {sessions.map(s => (
                    <div key={s.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] text-[#E5E7EB]">
                          {s.profiles?.full_name ?? 'Unknown'}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          s.status === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {s.status ?? 'unknown'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
                        <span>{s.started_at ? format(new Date(s.started_at), 'MMM d, h:mm a') : '\u2014'}</span>
                        {s.total_volume_lbs != null && (
                          <span>{Number(s.total_volume_lbs).toLocaleString()} lbs</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent check-ins */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6">
                <MapPin className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-[13px] font-semibold text-[#E5E7EB]">Recent Check-Ins</h3>
              </div>
              {checkIns.length === 0 ? (
                <div className="py-10 text-center text-[#6B7280] text-sm">No check-ins recorded.</div>
              ) : (
                <div className="divide-y divide-white/6">
                  {checkIns.map(ci => (
                    <div key={ci.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                      <span className="text-[13px] text-[#E5E7EB] block">
                        {ci.profiles?.full_name ?? 'Unknown'}
                      </span>
                      <span className="text-[11px] text-[#6B7280]">
                        {ci.checked_in_at ? format(new Date(ci.checked_in_at), 'MMM d, h:mm a') : '\u2014'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Content tab (Challenges, Programs, Achievements, Rewards) */}
        {tab === 'content' && (
          <div>
            {/* Content sub-tabs */}
            <div className="flex gap-1 mb-4">
              {[
                { key: 'challenges', label: `Challenges (${challenges.length})` },
                { key: 'programs', label: `Programs (${programs.length})` },
                { key: 'achievements', label: `Achievements (${achievements.length})` },
                { key: 'rewards', label: 'Rewards' },
              ].map(st => (
                <button
                  key={st.key}
                  onClick={() => setContentSubTab(st.key)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    contentSubTab === st.key ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.02]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

        {contentSubTab === 'challenges' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB]">Gym Challenges</h3>
              <button
                onClick={() => { setEditingChallenge(null); setShowChallengeModal(true); }}
                className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Challenge
              </button>
            </div>

            {challenges.length === 0 ? (
              <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
                <Trophy className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
                <p className="text-[#6B7280] text-sm">No challenges yet. Create your first one!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {challenges.map(c => {
                  const status = getChallengeStatus(c);
                  const statusStyle = CHALLENGE_STATUS_STYLES[status] ?? CHALLENGE_STATUS_STYLES.ended;
                  const participantCount = c.challenge_participants?.length ?? 0;
                  return (
                    <div key={c.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{c.name}</h4>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusStyle}`}>
                              {status}
                            </span>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                              {c.type ?? 'general'}
                            </span>
                          </div>
                          {c.description && (
                            <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{c.description}</p>
                          )}
                          <div className="flex items-center gap-4 text-[11px] text-[#6B7280]">
                            {c.start_date && <span>Start: {format(new Date(c.start_date), 'MMM d, yyyy')}</span>}
                            {c.end_date && <span>End: {format(new Date(c.end_date), 'MMM d, yyyy')}</span>}
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {participantCount} participants
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditingChallenge(c); setShowChallengeModal(true); }}
                            className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                            aria-label="Edit challenge"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ type: 'challenge', id: c.id, name: c.name })}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                            aria-label="Delete challenge"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {contentSubTab === 'programs' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB]">Gym Programs</h3>
              <button
                onClick={() => { setEditingProgram(null); setShowProgramModal(true); }}
                className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Program
              </button>
            </div>

            {programs.length === 0 ? (
              <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
                <BookOpen className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
                <p className="text-[#6B7280] text-sm">No programs yet. Create your first one!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {programs.map(p => (
                  <div key={p.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{p.name}</h4>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            p.is_published
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {p.is_published ? 'Published' : 'Draft'}
                          </span>
                          {p.difficulty_level && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/6 text-[#9CA3AF] border border-white/10">
                              {p.difficulty_level}
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{p.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-[11px] text-[#6B7280]">
                          {p.duration_weeks && <span>{p.duration_weeks} weeks</span>}
                          {p.created_at && <span>Created {format(new Date(p.created_at), 'MMM d, yyyy')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleProgramPublish(p)}
                          className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                          title={p.is_published ? 'Unpublish' : 'Publish'}
                          aria-label={p.is_published ? 'Unpublish program' : 'Publish program'}
                        >
                          {p.is_published
                            ? <ToggleRight className="w-4 h-4 text-emerald-400" />
                            : <ToggleLeft className="w-4 h-4" />
                          }
                        </button>
                        <button
                          onClick={() => { setEditingProgram(p); setShowProgramModal(true); }}
                          className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                          aria-label="Edit program"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'program', id: p.id, name: p.name })}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                          aria-label="Delete program"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {contentSubTab === 'achievements' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB]">Achievement Definitions</h3>
              <button
                onClick={() => { setEditingAchievement(null); setShowAchievementModal(true); }}
                className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Achievement
              </button>
            </div>

            {achievements.length === 0 ? (
              <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
                <Award className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
                <p className="text-[#6B7280] text-sm">No achievements defined yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {achievements.map(a => {
                  const earnedCount = a.user_achievements?.length ?? 0;
                  return (
                    <div key={a.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{a.name}</h4>
                            {a.type && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                                {a.type}
                              </span>
                            )}
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              {earnedCount} earned
                            </span>
                          </div>
                          {a.description && (
                            <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{a.description}</p>
                          )}
                          {a.requirement_value != null && (
                            <span className="text-[11px] text-[#6B7280]">
                              Requirement: {a.requirement_value}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditingAchievement(a); setShowAchievementModal(true); }}
                            className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                            aria-label="Edit achievement"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ type: 'achievement', id: a.id, name: a.name })}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                            aria-label="Delete achievement"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {contentSubTab === 'rewards' && (
          <div>
            {rewardsAvailable === false ? (
              <div className="bg-[#0F172A] border border-white/6 rounded-xl py-20 text-center">
                <Gift className="w-10 h-10 text-[#D4AF37]/40 mx-auto mb-4" />
                <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-2">Rewards System Coming Soon</h3>
                <p className="text-[12px] text-[#6B7280] max-w-sm mx-auto">
                  The rewards and points system is under development. Members will be able to earn and redeem points for achievements, challenges, and consistency.
                </p>
              </div>
            ) : Array.isArray(rewardsAvailable) && rewardsAvailable.length === 0 ? (
              <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
                <Gift className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
                <p className="text-[#6B7280] text-sm">No reward items configured for this gym.</p>
              </div>
            ) : Array.isArray(rewardsAvailable) ? (
              <div className="space-y-3">
                {rewardsAvailable.map(r => (
                  <div key={r.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                        <Gift className="w-5 h-5 text-[#D4AF37]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{r.name ?? r.title ?? 'Reward'}</h4>
                        {r.description && (
                          <p className="text-[12px] text-[#6B7280] line-clamp-1">{r.description}</p>
                        )}
                      </div>
                      {r.points != null && (
                        <span className="text-[12px] font-semibold text-[#D4AF37] bg-[#D4AF37]/10 px-3 py-1 rounded-lg">
                          {r.points} pts
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

          </div>
        )}

        {/* ── Settings tab ───────────────────────────────────── */}
        {tab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Gym info */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#D4AF37]" />
                Gym Info
              </h3>

              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={editingGym.name}
                  onChange={e => setEditingGym(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Slug</label>
                <input
                  type="text"
                  value={editingGym.slug}
                  onChange={e => setEditingGym(prev => ({ ...prev, slug: e.target.value }))}
                  className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Timezone</label>
                <p className="text-[13px] text-[#E5E7EB]">{gym.timezone ?? 'Not set'}</p>
              </div>

              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Owner</label>
                <p className="text-[13px] text-[#9CA3AF] font-mono text-[11px]">{gym.owner_user_id ?? 'Unknown'}</p>
              </div>

              <button
                onClick={saveGymSettings}
                disabled={savingGym}
                className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
              >
                {savingGym ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            {/* Branding preview */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <Palette className="w-4 h-4 text-[#D4AF37]" />
                Branding
              </h3>

              {branding ? (
                <>
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Primary Color</label>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-lg border border-white/10"
                          style={{ backgroundColor: branding.primary_color ?? '#D4AF37' }}
                        />
                        <span className="text-[12px] text-[#9CA3AF] font-mono">{branding.primary_color ?? '\u2014'}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Accent Color</label>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-lg border border-white/10"
                          style={{ backgroundColor: branding.accent_color ?? '#E6C766' }}
                        />
                        <span className="text-[12px] text-[#9CA3AF] font-mono">{branding.accent_color ?? '\u2014'}</span>
                      </div>
                    </div>
                  </div>

                  {branding.custom_app_name && (
                    <div>
                      <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Custom App Name</label>
                      <p className="text-[13px] text-[#E5E7EB]">{branding.custom_app_name}</p>
                    </div>
                  )}

                  {branding.logo_url && (
                    <div>
                      <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Logo</label>
                      <img
                        src={branding.logo_url}
                        alt={`${gym.name} logo`}
                        className="h-12 w-auto rounded-lg border border-white/6 bg-white/[0.03] p-1"
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[#6B7280] text-sm">No branding configured for this gym.</p>
              )}
            </div>

            {/* QR Code Configuration */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#D4AF37]" />
                QR Code Check-In
              </h3>
              <p className="text-[12px] text-[#6B7280]">
                Generate unique QR codes for members to scan at this gym's existing access system
              </p>

              {/* Enable toggle */}
              <div className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
                <div>
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">Enable QR Codes</p>
                  <p className="text-[11px] text-[#6B7280]">Members will see a "Show QR" button on the check-in screen</p>
                </div>
                <button
                  onClick={() => setEditingGym(prev => ({ ...prev, qr_enabled: !prev.qr_enabled }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${editingGym.qr_enabled ? 'bg-[#D4AF37]' : 'bg-[#374151]'}`}
                  role="switch"
                  aria-checked={editingGym.qr_enabled}
                  aria-label="Toggle QR codes"
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editingGym.qr_enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>

              {editingGym.qr_enabled && (
                <div className="space-y-4">
                  {/* Payload type */}
                  <div>
                    <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">Code Type</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { key: 'auto_id', label: 'Auto-generated', desc: 'Unique code per member' },
                        { key: 'external_id', label: 'External ID', desc: "Gym's existing member codes" },
                        { key: 'custom_template', label: 'Custom Template', desc: 'Build a custom format' },
                      ].map(opt => (
                        <button key={opt.key} onClick={() => setEditingGym(prev => ({ ...prev, qr_payload_type: opt.key }))}
                          className={`text-left p-3 rounded-xl border transition-colors ${
                            editingGym.qr_payload_type === opt.key
                              ? 'border-[#D4AF37]/40 bg-[#D4AF37]/8'
                              : 'border-white/6 bg-[#111827] hover:border-white/12'
                          }`}>
                          <p className={`text-[12px] font-semibold ${editingGym.qr_payload_type === opt.key ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                            {opt.label}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">{opt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom template input */}
                  {editingGym.qr_payload_type === 'custom_template' && (
                    <div>
                      <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">Template</label>
                      <input
                        value={editingGym.qr_payload_template}
                        onChange={e => setEditingGym(prev => ({ ...prev, qr_payload_template: e.target.value }))}
                        placeholder="e.g. GYM-{member_id} or {external_id}"
                        className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
                      />
                      <p className="text-[11px] text-[#6B7280] mt-1.5">
                        Variables: <span className="font-mono text-[#D4AF37]/70">{'{member_id}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{external_id}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{full_name}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{username}'}</span>
                      </p>
                    </div>
                  )}

                  {editingGym.qr_payload_type === 'external_id' && (
                    <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                      <p className="text-[12px] text-[#9CA3AF]">
                        Set each member's external code in the <span className="font-semibold text-[#E5E7EB]">Members</span> tab → click member → External ID field.
                      </p>
                    </div>
                  )}

                  {/* Display format */}
                  <div>
                    <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">Display Format</label>
                    <div className="flex gap-2">
                      {[
                        { key: 'qr_code', label: 'QR Code' },
                        { key: 'barcode_128', label: 'Barcode 128' },
                        { key: 'barcode_39', label: 'Barcode 39' },
                      ].map(opt => (
                        <button key={opt.key} onClick={() => setEditingGym(prev => ({ ...prev, qr_display_format: opt.key }))}
                          className={`flex-1 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                            editingGym.qr_display_format === opt.key
                              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                              : 'bg-[#111827] border border-white/6 text-[#6B7280]'
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Class Booking */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-3">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[#D4AF37]" />
                Class Booking
              </h3>
              <p className="text-[11px] text-[#6B7280]">
                Allow members to book scheduled classes at this gym
              </p>
              <div className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
                <div>
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">Enable Class Booking</p>
                  <p className="text-[11px] text-[#6B7280]">Members will see a Classes tab in the app</p>
                </div>
                <button
                  onClick={() => setEditingGym(prev => ({ ...prev, classes_enabled: !prev.classes_enabled }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${editingGym.classes_enabled ? 'bg-[#D4AF37]' : 'bg-[#374151]'}`}
                  role="switch"
                  aria-checked={editingGym.classes_enabled}
                  aria-label="Toggle class booking"
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editingGym.classes_enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            </div>

            {/* Multi-Admin */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-white/4">
                <div>
                  <p className="text-[13px] font-medium text-[#E5E7EB]">Multi-Admin</p>
                  <p className="text-[11px] text-[#6B7280]">Allow multiple admin accounts for this gym</p>
                </div>
                <button onClick={() => setEditingGym(p => ({ ...p, multi_admin_enabled: !p.multi_admin_enabled }))}
                  className="w-10 h-5.5 rounded-full relative flex-shrink-0 transition-colors"
                  role="switch"
                  aria-checked={editingGym.multi_admin_enabled}
                  aria-label="Toggle multi-admin"
                  style={{ backgroundColor: editingGym.multi_admin_enabled ? '#D4AF37' : '#6B7280' }}>
                  <span className="absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform"
                    style={{ left: editingGym.multi_admin_enabled ? 'calc(100% - 20px)' : '2px' }} />
                </button>
              </div>
              {editingGym.multi_admin_enabled && (
                <div className="flex items-center justify-between py-3 border-b border-white/4">
                  <div>
                    <p className="text-[13px] font-medium text-[#E5E7EB]">Max Admin Seats</p>
                    <p className="text-[11px] text-[#6B7280]">Maximum number of admin accounts</p>
                  </div>
                  <input type="number" min="1" max="20" value={editingGym.max_admin_seats}
                    onChange={e => setEditingGym(p => ({ ...p, max_admin_seats: parseInt(e.target.value) || 1 }))}
                    aria-label="Max admin seats"
                    className="w-16 bg-[#111827] border border-white/6 rounded-lg px-2 py-1.5 text-[13px] text-[#E5E7EB] text-center outline-none focus:border-[#D4AF37]/40" />
                </div>
              )}
            </div>

            {/* SMS Configuration */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Smartphone size={14} className="text-[#D4AF37]" />
                <div>
                  <p className="text-[13px] font-medium text-[#E5E7EB]">{t('platform.gymDetail.smsConfig', 'SMS Configuration')}</p>
                  <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.smsConfigDesc', 'Twilio phone number used to send SMS to members')}</p>
                </div>
              </div>
              <div className="py-3 border-t border-white/4">
                <input
                  type="text"
                  placeholder="+1XXXXXXXXXX"
                  aria-label="SMS phone number"
                  value={editingGym.sms_phone_number}
                  onChange={e => setEditingGym(p => ({ ...p, sms_phone_number: e.target.value }))}
                  className="w-full bg-[#111827] border rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none transition-colors"
                  style={{
                    borderColor: !editingGym.sms_phone_number
                      ? 'rgba(255,255,255,0.06)'
                      : /^\+1\d{10}$/.test(editingGym.sms_phone_number)
                        ? '#10B981'
                        : '#EF4444',
                  }}
                />
                <p className="text-[10px] text-[#6B7280] mt-2">{t('platform.gymDetail.smsPhoneHelp', 'US format required. Leave empty to disable SMS for this gym.')}</p>
              </div>
            </div>

            {/* ── Gym Lifecycle / Status ──────────────────────── */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <ShieldOff className="w-4 h-4 text-[#D4AF37]" />
                {t('platform.gymDetail.lifecycle.title')}
              </h3>
              <p className="text-[12px] text-[#6B7280]">{t('platform.gymDetail.lifecycle.description')}</p>

              {/* Current status indicator */}
              <div className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl border border-white/6">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  gymStatus === 'active' ? 'bg-emerald-400' : gymStatus === 'paused' ? 'bg-amber-400' : 'bg-red-400'
                }`} />
                <div>
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">
                    {t('platform.gymDetail.lifecycle.currentStatus')}: {t(`platform.gymDetail.gymStatus.${gymStatus}`)}
                  </p>
                  <p className="text-[11px] text-[#6B7280]">
                    {gymStatus === 'active' && t('platform.gymDetail.lifecycle.activeDesc')}
                    {gymStatus === 'paused' && t('platform.gymDetail.lifecycle.pausedDesc')}
                    {gymStatus === 'deactivated' && t('platform.gymDetail.lifecycle.deactivatedDesc')}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                {gymStatus === 'active' && (
                  <button
                    onClick={() => setLifecycleModal('pause')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-amber-500/20 bg-amber-500/8 text-amber-400 hover:bg-amber-500/15 transition-colors"
                  >
                    <Pause className="w-4 h-4" />
                    {t('platform.gymDetail.lifecycle.pauseBtn')}
                  </button>
                )}
                {gymStatus !== 'active' && (
                  <button
                    onClick={() => setLifecycleModal('reactivate')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-emerald-500/20 bg-emerald-500/8 text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    {t('platform.gymDetail.lifecycle.reactivateBtn')}
                  </button>
                )}
                {gymStatus !== 'deactivated' && (
                  <button
                    onClick={() => setLifecycleModal('delete')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-red-500/20 bg-red-500/8 text-red-400 hover:bg-red-500/15 transition-colors"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    {t('platform.gymDetail.lifecycle.deleteBtn')}
                  </button>
                )}
              </div>
            </div>

            {/* Invite links */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
              <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <Link2 className="w-4 h-4 text-[#D4AF37]" />
                Invite Links
              </h3>

              {invites.length === 0 ? (
                <p className="text-[#6B7280] text-sm">No invite links found.</p>
              ) : (
                <div className="space-y-2">
                  {invites.map(inv => {
                    const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
                    const isUsed = !!inv.used_at;
                    return (
                      <div
                        key={inv.id}
                        className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 bg-[#111827] border border-white/6 rounded-lg px-3 py-2.5"
                      >
                        <span className="text-[12px] text-[#9CA3AF] font-mono flex-1 truncate">{inv.token}</span>
                        <RoleBadge role={inv.role ?? 'member'} />
                        <span className="text-[11px] text-[#6B7280]">
                          {inv.expires_at ? `Expires ${format(new Date(inv.expires_at), 'MMM d, yyyy')}` : 'No expiry'}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          isUsed
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : isExpired
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {isUsed ? 'Used' : isExpired ? 'Expired' : 'Pending'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Challenge Modal ──────────────────────────────────── */}
      {showChallengeModal && (
        <ChallengeModal
          challenge={editingChallenge}
          onSave={saveChallenge}
          onClose={() => { setShowChallengeModal(false); setEditingChallenge(null); }}
        />
      )}

      {/* ── Program Modal ────────────────────────────────────── */}
      {showProgramModal && (
        <ProgramModal
          program={editingProgram}
          onSave={saveProgram}
          onClose={() => { setShowProgramModal(false); setEditingProgram(null); }}
        />
      )}

      {/* ── Achievement Modal ────────────────────────────────── */}
      {showAchievementModal && (
        <AchievementModal
          achievement={editingAchievement}
          onSave={saveAchievement}
          onClose={() => { setShowAchievementModal(false); setEditingAchievement(null); }}
        />
      )}

      {/* ── Add Member Modal ──────────────────────────────────── */}
      {showAddMemberModal && (
        <AddMemberModal
          gymId={gymId}
          onClose={() => setShowAddMemberModal(false)}
          onCreated={() => { setShowAddMemberModal(false); fetchMembers(); }}
        />
      )}

      {/* ── Delete Confirmation ──────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => setDeleteConfirm(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDeleteConfirm(null); }} />
          <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-2">Delete {deleteConfirm.type}?</h3>
            <p className="text-[13px] text-[#6B7280] mb-6">
              Are you sure you want to delete <span className="text-[#E5E7EB]">{deleteConfirm.name}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteConfirm.type === 'challenge') deleteChallenge(deleteConfirm.id);
                  else if (deleteConfirm.type === 'program') deleteProgram(deleteConfirm.id);
                  else if (deleteConfirm.type === 'achievement') deleteAchievement(deleteConfirm.id);
                }}
                className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Gym Lifecycle Modals ──────────────────────────────── */}

      {/* Pause Gym Modal */}
      {lifecycleModal === 'pause' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => { setLifecycleModal(null); setPauseReason(''); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setLifecycleModal(null); setPauseReason(''); } }} />
          <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Pause className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.lifecycle.pauseTitle')}</h3>
                <p className="text-[11px] text-[#6B7280]">{gym.name}</p>
              </div>
            </div>
            <div className="p-3 bg-amber-500/8 border border-amber-500/15 rounded-xl mb-4">
              <p className="text-[12px] text-amber-300">{t('platform.gymDetail.lifecycle.pauseWarning')}</p>
            </div>
            <div className="mb-4">
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">
                {t('platform.gymDetail.lifecycle.pauseReasonLabel')}
              </label>
              <textarea
                value={pauseReason}
                onChange={e => setPauseReason(e.target.value)}
                placeholder={t('platform.gymDetail.lifecycle.pauseReasonPlaceholder')}
                rows={3}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-amber-400/40 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setLifecycleModal(null); setPauseReason(''); }}
                className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
              >
                {t('platform.gymDetail.lifecycle.cancel')}
              </button>
              <button
                onClick={handlePauseGym}
                disabled={lifecycleProcessing}
                className="px-4 py-2 text-[12px] font-semibold text-black bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors disabled:opacity-50"
              >
                {lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmPause')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate Gym Modal */}
      {lifecycleModal === 'reactivate' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => setLifecycleModal(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setLifecycleModal(null); }} />
          <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <Play className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.lifecycle.reactivateTitle')}</h3>
                <p className="text-[11px] text-[#6B7280]">{gym.name}</p>
              </div>
            </div>
            <div className="p-3 bg-emerald-500/8 border border-emerald-500/15 rounded-xl mb-4">
              <p className="text-[12px] text-emerald-300">{t('platform.gymDetail.lifecycle.reactivateWarning')}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setLifecycleModal(null)}
                className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
              >
                {t('platform.gymDetail.lifecycle.cancel')}
              </button>
              <button
                onClick={handleReactivateGym}
                disabled={lifecycleProcessing}
                className="px-4 py-2 text-[12px] font-semibold text-black bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors disabled:opacity-50"
              >
                {lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmReactivate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Permanently Deactivate Gym Modal */}
      {lifecycleModal === 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => { setLifecycleModal(null); setDeleteGymConfirmName(''); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setLifecycleModal(null); setDeleteGymConfirmName(''); } }} />
          <div className="relative bg-[#0F172A] border border-red-500/20 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-red-400">{t('platform.gymDetail.lifecycle.deleteTitle')}</h3>
                <p className="text-[11px] text-[#6B7280]">{gym.name}</p>
              </div>
            </div>
            <div className="p-3 bg-red-500/8 border border-red-500/15 rounded-xl mb-4">
              <p className="text-[12px] text-red-300">{t('platform.gymDetail.lifecycle.deleteWarning')}</p>
            </div>
            <div className="mb-4">
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">
                {t('platform.gymDetail.lifecycle.deleteConfirmLabel', { name: gym.name })}
              </label>
              <input
                type="text"
                value={deleteGymConfirmName}
                onChange={e => setDeleteGymConfirmName(e.target.value)}
                placeholder={gym.name}
                aria-label="Type gym name to confirm deletion"
                className="w-full bg-[#111827] border border-red-500/20 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-red-400/40"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setLifecycleModal(null); setDeleteGymConfirmName(''); }}
                className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
              >
                {t('platform.gymDetail.lifecycle.cancel')}
              </button>
              <button
                onClick={handleDeleteGym}
                disabled={lifecycleProcessing || deleteGymConfirmName !== gym.name}
                className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Challenge Modal Component ─────────────────────────────────
function ChallengeModal({ challenge, onSave, onClose }) {
  const [form, setForm] = useState({
    title: challenge?.title ?? '',
    type: challenge?.type ?? 'consistency',
    description: challenge?.description ?? '',
    start_date: challenge?.start_date ? challenge.start_date.slice(0, 10) : '',
    end_date: challenge?.end_date ? challenge.end_date.slice(0, 10) : '',
    scoring_method: challenge?.scoring_method ?? '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    await onSave({
      title: form.title.trim(),
      type: form.type,
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      scoring_method: form.scoring_method.trim() || null,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB]">
            {challenge ? 'Edit Challenge' : 'New Challenge'}
          </h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Challenge title"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
            >
              {CHALLENGE_TYPES.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the challenge..."
              rows={3}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Start Date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm(prev => ({ ...prev, start_date: e.target.value }))}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm(prev => ({ ...prev, end_date: e.target.value }))}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Scoring Method</label>
            <input
              type="text"
              value={form.scoring_method}
              onChange={e => setForm(prev => ({ ...prev, scoring_method: e.target.value }))}
              placeholder="e.g., total_volume, check_in_count"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : challenge ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Program Modal Component ───────────────────────────────────
function ProgramModal({ program, onSave, onClose }) {
  const [form, setForm] = useState({
    name: program?.name ?? '',
    description: program?.description ?? '',
    difficulty_level: program?.difficulty_level ?? 'beginner',
    duration_weeks: program?.duration_weeks ?? '',
    is_published: program?.is_published ?? false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      difficulty_level: form.difficulty_level,
      duration_weeks: form.duration_weeks ? parseInt(form.duration_weeks, 10) : null,
      is_published: form.is_published,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB]">
            {program ? 'Edit Program' : 'New Program'}
          </h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Program name"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the program..."
              rows={3}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Difficulty</label>
              <select
                value={form.difficulty_level}
                onChange={e => setForm(prev => ({ ...prev, difficulty_level: e.target.value }))}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
              >
                {DIFFICULTY_LEVELS.map(d => (
                  <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Duration (weeks)</label>
              <input
                type="number"
                value={form.duration_weeks}
                onChange={e => setForm(prev => ({ ...prev, duration_weeks: e.target.value }))}
                placeholder="e.g., 8"
                min="1"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_published"
              checked={form.is_published}
              onChange={e => setForm(prev => ({ ...prev, is_published: e.target.checked }))}
              className="accent-[#D4AF37]"
            />
            <label htmlFor="is_published" className="text-[12px] text-[#9CA3AF]">Publish immediately</label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : program ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Achievement Modal Component ───────────────────────────────
function AchievementModal({ achievement, onSave, onClose }) {
  const [form, setForm] = useState({
    name: achievement?.name ?? '',
    description: achievement?.description ?? '',
    type: achievement?.type ?? '',
    requirement_value: achievement?.requirement_value ?? '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type.trim() || null,
      requirement_value: form.requirement_value !== '' ? Number(form.requirement_value) : null,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB]">
            {achievement ? 'Edit Achievement' : 'New Achievement'}
          </h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Achievement name"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the achievement..."
              rows={3}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Type</label>
              <input
                type="text"
                value={form.type}
                onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}
                placeholder="e.g., streak, volume, pr"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Requirement Value</label>
              <input
                type="number"
                value={form.requirement_value}
                onChange={e => setForm(prev => ({ ...prev, requirement_value: e.target.value }))}
                placeholder="e.g., 30"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : achievement ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Member Modal Component ────────────────────────────────
function AddMemberModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    username: '',
    role: 'member',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.email.trim() || !form.password || !form.fullName.trim() || !form.username.trim()) {
      setError('All fields are required');
      return;
    }
    if (form.password.length < 8 || !/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setError('Password must be 8+ characters with uppercase, lowercase, and a number');
      return;
    }

    setSaving(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_create_gym_member', {
        p_email: form.email.trim(),
        p_password: form.password,
        p_full_name: form.fullName.trim(),
        p_username: form.username.trim().toLowerCase(),
        p_gym_id: gymId,
        p_role: form.role,
      });

      if (rpcErr) {
        setError(rpcErr.message || 'Failed to create member');
        setSaving(false);
        return;
      }

      onCreated();
    } catch (err) {
      setError(err.message || 'Failed to create member');
      setSaving(false);
    }
  };

  const autoUsername = (val) => {
    setForm(prev => ({
      ...prev,
      fullName: val,
      username: prev.username || val.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB] flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-[#D4AF37]" />
            Add Member
          </h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Full Name *</label>
            <input
              type="text"
              value={form.fullName}
              onChange={e => autoUsername(e.target.value)}
              placeholder="John Smith"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Username *</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
              placeholder="johnsmith"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
              placeholder="john@example.com"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Temporary Password *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Min. 6 characters"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 pr-9 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Role *</label>
            <div className="grid grid-cols-3 gap-1.5 bg-[#111827] border border-white/6 rounded-lg p-1">
              {[
                { value: 'member',  label: t('platform.gymDetail.roles.member') },
                { value: 'trainer', label: t('platform.gymDetail.roles.trainer') },
                { value: 'admin',   label: t('platform.gymDetail.roles.admin') },
              ].map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, role: r.value }))}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                    form.role === r.value
                      ? r.value === 'admin'
                        ? 'bg-indigo-500/15 text-indigo-400'
                        : r.value === 'trainer'
                        ? 'bg-purple-500/15 text-purple-400'
                        : 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
