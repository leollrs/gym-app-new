import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { subDays, format, startOfWeek, startOfDay, endOfDay } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import {
  AlertTriangle, MessageSquare, X, Trophy, Flame,
  Users, TrendingUp, CalendarCheck, ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clients, setClients] = useState([]);
  const [weekSessions, setWeekSessions] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [todaySessions, setTodaySessions] = useState([]);
  const [churnScores, setChurnScores] = useState({});
  const [callModal, setCallModal] = useState(null);
  const [callNote, setCallNote] = useState('');
  const [callOutcome, setCallOutcome] = useState('no_answer');
  const [submittingAction, setSubmittingAction] = useState(null);
  const [recentPRs, setRecentPRs] = useState([]);
  const [activeStreaks, setActiveStreaks] = useState([]);

  useEffect(() => { document.title = `${t('trainerDashboard.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    fetchDashboardData();
  }, [profile?.gym_id, profile?.id]);

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
      const prevWeekStart = startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 }).toISOString();
      const now = new Date().toISOString();
      const todayStart = startOfDay(new Date()).toISOString();
      const todayEnd = endOfDay(new Date()).toISOString();
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();

      // 1. Get assigned client IDs
      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, username, last_active_at, created_at)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
      if (tcError) logger.error('TrainerDashboard: failed to load clients:', tcError);

      const assignedClients = (tcRows || []).map(tc => tc.profiles).filter(Boolean);
      const clientIds = assignedClients.map(c => c.id);

      setClients(assignedClients);

      if (clientIds.length === 0) {
        setWeekSessions([]);
        setUpcomingSessions([]);
        setTodaySessions([]);
        setRecentPRs([]);
        setActiveStreaks([]);
        setLoading(false);
        return;
      }

      // 2. Fetch churn risk scores for clients
      const { data: churnRows, error: churnError } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, score, key_signals, computed_at')
        .in('profile_id', clientIds);
      if (churnError) logger.error('TrainerDashboard: failed to load churn scores:', churnError);

      const churnMap = {};
      (churnRows || []).forEach(row => { churnMap[row.profile_id] = row; });
      setChurnScores(churnMap);

      // 3. Fetch all parallel data
      const [weekRes, , upcomingRes, todayRes, , , prsRes, streaksRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs, duration_seconds')
          .in('profile_id', clientIds)
          .eq('status', 'completed')
          .gte('started_at', weekStart)
          .order('started_at', { ascending: false }),
        supabase
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs, duration_seconds')
          .in('profile_id', clientIds)
          .eq('status', 'completed')
          .gte('started_at', prevWeekStart)
          .lt('started_at', weekStart)
          .order('started_at', { ascending: false }),
        supabase
          .from('trainer_sessions')
          .select('id, client_id, title, scheduled_at, duration_mins, status, profiles!trainer_sessions_client_id_fkey(full_name)')
          .eq('trainer_id', profile.id)
          .gte('scheduled_at', now)
          .in('status', ['scheduled', 'confirmed'])
          .order('scheduled_at', { ascending: true })
          .limit(5),
        supabase
          .from('trainer_sessions')
          .select('id, client_id, title, scheduled_at, duration_mins, status, profiles!trainer_sessions_client_id_fkey(full_name)')
          .eq('trainer_id', profile.id)
          .gte('scheduled_at', todayStart)
          .lte('scheduled_at', todayEnd)
          .in('status', ['scheduled', 'confirmed', 'completed'])
          .order('scheduled_at', { ascending: true }),
        supabase
          .from('trainer_client_notes')
          .select('id, client_id, created_at')
          .eq('trainer_id', profile.id)
          .gte('created_at', sevenDaysAgo),
        supabase
          .from('trainer_followups')
          .select('client_id, created_at')
          .eq('trainer_id', profile.id)
          .in('client_id', clientIds)
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false }),
        supabase
          .from('personal_records')
          .select('id, profile_id, exercise_id, weight_lbs, reps, recorded_at, exercises(name)')
          .in('profile_id', clientIds)
          .gte('recorded_at', sevenDaysAgo)
          .order('recorded_at', { ascending: false })
          .limit(10),
        supabase
          .from('streak_cache')
          .select('profile_id, current_streak_days')
          .in('profile_id', clientIds)
          .gte('current_streak_days', 7),
      ]);

      if (weekRes.error) logger.error('TrainerDashboard: failed to load week sessions:', weekRes.error);
      if (upcomingRes.error) logger.error('TrainerDashboard: failed to load upcoming sessions:', upcomingRes.error);
      if (todayRes.error) logger.error('TrainerDashboard: failed to load today sessions:', todayRes.error);
      if (prsRes.error) logger.error('TrainerDashboard: failed to load PRs:', prsRes.error);
      if (streaksRes.error) logger.error('TrainerDashboard: failed to load streaks:', streaksRes.error);

      setWeekSessions(weekRes.data || []);
      setUpcomingSessions(upcomingRes.data || []);
      setTodaySessions(todayRes.data || []);
      setRecentPRs(prsRes.data || []);
      setActiveStreaks(streaksRes.data || []);

    } catch (err) {
      logger.error('Failed to load dashboard data:', err);
      setError(err?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  // --- Reach-out actions ---


  async function handleCallSubmit() {
    if (!callModal) return;
    setSubmittingAction(`call-${callModal.id}`);
    try {
      await supabase.from('trainer_followups').insert({
        trainer_id: profile.id,
        client_id: callModal.id,
        gym_id: profile.gym_id,
        method: 'call',
        note: callNote || null,
        outcome: callOutcome,
      });
      setCallModal(null);
    } catch (err) {
      logger.error('Failed to log call:', err);
    } finally {
      setSubmittingAction(null);
    }
  }

  const outcomeOptions = [
    { value: 'no_answer', label: t('trainerDashboard.outcomes.noAnswer') },
    { value: 'rescheduled', label: t('trainerDashboard.outcomes.rescheduled') },
    { value: 'coming_back', label: t('trainerDashboard.outcomes.comingBack') },
    { value: 'not_interested', label: t('trainerDashboard.outcomes.notInterested') },
    { value: 'other', label: t('trainerDashboard.outcomes.other') },
  ];

  // Computed stats
  const totalClients = clients.length;
  const activeProfileIds = new Set(weekSessions.map((s) => s.profile_id));
  const activeThisWeek = activeProfileIds.size;
  const workoutsThisWeek = weekSessions.length;
  const activeClientsPct = totalClients > 0 ? Math.round((activeThisWeek / totalClients) * 100) : 0;
  const avgSessionsPerClient = totalClients > 0 ? (workoutsThisWeek / totalClients).toFixed(1) : '0.0';

  // 30-day retention
  const thirtyDaysAgo = subDays(new Date(), 30);
  const activeIn30Days = clients.filter(c => c.last_active_at && new Date(c.last_active_at) >= thirtyDaysAgo).length;
  const retentionPct = totalClients > 0 ? Math.round((activeIn30Days / totalClients) * 100) : 0;

  // Needs Attention: 7+ days inactive OR churn >= 60
  const sevenDaysAgoDate = subDays(new Date(), 7);
  const needsAttentionClients = useMemo(() => {
    return clients
      .filter(c => {
        const lastActive = c.last_active_at ? new Date(c.last_active_at) : null;
        const isInactive = !lastActive || lastActive < sevenDaysAgoDate;
        const churn = churnScores[c.id];
        const isHighChurn = churn && churn.score >= 60;
        return isInactive || isHighChurn;
      })
      .map(c => {
        const lastActive = c.last_active_at ? new Date(c.last_active_at) : null;
        const daysInactive = lastActive ? Math.floor((Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24)) : 30;
        const churn = churnScores[c.id];
        return { client: c, daysInactive, churnScore: churn ? Math.round(churn.score) : null };
      })
      .sort((a, b) => b.daysInactive - a.daysInactive)
      .slice(0, 5);
  }, [clients, churnScores, sevenDaysAgoDate]);

  // Client name map
  const clientMap = {};
  clients.forEach((m) => {
    clientMap[m.id] = m.full_name || m.username || t('trainerDashboard.unknownFallback');
  });

  function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
  }


  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] px-4 py-6 max-w-[480px] mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
            <div className="h-24 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
          </div>
          <div className="h-40 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
          <div className="space-y-3">
            <div className="h-16 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
            <div className="h-16 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
            <div className="h-16 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
          </div>
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] overflow-x-hidden">
        <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-28 md:pb-12" style={{ paddingBottom: 'max(7rem, calc(7rem + env(safe-area-inset-bottom)))' }}>
          <div className="sticky top-0 z-20 backdrop-blur-2xl -mx-3 sm:-mx-6 lg:-mx-8 px-3 sm:px-6 lg:px-8 py-3 mb-4"
            style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 92%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--color-accent)' }}>
              {t('trainerDashboard.title', 'Dashboard')}
            </p>
            <h1 className="text-[22px] font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
              {format(new Date(), 'EEEE, MMMM d', { locale: dateFnsLocale })}
            </h1>
          </div>
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent)]/10 flex items-center justify-center mb-4">
              <Users size={28} style={{ color: 'var(--color-accent)' }} />
            </div>
            <p className="text-[16px] font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
              {t('trainerDashboard.noClients', 'No clients assigned yet')}
            </p>
            <p className="text-[13px] max-w-[320px] mb-5" style={{ color: 'var(--color-text-muted)' }}>
              {t('trainerDashboard.noClientsDesc', 'Your dashboard will come to life once you have clients assigned. Ask your gym admin to assign clients to you.')}
            </p>
            <button
              onClick={() => navigate('/trainer/clients')}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-primary)' }}
            >
              <Users size={15} />
              {t('trainerDashboard.goToClients', 'View Clients')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const todayDate = format(new Date(), 'EEEE, MMMM d', { locale: dateFnsLocale });
  const sessionsToday = todaySessions.length;
  const subtitle = sessionsToday > 0
    ? t('trainerDashboard.subtitleSessions', { count: sessionsToday })
    : todayDate;

  // KPI stat cards data
  const statCards = [
    {
      icon: Users,
      value: `${activeThisWeek}/${totalClients}`,
      label: t('trainerDashboard.kpiActiveClients'),
      sub: t('trainerDashboard.kpiActiveClientsPct', { pct: activeClientsPct }),
      borderColor: '#3B82F6',
    },
    {
      icon: TrendingUp,
      value: avgSessionsPerClient,
      label: t('trainerDashboard.kpiAvgSessions'),
      sub: t('trainerDashboard.kpiThisWeek'),
      borderColor: '#10B981',
    },
    {
      icon: ShieldAlert,
      value: `${retentionPct}%`,
      label: t('trainerDashboard.kpiClientRetention'),
      sub: t('trainerDashboard.kpiLast30Days'),
      borderColor: retentionPct >= 80 ? '#10B981' : retentionPct >= 60 ? '#F59E0B' : '#EF4444',
    },
    {
      icon: CalendarCheck,
      value: workoutsThisWeek,
      label: t('trainerDashboard.kpiThisWeek'),
      sub: t('trainerDashboard.kpiCompletedSessions', { count: workoutsThisWeek }),
      borderColor: '#8B5CF6',
    },
  ];

  // Filter upcoming sessions to next 3 hours only
  const threeHoursFromNow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const nextThreeHours = upcomingSessions.filter(s => new Date(s.scheduled_at) <= threeHoursFromNow);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 md:pb-12 space-y-6 sm:space-y-8">

        {/* ── Header ── */}
        <div className="sticky top-0 z-20 backdrop-blur-2xl -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-4"
          style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 92%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--color-accent)' }}>
            {t('trainerDashboard.title', 'Dashboard')}
          </p>
          <h1 className="text-[22px] font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
            {subtitle}
          </h1>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-red-400">{t('trainerDashboard.errorTitle', 'Failed to load dashboard')}</p>
              <p className="text-[12px] text-red-400/70 mt-0.5 truncate">{error}</p>
            </div>
            <button
              onClick={() => { setError(null); fetchDashboardData(); }}
              className="shrink-0 text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
            >
              {t('trainerDashboard.retry', 'Retry')}
            </button>
          </div>
        )}

        {/* ══════════════ Section 1: KPI Stat Cards ══════════════ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl p-4 border-l-2"
                style={{ borderLeftColor: card.borderColor }}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[18px] sm:text-[22px] lg:text-[26px] font-bold text-[var(--color-text-primary)] leading-tight">{card.value}</p>
                    <p className="text-[12px] font-medium text-[var(--color-text-muted)] mt-1.5 truncate">{card.label}</p>
                    {card.sub && <p className="text-[11px] sm:text-[11px] text-[var(--color-text-muted)] mt-0.5 opacity-80">{card.sub}</p>}
                  </div>
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 bg-white/[0.04]">
                    <Icon size={16} style={{ color: card.borderColor }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ══════════════ Section 2: Needs Attention ══════════════ */}
        {needsAttentionClients.length > 0 && (
          <div>
            <h2 className="text-[16px] md:text-[18px] font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-400" />
              {t('trainerDashboard.needsAttention')}
            </h2>
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
              {needsAttentionClients.map((item) => {
                const name = item.client.full_name || item.client.username || t('trainerDashboard.unknownFallback');
                const hasHighChurn = item.churnScore !== null && item.churnScore >= 60;
                return (
                  <div key={item.client.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${hasHighChurn ? 'bg-red-500/10' : 'bg-orange-500/10'}`}>
                      <span className={`text-[13px] font-semibold ${hasHighChurn ? 'text-red-400' : 'text-orange-400'}`}>
                        {getInitial(name)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[var(--color-text-primary)] font-medium truncate">{name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-orange-400">
                          {item.daysInactive >= 30
                            ? t('trainerDashboard.daysInactive30Plus')
                            : t('trainerDashboard.daysInactive', { count: item.daysInactive })}
                        </span>
                        {hasHighChurn && (
                          <span className="text-[11px] font-bold text-red-400">
                            {t('trainerDashboard.churnLabel')}: {item.churnScore}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: item.client.id });
                        if (convId) navigate(`/trainer/messages/${convId}`);
                      }}
                      className="shrink-0 min-h-[36px] h-8 px-3 rounded-xl bg-blue-500/10 flex items-center gap-1.5 hover:bg-blue-500/20 transition-colors"
                    >
                      <MessageSquare size={13} className="text-blue-400" />
                      <span className="text-[11px] font-medium text-blue-400">{t('trainerDashboard.messageBtn')}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════════════ Section 3: Today's Sessions ══════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {todaySessions.length > 0 && (
          <div>
            <h2 className="text-[16px] md:text-[18px] font-bold text-[var(--color-text-primary)] mb-3">
              {t('trainerDashboard.todaysSchedule')}
            </h2>
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
              {todaySessions.map((session) => {
                const isCompleted = session.status === 'completed';
                return (
                  <div
                    key={session.id}
                    className={`flex items-center gap-2.5 sm:gap-3 px-4 py-3 transition-colors${isCompleted ? ' line-through opacity-50' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[var(--color-text-primary)] font-medium truncate">
                        {session.profiles?.full_name || t('trainerDashboard.clientFallback')}
                      </p>
                      <p className="text-[12px] text-[var(--color-text-muted)] truncate">{session.title}</p>
                    </div>
                    <span className="text-[13px] text-[var(--color-text-secondary)] shrink-0">
                      {format(new Date(session.scheduled_at), 'h:mm a', { locale: dateFnsLocale })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Upcoming Sessions (next 3 hours only) ── */}
        <div>
          <h2 className="text-[16px] md:text-[18px] font-bold text-[var(--color-text-primary)] mb-3">
            {t('trainerDashboard.upcomingSessionsShort')}
          </h2>
          {nextThreeHours.length > 0 ? (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
              {nextThreeHours.map((session) => (
                <div key={session.id} className="flex items-center gap-2.5 sm:gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[var(--color-text-primary)] font-medium truncate">
                      {session.profiles?.full_name || t('trainerDashboard.clientFallback')}
                    </p>
                    <p className="text-[12px] text-[var(--color-text-muted)] truncate">{session.title}</p>
                  </div>
                  <span className="text-[13px] text-[var(--color-text-secondary)] shrink-0">
                    {format(new Date(session.scheduled_at), 'h:mm a', { locale: dateFnsLocale })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerHome.noUpcoming')}
              </p>
            </div>
          )}
        </div>
        </div>

        {/* ══════════════ Section 4: Recent PRs (Celebration) ══════════════ */}
        {recentPRs.length > 0 && (
          <div>
            <h2 className="text-[16px] md:text-[18px] font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
              <Trophy size={16} className="text-[#D4AF37]" />
              <span>{t('trainerDashboard.recentPRs')}</span>
            </h2>
            <div className="bg-[var(--color-bg-card)] border rounded-2xl overflow-hidden divide-y divide-[var(--color-border-subtle)]" style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}>
              {recentPRs.map((pr) => {
                const name = clientMap[pr.profile_id] || t('trainerDashboard.clientFallback');
                return (
                  <div key={pr.id} className="flex items-center gap-3 px-4 py-3.5 group hover:bg-[#D4AF37]/[0.03] transition-colors">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(212, 175, 55, 0.1)' }}>
                      <Trophy size={15} className="text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--color-text-primary)] truncate">
                        <span className="font-semibold">{name}</span>
                        {' '}<span className="text-[#D4AF37] font-medium">{t('trainerDashboard.newPR')}</span>
                      </p>
                      <p className="text-[12px] text-[var(--color-text-muted)] truncate">
                        {pr.exercises?.name || t('trainerDashboard.exerciseFallback')}
                        <span className="mx-1.5 text-[var(--color-text-muted)]">&middot;</span>
                        <span className="font-semibold text-[#D4AF37]">{pr.weight_lbs} {t('common:lbs')}</span>
                        <span className="text-[var(--color-text-muted)]"> x {pr.reps}</span>
                      </p>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                      {format(new Date(pr.recorded_at), 'MMM d', { locale: dateFnsLocale })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════════════ Section 5: Client Streaks ══════════════ */}
        {activeStreaks.length > 0 && (
          <div>
            <h2 className="text-[16px] md:text-[18px] font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
              <Flame size={16} className="text-orange-400" />
              <span>{t('trainerDashboard.clientStreaks')}</span>
            </h2>
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
              {activeStreaks.map((s) => {
                const name = clientMap[s.profile_id] || t('trainerDashboard.clientFallback');
                return (
                  <div key={`streak-${s.profile_id}`} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                      <Flame size={14} className="text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--color-text-primary)] truncate">
                        <span className="font-medium">{name}</span>
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        {t('trainerDashboard.streakDays', { count: s.current_streak_days })}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-orange-400">
                      {s.current_streak_days}d
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Priority Clients removed — redundant with Needs Attention section */}
      </div>

      {/* Call Note Modal */}
      {callModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-default)] w-full max-w-[400px] mx-4 sm:mx-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                {t('trainerDashboard.reachOut.logCall')}
              </h3>
              <button onClick={() => setCallModal(null)} className="p-2 -m-2 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
                <X size={18} />
              </button>
            </div>

            <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
              {callModal.full_name || callModal.username || t('trainerDashboard.clientFallback')}
            </p>

            <label className="text-[12px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5 block">
              {t('trainerDashboard.reachOut.outcome')}
            </label>
            <select
              value={callOutcome}
              onChange={(e) => setCallOutcome(e.target.value)}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14px] text-[var(--color-text-primary)] mb-4 focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
            >
              {outcomeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <label className="text-[12px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5 block">
              {t('trainerDashboard.reachOut.noteLabel')}
            </label>
            <textarea
              value={callNote}
              onChange={(e) => setCallNote(e.target.value)}
              placeholder={t('trainerDashboard.reachOut.notePlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors mb-4"
              rows={3}
            />

            <div className="flex gap-3">
              <button
                onClick={() => setCallModal(null)}
                className="flex-1 py-3 sm:py-2.5 rounded-lg border border-[var(--color-border-subtle)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {t('trainerDashboard.reachOut.cancel')}
              </button>
              <button
                onClick={handleCallSubmit}
                disabled={submittingAction === `call-${callModal.id}`}
                className="flex-1 py-3 sm:py-2.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-bg-primary)] text-[13px] font-semibold transition-colors disabled:opacity-50"
              >
                {submittingAction === `call-${callModal.id}` ? t('trainerDashboard.reachOut.saving') : t('trainerDashboard.reachOut.logCallBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
