import { useMemo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, parseISO } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useInsightsRange } from '../../contexts/InsightsRangeContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { AdminPageShell, FadeIn, CardSkeleton } from '../../components/admin';
import AdminPagination from '../../components/admin/AdminPagination';
import { TK, FK, TONE, Ico, Card, MultiLine, AICON } from './components/analytics/analyticsKit';

// ── Constants ──────────────────────────────────────────────
const PERIOD_OPTIONS = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: null },
];

// page-local icon paths (from the Tienda y Recompensas design)
const RIC = {
  dollar: <><path d="M12 2v20M16.5 6.5C16.5 4.6 14.5 3.5 12 3.5S7.5 4.7 7.5 6.8 9.5 9.8 12 10.2s4.5 1.4 4.5 3.5-2 3.3-4.5 3.3-4.5-1.1-4.5-3" /></>,
  gift: <><rect x="3.5" y="9" width="17" height="12" rx="1.6" /><path d="M3.5 13h17M12 9v12" /><path d="M12 9S10.7 4.5 8 5.2 12 9 12 9ZM12 9s1.3-4.5 4-3.8S12 9 12 9Z" /></>,
  receipt: <><path d="M5 3v18l2-1.4L9 21l2-1.4L13 21l2-1.4L17 21l2-1.4V3l-2 1.4L15 3l-2 1.4L11 3 9 4.4 7 3 5 4.4Z" /><path d="M8 8h8M8 12h8" /></>,
  link: <><path d="M9 15l6-6M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9.5h18M7 14h4" /></>,
  cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /><path d="M2 3h2.5l2.2 12.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L21 7H6" /></>,
  stamp: <><rect x="4" y="13" width="16" height="7" rx="1.5" /><path d="M12 13V9a3 3 0 1 0-2-5" /><path d="M4 17h16" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
};

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => (Number(n) || 0).toLocaleString();

// stat card with colored left rail (rail + chip both derive from tone)
function TRStat({ value, label, icon, tone = 'neutral' }) {
  const c = TONE[tone] || TONE.neutral;
  return (
    <Card style={{ position: 'relative', overflow: 'hidden', padding: '20px 22px' }}>
      <span style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3.5, borderRadius: 99, background: c.fg }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1, lineHeight: 1, color: TK.text }}>{value}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 9 }}>{label}</div>
        </div>
        <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', background: c.bg, border: `1px solid ${c.line}` }}>
          <Ico ch={icon} size={18} color={c.ink} stroke={2} />
        </span>
      </div>
    </Card>
  );
}

const TRLabel = ({ children }) => (
  <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: TK.textFaint, margin: '26px 0 14px' }}>{children}</div>
);
const CardLabel = ({ icon, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
    {icon && <Ico ch={icon} size={15} color={TK.textMute} stroke={2} />}
    <span style={{ fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: TK.textSub }}>{children}</span>
  </div>
);

// horizontal category bars
function CategoryBars({ data, unit }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 }}>
      {data.map((d, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
            <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 600, color: TK.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text, whiteSpace: 'nowrap' }}>{d.value} <span style={{ fontFamily: FK.body, fontSize: 12, fontWeight: 600, color: TK.textFaint }}>{unit}</span></span>
          </div>
          <div style={{ height: 14, borderRadius: 99, background: TK.surface3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(d.value / max) * 100}%`, borderRadius: 99, background: `linear-gradient(90deg, ${TK.accent}, color-mix(in srgb, ${TK.accent} 72%, #ffffff))`, boxShadow: `0 1px 5px color-mix(in srgb, ${TK.accent} 30%, transparent)` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// punch-card usage card
function StampCard({ name, perCard, total, completed, progress, rate, t }) {
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${TK.borderSolid}`, background: TK.surface2, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 18px' }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: TK.accentSoft, border: `1px solid ${TK.accentLine}` }}>
          <Ico ch={RIC.stamp} size={17} color={TK.accent} stroke={2} />
        </span>
        <span style={{ flex: 1, minWidth: 0, fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textMute, whiteSpace: 'nowrap' }}>{perCard} {t('admin.revenue.stampsPerCard', 'stamps/card')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderTop: `1px solid ${TK.divider}` }}>
        {[[t('admin.revenue.totalStamps', 'Total Stamps'), total, TK.text],
          [t('admin.revenue.completed', 'Completed'), completed, 'var(--color-coach)'],
          [t('admin.revenue.inProgress', 'In Progress'), progress, TK.accent]].map((c, i) => (
          <div key={i} style={{ padding: '14px 18px', borderLeft: i > 0 ? `1px solid ${TK.divider}` : 'none' }}>
            <div style={{ fontFamily: FK.display, fontSize: 22, fontWeight: 800, color: c[2], letterSpacing: -0.5 }}>{c[1]}</div>
            <div style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute, marginTop: 3 }}>{c[0]}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '11px 18px', borderTop: `1px solid ${TK.divider}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, height: 7, borderRadius: 99, background: TK.surface3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${rate}%`, borderRadius: 99, background: TK.accent }} />
        </div>
        <span style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.textMute, whiteSpace: 'nowrap' }}>{rate}% {t('admin.revenue.completionRate', 'completion rate')}</span>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
export default function AdminRevenue() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const gymId = profile?.gym_id;

  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

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
        .select('id, points_earned, total_price, is_free_reward, status, created_at, quantity, product_id, member_id, gym_products(name, category, emoji_icon, punch_card_target, price), profiles:member_id(full_name)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (cutoffDate) q = q.gte('created_at', cutoffDate);
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
    // Only count GRANTED purchases toward revenue. Purchases now go through an
    // admin approval queue (migration 0602): pending/rejected rows must not
    // inflate sales. `granted` treats a missing status (pre-migration rows) as
    // counted, so figures stay correct before and after the migration applies.
    const granted = (p) => p.status !== 'pending' && p.status !== 'rejected';
    const paid = (purchases || []).filter(p => !p.is_free_reward && granted(p));
    const totalSales = paid.reduce((s, p) => s + (parseFloat(p.total_price) || 0), 0);
    const paidCount = paid.length;
    const avgTransaction = paidCount > 0 ? totalSales / paidCount : 0;
    const freeRewards = (purchases || []).filter(p => p.is_free_reward && granted(p));
    const freeRewardCost = freeRewards.reduce((s, p) => s + (parseFloat(p.gym_products?.price) || 0), 0);
    return {
      issued, redeemed, net: issued - redeemed, redemptions: purchases?.length || 0,
      totalSales, paidCount, avgTransaction, freeRewardCost, freeRewardCount: freeRewards.length,
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
      .map(d => ({ ...d, label: t(`admin.revenue.categories.${d.category}`, d.category), value: d.count }));
  }, [purchases, t]);

  const flowData = useMemo(() => {
    if (!pointsData) return [];
    let days = periodDays;
    if (days == null) {
      const allRows = [...pointsData.issued, ...pointsData.spent];
      if (!allRows.length) return [];
      const earliest = allRows.reduce((min, r) => {
        const ts = new Date(r.created_at).getTime();
        return ts < min ? ts : min;
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
      const productPurchases = purchases.filter(p => p.product_id === product.id && !p.is_free_reward && p.status !== 'pending' && p.status !== 'rejected');
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

  const recentRedemptions = useMemo(() => purchases || [], [purchases]);

  const isLoading = loadingPoints || loadingPurchases || loadingProducts;

  // ── stamp-card pagination (3 per page; grows as products are added) ──
  const [stampPage, setStampPage] = useState(0);
  useEffect(() => { setStampPage(0); }, [period]);
  const stampPageCount = Math.max(1, Math.ceil(punchCardData.length / 3));
  const sp = Math.min(stampPage, stampPageCount - 1);
  const visibleStamps = punchCardData.slice(sp * 3, sp * 3 + 3);

  // ── recent redemptions → collapsible month → year timeline ──
  const lang = isEs ? 'es' : 'en';
  const curY = new Date().getFullYear();
  const curM = new Date().getMonth();
  const [openYears, setOpenYears] = useState(() => new Set([new Date().getFullYear()]));
  const [openMonths, setOpenMonths] = useState(() => new Set([`${new Date().getFullYear()}-${new Date().getMonth()}`]));
  const toggleYear = (y) => setOpenYears(s => { const n = new Set(s); n.has(y) ? n.delete(y) : n.add(y); return n; });
  const toggleMonth = (k) => setOpenMonths(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const redemptionGroups = useMemo(() => {
    const byYear = new Map();
    recentRedemptions.forEach(e => {
      const d = new Date(e.created_at);
      const y = d.getFullYear(), m = d.getMonth();
      if (!byYear.has(y)) byYear.set(y, new Map());
      const months = byYear.get(y);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(e);
    });
    return [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, months]) => ({
      year,
      count: [...months.values()].reduce((n, arr) => n + arr.length, 0),
      months: [...months.entries()].sort((a, b) => b[0] - a[0]).map(([month, items]) => ({ month, items })),
    }));
  }, [recentRedemptions]);
  const monthName = (y, m) => { const s = new Date(y, m, 1).toLocaleDateString(lang, { month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const redemptionItems = [];
  redemptionGroups.forEach(yg => {
    const isCurrentYear = yg.year === curY;
    const yearOpen = isCurrentYear || openYears.has(yg.year);
    if (!isCurrentYear) redemptionItems.push({ kind: 'year', year: yg.year, count: yg.count, open: yearOpen });
    if (yearOpen) {
      yg.months.forEach(mg => {
        const key = `${yg.year}-${mg.month}`;
        const monthOpen = openMonths.has(key);
        redemptionItems.push({ kind: 'month', key, name: monthName(yg.year, mg.month), count: mg.items.length, open: monthOpen, nested: !isCurrentYear });
        if (monthOpen) mg.items.forEach(entry => redemptionItems.push({ kind: 'row', entry, nested: !isCurrentYear }));
      });
    }
  });
  const renderRedemptionRow = (r, topBorder, nested) => (
    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: `14px 22px 14px ${nested ? 40 : 22}px`, borderTop: topBorder ? `1px solid ${TK.divider}` : 'none' }}>
      <span style={{ width: 34, height: 34, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.accentSoft, color: TK.accent, fontFamily: FK.display, fontSize: 14, fontWeight: 800 }}>{(r.profiles?.full_name || '?')[0].toUpperCase()}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.profiles?.full_name || t('admin.revenue.unknownMember', 'Unknown')}</div>
        <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.quantity > 1 ? `${r.quantity}× ` : ''}{r.gym_products?.name || t('admin.revenue.unknownProduct', 'Unknown product')}{r.is_free_reward && ` · ${t('admin.revenue.free', 'free')}`}</div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ fontFamily: FK.display, fontSize: 15.5, fontWeight: 800, color: TK.accent }}>{money(r.total_price)}</div>
        <div style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, marginTop: 2 }}>{format(parseISO(r.created_at), 'MMM dd', dateFnsLocale)}</div>
      </div>
    </div>
  );

  // chart series
  const flowSeries = [
    { data: flowData.map(d => d.earned), color: TK.accent, label: t('admin.revenue.earned', 'Earned') },
    { data: flowData.map(d => d.spent), color: 'var(--color-coach)', label: t('admin.revenue.spent', 'Spent') },
  ];
  const flowLabelCount = Math.min(6, flowData.length);
  const flowXLabels = flowData.length
    ? Array.from({ length: flowLabelCount }, (_, i) => {
        const idx = flowLabelCount === 1 ? 0 : Math.round((i / (flowLabelCount - 1)) * (flowData.length - 1));
        return flowData[idx]?.date;
      })
    : [];

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ minWidth: 0 }}>
        <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.revenue.title', 'Store & Rewards')}</h1>
        <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.revenue.subtitle', 'Sales, redemptions, and points circulation')}</div>
      </div>

      {/* range pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
        {PERIOD_OPTIONS.map(opt => {
          const on = period === opt.key;
          return (
            <button key={opt.key} type="button" onClick={() => setPeriod(opt.key)}
              style={{ padding: '9px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : TK.surface, border: `1px solid ${on ? TK.accent : TK.borderSolid}`, whiteSpace: 'nowrap' }}>
              {t(`admin.revenue.period.${opt.key}`, opt.label)}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-[14px] md:gap-[18px]">{[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[110px]" />)}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-[14px] md:gap-[18px]">{[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[110px]" />)}</div>
          <CardSkeleton h="h-[280px]" />
        </div>
      ) : (
        <>
          {/* Ventas */}
          <TRLabel>{t('admin.revenue.salesSection', 'Sales')}</TRLabel>
          <FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] md:gap-[18px]">
              <TRStat value={money(kpis.totalSales)} label={t('admin.revenue.totalSales', 'Total Sales')} icon={RIC.dollar} tone="good" />
              <TRStat value={kpis.freeRewardCount === 0 ? '—' : money(kpis.freeRewardCost)} label={t('admin.revenue.freeRewardCost', 'Free Reward Cost')} icon={RIC.gift} tone="coach" />
              <TRStat value={kpis.paidCount === 0 ? '—' : money(kpis.avgTransaction)} label={t('admin.revenue.avgTransaction', 'Avg Transaction')} icon={RIC.receipt} tone="info" />
            </div>
          </FadeIn>

          {/* Economía de puntos */}
          <TRLabel>{t('admin.revenue.pointsEconomySection', 'Points Economy')}</TRLabel>
          <FadeIn delay={40}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] md:gap-[18px]">
              <TRStat value={num(kpis.issued)} label={t('admin.revenue.pointsIssued', 'Points Issued')} icon={RIC.link} tone="accent" />
              <TRStat value={num(kpis.redeemed)} label={t('admin.revenue.pointsRedeemed', 'Points Redeemed')} icon={RIC.gift} tone="coach" />
              <TRStat value={num(kpis.net)} label={t('admin.revenue.outstandingLiability', 'Outstanding Points Liability')} icon={RIC.card} tone="info" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] md:gap-[18px]" style={{ marginTop: 18 }}>
              <TRStat value={num(kpis.redemptions)} label={t('admin.revenue.totalRedemptions', 'Total Redemptions')} icon={RIC.cart} tone="accent" />
            </div>
          </FadeIn>

          {/* Category + Point Flow */}
          <FadeIn delay={80}>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-[18px]" style={{ marginTop: 24, alignItems: 'start' }}>
              <Card style={{ padding: '22px 24px' }}>
                <CardLabel icon={RIC.gift}>{t('admin.revenue.revenueByCategory', 'Redemptions by Category')}</CardLabel>
                {categoryData.length === 0 ? (
                  <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '32px 0' }}>{t('admin.revenue.noRedemptions', 'No redemptions in this period')}</p>
                ) : (
                  <CategoryBars data={categoryData} unit={t('admin.revenue.redemptions', 'redemptions').toLowerCase()} />
                )}
              </Card>

              <Card style={{ padding: '22px 24px' }}>
                <CardLabel icon={RIC.link}>{t('admin.revenue.pointFlow', 'Point Flow')}</CardLabel>
                <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginBottom: 6 }}>{t('admin.revenue.pointFlowDesc', 'Points earned vs spent per day')}</div>
                {flowData.length === 0 ? (
                  <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '32px 0' }}>{t('admin.revenue.noData', 'No data available')}</p>
                ) : (
                  <>
                    <MultiLine series={flowSeries} xLabels={flowXLabels} pointLabels={flowData.map(d => d.date)} height={250} />
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 6 }}>
                      {flowSeries.map((s, i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: FK.body, fontSize: 13, fontWeight: 600, color: TK.textSub }}>
                          <span style={{ width: 9, height: 9, borderRadius: 99, background: s.color }} />{s.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            </div>
          </FadeIn>

          {/* Product analytics */}
          <TRLabel>{t('admin.revenue.productAnalytics', 'Product Analytics')}</TRLabel>
          <FadeIn delay={120}>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-[18px]" style={{ alignItems: 'start' }}>
              {/* top products */}
              <Card style={{ overflow: 'hidden' }}>
                <div style={{ padding: '18px 22px 14px' }}><CardLabel icon={RIC.cart}>{t('admin.revenue.topProducts', 'Top Redeemed Products')}</CardLabel></div>
                {topProducts.length === 0 ? (
                  <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '28px 0' }}>{t('admin.revenue.noProducts', 'No product redemptions yet')}</p>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px', gap: 12, padding: '10px 22px', background: TK.surface2 }}>
                      {[t('admin.revenue.product', 'Product'), t('admin.revenue.count', 'Count'), t('admin.revenue.revenue', 'Revenue')].map((h, i) => (
                        <span key={i} style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textFaint, textAlign: i === 0 ? 'left' : 'right' }}>{h}</span>
                      ))}
                    </div>
                    {topProducts.map(p => (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px', gap: 12, padding: '14px 22px', borderTop: `1px solid ${TK.divider}`, alignItems: 'center' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                          <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.accentSoft, border: `1px solid ${TK.accentLine}` }}>
                            <Ico ch={RIC.box} size={16} color={TK.accent} stroke={1.9} />
                          </span>
                          <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        </span>
                        <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text, textAlign: 'right' }}>{p.count}</span>
                        <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.accent, textAlign: 'right' }}>{money(p.totalRevenue)}</span>
                      </div>
                    ))}
                  </>
                )}
              </Card>

              {/* punch cards */}
              <Card style={{ padding: '18px 22px 22px' }}>
                <CardLabel icon={RIC.card}>{t('admin.revenue.punchCards', 'Punch Card Usage')}</CardLabel>
                {punchCardData.length === 0 ? (
                  <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '28px 0' }}>{t('admin.revenue.noPunchCards', 'No punch card products configured')}</p>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                      {visibleStamps.map(card => (
                        <StampCard key={card.id} name={card.name} perCard={card.punchCardSize} total={card.totalStamps} completed={card.completions} progress={card.inProgress} rate={card.completionRate} t={t} />
                      ))}
                    </div>
                    <AdminPagination page={sp + 1} pageSize={3} total={punchCardData.length} onPageChange={(n) => setStampPage(n - 1)} />
                  </>
                )}
              </Card>
            </div>
          </FadeIn>

          {/* Recent redemptions */}
          <TRLabel>{t('admin.revenue.recentRedemptions', 'Recent Redemptions')}</TRLabel>
          <FadeIn delay={160}>
            <Card style={{ overflow: 'hidden' }}>
              {recentRedemptions.length === 0 ? (
                <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '32px 0' }}>{t('admin.revenue.noRecentRedemptions', 'No recent redemptions')}</p>
              ) : (
                redemptionItems.map((it, i) => {
                  if (it.kind === 'year') {
                    return (
                      <button key={`y-${it.year}`} type="button" onClick={() => toggleYear(it.year)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 22px', background: TK.surface2, border: 'none', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none', cursor: 'pointer' }}>
                        <Ico ch={it.open ? AICON.chevU : AICON.chevD} size={16} color={TK.textMute} stroke={2.2} />
                        <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text, letterSpacing: -0.2 }}>{it.year}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textFaint }}>{it.count}</span>
                      </button>
                    );
                  }
                  if (it.kind === 'month') {
                    return (
                      <button key={`m-${it.key}`} type="button" onClick={() => toggleMonth(it.key)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: `11px 22px 11px ${it.nested ? 40 : 22}px`, background: 'transparent', border: 'none', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none', cursor: 'pointer' }}>
                        <Ico ch={it.open ? AICON.chevU : AICON.chevD} size={15} color={TK.textMute} stroke={2.2} />
                        <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 800, letterSpacing: 0.3, color: it.open ? TK.text : TK.textSub }}>{it.name}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textFaint }}>{it.count}</span>
                      </button>
                    );
                  }
                  return renderRedemptionRow(it.entry, i > 0, it.nested);
                })
              )}
            </Card>
          </FadeIn>
        </>
      )}
    </AdminPageShell>
  );
}
