import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { exportCSV } from '../../../../lib/csvExport';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, ChartCard, LineChart } from './analyticsKit';

async function fetchActivityData(gymId, dateFnsLocale, span) {
  const now = new Date();
  const windowStart = startOfMonth(subMonths(now, span - 1));

  const [membersRes, sessionsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, created_at')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .eq('imported_archived', false),
    supabase
      .from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .gte('started_at', windowStart.toISOString()),
  ]);
  if (membersRes.error) throw membersRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const members = membersRes.data || [];
  const sessions = sessionsRes.data || [];
  const months = [];

  for (let i = span - 1; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(now, i));
    const monthEnd = endOfMonth(subMonths(now, i));
    const totalThatMonth = members.filter(m => new Date(m.created_at) <= monthEnd).length;
    const activeIds = new Set();
    for (const s of sessions) {
      const ts = new Date(s.started_at);
      if (ts >= monthStart && ts <= monthEnd) activeIds.add(s.profile_id);
    }
    const uniqueActive = activeIds.size;
    const pct = totalThatMonth > 0 ? Math.round((uniqueActive / totalThatMonth) * 100) : 0;
    months.push({
      month: format(subMonths(now, i), 'MMM yy', dateFnsLocale),
      engagement: pct,
      active: uniqueActive,
      total: totalThatMonth,
    });
  }

  return months;
}

function ActivityChart({ gymId, monthsBack }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : {};
  const span = monthsBack || 6; // 'All' (null) caps at 6 months for engagement
  const { data: activityData = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...adminKeys.analytics.activity(gymId), i18n.language, span],
    queryFn: () => fetchActivityData(gymId, dateFnsLocale, span),
    enabled: !!gymId,
    staleTime: 5 * 60_000,
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

  const latestEngagement = activityData.length > 0 ? activityData[activityData.length - 1].engagement : 0;
  const latestActive = activityData.length > 0 ? activityData[activityData.length - 1].active : 0;
  const data = activityData.map(d => d.engagement);
  const labels = activityData.length
    ? [activityData[0].month, activityData[Math.floor((activityData.length - 1) / 2)].month, activityData[activityData.length - 1].month]
    : [];

  return (
    <ChartCard
      title={t('admin.analytics.engagementTitle', 'Engagement')}
      subtitle={t('admin.analytics.engagementSubtitle', '% of signed members who logged ≥1 workout that month')}
      big={`${latestEngagement}%`}
      bigColor="var(--color-info)"
      bigSub={t('admin.analytics.engagementCurrent', { active: latestActive, defaultValue: '{{active}} active this month' })}
      onExport={handleExport}
      exportLabel={t('admin.analytics.export', 'Export')}
    >
      {activityData.length === 0 ? (
        <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '40px 0' }}>{t('admin.analytics.engagementEmpty', 'No session data yet')}</p>
      ) : (
        <LineChart data={data} xLabels={labels} pointLabels={activityData.map(d => d.month)} color="var(--color-info)" max={100} unit="%" height={220} />
      )}
    </ChartCard>
  );
}

export default React.memo(ActivityChart);
