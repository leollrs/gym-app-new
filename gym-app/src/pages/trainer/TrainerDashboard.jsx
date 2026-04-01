import { useEffect, useState, useRef, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { subDays, format, startOfWeek } from 'date-fns';
import { Users, Dumbbell, TrendingUp, AlertTriangle, Activity, ChevronRight, CalendarDays, MessageCircle, TrendingDown, MessageSquare, Bell, Phone, X, Check } from 'lucide-react';
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
  const [recentSessions, setRecentSessions] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [churnScores, setChurnScores] = useState({});
  const [trainerNotes, setTrainerNotes] = useState([]);
  const [contactedMap, setContactedMap] = useState({});
  const [callModal, setCallModal] = useState(null);
  const [callNote, setCallNote] = useState('');
  const [callOutcome, setCallOutcome] = useState('no_answer');
  const [submittingAction, setSubmittingAction] = useState(null);
  const atRiskRef = useRef(null);

  useEffect(() => { document.title = 'Trainer - Dashboard | TuGymPR'; }, []);

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
        setRecentSessions([]);
        setUpcomingSessions([]);
        setTrainerNotes([]);
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

      // 3. Fetch week sessions, prev week sessions, recent sessions, upcoming sessions, and notes
      const [weekRes, prevWeekRes, recentRes, upcomingRes, notesRes, followupsRes] = await Promise.all([
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
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs')
          .in('profile_id', clientIds)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(8),
        supabase
          .from('trainer_sessions')
          .select('id, client_id, title, scheduled_at, duration_mins, status, profiles!trainer_sessions_client_id_fkey(full_name)')
          .eq('trainer_id', profile.id)
          .gte('scheduled_at', now)
          .in('status', ['scheduled', 'confirmed'])
          .order('scheduled_at', { ascending: true })
          .limit(5),
        supabase
          .from('trainer_client_notes')
          .select('id, client_id, created_at')
          .eq('trainer_id', profile.id)
          .gte('created_at', subDays(new Date(), 7).toISOString()),
        supabase
          .from('trainer_followups')
          .select('client_id, created_at')
          .eq('trainer_id', profile.id)
          .in('client_id', clientIds)
          .gte('created_at', subDays(new Date(), 7).toISOString())
          .order('created_at', { ascending: false }),
      ]);

      if (weekRes.error) logger.error('TrainerDashboard: failed to load week sessions:', weekRes.error);
      if (prevWeekRes.error) logger.error('TrainerDashboard: failed to load prev week sessions:', prevWeekRes.error);
      if (recentRes.error) logger.error('TrainerDashboard: failed to load recent sessions:', recentRes.error);
      if (upcomingRes.error) logger.error('TrainerDashboard: failed to load upcoming sessions:', upcomingRes.error);
      if (notesRes.error) logger.error('TrainerDashboard: failed to load notes:', notesRes.error);
      setWeekSessions(weekRes.data || []);
      setPrevWeekSessions(prevWeekRes.data || []);
      setRecentSessions(recentRes.data || []);
      setUpcomingSessions(upcomingRes.data || []);
      setTrainerNotes(notesRes.data || []);

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

  async function handleSMS(member) {
    setSubmittingAction(`sms-${member.id}`);
    try {
      await supabase.from('notifications').insert({
        profile_id: member.id,
        gym_id: profile.gym_id,
        type: 'trainer_message',
        title: t('trainerDashboard.reachOut.smsTitle', { name: profile.full_name || 'Your trainer' }),
        body: t('trainerDashboard.reachOut.smsBody'),
      });
      await logFollowup(member.id, 'sms', 'Sent SMS notification');
    } catch (err) {
      logger.error('Failed to send SMS:', err);
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handlePush(member) {
    setSubmittingAction(`push-${member.id}`);
    try {
      await supabase.from('notifications').insert({
        profile_id: member.id,
        gym_id: profile.gym_id,
        type: 'trainer_message',
        title: t('trainerDashboard.reachOut.pushTitle', { name: profile.full_name || 'Your trainer' }),
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

  const workoutsThisWeek = weekSessions.length;

  // Weekly priority digest computations
  const priorityDigest = useMemo(() => {
    const sevenDaysAgo = subDays(new Date(), 7);
    const contactedClientIds = new Set(trainerNotes.map(n => n.client_id));

    // Clients needing follow-up: no note/contact in 7+ days
    const needFollowUp = clients.filter(c => !contactedClientIds.has(c.id));

    // Clients with declining volume (>20% drop week-over-week)
    const decliningVolume = [];
    clients.forEach(c => {
      const thisWeekVol = weekSessions
        .filter(s => s.profile_id === c.id)
        .reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
      const prevWeekVol = prevWeekSessions
        .filter(s => s.profile_id === c.id)
        .reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
      if (prevWeekVol > 0 && thisWeekVol < prevWeekVol) {
        const dropPct = Math.round(((prevWeekVol - thisWeekVol) / prevWeekVol) * 100);
        if (dropPct > 20) {
          decliningVolume.push({
            ...c,
            dropPct,
            thisWeekVol,
            prevWeekVol,
          });
        }
      }
    });
    decliningVolume.sort((a, b) => b.dropPct - a.dropPct);

    return { needFollowUp, decliningVolume };
  }, [clients, weekSessions, prevWeekSessions, trainerNotes]);

  const hasPriorityItems = atRiskClients.length > 0 || priorityDigest.needFollowUp.length > 0 || priorityDigest.decliningVolume.length > 0;

  // Map client id -> name
  const clientMap = {};
  clients.forEach((m) => {
    clientMap[m.id] = m.full_name || m.username || 'Unknown';
  });

  function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  function getDaysInactive(lastActiveAt) {
    if (!lastActiveAt) return '30+';
    const days = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24));
    return days;
  }

  function getChurnLevel(score) {
    if (score >= 80) return { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10' };
    if (score >= 55) return { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/10' };
    return { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/10' };
  }

  function formatVolume(lbs) {
    if (!lbs) return '\u2014';
    if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k lbs`;
    return `${Math.round(lbs)} lbs`;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = [
    {
      label: t('trainerDashboard.myClients'),
      value: totalClients,
      icon: Users,
      color: 'var(--color-blue)',
      bg: 'bg-blue-500/10',
    },
    {
      label: t('trainerDashboard.activeThisWeek'),
      value: activeThisWeek,
      icon: Activity,
      color: 'var(--color-success)',
      bg: 'bg-emerald-500/10',
    },
    {
      label: t('trainerDashboard.atRisk'),
      value: atRiskClients.length,
      icon: AlertTriangle,
      color: 'var(--color-warning)',
      bg: 'bg-amber-500/10',
    },
    {
      label: t('trainerDashboard.workoutsThisWeek'),
      value: workoutsThisWeek,
      icon: Dumbbell,
      color: 'var(--color-accent)',
      bg: 'bg-[#D4AF37]/10',
    },
  ];

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="max-w-[480px] mx-auto md:max-w-4xl px-4 py-6 pb-28 md:pb-12">
        {/* Header */}
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6 truncate">{t('trainerDashboard.title')}</h1>

        {/* This Week's Priority Card */}
        {hasPriorityItems && (
          <div className="mb-8 bg-[#0F172A] rounded-2xl border-2 border-[#D4AF37]/40 p-5 overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-[#D4AF37]/10 rounded-full flex items-center justify-center">
                <AlertTriangle size={16} className="text-[#D4AF37]" />
              </div>
              <h2 className="text-[15px] font-bold text-[#D4AF37]">
                {t('trainerDashboard.weeklyPriority')}
              </h2>
            </div>

            <ul className="space-y-3">
              {atRiskClients.length > 0 && (
                <li>
                  <button
                    onClick={() => atRiskRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="w-full flex items-start gap-3 text-left group"
                  >
                    <div className="w-5 h-5 mt-0.5 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                      <AlertTriangle size={11} className="text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#E5E7EB] group-hover:text-[#D4AF37] transition-colors">
                        <span className="font-semibold text-red-400">{atRiskClients.length}</span>{' '}
                        {t('trainerDashboard.priorityAtRisk', { count: atRiskClients.length })}
                      </p>
                      <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                        {atRiskClients.slice(0, 3).map(c => (c.full_name || c.username || '').split(' ')[0]).join(', ')}
                        {atRiskClients.length > 3 ? ` +${atRiskClients.length - 3}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-[#6B7280] mt-1 shrink-0 group-hover:text-[#D4AF37] transition-colors" />
                  </button>
                </li>
              )}

              {priorityDigest.needFollowUp.length > 0 && (
                <li>
                  <button
                    onClick={() => navigate('/trainer/clients')}
                    className="w-full flex items-start gap-3 text-left group"
                  >
                    <div className="w-5 h-5 mt-0.5 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                      <MessageCircle size={11} className="text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#E5E7EB] group-hover:text-[#D4AF37] transition-colors">
                        <span className="font-semibold text-amber-400">{priorityDigest.needFollowUp.length}</span>{' '}
                        {t('trainerDashboard.priorityFollowUp', { count: priorityDigest.needFollowUp.length })}
                      </p>
                      <p className="text-[11px] text-[#6B7280] mt-0.5">
                        {t('trainerDashboard.noContactIn7Days')}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-[#6B7280] mt-1 shrink-0 group-hover:text-[#D4AF37] transition-colors" />
                  </button>
                </li>
              )}

              {priorityDigest.decliningVolume.length > 0 && (
                <li>
                  <button
                    onClick={() => navigate('/trainer/analytics')}
                    className="w-full flex items-start gap-3 text-left group"
                  >
                    <div className="w-5 h-5 mt-0.5 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                      <TrendingDown size={11} className="text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#E5E7EB] group-hover:text-[#D4AF37] transition-colors">
                        <span className="font-semibold text-purple-400">{priorityDigest.decliningVolume.length}</span>{' '}
                        {t('trainerDashboard.priorityDecliningVolume', { count: priorityDigest.decliningVolume.length })}
                      </p>
                      <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                        {priorityDigest.decliningVolume.slice(0, 2).map(c =>
                          `${(c.full_name || '').split(' ')[0]} -${c.dropPct}%`
                        ).join(', ')}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-[#6B7280] mt-1 shrink-0 group-hover:text-[#D4AF37] transition-colors" />
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-4 overflow-hidden"
              >
                <div
                  className={`w-9 h-9 ${card.bg} rounded-full flex items-center justify-center mb-3`}
                >
                  <Icon size={18} style={{ color: card.color }} />
                </div>
                <div className="text-[24px] font-bold text-[#E5E7EB] truncate">{card.value}</div>
                <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">{card.label}</div>
              </div>
            );
          })}
        </div>

        {/* Upcoming Sessions + At-Risk Clients -- side by side on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

        {/* Upcoming Sessions */}
        {upcomingSessions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <CalendarDays size={16} className="text-[#3B82F6]" />
                {t('trainerDashboard.upcomingSessions')}
              </h2>
              <button
                onClick={() => navigate('/trainer/schedule')}
                className="text-[12px] text-[#D4AF37] flex items-center gap-0.5 hover:text-[#E5C94B] transition-colors"
              >
                {t('trainerDashboard.viewAll')} <ChevronRight size={14} />
              </button>
            </div>
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
              {upcomingSessions.map((session) => (
                <div key={session.id} className="flex items-center gap-3 p-4 hover:border-white/20 hover:bg-white/[0.03] transition-all">
                  <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <CalendarDays size={16} className="text-[#3B82F6]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[#E5E7EB] font-medium truncate">
                      {session.profiles?.full_name || 'Client'}
                    </p>
                    <p className="text-[11px] text-[#6B7280]">{session.title}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] text-[#9CA3AF]">
                      {format(new Date(session.scheduled_at), 'EEE, MMM d')}
                    </p>
                    <p className="text-[11px] text-[#6B7280]">
                      {format(new Date(session.scheduled_at), 'h:mm a')} · {session.duration_mins}m
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* At-Risk Clients */}
        <div ref={atRiskRef}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              {t('trainerDashboard.atRiskClients')}
            </h2>
            {atRiskClients.length > 5 && (
              <span className="text-[12px] text-[#D4AF37] flex items-center gap-0.5">
                {t('trainerDashboard.viewAll')} <ChevronRight size={14} />
              </span>
            )}
          </div>

          {atRiskClients.length === 0 ? (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-6 text-center">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <TrendingUp size={20} className="text-[#10B981]" />
              </div>
              <p className="text-[14px] text-[#10B981] font-medium">{t('trainerDashboard.allClientsActive')}</p>
              <p className="text-[12px] text-[#6B7280] mt-1">
                {t('trainerDashboard.allClientsActiveDesc')}
              </p>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
              {atRiskClients.slice(0, 5).map((member) => {
                const name = member.full_name || member.username || 'Unknown';
                const daysInactive = getDaysInactive(member.last_active_at);
                const churn = churnScores[member.id];
                const level = churn ? getChurnLevel(churn.score) : null;
                const signals = churn?.key_signals
                  ? (Array.isArray(churn.key_signals) ? churn.key_signals : []).slice(0, 2)
                  : [];
                const lastContacted = contactedMap[member.id];
                return (
                  <div key={member.id} className="p-4 hover:bg-white/[0.03] transition-all">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${level ? level.bg : 'bg-amber-500/10'}`}>
                        <span className={`text-[13px] font-semibold ${level ? level.color : 'text-amber-500'}`}>
                          {getInitial(name)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] text-[#E5E7EB] font-medium truncate">{name}</p>
                          {churn && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${level.bg} ${level.color}`}>
                              {Math.round(churn.score)}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#6B7280]">
                          {member.last_active_at
                            ? `${t('trainerDashboard.lastActive')} ${format(new Date(member.last_active_at), 'MMM d')}`
                            : t('trainerDashboard.noActivityRecorded')}
                        </p>
                        {signals.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {signals.map((sig, i) => (
                              <span key={i} className="text-[10px] text-[#9CA3AF] bg-white/[0.04] px-1.5 py-0.5 rounded">
                                {sig}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {churn ? (
                          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${level.bg} ${level.color}`}>
                            {level.label}
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500">
                            {t('trainerDashboard.inactiveDays', { count: daysInactive })}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Reach-out actions + contacted badge */}
                    <div className="flex items-center gap-2 mt-3 ml-12">
                      <button
                        onClick={() => handleSMS(member)}
                        disabled={submittingAction === `sms-${member.id}`}
                        title={t('trainerDashboard.reachOut.sms')}
                        className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                      >
                        <MessageSquare size={14} className="text-[#3B82F6]" />
                      </button>
                      <button
                        onClick={() => handlePush(member)}
                        disabled={submittingAction === `push-${member.id}`}
                        title={t('trainerDashboard.reachOut.push')}
                        className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                      >
                        <Bell size={14} className="text-[#A855F7]" />
                      </button>
                      <button
                        onClick={() => handleCallOpen(member)}
                        title={t('trainerDashboard.reachOut.call')}
                        className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center hover:bg-emerald-500/20 transition-colors"
                      >
                        <Phone size={14} className="text-[#10B981]" />
                      </button>

                      {lastContacted && (
                        <div className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10">
                          <Check size={10} className="text-[#10B981]" />
                          <span className="text-[10px] font-medium text-[#10B981]">
                            {t('trainerDashboard.contacted')} {format(new Date(lastContacted), 'MMM d')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2 mb-3">
            <Activity size={16} className="text-[#D4AF37]" />
            {t('trainerDashboard.recentActivity')}
          </h2>

          {recentSessions.length === 0 ? (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-6 text-center">
              <p className="text-[13px] text-[#6B7280]">{t('trainerDashboard.noRecentWorkouts')}</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
              {recentSessions.map((session) => {
                const memberName = clientMap[session.profile_id] || 'Client';
                return (
                  <div key={session.id} className="flex items-center gap-3 p-4 hover:bg-white/[0.03] transition-all">
                    <div className="w-9 h-9 rounded-full bg-[#D4AF37]/10 flex items-center justify-center shrink-0">
                      <Dumbbell size={16} className="text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[#E5E7EB] font-medium truncate">
                        {memberName}
                      </p>
                      <p className="text-[11px] text-[#6B7280] truncate">
                        {session.name || 'Workout'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] text-[#9CA3AF]">
                        {formatVolume(session.total_volume_lbs)}
                      </p>
                      <p className="text-[11px] text-[#6B7280]">
                        {format(new Date(session.started_at), 'MMM d')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Call Note Modal */}
      {callModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#0F172A] rounded-2xl border border-white/[0.08] w-full max-w-[400px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-[#E5E7EB]">
                {t('trainerDashboard.reachOut.logCall')}
              </h3>
              <button onClick={() => setCallModal(null)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
                <X size={18} />
              </button>
            </div>

            <p className="text-[13px] text-[#9CA3AF] mb-4">
              {callModal.full_name || callModal.username || 'Client'}
            </p>

            <label className="text-[12px] text-[#6B7280] uppercase tracking-wide mb-1.5 block">
              {t('trainerDashboard.reachOut.outcome')}
            </label>
            <select
              value={callOutcome}
              onChange={(e) => setCallOutcome(e.target.value)}
              className="w-full bg-[#111827] border border-white/8 rounded-lg px-3 py-2.5 text-[14px] text-[#E5E7EB] mb-4 focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
            >
              {outcomeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <label className="text-[12px] text-[#6B7280] uppercase tracking-wide mb-1.5 block">
              {t('trainerDashboard.reachOut.noteLabel')}
            </label>
            <textarea
              value={callNote}
              onChange={(e) => setCallNote(e.target.value)}
              placeholder={t('trainerDashboard.reachOut.notePlaceholder')}
              className="w-full bg-[#111827] border border-white/8 rounded-lg p-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors mb-4"
              rows={3}
            />

            <div className="flex gap-3">
              <button
                onClick={() => setCallModal(null)}
                className="flex-1 py-2.5 rounded-lg border border-white/8 text-[13px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
              >
                {t('trainerDashboard.reachOut.cancel')}
              </button>
              <button
                onClick={handleCallSubmit}
                disabled={submittingAction === `call-${callModal.id}`}
                className="flex-1 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#C4A030] text-[#05070B] text-[13px] font-semibold transition-colors disabled:opacity-50"
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
