import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../../lib/supabase';
import { ErrorCard } from '../../../components/admin';
import { TK, FK, Ico, Card, AICON, StatTile, EmptyBox, HBarRow } from './analytics/analyticsKit';

// compact native grouped bars (cancellations vs returns) for the 12-week trend, with hover
function GroupedBars({ rows, cancLabel, retLabel }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...rows.flatMap(r => [r.cancellations || 0, r.returns || 0]));
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 200, padding: '10px 4px 0' }}>
        {rows.map((r, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(h => (h === i ? null : h))}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end', minWidth: 0, cursor: 'default', opacity: hover == null || hover === i ? 1 : 0.5, transition: 'opacity .15s' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: '100%', width: '100%', justifyContent: 'center' }}>
              <div style={{ width: 7, height: `${Math.max(2, ((r.cancellations || 0) / max) * 100)}%`, background: 'var(--color-danger)', borderRadius: '3px 3px 0 0' }} />
              <div style={{ width: 7, height: `${Math.max(2, ((r.returns || 0) / max) * 100)}%`, background: 'var(--color-success)', borderRadius: '3px 3px 0 0' }} />
            </div>
            <span style={{ fontFamily: FK.mono, fontSize: 9, color: TK.textFaint, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%' }}>{r.label}</span>
          </div>
        ))}
      </div>
      {hover != null && rows[hover] && (
        <div style={{ position: 'absolute', top: 0, left: `${((hover + 0.5) / rows.length) * 100}%`, transform: 'translate(-50%,-4px)', background: TK.surface, border: `1px solid ${TK.borderSolid}`, borderRadius: 10, padding: '7px 11px', boxShadow: TK.shadowLg, whiteSpace: 'nowrap', zIndex: 6, pointerEvents: 'none' }}>
          <div style={{ fontFamily: FK.mono, fontSize: 10.5, color: TK.textFaint, marginBottom: 3 }}>{rows[hover].label}</div>
          <div style={{ fontFamily: FK.body, fontSize: 12, color: TK.textSub }}><span style={{ color: 'var(--color-danger)' }}>●</span> {cancLabel}: <b style={{ color: TK.text }}>{rows[hover].cancellations || 0}</b></div>
          <div style={{ fontFamily: FK.body, fontSize: 12, color: TK.textSub }}><span style={{ color: 'var(--color-success)' }}>●</span> {retLabel}: <b style={{ color: TK.text }}>{rows[hover].returns || 0}</b></div>
        </div>
      )}
    </div>
  );
}

export default function RetentionEffectivenessPanel({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ['retention-effectiveness', gymId, i18n.language],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_retention_effectiveness', { p_gym_id: gymId });
      if (error) throw error;
      return data;
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const reactivationRate = useMemo(() => {
    const cancel = data?.totals?.cancellations_30d ?? 0;
    const ret = data?.totals?.returns_30d ?? 0;
    if (cancel === 0) return null;
    return Math.round((ret / cancel) * 100);
  }, [data]);

  const timeseries = data?.timeseries || [];
  const chartRows = useMemo(() => timeseries.map((w) => ({ ...w, label: w.week_start ? format(parseISO(w.week_start), 'MMM d', dateFnsLocale) : '' })), [timeseries, dateFnsLocale]);
  const totalCancelTs = timeseries.reduce((s, w) => s + (w.cancellations || 0), 0);
  const totalReturnsTs = timeseries.reduce((s, w) => s + (w.returns || 0), 0);
  const avgReactivationRateTs = totalCancelTs > 0 ? Math.round((totalReturnsTs / totalCancelTs) * 100) : null;
  const allWeeksZero = timeseries.length > 0 && timeseries.every((w) => (w.cancellations || 0) === 0 && (w.returns || 0) === 0);

  if (isLoading) {
    return <Card style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><Loader2 size={20} className="animate-spin" style={{ color: TK.textMute }} /></Card>;
  }
  if (error) return <ErrorCard message={error.message} />;
  if (!data) return null;

  const tt = data.totals || {};
  const reactTone = reactivationRate >= 30 ? 'good' : reactivationRate >= 15 ? 'warn' : 'neutral';
  const legendDot = (color, label) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FK.body, fontSize: 12, color: TK.textMute }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />{label}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* 12-week trend */}
      <Card style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <Ico ch={AICON.trend} size={15} color="var(--color-success)" stroke={2} />
          <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.effectiveness.last12WeeksTitle', 'Last 12 weeks')}</span>
        </div>
        {(chartRows.length === 0 || allWeeksZero) ? (
          <EmptyBox icon={AICON.clock} title={t('admin.effectiveness.notEnoughData', 'Not enough data yet — comes alive after 30 days of activity.')} h={120} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 16, margin: '4px 0 4px' }}>
              {legendDot('var(--color-danger)', t('admin.effectiveness.cancellations', 'Cancellations'))}
              {legendDot('var(--color-success)', t('admin.effectiveness.returns', 'Returns'))}
            </div>
            <GroupedBars rows={chartRows} cancLabel={t('admin.effectiveness.cancellations', 'Cancellations')} retLabel={t('admin.effectiveness.returns', 'Returns')} />
            <p style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute, textAlign: 'center', marginTop: 8 }}>
              {t('admin.effectiveness.avgReactivationRate', 'Avg reactivation rate (12w)')}:{' '}
              <span style={{ fontFamily: FK.display, fontWeight: 800, color: TK.text }}>{avgReactivationRateTs != null ? `${avgReactivationRateTs}%` : '—'}</span>
            </p>
          </>
        )}
      </Card>

      {/* stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px]">
        <StatTile icon={AICON.send} label={t('admin.effectiveness.lifecycleSent', 'Lifecycle sent')} value={tt.lifecycle_sent_30d} sub={t('admin.effectiveness.last30Days', 'last 30 days')} tone="accent" />
        <StatTile icon={AICON.userx} label={t('admin.effectiveness.winbackSent', 'Win-back sent')} value={tt.winback_sent_30d} sub={t('admin.effectiveness.last30Days', 'last 30 days')} tone="warn" />
        <StatTile icon={AICON.inbox} label={t('admin.effectiveness.queueResolved', 'Queue resolved')} value={tt.queue_resolved_30d} sub={t('admin.effectiveness.last30Days', 'last 30 days')} tone="info" />
        <StatTile icon={AICON.printer} label={t('admin.effectiveness.cardsDelivered', 'Cards delivered')} value={tt.print_cards_delivered_30d} sub={t('admin.effectiveness.last30Days', 'last 30 days')} tone="accent" />
        <StatTile icon={AICON.userx} label={t('admin.effectiveness.cancellations', 'Cancellations')} value={tt.cancellations_30d} sub={t('admin.effectiveness.last30Days', 'last 30 days')} tone="hot" />
        <StatTile icon={AICON.userplus} label={t('admin.effectiveness.returns', 'Returns')} value={tt.returns_30d} sub={t('admin.effectiveness.last30Days', 'last 30 days')} tone="good" />
        <StatTile icon={AICON.pulse} label={t('admin.effectiveness.reactivationRate', 'Reactivation rate')} value={reactivationRate != null ? `${reactivationRate}%` : '—'} sub={t('admin.effectiveness.returnsOverCancels', 'returns / cancels')} tone={reactTone} />
        <StatTile icon={AICON.send} label={t('admin.effectiveness.lifecycleSent7d', 'Sent this week')} value={tt.lifecycle_sent_7d} sub={t('admin.effectiveness.lifecycleOnly', 'lifecycle only')} tone="neutral" />
      </div>

      {/* winback by category */}
      <Card style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <Ico ch={AICON.userx} size={15} color="var(--color-warning)" stroke={2} />
          <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.effectiveness.winbackByCategoryTitle', 'Win-back by reason (90d)')}</span>
        </div>
        {(!data.winback_by_category || data.winback_by_category.length === 0) ? (
          <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, textAlign: 'center', padding: '12px 0' }}>{t('admin.effectiveness.winbackEmpty', 'No win-back messages sent yet.')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.winback_by_category.map((row) => {
              const rate = row.sent > 0 ? Math.round((row.returned / row.sent) * 100) : 0;
              return (
                <div key={row.category} style={{ borderRadius: 12, background: TK.surface2, border: `1px solid ${TK.borderSolid}`, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.text }}>{t(`admin.cancellationSurvey.reasons.${row.category}`, row.category)}</span>
                    <span style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textMute }}>{row.returned}/{row.sent} · {rate}%</span>
                  </div>
                  <div style={{ height: 9, borderRadius: 99, background: TK.surface3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${row.sent > 0 ? (row.returned / row.sent) * 100 : 0}%`, borderRadius: 99, background: 'color-mix(in srgb, var(--color-success) 75%, transparent)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* lifecycle steps */}
      <Card style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <Ico ch={AICON.chart} size={15} color={TK.accent} stroke={2} />
          <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.effectiveness.lifecycleByStepTitle', 'Lifecycle messages by step (30d)')}</span>
        </div>
        {(!data.lifecycle_by_step || data.lifecycle_by_step.length === 0) ? (
          <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, textAlign: 'center', padding: '12px 0' }}>{t('admin.effectiveness.lifecycleEmpty', 'No lifecycle messages sent yet.')}</p>
        ) : (() => {
          const max = Math.max(...data.lifecycle_by_step.map(r => r.sent));
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.lifecycle_by_step.map((row) => (
                <HBarRow key={row.step_key} label={row.step_key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} value={row.sent} denominator={max} color={TK.accent} />
              ))}
            </div>
          );
        })()}
      </Card>
    </div>
  );
}
