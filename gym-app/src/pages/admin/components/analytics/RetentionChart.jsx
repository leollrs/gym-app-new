import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { subDays, addDays } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { BENCHMARKS } from '../../../../lib/benchmarks';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, ChartCard, LineChart } from './analyticsKit';

/**
 * True when an RPC failed *because the function isn't on this database* —
 * PGRST202 is PostgREST "not found in the schema cache", 42883 is Postgres
 * "function does not exist", and some gateways surface a bare 404. Any other
 * error (including the RPC's own "Access denied: gym boundary violation") is a
 * real failure and must propagate to the ErrorCard.
 *
 * Why we need this at all: the app ships to web AND to installed native
 * builds, so a client running against a DB without migration 0649 — an old
 * install, or a rolled-back database — must degrade to the legacy path rather
 * than white-screening the whole analytics page.
 */
const isRpcMissing = (err) => {
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  if (err.status === 404 || err.statusCode === 404) return true;
  return /could not find .*function|schema cache/i.test(err.message || '');
};

/**
 * Pooled retention SURVIVAL CURVE. x = tenure month (0 = first 30 days),
 * y = % of members who logged ≥1 completed workout in that window, pooled
 * across every member whose window has fully elapsed. Signup-relative,
 * activity-based — `membership_status` is never read. `monthsBack` controls
 * how many tenure months to plot ('All' → 12).
 *
 * Aggregated SERVER-SIDE by `admin_retention_curve` (migration 0649). It has
 * to be: PostgREST clamps every response to max_rows (1000 here — verified in
 * prod), and `.limit()` cannot raise that, so the legacy client path below
 * pooled a truncated slice of members *and* of sessions and rendered a
 * confident, specific, WRONG number — measured at ~2-6% for a 1,500-member
 * gym whose real curve sits around 60-70%. The SQL mirrors the JS below
 * one-for-one (same 30-day windows, same "fully elapsed" eligibility rule,
 * same membership_status blindness), so the chart shape never changes.
 */
async function fetchRetentionCurve(gymId, monthsBack, t) {
  const horizon = monthsBack || 12;

  const { data: rows, error } = await supabase.rpc('admin_retention_curve', {
    p_gym_id: gymId,
    p_months: horizon,
  });

  if (!error) {
    // The SQL only emits fully-elapsed windows and eligibility is monotonically
    // decreasing in tenure, so its rows are exactly the contiguous prefix the
    // legacy `if (eligible === 0) break` produced — no re-truncation needed.
    return (rows || []).map((r) => {
      const offset = Number(r.offset_month);
      const eligible = Number(r.eligible) || 0;
      const retained = Number(r.retained) || 0;
      return {
        label: t('admin.analytics.tenureMonth', { n: offset, defaultValue: `Mo ${offset}` }),
        offset,
        retention: eligible > 0 ? Math.round((retained / eligible) * 100) : 0,
        retained,
        eligible,
      };
    });
  }

  if (!isRpcMissing(error)) throw error;
  return fetchRetentionCurveClientSide(gymId, monthsBack, t);
}

/**
 * LEGACY fallback — the original in-browser aggregation, kept verbatim so a
 * client on a pre-0649 database still renders a curve (truncated at max_rows,
 * i.e. under-reported, but never a crash). Do not delete: it is the only path
 * an old installed native build has.
 */
async function fetchRetentionCurveClientSide(gymId, monthsBack, t) {
  const now = new Date();
  const horizon = monthsBack || 12;
  const fromIso = subDays(now, horizon * 30).toISOString();

  const { data: members, error } = await supabase
    .from('profiles')
    .select('id, created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('imported_archived', false)
    .gte('created_at', fromIso);
  if (error) throw error;

  const { data: sessions, error: sErr } = await supabase
    .from('workout_sessions')
    .select('profile_id, started_at')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', fromIso);
  if (sErr) throw sErr;

  const byProfile = {};
  (sessions || []).forEach((s) => { (byProfile[s.profile_id] ||= []).push(new Date(s.started_at)); });

  const points = [];
  for (let offset = 0; offset < horizon; offset++) {
    let eligible = 0;
    let retained = 0;
    for (const m of members || []) {
      const join = new Date(m.created_at);
      const wStart = addDays(join, offset * 30);
      const wEnd = addDays(join, (offset + 1) * 30);
      if (wEnd > now) continue;
      eligible++;
      const ds = byProfile[m.id] || [];
      if (ds.some((d) => d >= wStart && d <= wEnd)) retained++;
    }
    if (eligible === 0) break;
    points.push({
      label: t('admin.analytics.tenureMonth', { n: offset, defaultValue: `Mo ${offset}` }),
      offset,
      retention: Math.round((retained / eligible) * 100),
      retained,
      eligible,
    });
  }

  return points;
}

function RetentionChart({ gymId, monthsBack }) {
  const { t } = useTranslation('pages');
  const { data: curve = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...adminKeys.analytics.retention(gymId), 'survival', monthsBack ?? 'all'],
    queryFn: () => fetchRetentionCurve(gymId, monthsBack, t),
    enabled: !!gymId,
  });

  const handleExport = () => {
    exportCSV({
      filename: 'retention-curve',
      columns: [
        { key: 'label', label: t('admin.analytics.retentionExportTenure', 'Tenure month') },
        { key: 'retention', label: t('admin.analytics.retentionExportPct', 'Retention %') },
        { key: 'retained', label: t('admin.analytics.retentionExportRetained', 'Retained') },
        { key: 'eligible', label: t('admin.analytics.retentionExportEligible', 'Eligible') },
      ],
      data: curve,
    });
  };

  if (isLoading) return <CardSkeleton />;
  if (isError) return <ErrorCard message={t('admin.analytics.retentionError', 'Failed to load retention data')} onRetry={refetch} />;

  const m1 = curve.find((p) => p.offset === 1);
  const m0 = curve.find((p) => p.offset === 0);
  const headline = m1 ?? m0;
  const headlinePct = headline?.retention ?? 0;
  const headlineLabel = t(m1 ? 'admin.analytics.retentionM1' : 'admin.analytics.retentionM0', m1 ? 'month-1 retention' : 'month-0 retention');

  const data = curve.map(p => p.retention);
  const labels = curve.length
    ? [curve[0].label, curve[Math.floor((curve.length - 1) / 2)].label, curve[curve.length - 1].label]
    : [];

  return (
    <ChartCard
      title={t('admin.analytics.retentionTitle', 'Retention Curve')}
      subtitle={t('admin.analytics.retentionCurveFooter', '% of members still working out, by months since they joined')}
      big={`${headlinePct}%`}
      bigColor="var(--color-success)"
      bigSub={headlineLabel}
      onExport={handleExport}
      exportLabel={t('admin.analytics.export', 'Export')}
    >
      {curve.length === 0 ? (
        <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '40px 0' }}>{t('admin.analytics.retentionEmpty', 'No member data yet')}</p>
      ) : (
        <LineChart data={data} xLabels={labels} pointLabels={curve.map(p => p.label)} color="var(--color-success)" max={100} unit="%" target={BENCHMARKS.retentionRate} height={230} />
      )}
    </ChartCard>
  );
}

export default React.memo(RetentionChart);
