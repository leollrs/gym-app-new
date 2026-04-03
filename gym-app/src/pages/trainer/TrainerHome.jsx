import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { subDays, format, startOfWeek, startOfDay, endOfDay } from 'date-fns';
import {
  AlertTriangle, Activity, MessageSquare, X, Trophy, Flame, Clock, Eye,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [weekSessions, setWeekSessions] = useState([]);
  const [prevWeekSessions, setPrevWeekSessions] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [todaySessions, setTodaySessions] = useState([]);
  const [churnScores, setChurnScores] = useState({});
  const [trainerNotes, setTrainerNotes] = useState([]);
  const [contactedMap, setContactedMap] = useState({});
  const [callModal, setCallModal] = useState(null);
  const [callNote, setCallNote] = useState('');
  const [callOutcome, setCallOutcome] = useState('no_answer');
  const [submittingAction, setSubmittingAction] = useState(null);
  const [recentPRs, setRecentPRs] = useState([]);
  const [activeStreaks, setActiveStreaks] = useState([]);

  useEffect(() => { document.title = `${t('trainerDashboard.title')} | TuGymPR`; }, [t]);

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
        setPrevWeekSessions([]);
        setUpcomingSessions([]);
        setTodaySessions([]);
        setTrainerNotes([]);
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
      const [weekRes, prevWeekRes, upcomingRes, todayRes, notesRes, followupsRes, prsRes, streaksRes] = await Promise.all([
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
          .select('profile_id, current_streak')
          .in('profile_id', clientIds)
          .gte('current_streak', 7),
      ]);

      if (weekRes.error) logger.error('TrainerDashboard: failed to load week sessions:', weekRes.error);
      if (prevWeekRes.error) logger.error('TrainerDashboard: failed to load prev week sessions:', prevWeekRes.error);
      if (upcomingRes.error) logger.error('TrainerDashboard: failed to load upcoming sessions:', upcomingRes.error);
      if (todayRes.error) logger.error('TrainerDashboard: failed to load today sessions:', todayRes.error);
      if (notesRes.error) logger.error('TrainerDashboard: failed to load notes:', notesRes.error);
      if (prsRes.error) logger.error('TrainerDashboard: failed to load PRs:', prsRes.error);
      if (streaksRes.error) logger.error('TrainerDashboard: failed to load streaks:', streaksRes.error);

      setWeekSessions(weekRes.data || []);
      setPrevWeekSessions(prevWeekRes.data || []);
      setUpcomingSessions(upcomingRes.data || []);
      setTodaySessions(todayRes.data || []);
      setTrainerNotes(notesRes.data || []);
      setRecentPRs(prsRes.data || []);
      setActiveStreaks(streaksRes.data || []);

      // Build contacted map: client_id -> most recent followup date
      const cMap = {};
      (followupsRes.data || []).forEach(row => {
        if (!cMap[row.client_id]) {
          cMap[row.client_id] = row.created_at;
        }
      });
      setContactedMap(cMap);
    } catch (err) {
      logger.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  // --- Reach-out actions ---
  async function logFollowup(clientId, method, note) {
    try {
      const { error } = await supabase.from('trainer_followups').insert({
        trainer_id: profile.id,
        client_id: clientId,
        gym_id: profile.gym_id,
        method,
        note: note || null,
        outcome: null,
      });
      if (error) throw error;
      setContactedMap(prev => ({ ...prev, [clientId]: new Date().toISOString() }));
    } catch (err) {
      logger.error('Failed to log followup:', err);
    }
  }

  async function handlePush(member) {
    setSubmittingAction(`push-${member.id}`);
    try {
      await supabase.from('notifications').insert({
        profile_id: member.id,
        gym_id: profile.gym_id,
        type: 'trainer_message',
        title: t('trainerDashboard.reachOut.pushTitle', { name: profile.full_name || t('trainerDashboard.yourTrainerFallback') }),
        body: t('trainerDashboard.reachOut.pushBody'),
      });
      await logFollowup(member.id, 'push', 'Sent push notification');
    } catch (err) {
      logger.error('Failed to send push:', err);
    } finally {
      setSubmittingAction(null);
    }
  }

  function handleCallOpen(member) {
    setCallModal(member);
    setCallNote('');
    setCallOutcome('no_answer');
  }

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
      setContactedMap(prev => ({ ...prev, [callModal.id]: new Date().toISOString() }));
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

  const fourteenDaysAgo = subDays(new Date(), 14);
  const atRiskClients = clients
    .filter((m) => {
      const churn = churnScores[m.id];
      if (churn) return churn.score >= 30;
      const lastActive = m.last_active_at ? new Date(m.last_active_at) : null;
      return !lastActive || lastActive < fourteenDaysAgo;
    })
    .sort((a, b) => {
      const aScore = churnScores[a.id]?.score ?? 0;
      const bScore = churnScores[b.id]?.score ?? 0;
      if (bScore !== aScore) return bScore - aScore;
      const aDate = a.last_active_at ? new Date(a.last_active_at) : new Date(0);
      const bDate = b.last_active_at ? new Date(b.last_active_at) : new Date(0);
      return aDate - bDate;
    });

  // Unified "needs attention" list: at-risk, volume decline, inactive, follow-up overdue
  const needsAttentionList = useMemo(() => {
    const contactedClientIds = new Set(trainerNotes.map(n => n.client_id));
    const items = [];
    const seenIds = new Set();

    // 1. At-risk clients (highest priority)
    atRiskClients.forEach(c => {
      const churn = churnScores[c.id];
      const score = churn ? Math.round(churn.score) : null;
      items.push({
        client: c,
        reason: score
          ? t('trainerDashboard.attention.atRiskScore', { score })
          : t('trainerDashboard.attention.inactive'),
        priority: 1,
        type: 'at-risk',
      });
      seenIds.add(c.id);
    });

    // 2. Declining volume
    clients.forEach(c => {
      if (seenIds.has(c.id)) return;
      const thisWeekVol = weekSessions
        .filter(s => s.profile_id === c.id)
        .reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
      const prevWeekVol = prevWeekSessions
        .filter(s => s.profile_id === c.id)
        .reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
      if (prevWeekVol > 0 && thisWeekVol < prevWeekVol) {
        const dropPct = Math.round(((prevWeekVol - thisWeekVol) / prevWeekVol) * 100);
        if (dropPct > 20) {
          items.push({
            client: c,
            reason: t('trainerDashboard.attention.volumeDeclined', { pct: dropPct }),
            priority: 2,
            type: 'volume',
          });
          seenIds.add(c.id);
        }
      }
    });

    // 3. Inactive (no workout in 8+ days, not already flagged)
    const eightDaysAgo = subDays(new Date(), 8);
    clients.forEach(c => {
      if (seenIds.has(c.id)) return;
      const lastActive = c.last_active_at ? new Date(c.last_active_at) : null;
      if (!lastActive || lastActive < eightDaysAgo) {
        const days = lastActive ? Math.floor((Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24)) : 30;
        items.push({
          client: c,
          reason: t('trainerDashboard.attention.noActivity', { days }),
          priority: 3,
          type: 'inactive',
        });
        seenIds.add(c.id);
      }
    });

    // 4. Follow-up overdue (no contact in 7+ days, not already flagged)
    clients.forEach(c => {
      if (seenIds.has(c.id)) return;
      if (!contactedClientIds.has(c.id)) {
        items.push({
          client: c,
          reason: t('trainerDashboard.attention.followUpOverdue'),
          priority: 4,
          type: 'followup',
        });
        seenIds.add(c.id);
      }
    });

    items.sort((a, b) => a.priority - b.priority);
    return items;
  }, [clients, atRiskClients, churnScores, weekSessions, prevWeekSessions, trainerNotes, t]);

  // Priority clients for Section 3 (top 5 needing attention)
  const priorityClients = useMemo(() => {
    return needsAttentionList.slice(0, 5).map(item => {
      const daysInactive = getDaysInactive(item.client.last_active_at);
      const churn = churnScores[item.client.id];
      return { ...item, daysInactive, churn };
    });
  }, [needsAttentionList, churnScores]);

  // Client name map
  const clientMap = {};
  clients.forEach((m) => {
    clientMap[m.id] = m.full_name || m.username || t('trainerDashboard.unknownFallback');
  });

  function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  function getDaysInactive(lastActiveAt) {
    if (!lastActiveAt) return '30+';
    return Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24));
  }

  function getChurnLevel(score) {
    if (score >= 80) return { label: t('trainer.churnCritical'), color: 'text-red-400', bg: 'bg-red-500/10' };
    if (score >= 55) return { label: t('trainer.churnHigh'), color: 'text-orange-400', bg: 'bg-orange-500/10' };
    return { label: t('trainer.churnMedium'), color: 'text-yellow-400', bg: 'bg-yellow-500/10' };
  }

  function getAttentionColor(type) {
    switch (type) {
      case 'at-risk': return { text: 'text-red-400', bg: 'bg-red-500/10', icon: AlertTriangle };
      case 'volume': return { text: 'text-amber-400', bg: 'bg-amber-500/10', icon: Activity };
      case 'inactive': return { text: 'text-orange-400', bg: 'bg-orange-500/10', icon: Clock };
      case 'followup': return { text: 'text-blue-400', bg: 'bg-blue-500/10', icon: MessageSquare };
      default: return { text: 'text-[var(--color-text-secondary)]', bg: 'bg-white/[0.04]', icon: AlertTriangle };
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'confirmed': return { label: t('trainerDashboard.statusConfirmed'), cls: 'bg-emerald-500/10 text-emerald-400' };
      case 'completed': return { label: t('trainerDashboard.statusCompleted'), cls: 'bg-blue-500/10 text-blue-400' };
      default: return { label: t('trainerDashboard.statusScheduled'), cls: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' };
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
      </div>
    );
  }

  const todayDate = format(new Date(), 'EEEE, MMMM d');
  const sessionsToday = todaySessions.length;
  const subtitle = sessionsToday > 0
    ? t('trainerDashboard.subtitleSessions', { count: sessionsToday })
    : todayDate;

  // KPI strip items
  const kpis = [
    { label: t('trainerDashboard.kpi.clients'), value: totalClients, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: t('trainerDashboard.kpi.activeWeek'), value: activeThisWeek, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: t('trainerDashboard.kpi.atRisk'), value: atRiskClients.length, color: atRiskClients.length > 0 ? 'text-red-400' : 'text-[var(--color-text-secondary)]', bg: atRiskClients.length > 0 ? 'bg-red-500/10' : 'bg-white/[0.04]' },
    { label: t('trainerDashboard.kpi.sessionsToday'), value: sessionsToday, color: 'text-[var(--color-accent)]', bg: 'bg-[var(--color-accent)]/10' },
    { label: t('trainerDashboard.kpi.sessionsWeek'), value: workoutsThisWeek, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ];

  // Filter upcoming sessions to next 3 hours only
  const threeHoursFromNow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const nextThreeHours = upcomingSessions.filter(s => new Date(s.scheduled_at) <= threeHoursFromNow);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 md:pb-12 space-y-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-[22px] md:text-[28px] font-bold text-[var(--color-text-primary)] truncate">{t('trainerDashboard.title')}</h1>
          <p className="text-[13px] md:text-[14px] text-[var(--color-text-secondary)] mt-0.5">{subtitle}</p>
        </div>

        {/* ── Section 1: KPI Grid (no horizontal scroll) ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl p-4"
            >
              <span className={`text-[20px] lg:text-[24px] font-bold ${kpi.color} block`}>{kpi.value}</span>
              <span className="text-[12px] text-[var(--color-text-muted)] mt-1 block">{kpi.label}</span>
            </div>
          ))}
        </div>

        {/* ── Schedule + Upcoming: side-by-side on lg desktop ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Today's Schedule ── */}
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
                    className={`flex items-center gap-3 px-4 py-3 transition-colors${isCompleted ? ' line-through opacity-50' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[var(--color-text-primary)] font-medium truncate">
                        {session.profiles?.full_name || t('trainerDashboard.clientFallback')}
                      </p>
                      <p className="text-[12px] text-[var(--color-text-muted)] truncate">{session.title}</p>
                    </div>
                    <span className="text-[13px] text-[var(--color-text-secondary)] shrink-0">
                      {format(new Date(session.scheduled_at), 'h:mm a')}
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
                <div key={session.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[var(--color-text-primary)] font-medium truncate">
                      {session.profiles?.full_name || t('trainerDashboard.clientFallback')}
                    </p>
                    <p className="text-[12px] text-[var(--color-text-muted)] truncate">{session.title}</p>
                  </div>
                  <span className="text-[13px] text-[var(--color-text-secondary)] shrink-0">
                    {format(new Date(session.scheduled_at), 'h:mm a')}
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

        {/* ── Priority Clients + Recent Wins: side-by-side on lg desktop ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Priority Clients (ONLY if at-risk clients exist) ── */}
        {priorityClients.length > 0 && (
          <div>
            <h2 className="text-[16px] md:text-[18px] font-bold text-[var(--color-text-primary)] mb-3">
              {t('trainerDashboard.priorityClientsTitle')}
            </h2>
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
              {priorityClients.map((item) => {
                const name = item.client.full_name || item.client.username || t('trainerDashboard.unknownFallback');
                const level = item.churn ? getChurnLevel(item.churn.score) : null;
                return (
                  <div key={item.client.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${level ? level.bg : 'bg-amber-500/10'}`}>
                      <span className={`text-[13px] font-semibold ${level ? level.color : 'text-amber-400'}`}>
                        {getInitial(name)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[var(--color-text-primary)] font-medium truncate">{name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {level && (
                          <span className={`text-[11px] font-bold ${level.color}`}>
                            {t('trainerDashboard.riskLabel')}: {Math.round(item.churn.score)}
                          </span>
                        )}
                        <span className="text-[11px] text-[var(--color-text-muted)]">
                          {item.client.last_active_at
                            ? `${t('trainerDashboard.lastActive')} ${format(new Date(item.client.last_active_at), 'MMM d')}`
                            : t('trainerDashboard.noActivityRecorded')}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/trainer/clients/${item.client.id}`)}
                      className="shrink-0 h-8 px-3 rounded-xl bg-[var(--color-accent)]/10 flex items-center gap-1.5 hover:bg-[var(--color-accent)]/20 transition-colors"
                    >
                      <Eye size={13} className="text-[var(--color-accent)]" />
                      <span className="text-[11px] font-medium text-[var(--color-accent)] hidden sm:inline">{t('trainerDashboard.view')}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recent Wins ── */}
        {(recentPRs.length > 0 || activeStreaks.length > 0) && (
          <div>
            <h2 className="text-[16px] md:text-[18px] font-bold text-[var(--color-text-primary)] mb-3">
              {t('trainerDashboard.recentWins')}
            </h2>
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
              {recentPRs.map((pr) => {
                const name = clientMap[pr.profile_id] || t('trainerDashboard.clientFallback');
                return (
                  <div key={pr.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center shrink-0">
                      <Trophy size={14} className="text-[var(--color-accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--color-text-primary)] truncate">
                        <span className="font-medium">{name}</span>
                        {' '}<span className="text-emerald-400">{t('trainerDashboard.newPR')}</span>
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                        {pr.exercises?.name || t('trainerDashboard.exerciseFallback')} — {pr.weight_lbs} lbs x {pr.reps}
                      </p>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                      {format(new Date(pr.recorded_at), 'MMM d')}
                    </span>
                  </div>
                );
              })}
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
                        {t('trainerDashboard.streakDays', { count: s.current_streak })}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-orange-400">
                      {s.current_streak}d
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Call Note Modal */}
      {callModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-default)] w-full max-w-[400px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                {t('trainerDashboard.reachOut.logCall')}
              </h3>
              <button onClick={() => setCallModal(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
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
                className="flex-1 py-2.5 rounded-lg border border-[var(--color-border-subtle)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {t('trainerDashboard.reachOut.cancel')}
              </button>
              <button
                onClick={handleCallSubmit}
                disabled={submittingAction === `call-${callModal.id}`}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-bg-primary)] text-[13px] font-semibold transition-colors disabled:opacity-50"
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
