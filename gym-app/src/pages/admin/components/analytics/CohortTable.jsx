import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, addDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { exportCSV } from '../../../../lib/csvExport';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Ico, Card, AICON, cohortColor } from './analyticsKit';

async function fetchCohortData(gymId, span, dateFnsLocale) {
  const now = new Date();
  const from = subMonths(startOfMonth(now), span - 1).toISOString();

  const { data: members, error: cohMemError } = await supabase
    .from('profiles')
    .select('id, created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('imported_archived', false)
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
    const joinMonth = format(new Date(m.created_at), 'MMM yy', dateFnsLocale);
    if (!cohortMap[joinMonth]) cohortMap[joinMonth] = [];
    cohortMap[joinMonth].push(m);
  });

  const rows = [];
  for (let i = span - 1; i >= 0; i--) {
    const cohortMonthDate = subMonths(now, i);
    const label = format(cohortMonthDate, 'MMM yy', dateFnsLocale);
    const cohortMembers = cohortMap[label] || [];
    const cohortSize = cohortMembers.length;

    const monthRetention = [0, 1, 2, 3].map(offset => {
      if (cohortSize === 0) return null;
      const activeCount = cohortMembers.filter(m => {
        const joinDate = new Date(m.created_at);
        const windowStart = addDays(joinDate, offset * 30);
        const windowEnd = addDays(joinDate, (offset + 1) * 30);
        if (windowStart > now) return false;
        const memberSessions = sessionsByProfile[m.id] || [];
        return memberSessions.some(d => d >= windowStart && d <= windowEnd);
      }).length;
      const eligibleCount = cohortMembers.filter(m => addDays(new Date(m.created_at), offset * 30) <= now).length;
      if (eligibleCount === 0) return null;
      return Math.round((activeCount / eligibleCount) * 100);
    });

    rows.push({ label, cohortSize, m0: monthRetention[0], m1: monthRetention[1], m2: monthRetention[2], m3: monthRetention[3] });
  }

  return rows;
}

export default function CohortTable({ gymId, monthsBack }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : {};
  const span = monthsBack || 6;
  const { data: cohortData = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...adminKeys.analytics.cohort(gymId), span, i18n.language],
    queryFn: () => fetchCohortData(gymId, span, dateFnsLocale),
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

  const latestCohort = cohortData.length > 0 ? cohortData[cohortData.length - 1] : null;
  const headlineRetention = latestCohort?.m0 ?? 0;
  const COLS = '120px 90px repeat(4,1fr)';
  const headers = [
    t('admin.analytics.cohortHeader', 'Cohort'),
    t('admin.analytics.cohortSize', 'Size'),
    ...[0, 1, 2, 3].map(n => t('admin.analytics.cohortMonth', { n, defaultValue: 'Month {{n}}' })),
  ];

  return (
    <Card style={{ padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.analytics.cohortTitle', 'Cohort Retention')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
            <span style={{ fontFamily: FK.display, fontSize: 28, fontWeight: 800, color: TK.accent, letterSpacing: -1 }}>{headlineRetention}%</span>
            <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute }}>{t('admin.analytics.cohortHeadline', 'latest cohort, month 0')}</span>
          </div>
        </div>
        <button type="button" onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FK.body, fontSize: 13, fontWeight: 600, color: TK.textMute, cursor: 'pointer', background: 'transparent', border: 'none', flexShrink: 0 }}>
          <Ico ch={AICON.download} size={15} color={TK.textMute} stroke={2} />{t('admin.analytics.export', 'Export')}
        </button>
      </div>

      <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 10, lineHeight: 1.5, maxWidth: 760 }}>
        {t('admin.analytics.cohortDesc', 'Each row is a group of members who joined in the same month. Month 0 = their first month, Month 1 = second month, etc. The percentage shows how many are still working out.')}
      </div>

      {cohortData.length === 0 ? (
        <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '40px 0' }}>{t('admin.analytics.cohortEmpty', 'No cohort data yet')}</p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 18 }}>
          <div style={{ minWidth: 520, borderRadius: 12, border: `1px solid ${TK.divider}`, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, background: TK.surface2 }}>
              {headers.map((h, i) => (
                <span key={i} style={{ padding: '12px 14px', fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: TK.textFaint, textAlign: i < 2 ? 'left' : 'center' }}>{h}</span>
              ))}
            </div>
            {cohortData.map((row) => (
              <div key={row.label} style={{ display: 'grid', gridTemplateColumns: COLS, borderTop: `1px solid ${TK.divider}`, alignItems: 'center' }}>
                <span style={{ padding: '10px 14px', fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.text }}>{row.label}</span>
                <span style={{ padding: '10px 14px', fontFamily: FK.mono, fontSize: 13, color: TK.textMute }}>{row.cohortSize}</span>
                {[row.m0, row.m1, row.m2, row.m3].map((v, ci) => {
                  const col = cohortColor(v);
                  return (
                    <div key={ci} style={{ padding: '8px 10px' }}>
                      <div style={{ borderRadius: 8, padding: '9px 0', textAlign: 'center', background: col.bg, fontFamily: FK.display, fontSize: 14, fontWeight: 800, color: col.fg }}>{v == null ? '—' : `${v}%`}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 22, marginTop: 16, flexWrap: 'wrap' }}>
        {[[t('admin.analytics.cohortLegendStrong', '≥70% — Strong'), cohortColor(80)],
          [t('admin.analytics.cohortLegendModerate', '40–70% — Moderate'), cohortColor(50)],
          [t('admin.analytics.cohortLegendLow', '<40% — Low'), cohortColor(10)]].map((l, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: FK.body, fontSize: 12.5, color: TK.textSub }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: l[1].bg }} />{l[0]}
          </span>
        ))}
      </div>
    </Card>
  );
}
