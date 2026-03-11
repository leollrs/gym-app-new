import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';

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
  <div className={`bg-[#0F172A] border border-white/6 rounded-[14px] p-5 ${h}`}>
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
  const [loadingCohort,      setLoadingCohort]       = useState(true);
  const [loadingChallenges,  setLoadingChallenges]  = useState(true);
  const [loadingOnboarding,  setLoadingOnboarding]  = useState(true);

  const [growthData,      setGrowthData]      = useState([]);
  const [retentionData,   setRetentionData]   = useState([]);
  const [cohortData,      setCohortData]      = useState([]);   // [{ label, m0, m1, m2, m3 }]
  const [challengeData,   setChallengeData]   = useState([]);
  const [onboardingStats, setOnboardingStats] = useState({ total: 0, onboarded: 0, pct: 0 });

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

  // ── 2. Retention Rate (last 6 months) ─────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingRetention(true);
      const gymId = profile.gym_id;
      const now   = new Date();

      // Total active members
      const { data: allMembers } = await supabase
        .from('profiles')
        .select('id')
        .eq('gym_id', gymId)
        .eq('role', 'member');

      const totalMembers = (allMembers || []).length;

      const months = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = startOfMonth(subMonths(now, i)).toISOString();
        const monthEnd   = endOfMonth(subMonths(now, i)).toISOString();

        const { data: sessions } = await supabase
          .from('workout_sessions')
          .select('profile_id')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', monthStart)
          .lte('started_at', monthEnd);

        const uniqueActive = new Set((sessions || []).map(s => s.profile_id)).size;
        const pct = totalMembers > 0 ? Math.round((uniqueActive / totalMembers) * 100) : 0;

        months.push({
          month: format(subMonths(now, i), 'MMM yy'),
          retention: pct,
          active: uniqueActive,
          total: totalMembers,
        });
      }

      setRetentionData(months);
      setLoadingRetention(false);
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

  // ── Donut chart data ───────────────────────────────────────
  const donutData = [
    { name: 'Onboarded',     value: onboardingStats.onboarded },
    { name: 'Not Onboarded', value: onboardingStats.total - onboardingStats.onboarded },
  ];

  // ─────────────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Analytics</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">Member retention, growth, and engagement insights</p>
      </div>

      {/* Row 1: Member Growth + Retention Rate */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">

        {/* 1. Member Growth */}
        {loadingGrowth ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Member Growth</p>
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
            <p className="text-[11px] text-[#4B5563] mt-2">New signups per month — last 12 months</p>
          </div>
        )}

        {/* 2. Monthly Retention Rate */}
        {loadingRetention ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Monthly Retention Rate</p>
            {retentionData.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-10">No session data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={retentionData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="month"
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
                    formatter={(value, _name, props) => [
                      `${value}% (${props.payload.active} / ${props.payload.total})`,
                      'Retention',
                    ]}
                  />
                  <Bar dataKey="retention" fill="#D4AF37" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="text-[11px] text-[#4B5563] mt-2">% of members with ≥1 workout logged that month</p>
          </div>
        )}
      </div>

      {/* Row 2: Cohort Retention — full width */}
      {loadingCohort ? (
        <CardSkeleton h="h-[260px]" />
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5 mb-4 overflow-x-auto">
          <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Cohort Retention</p>
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
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Challenge Participation</p>
            {challengeData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <p className="text-[13px] text-[#6B7280]">No challenges in the last 6 months</p>
                <p className="text-[11px] text-[#4B5563] mt-1">Create a challenge to see data here</p>
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
                <p className="text-[11px] text-[#4B5563] mt-2">% of total members who joined each challenge</p>
              </>
            )}
          </div>
        )}

        {/* 5. Onboarding Completion */}
        {loadingOnboarding ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Onboarding Completion</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
