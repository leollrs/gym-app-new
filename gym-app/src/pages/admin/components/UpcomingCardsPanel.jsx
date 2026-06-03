import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { Loader2, Eye, Printer, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard } from '../../../components/admin';
import usePagedVisible from '../../../hooks/usePagedVisible';
import PaginationFooter from '../../../components/admin/PaginationFooter';
import PrintPreviewModal from '../../../components/admin/PrintPreviewModal';
import CardPreview from './CardPreview';
import { occasionMeta, toneStyle, CardAvatar, OccasionPill } from './cardOccasions';

const DISPLAY_FONT = "var(--admin-font-display, 'Archivo', 'Barlow', sans-serif)";

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
 * Predictive print-card panel — the hero of the page.
 *
 * Lists cards the daily cron will queue in the next few workouts / days
 * (from get_upcoming_print_cards) as a tight grid: member header + the
 * real card preview + a print action stacked in one cell, so the cards
 * (the valuable, retention-driving artifact) lead the page.
 *
 * Each cell's "Print early" action materializes the row into print_cards
 * now (status='pending') and opens the print preview. After the owner
 * prints and returns, the CardsToPrintPanel flow takes over
 * (pending → printed → delivered).
 */
export default function UpcomingCardsPanel({ gymId }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;
  const pager = usePagedVisible({ initial: 6, step: 6 });
  // ids currently open in the print preview modal — null when modal closed
  const [previewIds, setPreviewIds] = useState(null);

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
      // Open the preview modal with the freshly-materialized card so the
      // owner can hit Print right away.
      setPreviewIds([cardId]);
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

  // Hide the whole hero when nothing is coming up + not loading — keeps the
  // page focused on the queue rather than showing an empty hero band.
  if (!isLoading && upcoming.length === 0) return null;

  const visible = upcoming.slice(0, pager.visibleCount);

  return (
    <AdminCard className="mb-5" clipContent={false}>
      {/* Print preview modal — opens after materialize succeeds. */}
      {previewIds && (
        <PrintPreviewModal ids={previewIds} onClose={() => setPreviewIds(null)} />
      )}

      {/* Header — eye icon, title, subtitle, "N coming" pill */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: toneStyle('coach').soft }}
          >
            <Eye size={15} style={{ color: toneStyle('coach').ink }} />
          </div>
          <div className="min-w-0">
            <p className="text-[14.5px] font-extrabold" style={{ color: 'var(--color-admin-text)', fontFamily: DISPLAY_FONT, letterSpacing: -0.2 }}>
              {t('admin.upcomingCards.title', 'Coming up next')}
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
              {t('admin.upcomingCards.subtitle', "Pre-print + pre-sign so the card is waiting on the member's next visit")}
            </p>
          </div>
        </div>
        {!isLoading && upcoming.length > 0 && (
          <span
            className="admin-pill admin-pill--coach"
            style={{ flexShrink: 0 }}
          >
            {t('admin.upcomingCards.countBadge', { count: upcoming.length, defaultValue: '{{count}} coming' })}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-admin-text-muted)' }} />
        </div>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((row) => {
              const { tone } = occasionMeta(row.occasion);
              const ink = toneStyle('coach').ink;
              const rowKey = `${row.profile_id}-${row.occasion}`;
              const isPending = materializeMutation.isPending
                && materializeMutation.variables?.profile_id === row.profile_id
                && materializeMutation.variables?.occasion === row.occasion;

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

              const dateLabel = row.unit_type === 'days' && row.predicted_at
                ? format(new Date(row.predicted_at), 'EEEE, MMM d', dateLocale)
                : row.unit_type === 'workouts' && row.current_value != null
                  ? t(row.current_value === 1 ? 'admin.upcomingCards.currentWorkouts' : 'admin.upcomingCards.currentWorkouts_plural', { count: row.current_value, defaultValue: row.current_value === 1 ? 'Currently {{count}} workout' : 'Currently {{count}} workouts' })
                  : null;

              return (
                <div
                  key={rowKey}
                  className="flex flex-col gap-3"
                  style={{
                    border: '1px solid var(--color-admin-border)',
                    borderRadius: 14,
                    background: 'var(--color-admin-sidebar)',
                    padding: 14,
                  }}
                >
                  {/* Member header */}
                  <div className="flex items-center gap-2.5">
                    <CardAvatar name={row.full_name} src={row.avatar_url} tone={tone} size={34} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>
                          {row.full_name || t('admin.upcomingCards.unknownMember', 'Unknown member')}
                        </span>
                        <OccasionPill occasion={row.occasion} label={t(`admin.printCards.occasions.${row.occasion}`, row.occasion)} />
                      </div>
                      <div className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
                        <span style={{ color: ink, fontWeight: 700 }}>{whenLabel}</span>
                        {dateLabel ? <> · {dateLabel}</> : null}
                      </div>
                    </div>
                  </div>

                  {/* The card — hero of the cell, centered */}
                  <div className="flex justify-center py-1">
                    <CardPreview
                      occasion={row.occasion}
                      headline={row.headline}
                      subline={row.subline}
                      memberName={row.full_name}
                      width={236}
                    />
                  </div>

                  {/* Action — materialize ("print early") or view if already queued */}
                  {row.card_id ? (
                    <div className="flex items-center gap-2">
                      {row.card_status && (
                        <span
                          className={`admin-pill ${row.card_status === 'printed' ? 'admin-pill--good' : 'admin-pill--warn'}`}
                        >
                          <Check size={11} />
                          {row.card_status === 'printed'
                            ? t('admin.upcomingCards.statusPrinted', { defaultValue: 'Printed' })
                            : t('admin.upcomingCards.statusQueued', { defaultValue: 'Queued' })}
                        </span>
                      )}
                      <button
                        onClick={() => setPreviewIds([row.card_id])}
                        className="ml-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-bold transition active:scale-[0.98]"
                        style={{
                          background: 'var(--color-bg-card)',
                          color: 'var(--color-admin-text)',
                          border: '1px solid var(--color-admin-border)',
                        }}
                      >
                        <Eye size={12} />
                        {t('admin.upcomingCards.viewBtn', { defaultValue: 'View' })}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => materializeMutation.mutate(row)}
                      disabled={materializeMutation.isPending}
                      className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-[12px] font-bold transition active:scale-[0.98] disabled:opacity-50"
                      style={{ background: 'var(--color-coach)', color: '#fff' }}
                    >
                      {isPending ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                      {t('admin.upcomingCards.printNow', { defaultValue: 'Print early' })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <PaginationFooter pager={pager} total={upcoming.length} />
        </>
      )}
    </AdminCard>
  );
}
