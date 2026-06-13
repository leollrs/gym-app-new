import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, Building2, Users, Activity,
  ChevronRight, TrendingUp, AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { selectInBatches, selectAllRows } from '../../lib/churn/batchedSelect';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { healthScoreFromStatsRow, healthTier } from '../../lib/platform/healthScore';
import logger from '../../lib/logger';
import FadeIn from '../../components/platform/FadeIn';
import StatCard from '../../components/platform/StatCard';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import GymCreateModal from './components/GymCreateModal';

const PLAN_COLORS = {
  starter:    { bg: 'bg-[#3B82F6]/15', text: 'text-[#60A5FA]', labelKey: 'platform.gyms.planStarter',    fallback: 'Starter' },
  pro:        { bg: 'bg-[#D4AF37]/15', text: 'text-[#D4AF37]', labelKey: 'platform.gyms.planPro',        fallback: 'Pro' },
  lifetime:   { bg: 'bg-[#A855F7]/15', text: 'text-[#C084FC]', labelKey: 'platform.gyms.planLifetime',   fallback: 'Lifetime' },
  enterprise: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', labelKey: 'platform.gyms.planEnterprise', fallback: 'Enterprise' },
  free:       { bg: 'bg-[#6B7280]/15', text: 'text-[#9CA3AF]', labelKey: 'platform.gyms.planFree',       fallback: 'Free' },
};

const TierBadge = ({ tier, isFounding, t: translate }) => {
  const plan = PLAN_COLORS[tier] || PLAN_COLORS.starter;
  return (
    <span className="flex items-center gap-1">
      <span className={`${plan.bg} ${plan.text} text-[11px] font-semibold px-2 py-0.5 rounded-full`}>
        {translate(plan.labelKey, plan.fallback)}
      </span>
      {isFounding && (
        <span className="text-[10px] text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full font-medium">{translate('platform.gyms.founding', 'Founding')}</span>
      )}
    </span>
  );
};

// Health labels keyed by the SHARED healthTier (lib/platform/healthScore) —
// this list previously ran its own sessions-per-member formula and could say
// "Thriving" while the detail page scored the same gym 40 (audit dup #1).
// 'new' = unscored (0 members), deliberately NOT "At Risk".
const HEALTH_LABELS = {
  inactive: { labelKey: 'platform.gyms.healthInactive', fallback: 'Inactive', color: 'text-red-400',     bg: 'bg-red-500/15' },
  new:      { labelKey: 'platform.gyms.healthNew',      fallback: 'New',      color: 'text-blue-400',    bg: 'bg-blue-500/15' },
  thriving: { labelKey: 'platform.gyms.healthThriving', fallback: 'Thriving', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  healthy:  { labelKey: 'platform.gyms.healthHealthy',  fallback: 'Healthy',  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  watch:    { labelKey: 'platform.gyms.healthWatch',    fallback: 'Watch',    color: 'text-amber-400',   bg: 'bg-amber-500/15' },
  critical: { labelKey: 'platform.gyms.healthAtRisk',   fallback: 'At Risk',  color: 'text-red-400',     bg: 'bg-red-500/15' },
};

const FILTERS = [
  { value: 'all',      labelKey: 'platform.gyms.filterAll',      fallback: 'All' },
  { value: 'active',   labelKey: 'platform.gyms.filterActive',   fallback: 'Active' },
  { value: 'inactive', labelKey: 'platform.gyms.filterInactive', fallback: 'Inactive' },
  { value: 'at risk',  labelKey: 'platform.gyms.filterAtRisk',   fallback: 'At Risk' },
];
const SORT_OPTIONS = [
  { value: 'newest',      labelKey: 'platform.gyms.sortNewest',     fallback: 'Newest' },
  { value: 'largest',     labelKey: 'platform.gyms.sortLargest',    fallback: 'Largest' },
  { value: 'most-active', labelKey: 'platform.gyms.sortMostActive', fallback: 'Most Active' },
  { value: 'name',        labelKey: 'platform.gyms.sortName',       fallback: 'Name' },
];

export default function GymsOverview() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const { showToast } = useToast();

  const [gyms, setGyms] = useState([]);
  const [statsByGym, setStatsByGym] = useState({});
  const [ownerProfiles, setOwnerProfiles] = useState({});
  const [newGymsThisMonth, setNewGymsThisMonth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    document.title = `${t('platform.gyms.title', 'Gyms')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      // platform_gym_stats (0437) aggregates server-side: real member counts
      // (role=member, no imported ghosts/staff/null-gym leaks) and
      // completed-only 30d sessions. The old code pulled EVERY profile and
      // EVERY 30d session platform-wide into the browser to count them.
      const [gymsRes, statsRes] = await Promise.all([
        selectAllRows((from, to) =>
          supabase.from('gyms').select('*').order('created_at', { ascending: false }).range(from, to)
        ),
        supabase.rpc('platform_gym_stats'),
      ]);

      const gymsList = gymsRes.data || [];
      setGyms(gymsList);

      if (statsRes.error) {
        logger.error('platform_gym_stats failed:', statsRes.error);
        showToast(t('platform.gyms.statsLoadFailed', 'Could not load gym activity stats'), 'error');
        setStatsByGym({});
      } else {
        const map = {};
        (statsRes.data || []).forEach((row) => { map[row.gym_id] = row; });
        setStatsByGym(map);
      }

      // New gyms this month
      setNewGymsThisMonth(gymsList.filter(g => g.created_at >= monthStart).length);

      // Owner profiles
      const ownerIds = [...new Set(gymsList.map((g) => g.owner_user_id).filter(Boolean))];
      if (ownerIds.length > 0) {
        const { data: owners } = await selectInBatches(
          (ids) => supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', ids),
          ownerIds
        );
        const map = {};
        (owners || []).forEach((o) => { map[o.id] = o.full_name; });
        setOwnerProfiles(map);
      }
    } catch (err) {
      logger.error('Failed to fetch gyms data:', err);
      showToast(t('platform.gyms.loadFailed', 'Could not load gyms'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Shared health pipeline: stats row → score → tier → label.
  const gymHealth = useCallback((gym) => {
    if (!gym.is_active) return HEALTH_LABELS.inactive;
    const tier = healthTier(healthScoreFromStatsRow(statsByGym[gym.id]));
    return HEALTH_LABELS[tier] ?? HEALTH_LABELS.new;
  }, [statsByGym]);

  const memberCount = useCallback((gymId) => statsByGym[gymId]?.member_count ?? 0, [statsByGym]);
  const sessionCount = useCallback((gymId) => statsByGym[gymId]?.sessions_30d ?? 0, [statsByGym]);

  const filtered = useMemo(() => {
    let list = gyms;
    if (filter === 'active') list = list.filter((g) => g.is_active);
    if (filter === 'inactive') list = list.filter((g) => !g.is_active);
    // Same predicate as the Struggling KPI (audit L15: the filter used to also
    // match Moderate while the KPI counted only At Risk).
    if (filter === 'at risk') {
      list = list.filter((g) => g.is_active && healthTier(healthScoreFromStatsRow(statsByGym[g.id])) === 'critical');
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) =>
        g.name?.toLowerCase().includes(q) ||
        g.slug?.toLowerCase().includes(q) ||
        ownerProfiles[g.owner_user_id]?.toLowerCase().includes(q)
      );
    }

    // Sort
    switch (sort) {
      case 'largest':
        list = [...list].sort((a, b) => memberCount(b.id) - memberCount(a.id));
        break;
      case 'most-active':
        list = [...list].sort((a, b) => sessionCount(b.id) - sessionCount(a.id));
        break;
      case 'name':
        list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      default: // newest — already sorted by created_at desc
        break;
    }

    return list;
  }, [gyms, filter, search, sort, statsByGym, ownerProfiles, memberCount, sessionCount]);

  const totalMembers = useMemo(
    () => Object.values(statsByGym).reduce((a, row) => a + (row.member_count ?? 0), 0),
    [statsByGym]
  );
  const activeGyms = useMemo(() => gyms.filter((g) => g.is_active).length, [gyms]);
  const inactiveGyms = gyms.length - activeGyms;
  const strugglingGyms = useMemo(
    () => gyms.filter(g => g.is_active && healthTier(healthScoreFromStatsRow(statsByGym[g.id])) === 'critical').length,
    [gyms, statsByGym]
  );

  if (loading) {
    return <PlatformSpinner />;
  }

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('platform.gyms.title', 'Gyms')}</h1>
            <p className="text-[12px] text-[#6B7280] mt-0.5">{t('platform.gyms.subtitle', 'Platform customers and account status')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5 transition-colors flex-shrink-0 whitespace-nowrap"
            >
              <Plus size={14} />
              {t('platform.gyms.newGym', 'New Gym')}
            </button>
          </div>
        </div>
      </FadeIn>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 mb-6">
        <StatCard label={t('platform.gyms.totalGyms', 'Total Gyms')} value={gyms.length} icon={Building2} borderColor="var(--color-accent, #D4AF37)" delay={50} />
        <StatCard label={t('platform.gyms.activeGyms', 'Active Gyms')} value={activeGyms} icon={Activity} borderColor="#10B981" delay={80} />
        <StatCard label={t('platform.gyms.inactiveLabel', 'Inactive')} value={inactiveGyms} icon={Building2} borderColor="#EF4444" delay={110} />
        <StatCard label={t('platform.gyms.totalMembers', 'Total Members')} value={totalMembers} icon={Users} borderColor="#3B82F6" delay={140} />
        <StatCard label={t('platform.gyms.newThisMonth', 'New This Month')} value={newGymsThisMonth} icon={TrendingUp} borderColor="#8B5CF6" delay={170} />
        <StatCard label={t('platform.gyms.struggling', 'Struggling')} value={strugglingGyms} icon={AlertTriangle} borderColor="#F59E0B" delay={200} />
      </div>

      {/* Filters toolbar */}
      <FadeIn delay={230}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('platform.gyms.searchPlaceholder', 'Search by name, slug, or owner...')}
              className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          <div className="flex gap-2">
            {/* Filter chips */}
            <div className="flex gap-1 bg-[#0F172A] border border-white/6 rounded-lg p-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                    filter === f.value
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
                >
                  {t(f.labelKey, f.fallback)}
                </button>
              ))}
            </div>

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="bg-[#0F172A] border border-white/6 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors cursor-pointer appearance-none"
              style={{ backgroundImage: 'none' }}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{t(o.labelKey, o.fallback)}</option>
              ))}
            </select>
          </div>
        </div>
      </FadeIn>

      {/* Gym table */}
      <FadeIn delay={280}>
        {filtered.length === 0 ? (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-12 text-center">
            <Building2 size={32} className="mx-auto text-[#4B5563] mb-3" />
            <p className="text-[14px] text-[#6B7280]">{t('platform.gyms.noGymsFound', 'No gyms found')}</p>
          </div>
        ) : (
          <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid grid-cols-[1fr_100px_80px_80px_80px_100px_120px_32px] gap-4 px-4 py-3 border-b border-white/6 text-[10px] text-[#6B7280] uppercase tracking-wider font-semibold">
              <span>{t('platform.gyms.headerGym', 'Gym')}</span>
              <span>{t('platform.gyms.headerPlan', 'Plan')}</span>
              <span className="text-right">{t('platform.gyms.headerMembers', 'Members')}</span>
              <span className="text-center">{t('platform.gyms.headerHealth', 'Health')}</span>
              <span className="text-center">{t('platform.gyms.headerStatus', 'Status')}</span>
              <span>{t('platform.gyms.headerLastActivity', 'Last Activity')}</span>
              <span>{t('platform.gyms.headerOwner', 'Owner')}</span>
              <span />
            </div>
            {filtered.map((gym) => {
              const health = gymHealth(gym);
              return (
                <button
                  key={gym.id}
                  onClick={() => navigate(`/platform/gym/${gym.id}`)}
                  className="w-full text-left grid grid-cols-1 md:grid-cols-[1fr_100px_80px_80px_80px_100px_120px_32px] gap-2 md:gap-4 px-4 py-3.5 border-b border-white/4 last:border-b-0 hover:bg-[#111827] transition-colors group"
                >
                  {/* Gym name */}
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate group-hover:text-white transition-colors">
                      {gym.name}
                    </p>
                    <p className="text-[11px] text-[#6B7280] truncate">{gym.slug}</p>
                  </div>

                  {/* Mobile meta row */}
                  <div className="flex items-center md:hidden gap-2 flex-wrap">
                    <TierBadge tier={gym.plan_type || gym.subscription_tier} isFounding={gym.is_founding} t={t} />
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${health.bg} ${health.color}`}>
                      {t(health.labelKey, health.fallback)}
                    </span>
                    <span className="text-[11px] text-[#6B7280]">{memberCount(gym.id)} {t('platform.gyms.members', 'members')}</span>
                  </div>

                  {/* Desktop: Plan */}
                  <div className="hidden md:flex items-center">
                    <TierBadge tier={gym.plan_type || gym.subscription_tier} isFounding={gym.is_founding} t={t} />
                  </div>

                  {/* Desktop: Members */}
                  <p className="hidden md:flex items-center justify-end text-[13px] text-[#9CA3AF] tabular-nums">
                    {memberCount(gym.id).toLocaleString()}
                  </p>

                  {/* Desktop: Health */}
                  <div className="hidden md:flex items-center justify-center">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${health.bg} ${health.color}`}>
                      {t(health.labelKey, health.fallback)}
                    </span>
                  </div>

                  {/* Desktop: Status */}
                  <div className="hidden md:flex items-center justify-center">
                    <span className={`w-2 h-2 rounded-full ${gym.is_active ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
                  </div>

                  {/* Desktop: Last activity (completed sessions, 30d) */}
                  <p className="hidden md:flex items-center text-[11px] text-[#6B7280] truncate">
                    {sessionCount(gym.id) ? `${sessionCount(gym.id)} ${t('platform.gyms.sessions', 'sessions')}` : t('platform.gyms.noActivity', 'No activity')}
                  </p>

                  {/* Desktop: Owner */}
                  <p className="hidden md:flex items-center text-[12px] text-[#9CA3AF] truncate">
                    {ownerProfiles[gym.owner_user_id] || '—'}
                  </p>

                  {/* Chevron */}
                  <div className="hidden md:flex items-center justify-end">
                    <ChevronRight size={14} className="text-[#4B5563] group-hover:text-[#D4AF37] transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </FadeIn>

      {showCreateModal && (
        <GymCreateModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchData(); }}
          t={t}
          showToast={showToast}
          profile={profile}
        />
      )}
    </div>
  );
}
