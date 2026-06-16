import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { FadeIn, AdminPageShell } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import ProductsTab from './components/ProductsTab';
import MemberPurchasesTab from './components/MemberPurchasesTab';
import PendingPurchasesTab from './components/PendingPurchasesTab';
import { storeKeys } from './components/storeConstants';
import { TK, FK, Ico, ICON, Card, PrimaryBtn } from './components/retosKit';

// stat card with a colored left rail (mock StatCard)
function StatCard({ value, label, icon, rail, tone }) {
  return (
    <Card style={{ position: 'relative', overflow: 'hidden', padding: '20px 22px' }}>
      <span style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3.5, borderRadius: 99, background: rail }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1, lineHeight: 1, color: TK.text }}>{value}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 8 }}>{label}</div>
        </div>
        <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: tone.bg, border: `1px solid ${tone.line}` }}>
          <Ico ch={icon} size={19} color={tone.ink} stroke={2} />
        </span>
      </div>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function AdminStore() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const [storeTab, setStoreTab] = useState('products');
  const [addProductOpen, setAddProductOpen] = useState(false);
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;

  useEffect(() => { document.title = `${t('admin.store.pageTitle', 'Admin - Store')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Page-level store stats: paid order count, total sales $, free-reward
  // redemption count (cheap exact counts + a bounded client-side sum).
  const { data: storeStats } = useQuery({
    queryKey: ['admin', 'store', 'summary', gymId],
    enabled: !!gymId,
    staleTime: 60_000,
    queryFn: async () => {
      // Only APPROVED purchases count toward orders/sales — purchases now go
      // through the approval queue (migration 0602); pending/rejected rows must
      // not inflate the totals. (Matches the pending-count query below, which
      // already depends on the status column.)
      const [ordersRes, redemptionsRes, salesRes] = await Promise.all([
        supabase.from('member_purchases').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('is_free_reward', false).eq('status', 'approved'),
        supabase.from('member_purchases').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('is_free_reward', true).eq('status', 'approved'),
        supabase.from('member_purchases').select('total_price').eq('gym_id', gymId).eq('is_free_reward', false).eq('status', 'approved').limit(2000),
      ]);
      const totalSales = (salesRes.data || []).reduce((sum, row) => {
        const n = parseFloat(row?.total_price);
        return Number.isFinite(n) ? sum + n : sum;
      }, 0);
      return {
        totalOrders: ordersRes.count ?? 0,
        totalRedemptions: redemptionsRes.count ?? 0,
        totalSales,
      };
    },
  });

  // Live count of purchases awaiting approval — drives the tab badge.
  // Cheap exact head-count, kept under the store namespace so it refreshes
  // alongside the queue/history after an approve/reject or a new scan.
  const { data: pendingCount = 0 } = useQuery({
    queryKey: [...storeKeys.all(gymId), 'pending-count'],
    enabled: !!gymId,
    staleTime: 30_000,
    queryFn: async () => {
      const { count } = await supabase
        .from('member_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .eq('is_free_reward', false);
      return count ?? 0;
    },
  });

  const fmtCurrency = (n) => {
    const v = Number.isFinite(n) ? n : 0;
    return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  };

  const tabOptions = useMemo(() => [
    { key: 'products', label: t('admin.store.products', 'Products') },
    { key: 'pending', label: t('admin.store.pendingApprovals', 'Pending approvals'), badge: pendingCount },
    { key: 'purchases', label: t('admin.store.members', 'Purchase history') },
  ], [t, pendingCount]);

  const openAddProduct = () => { setStoreTab('products'); setAddProductOpen(true); };

  return (
    <AdminPageShell>
      {/* header */}
      <div data-admin-tour="store" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.store.title', 'Store')}</h1>
          <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.store.subtitle', 'Product and redemption management')}</div>
        </div>
        <PrimaryBtn icon={ICON.plus} onClick={openAddProduct}>{t('admin.store.addProduct', 'Add Product')}</PrimaryBtn>
      </div>

      {/* stat row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[18px]" style={{ marginTop: 24 }}>
        <StatCard value={storeStats?.totalOrders ?? 0} label={t('admin.store.totalOrders', 'Total Orders')} icon={ICON.bag} rail={TK.accent} tone={{ bg: TK.accentSoft, line: TK.accentLine, ink: TK.accent }} />
        <StatCard value={fmtCurrency(storeStats?.totalSales ?? 0)} label={t('admin.store.totalSales', 'Total Sales')} icon={ICON.dollar} rail="var(--color-success)" tone={{ bg: 'var(--color-success-soft)', line: 'color-mix(in srgb, var(--color-success) 32%, transparent)', ink: 'var(--color-success)' }} />
        <StatCard value={storeStats?.totalRedemptions ?? 0} label={t('admin.store.totalRedemptions', 'Total Redemptions')} icon={ICON.gift} rail="var(--color-info)" tone={{ bg: 'var(--color-info-soft)', line: 'color-mix(in srgb, var(--color-info) 32%, transparent)', ink: 'var(--color-info)' }} />
      </div>

      {/* tab bar */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tabOptions.length},1fr)`, borderBottom: `1px solid ${TK.borderSolid}`, marginTop: 24 }}>
        {tabOptions.map(tb => {
          const on = storeTab === tb.key;
          return (
            <button key={tb.key} type="button" onClick={() => setStoreTab(tb.key)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '14px 0 16px', position: 'relative', cursor: 'pointer', background: 'transparent', border: 'none' }}>
              <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textMute }}>{tb.label}</span>
              {tb.badge > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: TK.accent, color: '#fff', fontFamily: FK.mono, fontSize: 11, fontWeight: 800, lineHeight: 1 }}>
                  {tb.badge}
                </span>
              )}
              {on && <span style={{ position: 'absolute', left: '42%', right: '42%', bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
            </button>
          );
        })}
      </div>

      {/* tab content */}
      <FadeIn>
        <SwipeableTabContent tabs={tabOptions} active={storeTab} onChange={setStoreTab}>
          {(tabKey) => {
            if (tabKey === 'products') return <ProductsTab gymId={gymId} t={t} addProductOpen={addProductOpen} onAddProductClose={() => setAddProductOpen(false)} />;
            if (tabKey === 'pending') return <PendingPurchasesTab gymId={gymId} t={t} dateFnsLocale={dateFnsLocale} />;
            if (tabKey === 'purchases') return <MemberPurchasesTab gymId={gymId} t={t} dateFnsLocale={dateFnsLocale} />;
            return null;
          }}
        </SwipeableTabContent>
      </FadeIn>
    </AdminPageShell>
  );
}
