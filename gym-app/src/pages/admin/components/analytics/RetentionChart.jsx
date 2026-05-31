import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { Download } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { subDays, addDays } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { BENCHMARKS } from '../../../../lib/benchmarks';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

/**
 * Pooled retention SURVIVAL CURVE.
 *
 * x-axis = tenure month (0 = first 30 days after joining, 1 = days 30-59, …).
 * y-axis = % of members who logged ≥1 completed workout during that tenure
 * window, pooled across every member whose window has fully elapsed.
 *
 * This replaced the old "retention" definition (% of members not CURRENTLY
 * cancelled/banned) which applied today's status to historical populations and
 * ignored deleted-on-cancel rows — systematically overstating retention. This is
 * the same signup-relative, activity-based methodology CohortTable uses per
 * cohort, pooled here into one headline curve. `membership_status` is never read.
 *
 * `monthsBack` (from the page period selector) controls how many tenure months
 * to plot; 'All' (null) caps at 12 to keep the query bounded.
 */
async function fetchRetentionCurve(gymId, monthsBack, t) {
  const now = new Date();
  const horizon = monthsBack || 12;          // tenure months to plot ('All' → 12)
  const fromIso = subDays(now, horizon * 30).toISOString();

  // Members who joined within the horizon — at least their M0 window is
  // observable, and every tenure window we score falls inside [from, now].
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
  (sessions || []).forEach((s) => {
    (byProfile[s.profile_id] ||= []).push(new Date(s.started_at));
  });

  const points = [];
  for (let offset = 0; offset < horizon; offset++) {
    let eligible = 0;
    let retained = 0;
    for (const m of members || []) {
      const join = new Date(m.created_at);
      const wStart = addDays(join, offset * 30);
      const wEnd = addDays(join, (offset + 1) * 30);
      if (wEnd > now) continue;               // window hasn't fully elapsed yet
      eligible++;
      const ds = byProfile[m.id] || [];
      if (ds.some((d) => d >= wStart && d <= wEnd)) retained++;
    }
    // Stop at the first tenure month with no eligible members (older windows
    // would also be empty) — avoids a flat zero tail.
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

  // Headline: month-1 retention (the standard "do they come back" number);
  // fall back to month-0 if only one window has elapsed.
  const m1 = curve.find((p) => p.offset === 1);
  const m0 = curve.find((p) => p.offset === 0);
  const headline = m1 ?? m0;
  const headlinePct = headline?.retention ?? 0;
  const headlineLabelKey = m1 ? 'admin.analytics.retentionM1' : 'admin.analytics.retentionM0';
  const headlineLabel = t(headlineLabelKey, m1 ? 'month-1 retention' : 'month-0 retention');

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight truncate">{t('admin.analytics.retentionTitle', 'Retention Curve')}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{t('admin.analytics.retentionCurveFooter', '% of members still working out, by months since they joined')}</p>
        </div>
        <button
          onClick={handleExport}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-white/15 transition-colors whitespace-nowrap"
        >
          <Download size={13} />
          {t('admin.analytics.export', 'Export')}
        </button>
      </div>

      {/* Headline metric */}
      <div className="flex items-baseline gap-3 mb-5">
        <span className="text-[28px] font-bold text-[#34D399] leading-none tracking-tight">{headlinePct}%</span>
        <span className="text-[12px] text-[var(--color-text-muted)]">{headlineLabel}</span>
      </div>

      {curve.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-10">{t('admin.analytics.retentionEmpty', 'No member data yet')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={curve} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="retentionGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(255,255,255,0.04))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontWeight: 500 }}
              tickLine={false}
              axisLine={false}
              dy={6}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontWeight: 500 }}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              tickFormatter={v => `${v}%`}
              width={36}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle,rgba(255,255,255,0.08))] rounded-2xl px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-sm text-[12px]">
                    {label && <p className="text-[var(--color-text-muted)] text-[10px] font-medium uppercase tracking-wider mb-1.5 opacity-70">{label}</p>}
                    <p className="font-semibold text-[#34D399]">{t('admin.analytics.retentionTooltip', { pct: d.retention, retained: d.retained, total: d.eligible, defaultValue: 'Retained: {{pct}}% ({{retained}} / {{total}})' })}</p>
                  </div>
                );
              }}
              cursor={{ stroke: 'var(--color-success)', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.3 }}
            />
            <ReferenceLine
              y={BENCHMARKS.retentionRate}
              stroke="var(--color-accent)"
              strokeDasharray="6 4"
              strokeOpacity={0.35}
              label={{
                value: t('admin.analytics.industryAvg', { value: BENCHMARKS.retentionRate, defaultValue: 'Industry avg {{value}}%' }),
                position: 'right',
                fill: 'var(--color-accent)',
                fontSize: 9,
                fontWeight: 500,
                opacity: 0.6,
              }}
            />
            <Area
              type="monotone"
              dataKey="retention"
              stroke="var(--color-success)"
              strokeWidth={2.5}
              fill="url(#retentionGrad)"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, fill: 'var(--color-bg-card)', stroke: 'var(--color-success)' }}
              animationDuration={1000}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </AdminCard>
  );
}

export default React.memo(RetentionChart);
