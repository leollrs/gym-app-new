import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DollarSign, AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

// Hormozi LTV math, calibrated to observed cancellation tenure.
// LTV = monthly_price * avg_tenure_months (where tenure comes from
// cancellation_reasons rows). Surfaces sample_size so the owner can
// tell whether the number is trustworthy yet.

const LOW_CONFIDENCE_THRESHOLD = 5;

function formatMoney(amount, currency) {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency || 'USD'} ${Math.round(amount).toLocaleString()}`;
  }
}

export default function LTVCard({ gymId }) {
  const { t } = useTranslation('pages');

  const { data, isLoading, error } = useQuery({
    queryKey: ['gym-ltv', gymId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_gym_ltv_estimate', { p_gym_id: gymId, p_days_back: 365 });
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
    monthly_price: monthlyPrice,
    currency,
    avg_tenure_months: avgTenureMonths,
    estimated_ltv: ltv,
    sample_size: sampleSize,
    active_members: activeMembers,
    estimated_pipeline_value: pipeline,
  } = data;

  // ── No price set: prompt the owner to set it ──
  if (status === 'no_price') {
    return (
      <AdminCard>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
            <DollarSign size={16} className="text-[#D4AF37]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-[#E5E7EB]">
              {t('admin.ltv.setPriceTitle', 'Set your monthly price')}
            </p>
            <p className="text-[12px] text-[#9CA3AF] mt-1">
              {t('admin.ltv.setPriceDesc', 'LTV reporting needs the membership price. Members never see it.')}
            </p>
            <Link
              to="/admin/settings/gym-info"
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg text-[12px] font-semibold bg-[#D4AF37] text-black hover:brightness-95 transition"
            >
              {t('admin.ltv.setPriceCta', 'Set price')} <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </AdminCard>
    );
  }

  return (
    <AdminCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
            <DollarSign size={16} className="text-[#10B981]" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-[#E5E7EB]">
              {t('admin.ltv.title', 'Member lifetime value')}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-[#6B7280] mt-0.5">
              {t('admin.ltv.subtitle', 'Last 365 days · Hormozi method')}
            </p>
          </div>
        </div>
      </div>

      {/* Headline LTV */}
      <div className="flex items-baseline gap-2 mb-3">
        <p className="text-[32px] font-bold leading-none text-[#E5E7EB] tabular-nums">
          {status === 'no_cancellations' ? '—' : formatMoney(ltv, currency)}
        </p>
        <p className="text-[12px] text-[#6B7280]">
          {t('admin.ltv.perMember', 'per member')}
        </p>
      </div>

      {/* Breakdown row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">
            {t('admin.ltv.monthlyPrice', 'Monthly price')}
          </p>
          <p className="text-[14px] font-semibold text-[#E5E7EB] tabular-nums mt-0.5">
            {formatMoney(monthlyPrice, currency)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">
            {t('admin.ltv.avgTenure', 'Avg tenure')}
          </p>
          <p className="text-[14px] font-semibold text-[#E5E7EB] tabular-nums mt-0.5">
            {avgTenureMonths == null ? '—' : `${Number(avgTenureMonths).toFixed(1)} ${t('admin.ltv.months', 'mo')}`}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">
            {t('admin.ltv.activeMembers', 'Active members')}
          </p>
          <p className="text-[14px] font-semibold text-[#E5E7EB] tabular-nums mt-0.5">
            {activeMembers ?? 0}
          </p>
        </div>
      </div>

      {/* Pipeline value (active members × LTV) */}
      {pipeline != null && (
        <div className="rounded-xl bg-[#10B981]/8 border border-[#10B981]/20 px-3.5 py-2.5 mb-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[#10B981]/90 font-medium">
              {t('admin.ltv.pipelineLabel', 'Pipeline value (active × LTV)')}
            </p>
            <p className="text-[16px] font-bold text-[#10B981] tabular-nums">
              {formatMoney(pipeline, currency)}
            </p>
          </div>
        </div>
      )}

      {/* Confidence note */}
      {status === 'no_cancellations' ? (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/8">
          <Info size={13} className="text-[#9CA3AF] flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#9CA3AF]">
            {t('admin.ltv.noCancellations', 'No cancellations recorded yet. LTV will appear after the first few exit surveys.')}
          </p>
        </div>
      ) : status === 'low_confidence' ? (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20">
          <AlertTriangle size={13} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#F59E0B]">
            {t('admin.ltv.lowConfidence', { count: sampleSize, defaultValue: 'Based on only {{count}} cancellations — directional, not exact. Confidence grows with more exit surveys.' })}
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-[#6B7280] text-center">
          {t('admin.ltv.basedOn', { count: sampleSize, defaultValue: 'Based on {{count}} cancellations in the last 365 days' })}
        </p>
      )}
    </AdminCard>
  );
}
