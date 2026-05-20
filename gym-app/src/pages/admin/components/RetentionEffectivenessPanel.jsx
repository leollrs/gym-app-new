import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Activity, Send, Inbox, Printer, UserMinus, UserPlus, Loader2, BarChart3, PhoneCall, EyeOff, CheckCircle, UserX, TrendingUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { AdminCard, ErrorCard } from '../../../components/admin';

const OUTCOME_ICON = {
  reached_out: PhoneCall,
  returned:    CheckCircle,
  no_response: EyeOff,
  lost:        UserX,
};

const OUTCOME_COLOR = {
  reached_out: '#60A5FA',
  returned:    '#10B981',
  no_response: '#9CA3AF',
  lost:        '#EF4444',
};

function StatTile({ icon: Icon, label, value, sub, tint = 'gold' }) {
  const palette = {
    gold:    { bg: 'bg-[#D4AF37]/10', text: 'text-[#D4AF37]' },
    green:   { bg: 'bg-[#10B981]/10', text: 'text-[#10B981]' },
    blue:    { bg: 'bg-[#60A5FA]/10', text: 'text-[#60A5FA]' },
    amber:   { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]' },
    red:     { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]' },
    neutral: { bg: 'bg-white/[0.04]', text: 'text-[#9CA3AF]' },
  }[tint];
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${palette.bg}`}>
          <Icon size={13} className={palette.text} />
        </div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280]">{label}</p>
      </div>
      <p className="text-[22px] font-bold text-[#E5E7EB] tabular-nums leading-tight">{value ?? '—'}</p>
      {sub && <p className="text-[10px] text-[#6B7280] mt-0.5">{sub}</p>}
    </div>
  );
}

function HorizontalBarRow({ label, count, denominator, color = '#D4AF37', rightLabel = null }) {
  const pct = denominator > 0 ? (count / denominator) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-medium text-[#E5E7EB] truncate pr-2">{label}</span>
        <span className="text-[#9CA3AF] tabular-nums flex-shrink-0">{rightLabel ?? count}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function RetentionEffectivenessPanel({ gymId }) {
  const { t } = useTranslation('pages');

  const { data, isLoading, error } = useQuery({
    queryKey: ['retention-effectiveness', gymId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_retention_effectiveness', { p_gym_id: gymId });
      if (error) throw error;
      return data;
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  // Reactivation rate (returns / cancellations) — the headline metric.
  const reactivationRate = useMemo(() => {
    const cancel = data?.totals?.cancellations_30d ?? 0;
    const ret    = data?.totals?.returns_30d ?? 0;
    if (cancel === 0) return null;
    return Math.round((ret / cancel) * 100);
  }, [data]);

  // ── 12-week timeseries: chart-ready rows + headline avg reactivation rate ──
  const timeseries = data?.timeseries || [];
  const chartRows = useMemo(() => timeseries.map((w) => ({
    ...w,
    label: w.week_start ? format(parseISO(w.week_start), 'MMM d') : '',
  })), [timeseries]);

  const totalCancelTs = timeseries.reduce((s, w) => s + (w.cancellations || 0), 0);
  const totalReturnsTs = timeseries.reduce((s, w) => s + (w.returns || 0), 0);
  const avgReactivationRateTs = totalCancelTs > 0
    ? Math.round((totalReturnsTs / totalCancelTs) * 100)
    : null;
  const allWeeksZero = timeseries.length > 0 && timeseries.every(
    (w) => (w.cancellations || 0) === 0 && (w.returns || 0) === 0,
  );

  if (isLoading) {
    return (
      <AdminCard>
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin text-[#6B7280]" />
        </div>
      </AdminCard>
    );
  }
  if (error) return <ErrorCard message={error.message} />;
  if (!data) return null;

  const t_ = data.totals || {};

  return (
    <div className="space-y-4">
      {/* ── Last 12 weeks trend chart ── */}
      <AdminCard>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-[#10B981]" />
          <p className="text-[14px] font-bold text-[#E5E7EB]">
            {t('admin.effectiveness.last12WeeksTitle', 'Last 12 weeks')}
          </p>
        </div>

        {(chartRows.length === 0 || allWeeksZero) ? (
          <p className="text-[12px] text-[#6B7280] text-center py-8">
            {t(
              'admin.effectiveness.notEnoughData',
              'Not enough data yet — comes alive after 30 days of activity.',
            )}
          </p>
        ) : (
          <>
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={chartRows}
                  margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                  barCategoryGap={8}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#374151' }}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#374151' }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{
                      backgroundColor: '#111827',
                      border: '1px solid #374151',
                      borderRadius: 8,
                      color: '#E5E7EB',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#9CA3AF' }}
                  />
                  <Bar
                    dataKey="cancellations"
                    name={t('admin.effectiveness.cancellations', 'Cancellations')}
                    fill="#EF4444"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="returns"
                    name={t('admin.effectiveness.returns', 'Returns')}
                    fill="#10B981"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] text-[#9CA3AF] text-center">
              {t(
                'admin.effectiveness.avgReactivationRate',
                'Avg reactivation rate (12w)',
              )}
              :{' '}
              <span className="font-semibold text-[#E5E7EB] tabular-nums">
                {avgReactivationRateTs != null ? `${avgReactivationRateTs}%` : '—'}
              </span>
            </p>
          </>
        )}
      </AdminCard>

      {/* ── Stat grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3">
        <StatTile
          icon={Send}
          label={t('admin.effectiveness.lifecycleSent', 'Lifecycle sent')}
          value={t_.lifecycle_sent_30d}
          sub={t('admin.effectiveness.last30Days', 'last 30 days')}
          tint="gold"
        />
        <StatTile
          icon={UserMinus}
          label={t('admin.effectiveness.winbackSent', 'Win-back sent')}
          value={t_.winback_sent_30d}
          sub={t('admin.effectiveness.last30Days', 'last 30 days')}
          tint="amber"
        />
        <StatTile
          icon={Inbox}
          label={t('admin.effectiveness.queueResolved', 'Queue resolved')}
          value={t_.queue_resolved_30d}
          sub={t('admin.effectiveness.last30Days', 'last 30 days')}
          tint="blue"
        />
        <StatTile
          icon={Printer}
          label={t('admin.effectiveness.cardsDelivered', 'Cards delivered')}
          value={t_.print_cards_delivered_30d}
          sub={t('admin.effectiveness.last30Days', 'last 30 days')}
          tint="gold"
        />
        <StatTile
          icon={UserX}
          label={t('admin.effectiveness.cancellations', 'Cancellations')}
          value={t_.cancellations_30d}
          sub={t('admin.effectiveness.last30Days', 'last 30 days')}
          tint="red"
        />
        <StatTile
          icon={UserPlus}
          label={t('admin.effectiveness.returns', 'Returns')}
          value={t_.returns_30d}
          sub={t('admin.effectiveness.last30Days', 'last 30 days')}
          tint="green"
        />
        <StatTile
          icon={Activity}
          label={t('admin.effectiveness.reactivationRate', 'Reactivation rate')}
          value={reactivationRate != null ? `${reactivationRate}%` : '—'}
          sub={t('admin.effectiveness.returnsOverCancels', 'returns / cancels')}
          tint={reactivationRate >= 30 ? 'green' : reactivationRate >= 15 ? 'amber' : 'neutral'}
        />
        <StatTile
          icon={Send}
          label={t('admin.effectiveness.lifecycleSent7d', 'Sent this week')}
          value={t_.lifecycle_sent_7d}
          sub={t('admin.effectiveness.lifecycleOnly', 'lifecycle only')}
          tint="neutral"
        />
      </div>

      {/* ── Owner queue outcomes ── */}
      <AdminCard>
        <div className="flex items-center gap-2 mb-3">
          <Inbox size={14} className="text-[#60A5FA]" />
          <p className="text-[14px] font-bold text-[#E5E7EB]">
            {t('admin.effectiveness.queueOutcomesTitle', 'Owner queue — resolution outcomes (30d)')}
          </p>
        </div>
        {(!data.queue_outcomes || data.queue_outcomes.length === 0) ? (
          <p className="text-[12px] text-[#6B7280] text-center py-4">
            {t('admin.effectiveness.queueEmpty', 'No resolved cards yet.')}
          </p>
        ) : (
          (() => {
            const totalQ = data.queue_outcomes.reduce((s, r) => s + r.count, 0);
            return (
              <div className="space-y-2.5">
                {data.queue_outcomes.map((row) => {
                  const Icon = OUTCOME_ICON[row.outcome] || EyeOff;
                  const color = OUTCOME_COLOR[row.outcome] || '#9CA3AF';
                  const pct = totalQ > 0 ? Math.round((row.count / totalQ) * 100) : 0;
                  return (
                    <div key={row.outcome} className="space-y-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-1.5 font-medium text-[#E5E7EB]">
                          <Icon size={12} style={{ color }} />
                          {t(`admin.morningQueue.outcomes.${row.outcome}`, row.outcome)}
                        </span>
                        <span className="text-[#9CA3AF] tabular-nums">
                          {row.count} <span className="text-[#6B7280]">· {pct}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </AdminCard>

      {/* ── Winback by category ── */}
      <AdminCard>
        <div className="flex items-center gap-2 mb-3">
          <UserMinus size={14} className="text-[#F59E0B]" />
          <p className="text-[14px] font-bold text-[#E5E7EB]">
            {t('admin.effectiveness.winbackByCategoryTitle', 'Win-back by reason (90d)')}
          </p>
        </div>
        {(!data.winback_by_category || data.winback_by_category.length === 0) ? (
          <p className="text-[12px] text-[#6B7280] text-center py-4">
            {t('admin.effectiveness.winbackEmpty', 'No win-back messages sent yet.')}
          </p>
        ) : (
          <div className="space-y-3">
            {data.winback_by_category.map((row) => {
              const rate = row.sent > 0 ? Math.round((row.returned / row.sent) * 100) : 0;
              return (
                <div key={row.category} className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-semibold text-[#E5E7EB]">
                      {t(`admin.cancellationSurvey.reasons.${row.category}`, row.category)}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF]">
                      {row.returned}/{row.sent} <span className="text-[#6B7280]">· {rate}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#10B981]/70"
                      style={{ width: `${row.sent > 0 ? (row.returned / row.sent) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminCard>

      {/* ── Lifecycle steps sent ── */}
      <AdminCard>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={14} className="text-[#D4AF37]" />
          <p className="text-[14px] font-bold text-[#E5E7EB]">
            {t('admin.effectiveness.lifecycleByStepTitle', 'Lifecycle messages by step (30d)')}
          </p>
        </div>
        {(!data.lifecycle_by_step || data.lifecycle_by_step.length === 0) ? (
          <p className="text-[12px] text-[#6B7280] text-center py-4">
            {t('admin.effectiveness.lifecycleEmpty', 'No lifecycle messages sent yet.')}
          </p>
        ) : (
          (() => {
            const max = Math.max(...data.lifecycle_by_step.map(r => r.sent));
            return (
              <div className="space-y-2">
                {data.lifecycle_by_step.map((row) => (
                  <HorizontalBarRow
                    key={row.step_key}
                    label={row.step_key.replace('_', ' ')}
                    count={row.sent}
                    denominator={max}
                    color="#D4AF37"
                  />
                ))}
              </div>
            );
          })()
        )}
      </AdminCard>
    </div>
  );
}
