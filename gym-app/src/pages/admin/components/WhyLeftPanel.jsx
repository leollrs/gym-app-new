import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { UserX, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { AdminCard } from '../../../components/admin';

const WINDOWS = [
  { key: 30,  labelKey: 'last30',  fallback: 'Last 30 days' },
  { key: 90,  labelKey: 'last90',  fallback: 'Last 90 days' },
  { key: 365, labelKey: 'last365', fallback: 'Last year' },
];

// Hormozi's "% leaks in the bucket" view — categories sorted descending
// by share, percentages bar-graphed against the largest category so the
// owner can see at a glance which leak is biggest.
export default function WhyLeftPanel({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;
  const [windowDays, setWindowDays] = useState(90);

  // Aggregate breakdown via RPC
  const { data: breakdown = [], isLoading: loadingBreakdown } = useQuery({
    queryKey: ['cancellation_breakdown', gymId, windowDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cancellation_reason_breakdown', {
        p_gym_id: gymId,
        p_days_back: windowDays,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // Recent cancellations list (last 20)
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

  const total = useMemo(
    () => breakdown.reduce((sum, r) => sum + (r.count || 0), 0),
    [breakdown],
  );
  const topPct = breakdown[0]?.percentage || 0;

  const labelFor = (cat) =>
    t(`admin.cancellationSurvey.reasons.${cat}`, { defaultValue: cat });

  return (
    <div className="space-y-4">
      {/* Window selector */}
      <div className="flex gap-1.5">
        {WINDOWS.map(w => (
          <button
            key={w.key}
            onClick={() => setWindowDays(w.key)}
            className={`admin-pill ${windowDays === w.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
          >
            {t(`admin.whyLeft.${w.labelKey}`, w.fallback)}
          </button>
        ))}
      </div>

      {/* Breakdown card */}
      <AdminCard>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[14px] font-bold text-[#E5E7EB]">
              {t('admin.whyLeft.breakdownTitle', 'Cancellation reasons')}
            </p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              {t('admin.whyLeft.totalCancellations', { count: total, defaultValue: '{{count}} cancellations' })}
            </p>
          </div>
        </div>

        {loadingBreakdown ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[#6B7280]" />
          </div>
        ) : total === 0 ? (
          <div className="text-center py-10">
            <UserX size={28} className="mx-auto text-[#4B5563] mb-2" />
            <p className="text-[13px] text-[#9CA3AF]">
              {t('admin.whyLeft.empty', 'No cancellations in this window.')}
            </p>
            <p className="text-[11px] text-[#6B7280] mt-1">
              {t('admin.whyLeft.emptyHint', 'When an admin cancels a membership, the reason is captured here.')}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {breakdown.map(row => {
              const widthPct = topPct > 0 ? (row.percentage / topPct) * 100 : 0;
              return (
                <div key={row.category} className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-[#E5E7EB]">{labelFor(row.category)}</span>
                    <span className="text-[#9CA3AF] tabular-nums">
                      {row.count} <span className="text-[#6B7280]">· {Number(row.percentage).toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#EF4444]/60"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminCard>

      {/* Recent cancellations list */}
      <AdminCard>
        <p className="text-[14px] font-bold text-[#E5E7EB] mb-3">
          {t('admin.whyLeft.recentTitle', 'Recent cancellations')}
        </p>
        {loadingRecent ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={18} className="animate-spin text-[#6B7280]" />
          </div>
        ) : recent.length === 0 ? (
          <p className="text-[12px] text-[#6B7280] text-center py-4">
            {t('admin.whyLeft.recentEmpty', 'Nothing logged yet.')}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {recent.map(row => (
              <li key={row.id} className="py-2.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-semibold text-[#E5E7EB] truncate">
                      {row.profiles?.full_name || t('admin.whyLeft.unknownMember', 'Unknown member')}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20">
                      {labelFor(row.category)}
                    </span>
                  </div>
                  {row.details_text && (
                    <p className="text-[11px] text-[#9CA3AF] mt-1 line-clamp-2">"{row.details_text}"</p>
                  )}
                  {row.would_return_if && (
                    <p className="text-[11px] text-[#10B981]/80 mt-1 line-clamp-2">
                      <span className="text-[#6B7280]">{t('admin.whyLeft.returnIfPrefix', 'Would return:')} </span>
                      {row.would_return_if}
                    </p>
                  )}
                  <p className="text-[10px] text-[#6B7280] mt-1">
                    {formatDistanceToNow(new Date(row.recorded_at), { addSuffix: true, ...dateLocale })}
                    {' · '}
                    {t('admin.whyLeft.tenureLabel', { count: row.tenure_days, defaultValue: '{{count}}d member' })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
