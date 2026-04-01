import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { adminKeys } from '../../../../lib/adminQueryKeys';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { exportCSV } from '../../../../lib/csvExport';
import { AdminCard, CardSkeleton, ErrorCard } from '../../../../components/admin';

const cohortCellStyle = (pct) => {
  if (pct === null) return { bg: 'bg-white/4', text: 'text-[#4B5563]' };
  if (pct >= 70)   return { bg: 'bg-emerald-500/20', text: 'text-emerald-400' };
  if (pct >= 40)   return { bg: 'bg-amber-500/20',   text: 'text-amber-400' };
  return                  { bg: 'bg-red-500/20',     text: 'text-red-400' };
};

async function fetchCohortData(gymId) {
  const now = new Date();
  const from = subMonths(startOfMonth(now), 5).toISOString();

  const { data: members, error: cohMemError } = await supabase
    .from('profiles')
    .select('id, created_at')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .gte('created_at', from);
  if (cohMemError) throw cohMemError;

  const { data: sessions, error: cohSessError } = await supabase
    .from('workout_sessions')
    .select('profile_id, started_at')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', from);
  if (cohSessError) throw cohSessError;

  const sessionsByProfile = {};
  (sessions || []).forEach(s => {
    if (!sessionsByProfile[s.profile_id]) sessionsByProfile[s.profile_id] = [];
    sessionsByProfile[s.profile_id].push(new Date(s.started_at));
  });

  const cohortMap = {};
  (members || []).forEach(m => {
    const joinMonth = format(new Date(m.created_at), 'MMM yy');
    if (!cohortMap[joinMonth]) cohortMap[joinMonth] = [];
    cohortMap[joinMonth].push(m);
  });

  const rows = [];
  for (let i = 5; i >= 0; i--) {
    const cohortMonthDate = subMonths(now, i);
    const label           = format(cohortMonthDate, 'MMM yy');
    const cohortMembers   = cohortMap[label] || [];
    const cohortSize      = cohortMembers.length;

    const monthRetention = [0, 1, 2, 3].map(offset => {
      const targetMonth      = subMonths(now, i - offset);
      const targetMonthIndex = i - offset;
      if (targetMonthIndex < 0) return null;

      const targetStart = startOfMonth(targetMonth);
      const targetEnd   = endOfMonth(targetMonth);

      if (cohortSize === 0) return null;

      const activeCount = cohortMembers.filter(m => {
        const memberSessions = sessionsByProfile[m.id] || [];
        return memberSessions.some(d => d >= targetStart && d <= targetEnd);
      }).length;

      return Math.round((activeCount / cohortSize) * 100);
    });

    rows.push({ label, cohortSize, m0: monthRetention[0], m1: monthRetention[1], m2: monthRetention[2], m3: monthRetention[3] });
  }

  return rows;
}

export default function CohortTable({ gymId }) {
  const { data: cohortData = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.analytics.cohort(gymId),
    queryFn: () => fetchCohortData(gymId),
    enabled: !!gymId,
  });

  const handleExport = () => {
    exportCSV({
      filename: 'cohort-retention',
      columns: [
        { key: 'label', label: 'Cohort' },
        { key: 'cohortSize', label: 'Size' },
        { key: 'm0', label: 'Month 0' },
        { key: 'm1', label: 'Month 1' },
        { key: 'm2', label: 'Month 2' },
        { key: 'm3', label: 'Month 3' },
      ],
      data: cohortData,
    });
  };

  if (isLoading) return <CardSkeleton h="h-[260px]" />;
  if (isError) return <ErrorCard message="Failed to load cohort data" onRetry={refetch} />;

  return (
    <AdminCard hover className="overflow-x-auto hover:border-white/10 transition-colors duration-300">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] font-semibold text-[#E5E7EB] min-w-0 flex-1 truncate">Cohort Retention</p>
        <button
          onClick={handleExport}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap"
        >
          <Download size={13} />
          Export
        </button>
      </div>
      {cohortData.length === 0 ? (
        <p className="text-[13px] text-[#6B7280] text-center py-10">No cohort data yet</p>
      ) : (
        <div className="min-w-[480px]">
          {/* Header row */}
          <div className="grid grid-cols-[140px_60px_1fr_1fr_1fr_1fr] gap-2 mb-2">
            <span className="text-[11px] font-medium text-[#6B7280]">Cohort</span>
            <span className="text-[11px] font-medium text-[#6B7280] text-right">Size</span>
            {['Month 0', 'Month 1', 'Month 2', 'Month 3'].map(h => (
              <span key={h} className="text-[11px] font-medium text-[#6B7280] text-center">{h}</span>
            ))}
          </div>

          {/* Data rows */}
          <div className="space-y-1.5">
            {cohortData.map(row => (
              <div key={row.label} className="grid grid-cols-[140px_60px_1fr_1fr_1fr_1fr] gap-2 items-center">
                <span className="text-[13px] text-[#E5E7EB] font-medium">{row.label}</span>
                <span className="text-[12px] text-[#9CA3AF] text-right">{row.cohortSize}</span>
                {[row.m0, row.m1, row.m2, row.m3].map((pct, idx) => {
                  const style = cohortCellStyle(pct);
                  return (
                    <div key={idx} className={`rounded-[7px] px-2 py-1.5 text-center ${style.bg}`}>
                      <span className={`text-[12px] font-semibold ${style.text}`}>
                        {pct === null ? '\u2014' : `${pct}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 flex-wrap">
            {[
              { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: '\u226570% \u2014 Strong' },
              { bg: 'bg-amber-500/20',   text: 'text-amber-400',   label: '40\u201370% \u2014 Moderate' },
              { bg: 'bg-red-500/20',     text: 'text-red-400',     label: '<40% \u2014 Low' },
            ].map(({ bg, text, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-[3px] ${bg}`} />
                <span className={`text-[10px] ${text}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminCard>
  );
}
