import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { Download, CalendarCheck, Dumbbell, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';
import { adminKeys } from '../../lib/adminQueryKeys';
import ChartTooltip from '../../components/ChartTooltip';
import { PageHeader, AdminCard, FadeIn, CardSkeleton, StatCard } from '../../components/admin';

const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am-9pm

export default function AdminAttendance() {
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const [period, setPeriod] = useState('30');

  useEffect(() => { document.title = 'Admin - Attendance | TuGymPR'; }, []);

  // ── Fetch attendance data ──
  const { data, isLoading } = useQuery({
    queryKey: [...adminKeys.attendance(gymId), period],
    queryFn: async () => {
      const from = subDays(new Date(), parseInt(period)).toISOString();

      const [{ data: sessions }, { data: checkIns }] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('started_at')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', from)
          .order('started_at', { ascending: true })
          .limit(5000),
        supabase
          .from('check_ins')
          .select('profile_id, checked_in_at')
          .eq('gym_id', gymId)
          .gte('checked_in_at', from)
          .order('checked_in_at', { ascending: true })
          .limit(5000),
      ]);

      const sessionList = sessions || [];
      const checkInList = checkIns || [];

      // Daily trend
      const dayMap = {};
      const interval = eachDayOfInterval({ start: subDays(new Date(), parseInt(period)), end: new Date() });
      interval.forEach(d => { dayMap[format(d, 'MMM d')] = { workouts: 0, checkins: 0 }; });
      sessionList.forEach(s => {
        const key = format(new Date(s.started_at), 'MMM d');
        if (key in dayMap) dayMap[key].workouts++;
      });
      checkInList.forEach(c => {
        const key = format(new Date(c.checked_in_at), 'MMM d');
        if (key in dayMap) dayMap[key].checkins++;
      });
      const dailyData = Object.entries(dayMap).map(([date, vals]) => ({ date, ...vals }));

      // Summary stats
      const uniqueVisitors = new Set(checkInList.map(c => c.profile_id)).size;
      const days = interval.length || 1;
      const summaryStats = {
        totalCheckins: checkInList.length,
        totalWorkouts: sessionList.length,
        uniqueVisitors,
        avgPerDay: (checkInList.length / days).toFixed(1),
      };

      // Heatmap
      const heat = {};
      checkInList.forEach(c => {
        const d = new Date(c.checked_in_at);
        const day = d.getDay();
        const dayIndex = (day === 0) ? 6 : day - 1;
        const key = `${dayIndex}-${d.getHours()}`;
        heat[key] = (heat[key] || 0) + 1;
      });
      if (checkInList.length === 0) {
        sessionList.forEach(s => {
          const d = new Date(s.started_at);
          const day = d.getDay();
          const dayIndex = (day === 0) ? 6 : day - 1;
          const key = `${dayIndex}-${d.getHours()}`;
          heat[key] = (heat[key] || 0) + 1;
        });
      }

      return { dailyData, summaryStats, heatmap: heat };
    },
    enabled: !!gymId,
  });

  const dailyData = data?.dailyData ?? [];
  const summaryStats = data?.summaryStats ?? { totalCheckins: 0, totalWorkouts: 0, uniqueVisitors: 0, avgPerDay: 0 };
  const heatmap = data?.heatmap ?? {};
  const maxHeat = Math.max(1, ...Object.values(heatmap));

  const heatColor = (val) => {
    if (!val) return 'bg-white/4';
    const intensity = val / maxHeat;
    if (intensity > 0.75) return 'bg-[#D4AF37]';
    if (intensity > 0.5)  return 'bg-[#D4AF37]/70';
    if (intensity > 0.25) return 'bg-[#D4AF37]/35';
    return 'bg-[#D4AF37]/15';
  };

  const handleExport = () => {
    exportCSV({
      filename: 'attendance',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'checkins', label: 'Check-ins' },
        { key: 'workouts', label: 'Workouts' },
      ],
      data: dailyData,
    });
  };

  return (
    <div className="px-4 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title="Attendance"
        subtitle="Check-ins and workout activity"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
            >
              <Download size={13} />
              Export
            </button>
            <div className="flex gap-1.5">
              {['14', '30', '90'].map(d => (
                <button key={d} onClick={() => setPeriod(d)}
                  className={`px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors ${
                    period === d ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF]'
                  }`}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
        }
        className="mb-6"
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => <CardSkeleton key={i} h="h-[90px]" />)}
          </div>
          <CardSkeleton h="h-[260px]" />
          <CardSkeleton h="h-[260px]" />
        </div>
      ) : (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="Total Check-ins" value={summaryStats.totalCheckins} borderColor="#8B5CF6" icon={CalendarCheck} delay={0} />
            <StatCard label="Total Workouts" value={summaryStats.totalWorkouts} borderColor="var(--color-accent)" icon={Dumbbell} delay={60} />
            <StatCard label="Unique Visitors" value={summaryStats.uniqueVisitors} borderColor="#10B981" icon={Users} delay={120} />
            <StatCard label="Avg Check-ins / Day" value={summaryStats.avgPerDay} borderColor="#3B82F6" icon={CalendarCheck} delay={180} />
          </div>

          {/* Daily line chart */}
          <FadeIn delay={100}>
            <AdminCard hover padding="p-5" className="mb-4">
              <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Daily Activity</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }} tickLine={false} axisLine={false}
                    interval={Math.floor(dailyData.length / 6)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-accent-glow)' }} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: 'var(--color-text-muted)', paddingTop: 8 }}
                  />
                  <Line type="monotone" dataKey="checkins" name="Check-ins" stroke="#8B5CF6" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="workouts" name="Workouts" stroke="var(--color-accent)" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </AdminCard>
          </FadeIn>

          {/* Peak hours heatmap */}
          <FadeIn delay={200}>
            <AdminCard hover padding="p-5" className="overflow-x-auto">
              <p className="text-[14px] font-semibold text-[#E5E7EB] mb-1">Peak Hours</p>
              <p className="text-[11px] text-[#6B7280] mb-4">Based on gym check-ins</p>
              <div className="min-w-[520px] md:min-w-0">
                {/* Hour labels */}
                <div className="flex mb-1.5 ml-10">
                  {HOURS.map(h => (
                    <div key={h} className="flex-1 text-center text-[9px] text-[#4B5563]">
                      {h % 3 === 0 ? `${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}` : ''}
                    </div>
                  ))}
                </div>
                {/* Grid */}
                {DAYS.map((day, di) => (
                  <div key={day} className="flex items-center mb-1">
                    <span className="w-10 text-[10px] text-[#6B7280] flex-shrink-0">{day}</span>
                    {HOURS.map(h => {
                      const val = heatmap[`${di}-${h}`] || 0;
                      return (
                        <div key={h} className="flex-1 px-0.5">
                          <div
                            className={`h-6 rounded-[3px] transition-colors ${heatColor(val)}`}
                            title={`${day} ${h}:00 — ${val} check-ins`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
                {/* Legend */}
                <div className="flex items-center gap-2 mt-3 justify-end">
                  <span className="text-[10px] text-[#4B5563]">Less</span>
                  {[0, 0.25, 0.5, 0.75, 1].map(v => (
                    <div key={v} className={`w-5 h-4 rounded-[3px] ${
                      v === 0 ? 'bg-white/4' : v <= 0.25 ? 'bg-[#D4AF37]/15' : v <= 0.5 ? 'bg-[#D4AF37]/35' : v <= 0.75 ? 'bg-[#D4AF37]/70' : 'bg-[#D4AF37]'
                    }`} />
                  ))}
                  <span className="text-[10px] text-[#4B5563]">More</span>
                </div>
              </div>
            </AdminCard>
          </FadeIn>
        </>
      )}
    </div>
  );
}
