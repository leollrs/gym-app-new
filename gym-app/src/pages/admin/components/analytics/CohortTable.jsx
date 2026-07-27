import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, addDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { exportCSV } from '../../../../lib/csvExport';
import { selectAllRows } from '../../../../lib/churn/batchedSelect';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Ico, Card, AICON, cohortColor } from './analyticsKit';

// Retention is measured in four rolling 30-day windows from each member's join
// date (month 0..3), so every member needs FIVE window edges: join+0/30/60/90/120d.
const WINDOWS = 4;

async function fetchCohortData(gymId, span, dateFnsLocale) {
  const now = new Date();
  const nowMs = now.getTime();
  const from = subMonths(startOfMonth(now), span - 1).toISOString();

  // Both reads were unbounded: PostgREST is configured with `max_rows = 1000`
  // and applies LEAST(limit, max_rows), so it silently returned the first 1000
  // rows (verified live: `content-range: 0-999/1275`). The roster is paged for
  // the same reason a 1000+ member gym would lose whole cohorts off the end.
  // Order by (created_at, id): `id` is the PK, so the sort is total and OFFSET
  // paging can't skip or duplicate a member who joined in the same second as
  // another.
  const { data: members, error: cohMemError } = await selectAllRows((lo, hi) => supabase
    .from('profiles')
    .select('id, created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('imported_archived', false)
    .gte('created_at', from)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(lo, hi));
  if (cohMemError) throw cohMemError;

  // This is the one that made the table lie. Six months of sessions is ~72 per
  // member, so a 300-member gym holds ~21,600 rows and the un-paged read saw
  // 1000 of them — under 5%. Every member whose sessions fell past that cut
  // read as "never trained again", so the grid rendered single-digit month-1/2/3
  // retention for a gym actually running 60-70%, in the exact green/amber/red
  // colour code an owner reads as a verdict. Paged: ~22 sequential requests.
  // Order ASCENDING by (started_at, id) — stable for OFFSET paging, and the
  // ascending part is load-bearing for the single-pass window walk below, which
  // assumes each member's timestamps arrive already sorted.
  const { data: sessions, error: cohSessError } = await selectAllRows((lo, hi) => supabase
    .from('workout_sessions')
    .select('profile_id, started_at')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', from)
    .order('started_at', { ascending: true })
    .order('id', { ascending: true })
    .range(lo, hi));
  if (cohSessError) throw cohSessError;

  // ONE grouping pass over the (now ~21x larger) session array: `started_at` is
  // parsed exactly once per row and kept as a NUMBER, not a Date, so the
  // retention walk compares primitives instead of re-entering valueOf() on every
  // comparison. Anything that re-walked this array per member per offset would
  // have grown 21x along with it.
  const sessionMsByProfile = new Map();
  for (const s of (sessions || [])) {
    const ms = new Date(s.started_at).getTime();
    const arr = sessionMsByProfile.get(s.profile_id);
    if (arr) arr.push(ms);
    else sessionMsByProfile.set(s.profile_id, [ms]);
  }

  // Bucket members by join month AND precompute their window edges here — once
  // per member. The old code rebuilt `new Date(m.created_at)` plus two addDays()
  // calls INSIDE the offset loop, then re-filtered the whole cohort a second
  // time just to count eligibility: 8 date parses and 12 addDays per member.
  // Still addDays() rather than `join + k*30*86400000` so DST-shifted edges stay
  // bit-identical to what the old code produced.
  const cohortMap = new Map();
  for (const m of (members || [])) {
    const joinDate = new Date(m.created_at);
    const label = format(joinDate, 'MMM yy', dateFnsLocale);
    const edges = [];
    for (let k = 0; k <= WINDOWS; k++) edges.push(addDays(joinDate, k * 30).getTime());
    const entry = { id: m.id, edges };
    const bucket = cohortMap.get(label);
    if (bucket) bucket.push(entry);
    else cohortMap.set(label, [entry]);
  }

  const rows = [];
  for (let i = span - 1; i >= 0; i--) {
    const cohortMonthDate = subMonths(now, i);
    const label = format(cohortMonthDate, 'MMM yy', dateFnsLocale);
    const cohortMembers = cohortMap.get(label) || [];
    const cohortSize = cohortMembers.length;

    // active[k] and eligible[k] for all four offsets accumulate in ONE pass over
    // the cohort, replacing 8 passes (an activeCount filter + an eligibleCount
    // filter, each repeated per offset) that each re-scanned the member's whole
    // session list.
    const active = [0, 0, 0, 0];
    const eligible = [0, 0, 0, 0];
    for (const m of cohortMembers) {
      const times = sessionMsByProfile.get(m.id);
      const hit = [false, false, false, false];
      if (times) {
        // `times` is ascending, so one pointer sweeps the windows forward and
        // every timestamp is examined exactly once — O(S) per member instead of
        // O(4*S) from the old `.some()` re-scan per offset.
        let k = 0;
        for (let j = 0; j < times.length; j++) {
          const ms = times[j];
          while (k < WINDOWS && ms > m.edges[k + 1]) k++;
          if (k >= WINDOWS) break; // past month 3 — nothing later can match either
          if (ms >= m.edges[k]) {
            hit[k] = true;
            // Adjacent windows SHARE an edge and the old test was inclusive on
            // both ends (`>= start && <= end`), so a session landing exactly on
            // a boundary counted for the window it closes AND the one it opens.
            if (ms === m.edges[k + 1] && k + 1 < WINDOWS) hit[k + 1] = true;
          }
        }
      }
      for (let k = 0; k < WINDOWS; k++) {
        if (m.edges[k] > nowMs) continue; // window hasn't opened yet → not eligible
        eligible[k]++;
        if (hit[k]) active[k]++;
      }
    }

    const monthRetention = [0, 1, 2, 3].map(offset => {
      if (cohortSize === 0 || eligible[offset] === 0) return null;
      return Math.round((active[offset] / eligible[offset]) * 100);
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
