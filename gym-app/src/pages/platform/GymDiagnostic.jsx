import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Microscope, Calendar, TrendingDown, Activity, Clock,
  AlertTriangle, Printer, Download,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInCalendarMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { selectAllRows } from '../../lib/churn/batchedSelect';
import { exportCSV } from '../../lib/csvExport';
import FadeIn from '../../components/platform/FadeIn';

/**
 * GymDiagnostic
 *
 * Retrospective retention analysis run on a gym's imported historical
 * roster (including imported_archived members). Five charts the owner has
 * never seen for their own business — used as the closing artifact when
 * onboarding a new gym.
 *
 * All queries here intentionally INCLUDE imported_archived=true. This is
 * the only surface in the app where that flag is included by default; live
 * dashboards filter it out (see overviewQuery, currentKPIs, analytics
 * charts) so retention math isn't poisoned by 5-year-old ex-members.
 */

// DATE columns (membership_started_at, legacy_cancellation_date) arrive as
// 'YYYY-MM-DD'. `new Date('YYYY-MM-DD')` parses as UTC midnight, which in
// Puerto Rico (UTC-4) is 8pm the PREVIOUS day — joins/cancels dated the 1st
// (the most common billing date) landed in the previous month, shifting
// cohorts and seasonality. Parse date-only strings as LOCAL dates; full
// timestamps keep normal parsing (they carry their own offset).
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDbDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

// Still-active members newer than this can't have "had time to cancel" —
// excluding them from plan mortality keeps young plans from looking immortal.
const MIN_OBS_MONTHS = 3;

export default function GymDiagnostic() {
  const { gymId } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateLocale = i18n.language?.startsWith('es') ? es : undefined;

  // Gym name for the header
  const { data: gym } = useQuery({
    queryKey: ['platform-gym-name-diag', gymId],
    queryFn: async () => {
      const { data } = await supabase.from('gyms').select('id, name').eq('id', gymId).single();
      return data;
    },
    enabled: !!gymId,
  });

  // Single fat query that powers all five charts. Pull every member ever —
  // active, cancelled, imported, organic — and slice client-side. Returning
  // a few thousand rows is cheap; running five distinct cohort queries on
  // the server is more code for the same result.
  const { data: members = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['platform-gym-diagnostic', gymId],
    queryFn: async () => {
      // Page the full member set — .limit(10000) is a false safeguard (PostgREST
      // caps the response at ~1000), so every diagnostic chart silently omitted
      // members past 1000 for large gyms.
      const { data, error } = await selectAllRows((lo, hi) => supabase
        .from('profiles')
        .select('id, created_at, membership_started_at, membership_status, membership_status_updated_at, legacy_cancellation_date, imported_archived, admin_note')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .order('id', { ascending: true })
        .range(lo, hi));
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Derived shapes ────────────────────────────────────────────
  // Normalize each member down to the fields the charts care about so the
  // chart functions don't repeat the same coalesce logic five times.
  const normalized = useMemo(() => members.map((m) => {
    // Join date: legacy import puts the gym's real join date in
    // membership_started_at. Organic signups don't set it → fall back to
    // created_at.
    const joinSrc = m.membership_started_at || m.created_at;
    const joinDate = parseDbDate(joinSrc);

    // Cancel date: imported-archived members carry the legacy date; live
    // cancellations land in membership_status_updated_at when the status
    // flips to 'cancelled'. Anything else (active/suspended/etc.) is null.
    let cancelDate = null;
    if (m.imported_archived && m.legacy_cancellation_date) {
      cancelDate = parseDbDate(m.legacy_cancellation_date);
    } else if (m.membership_status === 'cancelled' && m.membership_status_updated_at) {
      cancelDate = parseDbDate(m.membership_status_updated_at);
    }

    // Plan: imported plans live in admin_note as "Imported plan: X".
    // Parse it out; if absent, leave null so plan mortality buckets the
    // member into "Unknown".
    let plan = null;
    if (m.admin_note?.startsWith('Imported plan: ')) {
      plan = m.admin_note.replace('Imported plan: ', '').trim();
    }

    // An imported_archived member is a churned ex-member by definition — even
    // when the legacy CSV carried no cancellation_date (a sparse field) and the
    // import never sets membership_status_updated_at. Treat them (and any
    // 'cancelled'-status member) as churned so they stop being counted as
    // survivors; with no known date they're simply excluded from the date-keyed
    // charts (cohort timing, tenure, seasonality) below.
    const isCancelled = m.imported_archived === true || m.membership_status === 'cancelled' || cancelDate != null;
    return { joinDate, cancelDate, plan, isCancelled };
  }).filter((m) => m.joinDate), [members]);

  // ── Chart 1: Cohort retention heatmap ────────────────────────
  // For each calendar-month cohort (rows), what fraction were still
  // non-cancelled N months later (cols)? Caps at 12 months ahead to keep
  // the grid readable. RIGHT-CENSORED: months a cohort hasn't lived yet are
  // marked unobserved (rendered "—"), not counted as survived — without
  // this, recent cohorts read ~100% and the heatmap overstates retention.
  const cohortGrid = useMemo(() => {
    if (normalized.length === 0) return null;
    const grid = new Map(); // joinMonthKey → { size, atMonth: { N: stillActiveCount } }
    const MAX_OFFSET = 12;
    const now = new Date();

    normalized.forEach((m) => {
      // Churned but with no known cancel date (sparse legacy imports): we know
      // they left, not when, so they can't be placed on the survival timeline.
      // Exclude them rather than count them as survivors (which overstated
      // retention) — right-censoring of unknown-timing churn.
      if (m.isCancelled && !m.cancelDate) return;
      const key = format(m.joinDate, 'yyyy-MM');
      const cohort = grid.get(key) || { size: 0, atMonth: {} };
      cohort.size += 1;

      // Did this member survive month N? They survived if at the start
      // of month N they were not yet cancelled.
      for (let offset = 0; offset <= MAX_OFFSET; offset++) {
        const stillActive = !m.cancelDate
          || differenceInCalendarMonths(m.cancelDate, m.joinDate) > offset;
        cohort.atMonth[offset] = (cohort.atMonth[offset] || 0) + (stillActive ? 1 : 0);
      }
      grid.set(key, cohort);
    });

    // Sort by month ascending. Drop ONLY the very latest cohort when it has
    // < 2 members (one outlier would dominate its row visually) — older
    // size-1 cohorts are real history and stay.
    const rows = Array.from(grid.entries())
      .map(([key, c]) => {
        const [y, mo] = key.split('-').map(Number);
        // Months this cohort has actually lived (right-censor boundary).
        const monthsElapsed = differenceInCalendarMonths(now, new Date(y, mo - 1, 1));
        return {
          key,
          size: c.size,
          atMonth: c.atMonth,
          monthsElapsed: Math.max(0, monthsElapsed),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    if (rows.length > 0 && rows[rows.length - 1].size < 2) rows.pop();

    return { rows: rows.slice(-12), maxOffset: MAX_OFFSET };
  }, [normalized]);

  // ── Chart 2: Average tenure ───────────────────────────────────
  // Mean months between join and cancel (or now for still-active). Single
  // headline number — footnoted as a mix of complete + still-running
  // tenures (active members keep accruing, so the true mean is higher).
  const avgTenure = useMemo(() => {
    if (normalized.length === 0) return null;
    const now = new Date();
    const tenures = normalized
      .map((m) => {
        // Churned with unknown date → unknown tenure; exclude rather than let it
        // accrue to now() (which treated ex-members as still-active forever).
        if (m.isCancelled && !m.cancelDate) return null;
        const end = m.cancelDate || now;
        return Math.max(0, differenceInCalendarMonths(end, m.joinDate));
      })
      .filter((v) => v != null);
    if (tenures.length === 0) return null;
    const sum = tenures.reduce((s, t) => s + t, 0);
    return {
      months: Math.round((sum / tenures.length) * 10) / 10,
      memberCount: tenures.length,
    };
  }, [normalized]);

  // ── Chart 3: Plan-mix mortality ──────────────────────────────
  // For each plan_name, what fraction of members on that plan eventually
  // cancelled? Highlights leaky-bucket plans the owner can re-price or kill.
  // Censoring: still-active members observed < MIN_OBS_MONTHS are excluded —
  // they haven't had time to cancel, and counting them as survivors made
  // young plans look artificially healthy.
  const planMortality = useMemo(() => {
    if (normalized.length === 0) return { rows: [], excluded: 0 };
    const now = new Date();
    const byPlan = new Map();
    let excluded = 0;
    normalized.forEach((m) => {
      if (!m.isCancelled && differenceInCalendarMonths(now, m.joinDate) < MIN_OBS_MONTHS) {
        excluded += 1;
        return;
      }
      const key = m.plan || t('platform.diagnostic.unknownPlan', '(Unknown)');
      const e = byPlan.get(key) || { total: 0, cancelled: 0 };
      e.total += 1;
      if (m.isCancelled) e.cancelled += 1;
      byPlan.set(key, e);
    });
    const rows = Array.from(byPlan.entries())
      .map(([plan, e]) => ({
        plan,
        total: e.total,
        cancelled: e.cancelled,
        rate: e.total > 0 ? Math.round((e.cancelled / e.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
    return { rows, excluded };
  }, [normalized, t]);

  // ── Chart 4: Cancellation seasonality ────────────────────────
  // Bar per month-of-year showing the count of cancellations that landed
  // in that calendar month, across all years. Surfaces "we bleed in Jan"
  // patterns the gym is invisible to without this view.
  const seasonality = useMemo(() => {
    const months = Array(12).fill(0);
    normalized.forEach((m) => {
      if (m.cancelDate) months[m.cancelDate.getMonth()] += 1;
    });
    const max = Math.max(1, ...months);
    return months.map((count, idx) => ({
      monthIdx: idx,
      monthLabel: format(new Date(2000, idx, 1), 'MMM', { locale: dateLocale }),
      count,
      pct: Math.round((count / max) * 100),
    }));
  }, [normalized, dateLocale]);

  // ── Chart 5: Tenure-at-cancellation histogram ────────────────
  // Where in the funnel members die. 0-1mo / 1-3mo / 3-6mo / 6-12mo / 12mo+.
  // Tells the owner if the bleed is onboarding (early death) vs retention
  // (long-tenured cancellations).
  const tenureHistogram = useMemo(() => {
    const buckets = [
      { label: t('platform.diagnostic.bucket0_1', '0–1 mo'), from: 0, to: 1, count: 0 },
      { label: t('platform.diagnostic.bucket1_3', '1–3 mo'), from: 1, to: 3, count: 0 },
      { label: t('platform.diagnostic.bucket3_6', '3–6 mo'), from: 3, to: 6, count: 0 },
      { label: t('platform.diagnostic.bucket6_12', '6–12 mo'), from: 6, to: 12, count: 0 },
      { label: t('platform.diagnostic.bucket12plus', '12+ mo'), from: 12, to: Infinity, count: 0 },
    ];
    normalized.forEach((m) => {
      if (!m.cancelDate) return;
      const months = Math.max(0, differenceInCalendarMonths(m.cancelDate, m.joinDate));
      const bucket = buckets.find((b) => months >= b.from && months < b.to);
      if (bucket) bucket.count += 1;
    });
    const total = buckets.reduce((s, b) => s + b.count, 0);
    return buckets.map((b) => ({
      ...b,
      pct: total > 0 ? Math.round((b.count / total) * 100) : 0,
    }));
  }, [normalized, t]);

  const totalCancellations = normalized.filter((m) => m.isCancelled).length;
  // Of those cancellations, how many carry a real date. The date-keyed charts
  // (cohort timing, tenure-at-cancellation, seasonality) deliberately exclude
  // date-less churn — surfacing this count explains why the "Total cancelled"
  // KPI can be large while those charts look sparse.
  const cancellationsWithDate = normalized.filter((m) => m.isCancelled && m.cancelDate != null).length;
  const datelessCancellations = totalCancellations - cancellationsWithDate;
  const totalEver = normalized.length;

  // ── Cohort grid CSV (censored cells stay blank) ───────────────
  const handleExportCohorts = async () => {
    if (!cohortGrid?.rows?.length) return;
    const columns = [
      { key: 'cohort', label: t('platform.diagnostic.cohortCol', 'Cohort') },
      { key: 'size', label: t('platform.diagnostic.sizeCol', 'Size') },
      ...Array.from({ length: cohortGrid.maxOffset + 1 }, (_, i) => ({ key: `m${i}`, label: `M${i}` })),
    ];
    const data = cohortGrid.rows.map((r) => {
      const row = { cohort: r.key, size: r.size };
      for (let i = 0; i <= cohortGrid.maxOffset; i++) {
        row[`m${i}`] = i > r.monthsElapsed
          ? ''
          : `${Math.round(((r.atMonth[i] || 0) / r.size) * 100)}%`;
      }
      return row;
    });
    await exportCSV({
      filename: `retention-diagnostic-${(gym?.name || 'gym').replace(/\s+/g, '-').toLowerCase()}`,
      columns,
      data,
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto print-diagnostic">
      {/* Minimal print support so the diagnostic is leavable with an owner. */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-diagnostic { max-width: 100% !important; padding: 0 !important; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/platform/gym/${gymId}`)}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors no-print"
          aria-label={t('platform.diagnostic.back', 'Back')}
        >
          <ArrowLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[#6B7280] mb-0.5 flex items-center gap-1.5">
            <Microscope size={11} />
            {t('platform.diagnostic.kicker', 'Retention diagnostic')}
          </p>
          <h1 className="text-[18px] font-bold text-[#E5E7EB] truncate">
            {gym?.name || t('platform.diagnostic.gymFallback', 'Gym')}
          </h1>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-[11px] font-semibold text-[#E5E7EB] hover:bg-white/[0.08] transition-colors no-print"
        >
          <Printer size={13} className="text-[#9CA3AF]" />
          {t('platform.diagnostic.print', 'Print / Save PDF')}
        </button>
        <div className="text-right">
          <p className="text-[11px] text-[#6B7280]">{t('platform.diagnostic.membersAnalyzed', 'Members analyzed')}</p>
          <p className="text-[15px] font-bold text-[#E5E7EB] tabular-nums">{totalEver.toLocaleString()}</p>
        </div>
      </div>

      {isLoading && (
        <p className="text-center py-12 text-[#9CA3AF] text-[12px]">{t('platform.diagnostic.loading', 'Loading historical data…')}</p>
      )}

      {/* Real error state — without this, a failed query rendered the
          empty-roster panel and looked like "this gym has no history". */}
      {!isLoading && isError && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-8 text-center no-print">
          <AlertTriangle size={20} className="text-red-400 mx-auto mb-2" />
          <p className="text-[14px] font-bold text-[#E5E7EB] mb-1">
            {t('platform.diagnostic.errorTitle', "Couldn't load the diagnostic")}
          </p>
          <p className="text-[12px] text-[#9CA3AF] mb-4">
            {t('platform.diagnostic.errorDesc', 'The historical roster query failed. Check your connection and try again.')}
          </p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 rounded-lg bg-[#D4AF37]/15 text-[#D4AF37] text-[12px] font-semibold hover:bg-[#D4AF37]/25 transition-colors"
          >
            {t('platform.diagnostic.retry', 'Retry')}
          </button>
        </div>
      )}

      {!isLoading && !isError && totalEver === 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-10 text-center">
          <p className="text-[14px] font-bold text-[#E5E7EB] mb-1">{t('platform.diagnostic.noData', 'No member data yet')}</p>
          <p className="text-[12px] text-[#9CA3AF]">{t('platform.diagnostic.noDataDesc', 'Import a historical roster first to see the diagnostic.')}</p>
        </div>
      )}

      {!isLoading && !isError && totalEver > 0 && (
        <div className="space-y-5">
          {/* Headline KPIs row */}
          <FadeIn>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <BigStat
                label={t('platform.diagnostic.totalEver', 'Total members ever')}
                value={totalEver.toLocaleString()}
                icon={Activity}
              />
              <BigStat
                label={t('platform.diagnostic.totalCancelled', 'Total cancelled')}
                value={totalCancellations.toLocaleString()}
                sub={t('platform.diagnostic.lifetimePct', { pct: Math.round((totalCancellations / totalEver) * 100), defaultValue: '{{pct}}% lifetime' })}
                note={datelessCancellations > 0
                  ? t('platform.diagnostic.kpiNoDate', { count: datelessCancellations, defaultValue: '{{count}} have no recorded date' })
                  : null}
                icon={TrendingDown}
                accent="amber"
              />
              <BigStat
                label={t('platform.diagnostic.avgTenure', 'Avg tenure')}
                value={avgTenure ? t('platform.diagnostic.avgTenureMonths', { months: avgTenure.months, defaultValue: '{{months}} mo' }) : '—'}
                sub={t('platform.diagnostic.avgTenureNote', 'Includes active members (still accruing)')}
                icon={Clock}
                accent="emerald"
              />
              <BigStat
                label={t('platform.diagnostic.plansTracked', 'Plans tracked')}
                value={planMortality.rows.length}
                icon={Calendar}
              />
            </div>
          </FadeIn>

          {/* (1) Cohort retention heatmap */}
          {cohortGrid && cohortGrid.rows.length > 0 && (
            <FadeIn delay={40}>
              <ChartCard
                title={t('platform.diagnostic.cohortTitle', 'Cohort retention curve')}
                subtitle={t('platform.diagnostic.cohortSubtitle', 'Each row is a join-month cohort. Cell = % still non-cancelled N months in. "—" = the cohort hasn’t reached that month yet.')}
                action={(
                  <button
                    onClick={handleExportCohorts}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-[10.5px] font-semibold text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.08] transition-colors no-print"
                  >
                    <Download size={12} />
                    {t('platform.diagnostic.exportCsv', 'Export CSV')}
                  </button>
                )}
              >
                <CohortHeatmap data={cohortGrid} t={t} />
                <DatelessNote count={datelessCancellations} t={t} />
              </ChartCard>
            </FadeIn>
          )}

          {/* (2,5) Two-column row: Plan mortality + Tenure histogram */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <FadeIn delay={80}>
              <ChartCard
                title={t('platform.diagnostic.planTitle', 'Plan mortality')}
                subtitle={
                  t('platform.diagnostic.planSubtitle', 'Of members ever enrolled in each plan, what fraction eventually cancelled.')
                  + (planMortality.excluded > 0
                    ? ' ' + t('platform.diagnostic.planExcluded', { count: planMortality.excluded, defaultValue: '{{count}} members under 3 months excluded (too new to judge).' })
                    : '')
                }
              >
                {planMortality.rows.length === 0 ? (
                  <Empty label={t('platform.diagnostic.noPlanData', 'No plan data in imported records.')} />
                ) : (
                  <PlanMortalityChart rows={planMortality.rows} />
                )}
              </ChartCard>
            </FadeIn>

            <FadeIn delay={120}>
              <ChartCard
                title={t('platform.diagnostic.tenureTitle', 'Tenure at cancellation')}
                subtitle={t('platform.diagnostic.tenureSubtitle', 'Where in the funnel cancellations happen. Heavy 0–3mo = onboarding leak. Heavy 12mo+ = late churn.')}
              >
                {totalCancellations === 0 ? (
                  <Empty label={t('platform.diagnostic.noCancellations', 'No cancellations on record yet.')} />
                ) : cancellationsWithDate === 0 ? (
                  <Empty label={t('platform.diagnostic.cancellationsNoDates', 'Cancellations exist but have no recorded dates — import cancellation dates to see this chart.')} />
                ) : (
                  <>
                    <TenureHistogramChart buckets={tenureHistogram} />
                    <DatelessNote count={datelessCancellations} t={t} />
                  </>
                )}
              </ChartCard>
            </FadeIn>
          </div>

          {/* (4) Seasonality */}
          <FadeIn delay={160}>
            <ChartCard
              title={t('platform.diagnostic.seasonTitle', 'Cancellation seasonality')}
              subtitle={t('platform.diagnostic.seasonSubtitle', 'Which calendar months bleed most, across all years on record.')}
            >
              {totalCancellations === 0 ? (
                <Empty label={t('platform.diagnostic.noCancellations', 'No cancellations on record yet.')} />
              ) : cancellationsWithDate === 0 ? (
                <Empty label={t('platform.diagnostic.cancellationsNoDates', 'Cancellations exist but have no recorded dates — import cancellation dates to see this chart.')} />
              ) : (
                <>
                  <SeasonalityChart bars={seasonality} />
                  <DatelessNote count={datelessCancellations} t={t} />
                </>
              )}
            </ChartCard>
          </FadeIn>

          {/* Footnote */}
          <p className="text-[11px] text-[#6B7280] text-center mt-4">
            {t('platform.diagnostic.footnote', 'Diagnostic includes all imported members (active + archived) and live signups. Cancellation date sources: imported legacy date for archived members, in-app cancel timestamp for live cancellations. Average tenure mixes completed and still-running memberships.')}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Layout helpers ────────────────────────────────────────────
function ChartCard({ title, subtitle, action, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-[#E5E7EB]">{title}</p>
          <p className="text-[11px] text-[#9CA3AF] mt-0.5 mb-4 leading-relaxed">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function BigStat({ label, value, sub, note, icon: Icon, accent }) {
  const ringColor = accent === 'emerald' ? '#10B981'
                  : accent === 'amber'   ? '#F59E0B'
                  : '#6B7280';
  return (
    <div className="rounded-xl border border-white/10 bg-[#0F172A] p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${ringColor}1F` }}>
          <Icon size={13} style={{ color: ringColor }} />
        </div>
        <span className="text-[10.5px] uppercase tracking-wider text-[#9CA3AF]">{label}</span>
      </div>
      <p className="text-[24px] font-extrabold tabular-nums text-[#E5E7EB] leading-none">{value}</p>
      {sub && <p className="text-[11px] text-[#9CA3AF] mt-1">{sub}</p>}
      {note && <p className="text-[10.5px] text-[#6B7280] mt-0.5">{note}</p>}
    </div>
  );
}

function Empty({ label }) {
  return <p className="text-center py-8 text-[12px] text-[#6B7280]">{label}</p>;
}

// Muted note shown beneath date-keyed charts when some cancellations carry no
// date and are therefore excluded from timing analysis — explains sparseness
// without altering the underlying counts.
function DatelessNote({ count, t }) {
  if (!count || count <= 0) return null;
  return (
    <p className="text-[10.5px] text-[#6B7280] mt-3 leading-relaxed">
      {t('platform.diagnostic.datelessExcluded', {
        count,
        defaultValue: '{{count}} cancellation(s) have no recorded date and are excluded from this chart.',
      })}
    </p>
  );
}

// ── Cohort heatmap ─────────────────────────────────────────────
function CohortHeatmap({ data, t }) {
  const { rows, maxOffset } = data;
  return (
    <div className="overflow-x-auto">
      <table className="text-[10.5px] w-full">
        <thead>
          <tr>
            <th className="px-1.5 py-1.5 text-left text-[#9CA3AF] font-semibold sticky left-0 bg-[#0F172A]">{t('platform.diagnostic.cohortCol', 'Cohort')}</th>
            <th className="px-1.5 py-1.5 text-right text-[#9CA3AF] font-semibold">{t('platform.diagnostic.sizeCol', 'Size')}</th>
            {Array.from({ length: maxOffset + 1 }).map((_, i) => (
              <th key={i} className="px-1.5 py-1.5 text-center text-[#9CA3AF] font-semibold">M{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-1.5 py-1 text-[#E5E7EB] font-mono sticky left-0 bg-[#0F172A]">{r.key}</td>
              <td className="px-1.5 py-1 text-right text-[#6B7280] tabular-nums">{r.size}</td>
              {Array.from({ length: maxOffset + 1 }).map((_, offset) => {
                // Right-censoring: the cohort hasn't lived this month yet —
                // render blank, never "100% survived".
                if (offset > r.monthsElapsed) {
                  return (
                    <td
                      key={offset}
                      className="px-1.5 py-1 text-center text-[#4B5563]"
                      title={t('platform.diagnostic.cellNotReached', 'Not reached yet')}
                    >
                      —
                    </td>
                  );
                }
                const survivors = r.atMonth[offset] || 0;
                const pct = Math.round((survivors / r.size) * 100);
                // Color ramp: red → amber → emerald
                let bg = '#374151';
                let text = '#9CA3AF';
                if (pct >= 80)      { bg = '#10B98140'; text = '#A7F3D0'; }
                else if (pct >= 60) { bg = '#10B98120'; text = '#A7F3D0'; }
                else if (pct >= 40) { bg = '#F59E0B30'; text = '#FDE68A'; }
                else if (pct >= 20) { bg = '#EF444430'; text = '#FCA5A5'; }
                else if (pct > 0)   { bg = '#EF444450'; text = '#FCA5A5'; }
                return (
                  <td
                    key={offset}
                    className="px-1.5 py-1 text-center tabular-nums font-semibold"
                    style={{ background: bg, color: text }}
                    title={t('platform.diagnostic.cellTitle', { survivors, size: r.size, defaultValue: '{{survivors}} of {{size}} survived' })}
                  >
                    {pct}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Plan mortality bars ────────────────────────────────────────
function PlanMortalityChart({ rows }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.plan}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[12px] text-[#E5E7EB] truncate flex-1 mr-3">{r.plan}</p>
            <p className="text-[11px] text-[#9CA3AF] tabular-nums whitespace-nowrap">
              <span className="text-red-400 font-bold">{r.rate}%</span>
              {' '}({r.cancelled}/{r.total})
            </p>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-white/5">
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${r.rate}%`,
                background: r.rate >= 60 ? '#EF4444'
                         : r.rate >= 40 ? '#F59E0B'
                         : '#10B981',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tenure histogram ───────────────────────────────────────────
function TenureHistogramChart({ buckets }) {
  return (
    <div className="space-y-2.5">
      {buckets.map((b) => (
        <div key={b.label}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[12px] text-[#E5E7EB]">{b.label}</p>
            <p className="text-[11px] text-[#9CA3AF] tabular-nums">
              <span className="font-bold text-[#E5E7EB]">{b.count}</span>
              {' '}<span className="text-[#6B7280]">({b.pct}%)</span>
            </p>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-white/5">
            <div className="h-full bg-amber-500 transition-all duration-700" style={{ width: `${b.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Seasonality bars ───────────────────────────────────────────
function SeasonalityChart({ bars }) {
  return (
    <div className="flex items-end gap-1.5 h-32">
      {bars.map((b) => (
        <div key={b.monthIdx} className="flex-1 flex flex-col items-center justify-end">
          <p className="text-[10px] text-[#9CA3AF] mb-1 tabular-nums">{b.count || ''}</p>
          <div
            className="w-full rounded-t bg-gradient-to-t from-red-500/60 to-amber-500/60"
            style={{ height: `${b.pct}%`, minHeight: b.count > 0 ? 4 : 0 }}
            title={`${b.monthLabel}: ${b.count}`}
          />
          <p className="text-[10px] text-[#6B7280] mt-1">{b.monthLabel}</p>
        </div>
      ))}
    </div>
  );
}
