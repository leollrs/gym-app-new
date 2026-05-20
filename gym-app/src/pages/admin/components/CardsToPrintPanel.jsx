import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  Printer, Check, X, Loader2, Sparkles, PartyPopper, ArrowLeftRight, Award, Gift, Cake, Calendar,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, Avatar } from '../../../components/admin';

// Occasion → icon. Keep this small; the headline already says what it is.
// Legacy occasions (milestone_25, first_pr) stay mapped so pre-v2 cards still
// render with an icon during the cutover, but the v2 cron won't generate them.
const OCCASION_ICON = {
  welcome:       PartyPopper,
  habit_9in6:    Sparkles,
  tenure_30:     Calendar,
  tenure_90:     Calendar,
  tenure_365:    Calendar,
  milestone_100: Award,
  milestone_250: Award,
  milestone_500: Award,
  returning:     ArrowLeftRight,
  birthday:      Cake,
  custom:        Gift,
  milestone_25:  Award,
  first_pr:      Sparkles,
};

export default function CardsToPrintPanel({ gymId }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;

  // 'pending'   = needs printing
  // 'printed'   = printed + signed, waiting at front desk to hand over
  // 'delivered' = handed to member; archive of what the gym has actually
  //               given out — used downstream as retention signal (cards
  //               received per member feed analytics, churn weighting).
  const [tab, setTab] = useState('pending');

  const { data: cards = [], isLoading } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), tab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('print_cards')
        .select(`
          id, profile_id, occasion, occasion_data, headline, subline, printed_note,
          status, printed_at, delivered_at, created_at, expires_at,
          profiles:profile_id(full_name, avatar_url)
        `)
        .eq('gym_id', gymId)
        .eq('status', tab)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  const [selected, setSelected] = useState(new Set());
  const allSelected = cards.length > 0 && selected.size === cards.length;
  const someSelected = selected.size > 0;

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(cards.map(c => c.id)));
  };

  // ── Mutations ──
  const markPrintedMutation = useMutation({
    mutationFn: async (ids) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('print_cards')
        .update({ status: 'printed', printed_at: now, printed_by: profile?.id ?? null })
        .in('id', ids)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      logAdminAction('print_cards_marked', 'print_card', ids[0], { count: ids.length });
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      setSelected(new Set());
      showToast(t('admin.printCards.toastPrinted', { count: ids.length, defaultValue: 'Marked printed' }), 'success');
    },
    onError: () => showToast(t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  const markDeliveredMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('print_cards')
        .update({ status: 'delivered', delivered_at: new Date().toISOString(), delivered_by: profile?.id ?? null })
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      logAdminAction('print_cards_delivered', 'print_card', id);
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      showToast(t('admin.printCards.toastDelivered', 'Marked delivered'), 'success');
    },
    onError: () => showToast(t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  const dismissMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('print_cards')
        .update({ status: 'dismissed' })
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) }),
    onError: () => showToast(t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  // ── Print action ──
  // Opens the print-friendly view in a new window. Owner triggers the
  // browser print dialog (Cmd/Ctrl+P), prints on Avery 8371 cardstock,
  // signs by hand, then comes back and clicks "Mark printed" to move
  // these cards into the "to deliver" bucket.
  const handlePrintSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const params = new URLSearchParams({ ids: ids.join(',') });
    // No features string — passing one (even just 'noopener') makes Chrome
    // open a sized popup window instead of a normal tab. We strip the
    // opener reference via win.opener=null after the fact.
    const win = window.open(`/admin/print-cards/preview?${params.toString()}`, '_blank');
    if (win) win.opener = null;
  };

  // ── Render helpers ──
  // Pick the most relevant timestamp + label for each lifecycle stage.
  // Delivered uses delivered_at because that's the moment that matters
  // for retention metrics (the card actually changed hands).
  const renderCard = (card) => {
    const member = card.profiles || {};
    const Icon = OCCASION_ICON[card.occasion] || Gift;
    const isPending = card.status === 'pending';
    const isPrinted = card.status === 'printed';
    const isDelivered = card.status === 'delivered';

    let timestampLine;
    if (isDelivered && card.delivered_at) {
      timestampLine = t('admin.printCards.deliveredTimeAgo', {
        when: formatDistanceToNow(new Date(card.delivered_at), { addSuffix: true, ...dateLocale }),
        defaultValue: 'Delivered {{when}}',
      });
    } else if (isPrinted && card.printed_at) {
      timestampLine = t('admin.printCards.printedTimeAgo', {
        when: formatDistanceToNow(new Date(card.printed_at), { addSuffix: true, ...dateLocale }),
        defaultValue: 'Printed {{when}}',
      });
    } else {
      timestampLine = formatDistanceToNow(new Date(card.created_at), { addSuffix: true, ...dateLocale });
    }

    return (
      <li key={card.id} className="py-3 first:pt-0 last:pb-0">
        <div className="flex items-start gap-3">
          {isPending && (
            <input
              type="checkbox"
              checked={selected.has(card.id)}
              onChange={() => toggleSelect(card.id)}
              className="mt-1.5 w-4 h-4 rounded border-white/15 bg-white/[0.04] text-[#D4AF37] focus:ring-[#D4AF37]"
              aria-label={t('admin.printCards.selectCard', 'Select card')}
            />
          )}
          <Avatar name={member.full_name} size="sm" src={member.avatar_url} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                {member.full_name || t('admin.printCards.unknownMember', 'Unknown member')}
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                <Icon size={11} />
                {t(`admin.printCards.occasions.${card.occasion}`, card.occasion)}
              </span>
            </div>
            <p className="text-[12px] text-[#E5E7EB] mt-1 font-medium">"{card.headline}"</p>
            {card.subline && (
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">{card.subline}</p>
            )}
            <p className="text-[10px] text-[#6B7280] mt-1">{timestampLine}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isPrinted && (
              <button
                onClick={() => markDeliveredMutation.mutate(card.id)}
                title={t('admin.printCards.markDelivered', 'Mark delivered')}
                className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20 transition-colors"
              >
                <Check size={14} />
              </button>
            )}
            {isPending && (
              <button
                onClick={() => dismissMutation.mutate(card.id)}
                title={t('admin.printCards.dismiss', 'Dismiss')}
                className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.04] text-[#6B7280] hover:bg-white/[0.08] hover:text-[#EF4444] transition-colors"
              >
                <X size={14} />
              </button>
            )}
            {isDelivered && (
              <span
                title={t('admin.printCards.deliveredBadge', 'Delivered')}
                className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#10B981]/10 text-[#10B981]"
              >
                <Check size={14} />
              </span>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {/* Tab pills */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => setTab('pending')}
          className={`admin-pill ${tab === 'pending' ? 'admin-pill--dark' : 'admin-pill--outline'}`}
        >
          {t('admin.printCards.tabPending', 'To print')}
        </button>
        <button
          onClick={() => setTab('printed')}
          className={`admin-pill ${tab === 'printed' ? 'admin-pill--dark' : 'admin-pill--outline'}`}
        >
          {t('admin.printCards.tabPrinted', 'To deliver')}
        </button>
        <button
          onClick={() => setTab('delivered')}
          className={`admin-pill ${tab === 'delivered' ? 'admin-pill--dark' : 'admin-pill--outline'}`}
        >
          {t('admin.printCards.tabDelivered', 'Delivered')}
        </button>
      </div>

      {/* Bulk action bar (only on pending tab) */}
      {tab === 'pending' && cards.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#D4AF37]/8 border border-[#D4AF37]/20">
          <button
            onClick={toggleSelectAll}
            className="text-[11px] font-semibold text-[#D4AF37] hover:text-[#E5E7EB] transition-colors"
          >
            {allSelected ? t('admin.printCards.clearAll', 'Clear all') : t('admin.printCards.selectAll', 'Select all')}
          </button>
          <span className="text-[11px] text-[#D4AF37]">·</span>
          <span className="text-[11px] font-semibold text-[#D4AF37]">
            {t('admin.printCards.selectedCount', { count: selected.size, defaultValue: '{{count}} selected' })}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={handlePrintSelected}
              disabled={!someSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#D4AF37] text-black hover:brightness-95 transition disabled:opacity-40"
            >
              <Printer size={12} />
              {t('admin.printCards.printSelected', 'Print preview')}
            </button>
            <button
              onClick={() => markPrintedMutation.mutate([...selected])}
              disabled={!someSelected || markPrintedMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30 hover:bg-[#10B981]/20 transition disabled:opacity-40"
            >
              <Check size={12} />
              {t('admin.printCards.markPrintedBulk', 'Mark printed')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <AdminCard>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[#6B7280]" />
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-10">
            <Printer size={28} className="mx-auto text-[#4B5563] mb-2" />
            <p className="text-[13px] text-[#9CA3AF]">
              {tab === 'pending'
                ? t('admin.printCards.emptyPending', 'No cards waiting to print.')
                : tab === 'printed'
                  ? t('admin.printCards.emptyPrinted', 'No printed cards waiting for delivery.')
                  : t('admin.printCards.emptyDelivered', 'No cards have been delivered yet.')}
            </p>
            <p className="text-[11px] text-[#6B7280] mt-1">
              {tab === 'delivered'
                ? t('admin.printCards.emptyDeliveredHint', 'Cards you hand to members show up here as a retention archive.')
                : t('admin.printCards.emptyHint', 'The daily cron generates cards for milestones and returning members.')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {cards.map(renderCard)}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
