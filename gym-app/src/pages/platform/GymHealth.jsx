import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Heart, TrendingUp, TrendingDown, Minus, Search,
  ChevronRight, AlertTriangle, Shield,
  Activity, UserCheck, BarChart3, Sparkles,
  UserX, LogIn, Moon, UserPlus, RefreshCw,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { healthScoreFromStatsRow, healthTier } from '../../lib/platform/healthScore';
import ChartTooltip from '../../components/ChartTooltip';
import FadeIn from '../../components/platform/FadeIn';
import StatCard from '../../components/platform/StatCard';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import SortHeader from '../../components/platform/SortHeader';

// ── Health tier presentation (score math lives in lib/platform/healthScore) ──
// Keys match healthTier(): thriving / healthy / watch / critical, plus 'new'
// for gyms with 0 members (unscored — they used to read "Critical" and drag
// the platform average down before they ever launched).
const TIER_META = [
  { key: 'thriving', label: 'Thriving', range: '75+',   color: '#10B981', bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: Sparkles },
  { key: 'healthy',  label: 'Healthy',  range: '55–74', color: '#22C55E', bg: 'bg-green-500/15',   text: 'text-green-400',   icon: Heart },
  { key: 'watch',    label: 'Watch',    range: '40–54', color: '#F59E0B', bg: 'bg-amber-500/15',   text: 'text-amber-400',   icon: Activity },
  { key: 'critical', label: 'Critical', range: '<40',   color: '#EF4444', bg: 'bg-red-500/15',     text: 'text-red-400',     icon: Shield },
  { key: 'new',      label: 'New',      range: null,    color: '#6B7280', bg: 'bg-white/[0.06]',   text: 'text-[#9CA3AF]',   icon: UserPlus },
];
const TIER_BY_KEY = Object.fromEntries(TIER_META.map(m => [m.key, m]));

const getScoreColor = (score) => {
  if (score == null) return '#6B7280';
  if (score >= 75) return '#10B981';
  if (score >= 55) return '#22C55E';
  if (score >= 40) return '#F59E0B';
  return '#EF4444';
};

// platform_snapshots.snapshot_date is a DATE ('YYYY-MM-DD') — parse as LOCAL
// so the chart's axis doesn't drift a day back in Puerto Rico (UTC-4).
const parseDateOnly = (value) => {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

const isMissingTable = (error) => error?.code === '42P01';

// ── Main Component ───────────────────────────────────────────
export default function GymHealth() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [gyms, setGyms] = useState([]);
  const [stats, setStats] = useState([]);
  const [adminPresence, setAdminPresence] = useState([]);
  const [activityPulse, setActivityPulse] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [loadError, setLoadError] = useState(null);      // critical: gyms/stats failed
  const [degradedSources, setDegradedSources] = useState([]); // non-critical failures
  const [reloadKey, setReloadKey] = useState(0);

  // Table state
  const [sortKey, setSortKey] = useState('healthScore');
  const [sortDir, setSortDir] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    document.title = `${t('platform.gymHealth.title', 'Gym Health')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  // ── Fetch all data ─────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setLoadError(null);
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();

      // Aggregates are computed server-side (one row per gym) so this scales
      // with gym count, not member count — see migrations 0437/0540.
      const [gymRes, statsRes, adminRes, pulseRes, snapRes] = await Promise.all([
        supabase.from('gyms').select('id, name, slug, is_active, created_at'),
        supabase.rpc('platform_gym_stats'),
        supabase.from('admin_presence').select('gym_id, last_seen_at').gte('last_seen_at', sevenDaysAgo),
        supabase.rpc('platform_gym_activity_pulse', { p_window_days: 14 }),
        // Weekly captures (0545). Tolerate absence pre-apply — the trend
        // chart simply stays in its single-point empty state.
        supabase.from('platform_snapshots')
          .select('snapshot_date, gym_id, data')
          .eq('kind', 'gym_stats')
          .order('snapshot_date', { ascending: true }),
      ]);

      // supabase-js v2 never throws — surface failures instead of rendering
      // zeros that look like real (terrible) numbers.
      if (gymRes.error || statsRes.error) {
        setLoadError((gymRes.error || statsRes.error).message || 'Query failed');
      }
      const degraded = [];
      if (adminRes.error) degraded.push(t('platform.gymHealth.srcAdminPresence', 'admin presence'));
      if (pulseRes.error) degraded.push(t('platform.gymHealth.srcActivityPulse', 'activity pulse'));
      if (snapRes.error && !isMissingTable(snapRes.error)) degraded.push(t('platform.gymHealth.srcSnapshots', 'history snapshots'));
      setDegradedSources(degraded);

      setGyms(gymRes.data || []);
      setStats(statsRes.data || []);
      setAdminPresence(adminRes.data || []);
      setActivityPulse(pulseRes.data || []);
      setSnapshots(snapRes.data || []);
      setLoading(false);
    };

    fetchAll();
  }, [reloadKey, t]);

  const retry = useCallback(() => setReloadKey(k => k + 1), []);

  // ── Compute per-gym health data (lib formula — single source of truth) ──
  const gymHealthData = useMemo(() => {
    const byId = Object.fromEntries(stats.map(s => [s.gym_id, s]));
    return gyms.map(gym => {
      const s = byId[gym.id] || {};
      const totalMembers = s.member_count || 0;
      const activeMembers30d = s.active_30d || 0;
      const totalSessions30d = s.sessions_30d || 0;
      const checkedInMembers30d = s.checkedin_30d || 0;
      const onboardedMembers = s.onboarded_count || 0;
      const avgChurnScore = +(s.avg_churn_score || 0);
      const newMembers30d = s.new_30d || 0;

      const sessionsPerMember = totalMembers > 0 ? +(totalSessions30d / totalMembers).toFixed(1) : 0;
      const checkinRate = totalMembers > 0 ? +((checkedInMembers30d / totalMembers) * 100).toFixed(1) : 0;
      const onboardingPct = totalMembers > 0 ? +((onboardedMembers / totalMembers) * 100).toFixed(1) : 0;
      const activePct = totalMembers > 0 ? +((activeMembers30d / totalMembers) * 100).toFixed(1) : 0;

      const healthScore = healthScoreFromStatsRow(s); // null when 0 members → tier 'new'
      const tier = TIER_BY_KEY[healthTier(healthScore)] || TIER_BY_KEY.new;
      const hasRecentAdmin = adminPresence.some(a => a.gym_id === gym.id);

      return {
        id: gym.id, name: gym.name, slug: gym.slug, isActive: gym.is_active,
        healthScore, tier, totalMembers, activePct, sessionsPerMember, checkinRate,
        avgChurnScore, onboardingPct, hasRecentAdmin, newMembers30d, activeMembers30d,
      };
    });
  }, [gyms, stats, adminPresence]);

  // ── Health distribution counts ─────────────────────────────
  const healthDistribution = useMemo(() => {
    const counts = { thriving: 0, healthy: 0, watch: 0, critical: 0, new: 0 };
    gymHealthData.forEach(g => { counts[g.tier.key] = (counts[g.tier.key] || 0) + 1; });
    return counts;
  }, [gymHealthData]);

  // Average over SCORED, ACTIVE gyms only — unscored "new" gyms and paused
  // gyms used to drag this down (the pulse RPC excludes inactive gyms too).
  const avgHealthScore = useMemo(() => {
    const scored = gymHealthData.filter(g => g.healthScore != null && g.isActive !== false);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((s, g) => s + g.healthScore, 0) / scored.length);
  }, [gymHealthData]);

  // ── Trend series from weekly snapshots (0545) ──────────────
  // Avg health score per snapshot_date via the same lib formula over the
  // frozen stats row, plus today's live point. Renders once ≥2 points exist.
  const trendChartData = useMemo(() => {
    const byDate = new Map();
    snapshots.forEach((row) => {
      if (!row?.data) return;
      if (row.data.is_active === false) return;
      const score = healthScoreFromStatsRow(row.data);
      if (score == null) return;
      const list = byDate.get(row.snapshot_date) || [];
      list.push(score);
      byDate.set(row.snapshot_date, list);
    });
    const points = Array.from(byDate.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([dateStr, scores]) => ({
        week: format(parseDateOnly(dateStr), 'MMM d'),
        score: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      }));
    if (avgHealthScore != null) {
      points.push({ week: format(new Date(), 'MMM d'), score: avgHealthScore });
    }
    return points;
  }, [snapshots, avgHealthScore]);

  // Per-gym score at the most recent snapshot — feeds the real trend arrows.
  const prevScoreByGym = useMemo(() => {
    if (!snapshots.length) return {};
    const latestDate = snapshots.reduce((max, r) => (String(r.snapshot_date) > max ? String(r.snapshot_date) : max), '');
    const map = {};
    snapshots.forEach((r) => {
      if (String(r.snapshot_date) !== latestDate || !r?.data) return;
      const score = healthScoreFromStatsRow(r.data);
      if (score != null) map[r.gym_id] = score;
    });
    return map;
  }, [snapshots]);

  // ── Filtered + sorted gym table ────────────────────────────
  const filteredGyms = useMemo(() => {
    let list = gymHealthData;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(g => g.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const aVal = a[sortKey] ?? -1; // null (unscored) sorts below 0
      const bVal = b[sortKey] ?? -1;
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [gymHealthData, searchQuery, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // ── Insights ───────────────────────────────────────────────
  const insights = useMemo(() => {
    const scored = gymHealthData.filter(g => g.healthScore != null);
    const sorted = [...scored].sort((a, b) => b.healthScore - a.healthScore);

    // Honest "top" — the gym with the highest health score (same formula
    // as the table), not an undocumented engagement blend.
    const topScore = sorted[0] || null;

    // Needs attention: top 3 critical (scored gyms only — "new" isn't a risk)
    const needsAttention = sorted
      .filter(g => g.healthScore < 40)
      .sort((a, b) => a.healthScore - b.healthScore)
      .slice(0, 3)
      .map(g => {
        let issue = t('platform.gymHealth.issue.lowOverall', 'Low overall health');
        if (g.activePct < 20) issue = t('platform.gymHealth.issue.veryLowActivity', { pct: g.activePct, defaultValue: 'Very low activity ({{pct}}%)' });
        else if (g.avgChurnScore > 60) issue = t('platform.gymHealth.issue.highChurn', { score: g.avgChurnScore, defaultValue: 'High churn risk ({{score}})' });
        else if (g.checkinRate < 10) issue = t('platform.gymHealth.issue.minimalCheckins', { pct: g.checkinRate, defaultValue: 'Minimal check-ins ({{pct}}%)' });
        else if (g.onboardingPct < 30) issue = t('platform.gymHealth.issue.poorOnboarding', { pct: g.onboardingPct, defaultValue: 'Poor onboarding ({{pct}}%)' });
        return { ...g, issue };
      });

    // Onboarding gap: gyms with <50% onboarding
    const onboardingGap = sorted
      .filter(g => g.onboardingPct < 50 && g.totalMembers > 0)
      .sort((a, b) => a.onboardingPct - b.onboardingPct)
      .slice(0, 5);

    // Admin inactive: gyms where no admin logged in for 7+ days
    const adminInactive = sorted
      .filter(g => !g.hasRecentAdmin && g.totalMembers > 0)
      .slice(0, 5);

    return { topScore, needsAttention, onboardingGap, adminInactive };
  }, [gymHealthData, t]);

  // ── Gyms going quiet ───────────────────────────────────────
  // Member activity (check-ins + completed workouts) this 14d window vs the
  // prior 14d, plus days since the gym's last activity of any kind. A gym
  // that HAD activity and is now cratering or silent is the earliest churn
  // signal we have — surfaced before the gym thinks about cancelling.
  const goingQuiet = useMemo(() => {
    const now = new Date().getTime();
    return activityPulse
      .map((g) => {
        const cur = Number(g.cur_checkins) + Number(g.cur_workouts);
        const prior = Number(g.prior_checkins) + Number(g.prior_workouts);
        const declinePct = prior > 0 ? Math.round(((prior - cur) / prior) * 100) : (cur === 0 ? 100 : 0);
        const daysSince = g.last_activity
          ? Math.floor((now - new Date(g.last_activity).getTime()) / 86400000)
          : null;
        return { ...g, cur, prior, declinePct, daysSince };
      })
      // Only gyms that were ever active (skip never-launched), and that are
      // either silent 7+ days or down 40%+ vs the prior window.
      .filter((g) => g.daysSince !== null && (g.daysSince >= 7 || (g.declinePct >= 40 && g.prior >= 3)))
      .sort((a, b) => (b.daysSince - a.daysSince) || (b.declinePct - a.declinePct))
      .slice(0, 8);
  }, [activityPulse]);

  // ── Trend arrow: REAL delta vs the latest snapshot ─────────
  // No snapshot for the gym (or unscored gym) → render nothing. The old
  // version mapped the score LEVEL to an arrow — fake motion.
  const TrendArrow = ({ current, prev }) => {
    if (current == null || prev == null) return null;
    const delta = current - prev;
    const title = `${delta >= 0 ? '+' : ''}${delta} ${t('platform.gymHealth.vsLastSnapshot', 'vs last snapshot')}`;
    return (
      <span title={title} className="inline-flex">
        {delta > 2 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          : delta < -2 ? <TrendingDown className="w-3.5 h-3.5 text-red-400" />
          : <Minus className="w-3.5 h-3.5 text-[#6B7280]" />}
      </span>
    );
  };

  // ── Render ─────────────────────────────────────────────────
  if (loading) return <PlatformSpinner />;

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-6xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-0.5 truncate">
          {t('platform.gymHealth.title', 'Gym Health')}
        </h1>
        <p className="text-[12px] text-[#6B7280] mb-6">
          {t('platform.gymHealth.subtitle', 'Health scores, tier distribution, and actionable insights')}
        </p>
      </FadeIn>

      {/* ── Critical load failure: banner + retry, no fake zeros ── */}
      {loadError && (
        <div className="bg-red-500/5 border border-red-500/25 rounded-xl p-5 mb-6 flex flex-col items-center text-center">
          <AlertTriangle className="w-5 h-5 text-red-400 mb-2" />
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">
            {t('platform.common.loadFailed', "Couldn't load this page's data")}
          </p>
          <p className="text-[11px] text-[#9CA3AF] mb-3 max-w-md">{loadError}</p>
          <button
            onClick={retry}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D4AF37]/15 text-[#D4AF37] text-[12px] font-semibold hover:bg-[#D4AF37]/25 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('platform.common.retry', 'Retry')}
          </button>
        </div>
      )}

      {!loadError && degradedSources.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-[12px] text-[#9CA3AF] flex-1">
            {t('platform.common.degraded', { sources: degradedSources.join(', '), defaultValue: 'Some data failed to load: {{sources}}. Affected sections may be incomplete.' })}
          </p>
          <button onClick={retry} className="text-[11px] font-semibold text-[#D4AF37] hover:text-[#E6C766] transition-colors flex-shrink-0">
            {t('platform.common.retry', 'Retry')}
          </button>
        </div>
      )}

      {!loadError && (<>
      {/* ── Section 1: Health Distribution Strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {TIER_META.map((tier, i) => (
          <StatCard
            key={tier.key}
            value={healthDistribution[tier.key]}
            label={t(`platform.gymHealth.tier.${tier.key}`, tier.label) + (tier.range ? ` (${tier.range})` : '')}
            icon={tier.icon}
            color={tier.color}
            delay={i * 50}
          />
        ))}
        <StatCard
          value={avgHealthScore == null ? '—' : avgHealthScore}
          label={t('platform.gymHealth.avgScoreActive', 'Avg Health (active gyms)')}
          icon={BarChart3}
          color="#D4AF37"
          delay={250}
        />
      </div>

      {/* ── Gyms going quiet — member-activity decline watchlist ── */}
      {goingQuiet.length > 0 && (
        <FadeIn delay={60}>
          <div className="bg-[#0F172A] border border-amber-500/20 rounded-xl p-4 mb-8">
            <div className="flex items-center gap-2 mb-1">
              <Moon size={15} className="text-amber-400" />
              <h2 className="text-[15px] font-semibold text-[#E5E7EB]">
                {t('platform.gymHealth.goingQuiet', 'Gyms going quiet')}
              </h2>
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full">
                {goingQuiet.length}
              </span>
            </div>
            <p className="text-[11px] text-[#6B7280] mb-3">
              {t('platform.gymHealth.goingQuietDesc', 'Member check-ins + workouts dropping or silent — the earliest churn signal. Last 14 days vs the 14 before.')}
            </p>
            <div className="space-y-1">
              {goingQuiet.map((g) => (
                <button
                  key={g.gym_id}
                  onClick={() => navigate(`/platform/gym/${g.gym_id}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-white/[0.03] transition-colors group"
                >
                  <span className="text-[13px] font-medium text-[#E5E7EB] truncate flex-1 group-hover:text-white">
                    {g.gym_name}
                  </span>
                  {g.declinePct > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 tabular-nums">
                      <TrendingDown size={12} />
                      {g.declinePct}%
                    </span>
                  )}
                  <span className="text-[11px] text-amber-400/90 tabular-nums w-20 text-right">
                    {g.daysSince === 0
                      ? t('platform.gymHealth.activeToday', 'active today')
                      : t('platform.gymHealth.quietDays', { count: g.daysSince, defaultValue: 'silent {{count}}d' })}
                  </span>
                  <ChevronRight size={13} className="text-[#4B5563] group-hover:text-[#D4AF37] transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </FadeIn>
      )}

      {/* ── Main content: Table + Insights ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left column: Chart + Table */}
        <div className="space-y-6 order-2 lg:order-1">
          {/* ── Section 2: Health Trend Chart ────────────────── */}
          <FadeIn delay={100}>
            <div className="bg-[#0F172A] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[15px] font-semibold text-[#E5E7EB]">
                  {t('platform.gymHealth.trendTitle', 'Platform Health Trend')}
                </h2>
                <span className="text-[11px] text-[#6B7280] bg-white/[0.04] px-2 py-1 rounded-full">
                  {t('platform.gymHealth.weeklySnapshots', 'Weekly snapshots')}
                </span>
              </div>
              {trendChartData.length <= 1 ? (
                <div className="h-[200px] flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3" style={{ background: `${getScoreColor(avgHealthScore)}18` }}>
                    <span className="text-[28px] font-bold" style={{ color: getScoreColor(avgHealthScore) }}>
                      {avgHealthScore == null ? '—' : avgHealthScore}
                    </span>
                  </div>
                  <p className="text-[13px] text-[#9CA3AF] mb-1">
                    {t('platform.gymHealth.currentScore', 'Current Platform Score')}
                  </p>
                  <p className="text-[11px] text-[#4B5563]">
                    {t('platform.gymHealth.firstSnapshot', 'First snapshot: this Sunday — the trend line starts there')}
                  </p>
                </div>
              ) : (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendChartData}>
                      <defs>
                        <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="week" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212,175,55,0.06)' }} />
                      <Area
                        type="monotone"
                        dataKey="score"
                        name={t('platform.gymHealth.healthScore', 'Health Score')}
                        stroke="#10B981"
                        strokeWidth={2}
                        fill="url(#healthGrad)"
                        dot={{ r: 5, strokeWidth: 2, fill: '#0F172A' }}
                        activeDot={{ r: 7, strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </FadeIn>

          {/* ── Section 3: Gym Health Rankings Table ─────────── */}
          <FadeIn delay={150}>
            <div className="bg-[#0F172A] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <h2 className="text-[15px] font-semibold text-[#E5E7EB]">
                  {t('platform.gymHealth.rankings', 'Gym Health Rankings')}
                </h2>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B7280]" />
                  <input
                    type="text"
                    placeholder={t('platform.gymHealth.searchPlaceholder', 'Search gyms...')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-white/[0.04] border border-white/[0.06] rounded-lg pl-9 pr-3 py-2 text-[12px] text-[#E5E7EB] placeholder:text-[#4B5563] w-full sm:w-56 outline-none focus:border-[#D4AF37]/40 transition-colors"
                  />
                </div>
              </div>

              {filteredGyms.length === 0 ? (
                <p className="text-[13px] text-[#6B7280] py-12 text-center">
                  {t('platform.gymHealth.noGyms', 'No gyms found')}
                </p>
              ) : (
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5 w-10">#</th>
                        <SortHeader label={t('platform.gymHealth.col.gym', 'Gym')} field="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label={t('platform.gymHealth.col.score', 'Score')} field="healthScore" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">
                          {t('platform.gymHealth.col.tier', 'Tier')}
                        </th>
                        <SortHeader label={t('platform.gymHealth.col.members', 'Members')} field="totalMembers" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label={t('platform.gymHealth.col.active', 'Active %')} field="activePct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label={t('platform.gymHealth.col.sessions', 'Sess/Mem')} field="sessionsPerMember" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label={t('platform.gymHealth.col.checkin', 'Check-in')} field="checkinRate" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label={t('platform.gymHealth.col.churn', 'Avg Churn')} field="avgChurnScore" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label={t('platform.gymHealth.col.onboard', 'Onboard %')} field="onboardingPct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5 w-10">
                          {t('platform.gymHealth.col.trend', '')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGyms.map((gym, i) => {
                        const tier = gym.tier;
                        return (
                          <tr
                            key={gym.id}
                            className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer"
                            onClick={() => navigate(`/platform/gym/${gym.id}`)}
                            role="button"
                            tabIndex={0}
                            aria-label={gym.name}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/platform/gym/${gym.id}`); } }}
                          >
                            <td className="px-3 py-3">
                              <span className="text-[12px] text-[#6B7280] tabular-nums">{i + 1}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-[13px] font-medium text-[#E5E7EB] truncate block max-w-[160px]">{gym.name}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className="text-[13px] font-bold tabular-nums"
                                style={{ color: getScoreColor(gym.healthScore) }}
                              >
                                {gym.healthScore == null ? '—' : gym.healthScore}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tier.bg} ${tier.text}`}>
                                {t(`platform.gymHealth.tier.${tier.key}`, tier.label)}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-[13px] text-[#E5E7EB] tabular-nums">{gym.totalMembers.toLocaleString()}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${
                                gym.activePct >= 50 ? 'bg-emerald-500/15 text-emerald-400' :
                                gym.activePct >= 30 ? 'bg-amber-500/15 text-amber-400' :
                                'bg-red-500/15 text-red-400'
                              }`}>
                                {gym.activePct}%
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-[13px] text-[#E5E7EB] tabular-nums">{gym.sessionsPerMember}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${
                                gym.checkinRate >= 40 ? 'bg-emerald-500/15 text-emerald-400' :
                                gym.checkinRate >= 20 ? 'bg-amber-500/15 text-amber-400' :
                                'bg-red-500/15 text-red-400'
                              }`}>
                                {gym.checkinRate}%
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${
                                gym.avgChurnScore <= 30 ? 'bg-emerald-500/15 text-emerald-400' :
                                gym.avgChurnScore <= 60 ? 'bg-amber-500/15 text-amber-400' :
                                'bg-red-500/15 text-red-400'
                              }`}>
                                {gym.avgChurnScore}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${
                                gym.onboardingPct >= 70 ? 'bg-emerald-500/15 text-emerald-400' :
                                gym.onboardingPct >= 50 ? 'bg-amber-500/15 text-amber-400' :
                                'bg-red-500/15 text-red-400'
                              }`}>
                                {gym.onboardingPct}%
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <TrendArrow current={gym.healthScore} prev={prevScoreByGym[gym.id]} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </FadeIn>
        </div>

        {/* ── Section 4: Key Insights Panel (right sidebar) ──── */}
        <div className="space-y-4 order-1 lg:order-2">
          {/* Top Health Score */}
          <FadeIn delay={200}>
            <div className="bg-[#0F172A] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <h3 className="text-[13px] font-semibold text-[#E5E7EB]">
                  {t('platform.gymHealth.insight.topScore', 'Top Health Score')}
                </h3>
              </div>
              {insights.topScore ? (
                <div
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 cursor-pointer hover:bg-emerald-500/8 transition-colors"
                  onClick={() => navigate(`/platform/gym/${insights.topScore.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{insights.topScore.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-emerald-400">
                        {insights.topScore.activePct}% {t('platform.gymHealth.active', 'active')}
                      </span>
                      <span className="text-[11px] text-[#4B5563]">|</span>
                      <span className="text-[11px] text-[#9CA3AF]">
                        {insights.topScore.sessionsPerMember} {t('platform.gymHealth.sessPerMember', 'sess/member')}
                      </span>
                    </div>
                  </div>
                  <span className="text-[16px] font-bold tabular-nums" style={{ color: getScoreColor(insights.topScore.healthScore) }}>
                    {insights.topScore.healthScore}
                  </span>
                </div>
              ) : (
                <p className="text-[12px] text-[#6B7280] text-center py-4">
                  {t('platform.gymHealth.noData', 'No data available')}
                </p>
              )}
            </div>
          </FadeIn>

          {/* Needs Attention */}
          <FadeIn delay={250}>
            <div className="bg-[#0F172A] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                </div>
                <h3 className="text-[13px] font-semibold text-[#E5E7EB]">
                  {t('platform.gymHealth.insight.attention', 'Needs Attention')}
                </h3>
              </div>
              {insights.needsAttention.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center mb-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-[12px] text-[#9CA3AF]">
                    {t('platform.gymHealth.allHealthy', 'All gyms above risk threshold')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {insights.needsAttention.map(gym => (
                    <div
                      key={gym.id}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/10 cursor-pointer hover:bg-red-500/8 transition-colors"
                      onClick={() => navigate(`/platform/gym/${gym.id}`)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{gym.name}</p>
                        <p className="text-[10px] text-red-400 mt-0.5">{gym.issue}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-red-400 tabular-nums">{gym.healthScore}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-[#4B5563]" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FadeIn>

          {/* Onboarding Gap */}
          <FadeIn delay={300}>
            <div className="bg-[#0F172A] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <h3 className="text-[13px] font-semibold text-[#E5E7EB]">
                  {t('platform.gymHealth.insight.onboarding', 'Onboarding Gap')}
                </h3>
                <span className="text-[10px] text-[#4B5563] ml-auto">&lt;50%</span>
              </div>
              {insights.onboardingGap.length === 0 ? (
                <p className="text-[12px] text-emerald-400 text-center py-4">
                  {t('platform.gymHealth.allOnboarded', 'All gyms above 50% onboarding')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {insights.onboardingGap.map(gym => (
                    <div
                      key={gym.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.02] cursor-pointer transition-colors"
                      onClick={() => navigate(`/platform/gym/${gym.id}`)}
                    >
                      <p className="text-[12px] text-[#E5E7EB] truncate flex-1 min-w-0">{gym.name}</p>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ml-2 ${
                        gym.onboardingPct >= 40 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                      }`}>
                        {gym.onboardingPct}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FadeIn>

          {/* Admin Inactive */}
          <FadeIn delay={350}>
            <div className="bg-[#0F172A] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center">
                  <LogIn className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <h3 className="text-[13px] font-semibold text-[#E5E7EB]">
                  {t('platform.gymHealth.insight.adminInactive', 'Admin Inactive')}
                </h3>
                <span className="text-[10px] text-[#4B5563] ml-auto">7+ days</span>
              </div>
              {insights.adminInactive.length === 0 ? (
                <p className="text-[12px] text-emerald-400 text-center py-4">
                  {t('platform.gymHealth.allAdminsActive', 'All gym admins active')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {insights.adminInactive.map(gym => (
                    <div
                      key={gym.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.02] cursor-pointer transition-colors"
                      onClick={() => navigate(`/platform/gym/${gym.id}`)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-[#E5E7EB] truncate">{gym.name}</p>
                        <p className="text-[10px] text-purple-400 mt-0.5">
                          {t('platform.gymHealth.noAdminLogin', 'No admin login in 7+ days')}
                        </p>
                      </div>
                      <UserX className="w-3.5 h-3.5 text-[#4B5563] flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FadeIn>
        </div>
      </div>
      </>)}
    </div>
  );
}
