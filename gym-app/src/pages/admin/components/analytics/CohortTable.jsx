import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

const cohortCellStyle = (pct) => {
  if (pct === null) return { bg: 'bg-white/[0.03]', text: 'text-[var(--color-text-subtle)]' };
  if (pct >= 70)   return { bg: 'bg-emerald-500/15', text: 'text-emerald-400' };
  if (pct >= 40)   return { bg: 'bg-amber-500/15',   text: 'text-amber-400' };
  return                  { bg: 'bg-red-500/15',     text: 'text-red-400' };
};

async function fetchCohortData(gymId) {
  const now = new Date();
  const from = subMonths(startOfMonth(now), 5).toISOString();

  const { data: members, error: cohMemError } = await supabase
    .from('profiles')
    .select('id, created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .gte('created_at', from);
  if (cohMemError) throw cohMemError;

  const { data: sessions, error: cohSessError } = await supabase
    .from('workout_sessions')
    .select('profile_id, started_at')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', from);
  if (cohSessError) throw cohSessError;

  const sessionsByProfile = {};
  (sessions || []).forEach(s => {
    if (!sessionsByProfile[s.profile_id]) sessionsByProfile[s.profile_id] = [];
    sessionsByProfile[s.profile_id].push(new Date(s.started_at));
  });

  const cohortMap = {};
  (members || []).forEach(m => {
    const joinMonth = format(new Date(m.created_at), 'MMM yy');
    if (!cohortMap[joinMonth]) cohortMap[joinMonth] = [];
    cohortMap[joinMonth].push(m);
  });

  const rows = [];
  for (let i = 5; i >= 0; i--) {
    const cohortMonthDate = subMonths(now, i);
    const label           = format(cohortMonthDate, 'MMM yy');
    const cohortMembers   = cohortMap[label] || [];
    const cohortSize      = cohortMembers.length;

    const monthRetention = [0, 1, 2, 3].map(offset => {
      const targetMonth      = subMonths(now, i - offset);
      const targetMonthIndex = i - offset;
      if (targetMonthIndex < 0) return null;

      const targetStart = startOfMonth(targetMonth);
      const targetEnd   = endOfMonth(targetMonth);

      if (cohortSize === 0) return null;

      const activeCount = cohortMembers.filter(m => {
        const memberSessions = sessionsByProfile[m.id] || [];
        return memberSessions.some(d => d >= targetStart && d <= targetEnd);
      }).length;

      return Math.round((activeCount / cohortSize) * 100);
    });

    rows.push({ label, cohortSize, m0: monthRetention[0], m1: monthRetention[1], m2: monthRetention[2], m3: monthRetention[3] });
  }

  return rows;
}

export default function CohortTable({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: cohortData = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.cohort(gymId),
    queryFn: () => fetchCohortData(gymId),
    enabled: !!gymId,
  });

  const handleExport = () => {
    exportCSV({
      filename: 'cohort-retention',
      columns: [
        { key: 'label', label: t('admin.analytics.cohortExportCohort', 'Cohort') },
        { key: 'cohortSize', label: t('admin.analytics.cohortExportSize', 'Size') },
        { key: 'm0', label: t('admin.analytics.cohortMonth', { n: 0, defaultValue: 'Month {{n}}' }) },
        { key: 'm1', label: t('admin.analytics.cohortMonth', { n: 1, defaultValue: 'Month {{n}}' }) },
        { key: 'm2', label: t('admin.analytics.cohortMonth', { n: 2, defaultValue: 'Month {{n}}' }) },
        { key: 'm3', label: t('admin.analytics.cohortMonth', { n: 3, defaultValue: 'Month {{n}}' }) },
      ],
      data: cohortData,
    });
  };

  if (isLoading) return <CardSkeleton h="h-[260px]" />;
  if (isError) return <ErrorCard message={t('admin.analytics.cohortError', 'Failed to load cohort data')} onRetry={refetch} />;

  // Headline: latest cohort m0 retention
  const latestCohort = cohortData.length > 0 ? cohortData[cohortData.length - 1] : null;
  const headlineRetention = latestCohort?.m0 ?? 0;

  return (
    <AdminCard hover className="overflow-x-auto hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-1">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight truncate">{t('admin.analytics.cohortTitle', 'Cohort Retention')}</p>
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
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-[24px] font-bold text-[var(--color-accent)] leading-none tracking-tight">{headlineRetention}%</span>
        <span className="text-[11px] text-[var(--color-text-muted)]">{t('admin.analytics.cohortHeadline', 'latest cohort, month 0')}</span>
      </div>

      <p className="text-[11px] text-[var(--color-text-muted)] mb-5 leading-relaxed">{t('admin.analytics.cohortDesc', 'Each row is a group of members who joined in the same month. Month 0 = their first month, Month 1 = second month, etc. The percentage shows how many are still working out.')}</p>
      {cohortData.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-10">{t('admin.analytics.cohortEmpty', 'No cohort data yet')}</p>
      ) : (
        <div className="min-w-[480px]">
          {/* Header row */}
          <div className="grid grid-cols-[140px_60px_1fr_1fr_1fr_1fr] gap-2.5 mb-3">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('admin.analytics.cohortHeader', 'Cohort')}</span>
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider text-right">{t('admin.analytics.cohortSize', 'Size')}</span>
            {[0, 1, 2, 3].map(n => (
              <span key={n} className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider text-center">{t('admin.analytics.cohortMonth', { n, defaultValue: 'Month {{n}}' })}</span>
            ))}
          </div>

          {/* Data rows */}
          <div className="space-y-2">
            {cohortData.map(row => (
              <div key={row.label} className="grid grid-cols-[140px_60px_1fr_1fr_1fr_1fr] gap-2.5 items-center">
                <span className="text-[13px] text-[var(--color-text-primary)] font-medium">{row.label}</span>
                <span className="text-[12px] text-[var(--color-text-muted)] text-right tabular-nums">{row.cohortSize}</span>
                {[row.m0, row.m1, row.m2, row.m3].map((pct, idx) => {
                  const style = cohortCellStyle(pct);
                  return (
                    <div key={idx} className={`rounded-lg px-2 py-2 text-center ${style.bg} transition-colors`}>
                      <span className={`text-[12px] font-semibold tabular-nums ${style.text}`}>
                        {pct === null ? '\u2014' : `${pct}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-5 flex-wrap">
            {[
              { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: t('admin.analytics.cohortLegendStrong', '≥70% — Strong') },
              { bg: 'bg-amber-500/15',   text: 'text-amber-400',   label: t('admin.analytics.cohortLegendModerate', '40–70% — Moderate') },
              { bg: 'bg-red-500/15',     text: 'text-red-400',     label: t('admin.analytics.cohortLegendLow', '<40% — Low') },
            ].map(({ bg, text, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded ${bg}`} />
                <span className={`text-[10px] font-medium ${text}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminCard>
  );
}
