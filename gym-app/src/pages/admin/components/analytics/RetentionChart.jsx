import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
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

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] font-semibold text-[var(--color-text-primary)] min-w-0 flex-1 truncate">{t('admin.analytics.retentionTitle', 'Retention Rate')}</p>
        <button
          onClick={handleExport}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-white/15 transition-colors whitespace-nowrap"
        >
          <Download size={13} />
          {t('admin.analytics.export', 'Export')}
        </button>
      </div>
      {retentionData.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-10">{t('admin.analytics.retentionEmpty', 'No member data yet')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={retentionData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-[var(--color-bg-card)] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
                    {label && <p className="text-[var(--color-text-muted)] text-[11px] mb-1">{label}</p>}
                    <p className="font-semibold text-[#10B981]">{t('admin.analytics.retentionTooltip', { pct: d.retention, retained: d.retained, total: d.total, defaultValue: 'Retained: {{pct}}% ({{retained}} / {{total}})' })}</p>
                  </div>
                );
              }}
              cursor={{ fill: 'var(--color-accent-glow)' }}
            />
            <ReferenceLine y={BENCHMARKS.retentionRate} stroke="var(--color-accent)" strokeDasharray="6 4" strokeOpacity={0.5} label={{ value: t('admin.analytics.industryAvg', { value: BENCHMARKS.retentionRate, defaultValue: 'Industry avg {{value}}%' }), position: 'right', fill: 'var(--color-accent)', fontSize: 10, opacity: 0.7 }} />
            <Bar dataKey="retention" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      )}
      <p className="text-[10px] text-[var(--color-text-subtle)] mt-2">{t('admin.analytics.retentionFooter', 'Of members who existed at month start, % still active')}</p>
    </AdminCard>
  );
}
