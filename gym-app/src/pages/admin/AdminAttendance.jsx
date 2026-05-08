import { Fragment, useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { Download, CalendarCheck, Dumbbell, Users, TrendingUp, Flame } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { exportCSV } from '../../lib/csvExport';
import { adminKeys } from '../../lib/adminQueryKeys';
import ChartTooltip from '../../components/ChartTooltip';
import {
  AdminPageShell,
  PageHeader,
  StatCard,
  AdminCard,
  FadeIn,
  CardSkeleton,
  ErrorCard,
} from '../../components/admin';

const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6am-8pm (15 hours)

const PERIOD_OPTIONS = [
  { key: '14', label: '14d' },
  { key: '30', label: '30d' },
  { key: '90', label: '90d' },
];

export default function AdminAttendance() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const [period, setPeriod] = useState('30');
  const DAYS = DAY_KEYS.map(k => t(`admin.attendance.${k}`, k.replace('day', '')));

  useEffect(() => {
    document.title = t('admin.attendance.pageTitle', `Admin - Attendance | ${window.__APP_NAME || 'TuGymPR'}`);
  }, [t]);

  // ── Fetch attendance data ──
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...adminKeys.attendance(gymId), period, i18n.language],
    enabled: !!gymId,
    queryFn: async () => {
      if (!gymId) return { sessions: [], checkIns: [] };
      const from = subDays(new Date(), parseInt(period)).toISOString();

      const [{ data: sessions }, { data: checkIns }] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('started_at')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', from)
          .order('started_at', { ascending: true })
          .limit(1000),
        supabase
          .from('check_ins')
          .select('profile_id, checked_in_at')
          .eq('gym_id', gymId)
          .gte('checked_in_at', from)
          .order('checked_in_at', { ascending: true })
          .limit(1000),
      ]);

      const sessionList = sessions || [];
      const checkInList = checkIns || [];

      // Daily trend
      const dayMap = {};
      const interval = eachDayOfInterval({ start: subDays(new Date(), parseInt(period)), end: new Date() });
      interval.forEach(d => { dayMap[format(d, 'MMM d', dateFnsLocale)] = { workouts: 0, checkins: 0 }; });
      sessionList.forEach(s => {
        const key = format(new Date(s.started_at), 'MMM d', dateFnsLocale);
        if (key in dayMap) dayMap[key].workouts++;
      });
      checkInList.forEach(c => {
        const key = format(new Date(c.checked_in_at), 'MMM d', dateFnsLocale);
        if (key in dayMap) dayMap[key].checkins++;
      });
      const dailyData = Object.entries(dayMap).map(([date, vals]) => ({ date, ...vals }));

      // Summary stats
      const uniqueVisitors = new Set(checkInList.map(c => c.profile_id)).size;
      const days = interval.length || 1;
      const summaryStats = {
        totalCheckins: checkInList.length,
        totalWorkouts: sessionList.length,
        uniqueVisitors,
        avgPerDay: (checkInList.length / days).toFixed(1),
      };

      // Heatmap — strictly check-ins. Previous behavior silently fell back to
      // workout sessions when there were no check-ins, but the heatmap label says
      // "Peak Hours" and admins were seeing workout data presented as check-in
      // data. If there are no check-ins, the heatmap stays empty (and the empty
      // state in the UI surfaces that honestly).
      const heat = {};
      checkInList.forEach(c => {
        const d = new Date(c.checked_in_at);
        const day = d.getDay();
        const dayIndex = (day === 0) ? 6 : day - 1;
        const key = `${dayIndex}-${d.getHours()}`;
        heat[key] = (heat[key] || 0) + 1;
      });

      // Compute deltas: compare second half of period to first half
      const midpoint = Math.floor(interval.length / 2);
      const firstHalfCheckins = dailyData.slice(0, midpoint).reduce((s, d) => s + d.checkins, 0);
      const secondHalfCheckins = dailyData.slice(midpoint).reduce((s, d) => s + d.checkins, 0);
      const firstHalfWorkouts = dailyData.slice(0, midpoint).reduce((s, d) => s + d.workouts, 0);
      const secondHalfWorkouts = dailyData.slice(midpoint).reduce((s, d) => s + d.workouts, 0);

      const calcDelta = (curr, prev) => {
        if (!prev) return curr > 0 ? 100 : 0;
        return Math.round(((curr - prev) / prev) * 100);
      };

      const deltas = {
        checkins: calcDelta(secondHalfCheckins, firstHalfCheckins),
        workouts: calcDelta(secondHalfWorkouts, firstHalfWorkouts),
      };

      // Find peak hour
      let peakKey = null;
      let peakVal = 0;
      Object.entries(heat).forEach(([key, val]) => {
        if (val > peakVal) { peakKey = key; peakVal = val; }
      });

      let peakSummary = null;
      if (peakKey) {
        const [dayIdx, hour] = peakKey.split('-').map(Number);
        peakSummary = { dayIdx, hour, count: peakVal };
      }

      return { dailyData, summaryStats, heatmap: heat, deltas, peakSummary };
    },
  });

  const dailyData = data?.dailyData ?? [];
  const summaryStats = data?.summaryStats ?? { totalCheckins: 0, totalWorkouts: 0, uniqueVisitors: 0, avgPerDay: 0 };
  const heatmap = data?.heatmap ?? {};
  const maxHeat = Math.max(1, ...Object.values(heatmap));
  const deltas = data?.deltas ?? { checkins: 0, workouts: 0 };
  const peakSummary = data?.peakSummary ?? null;

  const formatDelta = (val) => {
    if (val === 0) return null;
    const arrow = val > 0 ? '\u2191' : '\u2193';
    return `${arrow} ${Math.abs(val)}% ${t('admin.attendance.vsPrev', 'vs prev')}`;
  };

  const peakLabel = peakSummary
    ? (() => {
        const dayName = DAYS[peakSummary.dayIdx] || '';
        const h = peakSummary.hour;
        const hourStr = `${h > 12 ? h - 12 : h}${h >= 12 ? t('admin.attendance.pm', 'pm') : t('admin.attendance.am', 'am')}`;
        return `${t('admin.attendance.peak', 'Peak')} ${dayName} ${hourStr}`;
      })()
    : null;

  // Heat intensity bucket (0..4)
  const heatBucket = (val) => {
    if (!val) return 0;
    const intensity = val / maxHeat;
    if (intensity > 0.75) return 4;
    if (intensity > 0.5)  return 3;
    if (intensity > 0.25) return 2;
    return 1;
  };

  const heatBg = (bucket) => {
    if (bucket === 0) return 'var(--color-admin-panel)';
    if (bucket === 1) return 'color-mix(in srgb, var(--color-accent) 18%, transparent)';
    if (bucket === 2) return 'color-mix(in srgb, var(--color-accent) 38%, transparent)';
    if (bucket === 3) return 'color-mix(in srgb, var(--color-accent) 65%, transparent)';
    return 'var(--color-accent)';
  };

  const handleExport = () => {
    exportCSV({
      filename: 'attendance',
      columns: [
        { key: 'date', label: t('admin.attendance.date', 'Date') },
        { key: 'checkins', label: t('admin.attendance.checkins', 'Check-ins') },
        { key: 'workouts', label: t('admin.attendance.workoutsLabel', 'Workouts') },
      ],
      data: dailyData,
    });
  };

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.attendance.title', 'Attendance')}
        subtitle={t('admin.attendance.subtitle', 'Check-ins and workout activity')}
        actions={
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors min-h-[44px]"
            style={{
              border: '1px solid var(--color-admin-border)',
              color: 'var(--color-admin-text-sub)',
              background: 'var(--color-bg-card)',
            }}
            aria-label={t('admin.attendance.export', 'Export CSV')}
          >
            <Download size={13} />
            {t('admin.attendance.export', 'Export')}
          </button>
        }
      />

      {/* Period filter row */}
      <FadeIn>
        <div className="mt-5 mb-5 flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setPeriod(opt.key)}
              className={`admin-pill flex-shrink-0 ${period === opt.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
              style={{ cursor: 'pointer', minHeight: 44, padding: '0 16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {t(`admin.attendance.periodLabel.${opt.key}`, opt.label)}
            </button>
          ))}
        </div>
      </FadeIn>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3">
            {[0, 1, 2, 3].map(i => <CardSkeleton key={i} h="h-[90px]" />)}
          </div>
          <CardSkeleton h="h-[260px]" />
          <CardSkeleton h="h-[260px]" />
        </div>
      ) : isError ? (
        <ErrorCard message={t('common:failedToLoadData')} onRetry={refetch} />
      ) : (
        <>
          {/* KPI row */}
          <span className="admin-eyebrow block mb-2">
            {t('admin.attendance.atAGlance', 'LAST ' + period + ' DAYS')}
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mb-5">
            <StatCard
              label={t('admin.attendance.totalCheckins', 'Total Check-ins')}
              value={summaryStats.totalCheckins}
              sub={formatDelta(deltas.checkins)}
              borderColor="var(--color-coach)"
              icon={CalendarCheck}
              delay={0}
            />
            <StatCard
              label={t('admin.attendance.totalWorkouts', 'Total Workouts')}
              value={summaryStats.totalWorkouts}
              sub={formatDelta(deltas.workouts)}
              borderColor="var(--color-accent)"
              icon={Dumbbell}
              delay={0.05}
            />
            <StatCard
              label={t('admin.attendance.uniqueVisitors', 'Unique Visitors')}
              value={summaryStats.uniqueVisitors}
              borderColor="var(--color-success)"
              icon={Users}
              delay={0.1}
            />
            <StatCard
              label={t('admin.attendance.avgPerDay', 'Avg Check-ins / Day')}
              value={summaryStats.avgPerDay}
              borderColor="var(--color-info)"
              icon={Flame}
              delay={0.15}
            />
          </div>

          {/* Daily activity trend chart */}
          <FadeIn delay={0.1}>
            <AdminCard hover padding="p-3 sm:p-4 md:p-5" className="mb-5">
              <div className="flex items-start justify-between mb-4 gap-3">
                <div>
                  <h3 className="admin-page-title text-[17px] mb-1" style={{ letterSpacing: '-0.01em' }}>
                    {t('admin.attendance.dailyActivity', 'Daily Activity')}
                  </h3>
                  <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                    {t('admin.attendance.dailySubtitle', 'Check-ins and workouts over last {{period}} days', { period })}
                  </p>
                </div>
                <TrendingUp size={16} style={{ color: 'var(--color-admin-text-muted)' }} />
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="var(--color-admin-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'var(--color-admin-text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.floor(dailyData.length / 6)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--color-admin-text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: 'var(--color-admin-text-muted)', paddingTop: 8 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="checkins"
                    name={t('admin.attendance.checkins', 'Check-ins')}
                    stroke="var(--color-coach)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, fill: 'var(--color-coach)' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="workouts"
                    name={t('admin.attendance.workoutsLabel', 'Workouts')}
                    stroke="var(--color-warning)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, fill: 'var(--color-warning)' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </AdminCard>
          </FadeIn>

          {/* Peak hours heatmap */}
          <FadeIn delay={0.2}>
            <AdminCard hover padding="p-3 sm:p-4 md:p-5" className="overflow-x-auto">
              <div className="flex items-start justify-between mb-4 gap-3">
                <div>
                  <h3 className="admin-page-title text-[17px] mb-1" style={{ letterSpacing: '-0.01em' }}>
                    {t('admin.attendance.peakHours', 'Peak Hours')}
                  </h3>
                  <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                    {peakLabel || t('admin.attendance.basedOn', 'Based on gym check-ins')}
                  </p>
                </div>
                {peakLabel && (
                  <span className="admin-pill admin-pill--coach">
                    {peakLabel.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-[520px] md:min-w-0">
                <div
                  className="grid gap-[3px]"
                  style={{ gridTemplateColumns: `40px repeat(${HOURS.length}, 1fr)` }}
                >
                  <div />
                  {HOURS.map(h => (
                    <div
                      key={`h-${h}`}
                      className="text-center admin-mono"
                      style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--color-admin-text-muted)' }}
                    >
                      {`${h > 12 ? h - 12 : h}${h >= 12 ? t('admin.attendance.pmShort', 'p') : t('admin.attendance.amShort', 'a')}`}
                    </div>
                  ))}
                  {DAYS.map((day, di) => (
                    <Fragment key={`row-${di}`}>
                      <div
                        className="flex items-center"
                        style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-admin-text-muted)' }}
                      >
                        {day}
                      </div>
                      {HOURS.map(h => {
                        const val = heatmap[`${di}-${h}`] || 0;
                        const bucket = heatBucket(val);
                        return (
                          <div
                            key={`${di}-${h}`}
                            title={`${day} ${h}:00 — ${val} ${t('admin.attendance.checkins', 'check-ins')}`}
                            style={{
                              height: 26,
                              background: heatBg(bucket),
                              borderRadius: 4,
                              transition: 'background 0.15s',
                            }}
                          />
                        );
                      })}
                    </Fragment>
                  ))}
                </div>

                {/* Legend */}
                <div
                  className="flex items-center gap-1.5 mt-3 justify-end"
                  style={{ fontSize: 10.5, color: 'var(--color-admin-text-muted)', fontWeight: 600 }}
                >
                  <span>{t('admin.attendance.less', 'Less')}</span>
                  {[0, 1, 2, 3, 4].map(b => (
                    <span
                      key={b}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        background: heatBg(b),
                        display: 'inline-block',
                      }}
                    />
                  ))}
                  <span>{t('admin.attendance.more', 'More')}</span>
                </div>
              </div>
            </AdminCard>
          </FadeIn>
        </>
      )}
    </AdminPageShell>
  );
}
