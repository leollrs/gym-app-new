import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { TK, FK, Ico, Card, AICON, EmptyBox, HBarRow } from './analytics/analyticsKit';

const WINDOWS = [
  { key: 30, labelKey: 'last30', fallback: 'Last 30 days' },
  { key: 90, labelKey: 'last90', fallback: 'Last 90 days' },
  { key: 365, labelKey: 'last365', fallback: 'Last year' },
];

// Hormozi's "% leaks in the bucket" — categories sorted descending by share,
// percentages bar-graphed against the largest category.
export default function WhyLeftPanel({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;
  const [windowDays, setWindowDays] = useState(90);

  const { data: breakdown = [], isLoading: loadingBreakdown } = useQuery({
    queryKey: ['cancellation_breakdown', gymId, windowDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cancellation_reason_breakdown', { p_gym_id: gymId, p_days_back: windowDays });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const { data: recent = [], isLoading: loadingRecent } = useQuery({
    queryKey: ['cancellation_recent', gymId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cancellation_reasons')
        .select('id, category, details_text, would_return_if, tenure_days, recorded_at, profile_id, profiles:profile_id(full_name, avatar_url)')
        .eq('gym_id', gymId)
        .order('recorded_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const total = useMemo(() => breakdown.reduce((sum, r) => sum + (r.count || 0), 0), [breakdown]);
  const topPct = breakdown[0]?.percentage || 0;
  const labelFor = (cat) => t(`admin.cancellationSurvey.reasons.${cat}`, { defaultValue: cat });

  return (
    <div>
      {/* window selector */}
      <div style={{ display: 'inline-flex', gap: 5, background: TK.surface3, padding: 4, borderRadius: 999, border: `1px solid ${TK.borderSolid}`, marginBottom: 18 }}>
        {WINDOWS.map(w => {
          const on = windowDays === w.key;
          return (
            <button key={w.key} type="button" onClick={() => setWindowDays(w.key)}
              style={{ padding: '8px 15px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : 'transparent' }}>
              {t(`admin.whyLeft.${w.labelKey}`, w.fallback)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] items-start">
        {/* breakdown */}
        <Card style={{ padding: '20px 24px' }}>
          <div style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.whyLeft.breakdownTitle', 'Cancellation reasons')}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 3 }}>
            {t(total === 1 ? 'admin.whyLeft.totalCancellations' : 'admin.whyLeft.totalCancellations_other', { count: total, defaultValue: total === 1 ? '{{count}} cancellation' : '{{count}} cancellations' })}
          </div>
          {loadingBreakdown ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><Loader2 size={20} className="animate-spin" style={{ color: TK.textMute }} /></div>
          ) : total === 0 ? (
            <EmptyBox icon={AICON.userx} title={t('admin.whyLeft.empty', 'No cancellations in this window.')} sub={t('admin.whyLeft.emptyHint', 'When an admin cancels a membership, the reason is captured here.')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {breakdown.map(row => (
                <HBarRow key={row.category} label={labelFor(row.category)} value={row.percentage} denominator={topPct}
                  color="color-mix(in srgb, var(--color-danger) 70%, transparent)"
                  rightLabel={`${row.count} · ${Number(row.percentage).toFixed(0)}%`} />
              ))}
            </div>
          )}
        </Card>

        {/* recent cancellations */}
        <Card style={{ padding: '20px 24px' }}>
          <div style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.whyLeft.recentTitle', 'Recent cancellations')}</div>
          {loadingRecent ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><Loader2 size={18} className="animate-spin" style={{ color: TK.textMute }} /></div>
          ) : recent.length === 0 ? (
            <EmptyBox icon={AICON.inbox} title={t('admin.whyLeft.recentEmpty', 'Nothing logged yet.')} h={140} />
          ) : (
            <div style={{ marginTop: 4 }}>
              {recent.map((row, idx) => (
                <div key={row.id} style={{ padding: '12px 0', borderTop: idx === 0 ? 'none' : `1px solid ${TK.divider}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: TK.text }}>{row.profiles?.full_name || t('admin.whyLeft.unknownMember', 'Unknown member')}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 999, fontFamily: FK.body, fontSize: 10.5, fontWeight: 700, background: 'var(--color-danger-soft)', color: 'var(--color-danger-ink, var(--color-danger))', border: '1px solid color-mix(in srgb, var(--color-danger) 26%, transparent)' }}>{labelFor(row.category)}</span>
                  </div>
                  {row.details_text && <p style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute, margin: '6px 0 0', lineHeight: 1.4 }}>&ldquo;{row.details_text}&rdquo;</p>}
                  {row.would_return_if && (
                    <p style={{ fontFamily: FK.body, fontSize: 11.5, color: 'var(--color-success)', margin: '4px 0 0', lineHeight: 1.4 }}>
                      <span style={{ color: TK.textFaint }}>{t('admin.whyLeft.returnIfPrefix', 'Would return:')} </span>{row.would_return_if}
                    </p>
                  )}
                  <p style={{ fontFamily: FK.mono, fontSize: 11, color: TK.textFaint, margin: '6px 0 0' }}>
                    {formatDistanceToNow(new Date(row.recorded_at), { addSuffix: true, ...dateLocale })}
                    {' · '}{t('admin.whyLeft.tenureLabel', { count: row.tenure_days, defaultValue: '{{count}}d member' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
