/**
 * GymWellnessTab — the gym-owner "wellness" KPIs, mirrored into the platform
 * console so the super-admin can read any gym's health per gym.
 *
 * Reuses the exact admin KPI computation (fetchCurrentKPIs) so the numbers
 * match what the gym owner sees on Admin → Analytics, plus a composite health
 * score (same six-factor formula as the cross-gym Gym Health page) and the
 * at-risk/critical churn counts. All reads are gym-scoped and rely on the
 * platform-wide super_admin read access already used by GymHealth — no gated
 * admin RPCs, so it works for any gym the super-admin opens.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { subDays } from 'date-fns';
import {
  HeartPulse, TrendingUp, UserPlus, Flame, Dumbbell, MapPin, AlertTriangle,
  Printer, Loader2,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { fetchCurrentKPIs } from '../../../lib/admin/currentKPIs';
import StatCard from '../../../components/platform/StatCard';

const getScoreColor = (s) => (s >= 80 ? '#10B981' : s >= 60 ? '#22C55E' : s >= 40 ? '#F59E0B' : s >= 20 ? '#F97316' : '#EF4444');

// Same six-factor weighting as the cross-gym Gym Health page (0281 / GymHealth.jsx).
function computeHealthScore({ totalMembers, active30d, sessions30d, checkedIn30d, onboarded, avgChurn, new30d }) {
  if (!totalMembers) return 0;
  const retention = (active30d / totalMembers) * 25;
  const engagement = (Math.min(sessions30d / totalMembers, 12) / 12) * 20;
  const checkin = (checkedIn30d / totalMembers) * 15;
  const onboarding = (onboarded / totalMembers) * 15;
  const churnHealth = ((100 - (avgChurn || 0)) / 100) * 15;
  const growth = (Math.min(new30d / totalMembers, 0.3) / 0.3) * 10;
  return Math.round(Math.min(retention + engagement + checkin + onboarding + churnHealth + growth, 100));
}

export default function GymWellnessTab({ gymId }) {
  const { t } = useTranslation('pages');

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['platform', 'gym-wellness', 'kpis', gymId],
    queryFn: () => fetchCurrentKPIs(gymId),
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['platform', 'gym-wellness', 'health', gymId],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const [profilesRes, sessionsRes, checkInsRes, churnRes, cardsRes] = await Promise.all([
        supabase.from('profiles').select('id, last_active_at, is_onboarded, created_at')
          .eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false).limit(5000),
        supabase.from('workout_sessions').select('profile_id').eq('gym_id', gymId)
          .eq('status', 'completed').gte('started_at', thirtyDaysAgo).limit(5000),
        supabase.from('check_ins').select('profile_id').eq('gym_id', gymId)
          .gte('checked_in_at', thirtyDaysAgo).limit(5000),
        supabase.from('churn_risk_scores').select('profile_id, score').eq('gym_id', gymId).limit(5000),
        supabase.from('print_cards').select('id').eq('gym_id', gymId)
          .eq('status', 'delivered').gte('delivered_at', thirtyDaysAgo).limit(5000),
      ]);

      const members = profilesRes.data || [];
      const sessions = sessionsRes.data || [];
      const checkIns = checkInsRes.data || [];
      const churn = churnRes.data || [];
      const totalMembers = members.length;

      const active30d = members.filter((m) => m.last_active_at && m.last_active_at >= thirtyDaysAgo).length;
      const checkedIn30d = new Set(checkIns.map((c) => c.profile_id)).size;
      const onboarded = members.filter((m) => m.is_onboarded).length;
      const new30d = members.filter((m) => m.created_at >= thirtyDaysAgo).length;
      const avgChurn = churn.length ? churn.reduce((s, c) => s + (c.score || 0), 0) / churn.length : 0;
      const atRisk = churn.filter((c) => c.score >= 60 && c.score < 80).length;
      const critical = churn.filter((c) => c.score >= 80).length;

      const score = computeHealthScore({
        totalMembers, active30d, sessions30d: sessions.length,
        checkedIn30d, onboarded, avgChurn, new30d,
      });

      return { score, atRisk, critical, cardsDelivered30d: (cardsRes.data || []).length, totalMembers };
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const scoreColor = useMemo(() => getScoreColor(health?.score ?? 0), [health?.score]);

  if (kpisLoading || healthLoading) {
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
              {health?.score ?? 0}
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
          <StatCard label={t('platform.gymWellness.critical', 'Critical risk')} value={health?.critical ?? 0} icon={AlertTriangle} borderColor="#EF4444" />
          <StatCard label={t('platform.gymWellness.atRisk', 'At risk')} value={health?.atRisk ?? 0} icon={AlertTriangle} borderColor="#F59E0B" />
          <StatCard label={t('platform.gymWellness.cardsDelivered', 'Cards delivered (30d)')} value={health?.cardsDelivered30d ?? 0} icon={Printer} borderColor="#D4AF37" />
        </div>
      </div>
    </div>
  );
}
