import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Download } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchActivityData(gymId) {
  const now = new Date();

  const { data: allMembers, error: actMemError } = await supabase
    .from('profiles')
    .select('id, created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member');
  if (actMemError) throw actMemError;

  const members = allMembers || [];
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(now, i));
    const monthEnd   = endOfMonth(subMonths(now, i));

    const totalThatMonth = members.filter(m => new Date(m.created_at) <= monthEnd).length;

    const { data: sessions, error: sessError } = await supabase
      .from('workout_sessions')
      .select('profile_id')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .gte('started_at', monthStart.toISOString())
      .lte('started_at', monthEnd.toISOString());

    if (sessError) throw sessError;
    const uniqueActive = new Set((sessions || []).map(s => s.profile_id)).size;
    const pct = totalThatMonth > 0 ? Math.round((uniqueActive / totalThatMonth) * 100) : 0;

    months.push({
      month: format(subMonths(now, i), 'MMM yy'),
      engagement: pct,
      active: uniqueActive,
      total: totalThatMonth,
    });
  }

  return months;
}

export default function ActivityChart({ gymId }) {
  const { t } = useTranslation('pages');
  const { data: activityData = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.activity(gymId),
    queryFn: () => fetchActivityData(gymId),
    enabled: !!gymId,
  });

  const handleExport = () => {
    exportCSV({
      filename: 'engagement',
      columns: [
        { key: 'month', label: t('admin.analytics.engagementExportMonth', 'Month') },
        { key: 'engagement', label: t('admin.analytics.engagementExportPct', 'Engagement %') },
        { key: 'active', label: t('admin.analytics.engagementExportActive', 'Active') },
        { key: 'total', label: t('admin.analytics.engagementExportTotal', 'Total Members') },
      ],
      data: activityData,
    });
  };

  if (isLoading) return <CardSkeleton h="h-[260px]" />;
  if (isError) return <ErrorCard message={t('admin.analytics.engagementError', 'Failed to load engagement data')} onRetry={refetch} />;

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">{t('admin.analytics.engagementTitle', 'Engagement')}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">{t('admin.analytics.engagementSubtitle', '% of signed members who logged ≥1 workout that month')}</p>
        </div>
        <button
          onClick={handleExport}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-white/15 transition-colors whitespace-nowrap"
        >
          <Download size={13} />
          {t('admin.analytics.export', 'Export')}
        </button>
      </div>
      {activityData.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-10">{t('admin.analytics.engagementEmpty', 'No session data yet')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={activityData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-[var(--color-bg-card)] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
                    {label && <p className="text-[var(--color-text-muted)] text-[11px] mb-1">{label}</p>}
                    <p className="font-semibold text-[#3B82F6]">{t('admin.analytics.engagementTooltip', { pct: d.engagement, active: d.active, total: d.total, defaultValue: 'Engaged: {{pct}}% ({{active}} / {{total}})' })}</p>
                  </div>
                );
              }}
              cursor={{ fill: 'var(--color-accent-glow)' }}
            />
            <Bar dataKey="engagement" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </AdminCard>
  );
}
