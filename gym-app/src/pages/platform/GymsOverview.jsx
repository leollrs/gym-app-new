import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, Building2, Users, Activity, Dumbbell,
  X, ChevronRight, Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays } from 'date-fns';

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

const StatCard = ({ label, value, icon: Icon, borderColor, delay = 0 }) => {
  const animated = useCountUp(value, 900);
  return (
    <FadeIn delay={delay}>
      <div
        className="bg-[#0F172A] border border-white/6 rounded-xl p-4 border-l-2 hover:border-white/10 hover:bg-[#111827] transition-all duration-300 group"
        style={{ borderLeftColor: borderColor }}
      >
        <div className="flex items-center justify-between mb-2">
          <Icon size={16} className="text-[#6B7280] group-hover:text-[#9CA3AF] transition-colors" />
        </div>
        <p className="text-[24px] font-bold text-[#E5E7EB] leading-none tabular-nums tracking-tight">
          {animated.toLocaleString()}
        </p>
        <p className="text-[12px] text-[#9CA3AF] mt-1 group-hover:text-[#D1D5DB] transition-colors">{label}</p>
      </div>
    </FadeIn>
  );
};

const PLAN_COLORS = {
  starter:    { bg: 'bg-[#3B82F6]/15', text: 'text-[#60A5FA]', label: 'Starter' },
  pro:        { bg: 'bg-[#D4AF37]/15', text: 'text-[#D4AF37]', label: 'Pro' },
  lifetime:   { bg: 'bg-[#A855F7]/15', text: 'text-[#C084FC]', label: 'Lifetime' },
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
        <span className="text-[10px] text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full font-medium">★ Founding</span>
      )}
    </span>
  );
};

const FILTERS = ['all', 'active', 'inactive'];

export default function GymsOverview() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [gyms, setGyms] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [ownerProfiles, setOwnerProfiles] = useState({});
  const [totalSessions, setTotalSessions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [gymsRes, profilesRes, sessionsRes] = await Promise.all([
        supabase.from('gyms').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('gym_id'),
        supabase
          .from('workout_sessions')
          .select('gym_id')
          .gte('started_at', subDays(new Date(), 30).toISOString()),
      ]);

      const gymsList = gymsRes.data || [];
      setGyms(gymsList);

      const counts = {};
      (profilesRes.data || []).forEach((p) => {
        counts[p.gym_id] = (counts[p.gym_id] || 0) + 1;
      });
      setMemberCounts(counts);
      setTotalSessions((sessionsRes.data || []).length);

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
      console.error('Failed to fetch gyms data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = gyms;
    if (filter === 'active') list = list.filter((g) => g.is_active);
    if (filter === 'inactive') list = list.filter((g) => !g.is_active);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) =>
        g.name?.toLowerCase().includes(q) || g.slug?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [gyms, filter, search]);

  const totalMembers = useMemo(
    () => Object.values(memberCounts).reduce((a, b) => a + b, 0),
    [memberCounts]
  );
  const activeGyms = useMemo(() => gyms.filter((g) => g.is_active).length, [gyms]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-[#E5E7EB]">Gyms</h1>
            <span className="bg-[#D4AF37]/15 text-[#D4AF37] text-[12px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums">
              {gyms.length}
            </span>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} />
            Create Gym
          </button>
        </div>
      </FadeIn>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Gyms" value={gyms.length} icon={Building2} borderColor="#D4AF37" delay={50} />
        <StatCard label="Total Members" value={totalMembers} icon={Users} borderColor="#3B82F6" delay={100} />
        <StatCard label="Active Gyms" value={activeGyms} icon={Activity} borderColor="#10B981" delay={150} />
        <StatCard label="Sessions (30d)" value={totalSessions} icon={Dumbbell} borderColor="#A855F7" delay={200} />
      </div>

      <FadeIn delay={250}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or slug..."
              className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>
          <div className="flex gap-1.5 bg-[#0F172A] border border-white/6 rounded-lg p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors capitalize ${
                  filter === f
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={300}>
        {filtered.length === 0 ? (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-12 text-center">
            <Building2 size={32} className="mx-auto text-[#4B5563] mb-3" />
            <p className="text-[14px] text-[#6B7280]">No gyms found</p>
          </div>
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_120px_100px_80px_110px_140px_32px] gap-4 px-4 py-3 border-b border-white/6 text-[11px] text-[#6B7280] uppercase tracking-wider font-medium">
              <span>Gym</span>
              <span>Tier</span>
              <span className="text-right">Members</span>
              <span className="text-center">Status</span>
              <span>Created</span>
              <span>Owner</span>
              <span />
            </div>
            {filtered.map((gym, i) => (
              <button
                key={gym.id}
                onClick={() => navigate(`/platform/gym/${gym.id}`)}
                className="w-full text-left grid grid-cols-1 md:grid-cols-[1fr_120px_100px_80px_110px_140px_32px] gap-2 md:gap-4 px-4 py-3.5 border-b border-white/6 last:border-b-0 hover:bg-[#111827] transition-colors group"
              >
                <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-0 min-w-0">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate group-hover:text-white transition-colors">
                      {gym.name}
                    </p>
                    <p className="text-[11px] text-[#6B7280] truncate">{gym.slug}</p>
                  </div>
                </div>

                <div className="flex items-center md:hidden gap-2 flex-wrap">
                  <TierBadge tier={gym.plan_type || gym.subscription_tier} isFounding={gym.is_founding} />
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    gym.is_active ? 'bg-[#10B981]/15 text-[#10B981]' : 'bg-[#EF4444]/15 text-[#EF4444]'
                  }`}>
                    {gym.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-[11px] text-[#6B7280]">
                    {memberCounts[gym.id] || 0} members
                  </span>
                </div>

                <div className="hidden md:flex items-center">
                  <TierBadge tier={gym.plan_type || gym.subscription_tier} isFounding={gym.is_founding} />
                </div>

                <p className="hidden md:flex items-center justify-end text-[13px] text-[#9CA3AF] tabular-nums">
                  {(memberCounts[gym.id] || 0).toLocaleString()}
                </p>

                <div className="hidden md:flex items-center justify-center">
                  <span className={`w-2 h-2 rounded-full ${gym.is_active ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
                </div>

                <p className="hidden md:flex items-center text-[12px] text-[#6B7280]">
                  {format(new Date(gym.created_at), 'MMM d, yyyy')}
                </p>

                <p className="hidden md:flex items-center text-[12px] text-[#9CA3AF] truncate">
                  {ownerProfiles[gym.owner_user_id] || '—'}
                </p>

                <div className="hidden md:flex items-center justify-end">
                  <ChevronRight size={14} className="text-[#4B5563] group-hover:text-[#D4AF37] transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}
      </FadeIn>

      {showCreateModal && (
        <CreateGymModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchData(); }}
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
    if (!name.trim() || !slug.trim()) {
      setError('Name and slug are required');
      return;
    }
    setSaving(true);
    setError('');

    try {
      let ownerUserId = null;
      if (ownerEmail.trim()) {
        const { data: ownerProfile } = await supabase
          .from('profiles')
          .select('id')
          .ilike('full_name', ownerEmail.trim())
          .maybeSingle();

        // fallback: search by auth email via profiles
        if (!ownerProfile) {
          const { data: byEmail } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', ownerEmail.trim().toLowerCase())
            .maybeSingle();
          if (byEmail) ownerUserId = byEmail.id;
        } else {
          ownerUserId = ownerProfile.id;
        }
      }

      const { error: insertErr } = await supabase.from('gyms').insert({
        name: name.trim(),
        slug: slug.trim(),
        subscription_tier: tier,
        plan_type: tier,
        is_founding: isFounding,
        owner_user_id: ownerUserId,
        is_active: true,
      });

      if (insertErr) {
        setError(insertErr.message);
        setSaving(false);
        return;
      }

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
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Gym Name</label>
            <input
              value={name}
              onChange={(e) => autoSlug(e.target.value)}
              placeholder="Iron Forge Fitness"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Slug</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="iron-forge-fitness"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Plan Type</label>
            <div className="grid grid-cols-3 gap-1.5 bg-[#111827] border border-white/6 rounded-lg p-1">
              {['starter', 'pro', 'lifetime'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors capitalize ${
                    tier === t
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isFounding}
                onChange={(e) => setIsFounding(e.target.checked)}
                className="accent-[#D4AF37] w-4 h-4"
              />
              <span className="text-[12px] text-[#9CA3AF]">Founding gym (price locked for life)</span>
            </label>
          </div>

          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">Owner Email (optional)</label>
            <input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@example.com"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {error && (
            <p className="text-[12px] text-[#EF4444]">{error}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={saving}
            className="w-full bg-[#D4AF37] text-black hover:bg-[#E6C766] disabled:opacity-50 rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Creating...' : 'Create Gym'}
          </button>
        </div>
      </div>
    </div>
  );
}
