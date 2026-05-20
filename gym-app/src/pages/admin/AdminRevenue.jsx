import { useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Coins, ArrowUpDown, ShoppingCart, TrendingUp,
  Gift, CreditCard, Clock, Package, DollarSign, Receipt, Wallet,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { format, subDays, parseISO } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useInsightsRange } from '../../contexts/InsightsRangeContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  PageHeader, AdminPageShell, AdminCard, FadeIn, CardSkeleton,
  SectionLabel,
} from '../../components/admin';
import StatCard from '../../components/admin/StatCard';
import useCountUp from '../../hooks/useCountUp';

// ── Constants ──────────────────────────────────────────────
const PERIOD_OPTIONS = [
  { key: '7d',  label: '7d',  days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: null },
];

const CATEGORY_COLORS = {
  supplement: 'var(--color-info)',
  drink:      'var(--color-info)',
  snack:      'var(--color-warning)',
  merchandise:'var(--color-coach)',
  service:    'var(--color-success)',
  other:      'var(--color-admin-text-sub)',
};

// ── Custom Tooltip ─────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1E293B] border border-white/10 rounded-lg px-3 py-2 text-[11px] shadow-xl">
      <p className="text-[#9CA3AF] mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-[#E5E7EB]" style={{ color: p.color }}>
          {p.name}: {p.value?.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

// ── Local Stat Card variants ───────────────────────────────
// StatCard's built-in count-up only handles raw numbers / percentages.
// Dollar amounts need a "$" prefix and 2-decimal display, plus we want a
// native title tooltip on a couple of metrics — both of which would otherwise
// require touching the shared StatCard. Keep the visual signature aligned.
function DollarStatCard({ label, amount, icon: Icon, borderColor, delay = 0, title, placeholder = false }) {
  const animated = useCountUp(placeholder ? 0 : amount, 900);
  const display = placeholder
    ? '—'
    : `$${animated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <FadeIn delay={delay}>
      <div
        title={title}
        className="admin-stat-card border-l-2 group w-full text-left p-3 md:p-4"
        style={{ borderLeftColor: borderColor }}
      >
        <div className="flex items-start justify-between overflow-hidden">
          <div className="min-w-0 flex-1">
            <p className="admin-kpi truncate text-[20px] md:text-[26px]">{display}</p>
            <p className="font-medium group-hover:text-[color:var(--color-text-secondary)] transition-colors truncate text-[11px] md:text-[12px] mt-1.5 text-[color:var(--color-text-muted)]">
              {label}
            </p>
          </div>
          {Icon && (
            <div
              className="rounded-xl flex items-center justify-center flex-shrink-0 w-9 h-9"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Icon size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </div>
          )}
        </div>
      </div>
    </FadeIn>
  );
}

// Tooltip-aware wrapper around StatCard (StatCard itself doesn't accept `title`).
function TooltippedStatCard({ title, ...statProps }) {
  return (
    <div title={title}>
      <StatCard {...statProps} />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
export default function AdminRevenue() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;

  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  // Period shared across Insights pages — see InsightsRangeContext.
  const { periodDays: ctxPeriodDays, setPeriodDays } = useInsightsRange();
  const matchedPeriod = PERIOD_OPTIONS.find((o) => o.days === ctxPeriodDays) ?? PERIOD_OPTIONS.find((o) => o.key === '30d');
  const period = matchedPeriod.key;
  const setPeriod = (key) => setPeriodDays((PERIOD_OPTIONS.find((o) => o.key === key) || {}).days ?? null);

  useEffect(() => { document.title = t('admin.revenue.pageTitle', `Admin - Revenue | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

  const periodDays = PERIOD_OPTIONS.find(p => p.key === period)?.days;
  const cutoffDate = periodDays ? subDays(new Date(), periodDays).toISOString() : null;

  // ── Queries ────────────────────────────────────────────
  const { data: pointsData, isLoading: loadingPoints } = useQuery({
    queryKey: adminKeys.revenue.points(gymId, period),
    queryFn: async () => {
      // Single round-trip; partition positive vs negative client-side.
      let q = supabase
        .from('reward_points_log')
        .select('points, created_at')
        .eq('gym_id', gymId)
        .neq('points', 0)
        .limit(20000);
      if (cutoffDate) q = q.gte('created_at', cutoffDate);

      const { data } = await q;
      const issued = [];
      const spent = [];
      for (const row of (data || [])) {
        if (row.points > 0) issued.push(row);
        else spent.push(row);
      }
      return { issued, spent };
    },
    enabled: !!gymId,
  });

  const { data: purchases, isLoading: loadingPurchases } = useQuery({
    queryKey: adminKeys.revenue.purchases(gymId, period),
    queryFn: async () => {
      let q = supabase
        .from('member_purchases')
        .select('id, points_earned, total_price, is_free_reward, created_at, quantity, product_id, member_id, gym_products(name, category, emoji_icon, punch_card_target, price), profiles:member_id(full_name)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });

      if (cutoffDate) {
        q = q.gte('created_at', cutoffDate);
      }

      const { data } = await q;
      return data || [];
    },
    enabled: !!gymId,
  });

  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: adminKeys.revenue.products(gymId),
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_products')
        .select('id, name, emoji_icon, punch_card_enabled, punch_card_target, category, price, points_per_purchase')
        .eq('gym_id', gymId);
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Computed data ──────────────────────────────────────
  const kpis = useMemo(() => {
    const issued = pointsData ? pointsData.issued.reduce((s, r) => s + r.points, 0) : 0;
    const redeemed = pointsData ? Math.abs(pointsData.spent.reduce((s, r) => s + r.points, 0)) : 0;

    // Dollar-side metrics from member_purchases.
    // total_price is already populated by the existing query — paid purchases have a price,
    // free rewards (is_free_reward) are excluded from sales totals.
    const paid = (purchases || []).filter(p => !p.is_free_reward);
    const totalSales = paid.reduce((s, p) => s + (parseFloat(p.total_price) || 0), 0);
    const paidCount = paid.length;
    const avgTransaction = paidCount > 0 ? totalSales / paidCount : 0;

    // Free-reward cost: sum of catalog price (gym_products.price) for is_free_reward rows.
    // This is what the gym "paid" by giving the product away for points instead of cash.
    const freeRewards = (purchases || []).filter(p => p.is_free_reward);
    const freeRewardCost = freeRewards.reduce(
      (s, p) => s + (parseFloat(p.gym_products?.price) || 0),
      0,
    );

    return {
      issued,
      redeemed,
      net: issued - redeemed,
      redemptions: purchases?.length || 0,
      totalSales,
      paidCount,
      avgTransaction,
      freeRewardCost,
      freeRewardCount: freeRewards.length,
    };
  }, [pointsData, purchases]);

  const categoryData = useMemo(() => {
    if (!purchases) return [];
    const grouped = {};
    purchases.forEach(p => {
      const cat = p.gym_products?.category || 'other';
      if (!grouped[cat]) grouped[cat] = { category: cat, count: 0, revenue: 0 };
      grouped[cat].count += 1;
      grouped[cat].revenue += parseFloat(p.total_price) || 0;
    });
    return Object.values(grouped)
      .sort((a, b) => b.count - a.count)
      .map(d => ({ ...d, label: t(`admin.revenue.categories.${d.category}`, d.category) }));
  }, [purchases, t]);

  const flowData = useMemo(() => {
    if (!pointsData) return [];
    // For "All time", use the date span of the actual data instead of falling
    // back to 30 days. Without this fix, the chart silently displays only the
    // last 30 days of buckets even though the period selector says "All".
    let days = periodDays;
    if (days == null) {
      const allRows = [...pointsData.issued, ...pointsData.spent];
      if (!allRows.length) return [];
      const earliest = allRows.reduce((min, r) => {
        const t = new Date(r.created_at).getTime();
        return t < min ? t : min;
      }, Date.now());
      days = Math.max(7, Math.ceil((Date.now() - earliest) / (1000 * 60 * 60 * 24)) + 1);
    }
    const map = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'MMM dd', dateFnsLocale);
      map[d] = { date: d, earned: 0, spent: 0 };
    }
    pointsData.issued.forEach(r => {
      const d = format(parseISO(r.created_at), 'MMM dd', dateFnsLocale);
      if (map[d]) map[d].earned += r.points;
    });
    pointsData.spent.forEach(r => {
      const d = format(parseISO(r.created_at), 'MMM dd', dateFnsLocale);
      if (map[d]) map[d].spent += Math.abs(r.points);
    });
    return Object.values(map);
  }, [pointsData, periodDays, isEs]);

  const topProducts = useMemo(() => {
    if (!purchases) return [];
    const grouped = {};
    purchases.forEach(p => {
      const pid = p.product_id;
      if (!grouped[pid]) {
        grouped[pid] = {
          id: pid,
          name: p.gym_products?.name || t('admin.revenue.unknownProduct'),
          emoji: p.gym_products?.emoji_icon || '',
          category: p.gym_products?.category || 'other',
          count: 0,
          totalRevenue: 0,
        };
      }
      grouped[pid].count += p.quantity || 1;
      grouped[pid].totalRevenue += parseFloat(p.total_price) || 0;
    });
    return Object.values(grouped).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [purchases, t]);

  const punchCardData = useMemo(() => {
    if (!products || !purchases) return [];
    const punchProducts = products.filter(p => p.punch_card_enabled && p.punch_card_target > 0);
    if (punchProducts.length === 0) return [];

    return punchProducts.map(product => {
      const productPurchases = purchases.filter(p => p.product_id === product.id && !p.is_free_reward);
      const totalStamps = productPurchases.reduce((sum, p) => sum + (p.quantity || 1), 0);
      const completions = Math.floor(totalStamps / product.punch_card_target);
      const inProgress = totalStamps % product.punch_card_target;
      return {
        id: product.id,
        name: product.name,
        emoji: product.emoji_icon,
        punchCardSize: product.punch_card_target,
        totalStamps,
        completions,
        inProgress,
        completionRate: totalStamps > 0 ? Math.round((completions * product.punch_card_target / totalStamps) * 100) : 0,
      };
    });
  }, [products, purchases]);

  const recentRedemptions = useMemo(() => {
    if (!purchases) return [];
    return purchases;
  }, [purchases]);

  const isLoading = loadingPoints || loadingPurchases || loadingProducts;

  // ── Render ─────────────────────────────────────────────
  return (
    <AdminPageShell>
      {/* Header */}
      <FadeIn>
        <PageHeader
          title={t('admin.revenue.title', 'Store & Rewards')}
          subtitle={t('admin.revenue.subtitle', 'Sales, redemptions, and points circulation')}
          className="mb-6"
        />
      </FadeIn>

      {/* Period Filter — as admin-pills */}
      <FadeIn delay={30}>
        <div className="flex gap-1.5 mb-4 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setPeriod(opt.key)}
              className={`admin-pill flex-shrink-0 ${period === opt.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
              style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {t(`admin.revenue.period.${opt.key}`, opt.label)}
            </button>
          ))}
        </div>
      </FadeIn>

      {/* ── Sales (dollars first) ───────────────────────────── */}
      <SectionLabel className="mb-3 mt-2">
        {t('admin.revenue.salesSection', 'Sales')}
      </SectionLabel>
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3 mb-6">
          {[...Array(3)].map((_, i) => <CardSkeleton key={i} className="h-[88px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3 mb-6">
          <DollarStatCard
            label={t('admin.revenue.totalSales', 'Total Sales')}
            amount={kpis.totalSales}
            icon={DollarSign}
            borderColor="var(--color-success)"
            delay={60}
          />
          <DollarStatCard
            label={t('admin.revenue.freeRewardCost', 'Free Reward Cost')}
            amount={kpis.freeRewardCost}
            placeholder={kpis.freeRewardCount === 0}
            icon={Gift}
            borderColor="var(--color-coach)"
            delay={90}
            title={t(
              'admin.revenue.freeRewardCostTooltip',
              'Catalog value of products given away as point redemptions in this period.',
            )}
          />
          <DollarStatCard
            label={t('admin.revenue.avgTransaction', 'Avg Transaction')}
            amount={kpis.avgTransaction}
            placeholder={kpis.paidCount === 0}
            icon={Receipt}
            borderColor="var(--color-info)"
            delay={120}
          />
        </div>
      )}

      {/* ── Points Economy (secondary) ──────────────────────── */}
      <SectionLabel className="mb-3 mt-2">
        {t('admin.revenue.pointsEconomySection', 'Points Economy')}
      </SectionLabel>
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3 mb-6">
          {[...Array(3)].map((_, i) => <CardSkeleton key={i} className="h-[88px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3 mb-6">
          <StatCard
            label={t('admin.revenue.pointsIssued', 'Points Issued')}
            value={kpis.issued}
            icon={Coins}
            borderColor="var(--color-accent)"
            delay={60}
          />
          <StatCard
            label={t('admin.revenue.pointsRedeemed', 'Points Redeemed')}
            value={kpis.redeemed}
            icon={Gift}
            borderColor="var(--color-coach)"
            delay={90}
          />
          <TooltippedStatCard
            label={t('admin.revenue.outstandingLiability', 'Outstanding Points Liability')}
            value={kpis.net}
            icon={Wallet}
            borderColor="var(--color-info)"
            delay={120}
            title={t(
              'admin.revenue.outstandingLiabilityTooltip',
              'Points members have earned but not yet spent — represents future redemption cost.',
            )}
          />
          <StatCard
            label={t('admin.revenue.totalRedemptions', 'Total Redemptions')}
            value={kpis.redemptions}
            icon={ShoppingCart}
            borderColor="var(--color-success)"
            delay={150}
          />
        </div>
      )}

      {/* Charts: Category + Point Flow side by side on desktop */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        {/* Revenue by Category */}
        <FadeIn delay={180}>
          <AdminCard className="h-full">
            <SectionLabel>{t('admin.revenue.revenueByCategory', 'Redemptions by Category')}</SectionLabel>
            {isLoading ? (
              <CardSkeleton className="h-[200px] mt-3" />
            ) : categoryData.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-8 text-center">
                {t('admin.revenue.noRedemptions', 'No redemptions in this period')}
              </p>
            ) : (
              <div className="h-[140px] sm:h-[170px] md:h-[220px] mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--color-admin-text-sub)', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: 'var(--color-admin-text-sub)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name={t('admin.revenue.redemptions', 'Redemptions')} radius={[6, 6, 0, 0]}>
                      {categoryData.map((entry) => (
                        <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] || 'var(--color-admin-text-sub)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Point Flow Chart */}
        <FadeIn delay={240}>
          <AdminCard className="h-full">
            <SectionLabel>{t('admin.revenue.pointFlow', 'Point Flow')}</SectionLabel>
            <p className="text-[11px] text-[#6B7280] mt-1 mb-3">
              {t('admin.revenue.pointFlowDesc', 'Points earned vs spent per day')}
            </p>
            {isLoading ? (
              <CardSkeleton className="h-[200px]" />
            ) : flowData.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-8 text-center">
                {t('admin.revenue.noData', 'No data available')}
              </p>
            ) : (
              <div className="h-[160px] sm:h-[190px] md:h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={flowData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'var(--color-admin-text-sub)', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: 'var(--color-admin-text-sub)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="earned"
                      name={t('admin.revenue.earned', 'Earned')}
                      stroke="var(--color-accent)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: 'var(--color-accent)' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="spent"
                      name={t('admin.revenue.spent', 'Spent')}
                      stroke="var(--color-coach)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: 'var(--color-coach)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </AdminCard>
        </FadeIn>
      </div>

      {/* Tables: Top Products + Punch Cards side by side */}
      <SectionLabel className="mb-3 mt-2">
        {t('admin.revenue.productAnalytics', 'Product Analytics')}
      </SectionLabel>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        {/* Top Redeemed Products */}
        <FadeIn delay={300}>
          <AdminCard className="h-full">
            <SectionLabel>{t('admin.revenue.topProducts', 'Top Redeemed Products')}</SectionLabel>
            {isLoading ? (
              <CardSkeleton className="h-[200px] mt-3" />
            ) : topProducts.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-8 text-center">
                {t('admin.revenue.noProducts', 'No product redemptions yet')}
              </p>
            ) : (
              <div className="mt-3 space-y-0">
                {/* Desktop table */}
                <div className="hidden md:block">
                  <div className="grid grid-cols-[1fr_60px_80px] gap-2 px-3 py-2 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">
                    <span>{t('admin.revenue.product', 'Product')}</span>
                    <span className="text-right">{t('admin.revenue.count', 'Count')}</span>
                    <span className="text-right">{t('admin.revenue.revenue', 'Revenue')}</span>
                  </div>
                  {topProducts.map((p) => (
                    <div
                      key={p.id}
                      className="grid grid-cols-[1fr_60px_80px] gap-2 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors border-b border-white/[0.03] last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[14px] flex-shrink-0">{p.emoji || '\uD83D\uDED2'}</span>
                        <span className="text-[13px] text-[#E5E7EB] truncate">{p.name}</span>
                      </div>
                      <span className="text-[13px] text-[#9CA3AF] text-right tabular-nums">{p.count}</span>
                      <span className="text-[13px] text-[#D4AF37] text-right tabular-nums font-medium">
                        ${p.totalRevenue.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Mobile card list */}
                <div className="md:hidden">
                  {topProducts.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5 px-2 py-2.5 border-b border-white/[0.03] last:border-0"
                    >
                      <span className="text-[16px] flex-shrink-0">{p.emoji || '\uD83D\uDED2'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-[#E5E7EB] truncate">{p.name}</p>
                        <p className="text-[11px] text-[#6B7280] tabular-nums">
                          {p.count} {t('admin.revenue.redemptions', 'redemptions')}
                        </p>
                      </div>
                      <span className="text-[13px] text-[#D4AF37] tabular-nums font-medium flex-shrink-0">
                        ${p.totalRevenue.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Punch Card Usage */}
        <FadeIn delay={360}>
          <AdminCard className="h-full">
            <SectionLabel icon={CreditCard}>
              {t('admin.revenue.punchCards', 'Punch Card Usage')}
            </SectionLabel>
            {punchCardData.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] py-8 text-center">
                {t('admin.revenue.noPunchCards', 'No punch card products configured')}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {punchCardData.map(card => (
                  <div key={card.id} className="bg-white/[0.02] rounded-xl p-3.5 border border-white/[0.04]">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[16px]">{card.emoji || '\uD83C\uDFAB'}</span>
                        <span className="text-[13px] font-medium text-[#E5E7EB]">{card.name}</span>
                      </div>
                      <span className="text-[11px] text-[#6B7280]">
                        {card.punchCardSize} {t('admin.revenue.stampsPerCard', 'stamps/card')}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{card.totalStamps}</p>
                        <p className="text-[10px] text-[#6B7280]">{t('admin.revenue.totalStamps', 'Total Stamps')}</p>
                      </div>
                      <div>
                        <p className="text-[18px] font-bold text-[#10B981] tabular-nums">{card.completions}</p>
                        <p className="text-[10px] text-[#6B7280]">{t('admin.revenue.completed', 'Completed')}</p>
                      </div>
                      <div>
                        <p className="text-[18px] font-bold text-[#D4AF37] tabular-nums">{card.inProgress}</p>
                        <p className="text-[10px] text-[#6B7280]">{t('admin.revenue.inProgress', 'In Progress')}</p>
                      </div>
                    </div>
                    <div className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-admin-panel)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${card.completionRate}%`, background: 'var(--color-accent)' }}
                      />
                    </div>
                    <p className="text-[10px] text-[#6B7280] mt-1 text-right">
                      {card.completionRate}% {t('admin.revenue.completionRate', 'completion rate')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
        </FadeIn>
      </div>

      {/* Recent Redemptions \u2014 top 5 only; full list lives in Store admin. */}
      <FadeIn delay={420}>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>
            {t('admin.revenue.recentRedemptions', 'Recent Redemptions')}
          </SectionLabel>
        </div>
        <AdminCard>
          {isLoading ? (
            <CardSkeleton className="h-[300px]" />
          ) : recentRedemptions.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] py-8 text-center">
              {t('admin.revenue.noRecentRedemptions', 'No recent redemptions')}
            </p>
          ) : (
            <>
              <div className="space-y-0">
                {recentRedemptions.slice(0, 5).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors border-b border-white/[0.03] last:border-0"
                  >
                    <span className="text-[16px] flex-shrink-0">{r.gym_products?.emoji_icon || '\uD83D\uDED2'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#E5E7EB] truncate">
                        {r.profiles?.full_name || t('admin.revenue.unknownMember', 'Unknown')}
                      </p>
                      <p className="text-[11px] text-[#6B7280] truncate">
                        {r.quantity > 1 ? `${r.quantity}x ` : ''}{r.gym_products?.name || t('admin.revenue.unknownProduct', 'Unknown product')}
                        {r.is_free_reward && ` (${t('admin.revenue.free')})`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-medium text-[#D4AF37] tabular-nums">
                        ${parseFloat(r.total_price || 0).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-[#6B7280]">
                        {format(parseISO(r.created_at), 'MMM dd', dateFnsLocale)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {recentRedemptions.length > 5 && (
                <Link
                  to="/admin/store?tab=redemptions"
                  className="block w-full mt-3 py-2.5 rounded-xl text-[12px] font-semibold text-center text-[#D4AF37] bg-[#D4AF37]/8 hover:bg-[#D4AF37]/15 transition-colors"
                >
                  {t('admin.revenue.viewAllRedemptions', 'View all redemptions')}
                </Link>
              )}
            </>
          )}
        </AdminCard>
      </FadeIn>
    </AdminPageShell>
  );
}
