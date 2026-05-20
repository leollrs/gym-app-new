import { useState, useMemo } from 'react';
import { Gift, Package, Star, Receipt } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { AdminCard, AdminTable, FadeIn, SectionLabel } from '../../../components/admin';
import { storeKeys } from './storeConstants';

/**
 * "Redemptions" tab on AdminStore — viewer for `member_purchases` rows
 * with date-range filtering. Splits into:
 *   - Top callout card listing the most recent free-reward redemptions
 *     (members hitting their punch-card target).
 *   - Full table of every purchase in range, capped at 100 rows.
 *
 * Read-only surface — issuing redemptions happens in MemberPurchasesTab.
 */
export default function RedemptionsTab({ gymId, t, dateFnsLocale }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = useMemo(() => ({ dateFrom, dateTo }), [dateFrom, dateTo]);

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: storeKeys.purchases(gymId, { ...filters, redeemed: true }),
    queryFn: async () => {
      let query = supabase
        .from('member_purchases')
        .select('*, profiles:member_id(full_name, avatar_url), gym_products:product_id(name, price)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (dateFrom) {
        query = query.gte('created_at', new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        query = query.lt('created_at', end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const recentRedemptions = useMemo(() =>
    purchases.filter(p => p.is_free_reward),
    [purchases]
  );

  const columns = [
    {
      key: 'member',
      label: t('admin.store.member', 'Member'),
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-[#D4AF37]">
              {row.profiles?.full_name?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <span className="text-[13px] font-medium text-[#E5E7EB] truncate">
            {row.profiles?.full_name ?? t('admin.store.unknown', 'Unknown')}
          </span>
        </div>
      ),
    },
    {
      key: 'product',
      label: t('admin.store.item', 'Item'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Package size={15} className="text-[#6B7280]" />
          <span className="text-[13px] text-[#E5E7EB]">
            {row.quantity > 1 ? `${row.quantity}x ` : ''}{row.gym_products?.name ?? t('admin.store.unknown', 'Unknown')}
          </span>
        </div>
      ),
    },
    {
      key: 'date',
      label: t('admin.store.date', 'Date'),
      sortable: true,
      render: (row) => (
        <span className="text-[12px] text-[#9CA3AF]">
          {format(new Date(row.created_at), 'MMM d, h:mm a', dateFnsLocale)}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('admin.store.status', 'Status'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {row.is_free_reward ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-emerald-400 bg-emerald-500/10">
              <Gift size={10} /> {t('admin.store.freeReward', 'FREE')}
            </span>
          ) : (
            <span className="text-[12px] text-[#9CA3AF]">${parseFloat(row.total_price || 0).toFixed(2)}</span>
          )}
          {row.points_earned > 0 && (
            <span className="text-[#D4AF37] text-[11px] flex items-center gap-0.5">
              <Star size={10} /> +{row.points_earned}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Date filters */}
      <div className="flex flex-wrap items-end gap-2.5 sm:gap-3">
        <div className="flex-1 min-w-[130px] sm:min-w-[140px] sm:flex-initial">
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.store.from', 'From')}</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all"
          />
        </div>
        <div className="flex-1 min-w-[130px] sm:min-w-[140px] sm:flex-initial">
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.store.to', 'To')}</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="px-3 py-2 rounded-xl text-[12px] font-medium text-[#9CA3AF] bg-white/5 hover:bg-white/8 transition-colors"
          >
            {t('admin.store.clear', 'Clear')}
          </button>
        )}
      </div>

      {/* Redemption queue */}
      {recentRedemptions.length > 0 && (
        <FadeIn delay={0.05}>
          <AdminCard borderLeft="var(--color-success)">
            <div className="flex items-center gap-2 mb-3">
              <Gift size={14} className="text-emerald-400" />
              <SectionLabel>{t('admin.store.recentRedemptions', 'Recent Redemptions')}</SectionLabel>
              <span className="text-[11px] text-[#6B7280] ml-auto">{recentRedemptions.length}</span>
            </div>
            <div className="space-y-2">
              {recentRedemptions.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-1.5">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-emerald-400">
                      {p.profiles?.full_name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#E5E7EB] truncate">
                      <span className="font-medium">{p.profiles?.full_name}</span>
                      <span className="text-[#6B7280]"> {t('admin.store.redeemed', 'redeemed')} </span>
                      <span className="font-medium">{p.gym_products?.name}</span>
                    </p>
                  </div>
                  <span className="text-[11px] text-[#6B7280] flex-shrink-0">
                    {format(new Date(p.created_at), 'MMM d', dateFnsLocale)}
                  </span>
                </div>
              ))}
            </div>
          </AdminCard>
        </FadeIn>
      )}

      {/* Full table */}
      <FadeIn delay={0.1}>
        <AdminTable
          columns={columns}
          data={purchases}
          loading={isLoading}
          emptyIcon={Receipt}
          emptyText={t('admin.store.noRedemptions', 'No redemptions found')}
        />
      </FadeIn>
    </div>
  );
}
