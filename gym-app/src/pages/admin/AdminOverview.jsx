import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, TrendingUp, AlertTriangle, Dumbbell, ChevronRight, Activity,
  Bell, ToggleLeft, ToggleRight, Play, Save, CheckCircle,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays } from 'date-fns';

// ── Churn score (0–100) ────────────────────────────────────
// signals: sessionsLast14, sessionsPrior14, streakBrokenAt, lastCheckinAt, hadAnyCheckins
export const churnScore = (member, {
  sessionsLast14   = 0,
  sessionsPrior14  = 0,
  streakBrokenAt   = null,
  lastCheckinAt    = null,
  hadAnyCheckins   = false,
} = {}) => {
  const now = Date.now();
  let score = 0;

  // 1. Days since last session (40 pts)
  const daysInactive = member.last_active_at
    ? (now - new Date(member.last_active_at)) / 86400000
    : 999;
  if      (daysInactive > 21) score += 40;
  else if (daysInactive > 14) score += 30;
  else if (daysInactive > 7)  score += 15;

  // 2. Workout frequency trend — last 14d vs prior 14d (30 pts)
  if (sessionsLast14 === 0 && sessionsPrior14 > 0) score += 30;
  else if (sessionsLast14 === 0 && sessionsPrior14 === 0) score += 12;
  else if (sessionsPrior14 > 0) {
    const decline = (sessionsPrior14 - sessionsLast14) / sessionsPrior14;
    if      (decline > 0.75) score += 22;
    else if (decline > 0.5)  score += 14;
    else if (decline > 0.25) score += 6;
  }

  // 3. Streak broken in last 14 days (15 pts)
  if (streakBrokenAt) {
    const daysSinceBreak = (now - new Date(streakBrokenAt)) / 86400000;
    if (daysSinceBreak <= 14) score += 15;
  }

  // 4. Check-in drop (15 pts)
  if (hadAnyCheckins && lastCheckinAt) {
    const daysSinceCheckin = (now - new Date(lastCheckinAt)) / 86400000;
    if      (daysSinceCheckin > 14) score += 15;
    else if (daysSinceCheckin > 7)  score += 7;
  }

  // 5. New member grace — joined <14 days ago
  const daysSinceJoined = (now - new Date(member.created_at)) / 86400000;
  if (daysSinceJoined < 14) score = Math.max(0, score - 20);

  return Math.min(Math.round(score), 100);
};

export const riskLabel = (score) => {
  if (score >= 61) return { label: 'At Risk',  color: 'text-red-400',     bg: 'bg-red-500/10',     dot: 'bg-red-400' };
  if (score >= 31) return { label: 'Watch',    color: 'text-amber-400',   bg: 'bg-amber-500/10',   dot: 'bg-amber-400' };
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

// ── Default follow-up settings ─────────────────────────────
const DEFAULT_SETTINGS = {
  enabled: false,
  threshold: 61,
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
  const [chartData, setChartData]       = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [topExercises, setTopExercises] = useState([]);

  // All scored members (needed for follow-up)
  const scoredMembersRef = useRef([]);
  const churnDataRef     = useRef({ followupMap: {}, lastCheckinMap: {}, hadCheckinSet: new Set() });

  // Follow-up settings
  const [fupSettings, setFupSettings]   = useState(DEFAULT_SETTINGS);
  const [fupDraft, setFupDraft]         = useState(DEFAULT_SETTINGS);
  const [fupSettingsId, setFupSettingsId] = useState(null); // whether row exists
  const [savingFup, setSavingFup]       = useState(false);
  const [runningFup, setRunningFup]     = useState(false);
  const [fupResult, setFupResult]       = useState(null); // { count, ts }
  const [fupSaved, setFupSaved]         = useState(false);

  // ── Run follow-ups ─────────────────────────────────────
  const runFollowups = useCallback(async (settings, scored, gymId) => {
    setRunningFup(true);
    setFupResult(null);
    try {
      const now         = new Date();
      const cooldownMs  = settings.cooldown_days * 86400000;
      const { followupMap } = churnDataRef.current;

      const toFollowUp = scored.filter(m => {
        if (m.score < settings.threshold) return false;
        if (settings.cooldown_days === 0) return true;
        const lastSent = followupMap[m.id];
        if (!lastSent) return true;
        return (now - new Date(lastSent)) >= cooldownMs;
      });

      if (toFollowUp.length > 0) {
        // Send in-app notifications
        await supabase.from('notifications').insert(
          toFollowUp.map(m => ({
            profile_id: m.id,
            gym_id:     gymId,
            type:       'churn_followup',
            title:      'We miss you! 👋',
            body:       settings.message_template,
          }))
        );

        // Upsert churn_risk_scores with followup_sent_at
        await supabase.from('churn_risk_scores').upsert(
          toFollowUp.map(m => ({
            profile_id:       m.id,
            gym_id:           gymId,
            risk_score:       m.score / 100,
            is_flagged:       true,
            followup_sent_at: now.toISOString(),
            computed_at:      now.toISOString(),
          })),
          { onConflict: 'profile_id' }
        );

        // Update local followup map so we don't double-send on re-run
        toFollowUp.forEach(m => { churnDataRef.current.followupMap[m.id] = now.toISOString(); });
      }

      // Update last_run_at and count
      const runMeta = { last_run_at: now.toISOString(), last_run_count: toFollowUp.length, updated_at: now.toISOString() };
      if (fupSettingsId) {
        await supabase.from('churn_followup_settings').update(runMeta).eq('gym_id', gymId);
      } else {
        await supabase.from('churn_followup_settings').upsert({ gym_id: gymId, ...settings, ...runMeta });
      }

      setFupSettings(s => ({ ...s, ...runMeta }));
      setFupDraft(s => ({ ...s, ...runMeta }));
      setFupResult({ count: toFollowUp.length, ts: now });
    } catch (err) {
      console.error('Follow-up run failed:', err);
    }
    setRunningFup(false);
  }, [fupSettingsId]);

  // ── Save settings ──────────────────────────────────────
  const saveSettings = async () => {
    if (!profile?.gym_id) return;
    setSavingFup(true);
    const payload = {
      gym_id:           profile.gym_id,
      enabled:          fupDraft.enabled,
      threshold:        fupDraft.threshold,
      cooldown_days:    fupDraft.cooldown_days,
      message_template: fupDraft.message_template,
      updated_at:       new Date().toISOString(),
    };
    await supabase.from('churn_followup_settings').upsert(payload, { onConflict: 'gym_id' });
    setFupSettings(s => ({ ...s, ...fupDraft }));
    setFupSettingsId(true);
    setSavingFup(false);
    setFupSaved(true);
    setTimeout(() => setFupSaved(false), 2500);
  };

  // ── Load all data ──────────────────────────────────────
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const gymId          = profile.gym_id;
      const now            = new Date();
      const thirtyDaysAgo      = subDays(now, 30).toISOString();
      const twentyEightDaysAgo = subDays(now, 28).toISOString();
      const fourteenDaysAgo    = subDays(now, 14).toISOString();

      // All members
      const { data: members } = await supabase
        .from('profiles')
        .select('id, full_name, username, last_active_at, created_at, role')
        .eq('gym_id', gymId)
        .eq('role', 'member');

      // Workouts
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('profile_id, started_at, total_volume_lbs')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', twentyEightDaysAgo)
        .order('started_at', { ascending: false });

      const activeIds      = new Set((sessions || []).map(s => s.profile_id));
      const sessionsLast14  = {};
      const sessionsPrior14 = {};
      (sessions || []).forEach(s => {
        if (s.started_at >= fourteenDaysAgo) {
          sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
        } else {
          sessionsPrior14[s.profile_id] = (sessionsPrior14[s.profile_id] || 0) + 1;
        }
      });

      // Streak data
      const { data: streakRows } = await supabase
        .from('streak_cache')
        .select('profile_id, streak_broken_at')
        .in('profile_id', (members || []).map(m => m.id));
      const streakMap = {};
      (streakRows || []).forEach(r => { streakMap[r.profile_id] = r.streak_broken_at; });

      // Check-in data
      const { data: checkinRows } = await supabase
        .from('check_ins')
        .select('profile_id, checked_in_at')
        .eq('gym_id', gymId)
        .order('checked_in_at', { ascending: false });
      const lastCheckinMap = {};
      const hadCheckinSet  = new Set();
      (checkinRows || []).forEach(r => {
        hadCheckinSet.add(r.profile_id);
        if (!lastCheckinMap[r.profile_id]) lastCheckinMap[r.profile_id] = r.checked_in_at;
      });

      // Existing churn follow-up timestamps
      const { data: churnRows } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, followup_sent_at')
        .eq('gym_id', gymId);
      const followupMap = {};
      (churnRows || []).forEach(r => { if (r.followup_sent_at) followupMap[r.profile_id] = r.followup_sent_at; });

      // Store for follow-up runner
      churnDataRef.current = { followupMap, lastCheckinMap, hadCheckinSet };

      // Compute churn scores
      const scored = (members || []).map(m => ({
        ...m,
        score: churnScore(m, {
          sessionsLast14:  sessionsLast14[m.id]  ?? 0,
          sessionsPrior14: sessionsPrior14[m.id] ?? 0,
          streakBrokenAt:  streakMap[m.id]       ?? null,
          lastCheckinAt:   lastCheckinMap[m.id]  ?? null,
          hadAnyCheckins:  hadCheckinSet.has(m.id),
        }),
        recentWorkouts: sessionsLast14[m.id] ?? 0,
      }));

      scoredMembersRef.current = scored;

      const atRiskMembers = scored
        .filter(m => m.score >= 61)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      setAtRisk(atRiskMembers);

      const total = (members || []).length;
      setStats({
        totalMembers:  total,
        activeMembers: activeIds.size,
        retentionPct:  total > 0 ? Math.round((activeIds.size / total) * 100) : 0,
        atRiskCount:   scored.filter(m => m.score >= 61).length,
        workoutsMonth: (sessions || []).length,
      });

      // Chart: workouts per day last 14 days
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
      setRecentActivity((sessions || []).slice(0, 8));

      // Top exercises (last 30d)
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

      // Load follow-up settings
      const { data: fupRow } = await supabase
        .from('churn_followup_settings')
        .select('*')
        .eq('gym_id', gymId)
        .single();

      let activeSettings = DEFAULT_SETTINGS;
      if (fupRow) {
        activeSettings = { ...DEFAULT_SETTINGS, ...fupRow };
        setFupSettings(activeSettings);
        setFupDraft(activeSettings);
        setFupSettingsId(true);
      }

      setLoading(false);

      // Auto-trigger if enabled and hasn't run in >23h
      if (activeSettings.enabled) {
        const lastRun = activeSettings.last_run_at ? new Date(activeSettings.last_run_at) : null;
        const hoursAgo = lastRun ? (Date.now() - lastRun) / 3600000 : Infinity;
        if (hoursAgo >= 23) {
          runFollowups(activeSettings, scored, gymId);
        }
      }
    };
    load();
  }, [profile?.gym_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );

  const lastRunAgo = fupSettings.last_run_at
    ? Math.round((Date.now() - new Date(fupSettings.last_run_at)) / 3600000)
    : null;

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Overview</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">Your gym at a glance</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Users}         label="Total Members"    value={stats.totalMembers}             sub="all time" />
        <StatCard icon={TrendingUp}    label="Retention (30d)"  value={`${stats.retentionPct ?? 0}%`}  sub="logged ≥1 workout" />
        <StatCard icon={AlertTriangle} label="At Risk"          value={stats.atRiskCount}              sub="churn score ≥ 61" accent="bg-red-500/15" />
        <StatCard icon={Dumbbell}      label="Workouts (30d)"   value={stats.workoutsMonth}            sub="completed sessions" />
      </div>

      {/* Chart + At-risk */}
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
                const lastSeenAt = m.last_active_at ?? m.created_at;
                const daysInactive = Math.floor((Date.now() - new Date(lastSeenAt)) / 86400000);
                const neverActive = !m.last_active_at;
                const followedUp = churnDataRef.current.followupMap[m.id];
                return (
                  <div key={m.id} className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => navigate('/admin/members')}>
                    <div className="w-7 h-7 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-bold text-[#9CA3AF]">{m.full_name[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {daysInactive}d inactive{neverActive ? ' (never logged)' : ''}
                        {followedUp && <span className="text-emerald-500/70"> · notified</span>}
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

      {/* Recent sessions + Top exercises */}
      <div className="grid md:grid-cols-[1fr_300px] gap-4 mb-4">
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
                  {s.total_volume_lbs > 0 && (
                    <span className="text-[12px] font-semibold text-[#9CA3AF]">
                      {Math.round(s.total_volume_lbs).toLocaleString()} lbs
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top exercises */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
          <p className="text-[14px] font-semibold text-[#E5E7EB] mb-3">Top Exercises (30d)</p>
          {topExercises.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-2.5">
              {topExercises.map((ex, i) => {
                const maxCount = topExercises[0].count;
                return (
                  <div key={ex.id}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[13px] text-[#E5E7EB] truncate flex-1 mr-2">{ex.name}</p>
                      <p className="text-[11px] text-[#6B7280] flex-shrink-0">{ex.count}×</p>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
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

      {/* ── Automated Follow-Up ─────────────────────────────── */}
      <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Bell size={15} className="text-amber-400" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[#E5E7EB]">Automated Follow-Up</p>
              <p className="text-[11px] text-[#6B7280]">
                Sends in-app notifications to at-risk members automatically
              </p>
            </div>
          </div>
          {/* Enable toggle */}
          <button
            onClick={() => setFupDraft(d => ({ ...d, enabled: !d.enabled }))}
            className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
          >
            {fupDraft.enabled
              ? <ToggleRight size={26} className="text-[#D4AF37]" />
              : <ToggleLeft  size={26} className="text-[#4B5563]" />}
            <span className={fupDraft.enabled ? 'text-[#D4AF37]' : 'text-[#6B7280]'}>
              {fupDraft.enabled ? 'On' : 'Off'}
            </span>
          </button>
        </div>

        {/* Status line */}
        {fupSettings.last_run_at && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-500/8 border border-emerald-500/15 rounded-xl">
            <Activity size={12} className="text-emerald-400 flex-shrink-0" />
            <p className="text-[12px] text-emerald-400">
              Last run {lastRunAgo === 0 ? 'just now' : `${lastRunAgo}h ago`}
              {' · '}{fupSettings.last_run_count} notification{fupSettings.last_run_count !== 1 ? 's' : ''} sent
            </p>
          </div>
        )}

        {/* Run result flash */}
        {fupResult && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-[#D4AF37]/8 border border-[#D4AF37]/20 rounded-xl">
            <CheckCircle size={12} className="text-[#D4AF37] flex-shrink-0" />
            <p className="text-[12px] text-[#D4AF37]">
              {fupResult.count === 0
                ? 'No members need a follow-up right now.'
                : `${fupResult.count} member${fupResult.count !== 1 ? 's' : ''} notified successfully.`}
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {/* Threshold */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Risk Threshold</label>
            <div className="flex gap-2">
              {[{ label: 'Watch (31+)', value: 31 }, { label: 'At Risk (61+)', value: 61 }].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setFupDraft(d => ({ ...d, threshold: opt.value }))}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-medium transition-colors border ${
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
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Cooldown Between Notifications</label>
            <div className="flex gap-2">
              {[0, 3, 7, 14, 30].map(days => (
                <button
                  key={days}
                  onClick={() => setFupDraft(d => ({ ...d, cooldown_days: days }))}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-medium transition-colors border ${
                    fupDraft.cooldown_days === days
                      ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]'
                      : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
                >
                  {days === 0 ? 'None' : `${days}d`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Message template */}
        <div className="mb-4">
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Notification Message</label>
          <textarea
            rows={3}
            value={fupDraft.message_template}
            onChange={e => setFupDraft(d => ({ ...d, message_template: e.target.value }))}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
          />
          <p className="text-[11px] text-[#4B5563] mt-1">
            Sent as an in-app notification · members see it in their notification bell
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={saveSettings}
            disabled={savingFup}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
              fupSaved
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-[#D4AF37] text-black hover:bg-[#E6C766]'
            } disabled:opacity-50`}
          >
            {fupSaved ? <CheckCircle size={14} /> : <Save size={14} />}
            {savingFup ? 'Saving…' : fupSaved ? 'Saved!' : 'Save Settings'}
          </button>

          <button
            onClick={() => runFollowups(fupDraft, scoredMembersRef.current, profile.gym_id)}
            disabled={runningFup}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold border border-white/8 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors disabled:opacity-50"
          >
            <Play size={13} />
            {runningFup ? 'Running…' : 'Run Now'}
          </button>

          <p className="text-[11px] text-[#4B5563] ml-auto">
            {stats.atRiskCount ?? 0} member{(stats.atRiskCount ?? 0) !== 1 ? 's' : ''} currently at risk
          </p>
        </div>
      </div>
    </div>
  );
}
