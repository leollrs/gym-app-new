import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, TrendingUp, AlertTriangle, Dumbbell, ChevronRight, Activity,
  Bell, ToggleLeft, ToggleRight, Save, CheckCircle, Clock,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { getRiskTier } from '../../lib/churnScore';

// ── Stat card ─────────────────────────────────────────────
const StatCard = ({ icon: IconCmp, label, value, sub, accent }) => (
  <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
    <div className="flex items-start justify-between mb-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent ?? 'bg-[#D4AF37]/10'}`}>
        <IconCmp size={17} className={accent ? 'text-white' : 'text-[#D4AF37]'} />
      </div>
    </div>
    <p className="text-[28px] font-bold text-[#E5E7EB] leading-none">{value}</p>
    <p className="text-[13px] text-[#9CA3AF] mt-1">{label}</p>
    {sub && <p className="text-[11px] text-[#6B7280] mt-0.5">{sub}</p>}
  </div>
);

// ── Risk tier mini-bar for the churn summary ────────────────
const TierRow = ({ label, count, color, total }) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-medium w-16 text-right" style={{ color }}>{label}</span>
      <div className="flex-1 h-1.5 bg-white/6 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[12px] font-bold text-[#9CA3AF] w-8 text-right">{count}</span>
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

  // Follow-up settings
  const [fupSettings, setFupSettings]   = useState(DEFAULT_SETTINGS);
  const [fupDraft, setFupDraft]         = useState(DEFAULT_SETTINGS);
  const [savingFup, setSavingFup]       = useState(false);
  const [fupSaved, setFupSaved]         = useState(false);

  // ── Save follow-up settings ──────────────────────────────
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

      // ── Parallel fetches ──────────────────────────────────
      const [
        membersRes,
        sessionsRes,
        churnScoresRes,
        fupRes,
      ] = await Promise.all([
        // All members
        supabase
          .from('profiles')
          .select('id, full_name, username, last_active_at, created_at, role')
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
      setStats({
        totalMembers:  total,
        activeMembers: activeIds.size,
        retentionPct:  total > 0 ? Math.round((activeIds.size / total) * 100) : 0,
        atRiskCount,
        workoutsMonth: sessions.length,
      });

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
      setRecentActivity(sessions.slice(0, 8));

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

      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );

  // How long ago was cron last run
  const lastRunLabel = fupSettings.last_run_at
    ? formatDistanceToNow(new Date(fupSettings.last_run_at), { addSuffix: true })
    : null;

  const totalScored = riskTiers.critical + riskTiers.high + riskTiers.medium + riskTiers.low;

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
        <StatCard icon={AlertTriangle} label="At Risk"          value={stats.atRiskCount}              sub="critical + high risk" accent="bg-red-500/15" />
        <StatCard icon={Dumbbell}      label="Workouts (30d)"   value={stats.workoutsMonth}            sub="completed sessions" />
      </div>

      {/* Chart + Churn Risk Summary */}
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

        {/* Churn Risk Summary — reads from pre-computed churn_risk_scores */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[14px] font-semibold text-[#E5E7EB]">Churn Risk</p>
            <button onClick={() => navigate('/admin/churn')} className="text-[11px] text-[#D4AF37] hover:underline flex items-center gap-0.5">
              View all <ChevronRight size={12} />
            </button>
          </div>

          {totalScored === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 text-center">
              <Clock size={20} className="text-[#4B5563] mb-2" />
              <p className="text-[13px] text-[#6B7280]">No scores yet</p>
              <p className="text-[11px] text-[#4B5563] mt-1">Scores are computed daily at 2 AM UTC</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <TierRow label="Critical" count={riskTiers.critical} color="#DC2626" total={totalScored} />
              <TierRow label="High"     count={riskTiers.high}     color="#EF4444" total={totalScored} />
              <TierRow label="Medium"   count={riskTiers.medium}   color="#F59E0B" total={totalScored} />
              <TierRow label="Low"      count={riskTiers.low}      color="#10B981" total={totalScored} />
            </div>
          )}

          {/* Cron status */}
          {fupSettings.last_run_at && (
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/6">
              <Activity size={11} className="text-emerald-500 flex-shrink-0" />
              <p className="text-[11px] text-[#6B7280]">
                Auto follow-up ran {lastRunLabel} · {fupSettings.last_run_count} sent
              </p>
            </div>
          )}
        </div>
      </div>

      {/* At-risk members + Top exercises */}
      <div className="grid md:grid-cols-[1fr_300px] gap-4 mb-4">

        {/* At-risk members */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-semibold text-[#E5E7EB]">At-Risk Members</p>
            <button onClick={() => navigate('/admin/churn')} className="text-[11px] text-[#D4AF37] hover:underline flex items-center gap-0.5">
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
                const tier = getRiskTier(m.score);
                const keySignal = m.key_signals?.[0] ?? null;
                return (
                  <div key={m.id} className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => navigate('/admin/churn')}>
                    <div className="w-8 h-8 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-bold text-[#9CA3AF]">{m.full_name?.[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                      <p className="text-[11px] text-[#6B7280] truncate">
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
                      <p className="text-[11px] text-[#6B7280] flex-shrink-0">{ex.count}x</p>
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

      {/* Recent workouts */}
      <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5 mb-4">
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

      {/* ── Follow-Up Settings (configures cron behavior) ──────── */}
      <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Bell size={15} className="text-amber-400" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[#E5E7EB]">Automated Follow-Up</p>
              <p className="text-[11px] text-[#6B7280]">
                Runs daily at 2 AM UTC — sends in-app notifications to at-risk members
              </p>
            </div>
          </div>
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

        {/* Last run status */}
        {fupSettings.last_run_at && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-500/8 border border-emerald-500/15 rounded-xl">
            <Activity size={12} className="text-emerald-400 flex-shrink-0" />
            <p className="text-[12px] text-emerald-400">
              Last run {lastRunLabel}
              {' · '}{fupSettings.last_run_count} notification{fupSettings.last_run_count !== 1 ? 's' : ''} sent
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {/* Threshold */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Risk Threshold</label>
            <div className="flex gap-2">
              {[
                { label: 'Medium (30%+)', value: 30 },
                { label: 'High (55%+)', value: 55 },
                { label: 'Critical (80%+)', value: 80 },
              ].map(opt => (
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
              {[3, 7, 14, 30].map(days => (
                <button
                  key={days}
                  onClick={() => setFupDraft(d => ({ ...d, cooldown_days: days }))}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-medium transition-colors border ${
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

        {/* Save */}
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

          <p className="text-[11px] text-[#4B5563] ml-auto">
            {stats.atRiskCount ?? 0} member{(stats.atRiskCount ?? 0) !== 1 ? 's' : ''} at critical/high risk
          </p>
        </div>
      </div>
    </div>
  );
}
