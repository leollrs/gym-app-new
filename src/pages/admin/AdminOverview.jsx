import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, TrendingUp, AlertTriangle, Dumbbell, ChevronRight, Activity } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays, startOfDay } from 'date-fns';

// ── Churn score (0–100) ────────────────────────────────────
export const churnScore = (member, recentWorkouts = 0) => {
  const now = Date.now();
  let score = 0;

  // 1. Days since last active (40 pts)
  const daysInactive = member.last_active_at
    ? (now - new Date(member.last_active_at)) / 86400000
    : 999;
  if      (daysInactive > 21) score += 40;
  else if (daysInactive > 14) score += 28;
  else if (daysInactive > 7)  score += 15;

  // 2. Recent workouts (25 pts)
  if      (recentWorkouts === 0) score += 25;
  else if (recentWorkouts === 1) score += 15;
  else if (recentWorkouts <= 2)  score += 5;

  // 3. Account age slack — new members get benefit of the doubt (up to -15)
  const daysSinceJoined = (now - new Date(member.created_at)) / 86400000;
  if (daysSinceJoined < 14) score = Math.max(0, score - 20);

  return Math.min(Math.round(score), 100);
};

export const riskLabel = (score) => {
  if (score >= 61) return { label: 'At Risk',  color: 'text-red-400',   bg: 'bg-red-500/10',   dot: 'bg-red-400' };
  if (score >= 31) return { label: 'Watch',    color: 'text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-400' };
  return                  { label: 'Healthy',  color: 'text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-400' };
};

// ── Stat card ─────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, sub, accent }) => (
  <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
    <div className="flex items-start justify-between mb-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent ?? 'bg-[#D4AF37]/10'}`}>
        <Icon size={17} className={accent ? 'text-white' : 'text-[#D4AF37]'} />
      </div>
    </div>
    <p className="text-[28px] font-bold text-[#E5E7EB] leading-none">{value}</p>
    <p className="text-[13px] text-[#9CA3AF] mt-1">{label}</p>
    {sub && <p className="text-[11px] text-[#6B7280] mt-0.5">{sub}</p>}
  </div>
);

export default function AdminOverview() {
  const { profile } = useAuth();
  const navigate    = useNavigate();
  const [loading, setLoading]   = useState(true);
  const [stats, setStats]       = useState({});
  const [atRisk, setAtRisk]     = useState([]);
  const [chartData, setChartData] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const gymId = profile.gym_id;
      const now   = new Date();
      const thirtyDaysAgo  = subDays(now, 30).toISOString();
      const fourteenDaysAgo = subDays(now, 14).toISOString();

      // All members
      const { data: members } = await supabase
        .from('profiles')
        .select('id, full_name, username, last_active_at, created_at, role')
        .eq('gym_id', gymId)
        .eq('role', 'member');

      // Workouts last 30 days per member
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('profile_id, started_at, total_volume_lbs')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', thirtyDaysAgo)
        .order('started_at', { ascending: false });

      // Active member ids (worked out in last 30d)
      const activeIds = new Set((sessions || []).map(s => s.profile_id));

      // Workouts per member in last 14 days (for churn scoring)
      const recentCounts = {};
      (sessions || []).filter(s => s.started_at >= fourteenDaysAgo)
        .forEach(s => { recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1; });

      // Compute churn scores
      const scored = (members || []).map(m => ({
        ...m,
        score: churnScore(m, recentCounts[m.id] ?? 0),
        recentWorkouts: recentCounts[m.id] ?? 0,
      }));

      const atRiskMembers = scored
        .filter(m => m.score >= 61)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      setAtRisk(atRiskMembers);

      // Stats
      setStats({
        totalMembers:  (members || []).length,
        activeMembers: activeIds.size,
        atRiskCount:   scored.filter(m => m.score >= 61).length,
        workoutsMonth: (sessions || []).length,
      });

      // Chart: workouts per day for last 14 days
      const dayMap = {};
      for (let i = 13; i >= 0; i--) {
        const d = format(subDays(now, i), 'MMM d');
        dayMap[d] = 0;
      }
      (sessions || []).forEach(s => {
        const d = format(new Date(s.started_at), 'MMM d');
        if (d in dayMap) dayMap[d]++;
      });
      setChartData(Object.entries(dayMap).map(([date, count]) => ({ date, count })));

      // Recent activity feed (last 8 sessions)
      setRecentActivity((sessions || []).slice(0, 8));

      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Overview</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">Your gym at a glance</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Users}         label="Total Members"   value={stats.totalMembers}  sub="all time" />
        <StatCard icon={Activity}      label="Active (30d)"    value={stats.activeMembers} sub="logged a workout" />
        <StatCard icon={AlertTriangle} label="At Risk"         value={stats.atRiskCount}   sub="churn score ≥ 61" accent="bg-red-500/15" />
        <StatCard icon={Dumbbell}      label="Workouts (30d)"  value={stats.workoutsMonth} sub="completed sessions" />
      </div>

      {/* Chart + At-risk side by side on desktop */}
      <div className="grid md:grid-cols-[1fr_320px] gap-4 mb-4">

        {/* Activity chart */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
          <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Workouts — Last 14 Days</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#D4AF37" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={2} />
              <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: '#9CA3AF' }}
                itemStyle={{ color: '#D4AF37' }}
              />
              <Area type="monotone" dataKey="count" stroke="#D4AF37" strokeWidth={2} fill="url(#goldGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* At-risk members */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-semibold text-[#E5E7EB]">At Risk</p>
            <button onClick={() => navigate('/admin/members')} className="text-[11px] text-[#D4AF37] hover:underline flex items-center gap-0.5">
              View all <ChevronRight size={12} />
            </button>
          </div>
          {atRisk.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <p className="text-[13px] text-[#6B7280]">No at-risk members</p>
              <p className="text-[11px] text-[#4B5563] mt-1">Everyone is active</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {atRisk.map(m => {
                const risk = riskLabel(m.score);
                const daysInactive = m.last_active_at
                  ? Math.floor((Date.now() - new Date(m.last_active_at)) / 86400000)
                  : null;
                return (
                  <div key={m.id} className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => navigate('/admin/members')}>
                    <div className="w-7 h-7 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-bold text-[#9CA3AF]">{m.full_name[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {daysInactive !== null ? `${daysInactive}d inactive` : 'Never logged in'}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${risk.color} ${risk.bg}`}>
                      {m.score}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent sessions */}
      <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
        <p className="text-[14px] font-semibold text-[#E5E7EB] mb-3">Recent Workouts</p>
        {recentActivity.length === 0 ? (
          <p className="text-[13px] text-[#6B7280] text-center py-6">No workouts logged yet</p>
        ) : (
          <div className="divide-y divide-white/4">
            {recentActivity.map(s => (
              <div key={s.started_at + s.profile_id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-[13px] text-[#E5E7EB]">Workout completed</p>
                    <p className="text-[11px] text-[#6B7280]">{format(new Date(s.started_at), 'MMM d, h:mm a')}</p>
                  </div>
                </div>
                {s.total_volume_lbs && (
                  <span className="text-[12px] font-semibold text-[#9CA3AF]">
                    {Math.round(s.total_volume_lbs).toLocaleString()} lbs
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
