import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
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

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] font-semibold text-[#E5E7EB] min-w-0 flex-1 truncate">{t('admin.analytics.growthTitle', 'Member Growth')}</p>
        <button
          onClick={handleExport}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap"
        >
          <Download size={13} />
          {t('admin.analytics.export', 'Export')}
        </button>
      </div>
      {growthData.length === 0 ? (
        <p className="text-[13px] text-[#6B7280] text-center py-10">{t('admin.analytics.growthEmpty', 'No member data yet')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={growthData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--color-accent)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
              tickLine={false}
              axisLine={false}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-accent-glow)' }} />
            <Area
              type="monotone"
              dataKey="count"
              name={t('admin.analytics.newMembersChartName', 'New members')}
              stroke="var(--color-accent)"
              strokeWidth={2}
              fill="url(#growthGrad)"
              dot={false}
              activeDot={{ r: 6, strokeWidth: 2 }}
              animationDuration={1200}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
      <p className="text-[10px] text-[#4B5563] mt-2">{t('admin.analytics.growthFooter', 'New signups per month — last 12 months')}</p>
    </AdminCard>
  );
}
