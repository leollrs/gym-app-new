import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { BENCHMARKS } from '../../../../lib/benchmarks';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchOnboardingData(gymId) {
  const { data: members, error } = await supabase
    .from('profiles')
    .select('id, is_onboarded')
    .eq('gym_id', gymId)
    .eq('role', 'member');
  if (error) throw error;

  const total     = (members || []).length;
  const onboarded = (members || []).filter(m => m.is_onboarded).length;
  const pct       = total > 0 ? Math.round((onboarded / total) * 100) : 0;

  return { total, onboarded, pct };
}

export default function OnboardingFunnel({ gymId }) {
  const { data: stats = { total: 0, onboarded: 0, pct: 0 }, isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.onboarding(gymId),
    queryFn: () => fetchOnboardingData(gymId),
    enabled: !!gymId,
  });

  if (isLoading) return <CardSkeleton />;
  if (isError) return <ErrorCard message="Failed to load onboarding data" onRetry={refetch} />;

  const donutData = [
    { name: 'Onboarded',     value: stats.onboarded },
    { name: 'Not Onboarded', value: stats.total - stats.onboarded },
  ];

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Onboarding Completion</p>
      <div className="flex items-center gap-6">

        {/* Donut chart */}
        <div className="flex-shrink-0">
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={36}
                outerRadius={54}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                strokeWidth={0}
              >
                <Cell fill="#D4AF37" />
                <Cell fill="rgba(255,255,255,0.06)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Stats */}
        <div className="flex-1">
          <p className="text-[42px] font-bold text-[#D4AF37] leading-none">{stats.pct}%</p>
          <p className="text-[13px] text-[#9CA3AF] mt-1">Completion rate</p>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-[#D4AF37]" />
                <span className="text-[12px] text-[#9CA3AF]">Onboarded</span>
              </div>
              <span className="text-[12px] font-semibold text-[#E5E7EB]">{stats.onboarded}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                <span className="text-[12px] text-[#9CA3AF]">Not completed</span>
              </div>
              <span className="text-[12px] font-semibold text-[#E5E7EB]">
                {stats.total - stats.onboarded}
              </span>
            </div>
            <div className="h-px bg-white/6 my-1" />
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#6B7280]">Total members</span>
              <span className="text-[12px] font-semibold text-[#E5E7EB]">{stats.total}</span>
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-[#6B7280] mt-2 text-center">
        Industry avg: <span className="text-[#D4AF37]">{BENCHMARKS.onboardingCompletion}%</span> onboarding completion
      </p>
    </AdminCard>
  );
}
