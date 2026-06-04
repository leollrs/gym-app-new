import { Fragment, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useInsightsRange } from '../../contexts/InsightsRangeContext';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { exportCSV } from '../../lib/csvExport';
import { adminKeys } from '../../lib/adminQueryKeys';
import { AdminPageShell, FadeIn, CardSkeleton, ErrorCard } from '../../components/admin';
import { TK, FK, TONE, Ico, AICON, Card, MultiLine } from './components/analytics/analyticsKit';

const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6am-8pm (15 hours)

// Days kept as strings so the existing query key + parseInt usage works; each
// carries `days` (number) for sync with InsightsRangeContext.
const PERIOD_OPTIONS = [
  { key: '7', label: '7d', days: 7 },
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
];

const calCheck = <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4M8.5 15l2 2 3.5-3.5" /></>;

// KPI card with colored left rail + delta
function AsStat({ value, label, deltaPct, vsLabel, icon, rail, tone }) {
  const c = TONE[tone] || TONE.neutral;
  const showDelta = deltaPct != null && deltaPct !== 0;
  const up = deltaPct > 0;
  return (
    <Card style={{ position: 'relative', overflow: 'hidden', padding: '20px 22px' }}>
      <span style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3.5, borderRadius: 99, background: rail }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 38, fontWeight: 800, letterSpacing: -1.3, lineHeight: 1, color: TK.text }}>{value}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 9 }}>{label}</div>
          {showDelta && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 9, fontFamily: FK.body, fontSize: 12, fontWeight: 700, color: up ? 'var(--color-success)' : 'var(--color-danger)' }}>
              <span>{up ? '↑' : '↓'}</span>{Math.abs(deltaPct)}%{vsLabel && <span style={{ color: TK.textFaint, fontWeight: 600 }}>{vsLabel}</span>}
            </div>
          )}
        </div>
        <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', background: c.bg, border: `1px solid ${c.line}` }}>
          <Ico ch={icon} size={18} color={c.ink} stroke={2} />
        </span>
      </div>
    </Card>
  );
}

export default function AdminAttendance() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  // Period shared across Insights pages. Attendance has no "all time" option,
  // so if context is null (NPS/Analytics picked "all") fall back to 30d locally.
  const { periodDays: ctxPeriodDays, setPeriodDays } = useInsightsRange();
  const matchedOption = PERIOD_OPTIONS.find((o) => o.days === ctxPeriodDays) ?? PERIOD_OPTIONS.find((o) => o.key === '30');
  const period = matchedOption.key;
  const setPeriod = (key) => setPeriodDays((PERIOD_OPTIONS.find((o) => o.key === key) || {}).days ?? 30);
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

      // Heatmap — strictly check-ins (honest "Peak Hours"; empty if no check-ins).
      const heat = {};
      checkInList.forEach(c => {
        const d = new Date(c.checked_in_at);
        const day = d.getDay();
        const dayIndex = (day === 0) ? 6 : day - 1;
        const key = `${dayIndex}-${d.getHours()}`;
        heat[key] = (heat[key] || 0) + 1;
      });

      // Deltas: 2nd half of period vs 1st half
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

      // Peak hour
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

  const peakLabel = peakSummary
    ? (() => {
        const dayName = DAYS[peakSummary.dayIdx] || '';
        const h = peakSummary.hour;
        const hourStr = `${h > 12 ? h - 12 : h}${h >= 12 ? t('admin.attendance.pm', 'pm') : t('admin.attendance.am', 'am')}`;
        return `${t('admin.attendance.peak', 'Peak')} ${dayName} ${hourStr}`;
      })()
    : null;

  // Heat intensity bucket (0..4) + accent ramp (theme + white-label safe)
  const heatBucket = (val) => {
    if (!val) return 0;
    const intensity = val / maxHeat;
    if (intensity > 0.75) return 4;
    if (intensity > 0.5) return 3;
    if (intensity > 0.25) return 2;
    return 1;
  };
  const heatBg = (bucket) => {
    if (bucket === 0) return TK.surface3;
    if (bucket === 1) return 'color-mix(in srgb, var(--color-accent) 20%, transparent)';
    if (bucket === 2) return 'color-mix(in srgb, var(--color-accent) 42%, transparent)';
    if (bucket === 3) return 'color-mix(in srgb, var(--color-accent) 68%, transparent)';
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

  // chart series + labels
  const labelCount = Math.min(6, dailyData.length);
  const xLabels = dailyData.length
    ? Array.from({ length: labelCount }, (_, i) => {
        const idx = labelCount === 1 ? 0 : Math.round((i / (labelCount - 1)) * (dailyData.length - 1));
        return dailyData[idx]?.date;
      })
    : [];
  const series = [
    { data: dailyData.map(d => d.checkins), color: 'var(--color-coach)', label: t('admin.attendance.checkins', 'Check-ins') },
    { data: dailyData.map(d => d.workouts), color: TK.accent, label: t('admin.attendance.workoutsLabel', 'Workouts') },
  ];

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.attendance.title', 'Attendance')}</h1>
          <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.attendance.subtitle', 'Check-ins and workout activity')}</div>
        </div>
        <button type="button" onClick={handleExport} aria-label={t('admin.attendance.export', 'Export')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 17px', borderRadius: 999, cursor: 'pointer', background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.textSub, whiteSpace: 'nowrap' }}>
          <Ico ch={AICON.download} size={16} color={TK.accent} stroke={2.1} />{t('admin.attendance.export', 'Export')}
        </button>
      </div>

      {/* range pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
        {PERIOD_OPTIONS.map(opt => {
          const on = period === opt.key;
          return (
            <button key={opt.key} type="button" onClick={() => setPeriod(opt.key)}
              style={{ padding: '9px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : TK.surface, border: `1px solid ${on ? TK.accent : TK.borderSolid}`, whiteSpace: 'nowrap' }}>
              {t(`admin.attendance.periodLabel.${opt.key}`, opt.label)}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] md:gap-[18px]">
            {[0, 1, 2, 3].map(i => <CardSkeleton key={i} h="h-[120px]" />)}
          </div>
          <CardSkeleton h="h-[300px]" />
          <CardSkeleton h="h-[300px]" />
        </div>
      ) : isError ? (
        <div style={{ marginTop: 24 }}><ErrorCard message={t('common:failedToLoadData')} onRetry={refetch} /></div>
      ) : (
        <>
          {/* KPI row */}
          <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: TK.textFaint, margin: '26px 0 14px' }}>
            {t('admin.attendance.atAGlance', 'At a glance')}
          </div>
          <FadeIn>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] md:gap-[18px]">
              <AsStat value={summaryStats.totalCheckins} label={t('admin.attendance.totalCheckins', 'Total Check-ins')} deltaPct={deltas.checkins} vsLabel={t('admin.attendance.vsPrevHalf', '1st vs 2nd half of period')} icon={calCheck} rail="var(--color-coach)" tone="coach" />
              <AsStat value={summaryStats.totalWorkouts} label={t('admin.attendance.totalWorkouts', 'Total Workouts')} deltaPct={deltas.workouts} vsLabel={t('admin.attendance.vsPrevHalf', '1st vs 2nd half of period')} icon={AICON.dumbbell} rail={TK.accent} tone="accent" />
              <AsStat value={summaryStats.uniqueVisitors} label={t('admin.attendance.uniqueVisitors', 'Unique Visitors')} icon={AICON.users} rail="var(--color-danger)" tone="hot" />
              <AsStat value={summaryStats.avgPerDay} label={t('admin.attendance.avgPerDay', 'Avg Check-ins / Day')} icon={AICON.flame} rail="var(--color-info)" tone="info" />
            </div>
          </FadeIn>

          {/* Daily activity */}
          <FadeIn delay={60}>
            <Card style={{ padding: '22px 26px', marginTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.attendance.dailyActivity', 'Daily Activity')}</div>
                  <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 4 }}>{t('admin.attendance.dailySubtitle', 'Check-ins and workouts over last {{period}} days', { period })}</div>
                </div>
                <Ico ch={AICON.trend} size={18} color={TK.accent} stroke={2} />
              </div>
              <div style={{ marginTop: 14 }}>
                <MultiLine series={series} xLabels={xLabels} pointLabels={dailyData.map(d => d.date)} height={300} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 6 }}>
                {series.map((s, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: FK.body, fontSize: 13, fontWeight: 600, color: TK.textSub }}>
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: s.color }} />{s.label}
                  </span>
                ))}
              </div>
            </Card>
          </FadeIn>

          {/* Peak hours */}
          <FadeIn delay={120}>
            <Card style={{ padding: '22px 26px', marginTop: 18, overflowX: 'auto' }}>
              <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.attendance.peakHours', 'Peak Hours')}</div>
              <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 4 }}>{t('admin.attendance.basedOn', 'Based on gym check-ins')}</div>

              {peakLabel ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '18px 0 22px', padding: '13px 18px', borderRadius: 13, background: TK.accentWash, border: `1px solid ${TK.accentLine}` }}>
                  <Ico ch={AICON.flame} size={17} color={TK.accent} stroke={2.1} />
                  <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.accentInk, letterSpacing: -0.2 }}>{peakLabel}</span>
                  <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.accent }}>· {peakSummary.count} {t('admin.attendance.checkins', 'check-ins')}</span>
                </div>
              ) : (
                <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: '16px 0 18px' }}>{t('admin.attendance.noCheckins', 'No check-ins in this period yet.')}</div>
              )}

              <div style={{ minWidth: 520 }}>
                <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(${HOURS.length}, 1fr)`, gap: 4, alignItems: 'center' }}>
                  <span />
                  {HOURS.map(h => (
                    <span key={`h-${h}`} style={{ fontFamily: FK.body, fontSize: 10.5, fontWeight: 600, color: TK.textMute, textAlign: 'center' }}>
                      {`${h > 12 ? h - 12 : h}${h >= 12 ? t('admin.attendance.pmShort', 'p') : t('admin.attendance.amShort', 'a')}`}
                    </span>
                  ))}
                  {DAYS.map((day, di) => (
                    <Fragment key={`row-${di}`}>
                      <span style={{ fontFamily: FK.body, fontSize: 12, fontWeight: 600, color: TK.textSub }}>{day}</span>
                      {HOURS.map(h => {
                        const val = heatmap[`${di}-${h}`] || 0;
                        const bucket = heatBucket(val);
                        return (
                          <div key={`${di}-${h}`} title={`${day} ${h}:00 — ${val} ${t('admin.attendance.checkins', 'check-ins')}`}
                            style={{ height: 28, borderRadius: 6, background: heatBg(bucket), border: `1px solid ${bucket > 0 ? 'transparent' : TK.divider}`, transition: 'background 0.15s' }} />
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <span style={{ fontFamily: FK.body, fontSize: 12, color: TK.textFaint }}>{t('admin.attendance.less', 'Less')}</span>
                  {[0, 1, 2, 3, 4].map(b => (
                    <span key={b} style={{ width: 18, height: 18, borderRadius: 5, background: heatBg(b), border: `1px solid ${b > 0 ? 'transparent' : TK.divider}`, display: 'inline-block' }} />
                  ))}
                  <span style={{ fontFamily: FK.body, fontSize: 12, color: TK.textFaint }}>{t('admin.attendance.more', 'More')}</span>
                </div>
              </div>
            </Card>
          </FadeIn>
        </>
      )}
    </AdminPageShell>
  );
}
