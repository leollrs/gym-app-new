import { useEffect, useState, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Users, Dumbbell, TrendingUp, Activity, Trophy, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, subWeeks, startOfWeek, endOfWeek, eachWeekOfInterval, subDays } from 'date-fns';
import ChartTooltip from '../../components/ChartTooltip';

const Skeleton = ({ className }) => (
  <div className={`bg-white/6 rounded-[10px] ${className}`} style={{ animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
);

const CardSkeleton = ({ h = 'h-[220px]' }) => (
  <div className={`bg-[#0F172A] border border-white/6 rounded-xl p-4 ${h}`}>
    <Skeleton className="h-4 w-36 mb-5" />
    <Skeleton className="h-full w-full" />
  </div>
);

export default function TrainerAnalytics() {
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [prs, setPrs] = useState([]);
  const [weights, setWeights] = useState([]);
  const [selectedClient, setSelectedClient] = useState('all');

  useEffect(() => { document.title = 'Trainer - Analytics | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.id) return;
    loadData();
  }, [profile?.id]);

  const loadData = async () => {
    setLoading(true);

    // Get assigned clients
    const { data: tcRows, error: tcError } = await supabase
      .from('trainer_clients')
      .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, username, last_active_at)')
      .eq('trainer_id', profile.id)
      .eq('is_active', true);
    if (tcError) logger.error('TrainerAnalytics: failed to load clients:', tcError);

    const assignedClients = (tcRows || []).map(tc => tc.profiles).filter(Boolean);
    setClients(assignedClients);

    if (assignedClients.length === 0) {
      setLoading(false);
      return;
    }

    const clientIds = assignedClients.map(c => c.id);
    const twelveWeeksAgo = subWeeks(new Date(), 12).toISOString();

    const [sessRes, prRes, weightRes] = await Promise.all([
      supabase
        .from('workout_sessions')
        .select('id, profile_id, started_at, total_volume_lbs, duration_seconds')
        .in('profile_id', clientIds)
        .eq('status', 'completed')
        .gte('started_at', twelveWeeksAgo)
        .order('started_at', { ascending: true }),
      supabase
        .from('pr_history')
        .select('id, profile_id, exercise_id, old_1rm, new_1rm, achieved_at, exercises(name)')
        .in('profile_id', clientIds)
        .gte('achieved_at', twelveWeeksAgo)
        .order('achieved_at', { ascending: false })
        .limit(20),
      supabase
        .from('body_weight_logs')
        .select('profile_id, weight_lbs, logged_at')
        .in('profile_id', clientIds)
        .gte('logged_at', twelveWeeksAgo)
        .order('logged_at', { ascending: true }),
    ]);

    if (sessRes.error) logger.error('TrainerAnalytics: failed to load sessions:', sessRes.error);
    if (prRes.error) logger.error('TrainerAnalytics: failed to load PRs:', prRes.error);
    if (weightRes.error) logger.error('TrainerAnalytics: failed to load weights:', weightRes.error);
    setSessions(sessRes.data || []);
    setPrs(prRes.data || []);
    setWeights(weightRes.data || []);
    setLoading(false);
  };

  // Build weekly data for charts
  const weeklyData = useMemo(() => {
    const now = new Date();
    const weeks = eachWeekOfInterval(
      { start: subWeeks(now, 11), end: now },
      { weekStartsOn: 1 }
    );

    return weeks.map(weekStart => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const label = format(weekStart, 'MMM d');

      const weekSessions = sessions.filter(s => {
        const d = new Date(s.started_at);
        return d >= weekStart && d <= weekEnd;
      });

      const volume = weekSessions.reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
      const uniqueClients = new Set(weekSessions.map(s => s.profile_id)).size;

      return {
        label,
        workouts: weekSessions.length,
        volume: Math.round(volume),
        activeClients: uniqueClients,
      };
    });
  }, [sessions]);

  // Per-client workout counts (last 12 weeks)
  const clientComparison = useMemo(() => {
    return clients
      .map(c => {
        const count = sessions.filter(s => s.profile_id === c.id).length;
        const vol = sessions
          .filter(s => s.profile_id === c.id)
          .reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
        return { name: c.full_name?.split(' ')[0] || 'Client', workouts: count, volume: Math.round(vol) };
      })
      .sort((a, b) => b.workouts - a.workouts);
  }, [clients, sessions]);

  // Weight data for selected client
  const weightChartData = useMemo(() => {
    if (selectedClient === 'all') return [];
    return weights
      .filter(w => w.profile_id === selectedClient)
      .map(w => ({
        date: format(new Date(w.logged_at), 'MMM d'),
        weight: Number(w.weight_lbs),
      }));
  }, [weights, selectedClient]);

  // Stat cards
  const totalWorkouts = sessions.length;
  const activeThisWeek = new Set(
    sessions.filter(s => new Date(s.started_at) >= startOfWeek(new Date(), { weekStartsOn: 1 })).map(s => s.profile_id)
  ).size;
  const avgWorkoutsPerClient = clients.length > 0 ? (totalWorkouts / clients.length).toFixed(1) : '0';

  if (loading) {
    return (
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6">Analytics</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-[100px]" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <CardSkeleton /> <CardSkeleton /> <CardSkeleton /> <CardSkeleton />
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6">Analytics</h1>
        <div className="text-center py-20">
          <TrendingUp size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No clients assigned yet</p>
          <p className="text-[12px] text-[#4B5563] mt-1">Analytics will appear once you have assigned clients</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6">Analytics</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Clients', value: clients.length, icon: Users, color: '#3B82F6', bg: 'bg-blue-500/10' },
          { label: 'Active This Week', value: activeThisWeek, icon: Activity, color: '#10B981', bg: 'bg-emerald-500/10' },
          { label: 'Workouts (12w)', value: totalWorkouts, icon: Dumbbell, color: '#D4AF37', bg: 'bg-[#D4AF37]/10' },
          { label: 'Avg / Client', value: avgWorkoutsPerClient, icon: TrendingUp, color: '#8B5CF6', bg: 'bg-purple-500/10' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-4">
              <div className={`w-9 h-9 ${card.bg} rounded-full flex items-center justify-center mb-3`}>
                <Icon size={18} style={{ color: card.color }} />
              </div>
              <div className="text-[22px] font-bold text-[#E5E7EB]">{card.value}</div>
              <div className="text-[12px] text-[#6B7280] mt-0.5">{card.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Workout Frequency Chart */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Workout Frequency</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="wkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Area type="monotone" dataKey="workouts" stroke="#D4AF37" fill="url(#wkGrad)" strokeWidth={2} name="Workouts" dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Volume Trend Chart */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Total Volume (lbs)</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${v.toLocaleString()} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Area type="monotone" dataKey="volume" stroke="#3B82F6" fill="url(#volGrad)" strokeWidth={2} name="Volume" dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Per-Client Comparison */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Client Workouts (12 weeks)</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientComparison} layout="vertical">
                <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Bar dataKey="workouts" fill="#D4AF37" radius={[0, 4, 4, 0]} barSize={18} name="Workouts" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active Clients per Week */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Active Clients per Week</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Bar dataKey="activeClients" fill="#10B981" radius={[4, 4, 0, 0]} barSize={20} name="Active Clients" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Body Weight Trends */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Client Weight Trend</p>
            <div className="relative">
              <select
                value={selectedClient}
                onChange={e => setSelectedClient(e.target.value)}
                className="appearance-none bg-[#111827] border border-white/6 rounded-lg pl-3 pr-7 py-1.5 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
              >
                <option value="all">Select client</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] pointer-events-none" />
            </div>
          </div>
          <div className="h-[200px] md:h-[300px]">
            {selectedClient === 'all' || weightChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-[12px] text-[#4B5563]">
                  {selectedClient === 'all' ? 'Select a client to view weight trend' : 'No weight data available'}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weightChartData}>
                  <defs>
                    <linearGradient id="wtGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                  <Area type="monotone" dataKey="weight" stroke="#8B5CF6" fill="url(#wtGrad)" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent PRs */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">Recent PRs</p>
          {prs.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-[12px] text-[#4B5563]">No PRs in the last 12 weeks</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] md:max-h-[300px] overflow-y-auto">
              {prs.map(pr => {
                const clientName = clients.find(c => c.id === pr.profile_id)?.full_name?.split(' ')[0] || 'Client';
                const improvement = pr.old_1rm > 0 ? Math.round(pr.new_1rm - pr.old_1rm) : null;
                return (
                  <div key={pr.id} className="flex items-center gap-3 p-2.5 bg-[#111827] rounded-xl">
                    <div className="w-7 h-7 rounded-lg bg-[#D4AF37]/12 flex items-center justify-center flex-shrink-0">
                      <Trophy size={13} className="text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#E5E7EB] truncate">
                        {clientName} — {pr.exercises?.name || 'Exercise'}
                      </p>
                      <p className="text-[10px] text-[#6B7280]">
                        {format(new Date(pr.achieved_at), 'MMM d')}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[12px] font-bold text-[#E5E7EB]">{Math.round(pr.new_1rm)} lbs</p>
                      {improvement !== null && improvement > 0 && (
                        <p className="text-[10px] text-emerald-400">+{improvement} lbs</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
