import { useState, useMemo, useEffect } from 'react';
import {
  Coins, ArrowUpDown, ShoppingCart, TrendingUp,
  Gift, CreditCard, Clock, Package,
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
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  PageHeader, AdminPageShell, AdminCard, FadeIn, CardSkeleton,
  SectionLabel, FilterBar,
} from '../../components/admin';
import StatCard from '../../components/admin/StatCard';

// ── Constants ──────────────────────────────────────────────
const PERIOD_OPTIONS = [
  { key: '7d',  label: '7d',  days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: null },
];

const CATEGORY_COLORS = {
  supplement: '#3B82F6',
  drink:      '#06B6D4',
  snack:      '#F59E0B',
  merchandise:'#A855F7',
  service:    '#10B981',
  other:      '#6B7280',
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

// ── Main Component ─────────────────────────────────────────
export default function AdminRevenue() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;

  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  const [period, setPeriod] = useState('30d');

  useEffect(() => { document.title = t('admin.revenue.pageTitle', 'Admin - Revenue | TuGymPR'); }, [t]);

  const periodDays = PERIOD_OPTIONS.find(p => p.key === period)?.days;
  const cutoffDate = periodDays ? subDays(new Date(), periodDays).toISOString() : null;

  // ── Queries ────────────────────────────────────────────
  const { data: pointsData, isLoading: loadingPoints } = useQuery({
    queryKey: adminKeys.revenue.points(gymId, period),
    queryFn: async () => {
      let qIssued = supabase
        .from('reward_points_log')
        .select('points, created_at')
        .eq('gym_id', gymId)
        .gt('points', 0);
      let qSpent = supabase
        .from('reward_points_log')
        .select('points, created_at')
        .eq('gym_id', gymId)
        .lt('points', 0);

      if (cutoffDate) {
        qIssued = qIssued.gte('created_at', cutoffDate);
        qSpent = qSpent.gte('created_at', cutoffDate);
      }

      const [{ data: issued }, { data: spent }] = await Promise.all([qIssued, qSpent]);
      return { issued: issued || [], spent: spent || [] };
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
    if (!pointsData) return { issued: 0, redeemed: 0, net: 0, redemptions: 0 };
    const issued = pointsData.issued.reduce((s, r) => s + r.points, 0);
    const redeemed = Math.abs(pointsData.spent.reduce((s, r) => s + r.points, 0));
    return {
      issued,
      redeemed,
      net: issued - redeemed,
      redemptions: purchases?.length || 0,
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
    const days = periodDays || 30;
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
    return purchases.slice(0, 20);
  }, [purchases]);

  const isLoading = loadingPoints || loadingPurchases || loadingProducts;

  // ── Render ─────────────────────────────────────────────
  return (
    <AdminPageShell>
      {/* Header */}
      <FadeIn>
        <PageHeader
          title={t('admin.revenue.title', 'Revenue & Points')}
          subtitle={t('admin.revenue.subtitle', 'Store revenue, reward economics, and punch card analytics')}
          className="mb-6"
        />
      </FadeIn>

      {/* Period Filter */}
      <FadeIn delay={30}>
        <div className="mb-5">
          <FilterBar
            options={PERIOD_OPTIONS.map(opt => ({
              key: opt.key,
              label: t(`admin.revenue.period.${opt.key}`, opt.label),
            }))}
            active={period}
            onChange={setPeriod}
          />
        </div>
      </FadeIn>

      {/* KPI Stats Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[...Array(4)].map((_, i) => <CardSkeleton key={i} className="h-[88px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label={t('admin.revenue.pointsIssued', 'Points Issued')}
            value={kpis.issued}
            icon={Coins}
            borderColor="#D4AF37"
            delay={60}
          />
          <StatCard
            label={t('admin.revenue.pointsRedeemed', 'Points Redeemed')}
            value={kpis.redeemed}
            icon={Gift}
            borderColor="#A855F7"
            delay={90}
          />
          <StatCard
            label={t('admin.revenue.netCirculation', 'Net in Circulation')}
            value={kpis.net}
            icon={ArrowUpDown}
            borderColor="#3B82F6"
            delay={120}
          />
          <StatCard
            label={t('admin.revenue.totalRedemptions', 'Total Redemptions')}
            value={kpis.redemptions}
            icon={ShoppingCart}
            borderColor="#10B981"
            delay={150}
          />
        </div>
      )}

      {/* Charts: Category + Point Flow side by side on desktop */}
      <div className="grid xl:grid-cols-2 gap-4 mb-4">
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
              <div className="h-[220px] mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6B7280', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#6B7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name={t('admin.revenue.redemptions', 'Redemptions')} radius={[6, 6, 0, 0]}>
                      {categoryData.map((entry) => (
                        <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] || '#6B7280'} />
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
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={flowData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#6B7280', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: '#6B7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="earned"
                      name={t('admin.revenue.earned', 'Earned')}
                      stroke="#D4AF37"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#D4AF37' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="spent"
                      name={t('admin.revenue.spent', 'Spent')}
                      stroke="#A855F7"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#A855F7' }}
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
      <div className="grid xl:grid-cols-2 gap-4 mb-4">
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
                    <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#D4AF37] to-[#F59E0B] transition-all duration-500"
                        style={{ width: `${card.completionRate}%` }}
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

      {/* Recent Redemptions */}
      <FadeIn delay={420}>
        <SectionLabel className="mb-3">
          {t('admin.revenue.recentRedemptions', 'Recent Redemptions')}
        </SectionLabel>
        <AdminCard>
          {isLoading ? (
            <CardSkeleton className="h-[300px]" />
          ) : recentRedemptions.length === 0 ? (
            <p className="text-[13px] text-[#6B7280] py-8 text-center">
              {t('admin.revenue.noRecentRedemptions', 'No recent redemptions')}
            </p>
          ) : (
            <div className="space-y-0">
              {recentRedemptions.map((r) => (
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
          )}
        </AdminCard>
      </FadeIn>
    </AdminPageShell>
  );
}
