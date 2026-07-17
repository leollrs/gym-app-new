import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid, Cell,
} from 'recharts';
import {
  Building2, Users, Dumbbell, TrendingUp, TrendingDown,
  UserPlus, Activity, ChevronRight, AlertTriangle,
  DollarSign, UserCheck, Signal, Download, RefreshCw,
} from 'lucide-react';
import { format, subMonths, startOfMonth, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { selectAllRows } from '../../lib/churn/batchedSelect';
import { useTranslation } from 'react-i18next';
import { getMonthlyPrice, getPricingLabel, getMemberBracketLabel } from '../../lib/pricing';
import { exportCSV } from '../../lib/csvExport';

import ChartTooltip from '../../components/ChartTooltip';
import FadeIn from '../../components/platform/FadeIn';
import StatCard from '../../components/platform/StatCard';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import SortHeader from '../../components/platform/SortHeader';

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

const isMissingTable = (error) => error?.code === '42P01';

// Week-over-week delta tag rendered inside a StatCard value. Only shows when
// a previous snapshot week exists — no snapshots, no fake motion.
const DeltaTag = ({ delta, suffix = '' }) => {
  if (delta == null || Number.isNaN(delta)) return null;
  const rounded = Math.abs(delta) < 10 ? +delta.toFixed(1) : Math.round(delta);
  if (!rounded) return null;
  const up = rounded > 0;
  return (
    <span className={`text-[11px] font-semibold ml-1.5 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'}{Math.abs(rounded).toLocaleString()}{suffix}
    </span>
  );
};

// ── Main Component ───────────────────────────────────────────
// Approx Twilio cost per SMS send — mirrors SmsUsageCard's display estimate.
const SMS_COST_PER_SEND = 0.054;

// Fleet-wide costs vs revenue (audit completeness-6). Self-contained: fetches
// platform_cost_summary (0590) on mount and hides itself if unavailable
// (pre-migration) so it never blocks the page.
function FleetCostPanel({ t }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: d, error } = await supabase.rpc('platform_cost_summary');
      if (cancelled) return;
      if (error || !d) { setFailed(true); return; }
      setData(d);
    })();
    return () => { cancelled = true; };
  }, []);
  if (failed || !data) return null;
  const smsCost = (Number(data.sms_sent) || 0) * SMS_COST_PER_SEND;
  const mrr = Number(data.mrr) || 0;
  const margin = mrr - smsCost;
  return (
    <FadeIn delay={75}>
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.analytics.costsTitle', 'Costs & margin')}</h2>
          <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">{data.month}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{(Number(data.sms_sent) || 0).toLocaleString()}</p><p className="text-[11px] text-[#6B7280]">{t('platform.analytics.smsSent', 'SMS sent (mo)')}</p></div>
          <div><p className="text-[18px] font-bold text-red-400 tabular-nums">${smsCost.toFixed(2)}</p><p className="text-[11px] text-[#6B7280]">{t('platform.analytics.smsCost', 'SMS cost (est)')}</p></div>
          <div><p className="text-[18px] font-bold text-emerald-400 tabular-nums">${mrr.toLocaleString()}</p><p className="text-[11px] text-[#6B7280]">{t('platform.analytics.mrrLabel', 'MRR')}</p></div>
          <div><p className="text-[18px] font-bold tabular-nums" style={{ color: margin >= 0 ? '#10B981' : '#EF4444' }}>${margin.toFixed(2)}</p><p className="text-[11px] text-[#6B7280]">{t('platform.analytics.estMargin', 'Est. margin (MRR − SMS)')}</p></div>
        </div>
        <p className="text-[10px] text-[#6B7280] mt-2.5">{t('platform.analytics.costsNote', 'SMS is the per-message variable cost shown here; storage / DB / AI spend is not yet aggregated. Display-only estimate.')}</p>
      </div>
    </FadeIn>
  );
}

export default function PlatformAnalytics() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [gyms, setGyms] = useState([]);
  // Server-side aggregates (migrations 0437/0540) — one row per gym, so
  // payload scales with gym count, not member count.
  const [statsRows, setStatsRows] = useState([]);
  const [growthRows, setGrowthRows] = useState([]);
  const [churnData, setChurnData] = useState({ total_at_risk: 0, avg_score: 0, signals: [] });
  // Weekly frozen captures (0545) — power WoW deltas + real income months.
  const [snapshots, setSnapshots] = useState([]);

  // Error surfaces — supabase-js v2 never throws, so without these every
  // failure rendered as zeros that looked like real numbers.
  const [loadError, setLoadError] = useState(null);     // gyms/stats (page-critical)
  const [scopedError, setScopedError] = useState(null); // growth/churn (sections)
  const [reloadKey, setReloadKey] = useState(0);

  // Per-gym scope: null = all gyms (platform-wide), or a gym id to focus one.
  const [scopeId, setScopeId] = useState(null);

  // Sort state for gym table
  const [sortKey, setSortKey] = useState('memberCount');
  const [sortDir, setSortDir] = useState('desc');

  // Top gyms toggle
  const [topMetric, setTopMetric] = useState('members');

  useEffect(() => {
    document.title = `${t('platform.analytics.title', 'Analytics')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  // ── Gyms + per-gym aggregates (scope-independent; scoping is a client
  //    filter on the per-gym rows). ────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setLoadError(null);
      const [gymRes, statsRes, snapRes] = await Promise.all([
        selectAllRows((from, to) => supabase.from('gyms').select('id, name, slug, is_active, created_at, subscription_tier, monthly_price, plan_type, is_founding').range(from, to)),
        supabase.rpc('platform_gym_stats'),
        // Optional: snapshots may not exist yet (0545 pending) — tolerate. Paged
        // because the ascending order clamped at the 1000-row cap dropped the
        // NEWEST weeks (grows gyms×weeks), corrupting WoW deltas + income chart.
        selectAllRows((from, to) => supabase.from('platform_snapshots')
          .select('snapshot_date, gym_id, data')
          .eq('kind', 'gym_stats')
          .order('snapshot_date', { ascending: true })
          .range(from, to)),
      ]);
      if (gymRes.error || statsRes.error) {
        setLoadError((gymRes.error || statsRes.error).message || 'Query failed');
      }
      setGyms(gymRes.data || []);
      setStatsRows(statsRes.data || []);
      setSnapshots(snapRes.error ? [] : (snapRes.data || []));
      if (snapRes.error && !isMissingTable(snapRes.error)) {
        // Non-critical — deltas/real income just won't render.
        console.warn('platform_snapshots query failed:', snapRes.error.message);
      }
      setLoading(false);
    };
    fetchAll();
  }, [reloadKey]);

  // ── Growth + churn signals are time-series / text aggregates the server
  //    computes for the chosen scope (one gym or all). Refetch on scope change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setScopedError(null);
      const [growthRes, churnRes] = await Promise.all([
        supabase.rpc('platform_member_growth', { p_gym_id: scopeId, p_weeks: 13 }),
        supabase.rpc('platform_churn_signals', { p_gym_id: scopeId }),
      ]);
      if (cancelled) return;
      if (growthRes.error || churnRes.error) {
        setScopedError((growthRes.error || churnRes.error).message || 'Query failed');
      }
      setGrowthRows(growthRes.data || []);
      setChurnData(churnRes.data || { total_at_risk: 0, avg_score: 0, signals: [] });
    })();
    return () => { cancelled = true; };
  }, [scopeId, reloadKey]);

  const retry = useCallback(() => setReloadKey(k => k + 1), []);

  // ── Scope: filter the per-gym aggregate rows to the selected gym (or all).
  const scopeGym = useMemo(() => (scopeId ? gyms.find(g => g.id === scopeId) || null : null), [gyms, scopeId]);
  const sStats = useMemo(() => (scopeId ? statsRows.filter(r => r.gym_id === scopeId) : statsRows), [statsRows, scopeId]);

  // ── Derived stats (sum the per-gym aggregate rows) ─────────
  const sumStat = (key) => sStats.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const totalGyms = scopeId ? 1 : gyms.length;
  const totalMembers = sumStat('member_count');
  const totalSessions = sumStat('sessions_30d');
  const newMembers30d = sumStat('new_30d');
  const checkedInMembers = sumStat('checkedin_30d');
  const avgSessionsPerMember = totalMembers ? (totalSessions / totalMembers).toFixed(1) : 0;
  // Honest name: this is the share of members who CHECKED IN in the last 30d
  // (it used to masquerade as "Retention Rate").
  const checkinRate30 = totalMembers ? ((checkedInMembers / totalMembers) * 100).toFixed(1) : 0;

  // ── Week-over-week deltas from the latest snapshot (hidden without one) ──
  const prevWeek = useMemo(() => {
    if (!snapshots.length) return null;
    // Snapshots are captured weekly; the most recent one is "this week". To get
    // a true week-over-week move we compare the LIVE values against the PREVIOUS
    // week's snapshot, not the latest capture (which would make the delta a
    // current-week-to-date drift that reads ~0 right after capture). Fall back to
    // the only snapshot when just one exists.
    const dates = [...new Set(snapshots.map(r => String(r.snapshot_date)))].sort().reverse();
    const baselineDate = dates[1] || dates[0];
    if (!baselineDate) return null;
    const rows = snapshots.filter(r =>
      String(r.snapshot_date) === baselineDate && r.data && (!scopeId || r.gym_id === scopeId));
    if (!rows.length) return null;
    const sum = (k) => rows.reduce((s, r) => s + (Number(r.data[k]) || 0), 0);
    const members = sum('member_count');
    return {
      members,
      sessions: sum('sessions_30d'),
      new30: sum('new_30d'),
      checkinRate: members ? (sum('checkedin_30d') / members) * 100 : null,
    };
  }, [snapshots, scopeId]);

  // Weekly member-growth series from the server (already scope-aware).
  const growthData = useMemo(
    () => growthRows.map(r => ({ week: format(parseISO(r.week_start), 'MMM d'), newMembers: Number(r.new_members) || 0 })),
    [growthRows]
  );

  // ── Revenue metrics (dynamic pricing based on tier + member count) ──
  const gymMemberCounts = useMemo(() => {
    const counts = {};
    statsRows.forEach(r => { counts[r.gym_id] = r.member_count || 0; });
    return counts;
  }, [statsRows]);

  const getGymPrice = (g) => {
    const memberCount = gymMemberCounts[g.id] || 0;
    return getMonthlyPrice({
      planType: g.plan_type || g.subscription_tier || 'starter',
      memberCount,
      isFounding: g.is_founding ?? false,
      monthlyPriceOverride: parseFloat(g.monthly_price) || 0,
    });
  };

  const scopedGyms = useMemo(() => (scopeId ? gyms.filter(g => g.id === scopeId) : gyms), [gyms, scopeId]);

  const mrr = useMemo(() => {
    return scopedGyms.filter(g => g.is_active).reduce((sum, g) => sum + getGymPrice(g), 0);
  }, [scopedGyms, gymMemberCounts]);

  const revenueByGym = useMemo(() => {
    return scopedGyms
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
  }, [scopedGyms, gymMemberCounts]);

  // ── Monthly income, honest version ─────────────────────────
  // Months covered by a weekly snapshot (0545) compute income from the
  // FROZEN member counts / plan / price / active flag of that month, run
  // through the same pricing brackets. Months without coverage remain a
  // projection from today's prices over today's active gyms — and the chart
  // says so. Accuracy accrues as snapshots accrue.
  const monthlyIncomeChart = useMemo(() => {
    const now = new Date();
    const snapDatesByMonth = {};
    snapshots.forEach(r => {
      const dstr = String(r.snapshot_date);
      const mKey = dstr.slice(0, 7);
      if (!snapDatesByMonth[mKey] || dstr > snapDatesByMonth[mKey]) snapDatesByMonth[mKey] = dstr;
    });
    const gymById = Object.fromEntries(gyms.map(g => [g.id, g]));
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const mKey = format(monthStart, 'yyyy-MM');
      const snapDate = snapDatesByMonth[mKey];
      if (snapDate) {
        const rows = snapshots.filter(r =>
          String(r.snapshot_date) === snapDate && r.data && (!scopeId || r.gym_id === scopeId));
        const income = rows
          .filter(r => r.data.is_active !== false)
          .reduce((sum, r) => sum + getMonthlyPrice({
            planType: r.data.plan_type || 'starter',
            memberCount: Number(r.data.member_count) || 0,
            isFounding: gymById[r.gym_id]?.is_founding ?? false, // founding status is set at signup, immutable
            monthlyPriceOverride: parseFloat(r.data.monthly_price) || 0,
          }), 0);
        months.push({ month: format(monthStart, 'MMM'), income, projected: false });
      } else {
        const income = scopedGyms
          .filter(g => new Date(g.created_at) <= monthStart && g.is_active)
          .reduce((sum, g) => sum + getGymPrice(g), 0);
        months.push({ month: format(monthStart, 'MMM'), income, projected: true });
      }
    }
    return months;
  }, [scopedGyms, gymMemberCounts, snapshots, gyms, scopeId]);

  const hasProjectedMonths = monthlyIncomeChart.some(m => m.projected);

  const arr = mrr * 12;
  const payingGyms = scopedGyms.filter(g => g.is_active && getGymPrice(g) > 0).length;
  const avgRevenuePerGym = payingGyms > 0 ? (mrr / payingGyms) : 0;

  // ── Per-gym breakdown ──────────────────────────────────────
  const gymBreakdown = useMemo(() => {
    const byId = Object.fromEntries(statsRows.map(r => [r.gym_id, r]));
    return gyms.map(gym => {
      const s = byId[gym.id] || {};
      const memberCount = s.member_count || 0;
      // Active % = app activity (last_active_at), Check-in % = gym-floor
      // attendance. They used to be the SAME number under two labels.
      const activeRate = memberCount ? ((s.active_30d || 0) / memberCount) * 100 : 0;
      const checkinRate = memberCount ? ((s.checkedin_30d || 0) / memberCount) * 100 : 0;
      const sessionCount = s.sessions_30d || 0;
      const highChurn = (s.churn_critical || 0) + (s.churn_high || 0);
      const churnPct = memberCount ? (highChurn / memberCount) * 100 : 0;
      const isStruggling = activeRate < 30 || churnPct > 20;

      return {
        id: gym.id,
        name: gym.name,
        slug: gym.slug,
        memberCount,
        activeRate: +activeRate.toFixed(1),
        checkinRate: +checkinRate.toFixed(1),
        sessionCount,
        highChurn,
        churnPct: +churnPct.toFixed(1),
        isStruggling,
      };
    });
  }, [gyms, statsRows]);

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

  const handleExportComparison = async () => {
    await exportCSV({
      filename: 'gym-comparison',
      columns: [
        { key: 'name', label: t('platform.analytics.headerGym', 'Gym') },
        { key: 'memberCount', label: t('platform.analytics.headerMembers', 'Members') },
        { key: 'activeRate', label: t('platform.analytics.headerActive', 'Active %') },
        { key: 'checkinRate', label: t('platform.analytics.headerCheckin', 'Check-in %') },
        { key: 'sessionCount', label: t('platform.analytics.headerSessions', 'Sessions (30d)') },
        { key: 'highChurn', label: t('platform.analytics.headerChurnRisk', 'Churn Risk') },
        { key: 'churnPct', label: t('platform.analytics.headerChurnPct', 'Churn %') },
      ],
      data: sortedGyms,
    });
  };

  // ── Top 5 gyms by selected metric ─────────────────────────
  const topGymsBarKey = topMetric === 'members' ? 'memberCount' : topMetric === 'activity' ? 'sessionCount' : 'checkinRate';
  const topGyms = useMemo(() => {
    return [...gymBreakdown].sort((a, b) => b[topGymsBarKey] - a[topGymsBarKey]).slice(0, 5);
  }, [gymBreakdown, topGymsBarKey]);

  // ── Struggling gyms ────────────────────────────────────────
  const strugglingGyms = useMemo(() => {
    return gymBreakdown.filter(g => g.isStruggling).sort((a, b) => a.activeRate - b.activeRate);
  }, [gymBreakdown]);

  // ── Cross-Gym Churn Analysis (per-gym from aggregates, totals+signals from RPC) ──
  const crossGymChurn = useMemo(() => {
    const gymNameMap = {};
    gyms.forEach(g => { gymNameMap[g.id] = g.name; });

    const perGymChurn = sStats
      .filter(r => (r.churn_count || 0) > 0)
      .map(r => ({
        gymId: r.gym_id,
        name: gymNameMap[r.gym_id] || t('platform.analytics.unknown', 'Unknown'),
        avgScore: +(Number(r.avg_churn_score) || 0).toFixed(1),
        count: r.churn_count || 0,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    // RISING churn = positive velocity (score climbing >0.5/day on average),
    // from migration 0540. null (column absent pre-apply) hides the card —
    // the old version measured LEVEL > 50 and called it "rising".
    const hasVelocity = sStats.some(r => r.avg_churn_velocity !== undefined && r.avg_churn_velocity !== null);
    const gymsRisingChurn = hasVelocity
      ? sStats.filter(r => (Number(r.avg_churn_velocity) || 0) > 0.5).length
      : null;

    const totalAtRisk = Number(churnData.total_at_risk) || 0;
    const platformAvgScore = +(Number(churnData.avg_score) || 0).toFixed(1);
    const topSignals = (churnData.signals || []).slice(0, 10).map(s => ({
      signal: s.signal,
      count: Number(s.occurrences) || 0,
      pct: totalAtRisk ? +(((Number(s.occurrences) || 0) / totalAtRisk) * 100).toFixed(1) : 0,
      mostAffectedGym: s.gym || '—',
    }));

    return { totalAtRisk, platformAvgScore, gymsRisingChurn, perGymChurn, topSignals };
  }, [sStats, churnData, gyms, t]);

  // ── Onboarding Effectiveness (from per-gym aggregates) ─────
  const onboardingData = useMemo(() => {
    const gymNameMap = {};
    gyms.forEach(g => { gymNameMap[g.id] = g.name; });

    const perGym = sStats
      .filter(r => (r.member_count || 0) > 0)
      .map(r => ({
        gymId: r.gym_id,
        name: gymNameMap[r.gym_id] || t('platform.analytics.unknown', 'Unknown'),
        total: r.member_count || 0,
        onboarded: r.onboarded_count || 0,
        rate: r.member_count ? +(((r.onboarded_count || 0) / r.member_count) * 100).toFixed(1) : 0,
        notOnboarded: (r.member_count || 0) - (r.onboarded_count || 0),
      }))
      .sort((a, b) => b.rate - a.rate);

    const totalMembers = perGym.reduce((s, g) => s + g.total, 0);
    const totalOnboarded = perGym.reduce((s, g) => s + g.onboarded, 0);
    const platformAvgRate = totalMembers ? +((totalOnboarded / totalMembers) * 100).toFixed(1) : 0;
    const best = perGym[0] || null;
    const worst = perGym[perGym.length - 1] || null;
    const gapsGyms = perGym.filter(g => g.rate < 60);

    return { perGym, platformAvgRate, best, worst, gapsGyms };
  }, [sStats, gyms, t]);

  const showRisingCard = !scopeId && crossGymChurn.gymsRisingChurn != null;

  // ── Render ─────────────────────────────────────────────────
  if (loading) return <PlatformSpinner />;

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-0.5 truncate">{t('platform.analytics.title', 'Analytics')}</h1>
        <p className="text-[12px] text-[#6B7280] mb-4">
          {scopeGym
            ? t('platform.analytics.subtitleGym', { name: scopeGym.name, defaultValue: 'Growth, retention, and revenue — {{name}}' })
            : t('platform.analytics.subtitle', 'Growth, retention, and revenue')}
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

      {!loadError && scopedError && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-[12px] text-[#9CA3AF] flex-1">
            {t('platform.common.degraded', { sources: t('platform.analytics.srcGrowthChurn', 'growth & churn signals'), defaultValue: 'Some data failed to load: {{sources}}. Affected sections may be incomplete.' })}
          </p>
          <button onClick={retry} className="text-[11px] font-semibold text-[#D4AF37] hover:text-[#E6C766] transition-colors flex-shrink-0">
            {t('platform.common.retry', 'Retry')}
          </button>
        </div>
      )}

      {!loadError && (<>
      {/* Per-gym scope selector */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="text-[11px] text-[#6B7280] uppercase tracking-wider font-semibold">{t('platform.analytics.viewing', 'Viewing')}</span>
        <select
          value={scopeId || 'all'}
          onChange={(e) => setScopeId(e.target.value === 'all' ? null : e.target.value)}
          className="bg-[#111827] border border-white/6 rounded-lg px-3 py-1.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
        >
          <option value="all">{t('platform.analytics.allGyms', 'All gyms')}</option>
          {[...gyms].sort((a, b) => a.name.localeCompare(b.name)).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        {scopeGym && (
          <>
            <button
              onClick={() => navigate(`/platform/gym/${scopeGym.id}`)}
              className="text-[11px] font-semibold text-[#D4AF37] hover:text-[#E6C766] transition-colors"
            >
              {t('platform.analytics.openGym', 'Open gym →')}
            </button>
            <button
              onClick={() => setScopeId(null)}
              className="text-[11px] text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
            >
              {t('platform.analytics.backToAll', '← All gyms')}
            </button>
          </>
        )}
      </div>

      {/* ── Top Stats (Δ vs previous snapshot week when one exists) ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard value={totalGyms} label={t('platform.analytics.totalGyms', 'Total Gyms')} icon={Building2} color="#6366F1" delay={0} />
        <StatCard
          value={<span className="inline-flex items-baseline">{totalMembers.toLocaleString()}<DeltaTag delta={prevWeek ? totalMembers - prevWeek.members : null} /></span>}
          label={t('platform.analytics.totalMembers', 'Total Members')}
          icon={Users} color="var(--color-accent)" delay={50}
        />
        <StatCard
          value={<span className="inline-flex items-baseline">{totalSessions.toLocaleString()}<DeltaTag delta={prevWeek ? totalSessions - prevWeek.sessions : null} /></span>}
          label={t('platform.analytics.sessions30d', 'Sessions (30d)')}
          icon={Dumbbell} color="#3B82F6" delay={100}
        />
        <StatCard
          value={<span className="inline-flex items-baseline">{`${checkinRate30}%`}<DeltaTag delta={prevWeek?.checkinRate != null ? parseFloat(checkinRate30) - prevWeek.checkinRate : null} suffix="pp" /></span>}
          label={t('platform.analytics.checkinRate30d', 'Check-in Rate (30d)')}
          icon={TrendingUp} color="#10B981" delay={150}
        />
        <StatCard
          value={<span className="inline-flex items-baseline">{newMembers30d.toLocaleString()}<DeltaTag delta={prevWeek ? newMembers30d - prevWeek.new30 : null} /></span>}
          label={t('platform.analytics.newMembers30d', 'New Members (30d)')}
          icon={UserPlus} color="#8B5CF6" delay={200}
        />
        <StatCard value={avgSessionsPerMember} label={t('platform.analytics.avgSessionsPerMember', 'Avg Sessions / Member')} icon={Activity} color="#F59E0B" delay={250} />
      </div>

      <FleetCostPanel t={t} />

      {/* ── Growth Chart ────────────────────────────────────── */}
      <FadeIn delay={100}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">{t('platform.analytics.memberGrowth', 'Member Growth (Last 13 Weeks)')}</h2>
          {growthData.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.analytics.noGrowthData', 'No growth data available')}</p>
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
                    name={t('platform.analytics.newMembers', 'New Members')}
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
          <StatCard value={`$${mrr.toLocaleString()}`} label={t('platform.analytics.monthlyRevenue', 'Monthly Revenue (MRR)')} icon={DollarSign} color="#10B981" delay={0} />
          <StatCard value={`$${arr.toLocaleString()}`} label={t('platform.analytics.annualRunRate', 'Annual Run Rate (ARR)')} icon={TrendingUp} color="#3B82F6" delay={50} />
          <StatCard value={payingGyms} label={t('platform.analytics.payingGyms', 'Paying Gyms')} icon={Building2} color="#8B5CF6" delay={100} />
          <StatCard value={`$${avgRevenuePerGym.toFixed(0)}`} label={t('platform.analytics.avgRevenuePerGym', 'Avg Revenue / Gym')} icon={Activity} color="#F59E0B" delay={150} />
        </div>
      </FadeIn>

      {/* ── Monthly Income Chart + Per-Gym Revenue ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 mb-6">
        <FadeIn delay={140}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.analytics.monthlyIncome', 'Monthly Income (Last 12 Months)')}</h2>
              {hasProjectedMonths && (
                <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  {t('platform.analytics.incomeProjectionBadge', 'Projection (current prices)')}
                </span>
              )}
            </div>
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
                  <Bar dataKey="income" radius={[4, 4, 0, 0]} barSize={28}>
                    {monthlyIncomeChart.map((m, idx) => (
                      <Cell
                        key={idx}
                        fill={m.projected ? '#F59E0B' : 'url(#incomeGrad)'}
                        fillOpacity={m.projected ? 0.35 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {hasProjectedMonths && (
              <p className="text-[10.5px] text-[#6B7280] mt-2 leading-relaxed">
                {t('platform.analytics.incomeProjectionNote', 'Amber months have no snapshot yet — they are projected from today’s prices and today’s active gyms. Green months are computed from that month’s weekly snapshot (frozen member counts, plans, and status).')}
              </p>
            )}
          </div>
        </FadeIn>

        <FadeIn delay={160}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
            <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-3">{t('platform.analytics.revenueByGym', 'Revenue by Gym')}</h2>
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
                      <span className="text-[10px] text-[#4B5563]">{gym.bracketLabel} {t('platform.analytics.members', 'members')}</span>
                      {gym.isFounding && (
                        <span className="text-[10px] text-[#D4AF37]">★</span>
                      )}
                      {!gym.isActive && (
                        <span className="text-[10px] text-red-400">{t('platform.analytics.inactive', 'inactive')}</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[15px] font-bold text-[#E5E7EB] tabular-nums">
                    ${gym.price}<span className="text-[10px] text-[#6B7280] font-normal">{t('platform.analytics.perMonth', '/mo')}</span>
                  </p>
                </div>
              ))}
              {revenueByGym.length === 0 && (
                <p className="text-[13px] text-[#6B7280] py-8 text-center">{t('platform.analytics.noGymsYet', 'No gyms yet')}</p>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-white/6 flex items-center justify-between px-3">
              <span className="text-[12px] text-[#9CA3AF]">{t('platform.analytics.totalMrr', 'Total MRR')}</span>
              <span className="text-[16px] font-bold text-emerald-400 tabular-nums">${mrr.toLocaleString()}</span>
            </div>
          </div>
        </FadeIn>
      </div>

      {/* Cross-gym rankings — only meaningful platform-wide; hidden when a single gym is in scope */}
      {!scopeId && (<>
      {/* ── Two-column: Top Gyms + Struggling Gyms ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top Gyms */}
        <FadeIn delay={150}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.analytics.topGyms', 'Top Gyms')}</h2>
              <div className="flex gap-1">
                {['members', 'activity', 'checkin'].map(m => (
                  <button
                    key={m}
                    onClick={() => setTopMetric(m)}
                    className={`text-[11px] px-2.5 py-1 rounded-full transition-colors capitalize ${
                      topMetric === m
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] font-semibold'
                        : 'text-[#6B7280] hover:text-[#9CA3AF]'
                    }`}
                  >
                    {t(`platform.analytics.${m}Metric`, m)}
                  </button>
                ))}
              </div>
            </div>
            {topGyms.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-8 text-center">{t('platform.analytics.noGymData', 'No gym data available')}</p>
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
                      name={topMetric === 'members' ? t('platform.analytics.membersLabel', 'Members') : topMetric === 'activity' ? t('platform.analytics.sessionsLabel', 'Sessions') : t('platform.analytics.checkinPctLabel', 'Check-in %')}
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
              <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.analytics.strugglingGyms', 'Struggling Gyms')}</h2>
            </div>
            {strugglingGyms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-[13px] text-[#9CA3AF]">{t('platform.analytics.allPerformingWell', 'All gyms are performing well')}</p>
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
                            {gym.activeRate}% {t('platform.analytics.active', 'active')}
                          </span>
                        )}
                        {gym.churnPct > 20 && (
                          <span className="text-[11px] text-amber-400">
                            <AlertTriangle className="w-3 h-3 inline mr-0.5" />
                            {gym.churnPct}% {t('platform.analytics.highChurn', 'high churn')}
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
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.analytics.gymComparison', 'Gym Comparison')}</h2>
            <button
              onClick={handleExportComparison}
              disabled={sortedGyms.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-[11px] font-semibold text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              {t('platform.analytics.exportCsv', 'Export CSV')}
            </button>
          </div>
          {sortedGyms.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.analytics.noGymData', 'No gym data available')}</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/6">
                    <SortHeader label={t('platform.analytics.headerGym', 'Gym')} field="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label={t('platform.analytics.headerMembers', 'Members')} field="memberCount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label={t('platform.analytics.headerActive', 'Active %')} field="activeRate" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label={t('platform.analytics.headerCheckin', 'Check-in %')} field="checkinRate" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label={t('platform.analytics.headerSessions', 'Sessions (30d)')} field="sessionCount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label={t('platform.analytics.headerChurnRisk', 'Churn Risk')} field="highChurn" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {sortedGyms.map((gym) => (
                    <tr
                      key={gym.id}
                      className="border-b border-white/4 last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => navigate(`/platform/gym/${gym.id}`)}
                      role="button"
                      tabIndex={0}
                      aria-label={gym.name}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/platform/gym/${gym.id}`); } }}
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
                        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${pctBg(gym.checkinRate, 40, 20)} ${pctColor(gym.checkinRate, 40, 20)}`}>
                          {gym.checkinRate}%
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-[13px] text-[#E5E7EB] tabular-nums">{gym.sessionCount.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-3">
                        {gym.highChurn > 0 ? (
                          <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${pctBg(100 - gym.churnPct, 80, 60)} ${pctColor(100 - gym.churnPct, 80, 60)}`}>
                            {gym.highChurn} ({gym.churnPct}%)
                          </span>
                        ) : (
                          <span className="text-[12px] text-emerald-400 font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15">{t('platform.analytics.none', 'None')}</span>
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
      </>)}

      {/* ── Cross-Gym Churn Patterns ─────────────────────────── */}
      <FadeIn delay={300}>
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-red-400" />
            <h2 className="text-[17px] font-bold text-[#E5E7EB]">
              {scopeGym
                ? t('platform.analytics.churnPatternsGym', { name: scopeGym.name, defaultValue: 'Churn patterns — {{name}}' })
                : t('platform.analytics.crossGymChurn', 'Cross-Gym Churn Patterns')}
            </h2>
          </div>

          {/* Churn summary strip */}
          <div className={`grid grid-cols-1 ${showRisingCard ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-3 mb-6`}>
            <StatCard
              value={crossGymChurn.totalAtRisk.toLocaleString()}
              label={t('platform.analytics.totalAtRisk', 'Total At-Risk Members')}
              icon={AlertTriangle}
              color="#EF4444"
              delay={310}
            />
            <StatCard
              value={crossGymChurn.platformAvgScore}
              label={scopeGym ? t('platform.analytics.avgChurnScore', 'Avg Churn Score') : t('platform.analytics.platformAvgChurn', 'Platform Avg Churn Score')}
              icon={Activity}
              color="#F59E0B"
              delay={320}
            />
            {showRisingCard && (
              <StatCard
                value={crossGymChurn.gymsRisingChurn}
                label={t('platform.analytics.gymsRisingChurn', 'Gyms with Rising Churn')}
                icon={TrendingUp}
                color="#F97316"
                delay={330}
              />
            )}
          </div>

          {/* Churn by Gym Bar Chart — cross-gym only */}
          {!scopeId && (
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
          )}

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
                      {/* In single-gym scope this column is trivially the scoped gym — hide it. */}
                      {!scopeId && <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">{t('platform.analytics.mostAffectedGym', 'Most Affected Gym')}</th>}
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
                        {!scopeId && (
                          <td className="px-3 py-2.5">
                            <span className="text-[13px] text-[#9CA3AF]">{sig.mostAffectedGym}</span>
                          </td>
                        )}
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
            <h2 className="text-[17px] font-bold text-[#E5E7EB]">
              {scopeGym
                ? t('platform.analytics.onboardingGym', { name: scopeGym.name, defaultValue: 'Onboarding — {{name}}' })
                : t('platform.analytics.onboardingEffectiveness', 'Onboarding Effectiveness by Gym')}
            </h2>
          </div>

          {/* Onboarding summary strip */}
          <div className={`grid grid-cols-1 ${scopeId ? 'md:grid-cols-1' : 'md:grid-cols-3'} gap-3 mb-6`}>
            <StatCard
              value={`${onboardingData.platformAvgRate}%`}
              label={scopeGym ? t('platform.analytics.gymOnboardingRate', 'Onboarding Rate') : t('platform.analytics.platformAvgOnboarding', 'Platform Avg Onboarding Rate')}
              icon={UserCheck}
              color="#10B981"
              delay={360}
            />
            {!scopeId && (
              <StatCard
                value={onboardingData.best ? `${onboardingData.best.rate}%` : '—'}
                label={onboardingData.best ? `${t('platform.analytics.bestPerforming', 'Best Performing Gym')}: ${onboardingData.best.name}` : t('platform.analytics.bestPerforming', 'Best Performing Gym')}
                icon={TrendingUp}
                color="#6366F1"
                delay={370}
              />
            )}
            {!scopeId && (
              <StatCard
                value={onboardingData.worst ? `${onboardingData.worst.rate}%` : '—'}
                label={onboardingData.worst ? `${t('platform.analytics.lowestPerforming', 'Lowest Performing Gym')}: ${onboardingData.worst.name}` : t('platform.analytics.lowestPerforming', 'Lowest Performing Gym')}
                icon={TrendingDown}
                color="#EF4444"
                delay={380}
              />
            )}
          </div>

          {/* Onboarding Comparison Bar Chart — cross-gym only */}
          {!scopeId && (
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
          )}

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
                          {gym.rate}% {t('platform.analytics.onboarded', 'onboarded')}
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
      </>)}
    </div>
  );
}
