import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Activity, Dumbbell, TrendingUp, TrendingDown, Minus,
  Lightbulb, MessageCircle, PartyPopper, CalendarCheck,
  ArrowUpRight, ArrowDownRight, Clock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import {
  format, subWeeks, subDays, startOfWeek, endOfWeek,
  eachWeekOfInterval, differenceInDays,
} from 'date-fns';
import ChartTooltip from '../../components/ChartTooltip';
import { useTranslation } from 'react-i18next';

/* ---------- helpers ---------- */

const PERIODS = {
  '4w':  { days: 28,  weeks: 4,  label: '4w' },
  '8w':  { days: 56,  weeks: 8,  label: '8w' },
  '12w': { days: 84,  weeks: 12, label: '12w' },
  '6m':  { days: 180, weeks: 26, label: '6m' },
};

const Skeleton = ({ className }) => (
  <div
    className={`bg-white/6 rounded-[10px] ${className}`}
    style={{ animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
  />
);

const CardSkeleton = ({ h = 'h-[220px]' }) => (
  <div className={`bg-[#111827] border border-white/[0.06] rounded-xl p-4 ${h}`}>
    <Skeleton className="h-4 w-36 mb-5" />
    <Skeleton className="h-full w-full" />
  </div>
);

/* ============================================================ */

export default function TrainerAnalytics() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [prs, setPrs] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [period, setPeriod] = useState('8w');

  useEffect(() => { document.title = 'Trainer - Insights | TuGymPR'; }, []);

  /* ---------- data loading ---------- */

  const loadData = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);

    const { data: tcRows, error: tcError } = await supabase
      .from('trainer_clients')
      .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, username, last_active_at)')
      .eq('trainer_id', profile.id)
      .eq('is_active', true);
    if (tcError) logger.error('TrainerAnalytics: failed to load clients:', tcError);

    const assignedClients = (tcRows || []).map(tc => tc.profiles).filter(Boolean);
    setClients(assignedClients);

    if (assignedClients.length === 0) { setLoading(false); return; }

    const clientIds = assignedClients.map(c => c.id);
    const cutoff = subDays(new Date(), PERIODS[period].days).toISOString();

    const [sessRes, prRes, fuRes] = await Promise.all([
      supabase
        .from('workout_sessions')
        .select('id, profile_id, started_at, total_volume_lbs, duration_seconds')
        .in('profile_id', clientIds)
        .eq('status', 'completed')
        .gte('started_at', cutoff)
        .order('started_at', { ascending: true }),
      supabase
        .from('pr_history')
        .select('id, profile_id, exercise_id, old_1rm, new_1rm, achieved_at, exercises(name)')
        .in('profile_id', clientIds)
        .gte('achieved_at', cutoff)
        .order('achieved_at', { ascending: false })
        .limit(50),
      supabase
        .from('trainer_client_notes')
        .select('client_id, created_at')
        .eq('trainer_id', profile.id)
        .in('client_id', clientIds)
        .order('created_at', { ascending: false }),
    ]);

    if (sessRes.error) logger.error('TrainerAnalytics: failed to load sessions:', sessRes.error);
    if (prRes.error) logger.error('TrainerAnalytics: failed to load PRs:', prRes.error);
    if (fuRes.error) logger.error('TrainerAnalytics: failed to load follow-ups:', fuRes.error);

    setSessions(sessRes.data || []);
    setPrs(prRes.data || []);
    setFollowUps(fuRes.data || []);
    setLoading(false);
  }, [profile?.id, period]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ---------- weekly chart data ---------- */

  const weeklyData = useMemo(() => {
    const now = new Date();
    const weeksCount = PERIODS[period].weeks;
    const weeks = eachWeekOfInterval(
      { start: subWeeks(now, weeksCount - 1), end: now },
      { weekStartsOn: 1 },
    );

    return weeks.map(weekStart => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const label = format(weekStart, 'MMM d');

      const weekSessions = sessions.filter(s => {
        const d = new Date(s.started_at);
        return d >= weekStart && d <= weekEnd;
      });

      // Adherence: % of clients who trained at least once that week
      const uniqueClients = new Set(weekSessions.map(s => s.profile_id));
      const adherence = clients.length > 0
        ? Math.round((uniqueClients.size / clients.length) * 100)
        : 0;

      return {
        label,
        workouts: weekSessions.length,
        adherence,
      };
    });
  }, [sessions, clients, period]);

  /* ---------- per-client comparison ---------- */

  const clientComparison = useMemo(() => {
    return clients
      .map(c => {
        const count = sessions.filter(s => s.profile_id === c.id).length;
        return {
          name: c.full_name?.split(' ')[0] || 'Client',
          workouts: count,
        };
      })
      .sort((a, b) => b.workouts - a.workouts);
  }, [clients, sessions]);

  /* ---------- KPIs ---------- */

  const kpis = useMemo(() => {
    const totalWeeks = PERIODS[period].weeks;
    const activeIds = new Set(sessions.map(s => s.profile_id));
    const activeClients = activeIds.size;

    const avgWorkoutsPerWeek = totalWeeks > 0
      ? (sessions.length / totalWeeks).toFixed(1)
      : '0';

    // Adherence: across the full period, avg weekly adherence
    const adherenceValues = weeklyData.map(w => w.adherence);
    const avgAdherence = adherenceValues.length > 0
      ? Math.round(adherenceValues.reduce((s, v) => s + v, 0) / adherenceValues.length)
      : 0;

    // Session completion: sessions done / (active clients * weeks)
    const expectedSessions = clients.length * totalWeeks;
    const sessionCompletion = expectedSessions > 0
      ? Math.round((sessions.length / expectedSessions) * 100)
      : 0;

    return { activeClients, avgWorkoutsPerWeek, avgAdherence, sessionCompletion };
  }, [sessions, clients, weeklyData, period]);

  /* ---------- client rankings ---------- */

  const clientRankings = useMemo(() => {
    const totalWeeks = PERIODS[period].weeks;

    return clients
      .map(c => {
        const clientSessions = sessions.filter(s => s.profile_id === c.id);
        const workouts = clientSessions.length;
        const adherence = totalWeeks > 0
          ? Math.round((workouts / totalWeeks) * 100)
          : 0;

        // Trend: compare last half vs first half of period
        const midpoint = subDays(new Date(), PERIODS[period].days / 2);
        const firstHalf = clientSessions.filter(s => new Date(s.started_at) < midpoint).length;
        const secondHalf = clientSessions.filter(s => new Date(s.started_at) >= midpoint).length;
        const trend = secondHalf > firstHalf ? 'up' : secondHalf < firstHalf ? 'down' : 'flat';

        const lastSession = clientSessions.length > 0
          ? clientSessions[clientSessions.length - 1].started_at
          : c.last_active_at;

        return {
          id: c.id,
          name: c.full_name || c.username || 'Client',
          workouts,
          adherence,
          trend,
          lastActive: lastSession,
        };
      })
      .sort((a, b) => b.adherence - a.adherence);
  }, [clients, sessions, period]);

  /* ---------- trend insights ---------- */

  const insights = useMemo(() => {
    const now = new Date();
    const midpoint = subDays(now, PERIODS[period].days / 2);
    const fourteenDaysAgo = subDays(now, 14);
    const oneWeekAgo = subDays(now, 7);
    const items = [];

    clients.forEach(c => {
      const firstName = c.full_name?.split(' ')[0] || 'Client';
      const clientSessions = sessions.filter(s => s.profile_id === c.id);
      const firstHalf = clientSessions.filter(s => new Date(s.started_at) < midpoint).length;
      const secondHalf = clientSessions.filter(s => new Date(s.started_at) >= midpoint).length;

      // Improving engagement
      if (firstHalf > 0 && secondHalf > firstHalf * 1.25) {
        items.push({
          type: 'improving',
          urgency: 1,
          text: t('trainerAnalytics.insightImproving', { name: firstName }),
          action: 'congrats',
          clientId: c.id,
        });
      }

      // Declining engagement
      if (firstHalf > 0 && secondHalf < firstHalf * 0.6) {
        const dropPct = Math.round(((firstHalf - secondHalf) / firstHalf) * 100);
        items.push({
          type: 'declining',
          urgency: 3,
          text: t('trainerAnalytics.insightDeclining', { name: firstName, pct: dropPct }),
          action: 'message',
          clientId: c.id,
        });
      }
    });

    // Clients who hit PRs recently (last 7 days)
    const recentPrs = prs.filter(pr => new Date(pr.achieved_at) >= oneWeekAgo);
    const prsByClient = {};
    recentPrs.forEach(pr => {
      if (!prsByClient[pr.profile_id]) prsByClient[pr.profile_id] = [];
      prsByClient[pr.profile_id].push(pr);
    });
    Object.entries(prsByClient).forEach(([clientId, clientPrs]) => {
      const client = clients.find(c => c.id === clientId);
      const firstName = client?.full_name?.split(' ')[0] || 'Client';
      items.push({
        type: 'pr',
        urgency: 2,
        text: t('trainerAnalytics.insightPR', { name: firstName, count: clientPrs.length }),
        action: 'congrats',
        clientId,
      });
    });

    // Clients overdue for follow-up (last follow-up > 14 days ago)
    clients.forEach(c => {
      const firstName = c.full_name?.split(' ')[0] || 'Client';
      const lastNote = followUps.find(f => f.client_id === c.id);
      const lastFollowUp = lastNote ? new Date(lastNote.created_at) : null;
      if (!lastFollowUp || lastFollowUp < fourteenDaysAgo) {
        const days = lastFollowUp ? differenceInDays(now, lastFollowUp) : null;
        items.push({
          type: 'followup',
          urgency: 2,
          text: days
            ? t('trainerAnalytics.insightFollowup', { name: firstName, days })
            : t('trainerAnalytics.insightFollowupNever', { name: firstName }),
          action: 'message',
          clientId: c.id,
        });
      }
    });

    items.sort((a, b) => b.urgency - a.urgency);
    return items.slice(0, 6);
  }, [clients, sessions, prs, followUps, period, t]);

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
        <Skeleton className="h-6 w-32 mb-1" />
        <Skeleton className="h-4 w-56 mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-[88px]" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <CardSkeleton /> <CardSkeleton /> <CardSkeleton />
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-1">{t('trainerAnalytics.titleInsights')}</h1>
        <p className="text-[13px] text-[#6B7280] mb-6">{t('trainerAnalytics.subtitle')}</p>
        <div className="text-center py-20">
          <TrendingUp size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">{t('trainerAnalytics.noClients')}</p>
          <p className="text-[12px] text-[#4B5563] mt-1">{t('trainerAnalytics.noClientsDesc')}</p>
        </div>
      </div>
    );
  }

  const TrendIcon = ({ trend }) => {
    if (trend === 'up') return <ArrowUpRight size={14} className="text-emerald-400" />;
    if (trend === 'down') return <ArrowDownRight size={14} className="text-red-400" />;
    return <Minus size={14} className="text-[#6B7280]" />;
  };

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* ---- Header ---- */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{t('trainerAnalytics.titleInsights')}</h1>
          <p className="text-[13px] text-[#6B7280]">{t('trainerAnalytics.subtitle')}</p>
        </div>

        {/* Period selector */}
        <div className="flex gap-1.5">
          {Object.keys(PERIODS).map(key => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-full text-[12px] font-semibold transition-colors ${
                period === key
                  ? 'bg-[#D4AF37] text-[#0F172A]'
                  : 'bg-white/[0.04] text-[#6B7280] hover:bg-white/[0.08]'
              }`}
            >
              {t(`trainerAnalytics.period_${key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Section 1: KPI row ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: t('trainerAnalytics.kpiActiveClients'),
            value: kpis.activeClients,
            icon: Activity,
            color: '#D4AF37',
            bg: 'bg-[#D4AF37]/10',
          },
          {
            label: t('trainerAnalytics.kpiAvgWorkouts'),
            value: kpis.avgWorkoutsPerWeek,
            icon: Dumbbell,
            color: '#D4AF37',
            bg: 'bg-[#D4AF37]/10',
          },
          {
            label: t('trainerAnalytics.kpiAdherence'),
            value: `${kpis.avgAdherence}%`,
            icon: CalendarCheck,
            color: kpis.avgAdherence >= 70 ? '#34D399' : kpis.avgAdherence >= 50 ? '#FBBF24' : '#F87171',
            bg: kpis.avgAdherence >= 70 ? 'bg-emerald-500/10' : kpis.avgAdherence >= 50 ? 'bg-amber-500/10' : 'bg-red-500/10',
          },
          {
            label: t('trainerAnalytics.kpiSessionCompletion'),
            value: `${kpis.sessionCompletion}%`,
            icon: TrendingUp,
            color: kpis.sessionCompletion >= 70 ? '#34D399' : kpis.sessionCompletion >= 50 ? '#FBBF24' : '#F87171',
            bg: kpis.sessionCompletion >= 70 ? 'bg-emerald-500/10' : kpis.sessionCompletion >= 50 ? 'bg-amber-500/10' : 'bg-red-500/10',
          },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-[#111827] rounded-xl border border-white/[0.06] p-4 overflow-hidden">
              <div className={`w-8 h-8 ${card.bg} rounded-full flex items-center justify-center mb-2.5`}>
                <Icon size={16} style={{ color: card.color }} />
              </div>
              <div className="text-[22px] font-bold text-[#E5E7EB] truncate">{card.value}</div>
              <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* ---- Section 2: Trend charts ---- */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {/* Activity Trend */}
        <div className="bg-[#111827] border border-white/[0.08] rounded-xl p-4 overflow-hidden">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.chartActivity')}</p>
          <div className="h-[200px] md:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212,175,55,0.06)' }} />
                <Area
                  type="monotone"
                  dataKey="workouts"
                  stroke="#D4AF37"
                  fill="url(#actGrad)"
                  strokeWidth={2}
                  name={t('trainerAnalytics.chartWorkouts')}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Adherence Trend */}
        <div className="bg-[#111827] border border-white/[0.08] rounded-xl p-4 overflow-hidden">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.chartAdherence')}</p>
          <div className="h-[200px] md:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="adhGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} width={30} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <Tooltip content={<ChartTooltip formatter={v => `${v}%`} />} cursor={{ fill: 'rgba(52,211,153,0.06)' }} />
                <Area
                  type="monotone"
                  dataKey="adherence"
                  stroke="#34D399"
                  fill="url(#adhGrad)"
                  strokeWidth={2}
                  name={t('trainerAnalytics.kpiAdherence')}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Client Progress (bar chart) */}
        <div className="bg-[#111827] border border-white/[0.08] rounded-xl p-4 overflow-hidden md:col-span-2">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-4">{t('trainerAnalytics.chartClientProgress')}</p>
          <div className="h-[200px] md:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientComparison} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212,175,55,0.06)' }} />
                <Bar dataKey="workouts" fill="#D4AF37" radius={[0, 4, 4, 0]} barSize={18} name={t('trainerAnalytics.chartWorkouts')} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ---- Section 3: Actionable Insights ---- */}
      {insights.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2 mb-3">
            <Lightbulb size={16} className="text-[#D4AF37]" />
            {t('trainerAnalytics.sectionInsights')}
          </h2>
          <div className="space-y-2">
            {insights.map((insight, idx) => {
              const iconMap = {
                improving: { Icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                declining: { Icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10' },
                pr:        { Icon: PartyPopper, color: 'text-[#D4AF37]', bg: 'bg-[#D4AF37]/10' },
                followup:  { Icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              };
              const style = iconMap[insight.type] || iconMap.followup;
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
                    <button className="shrink-0 flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
                      <MessageCircle size={12} className="text-amber-400" />
                      <span className="text-[11px] font-medium text-amber-400">{t('trainerAnalytics.message')}</span>
                    </button>
                  )}
                  {insight.action === 'congrats' && (
                    <button className="shrink-0 flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20 transition-colors">
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

      {/* ---- Section 4: Client Rankings ---- */}
      <div className="mb-6">
        <h2 className="text-[14px] font-semibold text-[#E5E7EB] mb-3">{t('trainerAnalytics.sectionRankings')}</h2>
        <div className="bg-[#111827] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_60px_70px_36px_72px] md:grid-cols-[1fr_80px_80px_50px_100px] gap-2 px-4 py-2.5 border-b border-white/[0.06] text-[10px] md:text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">
            <span>{t('trainerAnalytics.colName')}</span>
            <span className="text-right">{t('trainerAnalytics.colWorkouts')}</span>
            <span className="text-right">{t('trainerAnalytics.colAdherence')}</span>
            <span className="text-center">{t('trainerAnalytics.colTrend')}</span>
            <span className="text-right">{t('trainerAnalytics.colLastActive')}</span>
          </div>
          {/* Rows */}
          {clientRankings.map((client, idx) => (
            <div
              key={client.id}
              className={`grid grid-cols-[1fr_60px_70px_36px_72px] md:grid-cols-[1fr_80px_80px_50px_100px] gap-2 px-4 py-3 items-center ${
                idx < clientRankings.length - 1 ? 'border-b border-white/[0.04]' : ''
              }`}
            >
              <span className="text-[13px] text-[#E5E7EB] truncate">{client.name}</span>
              <span className="text-[13px] text-[#9CA3AF] text-right tabular-nums">{client.workouts}</span>
              <span className={`text-[13px] text-right tabular-nums font-medium ${
                client.adherence >= 70 ? 'text-emerald-400' : client.adherence >= 50 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {client.adherence}%
              </span>
              <span className="flex justify-center">
                <TrendIcon trend={client.trend} />
              </span>
              <span className="text-[11px] text-[#6B7280] text-right truncate">
                {client.lastActive
                  ? format(new Date(client.lastActive), 'MMM d')
                  : '—'}
              </span>
            </div>
          ))}
          {clientRankings.length === 0 && (
            <div className="py-8 text-center text-[13px] text-[#4B5563]">
              {t('trainerAnalytics.noClients')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
