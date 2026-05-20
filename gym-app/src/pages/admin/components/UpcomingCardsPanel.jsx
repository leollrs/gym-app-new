import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  Calendar, Award, Cake, Sparkles, Loader2, Eye, Printer,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, Avatar } from '../../../components/admin';
import usePagedVisible from '../../../hooks/usePagedVisible';
import PaginationFooter from '../../../components/admin/PaginationFooter';
import CardPreview from './CardPreview';

// Same occasion → icon mapping as CardsToPrintPanel so the visual
// language stays consistent across "to print" and "upcoming".
const OCCASION_ICON = {
  habit_9in6:    Sparkles,
  tenure_30:     Calendar,
  tenure_90:     Calendar,
  tenure_365:    Calendar,
  milestone_100: Award,
  milestone_250: Award,
  milestone_500: Award,
  birthday:      Cake,
};

const OCCASION_TONE = {
  habit_9in6:    { bg: 'bg-[#10B981]/10',  border: 'border-[#10B981]/20',  text: 'text-[#10B981]' },
  tenure_30:     { bg: 'bg-[#3B82F6]/10',  border: 'border-[#3B82F6]/20',  text: 'text-[#3B82F6]' },
  tenure_90:     { bg: 'bg-[#3B82F6]/10',  border: 'border-[#3B82F6]/20',  text: 'text-[#3B82F6]' },
  tenure_365:    { bg: 'bg-[#3B82F6]/10',  border: 'border-[#3B82F6]/20',  text: 'text-[#3B82F6]' },
  milestone_100: { bg: 'bg-[#D4AF37]/10',  border: 'border-[#D4AF37]/20',  text: 'text-[#D4AF37]' },
  milestone_250: { bg: 'bg-[#D4AF37]/10',  border: 'border-[#D4AF37]/20',  text: 'text-[#D4AF37]' },
  milestone_500: { bg: 'bg-[#D4AF37]/10',  border: 'border-[#D4AF37]/20',  text: 'text-[#D4AF37]' },
  birthday:      { bg: 'bg-[#EC4899]/10',  border: 'border-[#EC4899]/20',  text: 'text-[#EC4899]' },
};

// get_upcoming_print_cards returns only the projected headline/subline —
// no occasion_data. Synthesize the small per-occasion data fields a
// few v2 components rely on so the materialized card matches what cron
// would have generated.
function buildOccasionData(row) {
  if (row.occasion === 'habit_9in6') {
    return { count: row.current_value || 9, window_days: 42 };
  }
  if (row.occasion === 'birthday' && row.predicted_at) {
    const d = new Date(row.predicted_at);
    return {
      day: String(d.getDate()),
      month: d.toLocaleString('en', { month: 'short' }).toUpperCase(),
    };
  }
  if (row.occasion === 'tenure_365' && row.predicted_at) {
    const joined = new Date(new Date(row.predicted_at).getTime() - 365 * 86400000);
    return {
      joined_date: joined.toLocaleString('default', { month: 'long', year: 'numeric' }),
    };
  }
  return {};
}

/**
 * Predictive print-card panel. Lists cards the daily cron will queue
 * in the next few workouts / days (from get_upcoming_print_cards).
 *
 * Each row has a "Print early" action that materializes the row into
 * print_cards now (status='pending') and opens the print preview.
 * That turns the upcoming panel from read-only nag into actual work
 * the owner can finish before the moment lands.
 *
 * After the owner prints and returns, the standard CardsToPrintPanel
 * flow takes over (pending → printed → delivered).
 */
export default function UpcomingCardsPanel({ gymId }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;
  const pager = usePagedVisible({ initial: 10, step: 10 });

  const { data: upcoming = [], isLoading, error } = useQuery({
    queryKey: ['upcoming_print_cards', gymId],
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('get_upcoming_print_cards', {
        p_gym_id: gymId,
        p_lookahead_workouts: 5,
        p_lookahead_days: 7,
      });
      if (err) throw err;
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000, // recompute every 5 min — predictions don't shift fast
  });

  // Materialize an upcoming card into print_cards (status='pending'),
  // then open the print preview tab. The daily cron's NOT EXISTS guard
  // will skip re-creating it once this row lands.
  const materializeMutation = useMutation({
    mutationFn: async (row) => {
      const { data, error: err } = await supabase.rpc('materialize_upcoming_print_card', {
        p_gym_id:        gymId,
        p_profile_id:    row.profile_id,
        p_occasion:      row.occasion,
        p_headline:      row.headline,
        p_subline:       row.subline,
        p_occasion_data: buildOccasionData(row),
      });
      if (err) throw err;
      return data; // new card UUID
    },
    onSuccess: (cardId, row) => {
      logAdminAction('print_card_materialized', 'print_card', cardId, {
        occasion: row.occasion,
        profile_id: row.profile_id,
      });
      queryClient.invalidateQueries({ queryKey: ['upcoming_print_cards', gymId] });
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      // Open print preview in a new tab. No features string — passing one
      // (even 'noopener') makes Chrome open a sized popup window instead of
      // a normal tab. Strip the opener reference via win.opener=null after.
      const params = new URLSearchParams({ ids: cardId });
      const win = window.open(`/admin/print-cards/preview?${params.toString()}`, '_blank');
      if (win) win.opener = null;
      showToast(
        t('admin.upcomingCards.toastQueued', { defaultValue: 'Card queued — preview opened. Mark printed after printing.' }),
        'success'
      );
    },
    onError: (err) => {
      showToast(
        err?.message || t('admin.upcomingCards.toastFailed', { defaultValue: 'Could not queue card' }),
        'error'
      );
    },
  });

  if (error) {
    // Most likely cause: 0416 migration not yet applied. Don't break the
    // page — just hide the panel and log.
    console.warn('[UpcomingCardsPanel] get_upcoming_print_cards failed:', error.message);
    return null;
  }

  return (
    <AdminCard className="mb-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center flex-shrink-0">
            <Eye size={16} className="text-[#8B5CF6]" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-[#E5E7EB]">
              {t('admin.upcomingCards.title', 'Coming up next')}
            </p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              {t('admin.upcomingCards.subtitle', 'Pre-print + pre-sign so the card is waiting on the member\'s next visit')}
            </p>
          </div>
        </div>
        {!isLoading && upcoming.length > 0 && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#8B5CF6]/10 text-[#8B5CF6] border border-[#8B5CF6]/20">
            {t('admin.upcomingCards.countBadge', { count: upcoming.length, defaultValue: '{{count}} coming' })}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-[#6B7280]" />
        </div>
      ) : upcoming.length === 0 ? (
        <div className="text-center py-8">
          <Sparkles size={22} className="mx-auto text-[#4B5563] mb-2" />
          <p className="text-[12.5px] text-[#9CA3AF]">
            {t('admin.upcomingCards.empty', 'No milestones or birthdays in the next 7 days.')}
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.06]">
            {upcoming.slice(0, pager.visibleCount).map((row) => {
              const Icon = OCCASION_ICON[row.occasion] || Award;
              const tone = OCCASION_TONE[row.occasion] || OCCASION_TONE.milestone_100;
              const rowKey = `${row.profile_id}-${row.occasion}`;
              const isPending = materializeMutation.isPending && materializeMutation.variables?.profile_id === row.profile_id && materializeMutation.variables?.occasion === row.occasion;
              // Explicit `_plural` key selection — i18next's auto-pluralization
              // isn't reliable across this app, so we pick the variant by hand.
              const whenLabel =
                row.unit_type === 'workouts'
                  ? t(row.units_away === 1 ? 'admin.upcomingCards.inWorkouts' : 'admin.upcomingCards.inWorkouts_plural', { count: row.units_away, defaultValue: row.units_away === 1 ? 'in {{count}} workout' : 'in {{count}} workouts' })
                  : row.units_away === 0
                    ? t('admin.upcomingCards.today', 'today')
                    : row.units_away === 1
                      ? t('admin.upcomingCards.tomorrow', 'tomorrow')
                      : t('admin.upcomingCards.inDays_plural', { count: row.units_away, defaultValue: 'in {{count}} days' });

              return (
                <li key={rowKey} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
                    {/* Member info column */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Avatar name={row.full_name} src={row.avatar_url} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                            {row.full_name || t('admin.upcomingCards.unknownMember', 'Unknown member')}
                          </span>
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${tone.bg} ${tone.border} ${tone.text}`}>
                            <Icon size={11} />
                            {t(`admin.printCards.occasions.${row.occasion}`, row.occasion)}
                          </span>
                        </div>
                        <p className="text-[12px] font-bold text-[#8B5CF6] mt-1">
                          {whenLabel}
                        </p>
                        {/* Metric line — workout count for milestones, date for birthdays */}
                        <p className="text-[11px] text-[#6B7280] mt-0.5 flex items-center gap-1.5 flex-wrap">
                          {row.unit_type === 'workouts' && row.current_value != null && (
                            <span>
                              {t(row.current_value === 1 ? 'admin.upcomingCards.currentWorkouts' : 'admin.upcomingCards.currentWorkouts_plural', { count: row.current_value, defaultValue: row.current_value === 1 ? 'Currently {{count}} workout' : 'Currently {{count}} workouts' })}
                            </span>
                          )}
                          {row.unit_type === 'days' && row.predicted_at && (
                            <>
                              <Calendar size={10} />
                              <span>{format(new Date(row.predicted_at), 'EEEE, MMM d', dateLocale)}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    {/* Card visual preview */}
                    <div className="flex-shrink-0">
                      <CardPreview
                        occasion={row.occasion}
                        headline={row.headline}
                        subline={row.subline}
                        memberName={row.full_name}
                        size="sm"
                      />
                    </div>
                  </div>
                  {/* Action row — pre-materialize this card into print_cards
                      so the owner can print + sign before the cron generates
                      it. Once materialized, the card flows through the
                      standard pending → printed → delivered pipeline. */}
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => materializeMutation.mutate(row)}
                      disabled={materializeMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#8B5CF6] text-white hover:brightness-110 transition disabled:opacity-50"
                    >
                      {isPending ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                      {t('admin.upcomingCards.printNow', { defaultValue: 'Print early' })}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <PaginationFooter pager={pager} total={upcoming.length} />
        </>
      )}
    </AdminCard>
  );
}
