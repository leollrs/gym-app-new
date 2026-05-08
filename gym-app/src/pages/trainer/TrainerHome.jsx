import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, X, ChevronRight,
  Users, TrendingUp, CalendarCheck, Activity,
} from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { subDays, format, startOfWeek, startOfDay, endOfDay } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import EmptyState from '../../components/EmptyState';
import { TT, TFont, statusTone, avatarIdx } from './components/designTokens';
import {
  TCard, TAvatar, TSparkBars, TRing, THeroDark,
  TEyebrow, TPageTitle, TSectionHeader, TDarkButton, TSegmented,
} from './components/designPrimitives';

// ─────────────────────────────────────────────────────────────────────
// Helper: derive a client status (on_track / at_risk / behind / inactive)
// from churn score + last_active_at.
// ─────────────────────────────────────────────────────────────────────
function deriveClientStatus(client, churnScore) {
  const lastActive = client.last_active_at ? new Date(client.last_active_at) : null;
  const daysInactive = lastActive
    ? Math.floor((Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24))
    : 999;
  if (daysInactive >= 14) return 'inactive';
  if (churnScore != null && churnScore >= 70) return 'behind';
  if (churnScore != null && churnScore >= 50) return 'at_risk';
  if (daysInactive >= 7) return 'at_risk';
  return 'on_track';
}

// ─────────────────────────────────────────────────────────────────────
// Build a 7-bar weekly activity sparkline from the client's recent sessions
// ─────────────────────────────────────────────────────────────────────
function buildWeekBars(profileId, weekSessions) {
  const bars = [0, 0, 0, 0, 0, 0, 0];
  const ws = startOfWeek(new Date(), { weekStartsOn: 0 });
  weekSessions.forEach(s => {
    if (s.profile_id !== profileId) return;
    const d = new Date(s.started_at);
    const dayIdx = Math.floor((d - ws) / (1000 * 60 * 60 * 24));
    if (dayIdx >= 0 && dayIdx < 7) bars[dayIdx] += 1;
  });
  return bars;
}

export default function TrainerHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [clients, setClients] = useState([]);
  const [weekSessions, setWeekSessions] = useState([]);
  const [todaySessions, setTodaySessions] = useState([]);
  const [churnScores, setChurnScores] = useState({});
  // Set of client profile ids who currently have an in-progress workout draft.
  // Hook is intentionally minimal here — full real-time updates happen on
  // /trainer/live/:sessionId itself.
  const [liveClientIds, setLiveClientIds] = useState(new Set());
  // eslint-disable-next-line no-unused-vars
  const [recentPRs, setRecentPRs] = useState([]);
  const [callModal, setCallModal] = useState(null);
  const [callNote, setCallNote] = useState('');
  const [callOutcome, setCallOutcome] = useState('no_answer');
  const [submittingAction, setSubmittingAction] = useState(null);

  useEffect(() => { document.title = `${t('trainerHome.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    fetchHomeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.gym_id, profile?.id]);

  // Realtime: keep `liveClientIds` in sync as clients start/finish workouts.
  // Without this, the "En vivo ahora" pill on the roster only refreshes on
  // page reload — the trainer would miss a client going live.
  useEffect(() => {
    if (!profile?.id || clients.length === 0) return;
    const clientIds = clients.map(c => c.id);
    const channel = supabase
      .channel(`trainer-home-live-${profile.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'session_drafts' },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || !clientIds.includes(row.profile_id)) return;
          setLiveClientIds(prev => {
            const next = new Set(prev);
            if (payload.eventType === 'DELETE') next.delete(row.profile_id);
            else next.add(row.profile_id);
            return next;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, clients.map(c => c.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchHomeData() {
    setLoading(true);
    setError(null);
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
      const todayStart = startOfDay(new Date()).toISOString();
      const todayEnd = endOfDay(new Date()).toISOString();
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();

      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value, last_active_at, created_at)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
      if (tcError) logger.error('TrainerHome: failed to load clients:', tcError);

      const assignedClients = (tcRows || []).map(tc => tc.profiles).filter(Boolean);
      const clientIds = assignedClients.map(c => c.id);
      setClients(assignedClients);

      if (clientIds.length === 0) {
        setWeekSessions([]);
        setTodaySessions([]);
        setRecentPRs([]);
        setChurnScores({});
        setLoading(false);
        return;
      }

      const [churnRes, weekRes, todayRes, prsRes, liveRes] = await Promise.all([
        supabase
          .from('churn_risk_scores')
          .select('profile_id, score, computed_at')
          .in('profile_id', clientIds)
          .order('computed_at', { ascending: false })
          .limit(2000),
        supabase
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs, duration_seconds')
          .in('profile_id', clientIds)
          .eq('status', 'completed')
          .gte('started_at', weekStart),
        supabase
          .from('trainer_sessions')
          .select('id, client_id, title, scheduled_at, duration_mins, status, profiles!trainer_sessions_client_id_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value)')
          .eq('trainer_id', profile.id)
          .gte('scheduled_at', todayStart)
          .lte('scheduled_at', todayEnd)
          .in('status', ['scheduled', 'confirmed', 'completed'])
          .order('scheduled_at', { ascending: true }),
        supabase
          .from('personal_records')
          .select('id, profile_id, exercise_id, weight_lbs, reps, achieved_at, exercises(name)')
          .in('profile_id', clientIds)
          .gte('achieved_at', sevenDaysAgo)
          .order('achieved_at', { ascending: false })
          .limit(8),
        // In-progress workout drafts — feeds the "Watch live" button on session
        // cards. Cheap query: 24h cutoff, just profile_id.
        supabase
          .from('session_drafts')
          .select('profile_id')
          .in('profile_id', clientIds)
          .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .limit(500),
      ]);

      if (churnRes.error) logger.error('TrainerHome: churn fetch failed:', churnRes.error);
      if (weekRes.error)  logger.error('TrainerHome: week fetch failed:',  weekRes.error);
      if (todayRes.error) logger.error('TrainerHome: today fetch failed:', todayRes.error);
      if (prsRes.error)   logger.error('TrainerHome: prs fetch failed:',   prsRes.error);
      if (liveRes.error)  logger.error('TrainerHome: live drafts fetch failed:', liveRes.error);

      const cmap = {};
      (churnRes.data || []).forEach(r => { cmap[r.profile_id] = r; });
      setChurnScores(cmap);

      setWeekSessions(weekRes.data || []);
      setTodaySessions(todayRes.data || []);
      setRecentPRs(prsRes.data || []);
      setLiveClientIds(new Set((liveRes.data || []).map(r => r.profile_id)));
    } catch (err) {
      logger.error('TrainerHome: fetchHomeData crashed', err);
      setError(err?.message || t('trainerHome.loadError', 'Failed to load dashboard data'));
    } finally {
      setLoading(false);
    }
  }

  // ── Derived stats ──
  const totalClients = clients.length;
  const activeProfileIds = new Set(weekSessions.map(s => s.profile_id));
  const activeThisWeek = activeProfileIds.size;
  const workoutsThisWeek = weekSessions.length;

  const thirtyDaysAgo = subDays(new Date(), 30);
  const activeIn30Days = clients.filter(c => c.last_active_at && new Date(c.last_active_at) >= thirtyDaysAgo).length;
  const retentionPct = totalClients > 0 ? Math.round((activeIn30Days / totalClients) * 100) : 0;

  const sevenDaysAgoDate = subDays(new Date(), 7);
  const atRiskClients = useMemo(() => {
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

  // KPI sparkline = workouts/day for the past 7 days across all clients
  const weekDaySpark = useMemo(() => {
    const bars = [0, 0, 0, 0, 0, 0, 0];
    const ws = startOfWeek(new Date(), { weekStartsOn: 0 });
    weekSessions.forEach(s => {
      const d = new Date(s.started_at);
      const idx = Math.floor((d - ws) / (1000 * 60 * 60 * 24));
      if (idx >= 0 && idx < 7) bars[idx] += 1;
    });
    return bars;
  }, [weekSessions]);

  // Greeting based on hour
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t('trainerHome.greetingMorning');
    if (h < 18) return t('trainerHome.greetingAfternoon');
    return t('trainerHome.greetingEvening');
  }, [t]);

  const trainerFirstName = (profile?.full_name || profile?.username || '').split(' ')[0];
  const todayDate = format(new Date(), 'EEEE, MMMM d', { locale: dateFnsLocale });
  const heroEyebrow = format(new Date(), 'EEEE · h:mm a', { locale: dateFnsLocale });
  const todaySessionsCount = todaySessions.length;
  const sessionsLeft = todaySessions.filter(s => s.status !== 'completed').length;

  // ── Roster (top 5 by sessions) ──
  const rosterClients = useMemo(() => {
    return clients.slice(0, 5).map(c => {
      const churn = churnScores[c.id];
      const status = deriveClientStatus(c, churn?.score);
      const bars = buildWeekBars(c.id, weekSessions);
      const sessionCount = bars.reduce((a, b) => a + b, 0);
      // crude adherence: capped to 5 sessions/wk target
      const adh = Math.min(1, sessionCount / 4);
      const isLive = liveClientIds.has(c.id);
      // When the client is mid-workout, show that prominently instead of the
      // stale "last active 2 days ago" label.
      const lastLabel = isLive
        ? t('trainerHome.liveNow', 'En vivo ahora')
        : c.last_active_at
          ? format(new Date(c.last_active_at), 'MMM d', { locale: dateFnsLocale })
          : '—';
      return {
        id: c.id,
        name: c.full_name || c.username || t('trainerCalendar.client', 'Client'),
        avatarUrl: c.avatar_url,
        status,
        bars,
        sessionCount,
        adh,
        lastLabel,
        isLive,
      };
    });
  }, [clients, churnScores, weekSessions, liveClientIds, dateFnsLocale, t]);

  // ── Today's sessions horizontal strip ──
  const todayStrip = useMemo(() => {
    return todaySessions.map(s => {
      const fullName = s.profiles?.full_name || s.profiles?.username || t('trainerCalendar.client', 'Client');
      const firstName = fullName.split(' ')[0];
      const time = format(new Date(s.scheduled_at), 'h:mm a', { locale: dateFnsLocale });
      const dur = `${s.duration_mins || 60}m`;
      return {
        id: s.id,
        time,
        dur,
        firstName,
        plan: s.title || '',
        clientId: s.profiles?.id,
        avatarUrl: s.profiles?.avatar_url,
        fullName,
      };
    });
  }, [todaySessions, dateFnsLocale, t]);

  // ── Quick handlers ──
  async function openConversation(clientId) {
    const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
    if (convId) navigate(`/trainer/messages/${convId}`);
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
      setCallModal(null);
      setCallNote('');
      setCallOutcome('no_answer');
    } catch (err) {
      logger.error('TrainerHome: log call failed:', err);
    } finally {
      setSubmittingAction(null);
    }
  }

  const outcomeOptions = [
    { value: 'no_answer',      label: t('trainerDashboard.outcomes.noAnswer') },
    { value: 'rescheduled',    label: t('trainerDashboard.outcomes.rescheduled') },
    { value: 'coming_back',    label: t('trainerDashboard.outcomes.comingBack') },
    { value: 'not_interested', label: t('trainerDashboard.outcomes.notInterested') },
    { value: 'other',          label: t('trainerDashboard.outcomes.other') },
  ];

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div style={{ background: TT.bg, minHeight: '100%' }}>
        <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto space-y-4">
          <div className="h-32 rounded-3xl animate-pulse" style={{ background: TT.surface2 }} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: TT.surface2 }} />
            ))}
          </div>
          <div className="h-72 rounded-2xl animate-pulse" style={{ background: TT.surface2 }} />
        </div>
      </div>
    );
  }

  // ── No clients state ──
  if (clients.length === 0) {
    return (
      <div style={{ background: TT.bg, minHeight: '100%' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="mb-6">
            <TEyebrow>{heroEyebrow}</TEyebrow>
            <TPageTitle>{trainerFirstName ? `${greeting}, ${trainerFirstName}` : greeting}</TPageTitle>
          </div>
          <EmptyState
            icon={Users}
            title={t('trainerDashboard.noClients', 'No clients assigned yet')}
            description={t('trainerDashboard.noClientsDesc', 'Your dashboard will come to life once you have clients assigned. Ask your gym admin to assign clients to you.')}
            actionLabel={t('trainerDashboard.goToClients', 'View Clients')}
            onAction={() => navigate('/trainer/clients')}
          />
        </div>
      </div>
    );
  }

  // ── KPIs (desktop) ──
  const kpiCards = [
    {
      key: 'active',
      label: t('trainerHome.kpi.activeClients', 'Active clients'),
      value: String(activeThisWeek),
      sub: t('trainerHome.kpi.ofRoster', 'of {{total}} roster', { total: totalClients }),
      tone: TT.accent,
      soft: TT.accentSoft,
      Icon: Users,
      spark: weekDaySpark,
    },
    {
      key: 'sessions',
      label: t('trainerHome.kpi.sessionsWeek', 'Sessions this week'),
      value: String(workoutsThisWeek),
      sub: t('trainerHome.kpi.scheduledToday', '{{count}} today', { count: todaySessionsCount }),
      tone: TT.coach,
      soft: TT.coachSoft,
      Icon: CalendarCheck,
      spark: weekDaySpark,
    },
    {
      key: 'adherence',
      label: t('trainerHome.kpi.avgAdherence', 'Avg adherence'),
      value: `${retentionPct}%`,
      sub: t('trainerHome.kpi.last30', 'last 30 days'),
      tone: TT.good,
      soft: TT.goodSoft,
      Icon: Activity,
      spark: weekDaySpark,
    },
    {
      key: 'attention',
      label: t('trainerHome.kpi.needAttention', 'Need attention'),
      value: String(atRiskClients.length),
      sub: t('trainerHome.kpi.atRiskSub', 'reach out today'),
      tone: TT.hot,
      soft: TT.hotSoft,
      Icon: TrendingUp,
      spark: weekDaySpark,
    },
  ];

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }}>
      {/* ─────────────────── MOBILE LAYOUT ─────────────────── */}
      <div className="md:hidden">
        <THeroDark style={{ marginTop: 0 }}>
          <div style={{ padding: '8px 18px 14px' }}>
            <TEyebrow color={TT.accent}>{heroEyebrow}</TEyebrow>
            <div style={{
              fontFamily: TFont.display, fontSize: 32, fontWeight: 800,
              letterSpacing: -1.2, lineHeight: 1, marginTop: 6, color: '#fff',
            }}>
              {sessionsLeft > 0 ? (
                <>{t('trainerHome.heroTitle', '{{count}} sessions left today.', { count: sessionsLeft })}</>
              ) : (
                <>{t('trainerHome.heroQuiet', 'Quiet day. {{day}}.', { day: format(new Date(), 'EEEE', { locale: dateFnsLocale }) })}</>
              )}
            </div>
          </div>

          {/* Today's sessions horizontal strip */}
          {todayStrip.length > 0 && (
            <div style={{ display: 'flex', gap: 10, padding: '0 18px', overflowX: 'auto' }}>
              {todayStrip.map((s, i) => {
                const isNext = i === 0;
                const isLive = !!(s.clientId && liveClientIds.has(s.clientId));
                const goLive = (e) => {
                  e.stopPropagation();
                  navigate(`/trainer/live/${s.clientId}`);
                };
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if (s.clientId) navigate(`/trainer/clients/${s.clientId}`);
                      else navigate('/trainer/calendar');
                    }}
                    aria-label={t('trainerHome.openSession', 'Open session')}
                    style={{
                      minWidth: 180, flexShrink: 0,
                      background: isNext ? TT.accent : 'rgba(255,255,255,0.06)',
                      color: isNext ? '#06363B' : '#fff',
                      borderRadius: 18, padding: 14,
                      border: isNext ? 'none' : '1px solid rgba(255,255,255,0.08)',
                      position: 'relative',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {isNext && !isLive && (
                      <div style={{
                        position: 'absolute', top: 10, right: 10,
                        fontSize: 9, fontWeight: 800, letterSpacing: 1.2,
                        textTransform: 'uppercase', color: '#06363B',
                      }}>
                        ↓ {t('trainerHome.next', 'Next')}
                      </div>
                    )}
                    {isLive && (
                      <span
                        role="link"
                        tabIndex={0}
                        onClick={goLive}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') goLive(e); }}
                        aria-label={t('trainerLive.watchLive', 'Watch live')}
                        style={{
                          position: 'absolute', top: 10, right: 10,
                          padding: '4px 8px', borderRadius: 999,
                          background: TT.hot, color: '#fff',
                          fontSize: 10, fontWeight: 800,
                          letterSpacing: 0.6, textTransform: 'uppercase',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{
                          width: 6, height: 6, borderRadius: 999,
                          background: '#fff',
                        }} />
                        {t('trainerLive.watchLive', 'Watch live')}
                      </span>
                    )}
                    <div style={{
                      fontFamily: TFont.display, fontSize: 22, fontWeight: 800,
                      letterSpacing: -0.6, lineHeight: 1,
                    }}>{s.time}</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2, fontWeight: 700 }}>{s.dur}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                      <TAvatar
                        name={s.fullName}
                        size={28}
                        idx={avatarIdx(s.clientId)}
                        src={s.avatarUrl}
                      />
                      <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>{s.firstName}</div>
                    </div>
                    <div style={{
                      fontSize: 11, marginTop: 8,
                      opacity: isNext ? 0.7 : 0.55,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s.plan}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </THeroDark>

        {/* Error banner */}
        {error && (
          <div style={{ padding: '12px 16px 0' }}>
            <div className="flex items-start gap-3 px-4 py-3 rounded-2xl"
              style={{ background: TT.hotSoft, color: TT.hot }}>
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold">{t('trainerDashboard.errorTitle', 'Failed to load dashboard')}</p>
                <p className="text-[12px] mt-0.5 truncate">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => fetchHomeData()}
                className="shrink-0 text-[12px] font-bold px-2 py-1 rounded-lg"
                style={{ background: '#fff', color: TT.hot }}
              >
                {t('trainerDashboard.retry', 'Retry')}
              </button>
            </div>
          </div>
        )}

        {/* Roster table */}
        <div style={{ padding: '18px 16px 14px' }}>
          <TSectionHeader
            title={t('trainerHome.rosterThisWeek', 'Roster · this week')}
            action={
              <button
                type="button"
                onClick={() => navigate('/trainer/clients')}
                style={{ color: TT.accent, fontSize: 12, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                {t('trainerHome.seeAll', 'See all →')}
              </button>
            }
          />
          <TCard padded={0}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1.6fr 1fr 50px 36px',
              gap: 8, padding: '10px 14px',
              fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
              textTransform: 'uppercase', color: TT.textMute,
              borderBottom: `1px solid ${TT.border}`,
            }}>
              <span>{t('trainerHome.colClient', 'Client')}</span>
              <span>{t('trainerHome.colWeek', 'Week')}</span>
              <span style={{ textAlign: 'center' }}>{t('trainerHome.colAdh', 'Adh')}</span>
              <span></span>
            </div>
            {rosterClients.map((c, i) => {
              const tone = statusTone(c.status);
              const fullName = c.name;
              const parts = fullName.split(' ');
              const firstName = parts[0];
              const lastInitial = parts[1] ? `${parts[1][0]}.` : '';
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(c.isLive ? `/trainer/live/${c.id}` : `/trainer/clients/${c.id}`)}
                  aria-label={c.isLive
                    ? t('trainerHome.openLive', 'Open live session for {{name}}', { name: fullName })
                    : t('trainerHome.openClient', 'Open {{name}}', { name: fullName })}
                  style={{
                    width: '100%', display: 'grid',
                    gridTemplateColumns: '1.6fr 1fr 50px 36px',
                    gap: 8, padding: '12px 14px', alignItems: 'center',
                    borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    textAlign: 'left', minHeight: 56,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ position: 'relative' }}>
                      <TAvatar name={fullName} size={32} idx={avatarIdx(c.id)} src={c.avatarUrl} />
                      {c.isLive && (
                        <span
                          aria-hidden="true"
                          style={{
                            position: 'absolute', bottom: -2, right: -2,
                            width: 10, height: 10, borderRadius: '50%',
                            background: '#FF3B30',
                            boxShadow: `0 0 0 2px ${TT.cardBg || '#fff'}, 0 0 0 4px rgba(255,59,48,0.30)`,
                            animation: 'live-pulse 1.4s ease-in-out infinite',
                          }}
                        />
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {firstName} {lastInitial}
                        {c.isLive && (
                          <span style={{
                            fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                            padding: '2px 6px', borderRadius: 999,
                            background: '#FF3B30', color: '#fff',
                          }}>{t('trainerHome.liveBadge', 'EN VIVO')}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: c.isLive ? '#FF3B30' : TT.textMute, marginTop: 1, fontWeight: c.isLive ? 700 : 400 }}>{c.lastLabel}</div>
                    </div>
                  </div>
                  <div>
                    <TSparkBars data={c.bars} w={70} h={22} color={tone} />
                    <div style={{ fontSize: 10, color: TT.textMute, marginTop: 2, fontFamily: TFont.mono }}>
                      {c.sessionCount}/{4}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <TRing
                      value={c.adh}
                      size={32}
                      stroke={3}
                      color={tone}
                      label={`${Math.round(c.adh * 100)}`}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ChevronRight size={14} color={TT.textMute} />
                  </div>
                </button>
              );
            })}
          </TCard>
        </div>

        {/* Needs attention */}
        {atRiskClients.length > 0 && (
          <div style={{ padding: '0 16px 18px' }}>
            <TSectionHeader
              title={t('trainerHome.needsAttention', 'Needs attention · {{count}}', { count: atRiskClients.length })}
              accent
              action={
                <button
                  type="button"
                  onClick={() => navigate('/trainer/clients')}
                  style={{ color: TT.textSub, fontSize: 12, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  {t('trainerHome.sweepAll', 'Sweep all →')}
                </button>
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {atRiskClients.map((item) => {
                const c = item.client;
                const status = deriveClientStatus(c, item.churnScore);
                const tone = statusTone(status);
                const name = c.full_name || c.username || t('trainerDashboard.unknownFallback');
                const reason = item.churnScore != null && item.churnScore >= 60
                  ? t('trainerHome.attentionReasonChurn', '{{days}} days quiet · churn {{score}}', {
                      days: item.daysInactive, score: item.churnScore,
                    })
                  : t('trainerHome.attentionReasonInactive', '{{days}} days quiet', { days: item.daysInactive });
                return (
                  <TCard key={c.id} padded={14} style={{ borderLeft: `3px solid ${tone}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <TAvatar name={name} size={40} idx={avatarIdx(c.id)} src={c.avatar_url} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text }}>{name}</div>
                        <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1 }}>{reason}</div>
                      </div>
                      <TDarkButton
                        onClick={() => openConversation(c.id)}
                        style={{ padding: '7px 11px', fontSize: 11, borderRadius: 9 }}
                      >
                        {t('trainerHome.sendCheckin', 'Send check-in')}
                      </TDarkButton>
                    </div>
                  </TCard>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ─────────────────── DESKTOP LAYOUT ─────────────────── */}
      <div className="hidden md:block">
        <main style={{ padding: '24px 28px 32px', maxWidth: 1280, margin: '0 auto' }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'flex-end',
            justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12,
          }}>
            <div>
              <TEyebrow color={TT.accent}>{heroEyebrow}</TEyebrow>
              <div style={{
                fontFamily: TFont.display, fontSize: 32, fontWeight: 800,
                color: TT.text, letterSpacing: -1.2, lineHeight: 1.05, marginTop: 6,
              }}>
                {trainerFirstName ? `${greeting}, ${trainerFirstName}` : greeting}
              </div>
              <div style={{ fontSize: 13, color: TT.textSub, marginTop: 4 }}>
                {t('trainerHome.deskSummary', '{{sessions}} sessions today · {{att}} need attention', {
                  sessions: todaySessionsCount,
                  att: atRiskClients.length,
                })}
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {kpiCards.map(k => (
              <TCard key={k.key} padded={16} style={{ position: 'relative', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9,
                    background: k.soft, color: k.tone,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <k.Icon size={16} color={k.tone} strokeWidth={2.2} />
                  </div>
                  <TSparkBars data={k.spark} w={64} h={24} color={k.tone} />
                </div>
                <div style={{
                  fontFamily: TFont.display, fontSize: 28, fontWeight: 800,
                  color: TT.text, letterSpacing: -1, lineHeight: 1,
                }}>{k.value}</div>
                <div style={{ fontSize: 12, color: TT.textSub, fontWeight: 600, marginTop: 6 }}>{k.label}</div>
                <div style={{ fontSize: 11, color: TT.textMute, marginTop: 2 }}>{k.sub}</div>
              </TCard>
            ))}
          </div>

          {/* Today's schedule timeline */}
          <div style={{ marginBottom: 16 }}>
            <TCard padded={0}>
              <div style={{
                padding: '14px 18px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: `1px solid ${TT.border}`,
              }}>
                <div>
                  <div style={{
                    fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
                    color: TT.text, letterSpacing: -0.3,
                  }}>
                    {t('trainerHome.todaysSchedule', "Today's schedule")}
                  </div>
                  <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2 }}>
                    {t('trainerHome.scheduleSub', '{{count}} sessions today', { count: todaySessionsCount })}
                  </div>
                </div>
                <div style={{ minWidth: 220 }}>
                  <TSegmented
                    options={[
                      { value: 'day',   label: t('trainerCalendar.day', 'Day') },
                      { value: 'week',  label: t('trainerCalendar.week', 'Week') },
                      { value: 'month', label: t('trainerCalendar.month', 'Month') },
                    ]}
                    value="week"
                    onChange={() => navigate('/trainer/calendar')}
                  />
                </div>
              </div>

              {/* Timeline body */}
              <div style={{ padding: '16px 18px', position: 'relative' }}>
                <div style={{ position: 'relative', height: 120 }}>
                  {/* hour ticks: 2a..9p (8 ticks) */}
                  {Array.from({ length: 8 }).map((_, i) => {
                    const hr = 2 + i * 2;
                    const label = hr < 12 ? `${hr}a` : `${hr === 12 ? 12 : hr - 12}p`;
                    return (
                      <div key={i} style={{
                        position: 'absolute',
                        left: `${(i / 7) * 100}%`,
                        top: 0, bottom: 0,
                        borderLeft: `1px dashed ${TT.border}`,
                      }}>
                        <div style={{
                          position: 'absolute', top: -2, left: 4,
                          fontSize: 10, color: TT.textMute,
                          fontFamily: TFont.mono, fontWeight: 700,
                        }}>{label}</div>
                      </div>
                    );
                  })}
                  {/* now line */}
                  {(() => {
                    const now = new Date();
                    const hours = now.getHours() + now.getMinutes() / 60;
                    const pct = Math.max(0, Math.min(100, ((hours - 2) / 14) * 100));
                    return (
                      <div style={{
                        position: 'absolute',
                        left: `${pct}%`, top: 12, bottom: -2,
                        borderLeft: `2px solid ${TT.hot}`,
                      }}>
                        <div style={{
                          position: 'absolute', top: -8, left: -4,
                          width: 8, height: 8, borderRadius: 999, background: TT.hot,
                        }} />
                        <div style={{
                          position: 'absolute', top: -8, left: 8,
                          fontSize: 9.5, color: TT.hot,
                          fontFamily: TFont.mono, fontWeight: 800,
                        }}>
                          {t('trainerHome.now', 'NOW')} · {format(now, 'h:mma', { locale: dateFnsLocale }).toLowerCase()}
                        </div>
                      </div>
                    );
                  })()}
                  {/* sessions */}
                  {todaySessions.map((s, i) => {
                    const start = new Date(s.scheduled_at);
                    const startHr = start.getHours() + start.getMinutes() / 60;
                    const dur = (s.duration_mins || 60) / 60;
                    const left = Math.max(0, ((startHr - 2) / 14) * 100);
                    const width = Math.min(20, (dur / 14) * 100);
                    const isNext = i === todaySessions.findIndex(x => x.status !== 'completed');
                    const status = s.status === 'completed' ? 'on_track' : 'on_track';
                    const tone = statusTone(status);
                    const name = (s.profiles?.full_name || s.profiles?.username || t('trainerCalendar.client', 'Client')).split(' ')[0];
                    return (
                      <div key={s.id} style={{
                        position: 'absolute', top: 22, height: 80,
                        left: `${left}%`, width: `${width}%`,
                        background: TT.accentSoft,
                        borderLeft: `3px solid ${tone}`,
                        borderRadius: 8,
                        padding: '8px 10px',
                        overflow: 'hidden',
                      }}>
                        {isNext && (
                          <div style={{
                            position: 'absolute', top: 4, right: 4,
                            fontSize: 8, fontWeight: 800, color: '#fff',
                            background: tone, padding: '1px 4px',
                            borderRadius: 3, letterSpacing: 0.5,
                          }}>{t('trainerHome.next', 'NEXT')}</div>
                        )}
                        <div style={{
                          fontSize: 11.5, fontWeight: 800,
                          color: TT.text, letterSpacing: -0.2,
                        }}>{name}</div>
                        <div style={{ fontSize: 10, color: TT.textSub, marginTop: 2 }}>
                          {format(start, 'h:mma', { locale: dateFnsLocale }).toLowerCase()} · {s.title}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </TCard>
          </div>

          {/* Two-up bottom: Roster table + Active plans */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
            <TCard padded={0}>
              <div style={{
                padding: '14px 18px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: `1px solid ${TT.border}`,
              }}>
                <div style={{
                  fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
                  color: TT.text, letterSpacing: -0.3,
                }}>
                  {t('trainerHome.roster', 'Roster')}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/trainer/clients')}
                  style={{ color: TT.accent, fontSize: 11.5, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  {t('trainerHome.viewAll', 'View all →')}
                </button>
              </div>
              <div>
                {/* Table head */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.4fr 1fr 1fr 60px',
                  padding: '9px 18px', gap: 10,
                  fontSize: 9.5, fontWeight: 800, color: TT.textMute,
                  letterSpacing: 1, textTransform: 'uppercase',
                  borderBottom: `1px solid ${TT.border}`,
                }}>
                  <div>{t('trainerHome.colClient', 'Client')}</div>
                  <div>{t('trainerHome.colProgram', 'Program')}</div>
                  <div>{t('trainerHome.colAdherence', 'Adherence')}</div>
                  <div>{t('trainerHome.colLastActive', 'Last active')}</div>
                  <div></div>
                </div>
                {rosterClients.map((c, i) => {
                  const tone = statusTone(c.status);
                  const program = t('trainerHome.programFallback', 'No program');
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => navigate(`/trainer/clients/${c.id}`)}
                      style={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: '2fr 1.4fr 1fr 1fr 60px',
                        padding: '12px 18px', gap: 10, alignItems: 'center',
                        borderBottom: i < rosterClients.length - 1 ? `1px solid ${TT.border}` : 'none',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <TAvatar name={c.name} size={32} idx={avatarIdx(c.id)} src={c.avatarUrl} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: TT.textSub }}>
                            {t('trainerHome.sessionsCount', '{{count}} sessions', { count: c.sessionCount })}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: TT.textSub, fontWeight: 600 }}>{program}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          flex: 1, height: 6, borderRadius: 999,
                          background: TT.surface2, overflow: 'hidden', maxWidth: 80,
                        }}>
                          <div style={{
                            width: `${c.adh * 100}%`, height: '100%',
                            background: tone, borderRadius: 999,
                          }} />
                        </div>
                        <span style={{
                          fontSize: 11.5, fontWeight: 800, color: tone,
                          fontFamily: TFont.mono, minWidth: 32,
                        }}>{Math.round(c.adh * 100)}%</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: TT.textSub }}>{c.lastLabel}</div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <ChevronRight size={14} color={TT.textMute} />
                      </div>
                    </button>
                  );
                })}
                {rosterClients.length === 0 && (
                  <div style={{ padding: '20px 18px', fontSize: 12, color: TT.textMute }}>
                    {t('trainerHome.noRoster', 'No clients yet.')}
                  </div>
                )}
              </div>
            </TCard>

            {/* Need attention card (replaces Active plans, since attention data is real) */}
            <TCard padded={0}>
              <div style={{
                padding: '14px 18px', borderBottom: `1px solid ${TT.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{
                  fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
                  color: TT.hot, letterSpacing: -0.3,
                }}>
                  {t('trainerHome.kpi.needAttention', 'Need attention')} · {atRiskClients.length}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/trainer/clients')}
                  style={{ color: TT.textSub, fontSize: 11.5, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  {t('trainerHome.sweepAll', 'Sweep all →')}
                </button>
              </div>
              {atRiskClients.length === 0 ? (
                <div style={{ padding: '24px 18px', fontSize: 12.5, color: TT.textMute }}>
                  {t('trainerHome.allOnTrack', 'Everyone looks on track. ✨')}
                </div>
              ) : (
                atRiskClients.map((item, i) => {
                  const c = item.client;
                  const status = deriveClientStatus(c, item.churnScore);
                  const tone = statusTone(status);
                  const name = c.full_name || c.username || t('trainerDashboard.unknownFallback');
                  const reason = item.churnScore != null && item.churnScore >= 60
                    ? t('trainerHome.attentionReasonChurn', '{{days}} days quiet · churn {{score}}', {
                        days: item.daysInactive, score: item.churnScore,
                      })
                    : t('trainerHome.attentionReasonInactive', '{{days}} days quiet', { days: item.daysInactive });
                  return (
                    <div key={c.id} style={{
                      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
                      borderBottom: i < atRiskClients.length - 1 ? `1px solid ${TT.border}` : 'none',
                      borderLeft: `3px solid ${tone}`,
                    }}>
                      <TAvatar name={name} size={36} idx={avatarIdx(c.id)} src={c.avatar_url} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>{name}</div>
                        <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>{reason}</div>
                      </div>
                      <TDarkButton
                        onClick={() => openConversation(c.id)}
                        style={{ padding: '6px 10px', fontSize: 11, borderRadius: 8 }}
                      >
                        {t('trainerHome.sendCheckin', 'Send check-in')}
                      </TDarkButton>
                    </div>
                  );
                })
              )}
            </TCard>
          </div>

          {todayDate && (
            <div style={{ fontSize: 11, color: TT.textMute, marginTop: 24, textAlign: 'center' }}>
              {todayDate}
            </div>
          )}
        </main>
      </div>

      {/* Call Note Modal — center aligned (per design system) */}
      {callModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div style={{
            background: TT.surface, borderRadius: 18, border: `1px solid ${TT.border}`,
            width: '100%', maxWidth: 400, padding: 24,
          }}>
            <div className="flex items-center justify-between mb-4">
              <h3 style={{ fontSize: 16, fontWeight: 800, color: TT.text }}>
                {t('trainerDashboard.reachOut.logCall')}
              </h3>
              <button
                type="button"
                onClick={() => setCallModal(null)}
                className="p-2 -m-2 rounded-full"
                style={{ color: TT.textMute }}
                aria-label={t('trainerDashboard.reachOut.cancel')}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: TT.textSub, marginBottom: 16 }}>
              {callModal.full_name || callModal.username || t('trainerDashboard.clientFallback')}
            </p>

            <label style={{
              fontSize: 12, color: TT.textMute, textTransform: 'uppercase',
              letterSpacing: 1, marginBottom: 6, display: 'block', fontWeight: 700,
            }}>
              {t('trainerDashboard.reachOut.outcome')}
            </label>
            <select
              value={callOutcome}
              onChange={(e) => setCallOutcome(e.target.value)}
              style={{
                width: '100%', background: TT.surface2,
                border: `1px solid ${TT.borderSolid}`, borderRadius: 10,
                padding: '10px 12px', fontSize: 14, color: TT.text, marginBottom: 14,
              }}
            >
              {outcomeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <label style={{
              fontSize: 12, color: TT.textMute, textTransform: 'uppercase',
              letterSpacing: 1, marginBottom: 6, display: 'block', fontWeight: 700,
            }}>
              {t('trainerDashboard.reachOut.noteLabel')}
            </label>
            <textarea
              value={callNote}
              onChange={(e) => setCallNote(e.target.value)}
              placeholder={t('trainerDashboard.reachOut.notePlaceholder')}
              style={{
                width: '100%', background: TT.surface2,
                border: `1px solid ${TT.borderSolid}`, borderRadius: 10,
                padding: 12, fontSize: 14, color: TT.text, marginBottom: 16,
                resize: 'none',
              }}
              rows={3}
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCallModal(null)}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10,
                  border: `1px solid ${TT.borderSolid}`, background: 'transparent',
                  fontSize: 13, fontWeight: 700, color: TT.textSub,
                }}
              >
                {t('trainerDashboard.reachOut.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCallSubmit}
                disabled={submittingAction === `call-${callModal.id}`}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10,
                  border: 'none', background: TT.accent,
                  color: '#06363B', fontSize: 13, fontWeight: 800,
                  opacity: submittingAction === `call-${callModal.id}` ? 0.5 : 1,
                }}
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
