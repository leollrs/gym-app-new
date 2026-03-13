import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import { Download } from 'lucide-react';
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

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const from = subDays(new Date(), parseInt(period)).toISOString();

      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('started_at')
        .eq('gym_id', profile.gym_id)
        .eq('status', 'completed')
        .gte('started_at', from)
        .order('started_at', { ascending: true });

      // Daily trend
      const dayMap = {};
      const interval = eachDayOfInterval({ start: subDays(new Date(), parseInt(period)), end: new Date() });
      interval.forEach(d => { dayMap[format(d, 'MMM d')] = 0; });
      (sessions || []).forEach(s => {
        const key = format(new Date(s.started_at), 'MMM d');
        if (key in dayMap) dayMap[key]++;
      });
      setDailyData(Object.entries(dayMap).map(([date, count]) => ({ date, count })));

      // Heatmap: day-of-week × hour
      const heat = {};
      (sessions || []).forEach(s => {
        const d = new Date(s.started_at);
        const key = `${d.getDay()}-${d.getHours()}`;
        heat[key] = (heat[key] || 0) + 1;
      });
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
        { key: 'count', label: 'Workouts' },
      ],
      data: dailyData,
    });
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Attendance</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Workout activity trends</p>
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
          {/* Daily line chart */}
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5 mb-4">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Daily Workouts</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false}
                  interval={Math.floor(dailyData.length / 6)} />
                <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="count" stroke="#D4AF37" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#D4AF37' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Peak hours heatmap */}
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5 overflow-x-auto">
            <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Peak Hours</p>
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
                          title={`${day} ${h}:00 — ${val} workouts`}
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
