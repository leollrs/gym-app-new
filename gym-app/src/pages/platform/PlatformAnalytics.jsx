import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import {
  Building2, Users, Dumbbell, TrendingUp, TrendingDown,
  UserPlus, Activity, ArrowUpDown, ChevronRight, AlertTriangle,
  DollarSign, UserCheck, Signal,
} from 'lucide-react';
import { format, subDays, subWeeks, subMonths, startOfWeek, startOfMonth, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getMonthlyPrice, getPricingLabel, getMemberBracketLabel } from '../../lib/pricing';

import ChartTooltip from '../../components/ChartTooltip';

// ── Fade-in wrapper ──────────────────────────────────────────
const FadeIn = ({ delay = 0, children, className = '' }) => (
  <div
    className={`animate-fade-in-up ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
  >
    {children}
  </div>
);

// ── Stat Card ────────────────────────────────────────────────
const StatCard = ({ value, label, icon: Icon, color = '#6366F1', delay = 0 }) => (
  <FadeIn delay={delay}>
    <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 border-l-2 overflow-hidden" style={{ borderLeftColor: color }}>
      <div className="flex items-center justify-between mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <p className="text-[24px] font-bold text-[#E5E7EB] leading-none tabular-nums truncate">{value}</p>
      <p className="text-[11px] text-[#9CA3AF] mt-1 truncate">{label}</p>
    </div>
  </FadeIn>
);

// ── Color helpers ────────────────────────────────────────────
const pctColor = (val, good, warn) => {
  if (val >= good) return 'text-emerald-400';
  if (val >= warn) return 'text-amber-400';
  return 'text-red-400';
};

const pctBg = (val, good, warn) => {
  if (val >= good) return 'bg-emerald-500/15';
  if (val >= warn) return 'bg-amber-500/15';
  return 'bg-red-500/15';
};

// ── Loading Spinner ──────────────────────────────────────────
const Spinner = () => (
  <div className="flex items-center justify-center py-32">
    <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
  </div>
);

// ── Main Component ───────────────────────────────────────────
export default function PlatformAnalytics() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [gyms, setGyms] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [churnScores, setChurnScores] = useState([]);
  const [growthData, setGrowthData] = useState([]);

  // Sort state for gym table
  const [sortKey, setSortKey] = useState('members');
  const [sortDir, setSortDir] = useState('desc');

  // Top gyms toggle
  const [topMetric, setTopMetric] = useState('members');

  useEffect(() => {
    document.title = 'Platform Analytics | TuGymPR';
  }, []);

  // ── Fetch all data ─────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 30).toISOString();
      const ninetyDaysAgo = subDays(now, 90).toISOString();

      const [gymRes, profileRes, sessionRes, checkInRes, churnRes, recentProfileRes] = await Promise.all([
        supabase.from('gyms').select('id, name, slug, is_active, created_at, subscription_tier, monthly_price, plan_type, is_founding'),
        supabase.from('profiles').select('id, gym_id, role, created_at, last_active_at, membership_status, is_onboarded'),
        supabase.from('workout_sessions').select('id, gym_id, profile_id, status, started_at').eq('status', 'completed').gte('started_at', thirtyDaysAgo),
        supabase.from('check_ins').select('id, gym_id, profile_id, checked_in_at').gte('checked_in_at', thirtyDaysAgo),
        supabase.from('churn_risk_scores').select('id, gym_id, profile_id, score, risk_tier, key_signals'),
        supabase.from('profiles').select('id, gym_id, created_at').gte('created_at', ninetyDaysAgo),
      ]);

      setGyms(gymRes.data || []);
      setProfiles(profileRes.data || []);
      setSessions(sessionRes.data || []);
      setCheckIns(checkInRes.data || []);
      setChurnScores(churnRes.data || []);

      // Build weekly growth data for last 90 days
      const recentProfiles = recentProfileRes.data || [];
      const weeks = [];
      for (let i = 12; i >= 0; i--) {
        const weekStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
        const weekEnd = startOfWeek(subWeeks(now, i - 1), { weekStartsOn: 1 });
        const count = recentProfiles.filter(p => {
          const d = new Date(p.created_at);
          return d >= weekStart && d < weekEnd;
        }).length;
        weeks.push({
          week: format(weekStart, 'MMM d'),
          newMembers: count,
        });
      }
      setGrowthData(weeks);
      setLoading(false);
    };

    fetchAll();
  }, []);

  // ── Derived stats ──────────────────────────────────────────
  const totalGyms = gyms.length;
  const totalMembers = profiles.length;
  const totalSessions = sessions.length;
  const newMembers30d = useMemo(() => {
    const cutoff = subDays(new Date(), 30).toISOString();
    return profiles.filter(p => p.created_at >= cutoff).length;
  }, [profiles]);

  const avgSessionsPerMember = useMemo(() => {
    if (!totalMembers) return 0;
    return (totalSessions / totalMembers).toFixed(1);
  }, [totalSessions, totalMembers]);

  // Members who checked in within last 30d
  const activeMembers = useMemo(() => {
    const activeIds = new Set(checkIns.map(c => c.profile_id));
    return activeIds.size;
  }, [checkIns]);

  const retentionRate = useMemo(() => {
    if (!totalMembers) return 0;
    return ((activeMembers / totalMembers) * 100).toFixed(1);
  }, [activeMembers, totalMembers]);

  // ── Revenue metrics (dynamic pricing based on tier + member count) ──
  const gymMemberCounts = useMemo(() => {
    const counts = {};
    profiles.forEach(p => {
      counts[p.gym_id] = (counts[p.gym_id] || 0) + 1;
    });
    return counts;
  }, [profiles]);

  const getGymPrice = (g) => {
    const memberCount = gymMemberCounts[g.id] || 0;
    return getMonthlyPrice({
      planType: g.plan_type || g.subscription_tier || 'starter',
      memberCount,
      isFounding: g.is_founding ?? false,
      monthlyPriceOverride: parseFloat(g.monthly_price) || 0,
    });
  };

  const mrr = useMemo(() => {
    return gyms.filter(g => g.is_active).reduce((sum, g) => sum + getGymPrice(g), 0);
  }, [gyms, gymMemberCounts]);

  const revenueByGym = useMemo(() => {
    return gyms
      .map(g => {
        const memberCount = gymMemberCounts[g.id] || 0;
        const price = getGymPrice(g);
        return {
          id: g.id,
          name: g.name,
          planType: g.plan_type || g.subscription_tier || 'starter',
          isFounding: g.is_founding ?? false,
          pricingLabel: getPricingLabel({ planType: g.plan_type || g.subscription_tier, isFounding: g.is_founding }),
          bracketLabel: getMemberBracketLabel(memberCount),
          memberCount,
          price,
          isActive: g.is_active,
        };
      })
      .sort((a, b) => b.price - a.price);
  }, [gyms, gymMemberCounts]);

  const monthlyIncomeChart = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const income = gyms
        .filter(g => new Date(g.created_at) <= monthStart && g.is_active)
        .reduce((sum, g) => sum + getGymPrice(g), 0);
      months.push({ month: format(monthStart, 'MMM'), income });
    }
    return months;
  }, [gyms, gymMemberCounts]);

  const arr = mrr * 12;
  const payingGyms = gyms.filter(g => g.is_active && getGymPrice(g) > 0).length;
  const avgRevenuePerGym = payingGyms > 0 ? (mrr / payingGyms) : 0;

  // ── Per-gym breakdown ──────────────────────────────────────
  const gymBreakdown = useMemo(() => {
    return gyms.map(gym => {
      const gymProfiles = profiles.filter(p => p.gym_id === gym.id);
      const gymSessions = sessions.filter(s => s.gym_id === gym.id);
      const gymCheckIns = checkIns.filter(c => c.gym_id === gym.id);
      const gymChurn = churnScores.filter(c => c.gym_id === gym.id);

      const memberCount = gymProfiles.length;
      const activeIds = new Set(gymCheckIns.map(c => c.profile_id));
      const activeRate = memberCount ? ((activeIds.size / memberCount) * 100) : 0;
      const sessionCount = gymSessions.length;
      const retention = memberCount ? ((activeIds.size / memberCount) * 100) : 0;
      const highChurn = gymChurn.filter(c => c.risk_tier === 'critical' || c.risk_tier === 'high').length;
      const churnPct = memberCount ? ((highChurn / memberCount) * 100) : 0;

      // Determine if "struggling"
      const isStruggling = activeRate < 30 || churnPct > 20;

      return {
        id: gym.id,
        name: gym.name,
        slug: gym.slug,
        memberCount,
        activeRate: +activeRate.toFixed(1),
        sessionCount,
        retention: +retention.toFixed(1),
        highChurn,
        churnPct: +churnPct.toFixed(1),
        isStruggling,
      };
    });
  }, [gyms, profiles, sessions, checkIns, churnScores]);

  // ── Sorted gym table ───────────────────────────────────────
  const sortedGyms = useMemo(() => {
    const sorted = [...gymBreakdown].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [gymBreakdown, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // ── Top 5 gyms by selected metric ─────────────────────────
  const topGyms = useMemo(() => {
    const key = topMetric === 'members' ? 'memberCount' : topMetric === 'activity' ? 'sessionCount' : 'retention';
    return [...gymBreakdown].sort((a, b) => b[key] - a[key]).slice(0, 5);
  }, [gymBreakdown, topMetric]);

  const topGymsBarKey = topMetric === 'members' ? 'memberCount' : topMetric === 'activity' ? 'sessionCount' : 'retention';

  // ── Struggling gyms ────────────────────────────────────────
  const strugglingGyms = useMemo(() => {
    return gymBreakdown.filter(g => g.isStruggling).sort((a, b) => a.activeRate - b.activeRate);
  }, [gymBreakdown]);

  // ── Cross-Gym Churn Analysis ────────────────────────────────
  const crossGymChurn = useMemo(() => {
    const atRisk = churnScores.filter(c => c.risk_tier === 'critical' || c.risk_tier === 'high');
    const totalAtRisk = atRisk.length;
    const platformAvgScore = churnScores.length
      ? +(churnScores.reduce((s, c) => s + (c.score || 0), 0) / churnScores.length).toFixed(1)
      : 0;

    // Per-gym avg churn scores
    const gymScoreMap = {};
    churnScores.forEach(c => {
      if (!gymScoreMap[c.gym_id]) gymScoreMap[c.gym_id] = { sum: 0, count: 0 };
      gymScoreMap[c.gym_id].sum += c.score || 0;
      gymScoreMap[c.gym_id].count += 1;
    });

    const gymNameMap = {};
    gyms.forEach(g => { gymNameMap[g.id] = g.name; });

    const perGymChurn = Object.entries(gymScoreMap)
      .map(([gymId, { sum, count }]) => ({
        gymId,
        name: gymNameMap[gymId] || 'Unknown',
        avgScore: +(sum / count).toFixed(1),
        count,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    const gymsRisingChurn = perGymChurn.filter(g => g.avgScore > 50).length;

    // Aggregate key_signals
    const signalCounts = {};
    const signalGymCounts = {};
    atRisk.forEach(c => {
      const signals = Array.isArray(c.key_signals) ? c.key_signals : [];
      const gymName = gymNameMap[c.gym_id] || 'Unknown';
      signals.forEach(sig => {
        const label = typeof sig === 'string' ? sig : String(sig);
        if (!label) return;
        signalCounts[label] = (signalCounts[label] || 0) + 1;
        if (!signalGymCounts[label]) signalGymCounts[label] = {};
        signalGymCounts[label][gymName] = (signalGymCounts[label][gymName] || 0) + 1;
      });
    });

    const topSignals = Object.entries(signalCounts)
      .map(([signal, count]) => {
        const gymEntries = Object.entries(signalGymCounts[signal] || {});
        const mostAffected = gymEntries.sort((a, b) => b[1] - a[1])[0];
        return {
          signal,
          count,
          pct: totalAtRisk ? +((count / totalAtRisk) * 100).toFixed(1) : 0,
          mostAffectedGym: mostAffected ? mostAffected[0] : '—',
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { totalAtRisk, platformAvgScore, gymsRisingChurn, perGymChurn, topSignals };
  }, [churnScores, gyms]);

  // ── Onboarding Effectiveness ──────────────────────────────
  const onboardingData = useMemo(() => {
    const gymNameMap = {};
    gyms.forEach(g => { gymNameMap[g.id] = g.name; });

    const gymOnboardingMap = {};
    profiles.forEach(p => {
      if (p.role !== 'member') return;
      if (!gymOnboardingMap[p.gym_id]) gymOnboardingMap[p.gym_id] = { total: 0, onboarded: 0 };
      gymOnboardingMap[p.gym_id].total += 1;
      if (p.is_onboarded) gymOnboardingMap[p.gym_id].onboarded += 1;
    });

    const perGym = Object.entries(gymOnboardingMap)
      .map(([gymId, { total, onboarded }]) => ({
        gymId,
        name: gymNameMap[gymId] || 'Unknown',
        total,
        onboarded,
        rate: total ? +((onboarded / total) * 100).toFixed(1) : 0,
        notOnboarded: total - onboarded,
      }))
      .sort((a, b) => b.rate - a.rate);

    const totalMembers = perGym.reduce((s, g) => s + g.total, 0);
    const totalOnboarded = perGym.reduce((s, g) => s + g.onboarded, 0);
    const platformAvgRate = totalMembers ? +((totalOnboarded / totalMembers) * 100).toFixed(1) : 0;
    const best = perGym[0] || null;
    const worst = perGym[perGym.length - 1] || null;
    const gapsGyms = perGym.filter(g => g.rate < 60);

    return { perGym, platformAvgRate, best, worst, gapsGyms };
  }, [profiles, gyms]);

  // ── Render ─────────────────────────────────────────────────
  if (loading) return <Spinner />;

  const SortHeader = ({ label, field, className = '' }) => (
    <th
      className={`text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none hover:text-[#9CA3AF] transition-colors ${className}`}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className="w-3 h-3 opacity-40" />
        {sortKey === field && (
          <span className="text-[#D4AF37] text-[9px]">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
        )}
      </span>
    </th>
  );

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-0.5 truncate">Analytics</h1>
        <p className="text-[12px] text-[#6B7280] mb-6">Growth, retention, and revenue</p>
      </FadeIn>

      {/* ── Top Stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard value={totalGyms} label="Total Gyms" icon={Building2} color="#6366F1" delay={0} />
        <StatCard value={totalMembers.toLocaleString()} label="Total Members" icon={Users} color="var(--color-accent)" delay={50} />
        <StatCard value={totalSessions.toLocaleString()} label="Sessions (30d)" icon={Dumbbell} color="#3B82F6" delay={100} />
        <StatCard value={`${retentionRate}%`} label="Retention Rate" icon={TrendingUp} color="#10B981" delay={150} />
        <StatCard value={newMembers30d.toLocaleString()} label="New Members (30d)" icon={UserPlus} color="#8B5CF6" delay={200} />
        <StatCard value={avgSessionsPerMember} label="Avg Sessions / Member" icon={Activity} color="#F59E0B" delay={250} />
      </div>

      {/* ── Growth Chart ────────────────────────────────────── */}
      <FadeIn delay={100}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">Member Growth (Last 90 Days)</h2>
          {growthData.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] py-12 text-center">No growth data available</p>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growthData}>
                  <defs>
                    <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="week" tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-accent-glow)' }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-muted)' }} />
                  <Area
                    type="monotone"
                    dataKey="newMembers"
                    name="New Members"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    fill="url(#goldGrad)"
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </FadeIn>

      {/* ── Revenue Stats ─────────────────────────────────────── */}
      <FadeIn delay={120}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard value={`$${mrr.toLocaleString()}`} label="Monthly Revenue (MRR)" icon={DollarSign} color="#10B981" delay={0} />
          <StatCard value={`$${arr.toLocaleString()}`} label="Annual Run Rate (ARR)" icon={TrendingUp} color="#3B82F6" delay={50} />
          <StatCard value={payingGyms} label="Paying Gyms" icon={Building2} color="#8B5CF6" delay={100} />
          <StatCard value={`$${avgRevenuePerGym.toFixed(0)}`} label="Avg Revenue / Gym" icon={Activity} color="#F59E0B" delay={150} />
        </div>
      </FadeIn>

      {/* ── Monthly Income Chart + Per-Gym Revenue ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 mb-6">
        <FadeIn delay={140}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
            <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">Monthly Income (Last 12 Months)</h2>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyIncomeChart}>
                  <defs>
                    <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="month" tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    content={<ChartTooltip formatter={(v) => `$${v.toLocaleString()}`} />}
                    cursor={{ fill: 'var(--color-accent-glow)' }}
                  />
                  <Bar dataKey="income" fill="url(#incomeGrad)" radius={[4, 4, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={160}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
            <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-3">Revenue by Gym</h2>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {revenueByGym.map(gym => (
                <div
                  key={gym.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] cursor-pointer transition-colors"
                  onClick={() => navigate(`/platform/gym/${gym.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{gym.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        gym.planType === 'lifetime' ? 'bg-[#D4AF37]/15 text-[#D4AF37]' :
                        gym.planType === 'pro' ? 'bg-indigo-500/15 text-indigo-400' :
                        'bg-blue-500/15 text-blue-400'
                      }`}>
                        {gym.pricingLabel}
                      </span>
                      <span className="text-[10px] text-[#4B5563]">{gym.bracketLabel} members</span>
                      {gym.isFounding && (
                        <span className="text-[10px] text-[#D4AF37]">★</span>
                      )}
                      {!gym.isActive && (
                        <span className="text-[10px] text-red-400">inactive</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[15px] font-bold text-[#E5E7EB] tabular-nums">
                    ${gym.price}<span className="text-[10px] text-[#6B7280] font-normal">/mo</span>
                  </p>
                </div>
              ))}
              {revenueByGym.length === 0 && (
                <p className="text-[13px] text-[#6B7280] py-8 text-center">No gyms yet</p>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-white/6 flex items-center justify-between px-3">
              <span className="text-[12px] text-[#9CA3AF]">Total MRR</span>
              <span className="text-[16px] font-bold text-emerald-400 tabular-nums">${mrr.toLocaleString()}</span>
            </div>
          </div>
        </FadeIn>
      </div>

      {/* ── Two-column: Top Gyms + Struggling Gyms ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top Gyms */}
        <FadeIn delay={150}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#E5E7EB]">Top Gyms</h2>
              <div className="flex gap-1">
                {['members', 'activity', 'retention'].map(m => (
                  <button
                    key={m}
                    onClick={() => setTopMetric(m)}
                    className={`text-[11px] px-2.5 py-1 rounded-full transition-colors capitalize ${
                      topMetric === m
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] font-semibold'
                        : 'text-[#6B7280] hover:text-[#9CA3AF]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {topGyms.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-8 text-center">No gym data available</p>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topGyms} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={100}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-accent-glow)' }} />
                    <Bar
                      dataKey={topGymsBarKey}
                      name={topMetric === 'members' ? 'Members' : topMetric === 'activity' ? 'Sessions' : 'Retention %'}
                      fill="var(--color-accent)"
                      radius={[0, 4, 4, 0]}
                      barSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </FadeIn>

        {/* Struggling Gyms */}
        <FadeIn delay={200}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h2 className="text-[15px] font-semibold text-[#E5E7EB]">Struggling Gyms</h2>
            </div>
            {strugglingGyms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-[13px] text-[#9CA3AF]">All gyms are performing well</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[240px] overflow-y-auto">
                {strugglingGyms.map(gym => (
                  <div
                    key={gym.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/10 cursor-pointer hover:bg-red-500/8 transition-colors"
                    onClick={() => navigate(`/platform/gym/${gym.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{gym.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {gym.activeRate < 30 && (
                          <span className="text-[11px] text-red-400">
                            <TrendingDown className="w-3 h-3 inline mr-0.5" />
                            {gym.activeRate}% active
                          </span>
                        )}
                        {gym.churnPct > 20 && (
                          <span className="text-[11px] text-amber-400">
                            <AlertTriangle className="w-3 h-3 inline mr-0.5" />
                            {gym.churnPct}% high churn
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#4B5563] flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </FadeIn>
      </div>

      {/* ── Gym Comparison Table ─────────────────────────────── */}
      <FadeIn delay={250}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">Gym Comparison</h2>
          {sortedGyms.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] py-12 text-center">No gym data available</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/6">
                    <SortHeader label="Gym" field="name" />
                    <SortHeader label="Members" field="memberCount" />
                    <SortHeader label="Active %" field="activeRate" />
                    <SortHeader label="Sessions (30d)" field="sessionCount" />
                    <SortHeader label="Retention" field="retention" />
                    <SortHeader label="Churn Risk" field="highChurn" />
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {sortedGyms.map((gym, i) => (
                    <tr
                      key={gym.id}
                      className="border-b border-white/4 last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => navigate(`/platform/gym/${gym.id}`)}
                    >
                      <td className="px-3 py-3">
                        <span className="text-[13px] font-medium text-[#E5E7EB]">{gym.name}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-[13px] text-[#E5E7EB] tabular-nums">{gym.memberCount.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${pctBg(gym.activeRate, 50, 30)} ${pctColor(gym.activeRate, 50, 30)}`}>
                          {gym.activeRate}%
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-[13px] text-[#E5E7EB] tabular-nums">{gym.sessionCount.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${pctBg(gym.retention, 60, 40)} ${pctColor(gym.retention, 60, 40)}`}>
                          {gym.retention}%
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {gym.highChurn > 0 ? (
                          <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${pctBg(100 - gym.churnPct, 80, 60)} ${pctColor(100 - gym.churnPct, 80, 60)}`}>
                            {gym.highChurn} ({gym.churnPct}%)
                          </span>
                        ) : (
                          <span className="text-[12px] text-emerald-400 font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15">None</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <ChevronRight className="w-4 h-4 text-[#4B5563]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </FadeIn>

      {/* ── Cross-Gym Churn Patterns ─────────────────────────── */}
      <FadeIn delay={300}>
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-red-400" />
            <h2 className="text-[17px] font-bold text-[#E5E7EB]">{t('platform.analytics.crossGymChurn', 'Cross-Gym Churn Patterns')}</h2>
          </div>

          {/* Churn summary strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <StatCard
              value={crossGymChurn.totalAtRisk.toLocaleString()}
              label={t('platform.analytics.totalAtRisk', 'Total At-Risk Members')}
              icon={AlertTriangle}
              color="#EF4444"
              delay={310}
            />
            <StatCard
              value={crossGymChurn.platformAvgScore}
              label={t('platform.analytics.platformAvgChurn', 'Platform Avg Churn Score')}
              icon={Activity}
              color="#F59E0B"
              delay={320}
            />
            <StatCard
              value={crossGymChurn.gymsRisingChurn}
              label={t('platform.analytics.gymsRisingChurn', 'Gyms with Rising Churn')}
              icon={TrendingUp}
              color="#F97316"
              delay={330}
            />
          </div>

          {/* Churn by Gym Bar Chart */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
            <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">{t('platform.analytics.avgChurnByGym', 'Avg Churn Score by Gym')}</h3>
            {crossGymChurn.perGymChurn.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.analytics.noChurnData', 'No churn data available')}</p>
            ) : (
              <div style={{ height: Math.max(200, crossGymChurn.perGymChurn.length * 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={crossGymChurn.perGymChurn} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={120}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-accent-glow)' }} />
                    <Bar
                      dataKey="avgScore"
                      name={t('platform.analytics.avgChurnScore', 'Avg Churn Score')}
                      radius={[0, 4, 4, 0]}
                      barSize={18}
                      shape={(props) => {
                        const { x, y, width, height, payload } = props;
                        const score = payload.avgScore;
                        const fill = score > 60 ? '#EF4444' : score > 40 ? '#F97316' : score > 20 ? '#F59E0B' : '#10B981';
                        return <rect x={x} y={y} width={width} height={height} fill={fill} rx={4} />;
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Common Churn Signals Table */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">{t('platform.analytics.commonChurnSignals', 'Common Churn Signals')}</h3>
            {crossGymChurn.topSignals.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.analytics.noChurnData', 'No churn data available')}</p>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-white/6">
                      <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">{t('platform.analytics.signal', 'Signal')}</th>
                      <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">{t('platform.analytics.occurrences', 'Occurrences')}</th>
                      <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">{t('platform.analytics.pctAtRisk', '% of At-Risk')}</th>
                      <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">{t('platform.analytics.mostAffectedGym', 'Most Affected Gym')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crossGymChurn.topSignals.map((sig, i) => (
                      <tr key={i} className="border-b border-white/4 last:border-0">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Signal className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                            <span className="text-[13px] text-[#E5E7EB]">{sig.signal}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[13px] text-[#E5E7EB] tabular-nums">{sig.count.toLocaleString()}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${
                            sig.pct >= 50 ? 'bg-red-500/15 text-red-400' :
                            sig.pct >= 25 ? 'bg-amber-500/15 text-amber-400' :
                            'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {sig.pct}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[13px] text-[#9CA3AF]">{sig.mostAffectedGym}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </FadeIn>

      {/* ── Onboarding Effectiveness ─────────────────────────── */}
      <FadeIn delay={350}>
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <UserCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-[17px] font-bold text-[#E5E7EB]">{t('platform.analytics.onboardingEffectiveness', 'Onboarding Effectiveness by Gym')}</h2>
          </div>

          {/* Onboarding summary strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <StatCard
              value={`${onboardingData.platformAvgRate}%`}
              label={t('platform.analytics.platformAvgOnboarding', 'Platform Avg Onboarding Rate')}
              icon={UserCheck}
              color="#10B981"
              delay={360}
            />
            <StatCard
              value={onboardingData.best ? `${onboardingData.best.rate}%` : '—'}
              label={onboardingData.best ? `${t('platform.analytics.bestPerforming', 'Best Performing Gym')}: ${onboardingData.best.name}` : t('platform.analytics.bestPerforming', 'Best Performing Gym')}
              icon={TrendingUp}
              color="#6366F1"
              delay={370}
            />
            <StatCard
              value={onboardingData.worst ? `${onboardingData.worst.rate}%` : '—'}
              label={onboardingData.worst ? `${t('platform.analytics.lowestPerforming', 'Lowest Performing Gym')}: ${onboardingData.worst.name}` : t('platform.analytics.lowestPerforming', 'Lowest Performing Gym')}
              icon={TrendingDown}
              color="#EF4444"
              delay={380}
            />
          </div>

          {/* Onboarding Comparison Bar Chart */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
            <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">{t('platform.analytics.onboardingRate', 'Onboarding Rate')}</h3>
            {onboardingData.perGym.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.analytics.noOnboardingData', 'No onboarding data available')}</p>
            ) : (
              <div style={{ height: Math.max(200, onboardingData.perGym.length * 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={onboardingData.perGym} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fill: 'var(--color-text-subtle)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={120}
                    />
                    <Tooltip
                      content={<ChartTooltip formatter={(v) => `${v}%`} />}
                      cursor={{ fill: 'var(--color-accent-glow)' }}
                    />
                    <Bar
                      dataKey="rate"
                      name={t('platform.analytics.onboardingRate', 'Onboarding Rate')}
                      radius={[0, 4, 4, 0]}
                      barSize={18}
                      shape={(props) => {
                        const { x, y, width, height, payload } = props;
                        const rate = payload.rate;
                        const fill = rate >= 75 ? '#10B981' : rate >= 50 ? '#F59E0B' : '#EF4444';
                        return <rect x={x} y={y} width={width} height={height} fill={fill} rx={4} />;
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Onboarding Gap List */}
          {onboardingData.gapsGyms.length > 0 && (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
              <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-3">{t('platform.analytics.onboardingGaps', 'Onboarding Gaps')}</h3>
              <div className="space-y-2">
                {onboardingData.gapsGyms.map(gym => (
                  <div
                    key={gym.gymId}
                    className="flex items-center justify-between px-3 py-3 rounded-lg bg-red-500/5 border border-red-500/10"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{gym.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className={`text-[11px] font-semibold ${gym.rate < 30 ? 'text-red-400' : 'text-amber-400'}`}>
                          {gym.rate}% onboarded
                        </span>
                        <span className="text-[11px] text-[#6B7280]">
                          {gym.total.toLocaleString()} {t('platform.analytics.members', 'members')}
                        </span>
                        <span className="text-[11px] text-[#6B7280]">
                          {gym.notOnboarded.toLocaleString()} {t('platform.analytics.notOnboarded', 'not onboarded')}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/platform/gym/${gym.gymId}`)}
                      className="text-[11px] font-semibold text-[#D4AF37] hover:text-[#E5C04B] transition-colors flex-shrink-0 ml-3"
                    >
                      {t('platform.analytics.viewGym', 'View Gym')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </FadeIn>
    </div>
  );
}
