import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, Building2, Users, Activity, Dumbbell,
  X, ChevronRight, Loader2, UserPlus, Eye, EyeOff,
  TrendingUp, TrendingDown, AlertTriangle, ArrowUpDown,
  Download, Calendar,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, subDays, formatDistanceToNow } from 'date-fns';

const useCountUp = (end, duration = 800) => {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const target = typeof end === 'number' ? end : parseInt(end) || 0;
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, duration]);
  return value;
};

const FadeIn = ({ delay = 0, children, className = '' }) => (
  <div
    className={`animate-fade-in-up ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
  >
    {children}
  </div>
);

const StatCard = ({ label, value, icon: Icon, borderColor, suffix, delay = 0 }) => {
  const animated = useCountUp(value, 900);
  return (
    <FadeIn delay={delay}>
      <div
        className="bg-[#0F172A] border border-white/6 rounded-xl p-4 border-l-2 hover:border-white/10 hover:bg-[#111827] transition-all duration-300 group overflow-hidden"
        style={{ borderLeftColor: borderColor }}
      >
        <div className="flex items-center justify-between mb-2">
          <Icon size={16} className="text-[#6B7280] group-hover:text-[#9CA3AF] transition-colors" />
        </div>
        <p className="text-[24px] font-bold text-[#E5E7EB] leading-none tabular-nums tracking-tight truncate">
          {animated.toLocaleString()}{suffix && <span className="text-[14px] font-normal text-[#6B7280] ml-1">{suffix}</span>}
        </p>
        <p className="text-[11px] text-[#9CA3AF] mt-1 group-hover:text-[#D1D5DB] transition-colors truncate">{label}</p>
      </div>
    </FadeIn>
  );
};

const PLAN_COLORS = {
  starter:    { bg: 'bg-[#3B82F6]/15', text: 'text-[#60A5FA]', label: 'Starter' },
  pro:        { bg: 'bg-[#D4AF37]/15', text: 'text-[#D4AF37]', label: 'Pro' },
  lifetime:   { bg: 'bg-[#A855F7]/15', text: 'text-[#C084FC]', label: 'Lifetime' },
  enterprise: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Enterprise' },
  free:       { bg: 'bg-[#6B7280]/15', text: 'text-[#9CA3AF]', label: 'Free' },
};

const TierBadge = ({ tier, isFounding }) => {
  const t = PLAN_COLORS[tier] || PLAN_COLORS.starter;
  return (
    <span className="flex items-center gap-1">
      <span className={`${t.bg} ${t.text} text-[11px] font-semibold px-2 py-0.5 rounded-full`}>
        {t.label}
      </span>
      {isFounding && (
        <span className="text-[10px] text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full font-medium">Founding</span>
      )}
    </span>
  );
};

// Health score: 0-100 based on activity
const getHealthScore = (gym, memberCount, sessionCount30d) => {
  if (!gym.is_active) return { label: 'Inactive', color: 'text-red-400', bg: 'bg-red-500/15' };
  const members = memberCount || 0;
  const sessions = sessionCount30d || 0;
  if (members === 0) return { label: 'New', color: 'text-blue-400', bg: 'bg-blue-500/15' };
  const sessionsPerMember = sessions / members;
  if (sessionsPerMember >= 4) return { label: 'Thriving', color: 'text-emerald-400', bg: 'bg-emerald-500/15' };
  if (sessionsPerMember >= 1.5) return { label: 'Healthy', color: 'text-emerald-400', bg: 'bg-emerald-500/10' };
  if (sessionsPerMember >= 0.5) return { label: 'Moderate', color: 'text-amber-400', bg: 'bg-amber-500/15' };
  return { label: 'At Risk', color: 'text-red-400', bg: 'bg-red-500/15' };
};

const FILTERS = ['all', 'active', 'inactive', 'at risk'];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'largest', label: 'Largest' },
  { value: 'most-active', label: 'Most Active' },
  { value: 'name', label: 'Name' },
];

export default function GymsOverview() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [gyms, setGyms] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [sessionCounts, setSessionCounts] = useState({});
  const [ownerProfiles, setOwnerProfiles] = useState({});
  const [totalSessions, setTotalSessions] = useState(0);
  const [newGymsThisMonth, setNewGymsThisMonth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [addMemberGym, setAddMemberGym] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      const [gymsRes, profilesRes, sessionsRes] = await Promise.all([
        supabase.from('gyms').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('gym_id'),
        supabase
          .from('workout_sessions')
          .select('gym_id')
          .gte('started_at', thirtyDaysAgo),
      ]);

      const gymsList = gymsRes.data || [];
      setGyms(gymsList);

      // Member counts per gym
      const counts = {};
      (profilesRes.data || []).forEach((p) => {
        counts[p.gym_id] = (counts[p.gym_id] || 0) + 1;
      });
      setMemberCounts(counts);

      // Session counts per gym (30d)
      const sessCounts = {};
      let total = 0;
      (sessionsRes.data || []).forEach((s) => {
        sessCounts[s.gym_id] = (sessCounts[s.gym_id] || 0) + 1;
        total++;
      });
      setSessionCounts(sessCounts);
      setTotalSessions(total);

      // New gyms this month
      setNewGymsThisMonth(gymsList.filter(g => g.created_at >= monthStart).length);

      // Owner profiles
      const ownerIds = [...new Set(gymsList.map((g) => g.owner_user_id).filter(Boolean))];
      if (ownerIds.length > 0) {
        const { data: owners } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', ownerIds);
        const map = {};
        (owners || []).forEach((o) => { map[o.id] = o.full_name; });
        setOwnerProfiles(map);
      }
    } catch (err) {
      logger.error('Failed to fetch gyms data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = gyms;
    if (filter === 'active') list = list.filter((g) => g.is_active);
    if (filter === 'inactive') list = list.filter((g) => !g.is_active);
    if (filter === 'at risk') {
      list = list.filter((g) => {
        const h = getHealthScore(g, memberCounts[g.id], sessionCounts[g.id]);
        return h.label === 'At Risk' || h.label === 'Moderate';
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) =>
        g.name?.toLowerCase().includes(q) ||
        g.slug?.toLowerCase().includes(q) ||
        ownerProfiles[g.owner_user_id]?.toLowerCase().includes(q)
      );
    }

    // Sort
    switch (sort) {
      case 'largest':
        list = [...list].sort((a, b) => (memberCounts[b.id] || 0) - (memberCounts[a.id] || 0));
        break;
      case 'most-active':
        list = [...list].sort((a, b) => (sessionCounts[b.id] || 0) - (sessionCounts[a.id] || 0));
        break;
      case 'name':
        list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      default: // newest — already sorted by created_at desc
        break;
    }

    return list;
  }, [gyms, filter, search, sort, memberCounts, sessionCounts, ownerProfiles]);

  const totalMembers = useMemo(
    () => Object.values(memberCounts).reduce((a, b) => a + b, 0),
    [memberCounts]
  );
  const activeGyms = useMemo(() => gyms.filter((g) => g.is_active).length, [gyms]);
  const inactiveGyms = gyms.length - activeGyms;
  const strugglingGyms = useMemo(() => {
    return gyms.filter(g => {
      const h = getHealthScore(g, memberCounts[g.id], sessionCounts[g.id]);
      return h.label === 'At Risk';
    }).length;
  }, [gyms, memberCounts, sessionCounts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#E5E7EB]">Gyms</h1>
            <p className="text-[12px] text-[#6B7280] mt-0.5">Platform customers and account status</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5 transition-colors flex-shrink-0 whitespace-nowrap"
            >
              <Plus size={14} />
              Create Gym
            </button>
          </div>
        </div>
      </FadeIn>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 mb-6">
        <StatCard label="Total Gyms" value={gyms.length} icon={Building2} borderColor="var(--color-accent, #D4AF37)" delay={50} />
        <StatCard label="Active Gyms" value={activeGyms} icon={Activity} borderColor="#10B981" delay={80} />
        <StatCard label="Inactive" value={inactiveGyms} icon={Building2} borderColor="#EF4444" delay={110} />
        <StatCard label="Total Members" value={totalMembers} icon={Users} borderColor="#3B82F6" delay={140} />
        <StatCard label="New This Month" value={newGymsThisMonth} icon={TrendingUp} borderColor="#8B5CF6" delay={170} />
        <StatCard label="Struggling" value={strugglingGyms} icon={AlertTriangle} borderColor="#F59E0B" delay={200} />
      </div>

      {/* Filters toolbar */}
      <FadeIn delay={230}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, slug, or owner..."
              className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          <div className="flex gap-2">
            {/* Filter chips */}
            <div className="flex gap-1 bg-[#0F172A] border border-white/6 rounded-lg p-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors capitalize whitespace-nowrap ${
                    filter === f
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
                >
                  {f === 'at risk' ? 'At Risk' : f}
                </button>
              ))}
            </div>

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="bg-[#0F172A] border border-white/6 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors cursor-pointer appearance-none"
              style={{ backgroundImage: 'none' }}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </FadeIn>

      {/* Gym table */}
      <FadeIn delay={280}>
        {filtered.length === 0 ? (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-12 text-center">
            <Building2 size={32} className="mx-auto text-[#4B5563] mb-3" />
            <p className="text-[14px] text-[#6B7280]">No gyms found</p>
          </div>
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid grid-cols-[1fr_100px_80px_80px_80px_100px_120px_32px] gap-4 px-4 py-3 border-b border-white/6 text-[10px] text-[#6B7280] uppercase tracking-wider font-semibold">
              <span>Gym</span>
              <span>Plan</span>
              <span className="text-right">Members</span>
              <span className="text-center">Health</span>
              <span className="text-center">Status</span>
              <span>Last Activity</span>
              <span>Owner</span>
              <span />
            </div>
            {filtered.map((gym) => {
              const health = getHealthScore(gym, memberCounts[gym.id], sessionCounts[gym.id]);
              return (
                <button
                  key={gym.id}
                  onClick={() => navigate(`/platform/gym/${gym.id}`)}
                  className="w-full text-left grid grid-cols-1 md:grid-cols-[1fr_100px_80px_80px_80px_100px_120px_32px] gap-2 md:gap-4 px-4 py-3.5 border-b border-white/4 last:border-b-0 hover:bg-[#111827] transition-colors group"
                >
                  {/* Gym name */}
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate group-hover:text-white transition-colors">
                      {gym.name}
                    </p>
                    <p className="text-[11px] text-[#6B7280] truncate">{gym.slug}</p>
                  </div>

                  {/* Mobile meta row */}
                  <div className="flex items-center md:hidden gap-2 flex-wrap">
                    <TierBadge tier={gym.plan_type || gym.subscription_tier} isFounding={gym.is_founding} />
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${health.bg} ${health.color}`}>
                      {health.label}
                    </span>
                    <span className="text-[11px] text-[#6B7280]">{memberCounts[gym.id] || 0} members</span>
                  </div>

                  {/* Desktop: Plan */}
                  <div className="hidden md:flex items-center">
                    <TierBadge tier={gym.plan_type || gym.subscription_tier} isFounding={gym.is_founding} />
                  </div>

                  {/* Desktop: Members */}
                  <p className="hidden md:flex items-center justify-end text-[13px] text-[#9CA3AF] tabular-nums">
                    {(memberCounts[gym.id] || 0).toLocaleString()}
                  </p>

                  {/* Desktop: Health */}
                  <div className="hidden md:flex items-center justify-center">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${health.bg} ${health.color}`}>
                      {health.label}
                    </span>
                  </div>

                  {/* Desktop: Status */}
                  <div className="hidden md:flex items-center justify-center">
                    <span className={`w-2 h-2 rounded-full ${gym.is_active ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
                  </div>

                  {/* Desktop: Last activity */}
                  <p className="hidden md:flex items-center text-[11px] text-[#6B7280] truncate">
                    {sessionCounts[gym.id] ? `${sessionCounts[gym.id]} sessions` : 'No activity'}
                  </p>

                  {/* Desktop: Owner */}
                  <p className="hidden md:flex items-center text-[12px] text-[#9CA3AF] truncate">
                    {ownerProfiles[gym.owner_user_id] || '—'}
                  </p>

                  {/* Chevron */}
                  <div className="hidden md:flex items-center justify-end">
                    <ChevronRight size={14} className="text-[#4B5563] group-hover:text-[#D4AF37] transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </FadeIn>

      {showCreateModal && (
        <CreateGymModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchData(); }}
        />
      )}

      {addMemberGym && (
        <AddMemberModal
          gymId={addMemberGym.id}
          gymName={addMemberGym.name}
          onClose={() => setAddMemberGym(null)}
          onCreated={() => { setAddMemberGym(null); fetchData(); }}
        />
      )}
    </div>
  );
}

function CreateGymModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tier, setTier] = useState('starter');
  const [isFounding, setIsFounding] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const autoSlug = (val) => {
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) { setError('Name and slug are required'); return; }
    setSaving(true);
    setError('');
    try {
      let ownerUserId = null;
      if (ownerEmail.trim()) {
        const { data: ownerProfile } = await supabase
          .from('profiles').select('id').ilike('full_name', ownerEmail.trim()).maybeSingle();
        if (!ownerProfile) {
          const { data: byEmail } = await supabase
            .from('profiles').select('id').eq('email', ownerEmail.trim().toLowerCase()).maybeSingle();
          if (byEmail) ownerUserId = byEmail.id;
        } else {
          ownerUserId = ownerProfile.id;
        }
      }
      const { error: insertErr } = await supabase.from('gyms').insert({
        name: name.trim(), slug: slug.trim(), subscription_tier: tier, plan_type: tier,
        is_founding: isFounding, owner_user_id: ownerUserId, is_active: true,
      });
      if (insertErr) { setError(insertErr.message); setSaving(false); return; }
      onCreated();
    } catch (err) {
      setError(err.message || 'Failed to create gym');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-xl w-full max-w-md p-6 animate-fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-bold text-[#E5E7EB]">Create Gym</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Gym Name</label>
            <input value={name} onChange={(e) => autoSlug(e.target.value)} placeholder="Iron Forge Fitness"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Slug</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="iron-forge-fitness"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Plan Type</label>
            <div className="grid grid-cols-3 gap-1.5 bg-[#111827] border border-white/6 rounded-lg p-1">
              {['starter', 'pro', 'lifetime'].map((t) => (
                <button key={t} onClick={() => setTier(t)}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors capitalize ${
                    tier === t ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}>{t}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isFounding} onChange={(e) => setIsFounding(e.target.checked)} className="accent-[#D4AF37] w-4 h-4" />
            <span className="text-[12px] text-[#9CA3AF]">Founding gym (price locked for life)</span>
          </label>
          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Owner Email (optional)</label>
            <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
          </div>
          {error && <p className="text-[12px] text-[#EF4444]">{error}</p>}
          <button onClick={handleCreate} disabled={saving}
            className="w-full bg-[#D4AF37] text-black hover:bg-[#E6C766] disabled:opacity-50 rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center justify-center gap-2 transition-colors">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Creating...' : 'Create Gym'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMemberModal({ gymId, gymName, onClose, onCreated }) {
  const [form, setForm] = useState({ email: '', password: '', fullName: '', username: '', role: 'member' });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email.trim() || !form.password || !form.fullName.trim() || !form.username.trim()) { setError('All fields are required'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setSaving(true);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_create_gym_member', {
        p_email: form.email.trim(), p_password: form.password, p_full_name: form.fullName.trim(),
        p_username: form.username.trim().toLowerCase(), p_gym_id: gymId, p_role: form.role,
      });
      if (rpcErr) { setError(rpcErr.message || 'Failed to create member'); setSaving(false); return; }
      onCreated();
    } catch (err) {
      setError(err.message || 'Failed to create member');
      setSaving(false);
    }
  };

  const autoUsername = (val) => {
    setForm(prev => ({
      ...prev, fullName: val,
      username: prev.username || val.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4 animate-fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB] flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-[#D4AF37]" />Add Member
          </h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[12px] text-[#9CA3AF] mb-4">Adding to <span className="text-[#E5E7EB] font-medium">{gymName}</span></p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Full Name *</label>
            <input type="text" value={form.fullName} onChange={e => autoUsername(e.target.value)} placeholder="John Smith"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Username *</label>
            <input type="text" value={form.username} onChange={e => setForm(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))} placeholder="johnsmith"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="john@example.com"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Temporary Password *</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} placeholder="Min. 6 characters"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 pr-9 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required minLength={6} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#9CA3AF] transition-colors">
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Role *</label>
            <div className="grid grid-cols-3 gap-1.5 bg-[#111827] border border-white/6 rounded-lg p-1">
              {[{ value: 'member', label: 'Member' }, { value: 'trainer', label: 'Trainer' }, { value: 'admin', label: 'Admin' }].map(r => (
                <button key={r.value} type="button" onClick={() => setForm(prev => ({ ...prev, role: r.value }))}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                    form.role === r.value
                      ? r.value === 'admin' ? 'bg-indigo-500/15 text-indigo-400' : r.value === 'trainer' ? 'bg-purple-500/15 text-purple-400' : 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}>{r.label}</button>
              ))}
            </div>
          </div>
          {error && <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Creating...' : 'Create Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
