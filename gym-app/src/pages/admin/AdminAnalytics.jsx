import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { BENCHMARKS } from '../../lib/benchmarks';

const tooltipStyle = {
  contentStyle: { background: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#9CA3AF' },
  itemStyle: { color: '#D4AF37' },
};

// ── Skeleton block ─────────────────────────────────────────
const Skeleton = ({ className }) => (
  <div className={`animate-pulse bg-white/6 rounded-[10px] ${className}`} />
);

const CardSkeleton = ({ h = 'h-[220px]' }) => (
  <div className={`bg-[#0F172A] border border-white/6 rounded-xl p-4 ${h}`}>
    <Skeleton className="h-4 w-36 mb-5" />
    <Skeleton className="h-full w-full" />
  </div>
);

// ── Cohort cell colour ─────────────────────────────────────
const cohortCellStyle = (pct) => {
  if (pct === null) return { bg: 'bg-white/4', text: 'text-[#4B5563]' };
  if (pct >= 70)   return { bg: 'bg-emerald-500/20', text: 'text-emerald-400' };
  if (pct >= 40)   return { bg: 'bg-amber-500/20',   text: 'text-amber-400' };
  return                  { bg: 'bg-red-500/20',     text: 'text-red-400' };
};

export default function AdminAnalytics() {
  const { profile } = useAuth();

  const [loadingGrowth,      setLoadingGrowth]      = useState(true);
  const [loadingRetention,   setLoadingRetention]   = useState(true);
  const [loadingActivity,    setLoadingActivity]    = useState(true);
  const [loadingCohort,      setLoadingCohort]       = useState(true);
  const [loadingChallenges,  setLoadingChallenges]  = useState(true);
  const [loadingOnboarding,  setLoadingOnboarding]  = useState(true);
  const [loadingLifecycle,   setLoadingLifecycle]   = useState(true);

  const [growthData,      setGrowthData]      = useState([]);
  const [retentionData,   setRetentionData]   = useState([]);
  const [activityData,    setActivityData]    = useState([]);
  const [cohortData,      setCohortData]      = useState([]);   // [{ label, m0, m1, m2, m3 }]
  const [challengeData,   setChallengeData]   = useState([]);
  const [onboardingStats, setOnboardingStats] = useState({ total: 0, onboarded: 0, pct: 0 });
  const [lifecycleStages, setLifecycleStages] = useState([]);
  const [loadingTrainers,    setLoadingTrainers]    = useState(true);
  const [trainers,           setTrainers]           = useState([]);

  // ── 1. Member Growth ───────────────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingGrowth(true);
      const gymId = profile.gym_id;
      const now   = new Date();

      // Fetch all members created in last 12 months
      const from = subMonths(startOfMonth(now), 11).toISOString();
      const { data: members } = await supabase
        .from('profiles')
        .select('created_at')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .gte('created_at', from);

      // Bucket by month
      const monthMap = {};
      for (let i = 11; i >= 0; i--) {
        const label = format(subMonths(now, i), 'MMM yy');
        monthMap[label] = 0;
      }
      (members || []).forEach(m => {
        const label = format(new Date(m.created_at), 'MMM yy');
        if (label in monthMap) monthMap[label]++;
      });

      setGrowthData(Object.entries(monthMap).map(([month, count]) => ({ month, count })));
      setLoadingGrowth(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 2a. Retention Rate (membership-status based, last 6 months) ──
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingRetention(true);
      const gymId = profile.gym_id;
      const now   = new Date();

      // Fetch all members with their status and join date
      const { data: allMembers } = await supabase
        .from('profiles')
        .select('id, created_at, membership_status')
        .eq('gym_id', gymId)
        .eq('role', 'member');

      const members = allMembers || [];

      const months = [];
      for (let i = 5; i >= 0; i--) {
        const monthEnd = endOfMonth(subMonths(now, i));

        // Members who existed by end of that month
        const existedByMonth = members.filter(m => new Date(m.created_at) <= monthEnd);
        const total = existedByMonth.length;

        // Members NOT cancelled or banned = retained
        // For historical months we can only use current status as a proxy
        // (we don't have status change history per month yet)
        const retained = existedByMonth.filter(m =>
          m.membership_status !== 'cancelled' && m.membership_status !== 'banned'
        ).length;

        const pct = total > 0 ? Math.round((retained / total) * 100) : 0;

        months.push({
          month: format(subMonths(now, i), 'MMM yy'),
          retention: pct,
          retained,
          total,
        });
      }

      setRetentionData(months);
      setLoadingRetention(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 2b. Activity Rate (workout-based, last 6 months) ──────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingActivity(true);
      const gymId = profile.gym_id;
      const now   = new Date();

      // Fetch all members with join date for correct per-month denominator
      const { data: allMembers } = await supabase
        .from('profiles')
        .select('id, created_at')
        .eq('gym_id', gymId)
        .eq('role', 'member');

      const members = allMembers || [];

      const months = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = startOfMonth(subMonths(now, i));
        const monthEnd   = endOfMonth(subMonths(now, i));

        // Members who existed by end of that month
        const totalThatMonth = members.filter(m => new Date(m.created_at) <= monthEnd).length;

        const { data: sessions } = await supabase
          .from('workout_sessions')
          .select('profile_id')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', monthStart.toISOString())
          .lte('started_at', monthEnd.toISOString());

        const uniqueActive = new Set((sessions || []).map(s => s.profile_id)).size;
        const pct = totalThatMonth > 0 ? Math.round((uniqueActive / totalThatMonth) * 100) : 0;

        months.push({
          month: format(subMonths(now, i), 'MMM yy'),
          activity: pct,
          active: uniqueActive,
          total: totalThatMonth,
        });
      }

      setActivityData(months);
      setLoadingActivity(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 3. Cohort Retention ────────────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingCohort(true);
      const gymId = profile.gym_id;
      const now   = new Date();

      // Fetch all members with created_at in last 6 months
      const from = subMonths(startOfMonth(now), 5).toISOString();
      const { data: members } = await supabase
        .from('profiles')
        .select('id, created_at')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .gte('created_at', from);

      // Fetch all workout sessions in the same window
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('profile_id, started_at')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', from);

      // Build a map: profileId → Set of "month offset" (0,1,2,3) they were active in
      // relative to their join month
      const sessionsByProfile = {};
      (sessions || []).forEach(s => {
        if (!sessionsByProfile[s.profile_id]) sessionsByProfile[s.profile_id] = [];
        sessionsByProfile[s.profile_id].push(new Date(s.started_at));
      });

      // Group members by join cohort (month)
      const cohortMap = {};
      (members || []).forEach(m => {
        const joinMonth = format(new Date(m.created_at), 'MMM yy');
        if (!cohortMap[joinMonth]) cohortMap[joinMonth] = [];
        cohortMap[joinMonth].push(m);
      });

      // For each cohort, calculate retention at month 0,1,2,3
      const rows = [];
      for (let i = 5; i >= 0; i--) {
        const cohortMonthDate = subMonths(now, i);
        const label           = format(cohortMonthDate, 'MMM yy');
        const cohortMembers   = cohortMap[label] || [];
        const cohortSize      = cohortMembers.length;

        const monthRetention = [0, 1, 2, 3].map(offset => {
          // Only compute if the offset month has passed
          const targetMonth      = subMonths(now, i - offset);
          const targetMonthIndex = i - offset;
          if (targetMonthIndex < 0) return null; // future month

          const targetStart = startOfMonth(targetMonth);
          const targetEnd   = endOfMonth(targetMonth);

          if (cohortSize === 0) return null;

          const activeCount = cohortMembers.filter(m => {
            const memberSessions = sessionsByProfile[m.id] || [];
            return memberSessions.some(d => d >= targetStart && d <= targetEnd);
          }).length;

          return Math.round((activeCount / cohortSize) * 100);
        });

        rows.push({ label, cohortSize, m0: monthRetention[0], m1: monthRetention[1], m2: monthRetention[2], m3: monthRetention[3] });
      }

      setCohortData(rows);
      setLoadingCohort(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 4. Challenge Participation ─────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingChallenges(true);
      const gymId = profile.gym_id;
      const now   = new Date();
      const from  = subMonths(now, 6).toISOString();

      // Total members
      const { data: allMembers } = await supabase
        .from('profiles')
        .select('id')
        .eq('gym_id', gymId)
        .eq('role', 'member');
      const totalMembers = (allMembers || []).length;

      // Challenges in last 6 months
      const { data: challenges } = await supabase
        .from('challenges')
        .select('id, title, starts_at')
        .eq('gym_id', gymId)
        .gte('starts_at', from)
        .order('starts_at', { ascending: false })
        .limit(8);

      if (!challenges || challenges.length === 0) {
        setChallengeData([]);
        setLoadingChallenges(false);
        return;
      }

      // Participants per challenge
      const { data: participants } = await supabase
        .from('challenge_participants')
        .select('challenge_id, user_id')
        .in('challenge_id', challenges.map(c => c.id));

      const countMap = {};
      (participants || []).forEach(p => {
        countMap[p.challenge_id] = (countMap[p.challenge_id] || 0) + 1;
      });

      const data = challenges.map(c => ({
        name:    c.title.length > 18 ? c.title.slice(0, 16) + '…' : c.title,
        fullName: c.title,
        count:   countMap[c.id] || 0,
        pct:     totalMembers > 0 ? Math.round(((countMap[c.id] || 0) / totalMembers) * 100) : 0,
      }));

      setChallengeData(data.reverse()); // chronological
      setLoadingChallenges(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 5. Onboarding Completion ───────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingOnboarding(true);
      const gymId = profile.gym_id;

      const { data: members } = await supabase
        .from('profiles')
        .select('id, is_onboarded')
        .eq('gym_id', gymId)
        .eq('role', 'member');

      const total     = (members || []).length;
      const onboarded = (members || []).filter(m => m.is_onboarded).length;
      const pct       = total > 0 ? Math.round((onboarded / total) * 100) : 0;

      setOnboardingStats({ total, onboarded, pct });
      setLoadingOnboarding(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 6. Member Lifecycle Funnel ─────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingLifecycle(true);
      const gymId = profile.gym_id;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { data: members },
        { data: recentSessions },
        { data: churnScores },
        { data: winBacks },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, created_at, is_onboarded, membership_status')
          .eq('gym_id', gymId)
          .eq('role', 'member'),
        supabase
          .from('workout_sessions')
          .select('profile_id, started_at')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', thirtyDaysAgo),
        supabase
          .from('churn_risk_scores')
          .select('profile_id, risk_tier'),
        supabase
          .from('win_back_attempts')
          .select('profile_id')
          .eq('outcome', 'returned'),
      ]);

      // Build session count per member (last 30 days)
      const sessionCountMap = {};
      (recentSessions || []).forEach(s => {
        sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1;
      });

      // Build latest churn score per member (take last entry per profile_id)
      const churnMap = {};
      (churnScores || []).forEach(s => {
        churnMap[s.profile_id] = s.risk_tier;
      });

      // Build win-back set
      const wonBackSet = new Set((winBacks || []).map(w => w.profile_id));

      // Total session count per member (for onboarding check — use recent sessions as proxy for <3 total)
      // We need all-time sessions for the "total < 3" check for Onboarding stage
      const { data: allSessions } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .eq('gym_id', gymId)
        .eq('status', 'completed');

      const totalSessionMap = {};
      (allSessions || []).forEach(s => {
        totalSessionMap[s.profile_id] = (totalSessionMap[s.profile_id] || 0) + 1;
      });

      const counts = { new: 0, onboarding: 0, active: 0, atRisk: 0, churned: 0, wonBack: 0 };

      (members || []).forEach(m => {
        const status = m.membership_status;
        const recentCount = sessionCountMap[m.id] || 0;
        const totalCount = totalSessionMap[m.id] || 0;
        const riskTier = churnMap[m.id];
        const joinedRecently = m.created_at >= fourteenDaysAgo;

        // Priority order classification
        if (status === 'cancelled' || status === 'frozen') {
          counts.churned++;
        } else if (wonBackSet.has(m.id)) {
          counts.wonBack++;
        } else if (riskTier && ['critical', 'high', 'medium'].includes(riskTier)) {
          counts.atRisk++;
        } else if (recentCount >= 3) {
          counts.active++;
        } else if (m.is_onboarded && totalCount < 3) {
          counts.onboarding++;
        } else if (!m.is_onboarded || (joinedRecently && totalCount === 0)) {
          counts.new++;
        } else {
          // Fallback: members who are onboarded with 3+ total but <3 recent — treat as active (low activity)
          counts.active++;
        }
      });

      const total = (members || []).length;
      const stagesDef = [
        { key: 'new',        label: 'New',        color: '#60A5FA', count: counts.new },
        { key: 'onboarding', label: 'Onboarding', color: '#818CF8', count: counts.onboarding },
        { key: 'active',     label: 'Active',     color: '#10B981', count: counts.active },
        { key: 'atRisk',     label: 'At Risk',    color: '#F59E0B', count: counts.atRisk },
        { key: 'churned',    label: 'Churned',    color: '#EF4444', count: counts.churned },
        { key: 'wonBack',    label: 'Won Back',   color: '#D4AF37', count: counts.wonBack },
      ].map(s => ({
        ...s,
        pct: total > 0 ? Math.round((s.count / total) * 100) : 0,
      }));

      setLifecycleStages(stagesDef);
      setLoadingLifecycle(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 7. Trainer Performance ─────────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingTrainers(true);
      const gymId = profile.gym_id;
      const now   = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Fetch trainers
      const { data: trainerRows } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('gym_id', gymId)
        .eq('role', 'trainer');

      if (!trainerRows || trainerRows.length === 0) {
        setTrainers([]);
        setLoadingTrainers(false);
        return;
      }

      // Fetch trainer-client relationships
      const { data: tcRows } = await supabase
        .from('trainer_clients')
        .select('trainer_id, client_id, is_active')
        .eq('gym_id', gymId);

      // Fetch workout sessions in last 30 days
      const { data: recentSessions } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', thirtyDaysAgo);

      // Build set of members who logged at least 1 workout in last 30d
      const activeMembers = new Set((recentSessions || []).map(s => s.profile_id));

      // Count sessions per member in last 30d
      const sessionCountMap = {};
      (recentSessions || []).forEach(s => {
        sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1;
      });

      // Compute per trainer
      const trainerStats = trainerRows.map(t => {
        const clients = (tcRows || []).filter(tc => tc.trainer_id === t.id);
        const activeClients = clients.filter(tc => tc.is_active);
        const clientCount = activeClients.length;

        const clientsWithWorkout = activeClients.filter(tc => activeMembers.has(tc.client_id)).length;
        const retention = clientCount > 0 ? Math.round((clientsWithWorkout / clientCount) * 100) : 0;

        const totalClientSessions = activeClients.reduce((sum, tc) => sum + (sessionCountMap[tc.client_id] || 0), 0);
        const avgWorkouts = clientCount > 0 ? (totalClientSessions / clientCount / 4.33).toFixed(1) : '0.0';

        return {
          id: t.id,
          name: t.full_name || 'Unnamed',
          clientCount,
          retention,
          avgWorkouts,
        };
      });

      // Sort by client count descending
      trainerStats.sort((a, b) => b.clientCount - a.clientCount);
      setTrainers(trainerStats);
      setLoadingTrainers(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── Donut chart data ───────────────────────────────────────
  const donutData = [
    { name: 'Onboarded',     value: onboardingStats.onboarded },
    { name: 'Not Onboarded', value: onboardingStats.total - onboardingStats.onboarded },
  ];

  const handleExportGrowth = () => {
    exportCSV({
      filename: 'member-growth',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'count', label: 'New Members' },
      ],
      data: growthData,
    });
  };

  const handleExportRetention = () => {
    exportCSV({
      filename: 'retention',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'retention', label: 'Retention %' },
        { key: 'retained', label: 'Retained' },
        { key: 'total', label: 'Total' },
      ],
      data: retentionData,
    });
  };

  const handleExportActivity = () => {
    exportCSV({
      filename: 'activity-rate',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'activity', label: 'Activity %' },
        { key: 'active', label: 'Active' },
        { key: 'total', label: 'Total Members' },
      ],
      data: activityData,
    });
  };

  const handleExportCohort = () => {
    exportCSV({
      filename: 'cohort-retention',
      columns: [
        { key: 'label', label: 'Cohort' },
        { key: 'cohortSize', label: 'Size' },
        { key: 'm0', label: 'Month 0' },
        { key: 'm1', label: 'Month 1' },
        { key: 'm2', label: 'Month 2' },
        { key: 'm3', label: 'Month 3' },
      ],
      data: cohortData,
    });
  };

  // ─────────────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Analytics</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">Retention, growth, and engagement metrics</p>
      </div>

      {/* Member Lifecycle Funnel */}
      {loadingLifecycle ? (
        <CardSkeleton h="h-[140px]" />
      ) : lifecycleStages.length > 0 && (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">Member Lifecycle</p>
          <p className="text-[11px] text-[#6B7280] mb-4">Where your members are right now</p>

          <div className="flex gap-1 h-10 rounded-xl overflow-hidden mb-4">
            {lifecycleStages.map(s => (
              <div key={s.key} className="relative group" style={{ flex: s.count, background: s.color, minWidth: s.count > 0 ? 2 : 0 }}>
                <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1 text-[11px] text-white whitespace-nowrap z-10 pointer-events-none transition-opacity">
                  {s.label}: {s.count} ({s.pct}%)
                </div>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {lifecycleStages.map(s => (
              <div key={s.key} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[12px] text-[#9CA3AF]">{s.label}</span>
                <span className="text-[12px] font-semibold text-[#E5E7EB]">{s.count}</span>
                <span className="text-[11px] text-[#6B7280]">({s.pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 1: Member Growth + Retention Rate */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">

        {/* 1. Member Growth */}
        {loadingGrowth ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[13px] font-semibold text-[#E5E7EB]">Member Growth</p>
              <button
                onClick={handleExportGrowth}
                className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
              >
                <Download size={13} />
                Export
              </button>
            </div>
            {growthData.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-10">No member data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={growthData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#D4AF37" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value) => [value, 'New members']}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#D4AF37"
                    strokeWidth={2}
                    fill="url(#growthGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <p className="text-[10px] text-[#4B5563] mt-2">New signups per month — last 12 months</p>
          </div>
        )}

        {/* 2. Monthly Retention Rate (membership-status based) */}
        {loadingRetention ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[13px] font-semibold text-[#E5E7EB]">Retention Rate</p>
              <button
                onClick={handleExportRetention}
                className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
              >
                <Download size={13} />
                Export
              </button>
            </div>
            {retentionData.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-10">No member data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={retentionData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value, _name, props) => [
                      `${value}% (${props.payload.retained} / ${props.payload.total})`,
                      'Retained',
                    ]}
                  />
                  <ReferenceLine y={BENCHMARKS.retentionRate} stroke="#D4AF37" strokeDasharray="6 4" strokeOpacity={0.5} label={{ value: `Industry avg ${BENCHMARKS.retentionRate}%`, position: 'right', fill: '#D4AF37', fontSize: 10, opacity: 0.7 }} />
                  <Bar dataKey="retention" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="text-[10px] text-[#4B5563] mt-2">% of members not cancelled or banned</p>
          </div>
        )}
      </div>

      {/* Row 1b: Activity Rate */}
      {loadingActivity ? (
        <CardSkeleton h="h-[260px]" />
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13px] font-semibold text-[#E5E7EB]">Activity Rate</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">% of members who logged ≥1 workout that month</p>
            </div>
            <button
              onClick={handleExportActivity}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
            >
              <Download size={13} />
              Export
            </button>
          </div>
          {activityData.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] text-center py-10">No session data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={activityData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, _name, props) => [
                    `${value}% (${props.payload.active} / ${props.payload.total})`,
                    'Active',
                  ]}
                />
                <Bar dataKey="activity" fill="#D4AF37" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Row 2: Cohort Retention — full width */}
      {loadingCohort ? (
        <CardSkeleton h="h-[260px]" />
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-4 overflow-x-auto">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Cohort Retention</p>
            <button
              onClick={handleExportCohort}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
            >
              <Download size={13} />
              Export
            </button>
          </div>
          {cohortData.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] text-center py-10">No cohort data yet</p>
          ) : (
            <div className="min-w-[480px]">
              {/* Header row */}
              <div className="grid grid-cols-[140px_60px_1fr_1fr_1fr_1fr] gap-2 mb-2">
                <span className="text-[11px] font-medium text-[#6B7280]">Cohort</span>
                <span className="text-[11px] font-medium text-[#6B7280] text-right">Size</span>
                {['Month 0', 'Month 1', 'Month 2', 'Month 3'].map(h => (
                  <span key={h} className="text-[11px] font-medium text-[#6B7280] text-center">{h}</span>
                ))}
              </div>

              {/* Data rows */}
              <div className="space-y-1.5">
                {cohortData.map(row => (
                  <div key={row.label} className="grid grid-cols-[140px_60px_1fr_1fr_1fr_1fr] gap-2 items-center">
                    <span className="text-[13px] text-[#E5E7EB] font-medium">{row.label}</span>
                    <span className="text-[12px] text-[#9CA3AF] text-right">{row.cohortSize}</span>
                    {[row.m0, row.m1, row.m2, row.m3].map((pct, idx) => {
                      const style = cohortCellStyle(pct);
                      return (
                        <div key={idx} className={`rounded-[7px] px-2 py-1.5 text-center ${style.bg}`}>
                          <span className={`text-[12px] font-semibold ${style.text}`}>
                            {pct === null ? '—' : `${pct}%`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 flex-wrap">
                {[
                  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: '≥70% — Strong' },
                  { bg: 'bg-amber-500/20',   text: 'text-amber-400',   label: '40–70% — Moderate' },
                  { bg: 'bg-red-500/20',     text: 'text-red-400',     label: '<40% — Low' },
                ].map(({ bg, text, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className={`w-3 h-3 rounded-[3px] ${bg}`} />
                    <span className={`text-[10px] ${text}`}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Row 3: Challenge Participation + Onboarding Completion */}
      <div className="grid md:grid-cols-2 gap-4">

        {/* 4. Challenge Participation */}
        {loadingChallenges ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Challenge Participation</p>
            {challengeData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <p className="text-[13px] text-[#6B7280]">No challenges in the last 6 months</p>
                <p className="text-[10px] text-[#4B5563] mt-1">Create a challenge to see data here</p>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={challengeData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: '#6B7280' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#6B7280' }}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 100]}
                      tickFormatter={v => `${v}%`}
                    />
                    <Tooltip
                      {...tooltipStyle}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-[#111827] border border-white/8 rounded-[10px] px-3 py-2 text-[12px]">
                            <p className="text-[#9CA3AF] mb-0.5">{d.fullName}</p>
                            <p className="text-[#D4AF37] font-semibold">{d.pct}% ({d.count} members)</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="pct" fill="#D4AF37" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-[#4B5563] mt-2">% of total members who joined each challenge</p>
              </>
            )}
          </div>
        )}

        {/* 5. Onboarding Completion */}
        {loadingOnboarding ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Onboarding Completion</p>
            <div className="flex items-center gap-6">

              {/* Donut chart */}
              <div className="flex-shrink-0">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={36}
                      outerRadius={54}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      <Cell fill="#D4AF37" />
                      <Cell fill="rgba(255,255,255,0.06)" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Stats */}
              <div className="flex-1">
                <p className="text-[42px] font-bold text-[#D4AF37] leading-none">{onboardingStats.pct}%</p>
                <p className="text-[13px] text-[#9CA3AF] mt-1">Completion rate</p>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#D4AF37]" />
                      <span className="text-[12px] text-[#9CA3AF]">Onboarded</span>
                    </div>
                    <span className="text-[12px] font-semibold text-[#E5E7EB]">{onboardingStats.onboarded}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                      <span className="text-[12px] text-[#9CA3AF]">Not completed</span>
                    </div>
                    <span className="text-[12px] font-semibold text-[#E5E7EB]">
                      {onboardingStats.total - onboardingStats.onboarded}
                    </span>
                  </div>
                  <div className="h-px bg-white/6 my-1" />
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#6B7280]">Total members</span>
                    <span className="text-[12px] font-semibold text-[#E5E7EB]">{onboardingStats.total}</span>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-[#6B7280] mt-2 text-center">
              Industry avg: <span className="text-[#D4AF37]">{BENCHMARKS.onboardingCompletion}%</span> onboarding completion
            </p>
          </div>
        )}
      </div>

      {/* Trainer Performance */}
      {loadingTrainers ? (
        <CardSkeleton h="h-[200px]" />
      ) : trainers.length > 0 && (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mt-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">Trainer Performance</p>
          <p className="text-[11px] text-[#6B7280] mb-4">Client retention and engagement by trainer</p>

          <div className="divide-y divide-white/4">
            {trainers.map(t => (
              <div key={t.id} className="flex items-center gap-4 py-3">
                <div className="w-9 h-9 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-[12px] font-bold text-[#D4AF37]">{t.name[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{t.name}</p>
                  <p className="text-[11px] text-[#6B7280]">{t.clientCount} active client{t.clientCount !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex gap-4 text-right">
                  <div>
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">{t.retention}%</p>
                    <p className="text-[10px] text-[#6B7280]">retention</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">{t.avgWorkouts}</p>
                    <p className="text-[10px] text-[#6B7280]">wk/client</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
