import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Microscope, Calendar, AlertTriangle, TrendingDown, Activity, Clock,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInCalendarMonths, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
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
export default function GymDiagnostic() {
  const { gymId } = useParams();
  const navigate = useNavigate();

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
  const { data: members = [], isLoading } = useQuery({
    queryKey: ['platform-gym-diagnostic', gymId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, created_at, membership_started_at, membership_status, membership_status_updated_at, legacy_cancellation_date, imported_archived, admin_note')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .limit(10000);
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
    const joinDate = joinSrc ? new Date(joinSrc) : null;

    // Cancel date: imported-archived members carry the legacy date; live
    // cancellations land in membership_status_updated_at when the status
    // flips to 'cancelled'. Anything else (active/suspended/etc.) is null.
    let cancelDate = null;
    if (m.imported_archived && m.legacy_cancellation_date) {
      cancelDate = new Date(m.legacy_cancellation_date);
    } else if (m.membership_status === 'cancelled' && m.membership_status_updated_at) {
      cancelDate = new Date(m.membership_status_updated_at);
    }

    // Plan: imported plans live in admin_note as "Imported plan: X".
    // Parse it out; if absent, leave null so plan mortality buckets the
    // member into "Unknown".
    let plan = null;
    if (m.admin_note?.startsWith('Imported plan: ')) {
      plan = m.admin_note.replace('Imported plan: ', '').trim();
    }

    const isCancelled = !!cancelDate;
    return { joinDate, cancelDate, plan, isCancelled };
  }).filter((m) => m.joinDate), [members]);

  // ── Chart 1: Cohort retention heatmap ────────────────────────
  // For each calendar-month cohort (rows), what fraction were still
  // non-cancelled N months later (cols)? Caps at 12 months ahead to keep
  // the grid readable.
  const cohortGrid = useMemo(() => {
    if (normalized.length === 0) return null;
    const grid = new Map(); // joinMonthKey → { size, atMonth: { N: stillActiveCount } }
    const MAX_OFFSET = 12;

    normalized.forEach((m) => {
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

    // Sort by month ascending, drop the very latest cohort if it has < 2
    // members (one outlier would dominate its row visually).
    const rows = Array.from(grid.entries())
      .map(([key, c]) => ({
        key,
        size: c.size,
        atMonth: c.atMonth,
      }))
      .filter((r) => r.size >= 2)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12); // last 12 cohorts

    return { rows, maxOffset: MAX_OFFSET };
  }, [normalized]);

  // ── Chart 2: Average tenure ───────────────────────────────────
  // Mean months between join and cancel (or now for still-active). Single
  // headline number, no slicing yet — the plan mortality chart covers the
  // cut-by-plan question.
  const avgTenure = useMemo(() => {
    if (normalized.length === 0) return null;
    const now = new Date();
    const tenures = normalized.map((m) => {
      const end = m.cancelDate || now;
      return Math.max(0, differenceInCalendarMonths(end, m.joinDate));
    });
    const sum = tenures.reduce((s, t) => s + t, 0);
    return {
      months: Math.round((sum / tenures.length) * 10) / 10,
      memberCount: tenures.length,
    };
  }, [normalized]);

  // ── Chart 3: Plan-mix mortality ──────────────────────────────
  // For each plan_name, what fraction of members on that plan eventually
  // cancelled? Highlights leaky-bucket plans the owner can re-price or kill.
  const planMortality = useMemo(() => {
    if (normalized.length === 0) return [];
    const byPlan = new Map();
    normalized.forEach((m) => {
      const key = m.plan || '(Unknown)';
      const e = byPlan.get(key) || { total: 0, cancelled: 0 };
      e.total += 1;
      if (m.isCancelled) e.cancelled += 1;
      byPlan.set(key, e);
    });
    return Array.from(byPlan.entries())
      .map(([plan, e]) => ({
        plan,
        total: e.total,
        cancelled: e.cancelled,
        rate: e.total > 0 ? Math.round((e.cancelled / e.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [normalized]);

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
      monthLabel: format(new Date(2000, idx, 1), 'MMM'),
      count,
      pct: Math.round((count / max) * 100),
    }));
  }, [normalized]);

  // ── Chart 5: Tenure-at-cancellation histogram ────────────────
  // Where in the funnel members die. 0-1mo / 1-3mo / 3-6mo / 6-12mo / 12mo+.
  // Tells the owner if the bleed is onboarding (early death) vs retention
  // (long-tenured cancellations).
  const tenureHistogram = useMemo(() => {
    const buckets = [
      { label: '0–1 mo', from: 0, to: 1, count: 0 },
      { label: '1–3 mo', from: 1, to: 3, count: 0 },
      { label: '3–6 mo', from: 3, to: 6, count: 0 },
      { label: '6–12 mo', from: 6, to: 12, count: 0 },
      { label: '12+ mo', from: 12, to: Infinity, count: 0 },
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
  }, [normalized]);

  const totalCancellations = normalized.filter((m) => m.isCancelled).length;
  const totalEver = normalized.length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/platform/gym/${gymId}`)}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[#6B7280] mb-0.5 flex items-center gap-1.5">
            <Microscope size={11} />
            Retention diagnostic
          </p>
          <h1 className="text-[18px] font-bold text-[#E5E7EB] truncate">
            {gym?.name || 'Gym'}
          </h1>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[#6B7280]">Members analyzed</p>
          <p className="text-[15px] font-bold text-[#E5E7EB] tabular-nums">{totalEver.toLocaleString()}</p>
        </div>
      </div>

      {isLoading && (
        <p className="text-center py-12 text-[#9CA3AF] text-[12px]">Loading historical data…</p>
      )}

      {!isLoading && totalEver === 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-10 text-center">
          <p className="text-[14px] font-bold text-[#E5E7EB] mb-1">No member data yet</p>
          <p className="text-[12px] text-[#9CA3AF]">Import a historical roster first to see the diagnostic.</p>
        </div>
      )}

      {!isLoading && totalEver > 0 && (
        <div className="space-y-5">
          {/* Headline KPIs row */}
          <FadeIn>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <BigStat
                label="Total members ever"
                value={totalEver.toLocaleString()}
                icon={Activity}
              />
              <BigStat
                label="Total cancelled"
                value={totalCancellations.toLocaleString()}
                sub={`${Math.round((totalCancellations / totalEver) * 100)}% lifetime`}
                icon={TrendingDown}
                accent="amber"
              />
              <BigStat
                label="Avg tenure"
                value={avgTenure ? `${avgTenure.months} mo` : '—'}
                icon={Clock}
                accent="emerald"
              />
              <BigStat
                label="Plans tracked"
                value={planMortality.length}
                icon={Calendar}
              />
            </div>
          </FadeIn>

          {/* (1) Cohort retention heatmap */}
          {cohortGrid && cohortGrid.rows.length > 0 && (
            <FadeIn delay={40}>
              <ChartCard
                title="Cohort retention curve"
                subtitle="Each row is a join-month cohort. Cell = % still non-cancelled N months in. Darker emerald = better retention."
              >
                <CohortHeatmap data={cohortGrid} />
              </ChartCard>
            </FadeIn>
          )}

          {/* (2,5) Two-column row: Plan mortality + Tenure histogram */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <FadeIn delay={80}>
              <ChartCard
                title="Plan mortality"
                subtitle="Of members ever enrolled in each plan, what fraction eventually cancelled."
              >
                {planMortality.length === 0 ? (
                  <Empty label="No plan data in imported records." />
                ) : (
                  <PlanMortalityChart rows={planMortality} />
                )}
              </ChartCard>
            </FadeIn>

            <FadeIn delay={120}>
              <ChartCard
                title="Tenure at cancellation"
                subtitle="Where in the funnel cancellations happen. Heavy 0–3mo = onboarding leak. Heavy 12mo+ = late churn."
              >
                {totalCancellations === 0 ? (
                  <Empty label="No cancellations on record yet." />
                ) : (
                  <TenureHistogramChart buckets={tenureHistogram} />
                )}
              </ChartCard>
            </FadeIn>
          </div>

          {/* (4) Seasonality */}
          <FadeIn delay={160}>
            <ChartCard
              title="Cancellation seasonality"
              subtitle="Which calendar months bleed most, across all years on record."
            >
              {totalCancellations === 0 ? (
                <Empty label="No cancellations on record yet." />
              ) : (
                <SeasonalityChart bars={seasonality} />
              )}
            </ChartCard>
          </FadeIn>

          {/* Footnote */}
          <p className="text-[11px] text-[#6B7280] text-center mt-4">
            Diagnostic includes all imported members (active + archived) and live signups. Cancellation date sources: imported legacy date for archived members, in-app cancel timestamp for live cancellations.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Layout helpers ────────────────────────────────────────────
function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-5">
      <p className="text-[14px] font-bold text-[#E5E7EB]">{title}</p>
      <p className="text-[11px] text-[#9CA3AF] mt-0.5 mb-4 leading-relaxed">{subtitle}</p>
      {children}
    </div>
  );
}

function BigStat({ label, value, sub, icon: Icon, accent }) {
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
    </div>
  );
}

function Empty({ label }) {
  return <p className="text-center py-8 text-[12px] text-[#6B7280]">{label}</p>;
}

// ── Cohort heatmap ─────────────────────────────────────────────
function CohortHeatmap({ data }) {
  const { rows, maxOffset } = data;
  return (
    <div className="overflow-x-auto">
      <table className="text-[10.5px] w-full">
        <thead>
          <tr>
            <th className="px-1.5 py-1.5 text-left text-[#9CA3AF] font-semibold sticky left-0 bg-[#0F172A]">Cohort</th>
            <th className="px-1.5 py-1.5 text-right text-[#9CA3AF] font-semibold">Size</th>
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
                    title={`${survivors} of ${r.size} survived`}
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
