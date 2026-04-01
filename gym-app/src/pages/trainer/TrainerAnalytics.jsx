import { useEffect, useState, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Users, Dumbbell, TrendingUp, TrendingDown, Activity, Trophy, ChevronDown, Lightbulb, MessageCircle, PartyPopper, AlertTriangle, Shield } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, subWeeks, startOfWeek, endOfWeek, eachWeekOfInterval, subDays } from 'date-fns';
import ChartTooltip from '../../components/ChartTooltip';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('pages');

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
  const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const activeThisWeek = new Set(
    sessions.filter(s => new Date(s.started_at) >= thisWeekStart).map(s => s.profile_id)
  ).size;
  const avgWorkoutsPerClient = clients.length > 0 ? (totalWorkouts / clients.length).toFixed(1) : '0';

  // --- Actionable Insights (Task 2) ---
  const insights = useMemo(() => {
    const now = new Date();
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    const prevWeekStart = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    const prevWeekEnd = endOfWeek(prevWeekStart, { weekStartsOn: 1 });
    const sevenDaysAgo = subDays(now, 7);
    const items = [];

    // Per-client volume comparison: this week vs last week
    clients.forEach(c => {
      const firstName = c.full_name?.split(' ')[0] || 'Client';
      const thisWeekVol = sessions
        .filter(s => s.profile_id === c.id && new Date(s.started_at) >= currentWeekStart)
        .reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
      const prevWeekVol = sessions
        .filter(s => {
          const d = new Date(s.started_at);
          return s.profile_id === c.id && d >= prevWeekStart && d <= prevWeekEnd;
        })
        .reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);

      if (prevWeekVol > 0 && thisWeekVol < prevWeekVol) {
        const dropPct = Math.round(((prevWeekVol - thisWeekVol) / prevWeekVol) * 100);
        if (dropPct > 15) {
          items.push({
            type: 'decline',
            urgency: 3,
            text: t('trainerAnalytics.insightVolumeDrop', { name: firstName, pct: dropPct }),
            action: 'message',
            clientId: c.id,
          });
        }
      }
    });

    // Clients inactive 7+ days
    const inactiveClients = clients.filter(c => {
      const lastActive = c.last_active_at ? new Date(c.last_active_at) : null;
      return !lastActive || lastActive < sevenDaysAgo;
    });
    if (inactiveClients.length > 0) {
      items.push({
        type: 'inactive',
        urgency: 2,
        text: t('trainerAnalytics.insightInactive', { count: inactiveClients.length }),
        action: 'message',
      });
    }

    // Average sessions/week comparison
    const thisWeekSessions = sessions.filter(s => new Date(s.started_at) >= currentWeekStart);
    const prevWeekSessions = sessions.filter(s => {
      const d = new Date(s.started_at);
      return d >= prevWeekStart && d <= prevWeekEnd;
    });
    if (clients.length > 0) {
      const thisAvg = thisWeekSessions.length / clients.length;
      const prevAvg = prevWeekSessions.length / clients.length;
      if (prevAvg > 0 || thisAvg > 0) {
        const direction = thisAvg >= prevAvg ? 'up' : 'down';
        items.push({
          type: 'avg_sessions',
          urgency: 0,
          text: t('trainerAnalytics.insightAvgSessions', {
            avg: thisAvg.toFixed(1),
            prevAvg: prevAvg.toFixed(1),
            direction: direction === 'up' ? t('trainerAnalytics.up') : t('trainerAnalytics.down'),
          }),
          action: null,
        });
      }
    }

    // Recent PRs this week -- celebrate
    const thisWeekPrs = prs.filter(pr => new Date(pr.achieved_at) >= currentWeekStart);
    // Group by client
    const prsByClient = {};
    thisWeekPrs.forEach(pr => {
      if (!prsByClient[pr.profile_id]) prsByClient[pr.profile_id] = [];
      prsByClient[pr.profile_id].push(pr);
    });
    Object.entries(prsByClient).forEach(([clientId, clientPrs]) => {
      const client = clients.find(c => c.id === clientId);
      const firstName = client?.full_name?.split(' ')[0] || 'Client';
      items.push({
        type: 'pr',
        urgency: 1,
        text: t('trainerAnalytics.insightPR', { name: firstName, count: clientPrs.length }),
        action: 'congrats',
        clientId,
      });
    });

    // Sort by urgency descending (declines first, then inactive, then PRs, then stats)
    items.sort((a, b) => b.urgency - a.urgency);
    return items.slice(0, 5);
  }, [clients, sessions, prs, t]);

  // --- Retention Score (Task 3) ---
  const retentionData = useMemo(() => {
    const now = new Date();
    const weeks = [];
    for (let i = 3; i >= 0; i--) {
      const wStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      const wEnd = endOfWeek(wStart, { weekStartsOn: 1 });
      const activeIds = new Set(
        sessions.filter(s => {
          const d = new Date(s.started_at);
          return d >= wStart && d <= wEnd;
        }).map(s => s.profile_id)
      );
      const score = clients.length > 0 ? Math.round((activeIds.size / clients.length) * 100) : 0;
      weeks.push({
        label: format(wStart, 'MMM d'),
        score,
        active: activeIds.size,
      });
    }
    return weeks;
  }, [clients, sessions]);

  const currentRetention = retentionData.length > 0 ? retentionData[retentionData.length - 1].score : 0;
  const retentionColor = currentRetention >= 80 ? 'var(--color-success)' : currentRetention >= 60 ? 'var(--color-warning)' : 'var(--color-danger)';
  const retentionBg = currentRetention >= 80 ? 'bg-emerald-500/10' : currentRetention >= 60 ? 'bg-amber-500/10' : 'bg-red-500/10';
  const retentionTextColor = currentRetention >= 80 ? 'text-emerald-400' : currentRetention >= 60 ? 'text-amber-400' : 'text-red-400';

  if (loading) {
    return (
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6 truncate">{t('trainerAnalytics.title')}</h1>
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
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6 truncate">{t('trainerAnalytics.title')}</h1>
        <div className="text-center py-20">
          <TrendingUp size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">{t('trainerAnalytics.noClients')}</p>
          <p className="text-[12px] text-[#4B5563] mt-1">{t('trainerAnalytics.noClientsDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6 truncate">{t('trainerAnalytics.title')}</h1>

      {/* Insights Section */}
      {insights.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2 mb-3">
            <Lightbulb size={16} className="text-[#D4AF37]" />
            {t('trainerAnalytics.insights')}
          </h2>
          <div className="space-y-2">
            {insights.map((insight, idx) => {
              const iconMap = {
                decline: { Icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10' },
                inactive: { Icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                pr: { Icon: Trophy, color: 'text-[#D4AF37]', bg: 'bg-[#D4AF37]/10' },
                avg_sessions: { Icon: Activity, color: 'text-blue-400', bg: 'bg-blue-500/10' },
              };
              const style = iconMap[insight.type] || iconMap.avg_sessions;
              const Icon = style.Icon;

              return (
                <div
                  key={idx}
                  className="bg-[#0F172A] border border-white/[0.06] rounded-xl p-3.5 flex items-start gap-3"
                >
                  <div className={`w-8 h-8 rounded-full ${style.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon size={14} className={style.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#E5E7EB] leading-snug">{insight.text}</p>
                  </div>
                  {insight.action === 'message' && (
                    <button className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
                      <MessageCircle size={12} className="text-amber-400" />
                      <span className="text-[11px] font-medium text-amber-400">{t('trainerAnalytics.message')}</span>
                    </button>
                  )}
                  {insight.action === 'congrats' && (
                    <button className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20 transition-colors">
                      <PartyPopper size={12} className="text-[#D4AF37]" />
                      <span className="text-[11px] font-medium text-[#D4AF37]">{t('trainerAnalytics.congrats')}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Retention Score + Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {/* Retention Score Card */}
        <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-4 overflow-hidden col-span-2 md:col-span-1">
          <div className={`w-9 h-9 ${retentionBg} rounded-full flex items-center justify-center mb-3`}>
            <Shield size={18} style={{ color: retentionColor }} />
          </div>
          <div className={`text-[24px] font-bold truncate ${retentionTextColor}`}>
            {currentRetention}%
          </div>
          <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">{t('trainerAnalytics.retentionScore')}</div>
          {/* Mini trend */}
          <div className="flex items-end gap-1 mt-2 h-[20px]">
            {retentionData.map((w, i) => {
              const barColor = w.score >= 80 ? 'bg-emerald-400' : w.score >= 60 ? 'bg-amber-400' : 'bg-red-400';
              const isLast = i === retentionData.length - 1;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className={`w-full rounded-sm ${barColor} ${isLast ? 'opacity-100' : 'opacity-40'}`}
                    style={{ height: `${Math.max(4, (w.score / 100) * 20)}px` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            {retentionData.map((w, i) => (
              <span key={i} className="text-[8px] text-[#4B5563] flex-1 text-center">{w.label.split(' ')[1]}</span>
            ))}
          </div>
        </div>

        {[
          { label: t('trainerAnalytics.totalClients'), value: clients.length, icon: Users, color: 'var(--color-blue)', bg: 'bg-blue-500/10' },
          { label: t('trainerAnalytics.activeThisWeek'), value: activeThisWeek, icon: Activity, color: 'var(--color-success)', bg: 'bg-emerald-500/10' },
          { label: t('trainerAnalytics.workouts12w'), value: totalWorkouts, icon: Dumbbell, color: 'var(--color-accent)', bg: 'bg-[#D4AF37]/10' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-4 overflow-hidden">
              <div className={`w-9 h-9 ${card.bg} rounded-full flex items-center justify-center mb-3`}>
                <Icon size={18} style={{ color: card.color }} />
              </div>
              <div className="text-[24px] font-bold text-[#E5E7EB] truncate">{card.value}</div>
              <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">{card.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Workout Frequency Chart */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.workoutFrequency')}</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="wkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Area type="monotone" dataKey="workouts" stroke="var(--color-accent)" fill="url(#wkGrad)" strokeWidth={2} name="Workouts" dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Volume Trend Chart */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.totalVolume')}</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-blue)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-blue)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${v.toLocaleString()} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Area type="monotone" dataKey="volume" stroke="var(--color-blue)" fill="url(#volGrad)" strokeWidth={2} name="Volume" dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Per-Client Comparison */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.clientWorkouts')}</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientComparison} layout="vertical">
                <XAxis type="number" tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Bar dataKey="workouts" fill="var(--color-accent)" radius={[0, 4, 4, 0]} barSize={18} name="Workouts" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active Clients per Week */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.activeClientsPerWeek')}</p>
          <div className="h-[200px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <XAxis dataKey="label" tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Bar dataKey="activeClients" fill="var(--color-success)" radius={[4, 4, 0, 0]} barSize={20} name="Active Clients" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Body Weight Trends */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('trainerAnalytics.clientWeightTrend')}</p>
            <div className="relative">
              <select
                value={selectedClient}
                onChange={e => setSelectedClient(e.target.value)}
                className="appearance-none bg-[#111827] border border-white/6 rounded-lg pl-3 pr-7 py-1.5 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
              >
                <option value="all">{t('trainerAnalytics.selectClient')}</option>
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
                  {selectedClient === 'all' ? t('trainerAnalytics.selectClientHint') : t('trainerAnalytics.noWeightData')}
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
                  <XAxis dataKey="date" tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--color-text-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                  <Area type="monotone" dataKey="weight" stroke="#8B5CF6" fill="url(#wtGrad)" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent PRs */}
        <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.recentPRs')}</p>
          {prs.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-[12px] text-[#4B5563]">{t('trainerAnalytics.noPRs')}</p>
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
