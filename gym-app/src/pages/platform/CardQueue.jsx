/**
 * CardQueue — platform (super-admin) print & delivery queue for celebration
 * cards (print_cards, see 0399/0415/0430).
 *
 * The owner prints physical cards on a weekly cadence and drops them at each
 * gym every Saturday, so staff can start handing them out Monday. This page
 * is that weekly workflow, across all gyms:
 *
 *   • One panel per gym, showing the cards waiting to print.
 *   • "Preview & print" opens the shared PrintCardsView (via PlatformRoute)
 *     scoped to that gym's branding, then "Mark printed" stamps the batch —
 *     which freezes each card's expected_delivery_at to the upcoming Saturday
 *     (server-side trigger) and flips it into the "delivering" column.
 *   • Defaults to the platform-fulfilled gyms (card_fulfillment='platform') —
 *     i.e. the gyms YOU deliver to — with a toggle to see every gym.
 *
 * Reads print_cards directly (super_admin RLS from 0430 allows cross-gym),
 * matching the client-side data pattern the rest of the platform pages use.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Printer, Check, Truck, Calendar, Building2, Loader2,
  ChevronDown, ChevronRight, PartyPopper, Sparkles, Award, Cake, Gift, ArrowLeftRight,
  AlertTriangle, RotateCcw, RefreshCw,
} from 'lucide-react';
import { format, nextSaturday, addDays, isSaturday } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import FadeIn from '../../components/platform/FadeIn';
import StatCard from '../../components/platform/StatCard';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import PrintPreviewModal from '../../components/admin/PrintPreviewModal';

const OCCASION_ICON = {
  welcome: PartyPopper, habit_9in6: Sparkles, tenure_30: Calendar, tenure_90: Calendar,
  tenure_365: Calendar, milestone_100: Award, milestone_250: Award, milestone_500: Award,
  returning: ArrowLeftRight, birthday: Cake, custom: Gift, milestone_25: Award, first_pr: Sparkles,
};

// Delivery Saturday for a card not yet printed: the upcoming Saturday from
// today (deliver same day if today already is Saturday). The authoritative
// date is frozen server-side on print; this is the prospective preview.
const prospectiveDelivery = () => {
  const now = new Date();
  return isSaturday(now) ? now : nextSaturday(now);
};

export default function CardQueue() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;

  const [showAllGyms, setShowAllGyms] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  // { gymId, ids } currently open in the print preview, or null
  const [preview, setPreview] = useState(null);
  // Pending confirmation: { kind: 'print', gym, ids } | { kind: 'fulfillment', gym, value }
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    document.title = `${t('platform.cardQueue.title', 'Card Queue')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  // ── Gyms (id → name, fulfillment) ──
  const { data: gyms = [], isError: gymsError, refetch: refetchGyms } = useQuery({
    queryKey: ['platform', 'card-queue', 'gyms'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gyms')
        .select('id, name, card_fulfillment')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // ── Open cards across all gyms (pending = to print, printed = to deliver) ──
  const { data: cards = [], isLoading, isError: cardsError, refetch: refetchCards } = useQuery({
    queryKey: ['platform', 'card-queue', 'cards'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('print_cards')
        .select(`
          id, gym_id, profile_id, occasion, headline, subline, status,
          created_at, printed_at, expected_delivery_at, delivery_fulfilled_by, print_format,
          profiles:profile_id(full_name, avatar_url)
        `)
        .in('status', ['pending', 'printed'])
        .order('created_at', { ascending: true })
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  // ── Mark a gym's pending cards printed ──
  // The 0430 trigger freezes each card's delivery Saturday on this update;
  // afterwards we ping the gym's admins (notify_gym_card_delivery) so the
  // front desk knows the batch is coming — only fires for platform-fulfilled
  // gyms (the RPC no-ops when none of the printed cards are platform-owned).
  const markPrintedMutation = useMutation({
    mutationFn: async ({ ids, gymId }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('print_cards')
        .update({ status: 'printed', printed_at: now, printed_by: profile?.id ?? null })
        .in('id', ids);
      if (error) throw error;
      // Best-effort: notify the gym their cards are inbound. Don't fail the
      // print action if the notification insert hiccups.
      try { await supabase.rpc('notify_gym_card_delivery', { p_gym_id: gymId }); } catch { /* non-fatal */ }
    },
    onSuccess: (_d, { ids }) => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'card-queue', 'cards'] });
      showToast(t('platform.cardQueue.toastPrinted', { count: ids.length, defaultValue: '{{count}} cards marked printed' }), 'success');
    },
    onError: () => showToast(t('platform.cardQueue.toastFailed', 'Action failed'), 'error'),
  });

  // ── Toggle who fulfills a gym's cards (the hybrid switch) ──
  const setFulfillmentMutation = useMutation({
    mutationFn: async ({ gymId, value }) => {
      const { error } = await supabase.from('gyms').update({ card_fulfillment: value }).eq('id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'card-queue', 'gyms'] });
      showToast(t('platform.cardQueue.fulfillmentSaved', 'Delivery mode updated'), 'success');
    },
    onError: () => showToast(t('platform.cardQueue.toastFailed', 'Action failed'), 'error'),
  });

  // ── Undo: send a printed card back to pending ──
  // Clears the print stamp AND the frozen delivery snapshot: the 0430 trigger
  // only fills NULLs on the next pending→printed flip, so leaving
  // expected_delivery_at / delivery_fulfilled_by set would freeze a stale
  // Saturday on re-print. super_admin UPDATE policy (0430) covers all gyms.
  const returnToPendingMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('print_cards')
        .update({
          status: 'pending',
          printed_at: null,
          printed_by: null,
          expected_delivery_at: null,
          delivery_fulfilled_by: null,
        })
        .eq('id', id)
        .eq('status', 'printed');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'card-queue', 'cards'] });
      showToast(t('platform.cardQueue.toastReturned', 'Card returned to pending'), 'success');
    },
    onError: () => showToast(t('platform.cardQueue.toastFailed', 'Action failed'), 'error'),
  });

  // ── Mark a printed card delivered ──
  const markDeliveredMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('print_cards')
        .update({ status: 'delivered', delivered_at: new Date().toISOString(), delivered_by: profile?.id ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'card-queue', 'cards'] });
      showToast(t('platform.cardQueue.toastDelivered', 'Marked delivered'), 'success');
    },
    onError: () => showToast(t('platform.cardQueue.toastFailed', 'Action failed'), 'error'),
  });

  // ── Group cards by gym ──
  const gymMap = useMemo(() => Object.fromEntries(gyms.map((g) => [g.id, g])), [gyms]);

  const perGym = useMemo(() => {
    const groups = new Map();
    for (const c of cards) {
      // The gyms lookup is a separate request that can fail independently:
      // never silently drop loaded cards — group them under a placeholder
      // gym instead so the queue stays honest.
      const g = gymMap[c.gym_id] || { id: c.gym_id, name: null, card_fulfillment: null, missing: true };
      if (!groups.has(c.gym_id)) {
        groups.set(c.gym_id, { gym: g, pending: [], printed: [] });
      }
      groups.get(c.gym_id)[c.status === 'pending' ? 'pending' : 'printed'].push(c);
    }
    let list = [...groups.values()];
    // Unknown-fulfillment (placeholder) gyms stay visible in both scopes.
    if (!showAllGyms) list = list.filter((row) => row.gym.card_fulfillment === 'platform' || row.gym.missing);
    // Most work first: gyms with the most pending cards on top.
    list.sort((a, b) => b.pending.length - a.pending.length || (a.gym.name || '').localeCompare(b.gym.name || ''));
    return list;
  }, [cards, gymMap, showAllGyms]);

  // ── Headline numbers ──
  const stats = useMemo(() => {
    const toPrint = perGym.reduce((n, r) => n + r.pending.length, 0);
    const toDeliver = perGym.reduce((n, r) => n + r.printed.length, 0);
    const gymsToVisit = perGym.filter((r) => r.pending.length + r.printed.length > 0).length;
    return { toPrint, toDeliver, gymsToVisit };
  }, [perGym]);

  const upcomingSat = prospectiveDelivery();
  const readyMon = addDays(upcomingSat, 2);

  const toggle = (gymId) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(gymId) ? next.delete(gymId) : next.add(gymId);
    return next;
  });

  const fmtDate = (d) => format(d, isEs ? "d 'de' MMM" : 'MMM d', dateLocale);

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('platform.cardQueue.title', 'Card Queue')}</h1>
        <p className="text-[12px] text-[#6B7280] mt-0.5">
          {t('platform.cardQueue.subtitle', 'Print weekly, deliver Saturdays')}
        </p>
      </div>

      {/* Failure banners — never render a green/empty state on a failed query */}
      {cardsError && (
        <div className="mb-5 flex items-center gap-3 bg-[#EF4444]/[0.06] border border-[#EF4444]/25 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-[#EF4444] flex-shrink-0" />
          <p className="text-[12px] text-[#D1D5DB] leading-snug flex-1">
            {t('platform.cardQueue.loadFailed', "Couldn't load the card queue.")}
          </p>
          <button
            onClick={() => { refetchCards(); refetchGyms(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444]/20 transition flex-shrink-0"
          >
            <RefreshCw size={12} />
            {t('platform.cardQueue.retry', 'Retry')}
          </button>
        </div>
      )}
      {!cardsError && gymsError && (
        <div className="mb-5 flex items-center gap-3 bg-[#F59E0B]/[0.06] border border-[#F59E0B]/25 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-[#F59E0B] flex-shrink-0" />
          <p className="text-[12px] text-[#D1D5DB] leading-snug flex-1">
            {t('platform.cardQueue.gymsLoadFailed', "Gym names didn't load — showing cards anyway.")}
          </p>
          <button
            onClick={() => refetchGyms()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/20 transition flex-shrink-0"
          >
            <RefreshCw size={12} />
            {t('platform.cardQueue.retry', 'Retry')}
          </button>
        </div>
      )}

      {/* Weekly cadence banner */}
      <div className="mb-5 flex items-center gap-3 bg-[#D4AF37]/[0.06] border border-[#D4AF37]/20 rounded-xl px-4 py-3">
        <Truck size={18} className="text-[#D4AF37] flex-shrink-0" />
        <p className="text-[12px] text-[#D1D5DB] leading-snug">
          {t('platform.cardQueue.cadence', {
            sat: fmtDate(upcomingSat),
            mon: fmtDate(readyMon),
            defaultValue: 'Print this week → deliver Sat {{sat}} → gyms hand out from Mon {{mon}}.',
          })}
        </p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <StatCard label={t('platform.cardQueue.statToPrint', 'Cards to print')} value={stats.toPrint} icon={Printer} borderColor="#D4AF37" />
        <StatCard label={t('platform.cardQueue.statToDeliver', 'Awaiting delivery')} value={stats.toDeliver} icon={Truck} borderColor="#10B981" />
        <StatCard label={t('platform.cardQueue.statGyms', 'Gyms to visit')} value={stats.gymsToVisit} icon={Building2} borderColor="#6366F1" />
      </div>

      {/* Scope toggle */}
      <div className="flex gap-1.5 mb-4">
        <button
          onClick={() => setShowAllGyms(false)}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
            !showAllGyms ? 'bg-white/[0.06] text-[#E5E7EB] border-white/10' : 'text-[#6B7280] border-white/6 hover:text-[#9CA3AF]'
          }`}
        >
          {t('platform.cardQueue.scopeMine', 'My delivery queue')}
        </button>
        <button
          onClick={() => setShowAllGyms(true)}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
            showAllGyms ? 'bg-white/[0.06] text-[#E5E7EB] border-white/10' : 'text-[#6B7280] border-white/6 hover:text-[#9CA3AF]'
          }`}
        >
          {t('platform.cardQueue.scopeAll', 'All gyms')}
        </button>
      </div>

      {/* Per-gym panels — on a failed cards query the banner above is the
          state; "Nothing to print" must never masquerade as an all-clear. */}
      {isLoading ? (
        <PlatformSpinner />
      ) : cardsError ? null : perGym.length === 0 ? (
        <div className="text-center py-16 bg-[#0F172A] border border-white/6 rounded-xl">
          <Printer size={32} className="mx-auto text-[#6B7280] mb-3" />
          <p className="text-[14px] text-[#6B7280]">{t('platform.cardQueue.empty', 'Nothing to print right now')}</p>
          <p className="text-[12px] text-[#6B7280]/60 mt-1">
            {showAllGyms
              ? t('platform.cardQueue.emptyAllHint', 'Cards appear here as gyms generate milestones.')
              : t('platform.cardQueue.emptyMineHint', 'No platform-fulfilled gyms have cards waiting. Toggle "All gyms" to see everyone.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {perGym.map(({ gym, pending, printed }) => {
            const isOpen = expanded.has(gym.id);
            const pendingIds = pending.map((c) => c.id);
            return (
              <FadeIn key={gym.id}>
                <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
                  {/* Gym header row */}
                  <button
                    onClick={() => toggle(gym.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    {isOpen ? <ChevronDown size={15} className="text-[#6B7280]" /> : <ChevronRight size={15} className="text-[#6B7280]" />}
                    <Building2 size={15} className="text-[#9CA3AF] flex-shrink-0" />
                    <span className="text-[14px] font-semibold text-[#E5E7EB] truncate flex-1">
                      {gym.name || t('platform.cardQueue.unknownGym', 'Unknown gym')}
                    </span>
                    {/* A11y: plain span (no role/tabIndex) — a nested interactive
                        element inside the header <button> is invalid; the click
                        only opens the confirm modal, stopPropagation keeps the
                        row from toggling. Hidden when the gym row is a
                        placeholder (fulfillment unknown). */}
                    {!gym.missing && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirm({
                            kind: 'fulfillment',
                            gym,
                            value: gym.card_fulfillment === 'platform' ? 'gym' : 'platform',
                          });
                        }}
                        title={t('platform.cardQueue.toggleFulfillment', 'Toggle who delivers this gym\'s cards')}
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                          gym.card_fulfillment === 'platform'
                            ? 'text-[#D4AF37] bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20'
                            : 'text-[#6B7280] bg-white/[0.04] hover:bg-white/[0.08]'
                        }`}
                      >
                        {gym.card_fulfillment === 'platform'
                          ? t('platform.cardQueue.platformBadge', 'You deliver')
                          : t('platform.cardQueue.selfBadge', 'Self-print')}
                      </span>
                    )}
                    {pending.length > 0 && (
                      <span className="text-[11px] font-bold text-[#D4AF37] tabular-nums">
                        {t('platform.cardQueue.toPrintCount', { count: pending.length, defaultValue: '{{count}} to print' })}
                      </span>
                    )}
                    {printed.length > 0 && (
                      <span className="text-[11px] font-medium text-[#10B981] tabular-nums">
                        {t('platform.cardQueue.toDeliverCount', { count: printed.length, defaultValue: '{{count}} to deliver' })}
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 space-y-4">
                      {/* Action bar */}
                      {pending.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => setPreview({ gymId: gym.id, ids: pendingIds })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold text-black hover:brightness-95 transition"
                            style={{ background: '#D4AF37' }}
                          >
                            <Printer size={13} />
                            {t('platform.cardQueue.previewPrint', 'Preview & print')}
                          </button>
                          <button
                            onClick={() => setConfirm({ kind: 'print', gym, ids: pendingIds })}
                            disabled={markPrintedMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30 hover:bg-[#10B981]/20 transition disabled:opacity-40"
                          >
                            <Check size={13} />
                            {t('platform.cardQueue.markPrinted', 'Mark printed')}
                          </button>
                          <span className="text-[11px] text-[#6B7280]">
                            {t('platform.cardQueue.willDeliver', { sat: fmtDate(upcomingSat), defaultValue: 'Delivers Sat {{sat}}' })}
                          </span>
                        </div>
                      )}

                      {/* Pending list */}
                      {pending.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
                            {t('platform.cardQueue.sectionToPrint', 'To print')}
                          </p>
                          <ul className="divide-y divide-white/[0.05]">
                            {pending.map((c) => <CardRow key={c.id} card={c} t={t} />)}
                          </ul>
                        </div>
                      )}

                      {/* Printed → awaiting delivery */}
                      {printed.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
                            {t('platform.cardQueue.sectionToDeliver', 'Printed — awaiting delivery')}
                          </p>
                          <ul className="divide-y divide-white/[0.05]">
                            {printed.map((c) => (
                              <CardRow
                                key={c.id}
                                card={c}
                                t={t}
                                deliveryLabel={c.expected_delivery_at
                                  ? t('platform.cardQueue.deliverOn', { date: fmtDate(new Date(c.expected_delivery_at)), defaultValue: 'Deliver {{date}}' })
                                  : null}
                                onDeliver={() => markDeliveredMutation.mutate(c.id)}
                                onReturn={() => returnToPendingMutation.mutate(c.id)}
                              />
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </FadeIn>
            );
          })}
        </div>
      )}

      {/* Platform print preview — points the iframe at the PlatformRoute-gated
          preview and passes the target gym so branding + cards match. */}
      {preview && (
        <PrintPreviewModal
          ids={preview.ids}
          gymId={preview.gymId}
          previewBase="/platform/print-cards/preview"
          onClose={() => setPreview(null)}
        />
      )}

      {/* Confirm: mark-printed batch + fulfillment flip (both were one-tap) */}
      {confirm && (
        <ConfirmModal
          t={t}
          confirm={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.kind === 'print') {
              markPrintedMutation.mutate({ ids: confirm.ids, gymId: confirm.gym.id });
            } else if (confirm.kind === 'fulfillment') {
              setFulfillmentMutation.mutate({ gymId: confirm.gym.id, value: confirm.value });
            }
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function ConfirmModal({ t, confirm, onCancel, onConfirm }) {
  const gymName = confirm.gym?.name || t('platform.cardQueue.unknownGym', 'Unknown gym');
  const isPrint = confirm.kind === 'print';
  const title = isPrint
    ? t('platform.cardQueue.confirmPrintTitle', 'Mark batch as printed?')
    : t('platform.cardQueue.confirmFulfillmentTitle', 'Change who delivers?');
  const body = isPrint
    ? t('platform.cardQueue.confirmPrintBody', {
        count: confirm.ids?.length ?? 0,
        gym: gymName,
        defaultValue: "{{count}} cards for {{gym}} move to delivery and the gym's admins get a heads-up.",
      })
    : confirm.value === 'platform'
      ? t('platform.cardQueue.confirmFulfillmentToPlatform', {
          gym: gymName,
          defaultValue: '{{gym}} switches to platform delivery — you print and drop off their cards.',
        })
      : t('platform.cardQueue.confirmFulfillmentToGym', {
          gym: gymName,
          defaultValue: '{{gym}} will print their own cards from now on.',
        });
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-[#0F172A] border border-white/10 rounded-2xl p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-[#E5E7EB]">{title}</h2>
        <p className="text-[13px] text-[#9CA3AF] mt-2 leading-relaxed">{body}</p>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold text-[#9CA3AF] border border-white/10 hover:bg-white/[0.04] transition-colors"
          >
            {t('platform.cardQueue.cancel', 'Cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold text-black hover:brightness-95 transition"
            style={{ background: '#D4AF37' }}
          >
            {t('platform.cardQueue.confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardRow({ card, t, deliveryLabel, onDeliver, onReturn }) {
  const member = card.profiles || {};
  const Icon = OCCASION_ICON[card.occasion] || Gift;
  return (
    <li className="py-2.5 flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
        <Icon size={13} className="text-[#D4AF37]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[#E5E7EB] truncate">
          {member.full_name || t('platform.cardQueue.unknownMember', 'Unknown member')}
        </p>
        <p className="text-[11px] text-[#9CA3AF] truncate">
          {t(`admin.printCards.occasions.${card.occasion}`, card.occasion)} · "{card.headline}"
        </p>
      </div>
      {deliveryLabel && (
        <span className="text-[10px] text-[#10B981] whitespace-nowrap">{deliveryLabel}</span>
      )}
      {onReturn && (
        <button
          onClick={onReturn}
          title={t('platform.cardQueue.returnToPending', 'Return to pending')}
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.04] text-[#9CA3AF] hover:bg-white/[0.08] hover:text-[#E5E7EB] transition-colors flex-shrink-0"
        >
          <RotateCcw size={13} />
        </button>
      )}
      {onDeliver && (
        <button
          onClick={onDeliver}
          title={t('platform.cardQueue.markDelivered', 'Mark delivered')}
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20 transition-colors flex-shrink-0"
        >
          <Check size={13} />
        </button>
      )}
    </li>
  );
}
