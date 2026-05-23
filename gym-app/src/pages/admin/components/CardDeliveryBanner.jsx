/**
 * CardDeliveryBanner — the "your cards are on the way" callout for gym staff.
 *
 * When the platform owner prints a gym's celebration cards centrally
 * (card_fulfillment='platform') and marks them printed, each card's
 * expected_delivery_at is frozen to the upcoming delivery Saturday (migration
 * 0430). This banner reads those printed-but-undelivered, platform-fulfilled
 * cards and tells the front desk WHEN the batch arrives and when it's ready to
 * hand out — so staff aren't guessing at the counter.
 *
 * It only renders when there's an actual incoming platform batch, so it
 * disappears on its own once the cards are delivered (status flips off
 * 'printed'). Gyms that print their own cards never see it.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format, addDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { Truck } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

export default function CardDeliveryBanner({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;

  const { data: batch } = useQuery({
    queryKey: ['admin', 'card-delivery-banner', gymId],
    queryFn: async () => {
      // Start of today (local) — only show deliveries from today onward.
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('print_cards')
        .select('id, expected_delivery_at')
        .eq('gym_id', gymId)
        .eq('status', 'printed')
        .eq('delivery_fulfilled_by', 'platform')
        .not('expected_delivery_at', 'is', null)
        .gte('expected_delivery_at', todayStart.toISOString())
        .order('expected_delivery_at', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) return null;
      // Nearest delivery date drives the headline; count is the whole incoming
      // set (across any dates) so staff know roughly how many to expect.
      const nearest = new Date(rows[0].expected_delivery_at);
      return { count: rows.length, deliverAt: nearest };
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  if (!batch) return null;

  const fmt = (d) => format(d, isEs ? "EEEE d 'de' MMM" : 'EEEE, MMM d', dateLocale);
  const readyAt = addDays(batch.deliverAt, 2); // Saturday delivery → ready Monday

  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}
      >
        <Truck size={18} style={{ color: 'var(--color-accent)' }} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {t('admin.printCards.deliveryBannerTitle', {
            count: batch.count,
            date: fmt(batch.deliverAt),
            defaultValue: '{{count}} cards arriving {{date}}',
          })}
        </p>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.printCards.deliveryBannerBody', {
            ready: fmt(readyAt),
            defaultValue: 'Printed and on the way — have them ready to hand to members from {{ready}}.',
          })}
        </p>
      </div>
    </div>
  );
}
