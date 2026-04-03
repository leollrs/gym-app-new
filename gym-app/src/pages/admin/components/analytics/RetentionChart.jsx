import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { Download } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { BENCHMARKS } from '../../../../lib/benchmarks';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchRetentionData(gymId) {
  const now = new Date();

  const { data: allMembers, error } = await supabase
    .from('profiles')
    .select('id, created_at, membership_status')
    .eq('gym_id', gymId)
    .eq('role', 'member');
  if (error) throw error;

  const members = allMembers || [];
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(now, i));

    const startingMembers = members.filter(m => new Date(m.created_at) < monthStart);
    const starting = startingMembers.length;

    const retained = startingMembers.filter(m =>
      m.membership_status !== 'cancelled' && m.membership_status !== 'banned'
    ).length;

    const pct = starting > 0 ? Math.round((retained / starting) * 100) : 0;

    months.push({
      month: format(subMonths(now, i), 'MMM yy'),
      retention: pct,
      retained,
      total: starting,
    });
  }

  return months;
}

export default function RetentionChart({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: retentionData = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.retention(gymId),
    queryFn: () => fetchRetentionData(gymId),
    enabled: !!gymId,
  });

  const handleExport = () => {
    exportCSV({
      filename: 'retention',
      columns: [
        { key: 'month', label: t('admin.analytics.retentionExportMonth', 'Month') },
        { key: 'retention', label: t('admin.analytics.retentionExportPct', 'Retention %') },
        { key: 'retained', label: t('admin.analytics.retentionExportRetained', 'Retained') },
        { key: 'total', label: t('admin.analytics.retentionExportTotal', 'Total') },
      ],
      data: retentionData,
    });
  };

  if (isLoading) return <CardSkeleton />;
  if (isError) return <ErrorCard message={t('admin.analytics.retentionError', 'Failed to load retention data')} onRetry={refetch} />;

  // Headline metric
  const latestRetention = retentionData.length > 0 ? retentionData[retentionData.length - 1].retention : 0;
  const latestRetained = retentionData.length > 0 ? retentionData[retentionData.length - 1].retained : 0;

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight truncate">{t('admin.analytics.retentionTitle', 'Retention Rate')}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{t('admin.analytics.retentionFooter', 'Of members who existed at month start, % still active')}</p>
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
        <span className="text-[28px] font-bold text-[#34D399] leading-none tracking-tight">{latestRetention}%</span>
        <span className="text-[12px] text-[var(--color-text-muted)]">{t('admin.analytics.retentionCurrent', { retained: latestRetained, defaultValue: '{{retained}} retained this month' })}</span>
      </div>

      {retentionData.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-10">{t('admin.analytics.retentionEmpty', 'No member data yet')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={retentionData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="retentionGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34D399" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(255,255,255,0.04))" vertical={false} />
            <XAxis
              dataKey="month"
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
                    <p className="font-semibold text-[#34D399]">{t('admin.analytics.retentionTooltip', { pct: d.retention, retained: d.retained, total: d.total, defaultValue: 'Retained: {{pct}}% ({{retained}} / {{total}})' })}</p>
                  </div>
                );
              }}
              cursor={{ stroke: '#34D399', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.3 }}
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
              stroke="#34D399"
              strokeWidth={2.5}
              fill="url(#retentionGrad)"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, fill: 'var(--color-bg-card)', stroke: '#34D399' }}
              animationDuration={1000}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </AdminCard>
  );
}
