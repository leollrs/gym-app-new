import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Activity, Settings, Search, Shield, Crown,
  UserCog, ChevronDown, ToggleLeft, ToggleRight, Copy, ExternalLink,
  Dumbbell, MapPin, Clock, Globe, Palette, Link2, RefreshCw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, formatDistanceToNow, subDays } from 'date-fns';

// ── Role / status config ────────────────────────────────────
const roleConfig = {
  super_admin: { label: 'Super Admin', bg: 'bg-[#D4AF37]/10', text: 'text-[#D4AF37]', border: 'border-[#D4AF37]/20' },
  admin:       { label: 'Admin',       bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
  trainer:     { label: 'Trainer',     bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  member:      { label: 'Member',      bg: 'bg-white/6',       text: 'text-[#9CA3AF]',  border: 'border-white/10' },
};

const statusConfig = {
  active:    { label: 'Active',    bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  frozen:    { label: 'Frozen',    bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/20' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20' },
  banned:    { label: 'Banned',    bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20' },
};

const RoleBadge = ({ role }) => {
  const cfg = roleConfig[role] ?? roleConfig.member;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const cfg = statusConfig[status] ?? statusConfig.active;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
};

const TIER_OPTIONS = ['free', 'starter', 'pro', 'enterprise'];
const ROLE_OPTIONS = ['member', 'trainer', 'admin'];
const STATUS_ACTIONS = ['active', 'frozen', 'banned'];

// ── Main component ──────────────────────────────────────────
export default function GymDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [gym, setGym] = useState(null);
  const [branding, setBranding] = useState(null);
  const [members, setMembers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('members');
  const [search, setSearch] = useState('');
  const [editingTier, setEditingTier] = useState(false);
  const [editingGym, setEditingGym] = useState({ name: '', slug: '' });
  const [savingGym, setSavingGym] = useState(false);

  // ── Fetch gym + branding ──────────────────────────────────
  const fetchGym = async () => {
    const { data } = await supabase
      .from('gyms')
      .select('*')
      .eq('id', id)
      .single();
    if (data) {
      setGym(data);
      setEditingGym({ name: data.name, slug: data.slug });
    }

    const { data: b } = await supabase
      .from('gym_branding')
      .select('*')
      .eq('gym_id', id)
      .maybeSingle();
    setBranding(b);
  };

  // ── Fetch members ─────────────────────────────────────────
  const fetchMembers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, username, role, created_at, last_active_at, membership_status')
      .eq('gym_id', id)
      .order('created_at', { ascending: false });
    setMembers(data ?? []);
  };

  // ── Fetch recent activity ─────────────────────────────────
  const fetchActivity = async () => {
    const { data: sess } = await supabase
      .from('workout_sessions')
      .select('id, profile_id, status, started_at, total_volume_lbs, profiles(full_name)')
      .eq('gym_id', id)
      .order('started_at', { ascending: false })
      .limit(20);
    setSessions(sess ?? []);

    const { data: ci } = await supabase
      .from('check_ins')
      .select('id, profile_id, checked_in_at, profiles(full_name)')
      .eq('gym_id', id)
      .order('checked_in_at', { ascending: false })
      .limit(20);
    setCheckIns(ci ?? []);
  };

  // ── Fetch invites ─────────────────────────────────────────
  const fetchInvites = async () => {
    const { data } = await supabase
      .from('gym_invites')
      .select('*')
      .eq('gym_id', id)
      .order('expires_at', { ascending: false });
    setInvites(data ?? []);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchGym(), fetchMembers(), fetchActivity(), fetchInvites()]);
      setLoading(false);
    };
    load();
  }, [id]);

  // ── Computed stats ────────────────────────────────────────
  const stats = useMemo(() => {
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    const totalMembers = members.length;
    const activeMembers = members.filter(m => m.last_active_at && m.last_active_at >= thirtyDaysAgo).length;
    const recentSessions = sessions.filter(s => s.started_at >= thirtyDaysAgo).length;
    const avgSessions = activeMembers > 0 ? (recentSessions / activeMembers).toFixed(1) : '0';
    return { totalMembers, activeMembers, recentSessions, avgSessions };
  }, [members, sessions]);

  // ── Actions ───────────────────────────────────────────────
  const toggleActive = async () => {
    if (!gym) return;
    const { error } = await supabase
      .from('gyms')
      .update({ is_active: !gym.is_active })
      .eq('id', id);
    if (!error) setGym(prev => ({ ...prev, is_active: !prev.is_active }));
  };

  const updateTier = async (tier) => {
    const { error } = await supabase
      .from('gyms')
      .update({ subscription_tier: tier })
      .eq('id', id);
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

  const saveGymSettings = async () => {
    setSavingGym(true);
    const { error } = await supabase
      .from('gyms')
      .update({ name: editingGym.name, slug: editingGym.slug })
      .eq('id', id);
    if (!error) setGym(prev => ({ ...prev, name: editingGym.name, slug: editingGym.slug }));
    setSavingGym(false);
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

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
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
    { key: 'members',  label: 'Members',  icon: Users },
    { key: 'activity', label: 'Activity', icon: Activity },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">

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
                <h1 className="text-xl md:text-2xl font-bold text-[#E5E7EB] truncate">{gym.name}</h1>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  gym.is_active
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                }`}>
                  {gym.is_active ? 'Active' : 'Inactive'}
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

              {/* Toggle active */}
              <button
                onClick={toggleActive}
                className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-white/6 hover:bg-white/[0.03] text-[#9CA3AF] transition-colors"
              >
                {gym.is_active
                  ? <><ToggleRight className="w-4 h-4 text-emerald-400" /> Deactivate</>
                  : <><ToggleLeft className="w-4 h-4 text-red-400" /> Activate</>
                }
              </button>
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
            <div key={s.label} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-[11px] text-[#6B7280] font-medium">{s.label}</span>
              </div>
              <p className="text-xl font-bold text-[#E5E7EB]">{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────── */}
        <div className="flex gap-1 border-b border-white/6 mb-6">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors ${
                tab === t.key
                  ? 'bg-white/[0.03] text-[#D4AF37] border-b-2 border-[#D4AF37]'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Members tab ────────────────────────────────────── */}
        {tab === 'members' && (
          <div>
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4B5563]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search members..."
                className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            </div>

            {/* Members list */}
            <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
              {/* Desktop header */}
              <div className="hidden md:grid md:grid-cols-[1fr_120px_100px_120px_120px_100px_100px] gap-3 px-4 py-3 border-b border-white/6 text-[11px] text-[#6B7280] font-medium uppercase tracking-wider">
                <span>Name</span>
                <span>Username</span>
                <span>Role</span>
                <span>Joined</span>
                <span>Last Active</span>
                <span>Status</span>
                <span>Actions</span>
              </div>

              {filteredMembers.length === 0 && (
                <div className="py-12 text-center text-[#6B7280] text-sm">No members found.</div>
              )}

              {filteredMembers.map(m => (
                <div
                  key={m.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_120px_100px_120px_120px_100px_100px] gap-2 md:gap-3 px-4 py-3 border-b border-white/6 last:border-0 hover:bg-white/[0.02] transition-colors"
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
                    <span className="text-[12px] text-[#6B7280] font-mono truncate">@{m.username ?? '—'}</span>
                  </div>

                  {/* Role dropdown */}
                  <div className="flex items-center">
                    <select
                      value={m.role ?? 'member'}
                      onChange={e => updateMemberRole(m.id, e.target.value)}
                      className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r} value={r}>{roleConfig[r]?.label ?? r}</option>
                      ))}
                    </select>
                  </div>

                  {/* Joined */}
                  <div className="flex items-center">
                    <span className="text-[12px] text-[#6B7280]">
                      {m.created_at ? format(new Date(m.created_at), 'MMM d, yyyy') : '—'}
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
                      className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                    >
                      {STATUS_ACTIONS.map(s => (
                        <option key={s} value={s}>{statusConfig[s]?.label ?? s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-[#6B7280] mt-2">
              Showing {filteredMembers.length} of {members.length} members
            </p>
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
                        <span>{s.started_at ? format(new Date(s.started_at), 'MMM d, h:mm a') : '—'}</span>
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
                        {ci.checked_in_at ? format(new Date(ci.checked_in_at), 'MMM d, h:mm a') : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                        <span className="text-[12px] text-[#9CA3AF] font-mono">{branding.primary_color ?? '—'}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Accent Color</label>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-lg border border-white/10"
                          style={{ backgroundColor: branding.accent_color ?? '#E6C766' }}
                        />
                        <span className="text-[12px] text-[#9CA3AF] font-mono">{branding.accent_color ?? '—'}</span>
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
                        alt="Gym logo"
                        className="h-12 w-auto rounded-lg border border-white/6 bg-white/[0.03] p-1"
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[#6B7280] text-sm">No branding configured for this gym.</p>
              )}
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
    </div>
  );
}
