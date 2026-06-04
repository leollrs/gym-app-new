import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '../../../../lib/supabase';
import { CardSkeleton, ErrorCard } from '../../../../components/admin';
import { TK, FK, Ico, Card, AICON, MiniStat } from './analyticsKit';

// Hormozi LTV math, calibrated to observed cancellation tenure.
// LTV = monthly_price * avg_tenure_months. Surfaces sample_size for trust.
const LOW_CONFIDENCE_THRESHOLD = 5;

function formatMoney(amount, currency) {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency || 'USD'} ${Math.round(amount).toLocaleString()}`;
  }
}

export default function LTVCard({ gymId }) {
  const { t } = useTranslation('pages');

  const { data, isLoading, error } = useQuery({
    queryKey: ['gym-ltv', gymId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_gym_ltv_estimate', { p_gym_id: gymId, p_days_back: 365 });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });

  const status = useMemo(() => {
    if (!data) return 'loading';
    if (data.monthly_price == null) return 'no_price';
    if (data.sample_size === 0) return 'no_cancellations';
    if (data.sample_size < LOW_CONFIDENCE_THRESHOLD) return 'low_confidence';
    return 'ok';
  }, [data]);

  if (isLoading) return <CardSkeleton h="h-[200px]" />;
  if (error) return <ErrorCard message={error.message} />;
  if (!data) return null;

  const {
    monthly_price: monthlyPrice, currency, avg_tenure_months: avgTenureMonths,
    estimated_ltv: ltv, sample_size: sampleSize, active_members: activeMembers,
    estimated_pipeline_value: pipeline,
  } = data;

  // ── No price set ──
  if (status === 'no_price') {
    return (
      <Card style={{ padding: '22px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: TK.accentSoft, border: `1px solid ${TK.accentLine}`, flexShrink: 0 }}>
            <Ico ch={AICON.dollar} size={20} color={TK.accent} stroke={2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>{t('admin.ltv.setPriceTitle', 'Set your monthly price')}</div>
            <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 4 }}>{t('admin.ltv.setPriceDesc', 'LTV reporting needs the membership price. Members never see it.')}</div>
            <Link to="/admin/settings/gym-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, padding: '10px 16px', borderRadius: 999, fontFamily: FK.body, fontSize: 13, fontWeight: 700, background: TK.accent, color: '#fff', textDecoration: 'none' }}>
              {t('admin.ltv.setPriceCta', 'Set price')} <Ico ch={AICON.chevR} size={14} color="#fff" stroke={2.4} />
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: '22px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--color-success-soft)', border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)', flexShrink: 0 }}>
          <Ico ch={AICON.dollar} size={20} color="var(--color-success)" stroke={2} />
        </span>
        <div>
          <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.ltv.title', 'Member lifetime value')}</div>
          <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: TK.textFaint, marginTop: 4 }}>{t('admin.ltv.subtitle', 'Last 365 days · Hormozi method')}</div>
        </div>
      </div>

      {/* headline */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, margin: '20px 0 18px' }}>
        <span style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, color: 'var(--color-success)' }}>{status === 'no_cancellations' ? '—' : formatMoney(ltv, currency)}</span>
        <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute }}>{t('admin.ltv.perMember', 'per member')}</span>
      </div>

      {/* breakdown */}
      <div className="grid grid-cols-3" style={{ gap: 24, paddingTop: 18, borderTop: `1px solid ${TK.divider}` }}>
        <MiniStat label={t('admin.ltv.monthlyPrice', 'Monthly price')} value={formatMoney(monthlyPrice, currency)} />
        <MiniStat label={t('admin.ltv.avgTenure', 'Avg tenure')} value={avgTenureMonths == null ? '—' : `${Number(avgTenureMonths).toFixed(1)} ${t('admin.ltv.months', 'mo')}`} />
        <MiniStat label={t('admin.ltv.activeMembers', 'Active members')} value={activeMembers ?? 0} />
      </div>

      {/* pipeline */}
      {pipeline != null && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18, padding: '13px 16px', borderRadius: 12, background: 'var(--color-success-soft)', border: '1px solid color-mix(in srgb, var(--color-success) 22%, transparent)' }}>
          <span style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: 'var(--color-success-ink, var(--color-success))' }}>{t('admin.ltv.pipelineLabel', 'Pipeline value (active × LTV)')}</span>
          <span style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, color: 'var(--color-success)' }}>{formatMoney(pipeline, currency)}</span>
        </div>
      )}

      {/* confidence note */}
      {status === 'no_cancellations' ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18, padding: '12px 14px', borderRadius: 12, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
          <Ico ch={AICON.info} size={15} color={TK.textMute} stroke={2} style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute }}>{t('admin.ltv.noCancellations', 'No cancellations recorded yet. LTV will appear after the first few exit surveys.')}</span>
        </div>
      ) : status === 'low_confidence' ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18, padding: '12px 14px', borderRadius: 12, background: 'var(--color-warning-soft)', border: '1px solid color-mix(in srgb, var(--color-warning) 26%, transparent)' }}>
          <Ico ch={AICON.warn} size={15} color="var(--color-warning)" stroke={2} style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontFamily: FK.body, fontSize: 12.5, color: 'var(--color-warning-ink, var(--color-warning))' }}>{t('admin.ltv.lowConfidence', { count: sampleSize, defaultValue: 'Based on only {{count}} cancellations — directional, not exact. Confidence grows with more exit surveys.' })}</span>
        </div>
      ) : (
        <p style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textFaint, textAlign: 'center', marginTop: 16 }}>{t('admin.ltv.basedOn', { count: sampleSize, defaultValue: 'Based on {{count}} cancellations in the last 365 days' })}</p>
      )}
    </Card>
  );
}
