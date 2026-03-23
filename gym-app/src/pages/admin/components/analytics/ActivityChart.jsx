import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Download } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

async function fetchActivityData(gymId) {
  const now = new Date();

  const { data: allMembers, error: actMemError } = await supabase
    .from('profiles')
    .select('id, created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member');
  if (actMemError) throw actMemError;

  const members = allMembers || [];
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(now, i));
    const monthEnd   = endOfMonth(subMonths(now, i));

    const totalThatMonth = members.filter(m => new Date(m.created_at) <= monthEnd).length;

    const { data: sessions, error: sessError } = await supabase
      .from('workout_sessions')
      .select('profile_id')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .gte('started_at', monthStart.toISOString())
      .lte('started_at', monthEnd.toISOString());

    if (sessError) throw sessError;
    const uniqueActive = new Set((sessions || []).map(s => s.profile_id)).size;
    const pct = totalThatMonth > 0 ? Math.round((uniqueActive / totalThatMonth) * 100) : 0;

    months.push({
      month: format(subMonths(now, i), 'MMM yy'),
      engagement: pct,
      active: uniqueActive,
      total: totalThatMonth,
    });
  }

  return months;
}

export default function ActivityChart({ gymId }) {
  const { data: activityData = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.activity(gymId),
    queryFn: () => fetchActivityData(gymId),
    enabled: !!gymId,
  });

  const handleExport = () => {
    exportCSV({
      filename: 'engagement',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'engagement', label: 'Engagement %' },
        { key: 'active', label: 'Active' },
        { key: 'total', label: 'Total Members' },
      ],
      data: activityData,
    });
  };

  if (isLoading) return <CardSkeleton h="h-[260px]" />;
  if (isError) return <ErrorCard message="Failed to load engagement data" onRetry={refetch} />;

  return (
    <AdminCard hover className="hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[13px] font-semibold text-[#E5E7EB]">Engagement</p>
          <p className="text-[11px] text-[#6B7280] mt-0.5">% of signed members who logged &ge;1 workout that month</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
        >
          <Download size={13} />
          Export
        </button>
      </div>
      {activityData.length === 0 ? (
        <p className="text-[13px] text-[#6B7280] text-center py-10">No session data yet</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={activityData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-[#1a1f2e] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
                    {label && <p className="text-[#6B7280] text-[11px] mb-1">{label}</p>}
                    <p className="font-semibold text-[#3B82F6]">Engaged: {d.engagement}% ({d.active} / {d.total})</p>
                  </div>
                );
              }}
              cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }}
            />
            <Bar dataKey="engagement" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={1000} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </AdminCard>
  );
}
