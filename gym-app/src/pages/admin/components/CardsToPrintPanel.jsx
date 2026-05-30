import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow, format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  Printer, Check, X, Loader2, Sparkles, PartyPopper, ArrowLeftRight, Award, Gift, Cake, Calendar, FileText, Truck, UserCheck,
} from 'lucide-react';
import { getCardPaperType } from '../../../components/printCards/cardPaperType.js';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, Avatar } from '../../../components/admin';
import PrintPreviewModal from '../../../components/admin/PrintPreviewModal';
import RewardAttachModal from './RewardAttachModal';

// Postcard format options — folded cards (tenure_365, milestone_500) skip
// this selector entirely since they always need Letter landscape.
const FORMAT_OPTIONS = [
  { key: 'postcard',    short: '4×6',   label: 'Postcard 4×6' },
  { key: 'letter-2up',  short: '2-up',  label: '2 per Letter' },
  { key: 'letter-1up',  short: 'Flyer', label: 'Flyer (Letter)' },
];
const FORMAT_SHORT = Object.fromEntries(FORMAT_OPTIONS.map((o) => [o.key, o.short]));

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

  const { data: cards = [], isLoading, error } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), tab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('print_cards')
        .select(`
          id, profile_id, occasion, occasion_data, headline, subline, printed_note,
          status, printed_at, delivered_at, created_at, expires_at, print_format,
          expected_delivery_at, delivery_fulfilled_by,
          reward_qr_code, reward_label,
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

  // Members physically present today (checked in since midnight). Drives the
  // "Here today" flag so staff can prioritize printing + handing over cards to
  // people who are in the building right now — the whole point of same-visit
  // delivery. Refetched on a short interval so it tracks the day's foot traffic.
  // NOTE: return a plain array, not a Set. React Query persists this cache to
  // localStorage (see persistQueryClient), and a Set serializes to `{}` on
  // rehydrate — losing `.has`/`.size` and crashing the sort below. We keep the
  // serializable array here and build the Set in a useMemo.
  const { data: presentTodayList } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), 'present-today'],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('check_ins')
        .select('profile_id')
        .eq('gym_id', gymId)
        .gte('checked_in_at', start.toISOString())
        .limit(2000);
      if (error) throw error;
      return (data || []).map((c) => c.profile_id);
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });
  // Guard the input: an older build cached this query as a Set, which a
  // persisted-cache rehydrate turns into a non-iterable `{}`. `new Set({})`
  // would throw, so only build from a real array.
  const presentTodayIds = useMemo(
    () => new Set(Array.isArray(presentTodayList) ? presentTodayList : []),
    [presentTodayList]
  );

  const [selected, setSelected] = useState(new Set());
  // ids currently open in the print preview modal — null when modal closed
  const [previewIds, setPreviewIds] = useState(null);
  // card row currently being edited in the reward-attach modal
  const [rewardCard, setRewardCard] = useState(null);
  // Float cards for members who are in the gym right now to the top, so the
  // "give it to them today" cards are the first thing staff sees.
  const orderedCards = useMemo(() => {
    if (!presentTodayIds || presentTodayIds.size === 0) return cards;
    return [...cards].sort(
      (a, b) => (presentTodayIds.has(b.profile_id) ? 1 : 0) - (presentTodayIds.has(a.profile_id) ? 1 : 0)
    );
  }, [cards, presentTodayIds]);

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

  // Set print format for one or many cards. Used by per-row pill cycling
  // and the bulk-set dropdown in the action bar. The print preview groups
  // by format so all same-format cards print together — owner only swaps
  // paper between groups, not mid-job.
  const setFormatMutation = useMutation({
    mutationFn: async ({ ids, format }) => {
      const { error } = await supabase
        .from('print_cards')
        .update({ print_format: format })
        .in('id', ids)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_data, { ids }) => {
      logAdminAction('print_cards_format_set', 'print_card', ids[0], { count: ids.length });
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
    },
    onError: () => showToast(t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  // Selected cards that are postcards (folded cards always use Letter
  // landscape — no format choice). Used to gate the bulk-set dropdown.
  const selectedPostcardIds = [...selected].filter((id) => {
    const c = cards.find((x) => x.id === id);
    return c && getCardPaperType(c.occasion) !== 'folded';
  });

  // ── Print action ──
  // Opens the PrintPreviewModal — an in-page modal that renders the card
  // sheets inline (works on web + native) with PDF download, and on web a
  // "Print direct" that prints the standalone preview window.
  // Owner prints + signs, then comes back and clicks "Mark printed".
  const handlePrintSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setPreviewIds(ids);
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
    const isPostcardOccasion = getCardPaperType(card.occasion) !== 'folded';
    const cardFormat = card.print_format || 'postcard';

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
              {/* Member is in the building today — give it to them now. */}
              {presentTodayIds?.has(card.profile_id) && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#10B981]/12 text-[#10B981] border border-[#10B981]/25">
                  <UserCheck size={11} />
                  {t('admin.printCards.hereToday', 'Here today')}
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#E5E7EB] mt-1 font-medium">"{card.headline}"</p>
            {card.subline && (
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">{card.subline}</p>
            )}
            <p className="text-[10px] text-[#6B7280] mt-1">{timestampLine}</p>
            {/* Expected delivery — set when the card is printed (next Saturday,
                migration 0430). Platform-fulfilled gyms get a delivery promise;
                self-fulfilling gyms see it as a "hand out by" target. */}
            {(isPrinted || isDelivered) && card.expected_delivery_at && (
              <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                <Truck size={10} />
                {card.delivery_fulfilled_by === 'platform'
                  ? t('admin.printCards.expectedDeliveryPlatform', {
                      date: format(new Date(card.expected_delivery_at), isEs ? "d 'de' MMM" : 'MMM d', dateLocale),
                      defaultValue: 'Arriving ~{{date}}',
                    })
                  : t('admin.printCards.expectedDeliverySelf', {
                      date: format(new Date(card.expected_delivery_at), isEs ? "d 'de' MMM" : 'MMM d', dateLocale),
                      defaultValue: 'Hand out by {{date}}',
                    })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Per-card format selector — pending postcards only. Native
                <select> for zero custom-popover code; gym-owner-friendly. */}
            {isPending && isPostcardOccasion && (
              <select
                value={cardFormat}
                onChange={(e) => setFormatMutation.mutate({ ids: [card.id], format: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] font-bold uppercase tracking-wide rounded-md px-1.5 py-1 border cursor-pointer"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
                  color: 'var(--color-accent)',
                }}
                title={t('admin.printCards.formatTooltip', { defaultValue: 'Print format' })}
              >
                {FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.short}</option>
                ))}
              </select>
            )}
            {/* Reward attach/detach — pending cards only. Returning + folded
                cards skip this since returning never gets a reward by design
                and folded ceremonies already carry their own meaning. */}
            {isPending && card.occasion !== 'returning' && (
              <button
                onClick={() => setRewardCard(card)}
                title={card.reward_qr_code
                  ? t('admin.printCards.rewardManage', { defaultValue: 'Manage reward' })
                  : t('admin.printCards.attachReward', { defaultValue: 'Attach reward' })}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                style={{
                  background: card.reward_qr_code
                    ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                    : 'var(--color-bg-hover)',
                  color: card.reward_qr_code ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                <Gift size={14} />
              </button>
            )}
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#D4AF37]/8 border border-[#D4AF37]/20 flex-wrap">
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
          <div className="ml-auto flex gap-2 flex-wrap">
            {/* Bulk set-format — applies to selected postcards only.
                Folded selections are ignored (different paper entirely). */}
            {selectedPostcardIds.length > 0 && (
              <select
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setFormatMutation.mutate({ ids: selectedPostcardIds, format: v });
                  e.target.value = '';
                }}
                defaultValue=""
                className="text-[11px] font-bold rounded-lg px-2 py-1.5 border cursor-pointer"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)',
                  color: 'var(--color-accent)',
                }}
                title={t('admin.printCards.bulkFormatTooltip', { defaultValue: 'Set format for selected postcards' })}
              >
                <option value="" disabled>
                  <FileText size={10} /> {t('admin.printCards.bulkFormatLabel', { defaultValue: 'Set size…' })}
                </option>
                {FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            )}
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

      {/* Print preview modal — opens with selected card IDs, calls
          iframe.print() to honor the @page Letter/margin presets. */}
      {previewIds && (
        <PrintPreviewModal ids={previewIds} onClose={() => setPreviewIds(null)} />
      )}

      {/* Reward attach/detach modal — opens with a single card. */}
      {rewardCard && (
        <RewardAttachModal
          card={rewardCard}
          gymId={gymId}
          onClose={() => setRewardCard(null)}
        />
      )}

      {/* List */}
      <AdminCard>
        {error ? (
          <div className="text-center py-10">
            <Printer size={28} className="mx-auto text-[#4B5563] mb-2" />
            <p className="text-[13px]" style={{ color: 'var(--color-danger)' }}>
              {t('admin.printCards.loadError', 'Could not load cards. Try again in a moment.')}
            </p>
          </div>
        ) : isLoading ? (
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
            {orderedCards.map(renderCard)}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
