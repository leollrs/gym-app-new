import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Download, ChevronLeft, ChevronRight, Dumbbell, Users, TrendingUp, Zap, CalendarCheck, Trophy as TrophyIcon, X, FileText } from 'lucide-react';
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

// ── Fade-in-up wrapper ────────────────────────────────────
const FadeIn = ({ delay = 0, children, className = '' }) => (
  <div
    className={`animate-fade-in-up ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
  >
    {children}
  </div>
);

// ── Skeleton block ─────────────────────────────────────────
const Skeleton = ({ className }) => (
  <div className={`bg-white/6 rounded-[10px] ${className}`} style={{ animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
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

  // Monthly Summary
  const [summaryMonth, setSummaryMonth]       = useState(0); // 0 = current month, 1 = last month, etc.
  const [loadingSummary, setLoadingSummary]    = useState(true);
  const [summary, setSummary]                 = useState(null);
  const [showReport, setShowReport]            = useState(false);

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

  // ── 2a. Retention Rate (survival: members from start of month who are still active) ──
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
        const monthStart = startOfMonth(subMonths(now, i));
        const monthEnd   = endOfMonth(subMonths(now, i));

        // Starting cohort: members who existed at the start of this month
        const startingMembers = members.filter(m => new Date(m.created_at) < monthStart);
        const starting = startingMembers.length;

        // Of those starting members, how many are still not cancelled/banned
        // (using current status as proxy — we don't have per-month status history)
        const retained = startingMembers.filter(m =>
          m.membership_status !== 'cancelled' && m.membership_status !== 'banned'
        ).length;

        const pct = starting > 0 ? Math.round((retained / starting) * 100) : 0;

        months.push({
          month: format(subMonths(now, i), 'MMM yy'),
          retention: pct,
          retained,
          total: starting,
        });
      }

      setRetentionData(months);
      setLoadingRetention(false);
    };
    load();
  }, [profile?.gym_id]);

  // ── 2b. Engagement (workout-based, last 6 months) ──────────
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

        // Total members who existed by end of that month
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
          engagement: pct,
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

  // ── Monthly Summary ───────────────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoadingSummary(true);
      const gymId = profile.gym_id;
      const now = new Date();
      const target = subMonths(now, summaryMonth);
      const mStart = startOfMonth(target).toISOString();
      const mEnd   = endOfMonth(target).toISOString();

      const [
        { data: newMembers },
        { data: sessions },
        { data: checkIns },
        { data: prs },
        { data: challengeParts },
        { data: allMembers },
      ] = await Promise.all([
        supabase.from('profiles').select('id').eq('gym_id', gymId).eq('role', 'member').gte('created_at', mStart).lte('created_at', mEnd),
        supabase.from('workout_sessions').select('profile_id, total_volume_lbs, duration_minutes').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', mStart).lte('started_at', mEnd),
        supabase.from('check_ins').select('id').eq('gym_id', gymId).gte('created_at', mStart).lte('created_at', mEnd),
        supabase.from('personal_records').select('id').eq('gym_id', gymId).gte('achieved_at', mStart).lte('achieved_at', mEnd),
        supabase.from('challenge_participants').select('id').eq('gym_id', gymId).gte('joined_at', mStart).lte('joined_at', mEnd),
        supabase.from('profiles').select('id, created_at').eq('gym_id', gymId).eq('role', 'member'),
      ]);

      const sessionList = sessions || [];
      const totalWorkouts = sessionList.length;
      const uniqueActive = new Set(sessionList.map(s => s.profile_id)).size;
      const totalVolume = sessionList.reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
      const totalDuration = sessionList.reduce((sum, s) => sum + (parseFloat(s.duration_minutes) || 0), 0);
      const avgWorkoutsPerActive = uniqueActive > 0 ? (totalWorkouts / uniqueActive).toFixed(1) : '0';
      const totalMembersAtEnd = (allMembers || []).filter(m => new Date(m.created_at) <= new Date(mEnd)).length;
      const activeRate = totalMembersAtEnd > 0 ? Math.round((uniqueActive / totalMembersAtEnd) * 100) : 0;

      setSummary({
        label: format(target, 'MMMM yyyy'),
        newMembers: (newMembers || []).length,
        totalWorkouts,
        uniqueActive,
        totalVolume: Math.round(totalVolume),
        totalDuration: Math.round(totalDuration),
        avgWorkoutsPerActive,
        checkIns: (checkIns || []).length,
        prs: (prs || []).length,
        challengeJoins: (challengeParts || []).length,
        totalMembers: totalMembersAtEnd,
        activeRate,
      });
      setLoadingSummary(false);
    };
    load();
  }, [profile?.gym_id, summaryMonth]);

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

  const handleExportEngagement = () => {
    exportCSV({
      filename: 'engagement',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'engagement', label: 'Engagement %' },
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

  // ── Download monthly report as PDF (print) ────────────
  const handleDownloadReport = () => {
    if (!summary) return;
    const s = summary;
    const fmtVol = s.totalVolume >= 1_000_000 ? `${(s.totalVolume / 1_000_000).toFixed(1)}M` : s.totalVolume >= 1_000 ? `${(s.totalVolume / 1_000).toFixed(1)}K` : s.totalVolume.toLocaleString();
    const fmtTime = s.totalDuration >= 60 ? `${(s.totalDuration / 60).toFixed(0)} hours` : `${s.totalDuration} min`;
    const generated = format(new Date(), 'MMMM d, yyyy');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Monthly Report – ${s.label}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;background:#fff;padding:48px 56px;max-width:800px;margin:0 auto}
.header{border-bottom:3px solid #D4AF37;padding-bottom:20px;margin-bottom:32px}
.header h1{font-size:28px;font-weight:800;color:#0A0D14;letter-spacing:-0.5px}
.header .subtitle{font-size:14px;color:#64748b;margin-top:4px}
.header .date{font-size:11px;color:#94a3b8;margin-top:8px}
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center}
.kpi .value{font-size:28px;font-weight:800;color:#0A0D14}
.kpi .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}
.kpi .sub{font-size:10px;color:#94a3b8;margin-top:2px}
.kpi.highlight{background:linear-gradient(135deg,#fefce8,#fef9c3);border-color:#D4AF37}
.kpi.highlight .value{color:#92700c}
.section{margin-bottom:28px}
.section h2{font-size:16px;font-weight:700;color:#0A0D14;margin-bottom:14px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
table{width:100%;border-collapse:collapse}
table th{text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;padding:8px 12px;border-bottom:2px solid #e2e8f0}
table td{padding:10px 12px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9}
table td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.insight{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-top:20px}
.insight p{font-size:12px;color:#166534;line-height:1.5}
.insight strong{color:#14532d}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#94a3b8}
@media print{body{padding:32px 40px}@page{margin:0.5in}}
</style></head><body>
<div class="header">
  <h1>Monthly Performance Report</h1>
  <div class="subtitle">${s.label}</div>
  <div class="date">Generated ${generated}</div>
</div>

<div class="kpi-row">
  <div class="kpi highlight"><div class="value">${s.totalMembers}</div><div class="label">Total Members</div></div>
  <div class="kpi"><div class="value">${s.uniqueActive}</div><div class="label">Active Members</div><div class="sub">${s.activeRate}% of total</div></div>
  <div class="kpi"><div class="value">${s.newMembers}</div><div class="label">New Members</div></div>
  <div class="kpi"><div class="value">${s.checkIns.toLocaleString()}</div><div class="label">Gym Check-ins</div></div>
</div>

<div class="section">
  <h2>Training Activity</h2>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Workouts Completed</td><td>${s.totalWorkouts.toLocaleString()}</td></tr>
      <tr><td>Average per Active Member</td><td>${s.avgWorkoutsPerActive}</td></tr>
      <tr><td>Total Volume Lifted</td><td>${fmtVol} lbs</td></tr>
      <tr><td>Total Training Time</td><td>${fmtTime}</td></tr>
      <tr><td>Personal Records Hit</td><td>${s.prs}</td></tr>
    </tbody>
  </table>
</div>

<div class="section">
  <h2>Engagement</h2>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Active Rate</td><td>${s.activeRate}%</td></tr>
      <tr><td>Challenge Participations</td><td>${s.challengeJoins}</td></tr>
      <tr><td>Check-ins</td><td>${s.checkIns.toLocaleString()}</td></tr>
      <tr><td>Personal Records</td><td>${s.prs}</td></tr>
    </tbody>
  </table>
</div>

<div class="insight">
  <p><strong>Highlights:</strong> ${s.uniqueActive} of ${s.totalMembers} members were active this month (${s.activeRate}% active rate). Members completed ${s.totalWorkouts.toLocaleString()} workouts totaling ${fmtVol} lbs of volume and ${fmtTime} of training. ${s.prs} personal records were set and ${s.newMembers} new member${s.newMembers !== 1 ? 's' : ''} joined.</p>
</div>

<div class="footer">Confidential — For internal use only</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=820,height=1000');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // ─────────────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">

      {/* Page header */}
      <FadeIn>
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Analytics</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Retention, growth, and engagement metrics</p>
        </div>
      </FadeIn>

      {/* Member Lifecycle Funnel */}
      {loadingLifecycle ? (
        <CardSkeleton h="h-[140px]" />
      ) : lifecycleStages.length > 0 && (
        <FadeIn delay={60}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6 hover:border-white/10 transition-colors duration-300">
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
        </FadeIn>
      )}

      {/* Monthly Summary */}
      <FadeIn delay={90}>
      {loadingSummary ? (
        <CardSkeleton h="h-[200px]" />
      ) : summary && (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6 hover:border-white/10 transition-colors duration-300">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13px] font-semibold text-[#E5E7EB]">Monthly Summary</p>
              <p className="text-[11px] text-[#6B7280]">Key metrics at a glance</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setSummaryMonth(m => m + 1)}
                className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                <ChevronLeft size={14} className="text-[#9CA3AF]" />
              </button>
              <span className="text-[13px] font-medium text-[#E5E7EB] min-w-[120px] text-center">{summary.label}</span>
              <button onClick={() => setSummaryMonth(m => Math.max(0, m - 1))} disabled={summaryMonth === 0}
                className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-30">
                <ChevronRight size={14} className="text-[#9CA3AF]" />
              </button>
              <button
                onClick={() => setShowReport(true)}
                className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 transition-colors"
              >
                <FileText size={13} />
                Generate Report
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Dumbbell, label: 'Workouts', value: summary.totalWorkouts.toLocaleString(), sub: `${summary.avgWorkoutsPerActive}/active member`, color: '#D4AF37' },
              { icon: Users, label: 'Active Members', value: summary.uniqueActive, sub: `${summary.activeRate}% of ${summary.totalMembers}`, color: '#10B981' },
              { icon: TrendingUp, label: 'New Members', value: summary.newMembers, sub: 'joined this month', color: '#60A5FA' },
              { icon: Zap, label: 'Total Volume', value: summary.totalVolume >= 1000000 ? `${(summary.totalVolume / 1000000).toFixed(1)}M` : summary.totalVolume >= 1000 ? `${(summary.totalVolume / 1000).toFixed(1)}K` : summary.totalVolume.toLocaleString(), sub: 'lbs lifted', color: '#F59E0B' },
              { icon: CalendarCheck, label: 'Check-ins', value: summary.checkIns.toLocaleString(), sub: 'gym visits', color: '#8B5CF6' },
              { icon: TrophyIcon, label: 'PRs Hit', value: summary.prs, sub: 'personal records', color: '#EF4444' },
              { icon: TrophyIcon, label: 'Challenge Joins', value: summary.challengeJoins, sub: 'new participants', color: '#D4AF37' },
              { icon: Dumbbell, label: 'Total Time', value: summary.totalDuration >= 60 ? `${(summary.totalDuration / 60).toFixed(0)}h` : `${summary.totalDuration}m`, sub: 'training time', color: '#14B8A6' },
            ].map((stat, i) => (
              <div key={i} className="bg-[#111827] rounded-xl p-3 border border-white/4">
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={13} style={{ color: stat.color }} />
                  <span className="text-[11px] text-[#6B7280] font-medium">{stat.label}</span>
                </div>
                <p className="text-[20px] font-bold text-[#E5E7EB] leading-none tabular-nums">{stat.value}</p>
                <p className="text-[10px] text-[#4B5563] mt-1">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      </FadeIn>

      {/* Row 1: Member Growth + Retention Rate */}
      <FadeIn delay={120}>
      <div className="grid md:grid-cols-2 gap-4 mb-4">

        {/* 1. Member Growth */}
        {loadingGrowth ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
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
                    animationDuration={1200}
                    animationEasing="ease-out"
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
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
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
                  <Bar dataKey="retention" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="text-[10px] text-[#4B5563] mt-2">Of members who existed at month start, % still active</p>
          </div>
        )}
      </div>

      </FadeIn>

      {/* Row 1b: Engagement */}
      <FadeIn delay={180}>
      {loadingActivity ? (
        <CardSkeleton h="h-[260px]" />
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-4 hover:border-white/10 transition-colors duration-300">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13px] font-semibold text-[#E5E7EB]">Engagement</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">% of signed members who logged ≥1 workout that month</p>
            </div>
            <button
              onClick={handleExportEngagement}
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
                    'Engaged',
                  ]}
                />
                <Bar dataKey="engagement" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      </FadeIn>

      {/* Row 2: Cohort Retention — full width */}
      <FadeIn delay={240}>
      {loadingCohort ? (
        <CardSkeleton h="h-[260px]" />
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-4 overflow-x-auto hover:border-white/10 transition-colors duration-300">
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

      </FadeIn>

      {/* Row 3: Challenge Participation + Onboarding Completion */}
      <FadeIn delay={300}>
      <div className="grid md:grid-cols-2 gap-4">

        {/* 4. Challenge Participation */}
        {loadingChallenges ? (
          <CardSkeleton />
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
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
                    <Bar dataKey="pct" fill="#D4AF37" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
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
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
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

      </FadeIn>

      {/* Trainer Performance */}
      <FadeIn delay={360}>
      {loadingTrainers ? (
        <CardSkeleton h="h-[200px]" />
      ) : trainers.length > 0 && (
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mt-4 hover:border-white/10 transition-colors duration-300">
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
      </FadeIn>

      {/* ── Monthly Report Modal ─────────────────────────────── */}
      {showReport && summary && (() => {
        const s = summary;
        const fmtVol = s.totalVolume >= 1_000_000 ? `${(s.totalVolume / 1_000_000).toFixed(1)}M` : s.totalVolume >= 1_000 ? `${(s.totalVolume / 1_000).toFixed(1)}K` : s.totalVolume.toLocaleString();
        const fmtTime = s.totalDuration >= 60 ? `${(s.totalDuration / 60).toFixed(0)} hours` : `${s.totalDuration} min`;
        return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4" onClick={() => setShowReport(false)}>
          <div className="w-full max-w-2xl my-4 md:my-10" onClick={e => e.stopPropagation()}>

            {/* ─ Report document (white paper style) ─ */}
            <div className="bg-[#fafbfc] rounded-xl overflow-hidden shadow-2xl">

              {/* Report header — gold accent bar */}
              <div className="bg-gradient-to-r from-[#D4AF37] to-[#B8941F] px-6 py-5 flex items-start justify-between">
                <div>
                  <h2 className="text-[20px] font-extrabold text-[#0A0D14] tracking-tight">Monthly Performance Report</h2>
                  <p className="text-[13px] text-[#0A0D14]/70 mt-0.5">{s.label}</p>
                </div>
                <button onClick={() => setShowReport(false)} className="p-1.5 rounded-lg bg-black/10 hover:bg-black/20 transition-colors mt-0.5">
                  <X size={16} className="text-[#0A0D14]" />
                </button>
              </div>

              {/* KPI row */}
              <div className="grid grid-cols-4 gap-0 border-b border-[#e2e8f0]">
                {[
                  { label: 'Total Members', value: s.totalMembers, accent: false },
                  { label: 'Active Members', value: s.uniqueActive, sub: `${s.activeRate}% active`, accent: true },
                  { label: 'New Members', value: s.newMembers, accent: false },
                  { label: 'Gym Check-ins', value: s.checkIns.toLocaleString(), accent: false },
                ].map((k, i) => (
                  <div key={i} className={`px-5 py-4 text-center ${i < 3 ? 'border-r border-[#e2e8f0]' : ''} ${k.accent ? 'bg-[#fefce8]' : ''}`}>
                    <p className="text-[26px] font-extrabold text-[#0f172a] leading-none tabular-nums">{k.value}</p>
                    <p className="text-[10px] text-[#64748b] uppercase tracking-wider font-semibold mt-1.5">{k.label}</p>
                    {k.sub && <p className="text-[10px] text-[#92700c] font-medium mt-0.5">{k.sub}</p>}
                  </div>
                ))}
              </div>

              <div className="px-6 py-5 space-y-5">

                {/* Training Activity table */}
                <div>
                  <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Dumbbell size={14} className="text-[#D4AF37]" />
                    Training Activity
                  </h3>
                  <div className="border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[#f1f5f9]">
                          <th className="text-left text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Metric</th>
                          <th className="text-right text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Workouts Completed', s.totalWorkouts.toLocaleString()],
                          ['Avg per Active Member', s.avgWorkoutsPerActive],
                          ['Total Volume Lifted', `${fmtVol} lbs`],
                          ['Total Training Time', fmtTime],
                          ['Personal Records Hit', s.prs],
                        ].map(([label, val], i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                            <td className="px-4 py-2.5 text-[12px] text-[#334155]">{label}</td>
                            <td className="px-4 py-2.5 text-[12px] text-[#0f172a] font-semibold text-right tabular-nums">{val}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Engagement table */}
                <div>
                  <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <TrendingUp size={14} className="text-[#D4AF37]" />
                    Engagement
                  </h3>
                  <div className="border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[#f1f5f9]">
                          <th className="text-left text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Metric</th>
                          <th className="text-right text-[10px] text-[#64748b] uppercase tracking-wider font-semibold px-4 py-2.5">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Active Rate', `${s.activeRate}%`],
                          ['Challenge Participations', s.challengeJoins],
                          ['Gym Check-ins', s.checkIns.toLocaleString()],
                          ['Personal Records', s.prs],
                        ].map(([label, val], i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                            <td className="px-4 py-2.5 text-[12px] text-[#334155]">{label}</td>
                            <td className="px-4 py-2.5 text-[12px] text-[#0f172a] font-semibold text-right tabular-nums">{val}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Highlights callout */}
                <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-4 py-3.5">
                  <p className="text-[11px] font-semibold text-[#14532d] mb-1">Key Highlights</p>
                  <p className="text-[11px] text-[#166534] leading-relaxed">
                    {s.uniqueActive} of {s.totalMembers} members were active this month ({s.activeRate}% active rate).
                    Members completed {s.totalWorkouts.toLocaleString()} workouts totaling {fmtVol} lbs of volume
                    and {fmtTime} of training. {s.prs} personal record{s.prs !== 1 ? 's were' : ' was'} set
                    and {s.newMembers} new member{s.newMembers !== 1 ? 's' : ''} joined.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-[#e2e8f0] bg-[#f8fafc] flex items-center justify-between">
                <p className="text-[10px] text-[#94a3b8]">Generated {format(new Date(), 'MMMM d, yyyy')} — Confidential</p>
                <button
                  onClick={handleDownloadReport}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-[12px] font-semibold bg-[#0f172a] text-white hover:bg-[#1e293b] transition-colors"
                >
                  <Download size={14} />
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
