import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  Puzzle, Users, Activity, BarChart3, Eye, TrendingUp,
  ArrowUpDown, ChevronRight, Grid3X3, List, Clock,
  AlertTriangle, CheckCircle2, Building2, UserCheck,
} from 'lucide-react';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { supabase } from '../../lib/supabase';
import ChartTooltip from '../../components/ChartTooltip';

// ── Feature definitions ─────────────────────────────────────
const FEATURES_DEF = [
  { key: 'classes',     labelKey: 'platform.adoption.feat.classes',     labelDefault: 'Classes',       table: 'gym_classes',       field: 'gym_id' },
  { key: 'challenges',  labelKey: 'platform.adoption.feat.challenges',  labelDefault: 'Challenges',    table: 'gym_challenges',    field: 'gym_id' },
  { key: 'winback',     labelKey: 'platform.adoption.feat.winback',     labelDefault: 'Churn/Win-back',table: 'win_back_attempts', field: 'gym_id' },
  { key: 'messaging',   labelKey: 'platform.adoption.feat.messaging',   labelDefault: 'Messaging',     table: 'message_templates', field: 'gym_id' },
  { key: 'programs',    labelKey: 'platform.adoption.feat.programs',    labelDefault: 'Programs',       table: 'gym_programs',      field: 'gym_id' },
  { key: 'referrals',   labelKey: 'platform.adoption.feat.referrals',   labelDefault: 'Referrals',      table: 'referral_codes',    field: 'gym_id' },
  { key: 'rewards',     labelKey: 'platform.adoption.feat.rewards',     labelDefault: 'Rewards',        table: 'reward_milestones', field: 'gym_id' },
  { key: 'nps',         labelKey: 'platform.adoption.feat.nps',         labelDefault: 'NPS',            table: 'nps_responses',     field: 'gym_id' },
  { key: 'announcements',labelKey: 'platform.adoption.feat.announcements',labelDefault: 'Announcements', table: 'announcement',      field: 'gym_id' },
  { key: 'analytics',   labelKey: 'platform.adoption.feat.analytics',   labelDefault: 'Analytics',      table: 'churn_risk_scores', field: 'gym_id' },
  { key: 'store',       labelKey: 'platform.adoption.feat.store',       labelDefault: 'Store',          table: 'gym_store_products',field: 'gym_id' },
  { key: 'segments',    labelKey: 'platform.adoption.feat.segments',    labelDefault: 'Segments',       table: 'member_segments',   field: 'gym_id' },
];

// ── Fade-in wrapper ─────────────────────────────────────────
const FadeIn = ({ delay = 0, children, className = '' }) => (
  <div
    className={`animate-fade-in-up ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
  >
    {children}
  </div>
);

// ── Stat Card ───────────────────────────────────────────────
const StatCard = ({ value, label, icon: Icon, color = '#6366F1', delay = 0 }) => (
  <FadeIn delay={delay}>
    <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 border-l-2 overflow-hidden" style={{ borderLeftColor: color }}>
      <div className="flex items-center justify-between mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <p className="text-[24px] font-bold text-[#E5E7EB] leading-none tabular-nums truncate">{value}</p>
      <p className="text-[11px] text-[#9CA3AF] mt-1 truncate">{label}</p>
    </div>
  </FadeIn>
);

// ── Loading Spinner ─────────────────────────────────────────
const Spinner = () => (
  <div className="flex items-center justify-center py-32">
    <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
  </div>
);

// ── Safe query helper ───────────────────────────────────────
async function safeQuery(table, field, limit = 1000) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(field)
      .limit(limit);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ── Main Component ──────────────────────────────────────────
export default function FeatureAdoption() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const FEATURES = useMemo(() =>
    FEATURES_DEF.map(f => ({ ...f, label: t(f.labelKey, f.labelDefault) })),
    [t]
  );

  const [loading, setLoading] = useState(true);
  const [gyms, setGyms] = useState([]);
  const [featureData, setFeatureData] = useState({});   // { featureKey: Set<gym_id> }
  const [adminPresence, setAdminPresence] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [viewMode, setViewMode] = useState('heatmap');  // 'heatmap' | 'table'
  const [sortKey, setSortKey] = useState('featuresActive');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    document.title = `${t('platform.adoption.title', 'Feature Adoption')} | TuGymPR`;
  }, [t]);

  // ── Fetch all data ────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 30).toISOString();

      // Fetch gyms
      const { data: gymData } = await supabase
        .from('gyms')
        .select('id, name, slug, is_active, created_at');
      setGyms(gymData || []);

      // Fetch feature usage in parallel
      const featureResults = await Promise.all(
        FEATURES_DEF.map(async (f) => {
          const rows = await safeQuery(f.table, f.field);
          const gymIds = new Set(rows.map(r => r[f.field]).filter(Boolean));
          return { key: f.key, gymIds };
        })
      );

      const fData = {};
      featureResults.forEach(({ key, gymIds }) => {
        fData[key] = gymIds;
      });
      setFeatureData(fData);

      // Fetch admin presence (last 30d)
      try {
        const { data: presenceData } = await supabase
          .from('admin_presence')
          .select('gym_id, profile_id, current_page, last_seen_at')
          .gte('last_seen_at', thirtyDaysAgo)
          .order('last_seen_at', { ascending: false })
          .limit(2000);
        setAdminPresence(presenceData || []);
      } catch {
        setAdminPresence([]);
      }

      // Fetch admin profiles
      try {
        const { data: adminData } = await supabase
          .from('profiles')
          .select('id, full_name, gym_id, role')
          .in('role', ['admin', 'super_admin']);
        setAdmins(adminData || []);
      } catch {
        setAdmins([]);
      }

      setLoading(false);
    };

    fetchAll();
  }, []);

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

  // Per-feature gym count
  const featureCounts = useMemo(() => {
    return FEATURES.map(f => ({
      ...f,
      count: (featureData[f.key] || new Set()).size,
    }));
  }, [featureData]);

  // Most / least used
  const mostUsed = useMemo(() => {
    const sorted = [...featureCounts].sort((a, b) => b.count - a.count);
    return sorted[0] || { label: 'N/A', count: 0 };
  }, [featureCounts]);

  const leastUsed = useMemo(() => {
    const sorted = [...featureCounts].sort((a, b) => a.count - b.count);
    return sorted[0] || { label: 'N/A', count: 0 };
  }, [featureCounts]);

  // Per-gym feature count
  const gymFeatureMap = useMemo(() => {
    const map = {}; // gym_id -> Set of feature keys
    gyms.forEach(g => { map[g.id] = new Set(); });
    FEATURES_DEF.forEach(f => {
      const gymIds = featureData[f.key] || new Set();
      gymIds.forEach(gid => {
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

  // Average admin logins/week
  const avgAdminLoginsWeek = useMemo(() => {
    if (!adminScoresByGym.length) return '0';
    const totalScore = adminScoresByGym.reduce((s, g) => s + g.score, 0);
    // 30 days ~ 4.3 weeks
    return (totalScore / adminScoresByGym.length / 4.3).toFixed(1);
  }, [adminScoresByGym]);

  const mostActiveGym = useMemo(() => {
    return adminScoresByGym[0]?.name || 'N/A';
  }, [adminScoresByGym]);

  const leastActiveGym = useMemo(() => {
    if (!adminScoresByGym.length) return 'N/A';
    return adminScoresByGym[adminScoresByGym.length - 1]?.name || 'N/A';
  }, [adminScoresByGym]);

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

  // Bar chart data for admin engagement
  const adminBarData = useMemo(() => {
    if (!adminScoresByGym.length) return [];
    const maxScore = adminScoresByGym[0]?.score || 1;
    const topQuartileThreshold = maxScore * 0.75;
    return adminScoresByGym.slice(0, 20).map(g => ({
      ...g,
      fill: g.score >= topQuartileThreshold ? '#D4AF37' : '#4B5563',
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

  // ── Render ────────────────────────────────────────────────
  if (loading) return <Spinner />;

  const SortHeader = ({ label, field, className = '' }) => (
    <th
      className={`text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none hover:text-[#9CA3AF] transition-colors ${className}`}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className="w-3 h-3 opacity-40" />
        {sortKey === field && (
          <span className="text-[#D4AF37] text-[9px]">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
        )}
      </span>
    </th>
  );

  const featureLabel = (key) => FEATURES.find(f => f.key === key)?.label || key;

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-0.5 truncate">{t('platform.adoption.title', 'Feature Adoption')}</h1>
        <p className="text-[12px] text-[#6B7280] mb-6">{t('platform.adoption.subtitle', 'Feature usage across gyms & admin engagement')}</p>
      </FadeIn>

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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.adoption.matrix', 'Feature Adoption Matrix')}</h2>
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
      </FadeIn>

      {/* Heatmap View */}
      {viewMode === 'heatmap' && (
        <FadeIn delay={200}>
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6 overflow-hidden">
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
                    {heatmapGyms.map((gym, i) => {
                      const features = gymFeatureMap[gym.id] || new Set();
                      return (
                        <tr
                          key={gym.id}
                          className="border-b border-white/4 last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer"
                          onClick={() => navigate(`/platform/gym/${gym.id}`)}
                        >
                          <td className="px-3 py-2 sticky left-0 bg-[#0F172A] z-10">
                            <span className="text-[12px] font-medium text-[#E5E7EB] truncate block max-w-[140px]">
                              {gym.name}
                            </span>
                          </td>
                          {FEATURES.map(f => {
                            const isUsed = features.has(f.key);
                            return (
                              <td key={f.key} className="px-1.5 py-2 text-center">
                                <div
                                  className={`w-6 h-6 mx-auto rounded-md flex items-center justify-center transition-colors ${
                                    isUsed
                                      ? 'bg-emerald-500/25 border border-emerald-500/30'
                                      : 'bg-white/[0.03] border border-white/[0.04]'
                                  }`}
                                >
                                  {isUsed ? (
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
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
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/6">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-emerald-500/25 border border-emerald-500/30 flex items-center justify-center">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                    </div>
                    <span className="text-[10px] text-[#9CA3AF]">{t('platform.adoption.activelyUsed', 'Actively used')}</span>
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
                      <SortHeader label={t('platform.adoption.gym', 'Gym')} field="name" />
                      <SortHeader label={t('platform.adoption.featureList', 'Features Active')} field="featuresActive" />
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
                    content={<ChartTooltip formatter={(v) => `${v} ${t('platform.adoption.gyms', 'gyms')}`} />}
                    cursor={{ fill: 'rgba(212,175,55,0.05)' }}
                  />
                  <Bar dataKey="count" name={t('platform.adoption.gymsUsing', 'Gyms Using')} radius={[0, 4, 4, 0]} barSize={18}>
                    {featureCounts.map((entry, idx) => (
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          value={avgAdminLoginsWeek}
          label={t('platform.adoption.avgLogins', 'Avg Admin Logins/Week')}
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

      {/* Admin Engagement Bar Chart */}
      <FadeIn delay={480}>
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6">
          <h2 className="text-[15px] font-semibold text-[#E5E7EB] mb-4">{t('platform.adoption.adminActivityByGym', 'Admin Activity by Gym')}</h2>
          <p className="text-[11px] text-[#6B7280] mb-3">
            {t('platform.adoption.scoreExplanation', 'Score = distinct admin-day sessions in last 30 days. Gold = top quartile.')}
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
                    content={<ChartTooltip formatter={(v) => `${v} ${t('platform.adoption.sessions30d', 'sessions (30d)')}`} />}
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
    </div>
  );
}
