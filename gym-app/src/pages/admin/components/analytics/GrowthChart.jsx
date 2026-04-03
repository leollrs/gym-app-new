import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { Download } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';
import ChartTooltip from '../../../../components/ChartTooltip';

async function fetchGrowthData(gymId) {
  const now = new Date();
  const from = subMonths(startOfMonth(now), 11).toISOString();

  const { data: members, error } = await supabase
    .from('profiles')
    .select('created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .gte('created_at', from);
  if (error) throw error;

  const monthMap = {};
  for (let i = 11; i >= 0; i--) {
    const label = format(subMonths(now, i), 'MMM yy');
    monthMap[label] = 0;
  }
  (members || []).forEach(m => {
    const label = format(new Date(m.created_at), 'MMM yy');
    if (label in monthMap) monthMap[label]++;
  });

  return Object.entries(monthMap).map(([month, count]) => ({ month, count }));
}

export default function GrowthChart({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: growthData = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.growth(gymId),
    queryFn: () => fetchGrowthData(gymId),
    enabled: !!gymId,
  });

  const handleExport = () => {
    exportCSV({
      filename: 'member-growth',
      columns: [
        { key: 'month', label: t('admin.analytics.growthExportMonth', 'Month') },
        { key: 'count', label: t('admin.analytics.growthExportNewMembers', 'New Members') },
      ],
      data: growthData,
    });
  };

  if (isLoading) return <CardSkeleton />;
  if (isError) return <ErrorCard message={t('admin.analytics.growthError', 'Failed to load growth data')} onRetry={refetch} />;

  // Headline: total new members across period
  const totalNewMembers = growthData.reduce((sum, d) => sum + d.count, 0);
  const latestMonthCount = growthData.length > 0 ? growthData[growthData.length - 1].count : 0;

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-tight truncate">{t('admin.analytics.growthTitle', 'Member Growth')}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{t('admin.analytics.growthFooter', 'New signups per month — last 12 months')}</p>
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
        <span className="text-[28px] font-bold text-[var(--color-accent)] leading-none tracking-tight">{totalNewMembers}</span>
        <span className="text-[12px] text-[var(--color-text-muted)]">{t('admin.analytics.growthTotal', { count: latestMonthCount, defaultValue: 'total — {{count}} this month' })}</span>
      </div>

      {growthData.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-10">{t('admin.analytics.growthEmpty', 'No member data yet')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={growthData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="var(--color-accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(255,255,255,0.04))" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontWeight: 500 }}
              tickLine={false}
              axisLine={false}
              interval={2}
              dy={6}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontWeight: 500 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={36}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.4 }} />
            <Area
              type="monotone"
              dataKey="count"
              name={t('admin.analytics.newMembersChartName', 'New members')}
              stroke="var(--color-accent)"
              strokeWidth={2.5}
              fill="url(#growthGrad)"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, fill: 'var(--color-bg-card)', stroke: 'var(--color-accent)' }}
              animationDuration={1200}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </AdminCard>
  );
}
