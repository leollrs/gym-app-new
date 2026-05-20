import { useEffect, useState, useMemo } from 'react';
import { Plus, ShoppingBag, DollarSign, Gift } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  PageHeader, FadeIn, AdminPageShell, AdminTabs, StatCard,
} from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import ProductsTab from './components/ProductsTab';
import RedemptionsTab from './components/RedemptionsTab';
import MemberPurchasesTab from './components/MemberPurchasesTab';


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
  // redemption count. Uses `count: 'exact', head: true` for cheap counts
  // and a bounded `select('total_price')` for client-side sum (gyms with
  // > 2000 paid orders will undercount; acceptable until a SQL aggregate
  // RPC is added). Falls back to zero on error so the row never blanks.
  const { data: storeStats } = useQuery({
    queryKey: ['admin', 'store', 'summary', gymId],
    enabled: !!gymId,
    staleTime: 60_000,
    queryFn: async () => {
      const [ordersRes, redemptionsRes, salesRes] = await Promise.all([
        supabase
          .from('member_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('is_free_reward', false),
        supabase
          .from('member_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('is_free_reward', true),
        supabase
          .from('member_purchases')
          .select('total_price')
          .eq('gym_id', gymId)
          .eq('is_free_reward', false)
          .limit(2000),
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

  const fmtCurrency = (n) => {
    const v = Number.isFinite(n) ? n : 0;
    return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  };

  const tabOptions = useMemo(() => [
    { key: 'products', label: t('admin.store.products', 'Products') },
    // Renamed from "Orders / Redemptions" — the slash was a smell. The tab body
    // already shows both paid and free-reward `member_purchases` rows.
    { key: 'redemptions', label: t('admin.store.transactions', 'Transactions') },
    { key: 'purchases', label: t('admin.store.members', 'Purchase history') },
  ], [t]);

  return (
    <AdminPageShell>
      <FadeIn>
        <PageHeader
          title={t('admin.store.title', 'Store')}
          subtitle={t('admin.store.subtitle', 'Product and redemption management')}
          actions={
            storeTab === 'products' ? (
              <button
                onClick={() => setAddProductOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C5A028] transition-colors"
              >
                <Plus size={15} /> {t('admin.store.addProduct', 'Add Product')}
              </button>
            ) : null
          }
        />
      </FadeIn>

      {/* Stat row — Total Orders / Total Sales / Total Redemptions.
          Wired to `storeStats` (member_purchases aggregate above). Cheap
          server-side counts + bounded client-side sum. */}
      <FadeIn delay={0.04}>
        <div className="grid grid-cols-3 gap-2.5 md:gap-3 mt-5">
          <StatCard
            label={t('admin.store.totalOrders', 'Total Orders')}
            value={storeStats?.totalOrders ?? 0}
            icon={ShoppingBag}
            borderColor="var(--color-accent)"
            delay={0}
          />
          <StatCard
            label={t('admin.store.totalSales', 'Total Sales')}
            value={fmtCurrency(storeStats?.totalSales ?? 0)}
            icon={DollarSign}
            borderColor="var(--color-success)"
            delay={0.04}
          />
          <StatCard
            label={t('admin.store.totalRedemptions', 'Total Redemptions')}
            value={storeStats?.totalRedemptions ?? 0}
            icon={Gift}
            borderColor="var(--color-info)"
            delay={0.08}
          />
        </div>
      </FadeIn>

      {/* Sub-nav tabs */}
      <FadeIn delay={0.05}>
        <AdminTabs tabs={tabOptions} active={storeTab} onChange={setStoreTab} className="mt-5 mb-6" />
      </FadeIn>

      {/* Tab Content */}
      <SwipeableTabContent tabs={tabOptions} active={storeTab} onChange={setStoreTab}>
        {(tabKey) => {
          if (tabKey === 'products') return <ProductsTab gymId={gymId} t={t} addProductOpen={addProductOpen} onAddProductClose={() => setAddProductOpen(false)} />;
          if (tabKey === 'redemptions') return <RedemptionsTab gymId={gymId} t={t} dateFnsLocale={dateFnsLocale} />;
          if (tabKey === 'purchases') return <MemberPurchasesTab gymId={gymId} t={t} dateFnsLocale={dateFnsLocale} />;
          return null;
        }}
      </SwipeableTabContent>
    </AdminPageShell>
  );
}
