import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, TrendingUp, AlertTriangle, Dumbbell, ChevronRight, Activity,
  Bell, ToggleLeft, ToggleRight, Save, CheckCircle, Clock,
  Zap, UserPlus, Trophy, Plus, X, ChevronDown,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { getRiskTier } from '../../lib/churnScore';

// ── Animated number (count-up) ────────────────────────────
const useCountUp = (end, duration = 800) => {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const target = typeof end === 'number' ? end : parseInt(end) || 0;
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, duration]);
  return value;
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

// ── Stat card ─────────────────────────────────────────────
const StatCard = ({ label, value, sub, borderColor, delay = 0 }) => {
  const isPercent = typeof value === 'string' && value.endsWith('%');
  const numericVal = isPercent ? parseInt(value) : (typeof value === 'number' ? value : parseInt(value) || 0);
  const animated = useCountUp(numericVal, 900);
  const displayVal = isPercent ? `${animated}%` : animated.toLocaleString();
  return (
    <FadeIn delay={delay}>
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 border-l-2 hover:border-white/10 hover:bg-[#111827] transition-all duration-300 group" style={{ borderLeftColor: borderColor }}>
        <p className="text-[24px] font-bold text-[#E5E7EB] leading-none tabular-nums tracking-tight">{displayVal}</p>
        <p className="text-[12px] text-[#9CA3AF] mt-1 group-hover:text-[#D1D5DB] transition-colors">{label}</p>
        {sub && <p className="text-[11px] text-[#4B5563] mt-0.5">{sub}</p>}
      </div>
    </FadeIn>
  );
};

// ── Risk tier mini-bar for the churn summary ────────────────
const TierRow = ({ label, count, color, total }) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-medium w-14 text-right" style={{ color }}>{label}</span>
      <div className="flex-1 h-1 bg-white/6 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold text-[#9CA3AF] w-7 text-right">{count}</span>
    </div>
  );
};

// ── Default follow-up settings ─────────────────────────────
const DEFAULT_SETTINGS = {
  enabled: false,
  threshold: 55,
  cooldown_days: 7,
  message_template: "Hey! We noticed you haven't been in lately. We miss you — come back and crush your goals. Your progress is waiting!",
  last_run_at: null,
  last_run_count: 0,
};

export default function AdminOverview() {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  const [loading, setLoading]           = useState(true);
  const [stats, setStats]               = useState({});
  const [atRisk, setAtRisk]             = useState([]);
  const [riskTiers, setRiskTiers]       = useState({ critical: 0, high: 0, medium: 0, low: 0 });
  const [chartData, setChartData]       = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [topExercises, setTopExercises] = useState([]);
  const [actionItems, setActionItems]   = useState([]);

  // Greeting hour (pre-computed for React Compiler purity)
  const [greetingHour, setGreetingHour] = useState(12);

  // Collapsible sections
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showRecentWorkouts, setShowRecentWorkouts] = useState(false);

  // Follow-up settings
  const [fupSettings, setFupSettings]   = useState(DEFAULT_SETTINGS);
  const [fupDraft, setFupDraft]         = useState(DEFAULT_SETTINGS);
  const [savingFup, setSavingFup]       = useState(false);
  const [fupSaved, setFupSaved]         = useState(false);

  // Drip campaign steps
  const [steps, setSteps] = useState([
    { step_number: 1, delay_days: 0, message_template: "Hey! We noticed you haven't been in lately. We miss you — come back and crush your goals!" },
  ]);

  const addStep = () => {
    setSteps(prev => [...prev, {
      step_number: prev.length + 1,
      delay_days: 3,
      message_template: '',
    }]);
  };

  const removeStep = (idx) => {
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_number: i + 1 })));
  };

  const updateStep = (idx, field, value) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  // ── Save follow-up settings + drip steps ─────────────────
  const saveSettings = async () => {
    if (!profile?.gym_id) return;
    setSavingFup(true);
    const gymId = profile.gym_id;

    // Save follow-up settings (use first step message as the legacy template)
    const payload = {
      gym_id:           gymId,
      enabled:          fupDraft.enabled,
      threshold:        fupDraft.threshold,
      cooldown_days:    fupDraft.cooldown_days,
      message_template: steps[0]?.message_template || fupDraft.message_template,
      updated_at:       new Date().toISOString(),
    };
    await supabase.from('churn_followup_settings').upsert(payload, { onConflict: 'gym_id' });

    // Save drip campaign steps — delete existing, then insert new
    await supabase.from('drip_campaign_steps').delete().eq('gym_id', gymId);
    if (steps.length > 0) {
      await supabase.from('drip_campaign_steps').insert(
        steps.map(s => ({
          gym_id: gymId,
          step_number: s.step_number,
          delay_days: s.delay_days,
          message_template: s.message_template,
        }))
      );
    }

    setFupSettings(s => ({ ...s, ...fupDraft }));
    setSavingFup(false);
    setFupSaved(true);
    setTimeout(() => setFupSaved(false), 2500);
  };

  // ── Load all data ──────────────────────────────────────
  useEffect(() => {
    setGreetingHour(new Date().getHours());
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const gymId          = profile.gym_id;
      const now            = new Date();
      const thirtyDaysAgo      = subDays(now, 30).toISOString();
      const twentyEightDaysAgo = subDays(now, 28).toISOString();

      // ── Parallel fetches ──────────────────────────────────
      const fortyEightHoursAgo = subDays(now, 2).toISOString();
      const threeDaysFromNow   = subDays(now, -3).toISOString();

      const [
        membersRes,
        sessionsRes,
        churnScoresRes,
        fupRes,
        notOnboardedRes,
        challengesEndingSoonRes,
        dripStepsRes,
      ] = await Promise.all([
        // All members
        supabase
          .from('profiles')
          .select('id, full_name, username, last_active_at, created_at, role, membership_status')
          .eq('gym_id', gymId)
          .eq('role', 'member'),

        // Workouts (last 28 days)
        supabase
          .from('workout_sessions')
          .select('profile_id, started_at, total_volume_lbs')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', twentyEightDaysAgo)
          .order('started_at', { ascending: false }),

        // Pre-computed churn scores (from cron edge function)
        supabase
          .from('churn_risk_scores')
          .select('profile_id, score, risk_tier, key_signals, computed_at')
          .eq('gym_id', gymId)
          .order('score', { ascending: false }),

        // Follow-up settings
        supabase
          .from('churn_followup_settings')
          .select('*')
          .eq('gym_id', gymId)
          .single(),

        // New members not onboarded (created within 48h, not onboarded)
        supabase
          .from('profiles')
          .select('id')
          .eq('gym_id', gymId)
          .eq('role', 'member')
          .eq('is_onboarded', false)
          .gte('created_at', fortyEightHoursAgo),

        // Challenges ending within next 3 days
        supabase
          .from('challenges')
          .select('id, title, end_date')
          .eq('gym_id', gymId)
          .eq('status', 'active')
          .gte('end_date', now.toISOString())
          .lte('end_date', threeDaysFromNow),

        // Drip campaign steps
        supabase
          .from('drip_campaign_steps')
          .select('*')
          .eq('gym_id', gymId)
          .order('step_number'),
      ]);

      const members  = membersRes.data || [];
      const sessions = sessionsRes.data || [];
      const churnScores = churnScoresRes.data || [];

      // De-duplicate churn scores (keep latest per profile)
      const latestScoreMap = {};
      churnScores.forEach(row => {
        if (!latestScoreMap[row.profile_id] || row.computed_at > latestScoreMap[row.profile_id].computed_at) {
          latestScoreMap[row.profile_id] = row;
        }
      });
      const latestScores = Object.values(latestScoreMap);

      // ── Churn risk tier counts ─────────────────────────────
      const tiers = { critical: 0, high: 0, medium: 0, low: 0 };
      latestScores.forEach(row => {
        if (tiers[row.risk_tier] !== undefined) tiers[row.risk_tier]++;
      });
      setRiskTiers(tiers);

      // ── At-risk members (critical + high) ──────────────────
      const memberMap = {};
      members.forEach(m => { memberMap[m.id] = m; });

      const nowMs = Date.now();
      const atRiskMembers = latestScores
        .filter(row => row.risk_tier === 'critical' || row.risk_tier === 'high')
        .slice(0, 6)
        .map(row => {
          const member = memberMap[row.profile_id];
          if (!member) return null;
          const lastSeenAt = member.last_active_at ?? member.created_at;
          return {
            ...member,
            score: row.score,
            risk_tier: row.risk_tier,
            key_signals: row.key_signals,
            computed_at: row.computed_at,
            daysInactive: Math.floor((nowMs - new Date(lastSeenAt)) / 86400000),
            neverActive: !member.last_active_at,
          };
        })
        .filter(Boolean);

      setAtRisk(atRiskMembers);

      // ── Stats ──────────────────────────────────────────────
      const activeIds = new Set(sessions.map(s => s.profile_id));
      const total = members.length;
      const atRiskCount = tiers.critical + tiers.high;

      // Retention = of members who existed 30d ago, how many are still not cancelled/banned
      const thirtyDaysAgoDate = subDays(now, 30).toISOString();
      const membersAt30d = members.filter(m => m.created_at <= thirtyDaysAgoDate);
      const retained30d = membersAt30d.filter(m =>
        m.membership_status !== 'cancelled' && m.membership_status !== 'banned'
      ).length;
      const retentionPct = membersAt30d.length > 0
        ? Math.round((retained30d / membersAt30d.length) * 100)
        : 0;

      // Engagement = members who logged ≥1 workout in 30d / total current members
      const engagementPct = total > 0
        ? Math.round((activeIds.size / total) * 100)
        : 0;

      setStats({
        totalMembers:  total,
        activeMembers: activeIds.size,
        retentionPct,
        atRiskCount,
        workoutsMonth: sessions.length,
        engagementPct,
      });

      // ── Action items (Today's Priorities) ─────────────────
      const items = [];

      // New members not onboarded
      const notOnboarded = notOnboardedRes.data || [];
      if (notOnboarded.length > 0) {
        items.push({
          icon: UserPlus,
          iconColor: 'text-[#D4AF37]',
          text: `${notOnboarded.length} new member${notOnboarded.length !== 1 ? 's' : ''} haven't completed onboarding`,
          link: '/admin/members',
        });
      }

      // Critical churn members
      const criticalCount = tiers.critical;
      if (criticalCount > 0) {
        items.push({
          icon: AlertTriangle,
          iconColor: 'text-[#DC2626]',
          text: `${criticalCount} member${criticalCount !== 1 ? 's' : ''} at critical churn risk`,
          link: '/admin/churn',
        });
      }

      // Challenges ending soon
      const endingSoon = challengesEndingSoonRes.data || [];
      endingSoon.forEach(ch => {
        const daysLeft = Math.max(0, Math.ceil((new Date(ch.end_date) - now) / 86400000));
        items.push({
          icon: Trophy,
          iconColor: 'text-amber-400',
          text: `"${ch.title}" ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
          link: '/admin/challenges',
        });
      });

      setActionItems(items);

      // ── Chart: workouts per day last 14 days ────────────────
      const dayMap = {};
      for (let i = 13; i >= 0; i--) {
        const d = format(subDays(now, i), 'MMM d');
        dayMap[d] = 0;
      }
      sessions.forEach(s => {
        const d = format(new Date(s.started_at), 'MMM d');
        if (d in dayMap) dayMap[d]++;
      });
      setChartData(Object.entries(dayMap).map(([date, count]) => ({ date, count })));
      // Enrich recent sessions with member name
      setRecentActivity(sessions.slice(0, 8).map(s => ({
        ...s,
        memberName: memberMap[s.profile_id]?.full_name || 'Unknown',
        memberInitial: memberMap[s.profile_id]?.full_name?.[0]?.toUpperCase() || '?',
      })));

      // ── Top exercises (last 30d) ────────────────────────────
      const { data: sessionRows } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', thirtyDaysAgo);
      const ids = (sessionRows || []).map(r => r.id);
      if (ids.length > 0) {
        const { data: exRows } = await supabase
          .from('session_exercises')
          .select('exercise_id, exercises(name)')
          .in('session_id', ids);
        const exCount = {};
        const exName  = {};
        (exRows || []).forEach(r => {
          exCount[r.exercise_id] = (exCount[r.exercise_id] || 0) + 1;
          if (r.exercises?.name) exName[r.exercise_id] = r.exercises.name;
        });
        setTopExercises(
          Object.entries(exCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([id, count]) => ({ id, name: exName[id] ?? id, count }))
        );
      }

      // ── Follow-up settings ──────────────────────────────────
      if (fupRes.data) {
        const activeSettings = { ...DEFAULT_SETTINGS, ...fupRes.data };
        setFupSettings(activeSettings);
        setFupDraft(activeSettings);
      }

      // ── Drip campaign steps ───────────────────────────────
      const dripSteps = dripStepsRes.data;
      if (dripSteps?.length) {
        setSteps(dripSteps);
      }

      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        <p className="text-[12px] text-[#4B5563] animate-pulse">Loading dashboard...</p>
      </div>
    </div>
  );

  // How long ago was cron last run
  const lastRunLabel = fupSettings.last_run_at
    ? formatDistanceToNow(new Date(fupSettings.last_run_at), { addSuffix: true })
    : null;

  const totalScored = riskTiers.critical + riskTiers.high + riskTiers.medium + riskTiers.low;

  const greetingLabel = greetingHour < 12 ? 'morning' : greetingHour < 17 ? 'afternoon' : 'evening';
  const firstName = profile?.full_name?.split(' ')[0] || '';

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      {/* Page header — contextual greeting */}
      <FadeIn>
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-[20px] font-bold text-[#E5E7EB]">
            Good {greetingLabel}{firstName ? `, ${firstName}` : ''}
          </h1>
          <span className="text-[12px] text-[#6B7280]">{format(new Date(), 'EEEE, MMMM d, yyyy')}</span>
        </div>
      </FadeIn>

      {/* Today's Priorities — only show if there are items */}
      {actionItems.length > 0 && (
        <FadeIn delay={60}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-4">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">Action Required</p>
            <div className="space-y-1">
              {actionItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 px-2.5 py-2 bg-[#111827]/60 rounded-lg cursor-pointer hover:bg-[#111827] hover:translate-x-0.5 transition-all duration-200"
                  onClick={() => navigate(item.link)}>
                  <item.icon size={13} className={item.iconColor} />
                  <p className="text-[12px] text-[#E5E7EB] flex-1">{item.text}</p>
                  <ChevronRight size={13} className="text-[#4B5563] group-hover:text-[#9CA3AF] transition-colors" />
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total Members"    value={stats.totalMembers}             sub="all time"                  borderColor="#6366F1" delay={100} />
        <StatCard label="Retention (30d)"  value={`${stats.retentionPct ?? 0}%`}  sub="still active vs 30d ago"   borderColor="#10B981" delay={150} />
        <StatCard label="At Risk"          value={stats.atRiskCount}              sub="critical + high risk"       borderColor="#EF4444" delay={200} />
        <StatCard label="Workouts (30d)"   value={stats.workoutsMonth}            sub="completed sessions"         borderColor="#D4AF37" delay={250} />
      </div>

      {/* Chart + Churn Risk Summary */}
      <FadeIn delay={350}>
      <div className="grid md:grid-cols-[1fr_320px] gap-3 mb-4">

        {/* Activity chart */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-3">Workouts — Last 14 Days</p>
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
              <Area type="monotone" dataKey="count" stroke="#D4AF37" strokeWidth={2} fill="url(#goldGrad)" dot={false} animationDuration={1200} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Churn Risk Summary */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Churn Risk</p>
            <button onClick={() => navigate('/admin/churn')} className="text-[11px] text-[#D4AF37] hover:underline flex items-center gap-0.5">
              View all <ChevronRight size={12} />
            </button>
          </div>

          {totalScored === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 text-center">
              <Clock size={18} className="text-[#4B5563] mb-2" />
              <p className="text-[12px] text-[#6B7280]">No scores yet</p>
              <p className="text-[11px] text-[#4B5563] mt-1">Scores are computed daily at 2 AM UTC</p>
            </div>
          ) : (
            <div className="space-y-2">
              <TierRow label="Critical" count={riskTiers.critical} color="#DC2626" total={totalScored} />
              <TierRow label="High"     count={riskTiers.high}     color="#EF4444" total={totalScored} />
              <TierRow label="Medium"   count={riskTiers.medium}   color="#F59E0B" total={totalScored} />
              <TierRow label="Low"      count={riskTiers.low}      color="#10B981" total={totalScored} />
            </div>
          )}

          {/* Cron status */}
          {fupSettings.last_run_at && (
            <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-white/6">
              <Activity size={11} className="text-emerald-500 flex-shrink-0" />
              <p className="text-[11px] text-[#6B7280]">
                Auto follow-up ran {lastRunLabel} · {fupSettings.last_run_count} sent
              </p>
            </div>
          )}
        </div>
      </div>

      </FadeIn>

      {/* At-risk members + Top exercises */}
      <FadeIn delay={420}>
      <div className="grid md:grid-cols-[1fr_300px] gap-3 mb-4">

        {/* At-risk members */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">At-Risk Members</p>
            <button onClick={() => navigate('/admin/churn')} className="text-[11px] text-[#D4AF37] hover:underline flex items-center gap-0.5">
              View all <ChevronRight size={12} />
            </button>
          </div>
          {atRisk.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 text-center">
              <p className="text-[12px] text-[#6B7280]">No at-risk members</p>
              <p className="text-[11px] text-[#4B5563] mt-1">Everyone is active</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {atRisk.map(m => {
                const tier = getRiskTier(m.score);
                const keySignal = m.key_signals?.[0] ?? null;
                return (
                  <div key={m.id} className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => navigate('/admin/churn')}>
                    <div className="w-7 h-7 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-[#9CA3AF]">{m.full_name?.[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                      <p className="text-[10px] text-[#6B7280] truncate">
                        {m.daysInactive}d inactive{m.neverActive ? ' (never logged)' : ''}
                        {keySignal && <span className="text-[#4B5563]"> · {keySignal}</span>}
                      </p>
                    </div>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: tier.color, background: tier.bg }}
                    >
                      {m.score}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top exercises */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 hover:border-white/10 transition-colors duration-300">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-2.5">Top Exercises (30d)</p>
          {topExercises.length === 0 ? (
            <p className="text-[12px] text-[#6B7280] text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-2">
              {topExercises.map((ex, i) => {
                const maxCount = topExercises[0].count;
                return (
                  <div key={ex.id}>
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-[12px] text-[#E5E7EB] truncate flex-1 mr-2">{ex.name}</p>
                      <p className="text-[10px] text-[#6B7280] flex-shrink-0">{ex.count}x</p>
                    </div>
                    <div className="h-1 rounded-full bg-white/6 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.round((ex.count / maxCount) * 100)}%`,
                          background: i === 0 ? '#D4AF37' : 'rgba(212,175,55,0.4)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      </FadeIn>

      {/* Recent workouts — collapsible */}
      <FadeIn delay={490}>
      <div className="bg-[#0F172A] border border-white/6 rounded-xl hover:border-white/10 transition-colors duration-300 mb-4">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Recent Workouts</p>
            {recentActivity.length > 0 && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-[#6B7280]">
                {recentActivity.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowRecentWorkouts(v => !v)}
            className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
          >
            {showRecentWorkouts ? 'Hide' : 'Show'}
            <ChevronDown size={13} className={`transition-transform ${showRecentWorkouts ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div className={`grid transition-all duration-300 ease-in-out ${showRecentWorkouts ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="px-4 pb-4 border-t border-white/6">
              {recentActivity.length === 0 ? (
                <p className="text-[12px] text-[#6B7280] text-center py-6">No workouts logged yet</p>
              ) : (
                <div className="divide-y divide-white/4">
                  {recentActivity.map(s => (
                    <div key={s.started_at + s.profile_id} className="flex items-center gap-3 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-[#9CA3AF]">{s.memberInitial}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{s.memberName}</p>
                        <p className="text-[10px] text-[#6B7280]">{format(new Date(s.started_at), 'MMM d, h:mm a')}</p>
                      </div>
                      {s.total_volume_lbs > 0 && (
                        <span className="text-[11px] font-semibold text-[#9CA3AF] tabular-nums">
                          {Math.round(s.total_volume_lbs).toLocaleString()} lbs
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </FadeIn>

      {/* ── Follow-Up Settings — collapsible ──────── */}
      <FadeIn delay={560}>
      <div className="bg-[#0F172A] border border-white/6 rounded-xl hover:border-white/10 transition-colors duration-300">
        {/* Compact header bar */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Automated Follow-Up</p>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              fupDraft.enabled
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-white/5 text-[#6B7280]'
            }`}>
              {fupDraft.enabled ? 'On' : 'Off'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFupDraft(d => ({ ...d, enabled: !d.enabled }))}
              className="flex items-center gap-1 transition-colors"
            >
              {fupDraft.enabled
                ? <ToggleRight size={22} className="text-[#D4AF37]" />
                : <ToggleLeft  size={22} className="text-[#4B5563]" />}
            </button>
            <button
              onClick={() => setShowFollowUp(v => !v)}
              className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors ml-1"
            >
              Configure
              <ChevronDown size={13} className={`transition-transform ${showFollowUp ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Expandable settings panel */}
        <div className={`grid transition-all duration-300 ease-in-out ${showFollowUp ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1 border-t border-white/6">
            <p className="text-[11px] text-[#6B7280] mb-3">
              Runs daily at 2 AM UTC — sends in-app notifications to at-risk members
            </p>

            {/* Last run status */}
            {fupSettings.last_run_at && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-500/8 border border-emerald-500/15 rounded-lg">
                <Activity size={12} className="text-emerald-400 flex-shrink-0" />
                <p className="text-[11px] text-emerald-400">
                  Last run {lastRunLabel}
                  {' · '}{fupSettings.last_run_count} notification{fupSettings.last_run_count !== 1 ? 's' : ''} sent
                </p>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3 mb-4">
              {/* Threshold */}
              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1.5">Risk Threshold</label>
                <div className="flex gap-2">
                  {[
                    { label: 'Medium (30%+)', value: 30 },
                    { label: 'High (55%+)', value: 55 },
                    { label: 'Critical (80%+)', value: 80 },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFupDraft(d => ({ ...d, threshold: opt.value }))}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                        fupDraft.threshold === opt.value
                          ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]'
                          : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cooldown */}
              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1.5">Cooldown Between Notifications</label>
                <div className="flex gap-2">
                  {[3, 7, 14, 30].map(days => (
                    <button
                      key={days}
                      onClick={() => setFupDraft(d => ({ ...d, cooldown_days: days }))}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                        fupDraft.cooldown_days === days
                          ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]'
                          : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'
                      }`}
                    >
                      {`${days}d`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Drip Campaign Steps Timeline */}
            <div className="mb-4">
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-2">Campaign Steps</label>
              <p className="text-[10px] text-[#4B5563] mb-2.5">
                Sent as in-app notifications · members see them in their notification bell
              </p>

              <div className="space-y-0">
                {steps.map((step, i) => (
                  <div key={i} className="flex gap-2.5">
                    {/* Timeline line + dot */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0 z-10">
                        <span className="text-[10px] font-bold text-[#D4AF37]">{i + 1}</span>
                      </div>
                      {i < steps.length - 1 && <div className="w-px flex-1 bg-white/8 my-1" />}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 pb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-medium text-[#E5E7EB]">
                          {step.delay_days === 0 ? 'Immediately' : `After ${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}`}
                        </span>
                        {i > 0 && (
                          <select
                            value={step.delay_days}
                            onChange={e => updateStep(i, 'delay_days', Number(e.target.value))}
                            className="bg-[#111827] border border-white/6 rounded-md px-2 py-0.5 text-[10px] text-[#9CA3AF] outline-none"
                          >
                            {[1,2,3,5,7,10,14,21,30].map(d => (
                              <option key={d} value={d}>{d}d</option>
                            ))}
                          </select>
                        )}
                        {steps.length > 1 && (
                          <button onClick={() => removeStep(i)} className="ml-auto text-[#6B7280] hover:text-[#EF4444] transition-colors">
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      <textarea
                        rows={2}
                        value={step.message_template}
                        onChange={e => updateStep(i, 'message_template', e.target.value)}
                        className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
                        placeholder="Message to send..."
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Step */}
              {steps.length < 5 && (
                <button
                  onClick={addStep}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[#D4AF37] hover:text-[#E6C766] transition-colors mt-1.5"
                >
                  <Plus size={13} />
                  Add step
                </button>
              )}
            </div>

            {/* Save */}
            <div className="flex items-center gap-3">
              <button
                onClick={saveSettings}
                disabled={savingFup}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                  fupSaved
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-[#D4AF37] text-black hover:bg-[#E6C766]'
                } disabled:opacity-50`}
              >
                {fupSaved ? <CheckCircle size={13} /> : <Save size={13} />}
                {savingFup ? 'Saving…' : fupSaved ? 'Saved!' : 'Save Settings'}
              </button>

              <p className="text-[10px] text-[#4B5563] ml-auto">
                {stats.atRiskCount ?? 0} member{(stats.atRiskCount ?? 0) !== 1 ? 's' : ''} at critical/high risk
              </p>
            </div>
          </div>
          </div>
        </div>
      </div>
      </FadeIn>
    </div>
  );
}
