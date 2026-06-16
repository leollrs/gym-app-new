/**
 * GymWellnessTab — the gym-owner "wellness" KPIs, mirrored into the platform
 * console so the super-admin can read any gym's health per gym.
 *
 * The composite health score and the at-risk/critical counts come from the SAME
 * platform_gym_stats row that drives GymsOverview and GymHealth (deduped to the
 * latest churn score per member within a 7-day window) — passed down from
 * GymDetail as `statsRow`. This guarantees the Wellness tab can never disagree
 * with the cross-gym views for the same gym, and avoids the old raw
 * churn_risk_scores re-query that counted every member's daily history (a member
 * at-risk for 30 days was counted up to 30×) and the 5000-row truncation. The
 * KPI grid reuses the admin KPI computation (fetchCurrentKPIs) so those numbers
 * match Admin → Analytics.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { subDays } from 'date-fns';
import {
  HeartPulse, TrendingUp, UserPlus, Flame, Dumbbell, MapPin, AlertTriangle,
  Printer, Loader2,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { fetchCurrentKPIs } from '../../../lib/admin/currentKPIs';
import { healthScoreFromStatsRow, colorForScore } from '../../../lib/platform/healthScore';
import StatCard from '../../../components/platform/StatCard';

export default function GymWellnessTab({ gymId, statsRow }) {
  const { t } = useTranslation('pages');

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['platform', 'gym-wellness', 'kpis', gymId],
    queryFn: () => fetchCurrentKPIs(gymId),
    enabled: !!gymId,
    staleTime: 60_000,
  });

  // Cards delivered (30d) is the only headline metric not carried on the
  // platform_gym_stats row, so it gets its own lightweight head-count query
  // (no row fetch, so no truncation).
  const { data: cardsDelivered30d = 0, isLoading: cardsLoading } = useQuery({
    queryKey: ['platform', 'gym-wellness', 'cards', gymId],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const { count } = await supabase
        .from('print_cards')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('status', 'delivered')
        .gte('delivered_at', thirtyDaysAgo);
      return count ?? 0;
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  // Health score + risk counts read from the canonical platform_gym_stats row
  // (deduped, 7-day window) — never a raw churn_risk_scores re-query.
  const score = healthScoreFromStatsRow(statsRow);
  const critical = statsRow?.churn_critical ?? 0;
  const atRisk = statsRow?.churn_high ?? 0;
  const scoreColor = colorForScore(score);

  if (kpisLoading || cardsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={22} className="animate-spin text-[#6B7280]" />
      </div>
    );
  }

  const pct = (v) => (v == null ? '—' : `${v}%`);

  return (
    <div className="space-y-6">
      {/* Health score headline */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${scoreColor}1A`, border: `1px solid ${scoreColor}40` }}
        >
          <HeartPulse size={26} style={{ color: scoreColor }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <p className="text-[34px] font-bold leading-none tabular-nums" style={{ color: scoreColor }}>
              {score ?? '—'}
            </p>
            <span className="text-[13px] text-[#6B7280]">/ 100</span>
          </div>
          <p className="text-[12px] text-[#9CA3AF] mt-1">
            {t('platform.gymWellness.healthScore', 'Composite health score')}
          </p>
        </div>
      </div>

      {/* KPI grid — same six metrics as Admin → Analytics */}
      <div>
        <p className="text-[11px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2.5">
          {t('platform.gymWellness.kpisLabel', 'Wellness KPIs')}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label={t('platform.gymWellness.retention', 'Retention')} value={pct(kpis?.retention_rate)} icon={TrendingUp} color="#10B981" />
          <StatCard label={t('platform.gymWellness.churn', 'Churn rate')} value={pct(kpis?.churn_rate)} icon={AlertTriangle} color="#EF4444" />
          <StatCard label={t('platform.gymWellness.activeRate', 'Active rate')} value={pct(kpis?.active_rate)} icon={Flame} color="#F59E0B" />
          <StatCard label={t('platform.gymWellness.newMembers', 'New members')} value={kpis?.new_members ?? 0} icon={UserPlus} color="#6366F1" />
          <StatCard label={t('platform.gymWellness.avgWorkouts', 'Avg workouts/member')} value={kpis?.avg_workouts ?? 0} icon={Dumbbell} color="#A855F7" />
          <StatCard label={t('platform.gymWellness.checkinRate', 'Check-in rate')} value={pct(kpis?.checkin_rate)} icon={MapPin} color="#60A5FA" />
        </div>
      </div>

      {/* Attention + touchpoints */}
      <div>
        <p className="text-[11px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2.5">
          {t('platform.gymWellness.attentionLabel', 'Needs attention')}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label={t('platform.gymWellness.critical', 'Critical risk')} value={critical} icon={AlertTriangle} borderColor="#EF4444" />
          <StatCard label={t('platform.gymWellness.atRisk', 'At risk')} value={atRisk} icon={AlertTriangle} borderColor="#F59E0B" />
          <StatCard label={t('platform.gymWellness.cardsDelivered', 'Cards delivered (30d)')} value={cardsDelivered30d} icon={Printer} borderColor="#D4AF37" />
        </div>
      </div>
    </div>
  );
}
