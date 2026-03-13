import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { Download, CalendarCheck, Dumbbell, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { exportCSV } from '../../lib/csvExport';

const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am–9pm

const tooltipStyle = {
  contentStyle: { background: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#9CA3AF' },
  itemStyle: { color: '#D4AF37' },
};

export default function AdminAttendance() {
  const { profile } = useAuth();
  const [loading, setLoading]   = useState(true);
  const [dailyData, setDailyData] = useState([]);
  const [heatmap, setHeatmap]   = useState({});   // { 'Mon-9': count }
  const [period, setPeriod]     = useState('30');  // days
  const [summaryStats, setSummaryStats] = useState({ totalCheckins: 0, totalWorkouts: 0, uniqueVisitors: 0, avgPerDay: 0 });

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const from = subDays(new Date(), parseInt(period)).toISOString();

      const [{ data: sessions }, { data: checkIns }] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('started_at')
          .eq('gym_id', profile.gym_id)
          .eq('status', 'completed')
          .gte('started_at', from)
          .order('started_at', { ascending: true }),
        supabase
          .from('check_ins')
          .select('profile_id, checked_in_at')
          .eq('gym_id', profile.gym_id)
          .gte('checked_in_at', from)
          .order('checked_in_at', { ascending: true }),
      ]);

      const sessionList = sessions || [];
      const checkInList = checkIns || [];

      // Daily trend — combined
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
      setDailyData(Object.entries(dayMap).map(([date, vals]) => ({ date, ...vals })));

      // Summary stats
      const uniqueVisitors = new Set(checkInList.map(c => c.profile_id)).size;
      const days = interval.length || 1;
      setSummaryStats({
        totalCheckins: checkInList.length,
        totalWorkouts: sessionList.length,
        uniqueVisitors,
        avgPerDay: (checkInList.length / days).toFixed(1),
      });

      // Heatmap: day-of-week × hour — use check-ins (gym visits)
      const heat = {};
      checkInList.forEach(c => {
        const d = new Date(c.checked_in_at);
        const key = `${d.getDay()}-${d.getHours()}`;
        heat[key] = (heat[key] || 0) + 1;
      });
      // Fall back to workout sessions if no check-ins
      if (checkInList.length === 0) {
        sessionList.forEach(s => {
          const d = new Date(s.started_at);
          const key = `${d.getDay()}-${d.getHours()}`;
          heat[key] = (heat[key] || 0) + 1;
        });
      }
      setHeatmap(heat);

      setLoading(false);
    };
    load();
  }, [profile?.gym_id, period]);

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
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Attendance</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Check-ins and workout activity</p>
        </div>
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
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { icon: CalendarCheck, label: 'Total Check-ins', value: summaryStats.totalCheckins.toLocaleString(), color: '#8B5CF6' },
              { icon: Dumbbell, label: 'Total Workouts', value: summaryStats.totalWorkouts.toLocaleString(), color: '#D4AF37' },
              { icon: Users, label: 'Unique Visitors', value: summaryStats.uniqueVisitors.toLocaleString(), color: '#10B981' },
              { icon: CalendarCheck, label: 'Avg Check-ins / Day', value: summaryStats.avgPerDay, color: '#3B82F6' },
            ].map((s, i) => (
              <div key={i} className="bg-[#0F172A] border border-white/6 rounded-xl p-4 border-l-2 hover:border-white/10 transition-colors duration-300" style={{ borderLeftColor: s.color }}>
                <div className="flex items-center gap-2 mb-2">
                  <s.icon size={13} style={{ color: s.color }} />
                  <span className="text-[11px] text-[#6B7280] font-medium">{s.label}</span>
                </div>
                <p className="text-[22px] font-bold text-[#E5E7EB] leading-none tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Daily line chart — check-ins + workouts */}
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5 mb-4">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Daily Activity</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false}
                  interval={Math.floor(dailyData.length / 6)} />
                <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: '#9CA3AF', paddingTop: 8 }}
                />
                <Line type="monotone" dataKey="checkins" name="Check-ins" stroke="#8B5CF6" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#8B5CF6' }} />
                <Line type="monotone" dataKey="workouts" name="Workouts" stroke="#D4AF37" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#D4AF37' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Peak hours heatmap */}
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5 overflow-x-auto">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-1">Peak Hours</p>
            <p className="text-[11px] text-[#6B7280] mb-4">Based on gym check-ins</p>
            <div className="min-w-[520px]">
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
          </div>
        </>
      )}
    </div>
  );
}
