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

/**
 * True when an RPC failed *because the function isn't on this database* —
 * PGRST202 is PostgREST "not found in the schema cache", 42883 is Postgres
 * "function does not exist", and some gateways surface a bare 404. Anything
 * else (including the RPC's own "Access denied: gym boundary violation") is a
 * real failure and must propagate to the ErrorCard.
 *
 * The app ships to web AND to installed native builds, so a client running
 * against a DB without migration 0649 — an old install, or a rolled-back
 * database — has to degrade to the legacy path, not white-screen the page.
 */
const isRpcMissing = (err) => {
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  if (err.status === 404 || err.statusCode === 404) return true;
  return /could not find .*function|schema cache/i.test(err.message || '');
};

/**
 * Monthly engagement: roster size at each month's end vs. the number of those
 * members who logged ≥1 completed workout that month.
 *
 * Aggregated SERVER-SIDE by `admin_activity_engagement` (migration 0649).
 * PostgREST clamps every response to max_rows (1000 here — verified in prod)
 * and `.limit()` cannot raise it, so the legacy client path below counted a
 * truncated roster against a truncated session list: ~15-25% displayed for a
 * gym actually running ~60%. The SQL mirrors the JS windows exactly, so the
 * series handed to LineChart keeps its shape.
 */
async function fetchActivityData(gymId, dateFnsLocale, span) {
  const { data: rows, error } = await supabase.rpc('admin_activity_engagement', {
    p_gym_id: gymId,
    p_months: span,
  });

  if (!error) {
    // month_start comes back as a bare DATE ('2026-07-01'). `new Date()` would
    // read that as UTC midnight and render the PREVIOUS month for anyone west
    // of UTC (this gym is UTC-4), so pin it to local midnight — the same
    // `+ 'T00:00:00'` convention used across the admin date code.
    return (rows || []).map((r) => {
      const total = Number(r.total_members) || 0;
      const active = Number(r.active_members) || 0;
      return {
        month: format(new Date(`${String(r.month_start).slice(0, 10)}T00:00:00`), 'MMM yy', dateFnsLocale),
        engagement: total > 0 ? Math.round((active / total) * 100) : 0,
        active,
        total,
      };
    });
  }

  if (!isRpcMissing(error)) throw error;
  return fetchActivityDataClientSide(gymId, dateFnsLocale, span);
}

/**
 * LEGACY fallback — the original in-browser aggregation, kept verbatim so a
 * client on a pre-0649 database still renders a series (truncated at max_rows,
 * i.e. under-reported, but never a crash). Do not delete: it is the only path
 * an old installed native build has.
 */
async function fetchActivityDataClientSide(gymId, dateFnsLocale, span) {
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
