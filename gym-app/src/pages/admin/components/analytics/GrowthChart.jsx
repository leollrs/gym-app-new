import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../../lib/supabase';
import { selectAllRows } from '../../../../lib/churn/batchedSelect';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { es as esLocale } from 'date-fns/locale';
import { TK, FK, ChartCard, LineChart } from './analyticsKit';

async function fetchGrowthData(gymId, dateFnsLocale, span) {
  const now = new Date();
  const from = subMonths(startOfMonth(now), span - 1).toISOString();

  // Paginado y ordenado: sin esto PostgREST tapaba en 1000 filas y los meses
  // perdían altas al azar — que en un gráfico de crecimiento se lee como una
  // CAÍDA real del negocio. Un gimnasio que suma ~85 al mes cruza las 1000
  // dentro de la ventana de 12 meses por defecto. Esto alimenta también el CSV
  // de `member-growth`.
  const { data: members, error } = await selectAllRows((lo, hi) => supabase
    .from('profiles')
    .select('created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('imported_archived', false)
    .gte('created_at', from)
    // `created_at` NO desempata: una importación masiva inserta a todos los
    // miembros en la misma transacción, y `DEFAULT NOW()` les da a todos el
    // MISMO sello. Con 1500 filas empatadas el paginado las baraja entre
    // páginas — unas se repiten, otras se caen — y la curva de crecimiento (y
    // el CSV que sale de ella) sale mal justo en los gimnasios grandes, que
    // son los que la miran.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(lo, hi));
  if (error) throw error;

  const monthMap = {};
  for (let i = span - 1; i >= 0; i--) {
    const label = format(subMonths(now, i), 'MMM yy', dateFnsLocale);
    monthMap[label] = 0;
  }
  (members || []).forEach(m => {
    const label = format(new Date(m.created_at), 'MMM yy', dateFnsLocale);
    if (label in monthMap) monthMap[label]++;
  });

  return Object.entries(monthMap).map(([month, count]) => ({ month, count }));
}

function GrowthChart({ gymId, monthsBack }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : {};
  const span = monthsBack || 12; // 'All' (null) caps at 12 months for growth
  const { data: growthData = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...adminKeys.analytics.growth(gymId), i18n.language, span],
    queryFn: () => fetchGrowthData(gymId, dateFnsLocale, span),
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

  const totalNewMembers = growthData.reduce((sum, d) => sum + d.count, 0);
  const latestMonthCount = growthData.length > 0 ? growthData[growthData.length - 1].count : 0;
  const counts = growthData.map(d => d.count);
  const labels = growthData.length
    ? [growthData[0].month, growthData[Math.floor((growthData.length - 1) / 2)].month, growthData[growthData.length - 1].month]
    : [];

  return (
    <ChartCard
      title={t('admin.analytics.growthTitle', 'Member Growth')}
      subtitle={t('admin.analytics.growthFooterDynamic', { count: span, defaultValue: 'New signups per month — last {{count}} months' })}
      big={totalNewMembers}
      bigColor={TK.accent}
      bigSub={t('admin.analytics.growthTotal', { count: latestMonthCount, defaultValue: 'total — {{count}} this month' })}
      onExport={handleExport}
      exportLabel={t('admin.analytics.export', 'Export')}
    >
      {growthData.length === 0 ? (
        <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, textAlign: 'center', padding: '40px 0' }}>{t('admin.analytics.growthEmpty', 'No member data yet')}</p>
      ) : (
        <LineChart data={counts} xLabels={labels} pointLabels={growthData.map(d => d.month)} seriesLabel={t('admin.analytics.newMembers', 'New members')} color={TK.accent} height={230} />
      )}
    </ChartCard>
  );
}

export default React.memo(GrowthChart);
