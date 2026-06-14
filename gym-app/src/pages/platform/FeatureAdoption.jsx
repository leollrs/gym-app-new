import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  Puzzle, Users, Activity, BarChart3, Eye, TrendingUp,
  ChevronRight, Grid3X3, List, Clock,
  AlertTriangle, CheckCircle2, UserCheck, Download, RefreshCw,
} from 'lucide-react';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { exportCSV } from '../../lib/csvExport';
import ChartTooltip from '../../components/ChartTooltip';
import FadeIn from '../../components/platform/FadeIn';
import StatCard from '../../components/platform/StatCard';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import SortHeader from '../../components/platform/SortHeader';

// ── Feature definitions ─────────────────────────────────────
// Keys match the rows returned by the platform_feature_adoption() RPC
// (migration 0541). The RPC replaced 12 direct table reads — 8 of which were
// RLS-dead for super_admin and silently rendered "Never used" for features
// gyms use daily. Definitions are honest:
//   rewards          → gym_rewards        (the actual rewards system)
//   referral_rewards → referral_milestones (referral reward config)
// The old fake "analytics" feature (churn cron rows ≠ admin usage) is gone.
const FEATURES_DEF = [
  { key: 'classes',          labelKey: 'platform.adoption.feat.classes',         labelDefault: 'Classes' },
  { key: 'challenges',       labelKey: 'platform.adoption.feat.challenges',      labelDefault: 'Challenges' },
  { key: 'winback',          labelKey: 'platform.adoption.feat.winback',         labelDefault: 'Churn/Win-back' },
  { key: 'messaging',        labelKey: 'platform.adoption.feat.messaging',       labelDefault: 'Messaging' },
  { key: 'programs',         labelKey: 'platform.adoption.feat.programs',        labelDefault: 'Programs' },
  { key: 'referrals',        labelKey: 'platform.adoption.feat.referrals',       labelDefault: 'Referrals' },
  { key: 'referral_rewards', labelKey: 'platform.adoption.feat.referralRewards', labelDefault: 'Referral Rewards' },
  { key: 'nps',              labelKey: 'platform.adoption.feat.nps',             labelDefault: 'NPS' },
  { key: 'announcements',    labelKey: 'platform.adoption.feat.announcements',   labelDefault: 'Announcements' },
  { key: 'store',            labelKey: 'platform.adoption.feat.store',           labelDefault: 'Store' },
  { key: 'segments',         labelKey: 'platform.adoption.feat.segments',        labelDefault: 'Segments' },
  { key: 'rewards',          labelKey: 'platform.adoption.feat.rewards',         labelDefault: 'Rewards' },
];

const isMissingFunction = (error) =>
  error?.code === '42883' || error?.code === 'PGRST202';

// ── Main Component ──────────────────────────────────────────
export default function FeatureAdoption() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');

  const FEATURES = useMemo(() =>
    FEATURES_DEF.map(f => ({ ...f, label: t(f.labelKey, f.labelDefault) })),
    [t, i18n.language]
  );

  const [loading, setLoading] = useState(true);
  const [gyms, setGyms] = useState([]);
  const [featureData, setFeatureData] = useState({});   // { featureKey: { recent: Set<gym_id>, ever: Set<gym_id> } }
  const [adminPresence, setAdminPresence] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loadError, setLoadError] = useState(null);          // gyms / adoption RPC (page-critical)
  const [degradedSources, setDegradedSources] = useState([]); // presence/admins failures
  const [reloadKey, setReloadKey] = useState(0);
  const [viewMode, setViewMode] = useState('heatmap');  // 'heatmap' | 'table'
  const [sortKey, setSortKey] = useState('featuresActive');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    document.title = `${t('platform.adoption.title', 'Feature Adoption')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  // ── Fetch all data ────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setLoadError(null);
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      // Feature usage comes from one SECURITY DEFINER RPC (0541) — one row
      // per (gym, feature) with ever/recent counts. No more per-table reads,
      // no more silent RLS empties, no 5000-row caps.
      const [gymRes, adoptionRes, presenceRes, adminRes] = await Promise.all([
        supabase.from('gyms').select('id, name, slug, is_active, created_at'),
        supabase.rpc('platform_feature_adoption'),
        supabase
          .from('admin_presence')
          .select('gym_id, profile_id, current_page, last_seen_at')
          .gte('last_seen_at', thirtyDaysAgo)
          .order('last_seen_at', { ascending: false })
          .limit(2000),
        supabase
          .from('profiles')
          .select('id, full_name, gym_id, role')
          .in('role', ['admin', 'super_admin']),
      ]);

      if (gymRes.error || adoptionRes.error) {
        const err = gymRes.error || adoptionRes.error;
        setLoadError(
          isMissingFunction(adoptionRes.error)
            ? t('platform.adoption.rpcMissing', 'The adoption RPC is not deployed yet — apply migration 0541, then retry.')
            : (err.message || 'Query failed')
        );
      }

      const degraded = [];
      if (presenceRes.error) degraded.push(t('platform.adoption.srcPresence', 'admin presence'));
      if (adminRes.error) degraded.push(t('platform.adoption.srcAdmins', 'admin profiles'));
      setDegradedSources(degraded);

      setGyms(gymRes.data || []);

      // Build { featureKey: { recent: Set, ever: Set } } from RPC rows.
      const fData = {};
      FEATURES_DEF.forEach(f => { fData[f.key] = { recent: new Set(), ever: new Set() }; });
      (adoptionRes.data || []).forEach((row) => {
        const bucket = fData[row.feature];
        if (!bucket || !row.gym_id) return;
        if ((row.ever_count || 0) > 0) bucket.ever.add(row.gym_id);
        if ((row.recent_count || 0) > 0) bucket.recent.add(row.gym_id);
      });
      setFeatureData(fData);

      setAdminPresence(presenceRes.data || []);
      setAdmins(adminRes.data || []);
      setLoading(false);
    };

    fetchAll();
  }, [reloadKey, t]);

  const retry = useCallback(() => setReloadKey(k => k + 1), []);

  // ── Gym name lookup ───────────────────────────────────────
  const gymNameMap = useMemo(() => {
    const map = {};
    gyms.forEach(g => { map[g.id] = g.name; });
    return map;
  }, [gyms]);

  // ── Admin name lookup ─────────────────────────────────────
  const adminNameMap = useMemo(() => {
    const map = {};
    admins.forEach(a => { map[a.id] = a.full_name || t('platform.adoption.unknown', 'Unknown'); });
    return map;
  }, [admins, t]);

  // ── Section 1: Feature Adoption Metrics ───────────────────

  // Per-feature gym count (uses recent/active data)
  const featureCounts = useMemo(() => {
    return FEATURES.map(f => {
      const d = featureData[f.key] || { recent: new Set(), ever: new Set() };
      return {
        ...f,
        count: d.recent.size,
        everCount: d.ever.size,
      };
    });
  }, [featureData, FEATURES]);

  // Most / least used
  const mostUsed = useMemo(() => {
    const sorted = [...featureCounts].sort((a, b) => b.count - a.count);
    return sorted[0] || { label: 'N/A', count: 0 };
  }, [featureCounts]);

  const leastUsed = useMemo(() => {
    const sorted = [...featureCounts].sort((a, b) => a.count - b.count);
    return sorted[0] || { label: 'N/A', count: 0 };
  }, [featureCounts]);

  // Per-gym feature count (recent = active in last 90d)
  const gymFeatureMap = useMemo(() => {
    const map = {}; // gym_id -> Set of feature keys (active)
    gyms.forEach(g => { map[g.id] = new Set(); });
    FEATURES_DEF.forEach(f => {
      const d = featureData[f.key] || { recent: new Set(), ever: new Set() };
      d.recent.forEach(gid => {
        if (map[gid]) map[gid].add(f.key);
      });
    });
    return map;
  }, [gyms, featureData]);

  // Per-gym "ever used" feature map (for heatmap differentiation)
  const gymFeatureEverMap = useMemo(() => {
    const map = {}; // gym_id -> Set of feature keys (ever)
    gyms.forEach(g => { map[g.id] = new Set(); });
    FEATURES_DEF.forEach(f => {
      const d = featureData[f.key] || { recent: new Set(), ever: new Set() };
      d.ever.forEach(gid => {
        if (map[gid]) map[gid].add(f.key);
      });
    });
    return map;
  }, [gyms, featureData]);

  const avgFeaturesPerGym = useMemo(() => {
    if (!gyms.length) return '0';
    const total = Object.values(gymFeatureMap).reduce((sum, s) => sum + s.size, 0);
    return (total / gyms.length).toFixed(1);
  }, [gyms, gymFeatureMap]);

  const gymsUnder3Features = useMemo(() => {
    return Object.values(gymFeatureMap).filter(s => s.size < 3).length;
  }, [gymFeatureMap]);

  // ── Heatmap data (sorted gyms x features) ────────────────
  const heatmapGyms = useMemo(() => {
    return [...gyms].sort((a, b) => a.name.localeCompare(b.name));
  }, [gyms]);

  // ── Matrix CSV export ─────────────────────────────────────
  const handleExportMatrix = async () => {
    const columns = [
      { key: 'name', label: t('platform.adoption.gym', 'Gym') },
      ...FEATURES.map(f => ({ key: f.key, label: f.label })),
      { key: 'total', label: t('platform.adoption.total', 'Total') },
    ];
    const data = heatmapGyms.map(g => {
      const active = gymFeatureMap[g.id] || new Set();
      const ever = gymFeatureEverMap[g.id] || new Set();
      const row = { name: g.name, total: `${active.size}/${FEATURES.length}` };
      FEATURES.forEach(f => {
        row[f.key] = active.has(f.key)
          ? t('platform.adoption.csvActive', 'Active')
          : ever.has(f.key)
            ? t('platform.adoption.csvStale', 'Inactive 90d+')
            : t('platform.adoption.csvNever', 'Never');
      });
      return row;
    });
    await exportCSV({ filename: 'feature-adoption-matrix', columns, data });
  };

  // ── Table data (by gym, sortable) ────────────────────────
  const gymTableData = useMemo(() => {
    return gyms.map(g => {
      const features = gymFeatureMap[g.id] || new Set();
      return {
        id: g.id,
        name: g.name,
        slug: g.slug,
        featuresActive: features.size,
        featureKeys: [...features],
      };
    });
  }, [gyms, gymFeatureMap]);

  const sortedGymTable = useMemo(() => {
    return [...gymTableData].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [gymTableData, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // ── Section 2: Admin Engagement Metrics ───────────────────
  // (Direct admin_presence reads — cross-gym SELECT unlocked by 0541.)

  // Score = distinct (date, profile_id) per gym in last 30d
  const adminScoresByGym = useMemo(() => {
    const gymScores = {}; // gym_id -> Set of "date|profile_id"
    adminPresence.forEach(entry => {
      if (!entry.gym_id) return;
      if (!gymScores[entry.gym_id]) gymScores[entry.gym_id] = new Set();
      const dateStr = format(new Date(entry.last_seen_at), 'yyyy-MM-dd');
      gymScores[entry.gym_id].add(`${dateStr}|${entry.profile_id}`);
    });

    return Object.entries(gymScores).map(([gymId, combos]) => ({
      gymId,
      name: gymNameMap[gymId] || t('platform.adoption.unknownGym', 'Unknown Gym'),
      score: combos.size,
    })).sort((a, b) => b.score - a.score);
  }, [adminPresence, gymNameMap, t]);

  // Average admin active-days/week — denominator is gyms WITH activity
  // (noted in the UI footnote, it is not "all gyms").
  const avgAdminActiveDays = useMemo(() => {
    if (!adminScoresByGym.length) return '0';
    const totalScore = adminScoresByGym.reduce((s, g) => s + g.score, 0);
    // 30 days ~ 4.3 weeks
    return (totalScore / adminScoresByGym.length / 4.3).toFixed(1);
  }, [adminScoresByGym]);

  const mostActiveGym = useMemo(() => {
    return adminScoresByGym[0]?.name || 'N/A';
  }, [adminScoresByGym]);

  // Least active across ALL gyms — zero-activity gyms (no presence rows at
  // all) used to be invisible here, which hid exactly the gyms that matter.
  const leastActiveGym = useMemo(() => {
    if (!gyms.length) return 'N/A';
    const scoreByGym = {};
    adminScoresByGym.forEach(g => { scoreByGym[g.gymId] = g.score; });
    const ranked = gyms
      .map(g => ({ name: g.name, score: scoreByGym[g.id] || 0 }))
      .sort((a, b) => (a.score - b.score) || a.name.localeCompare(b.name));
    return ranked[0]?.name || 'N/A';
  }, [gyms, adminScoresByGym]);

  // Gyms with no admin activity in 7d
  const gymsNoActivity7d = useMemo(() => {
    const sevenDaysAgo = subDays(new Date(), 7).toISOString();
    const activeGymIds = new Set(
      adminPresence
        .filter(e => e.last_seen_at >= sevenDaysAgo)
        .map(e => e.gym_id)
    );
    return gyms.filter(g => !activeGymIds.has(g.id)).length;
  }, [gyms, adminPresence]);

  // Bar chart data for admin engagement (gold = ≥75% of the max score)
  const adminBarData = useMemo(() => {
    if (!adminScoresByGym.length) return [];
    const maxScore = adminScoresByGym[0]?.score || 1;
    const goldThreshold = maxScore * 0.75;
    return adminScoresByGym.slice(0, 20).map(g => ({
      ...g,
      fill: g.score >= goldThreshold ? '#D4AF37' : '#4B5563',
    }));
  }, [adminScoresByGym]);

  // Recent admin activity list
  const recentAdminActivity = useMemo(() => {
    return adminPresence.slice(0, 30).map(entry => ({
      gymName: gymNameMap[entry.gym_id] || t('platform.adoption.unknown', 'Unknown'),
      adminName: adminNameMap[entry.profile_id] || t('platform.adoption.unknown', 'Unknown'),
      page: entry.current_page || t('platform.adoption.dashboard', 'Dashboard'),
      when: entry.last_seen_at,
    }));
  }, [adminPresence, gymNameMap, adminNameMap, t]);

  // Tooltip for the feature-usage chart. The previous version passed a
  // 3-arg formatter to ChartTooltip, which only calls formatter(value) —
  // the active/ever breakdown never rendered. This local content component
  // reads the full datum from recharts' payload instead.
  const FeatureUsageTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div className="bg-[#0F172A] border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl shadow-black/50 text-[12px] min-w-[120px]">
        <p className="text-[#6B7280] text-[10px] font-medium uppercase tracking-wider mb-1">{d.label}</p>
        <p className="font-semibold text-emerald-400">
          {d.count} {t('platform.adoption.active', 'active')}
          <span className="text-[#9CA3AF] font-normal"> / {d.everCount} {t('platform.adoption.everTotal', 'ever')}</span>
        </p>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────
  if (loading) return <PlatformSpinner />;

  const featureLabel = (key) => FEATURES.find(f => f.key === key)?.label || key;

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-0.5 truncate">{t('platform.adoption.title', 'Feature Adoption')}</h1>
        <p className="text-[12px] text-[#6B7280] mb-6">{t('platform.adoption.subtitle', 'Feature usage across gyms & admin engagement')}</p>
      </FadeIn>

      {/* ── Critical load failure: banner + retry, no fake "Never used" ── */}
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
      {/* ═══════════════════════════════════════════════════════
          SECTION 1: Feature Adoption
         ═══════════════════════════════════════════════════════ */}

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          value={mostUsed.label}
          label={`${t('platform.adoption.mostUsed', 'Most Used')} (${mostUsed.count} ${t('platform.adoption.gyms', 'gyms')})`}
          icon={TrendingUp}
          color="#10B981"
          delay={0}
        />
        <StatCard
          value={leastUsed.label}
          label={`${t('platform.adoption.leastUsed', 'Least Used')} (${leastUsed.count} ${t('platform.adoption.gyms', 'gyms')})`}
          icon={AlertTriangle}
          color="#EF4444"
          delay={50}
        />
        <StatCard
          value={`${avgFeaturesPerGym} / ${FEATURES.length}`}
          label={t('platform.adoption.avgFeatures', 'Avg Features Per Gym')}
          icon={Puzzle}
          color="#6366F1"
          delay={100}
        />
        <StatCard
          value={gymsUnder3Features}
          label={t('platform.adoption.gymsUnder3', 'Gyms Using <3 Features')}
          icon={AlertTriangle}
          color="#F59E0B"
          delay={150}
        />
      </div>

      {/* View Toggle */}
      <FadeIn delay={180}>
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.adoption.matrix', 'Feature Adoption Matrix')}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportMatrix}
              disabled={heatmapGyms.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/6 text-[11px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#0F172A' }}
            >
              <Download className="w-3.5 h-3.5" />
              {t('platform.adoption.exportCsv', 'Export CSV')}
            </button>
            <div className="flex gap-1 bg-[#0F172A] border border-white/6 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('heatmap')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  viewMode === 'heatmap'
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                {t('platform.adoption.heatmap', 'Heatmap')}
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                {t('platform.adoption.byGym', 'By Gym')}
              </button>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Heatmap View */}
      {viewMode === 'heatmap' && (
        <FadeIn delay={200}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
            {heatmapGyms.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.adoption.noData', 'No gym data available')}</p>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="border-b border-white/6">
                      <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5 sticky left-0 bg-[#0F172A] z-10 min-w-[140px]">
                        {t('platform.adoption.gym', 'Gym')}
                      </th>
                      {FEATURES.map(f => (
                        <th
                          key={f.key}
                          className="text-center text-[9px] font-semibold text-[#6B7280] uppercase tracking-wider px-1.5 py-2.5 min-w-[60px]"
                        >
                          <span className="block leading-tight">{f.label}</span>
                        </th>
                      ))}
                      <th className="text-center text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">
                        {t('platform.adoption.total', 'Total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapGyms.map((gym) => {
                      const features = gymFeatureMap[gym.id] || new Set();
                      return (
                        <tr
                          key={gym.id}
                          className="border-b border-white/4 last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer"
                          onClick={() => navigate(`/platform/gym/${gym.id}`)}
                          role="button"
                          tabIndex={0}
                          aria-label={gym.name}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/platform/gym/${gym.id}`); } }}
                        >
                          <td className="px-3 py-2 sticky left-0 bg-[#0F172A] z-10">
                            <span className="text-[12px] font-medium text-[#E5E7EB] truncate block max-w-[140px]">
                              {gym.name}
                            </span>
                          </td>
                          {FEATURES.map(f => {
                            const isActive = features.has(f.key);
                            const everUsed = (gymFeatureEverMap[gym.id] || new Set()).has(f.key);
                            const isStale = !isActive && everUsed;
                            return (
                              <td key={f.key} className="px-1.5 py-2 text-center">
                                <div
                                  className={`w-6 h-6 mx-auto rounded-md flex items-center justify-center transition-colors ${
                                    isActive
                                      ? 'bg-emerald-500/25 border border-emerald-500/30'
                                      : isStale
                                        ? 'bg-amber-500/15 border border-amber-500/25'
                                        : 'bg-white/[0.03] border border-white/[0.04]'
                                  }`}
                                  title={isActive ? t('platform.adoption.active90d', 'Active (last 90 days)') : isStale ? t('platform.adoption.everUsed', 'Used before, inactive 90+ days') : t('platform.adoption.neverUsed', 'Never used')}
                                >
                                  {isActive ? (
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  ) : isStale ? (
                                    <Clock className="w-3 h-3 text-amber-400/70" />
                                  ) : (
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#374151]" />
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[12px] font-bold tabular-nums ${
                              features.size >= 8 ? 'text-emerald-400' :
                              features.size >= 4 ? 'text-amber-400' :
                              'text-red-400'
                            }`}>
                              {features.size}/{FEATURES.length}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/6 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-emerald-500/25 border border-emerald-500/30 flex items-center justify-center">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                    </div>
                    <span className="text-[10px] text-[#9CA3AF]">{t('platform.adoption.active90d', 'Active (last 90 days)')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                      <Clock className="w-2.5 h-2.5 text-amber-400/70" />
                    </div>
                    <span className="text-[10px] text-[#9CA3AF]">{t('platform.adoption.everUsed', 'Used before, inactive 90+ days')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-white/[0.03] border border-white/[0.04] flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#374151]" />
                    </div>
                    <span className="text-[10px] text-[#9CA3AF]">{t('platform.adoption.neverUsed', 'Never used')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </FadeIn>
      )}

      {/* Table View (By Gym) */}
      {viewMode === 'table' && (
        <FadeIn delay={200}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
            {sortedGymTable.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.adoption.noData', 'No gym data available')}</p>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-white/6">
                      <SortHeader label={t('platform.adoption.gym', 'Gym')} field="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label={t('platform.adoption.featureList', 'Features Active')} field="featuresActive" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <th className="text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5">
                        {t('platform.adoption.features', 'Features')}
                      </th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGymTable.map((gym) => (
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
                          <span className={`text-[12px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
                            gym.featuresActive >= 8
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : gym.featuresActive >= 4
                                ? 'bg-amber-500/15 text-amber-400'
                                : 'bg-red-500/15 text-red-400'
                          }`}>
                            {gym.featuresActive} / {FEATURES.length}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {gym.featureKeys.length === 0 ? (
                              <span className="text-[11px] text-[#4B5563]">{t('platform.adoption.none', 'None')}</span>
                            ) : (
                              gym.featureKeys.map(k => (
                                <span
                                  key={k}
                                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium"
                                >
                                  {featureLabel(k)}
                                </span>
                              ))
                            )}
                          </div>
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
      )}

      {/* Feature Usage Bar Chart */}
      <FadeIn delay={250}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-8">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">{t('platform.adoption.featureUsage', 'Feature Usage Across Gyms')}</h2>
          {featureCounts.every(f => f.count === 0) ? (
            <p className="text-[13px] text-[#6B7280] py-12 text-center">{t('platform.adoption.noFeatureData', 'No feature usage data available')}</p>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={featureCounts}
                  layout="vertical"
                  margin={{ left: 10, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#6B7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip
                    content={<FeatureUsageTooltip />}
                    cursor={{ fill: 'rgba(212,175,55,0.05)' }}
                  />
                  <Bar dataKey="count" name={t('platform.adoption.gymsUsing', 'Gyms Using (90d)')} radius={[0, 4, 4, 0]} barSize={18}>
                    {featureCounts.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={entry.count > 0 ? '#10B981' : '#374151'}
                        fillOpacity={entry.count > 0 ? 0.7 : 0.3}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </FadeIn>

      {/* ═══════════════════════════════════════════════════════
          SECTION 2: Admin Engagement
         ═══════════════════════════════════════════════════════ */}

      <FadeIn delay={280}>
        <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">{t('platform.adoption.adminEngagement', 'Admin Engagement')}</h2>
        <p className="text-[12px] text-[#6B7280] mb-4">{t('platform.adoption.adminEngagementDesc', 'Admin activity and presence across gyms (last 30 days)')}</p>
      </FadeIn>

      {/* Engagement Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
        <StatCard
          value={avgAdminActiveDays}
          label={t('platform.adoption.avgActiveDays', 'Admin Active Days/Week')}
          icon={Activity}
          color="#3B82F6"
          delay={300}
        />
        <StatCard
          value={mostActiveGym}
          label={t('platform.adoption.mostActiveAdmins', 'Most Active Gym Admins')}
          icon={UserCheck}
          color="#10B981"
          delay={350}
        />
        <StatCard
          value={leastActiveGym}
          label={t('platform.adoption.leastActiveAdmins', 'Least Active Gym Admins')}
          icon={Users}
          color="#F59E0B"
          delay={400}
        />
        <StatCard
          value={gymsNoActivity7d}
          label={t('platform.adoption.noActivity7d', 'No Admin Activity (7d)')}
          icon={AlertTriangle}
          color="#EF4444"
          delay={450}
        />
      </div>
      <p className="text-[10.5px] text-[#6B7280] mb-6">
        {t('platform.adoption.avgDenominatorNote', {
          count: adminScoresByGym.length,
          defaultValue: 'Average computed over the {{count}} gyms with any admin activity in the last 30 days. "Least active" considers all gyms, including zero activity.',
        })}
      </p>

      {/* Admin Engagement Bar Chart */}
      <FadeIn delay={480}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">{t('platform.adoption.adminActivityByGym', 'Admin Activity by Gym')}</h2>
          <p className="text-[11px] text-[#6B7280] mb-3">
            {t('platform.adoption.scoreExplanationMax', 'Score = distinct admin-days in the last 30 days. Gold = at least 75% of the top gym’s score.')}
          </p>
          {adminBarData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <BarChart3 className="w-5 h-5 text-[#6B7280]" />
              </div>
              <p className="text-[13px] text-[#6B7280]">{t('platform.adoption.noAdminData', 'No admin activity data available')}</p>
              <p className="text-[11px] text-[#4B5563] mt-1">{t('platform.adoption.adminTrackingDisabled', 'Admin presence tracking may not be enabled')}</p>
            </div>
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={adminBarData}
                  layout="vertical"
                  margin={{ left: 10, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#6B7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={120}
                  />
                  <Tooltip
                    content={<ChartTooltip formatter={(v) => `${v} ${t('platform.adoption.adminDays30d', 'admin-days (30d)')}`} />}
                    cursor={{ fill: 'rgba(212,175,55,0.05)' }}
                  />
                  <Bar dataKey="score" name={t('platform.adoption.activityScore', 'Activity Score')} radius={[0, 4, 4, 0]} barSize={16}>
                    {adminBarData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </FadeIn>

      {/* Recent Admin Activity */}
      <FadeIn delay={520}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.adoption.recentActivity', 'Recent Admin Activity')}</h2>
          </div>
          {recentAdminActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <Clock className="w-5 h-5 text-[#6B7280]" />
              </div>
              <p className="text-[13px] text-[#6B7280]">{t('platform.adoption.noRecentActivity', 'No recent admin activity')}</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[360px] overflow-y-auto">
              {recentAdminActivity.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                    <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-[#E5E7EB] truncate">{entry.adminName}</span>
                      <span className="text-[10px] text-[#4B5563]">{t('platform.adoption.at', 'at')}</span>
                      <span className="text-[12px] text-[#9CA3AF] truncate">{entry.gymName}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[#6B7280]">
                        {entry.page}
                      </span>
                      <span className="text-[10px] text-[#4B5563]">
                        {formatDistanceToNow(new Date(entry.when), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </FadeIn>
      </>)}
    </div>
  );
}
