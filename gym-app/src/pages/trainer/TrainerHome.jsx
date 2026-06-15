import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ChevronRight,
  Users, TrendingUp, CalendarCheck, Activity, DollarSign,
  Play, MessageSquare, User,
} from 'lucide-react';
import { subDays, format, startOfWeek, startOfDay, endOfDay, isTomorrow } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { selectInBatches } from '../../lib/churn/batchedSelect';
import { exName } from '../../lib/exerciseName';
import { readTrainerCache, writeTrainerCache } from '../../lib/trainerCache';
import { TT, TFont, statusTone, avatarIdx } from './components/designTokens';
import { deriveClientStatus, needsAttention, weeklyAdherence, daysSince, RISK } from '../../lib/clientStatus';
import {
  TCard, TAvatar, TSparkBars, TPill,
  TEyebrow, TDarkButton,
  TSectionHeader, TPrimaryButton,
} from './components/designPrimitives';

// ─────────────────────────────────────────────────────────────────────
// Build a 7-bar weekly activity sparkline from the client's recent sessions.
// Monday-start, matching the weekStart the fetch queries with (weekStartsOn:1).
// ─────────────────────────────────────────────────────────────────────
function buildWeekBars(profileId, weekSessions) {
  const bars = [0, 0, 0, 0, 0, 0, 0];
  const ws = startOfWeek(new Date(), { weekStartsOn: 1 });
  weekSessions.forEach(s => {
    if (s.profile_id !== profileId) return;
    const d = new Date(s.started_at);
    const dayIdx = Math.floor((d - ws) / (1000 * 60 * 60 * 24));
    if (dayIdx >= 0 && dayIdx < 7) bars[dayIdx] += 1;
  });
  return bars;
}

// 12h tick label for the desktop timeline axis ("7a", "12p", "9p").
function tickLabel(hr) {
  const h = ((hr % 24) + 24) % 24;
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

export default function TrainerHome() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;

  // Instant-load cache: hydrate stable data from the last visit so navigating
  // back doesn't flash a spinner. Live data (drafts) is never cached.
  const homeCacheKey = `home:${profile?.id || 'x'}`;
  const homeCache = useMemo(() => readTrainerCache(homeCacheKey), [homeCacheKey]);

  const [loading, setLoading] = useState(!homeCache);
  const [error, setError] = useState(null);

  const [clients, setClients] = useState(() => homeCache?.clients || []);
  const [weekSessions, setWeekSessions] = useState(() => homeCache?.weekSessions || []);
  const [todaySessions, setTodaySessions] = useState(() => homeCache?.todaySessions || []);
  const [churnScores, setChurnScores] = useState(() => homeCache?.churnScores || {});
  const [moneyOverview, setMoneyOverview] = useState(() => homeCache?.moneyOverview || null);
  const [upcomingSessions, setUpcomingSessions] = useState(() => homeCache?.upcomingSessions || []);
  // Set of client profile ids who currently have an in-progress workout draft —
  // feeds the "Training now" indicators on hero/lineup/roster. Kept fresh by
  // the realtime effect below.
  const [liveClientIds, setLiveClientIds] = useState(new Set());
  // Full draft rows behind those ids — feeds the "En vivo ahora" rail
  // (routine name + pause-aware elapsed), not just the dot indicators.
  const [liveDrafts, setLiveDrafts] = useState([]);
  const [recentPRs, setRecentPRs] = useState(() => homeCache?.recentPRs || []);
  // gym_programs.id → name for the roster's assigned programs; null = fetch failed.
  const [programNames, setProgramNames] = useState(() => homeCache?.programNames || {});

  useEffect(() => { document.title = `${t('trainerHome.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    fetchHomeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.gym_id, profile?.id]);

  // Write-through cache of the stable data for instant loads next visit.
  useEffect(() => {
    if (loading) return;
    writeTrainerCache(homeCacheKey, { clients, weekSessions, todaySessions, churnScores, moneyOverview, upcomingSessions, recentPRs, programNames });
  }, [loading, clients, weekSessions, todaySessions, churnScores, moneyOverview, upcomingSessions, recentPRs, programNames, homeCacheKey]);

  // Cheap freshness: silently refetch when the tab/app comes back to the
  // foreground (no skeleton flash). Pull-to-refresh is deferred to v2.
  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchHomeData({ silent: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.gym_id, profile?.id]);

  // Realtime: keep `liveClientIds` in sync as clients start/finish workouts.
  // Without this, the "En vivo ahora" pill on the roster only refreshes on
  // page reload — the trainer would miss a client going live.
  // Patching state from the payload can't work for DELETEs (payload.old only
  // carries the PK, never profile_id), so ANY session_drafts event just
  // re-runs the same live-drafts fetch fetchHomeData uses — debounced, since
  // an in-progress workout updates its draft every few seconds. A 60s poll
  // covers the window before session_drafts is in the realtime publication
  // (migration 0527).
  useEffect(() => {
    if (!profile?.id || clients.length === 0) return;
    const clientIds = clients.map(c => c.id);

    const refreshLiveDrafts = async () => {
      // 6h window — same freshness rule as TrainerLiveSession/client detail,
      // so "Training now" can never come from yesterday's abandoned draft.
      const { data, error } = await selectInBatches(
        (ids) => supabase.from('session_drafts')
          .select('profile_id, routine_name, started_at, elapsed_time, is_paused, updated_at')
          .in('profile_id', ids)
          .gte('updated_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()),
        clientIds,
      );
      if (error) { logger.error('TrainerHome: live drafts refresh failed:', error); return; }
      setLiveDrafts(data || []);
      setLiveClientIds(new Set((data || []).map(r => r.profile_id)));
    };

    let debounceTimer = null;
    const channel = supabase
      .channel(`trainer-home-live-${profile.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'session_drafts' },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(refreshLiveDrafts, 2000);
        })
      .subscribe();
    const poll = setInterval(refreshLiveDrafts, 60_000);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [profile?.id, clients.map(c => c.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchHomeData({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
      const todayStart = startOfDay(new Date()).toISOString();
      const todayEnd = endOfDay(new Date()).toISOString();
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();

      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value, last_active_at, created_at, assigned_program_id)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
      if (tcError) logger.error('TrainerHome: failed to load clients:', tcError);

      const assignedClients = (tcRows || []).map(tc => tc.profiles).filter(Boolean);
      const clientIds = assignedClients.map(c => c.id);
      setClients(assignedClients);

      // Always load — keyed off the trainer, not the client roster — so a trainer
      // with zero assigned clients still sees today's booked sessions + cobros.
      const sessionCols = 'id, client_id, title, scheduled_at, duration_mins, status, profiles!trainer_sessions_client_id_fkey(id, full_name, username, avatar_url, avatar_type, avatar_value)';
      const [todayRes, upcomingRes, moneyRes] = await Promise.all([
        supabase
          .from('trainer_sessions')
          .select(sessionCols)
          .eq('trainer_id', profile.id)
          .gte('scheduled_at', todayStart)
          .lte('scheduled_at', todayEnd)
          .in('status', ['scheduled', 'confirmed', 'completed'])
          .order('scheduled_at', { ascending: true }),
        // Upcoming sessions beyond today — feeds the hero fallback + the
        // scrollable "Próximas sesiones" list so quiet days aren't empty.
        supabase
          .from('trainer_sessions')
          .select(sessionCols)
          .eq('trainer_id', profile.id)
          .gt('scheduled_at', todayEnd)
          .in('status', ['scheduled', 'confirmed'])
          .order('scheduled_at', { ascending: true })
          .limit(12),
        // Money overview RPC; null if migration 0451 isn't applied yet.
        supabase.rpc('get_trainer_money_overview'),
      ]);
      if (todayRes.error) logger.error('TrainerHome: today fetch failed:', todayRes.error);
      if (upcomingRes.error) logger.error('TrainerHome: upcoming fetch failed:', upcomingRes.error);
      if (moneyRes?.error) logger.error('TrainerHome: money overview fetch failed:', moneyRes.error);
      setTodaySessions(todayRes.data || []);
      setUpcomingSessions(upcomingRes.data || []);
      setMoneyOverview(moneyRes?.error ? null : (moneyRes?.data || null));

      // supabase-js never throws — surface CORE query failures (roster,
      // sessions, money) as the page error state instead of silent empties.
      // A missing money RPC (migration 0451 not applied) is "unconfigured",
      // not an error.
      const moneyRpcMissing = moneyRes?.error &&
        (moneyRes.error.code === 'PGRST202' || moneyRes.error.code === '42883');
      const coreError = tcError || todayRes.error || upcomingRes.error ||
        (moneyRpcMissing ? null : moneyRes?.error) || null;
      if (coreError) setError(t('trainerHome.loadError', 'Failed to load dashboard data'));

      const programIds = [...new Set(assignedClients.map(c => c.assigned_program_id).filter(Boolean))];

      if (clientIds.length === 0) {
        setWeekSessions([]);
        setRecentPRs([]);
        setChurnScores({});
        setLiveClientIds(new Set());
        setLiveDrafts([]);
        setProgramNames({});
        setLoading(false);
        return;
      }

      const [churnRes, weekRes, prsRes, liveRes, progRes] = await Promise.all([
        selectInBatches(
          (ids) => supabase.from('churn_risk_scores').select('profile_id, score, computed_at')
            .in('profile_id', ids).order('computed_at', { ascending: false }),
          clientIds,
        ),
        selectInBatches(
          (ids) => supabase.from('workout_sessions')
            .select('id, profile_id, name, started_at, total_volume_lbs, duration_seconds')
            .in('profile_id', ids).eq('status', 'completed').gte('started_at', weekStart),
          clientIds,
        ),
        selectInBatches(
          (ids) => supabase.from('personal_records')
            .select('id, profile_id, exercise_id, weight_lbs, reps, achieved_at, exercises(name, name_es)')
            .in('profile_id', ids).gte('achieved_at', sevenDaysAgo)
            .order('achieved_at', { ascending: false }).limit(8),
          clientIds,
        ),
        // In-progress workout drafts — feeds the live "Training now"
        // indicators + the "En vivo ahora" rail. 6h cutoff (same freshness
        // rule as TrainerLiveSession, so stale drafts never read as live).
        selectInBatches(
          (ids) => supabase.from('session_drafts')
            .select('profile_id, routine_name, started_at, elapsed_time, is_paused, updated_at')
            .in('profile_id', ids)
            .gte('updated_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()),
          clientIds,
        ),
        // Program names for the roster's "Program" column.
        programIds.length
          ? supabase.from('gym_programs').select('id, name').in('id', programIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (churnRes.error) logger.error('TrainerHome: churn fetch failed:', churnRes.error);
      if (weekRes.error)  logger.error('TrainerHome: week fetch failed:',  weekRes.error);
      if (prsRes.error)   logger.error('TrainerHome: prs fetch failed:',   prsRes.error);
      if (liveRes.error)  logger.error('TrainerHome: live drafts fetch failed:', liveRes.error);

      const cmap = {};
      // Rows come newest-first (order by computed_at desc) — keep the first
      // (= most recent) score per profile so the staleness check is honest.
      (churnRes.data || []).forEach(r => { if (!cmap[r.profile_id]) cmap[r.profile_id] = r; });
      setChurnScores(cmap);

      setWeekSessions(weekRes.data || []);
      setRecentPRs(prsRes.data || []);
      setLiveDrafts(liveRes.data || []);
      setLiveClientIds(new Set((liveRes.data || []).map(r => r.profile_id)));

      if (progRes.error) {
        // Don't render "No program" on a failed read — '—' (unknown) instead.
        logger.error('TrainerHome: program names fetch failed:', progRes.error);
        setProgramNames(null);
      } else {
        const pmap = {};
        (progRes.data || []).forEach(p => { pmap[p.id] = p.name; });
        setProgramNames(pmap);
      }
    } catch (err) {
      logger.error('TrainerHome: fetchHomeData crashed', err);
      // Display only the translated fallback — raw err.message stays in the log.
      setError(t('trainerHome.loadError', 'Failed to load dashboard data'));
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

  // "Needs attention" — derived from the shared canonical risk model
  // (lib/clientStatus), so Home agrees with TrainerClients page-to-page.
  const atRiskClients = useMemo(() => {
    return clients
      .map(c => {
        const churn = churnScores[c.id];
        const info = {
          lastActiveAt: c.last_active_at,
          createdAt: c.created_at,
          churnScore: churn ? Number(churn.score) : null,
          churnComputedAt: churn?.computed_at,
        };
        return {
          client: c,
          status: deriveClientStatus(info),
          attention: needsAttention(info),
          daysInactive: daysSince(c.last_active_at),
          churnScore: churn ? Math.round(churn.score) : null,
        };
      })
      .filter(item => item.attention)
      .sort((a, b) => (b.daysInactive ?? 9999) - (a.daysInactive ?? 9999))
      .slice(0, 5);
  }, [clients, churnScores]);

  const attentionReason = (item) => item.daysInactive == null
    ? t('trainerHome.attentionReasonNever', "Hasn't trained yet")
    : (item.churnScore != null && item.churnScore >= RISK.AT_RISK_SCORE
      ? t('trainerHome.attentionReasonChurn', '{{days}} days quiet · churn {{score}}', { days: item.daysInactive, score: item.churnScore })
      : t('trainerHome.attentionReasonInactive', '{{days}} days quiet', { days: item.daysInactive }));

  // KPI sparkline = workouts/day this week across all clients (Monday-start,
  // same week the fetch queries).
  const weekDaySpark = useMemo(() => {
    const bars = [0, 0, 0, 0, 0, 0, 0];
    const ws = startOfWeek(new Date(), { weekStartsOn: 1 });
    weekSessions.forEach(s => {
      const d = new Date(s.started_at);
      const idx = Math.floor((d - ws) / (1000 * 60 * 60 * 24));
      if (idx >= 0 && idx < 7) bars[idx] += 1;
    });
    return bars;
  }, [weekSessions]);

  // Desktop timeline domain — dynamic, so evening sessions (PR prime time)
  // always render inside the card: start = min(7a, earliest session hour),
  // end = max(9p, latest session end hour), capped at midnight.
  const tlDomain = useMemo(() => {
    let start = 7, end = 21;
    todaySessions.forEach(s => {
      const d = new Date(s.scheduled_at);
      const h = d.getHours() + d.getMinutes() / 60;
      start = Math.min(start, Math.floor(h));
      end = Math.max(end, Math.ceil(h + Math.max(1, (s.duration_mins || 60) / 60)));
    });
    end = Math.min(24, end);
    return { start, end, span: Math.max(1, end - start) };
  }, [todaySessions]);

  // Greeting based on hour. The greeting* keys bake in ", {{name}}" — pass an
  // empty name and strip the trailing separator so we get just the salutation
  // ("Buenas tardes"); the name is appended (accented) in the markup.
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const key = h < 12 ? 'greetingMorning' : h < 18 ? 'greetingAfternoon' : 'greetingEvening';
    return t(`trainerHome.${key}`, { name: '' }).replace(/[,、，]\s*$/, '').trim();
  }, [t]);

  const trainerFirstName = (profile?.full_name || profile?.username || '').split(' ')[0];
  const todayDate = format(new Date(), 'EEEE, MMMM d', { locale: dateFnsLocale });
  const heroEyebrow = format(new Date(), 'EEEE · h:mm a', { locale: dateFnsLocale });
  const todaySessionsCount = todaySessions.length;

  // ── Home (V3 redesign) derived values ──
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const homeEyebrow = cap(format(new Date(), 'EEEE · d MMMM · h:mm a', { locale: dateFnsLocale }));
  const todayUpcoming = todaySessions.filter(s => s.status !== 'completed'); // not-yet-done today
  const allUpcoming = [...todayUpcoming, ...upcomingSessions];               // chronological (today's open, then future)
  // Feature the next session that hasn't finished yet — otherwise an earlier
  // session of the day that's already past but never marked complete keeps
  // hogging the hero, pushing a just-scheduled later session down into the list.
  const sessionEndMs = (s) => new Date(s.scheduled_at).getTime() + (s.duration_mins || 60) * 60000;
  const nextUpcomingIdx = allUpcoming.findIndex(s => sessionEndMs(s) >= Date.now());
  const heroIdx = nextUpcomingIdx >= 0 ? nextUpcomingIdx : 0;
  const heroSession = allUpcoming[heroIdx] || null;                         // never empty if anything's booked
  const heroIsToday = !!(heroSession && todayUpcoming.some(s => s.id === heroSession.id));
  const heroClientId = heroSession ? (heroSession.profiles?.id || heroSession.client_id) : null;
  const heroName = heroSession ? (heroSession.profiles?.full_name || heroSession.profiles?.username || t('trainerCalendar.client', 'Client')) : '';
  const heroPR = heroClientId ? recentPRs.find(p => p.profile_id === heroClientId) : null;
  const heroClientLastActive = heroClientId ? (clients.find(c => c.id === heroClientId)?.last_active_at || null) : null;
  const minsUntilNext = (heroIsToday && heroSession) ? Math.round((new Date(heroSession.scheduled_at).getTime() - new Date().getTime()) / 60000) : null;
  const heroWhen = !heroSession ? '' : (heroIsToday
    ? (minsUntilNext != null && minsUntilNext > 0 ? t('trainerHome.nextIn', 'Next · in {{n}} min', { n: minsUntilNext }) : t('trainerHome.nextNow', 'Up next'))
    : t('trainerHome.nextOn', 'Next · {{when}}', { when: isTomorrow(new Date(heroSession.scheduled_at)) ? t('trainerHome.tomorrow', 'tomorrow') : format(new Date(heroSession.scheduled_at), 'EEE d', { locale: dateFnsLocale }) }));
  const upcomingList = allUpcoming.slice(heroIdx + 1); // everything after the hero (today's rest + future)
  // "Today's lineup" is strictly today — future-day sessions stay out, and the
  // count/hours line is computed from the SAME list it sits above.
  const lineupToday = upcomingList.filter(s => todayUpcoming.some(x => x.id === s.id));
  const lineupMins = lineupToday.reduce((a, s) => a + (s.duration_mins || 60), 0);
  const lineupHours = (() => {
    const h = Math.floor(lineupMins / 60), m = lineupMins % 60;
    return h > 0 ? (m > 0 ? `${h} h ${m} m` : `${h} h`) : `${m} m`;
  })();
  const heroIsLive = !!heroClientId && liveClientIds.has(heroClientId);

  // "En vivo ahora" rail — drafts touched in the last 45 min are genuinely
  // in-progress (the member app autosaves constantly during a workout); the
  // wider 6h fetch window only backs the softer "Training now" dots. Joined
  // to the roster for name/avatar; pause-aware elapsed minutes.
  const liveNow = useMemo(() => {
    const cutoff = Date.now() - 45 * 60 * 1000;
    return liveDrafts
      .filter(d => d.updated_at && new Date(d.updated_at).getTime() >= cutoff)
      .map(d => {
        const c = clients.find(cl => cl.id === d.profile_id);
        if (!c) return null;
        const baseSec = d.elapsed_time || 0;
        const runSec = d.is_paused ? 0 : Math.max(0, (Date.now() - new Date(d.updated_at).getTime()) / 1000);
        return { client: c, draft: d, mins: Math.max(1, Math.round((baseSec + runSec) / 60)) };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.draft.started_at || 0) - new Date(a.draft.started_at || 0));
  }, [liveDrafts, clients]);
  // Recent PRs (already fetched) — compact celebration list, max 5.
  const prRows = useMemo(() => {
    return (recentPRs || []).slice(0, 5).map(p => {
      const c = clients.find(cl => cl.id === p.profile_id);
      return {
        id: p.id,
        clientId: p.profile_id,
        clientName: c?.full_name || c?.username || t('trainerCalendar.client', 'Client'),
        avatarUrl: c?.avatar_url,
        exercise: exName(p.exercises) || '',
        detail: `${p.weight_lbs} lb × ${p.reps}`,
      };
    });
  }, [recentPRs, clients, t]);
  const cobrosPending = Number(moneyOverview?.pending_total || 0);
  const cobrosPendingCount = moneyOverview?.pending_count || 0;
  const cobrosAvatars = (Array.isArray(moneyOverview?.clients) ? moneyOverview.clients : [])
    .filter(c => Number(c.monthly_fee || 0) > 0 && !c.paid_this_month).slice(0, 3);

  // ── Money card (manual payment tracking) — links to /trainer/payments ──
  const renderMoneyCard = () => {
    if (!moneyOverview) return null;
    const collected = Number(moneyOverview.collected_total || 0);
    const pendingCount = moneyOverview.pending_count || 0;
    const pendingTotal = Number(moneyOverview.pending_total || 0);
    const withFee = moneyOverview.with_fee || 0;
    const monthLabel = format(new Date(), 'MMMM', { locale: dateFnsLocale });
    return (
      <button
        type="button"
        onClick={() => navigate('/trainer/payments')}
        aria-label={t('trainerHome.money.open', 'Open payments')}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          background: TT.surface, border: `1px solid ${TT.border}`,
          borderRadius: 18, boxShadow: TT.shadow, padding: 16,
          display: 'flex', alignItems: 'center', gap: 14,
        }}
      >
        <div style={{ width: 48, height: 48, borderRadius: 14, background: TT.accentSoft, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <DollarSign size={22} style={{ color: TT.accent }} strokeWidth={2.4} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: TT.textMute }}>
            {t('trainerHome.money.title', 'Collected · {{month}}', { month: monthLabel })}
          </div>
          {withFee === 0 ? (
            <div style={{ fontSize: 13, color: TT.textSub, marginTop: 3, fontWeight: 600 }}>
              {t('trainerHome.money.setup', 'Set client fees to track payments')}
            </div>
          ) : (
            <>
              <div style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text, letterSpacing: -1, lineHeight: 1, marginTop: 3 }}>
                ${collected.toFixed(0)}
              </div>
              <div style={{ fontSize: 11.5, color: pendingCount > 0 ? TT.hot : TT.good, marginTop: 4, fontWeight: 700 }}>
                {pendingCount > 0
                  ? t('trainerHome.money.pending', '{{count}} pending · ${{amount}}', { count: pendingCount, amount: pendingTotal.toFixed(0) })
                  : t('trainerHome.money.allPaid', 'All paid up ✓')}
              </div>
            </>
          )}
        </div>
        <ChevronRight size={18} color={TT.textMute} />
      </button>
    );
  };

  // ── Roster (top 5 by sessions) ──
  const rosterClients = useMemo(() => {
    return clients.slice(0, 5).map(c => {
      const churn = churnScores[c.id];
      const status = deriveClientStatus({
        lastActiveAt: c.last_active_at,
        createdAt: c.created_at,
        churnScore: churn ? Number(churn.score) : null,
        churnComputedAt: churn?.computed_at,
      });
      const bars = buildWeekBars(c.id, weekSessions);
      const sessionCount = bars.reduce((a, b) => a + b, 0);
      const adh = weeklyAdherence(sessionCount).pct / 100;
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
        programId: c.assigned_program_id || null,
      };
    });
  }, [clients, churnScores, weekSessions, liveClientIds, dateFnsLocale, t]);

  // ── Today's sessions horizontal strip ──
  // ── Quick handlers ──
  async function openConversation(clientId) {
    const { data: convId, error } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
    if (error || !convId) {
      logger.error('TrainerHome: get_or_create_conversation failed:', error);
      showToast(t('trainerHome.openChatFailed', 'Could not open the chat. Try again.'), 'error');
      return;
    }
    navigate(`/trainer/messages/${convId}`);
  }

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

  // No early return on an empty roster — the home renders its full structure
  // (greeting + sessions + cobros) regardless, with graceful per-section empties.

  const noClients = clients.length === 0;

  // The "Next up" hero uses a light teal-tint gradient as a deliberate Atelier
  // treatment. That gradient only reads as premium on the cream shell — in dark
  // mode it would glow wrong, so we fall back to the theme-aware TT.surface2
  // fill. Read the toggle at render time (ThemeContext re-renders the tree on
  // change, so this stays in sync); presentation-only, touches no data.
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const heroInnerBg = isDark
    ? TT.surface2
    : 'linear-gradient(160deg,#E9F7F4 0%,#F3FBF9 60%,#FFFFFF 100%)';

  // ── KPIs (desktop) ──
  // The workouts/day sparkline only belongs on the workouts KPI — repeating it
  // on the other cards implied per-KPI trend data that doesn't exist.
  const kpiCards = [
    {
      key: 'active',
      label: t('trainerHome.kpi.activeClients', 'Active clients'),
      value: String(activeThisWeek),
      sub: t('trainerHome.kpi.ofRoster', 'of {{total}} roster', { total: totalClients }),
      tone: TT.accent,
      soft: TT.accentSoft,
      Icon: Users,
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
      // Honest label: this is "% of roster active in the last 30 days", not
      // plan adherence.
      key: 'active30',
      label: t('trainerHome.kpi.active30', 'Active (30d)'),
      value: `${retentionPct}%`,
      sub: t('trainerHome.kpi.last30', 'last 30 days'),
      tone: TT.good,
      soft: TT.goodSoft,
      Icon: Activity,
    },
    {
      key: 'attention',
      label: t('trainerHome.kpi.needAttention', 'Need attention'),
      value: String(atRiskClients.length),
      sub: t('trainerHome.kpi.atRiskSub', 'reach out today'),
      tone: TT.hot,
      soft: TT.hotSoft,
      Icon: TrendingUp,
    },
  ];

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }}>
      {/* ─────────────────── MOBILE LAYOUT ─────────────────── */}
      <div className="md:hidden">
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
              <button type="button" onClick={() => fetchHomeData()} className="shrink-0 text-[12px] font-bold px-2 py-1 rounded-lg" style={{ background: TT.surface, color: TT.hot }}>
                {t('trainerDashboard.retry', 'Retry')}
              </button>
            </div>
          </div>
        )}

        {/* Greeting */}
        <div style={{ padding: '14px 20px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: TT.accent, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            {homeEyebrow}
          </div>
          <div style={{ fontFamily: TFont.display, fontSize: 30, fontWeight: 800, color: TT.text, letterSpacing: -1.1, lineHeight: 1.04, marginTop: 6 }}>
            {greeting}{trainerFirstName ? <>{', '}<span style={{ color: TT.accent }}>{trainerFirstName}</span></> : ''}
          </div>
          <div style={{ color: TT.textSub, fontSize: 14, marginTop: 8 }}>
            {t('trainerHome.deskSummary', '{{sessions}} sessions today · {{att}} need attention', {
              sessions: todaySessionsCount,
              att: atRiskClients.length,
            })}
          </div>
        </div>

        {/* Next up hero — light premium card */}
        <div style={{ padding: '0 20px 18px' }}>
          {heroSession ? (
            <TCard padded={6} style={{ overflow: 'hidden' }}>
              <div style={{
                borderRadius: 18, padding: '16px 16px 18px',
                background: heroInnerBg,
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: heroIsToday ? TT.hot : TT.accent, boxShadow: `0 0 0 4px color-mix(in srgb, ${heroIsToday ? TT.hot : TT.accent} 16%, transparent)`, animation: 'live-pulse 2s ease-in-out infinite' }} />
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: heroIsToday ? TT.hot : TT.accentInk }}>
                    {heroWhen}
                  </span>
                  {heroIsLive && (
                    <TPill tone="good" size="s" style={{ marginLeft: 'auto' }}>
                      ● {t('trainerHome.trainingNow', 'Training now')}
                    </TPill>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <TAvatar name={heroName} size={52} idx={avatarIdx(heroClientId)} src={heroSession.profiles?.avatar_url} style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.65)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: TFont.display, fontSize: 20, fontWeight: 800, color: TT.text, letterSpacing: -0.6, lineHeight: 1.1 }}>{heroName}</div>
                    {heroSession.title && <div style={{ fontSize: 13, color: TT.textSub, marginTop: 3 }}>{heroSession.title}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text, letterSpacing: -1, lineHeight: 1 }}>
                      {format(new Date(heroSession.scheduled_at), 'h:mm', { locale: dateFnsLocale })}
                    </div>
                    <div style={{ fontSize: 10.5, color: TT.textMute, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>
                      {t('trainerHome.minLabel', '{{n}} MIN', { n: heroSession.duration_mins || 60 })}
                    </div>
                  </div>
                </div>

                {(heroPR || heroClientLastActive) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    {heroPR && (
                      <div style={{ flex: 1, background: isDark ? TT.surface : 'rgba(255,255,255,0.7)', border: `1px solid ${TT.border}`, borderRadius: 12, padding: '9px 11px' }}>
                        <div style={{ fontSize: 10, color: TT.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('trainerHome.lastPR', 'Last PR')}</div>
                        <div style={{ fontSize: 13, color: TT.text, fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{exName(heroPR.exercises) || ''} · {heroPR.weight_lbs} lb × {heroPR.reps}</div>
                      </div>
                    )}
                    {heroClientLastActive && (
                      <div style={{ flex: 1, background: isDark ? TT.surface : 'rgba(255,255,255,0.7)', border: `1px solid ${TT.border}`, borderRadius: 12, padding: '9px 11px' }}>
                        <div style={{ fontSize: 10, color: TT.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('trainerHome.lastActiveLabel', 'Last active')}</div>
                        <div style={{ fontSize: 13, color: TT.text, fontWeight: 700, marginTop: 3 }}>{format(new Date(heroClientLastActive), 'd MMM', { locale: dateFnsLocale })}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, padding: '12px 10px 8px' }}>
                {heroIsToday ? (
                  <TPrimaryButton onClick={() => navigate(`/trainer/live/${heroClientId}`)}
                    style={{ flex: 1, height: 48, fontFamily: TFont.display, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, letterSpacing: 0.2 }}>
                    <Play size={17} strokeWidth={2.4} fill="currentColor" /> {t('trainerHome.startSession', 'Start session')}
                  </TPrimaryButton>
                ) : (
                  <TPrimaryButton onClick={() => navigate(`/trainer/clients/${heroClientId}`)}
                    style={{ flex: 1, height: 48, fontFamily: TFont.display, fontWeight: 800, letterSpacing: 0.2 }}>
                    {t('trainerHome.openClientCta', 'Open client')}
                  </TPrimaryButton>
                )}
                {/* Icon pair — real tactile buttons (radius + surface chrome), not
                    bare boxes; member-info always sits next to message. */}
                <button type="button" onClick={() => openConversation(heroClientId)} aria-label={t('trainerHome.message', 'Message')}
                  className="tt-btn tt-btn--secondary"
                  style={{ width: 48, height: 48, padding: 0, borderRadius: 14, display: 'grid', placeItems: 'center' }}>
                  <MessageSquare size={19} strokeWidth={2.1} />
                </button>
                {/* "Open client" icon — only when the primary CTA is NOT already
                    "Open client" (i.e. on a today session where primary = Start),
                    so it never duplicates the main button. */}
                {heroIsToday && (
                  <button type="button" onClick={() => navigate(`/trainer/clients/${heroClientId}`)} aria-label={t('trainerHome.openClientShort', 'Open client')}
                    className="tt-btn tt-btn--secondary"
                    style={{ width: 48, height: 48, padding: 0, borderRadius: 14, display: 'grid', placeItems: 'center' }}>
                    <User size={19} strokeWidth={2.1} />
                  </button>
                )}
              </div>
            </TCard>
          ) : (
            <TCard padded={18} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>
                {noClients ? t('trainerHome.noClientsYet', 'No clients yet') : t('trainerHome.noUpcoming', 'No upcoming sessions')}
              </div>
              <div style={{ fontSize: 12.5, color: TT.textSub, marginTop: 4 }}>
                {noClients ? t('trainerHome.noClientsYetSub', 'Add a client to start scheduling sessions and tracking payments.') : t('trainerHome.noUpcomingSub', 'Schedule a session with a client to see it here.')}
              </div>
              <TPrimaryButton onClick={() => navigate(noClients ? '/trainer/clients' : '/trainer/calendar')}
                style={{ marginTop: 12, fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5 }}>
                {noClients ? t('trainerHome.addClients', 'Add clients') : t('trainerHome.viewAgenda', 'View calendar')}
              </TPrimaryButton>
            </TCard>
          )}
        </div>

        {/* Live sessions — every client working out right now, one tap from
            the live spectator view. Realtime on session_drafts keeps it hot. */}
        {liveNow.length > 0 && (
          <div style={{ padding: '0 0 18px' }}>
            <div style={{ padding: '0 20px' }}>
              <TSectionHeader
                title={t('trainerHome.liveNow', 'En vivo ahora')}
                action={String(liveNow.length)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '0 20px' }}>
              {liveNow.map(({ client: c, draft: d, mins }) => {
                const name = c.full_name || c.username || t('trainerMessages.list.clientFallback', 'Client');
                return (
                  <TCard
                    key={c.id}
                    padded={13}
                    onClick={() => navigate(`/trainer/live/${c.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', position: 'relative' }}
                  >
                    <div style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 999, background: TT.good }} />
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <TAvatar name={name} size={40} idx={avatarIdx(c.id)} src={c.avatar_url} />
                      <span style={{
                        position: 'absolute', right: -2, bottom: -2, width: 11, height: 11, borderRadius: 999,
                        background: TT.good, border: `2px solid ${TT.surface}`,
                        animation: 'live-pulse 2s ease-in-out infinite',
                      }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                      <div style={{ fontSize: 12, color: TT.textSub, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ color: TT.good, fontWeight: 800 }}>● {t('trainerHome.trainingNow', 'Training now')}</span>
                        {' · '}{mins} min{d.routine_name ? ` · ${d.routine_name}` : ''}
                        {d.is_paused ? ` · ${t('trainerHome.livePaused', 'Paused')}` : ''}
                      </div>
                    </div>
                    <TPrimaryButton
                      onClick={(e) => { e.stopPropagation(); navigate(`/trainer/live/${c.id}`); }}
                      style={{ padding: '8px 13px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {t('trainerHome.watchLive', 'Watch live')}
                    </TPrimaryButton>
                  </TCard>
                );
              })}
            </div>
          </div>
        )}

        {/* Today's lineup — horizontal swipe cards (today's remaining sessions
            only; future days live in the hero fallback + calendar, not here) */}
        {lineupToday.length > 0 && (
          <div style={{ padding: '0 0 18px' }}>
            <div style={{ padding: '0 20px' }}>
              <TSectionHeader
                title={t('trainerHome.todaysLineup', "Today's lineup")}
                action={`${lineupToday.length} · ${lineupHours}`}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 20px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
              {lineupToday.map((s) => {
                const cId = s.profiles?.id || s.client_id;
                const cName = s.profiles?.full_name || s.profiles?.username || t('trainerCalendar.client', 'Client');
                const d = new Date(s.scheduled_at);
                const isLive = !!cId && liveClientIds.has(cId);
                return (
                  <button key={s.id} type="button" onClick={() => navigate(`/trainer/clients/${cId}`)} className="tt-tap"
                    style={{ minWidth: 156, padding: 12, borderRadius: 14, background: TT.surface, border: `1px solid ${TT.border}`, boxShadow: TT.shadow, flexShrink: 0, textAlign: 'left', cursor: 'pointer' }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: isLive ? TT.good : TT.accentInk, letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {isLive ? `● ${t('trainerHome.trainingNow', 'Training now')}` : t('trainerHome.todayShort', 'Today')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 }}>
                      <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.4, lineHeight: 1 }}>{format(d, 'h:mm', { locale: dateFnsLocale })}</div>
                      <span style={{ fontFamily: TFont.mono, fontSize: 10, color: TT.textMute, fontWeight: 700 }}>{s.duration_mins || 60}m</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                      <TAvatar name={cName} size={24} idx={avatarIdx(cId)} src={s.profiles?.avatar_url} />
                      <div style={{ fontSize: 12, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{cName.split(' ')[0]}</div>
                    </div>
                    {s.title && <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{s.title}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Attend today + Cobros/Adherencia */}
        <div style={{ padding: '4px 16px 14px' }}>
          {atRiskClients.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>{t('trainerHome.needsAttention', 'Needs attention')}</div>
                  <TPill tone="hot" size="s">{atRiskClients.length}</TPill>
                </div>
                <button type="button" onClick={() => navigate('/trainer/clients')} style={{ fontSize: 11.5, color: TT.textSub, fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer' }}>{t('trainerHome.seeAll', 'See all →')}</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 14 }}>
                {atRiskClients.slice(0, 3).map((item, idx) => {
                  const c = item.client;
                  const tone = statusTone(item.status);
                  const name = c.full_name || c.username || t('trainerDashboard.unknownFallback');
                  const reason = attentionReason(item);
                  // Top item (most inactive after the sort) gets the loud primary
                  // CTA; the rest get the quieter secondary treatment.
                  const isTop = idx === 0;
                  return (
                    <TCard key={c.id} padded={13} style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 999, background: tone }} />
                      <TAvatar name={name} size={40} idx={avatarIdx(c.id)} src={c.avatar_url} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: TT.text }}>{name}</div>
                        <div style={{ fontSize: 12, color: tone, fontWeight: 700, marginTop: 2 }}>{reason}</div>
                      </div>
                      {isTop ? (
                        <TPrimaryButton onClick={() => openConversation(c.id)}
                          style={{ padding: '8px 13px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
                          {t('trainerHome.reachOut', 'Reach out')}
                        </TPrimaryButton>
                      ) : (
                        <button type="button" onClick={() => openConversation(c.id)}
                          className="tt-btn tt-btn--secondary"
                          style={{ padding: '8px 13px', borderRadius: 14, fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
                          {t('trainerHome.greet', 'Say hi')}
                        </button>
                      )}
                    </TCard>
                  );
                })}
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: moneyOverview ? '1fr 1fr' : '1fr', gap: 8, alignItems: 'stretch' }}>
            {/* Cobros — teal. Hidden entirely when the money RPC errored or is
                missing; setup copy when no client has a fee yet — never a fake
                "$0 · All paid". */}
            {moneyOverview && (
              <button type="button" onClick={() => navigate('/trainer/payments')}
                style={{ padding: 0, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', display: 'block', height: '100%' }}>
                <TCard padded={14} style={{ height: '100%', boxShadow: `inset 3px 0 0 ${TT.accent}, ${TT.shadow}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: TT.accentSoft, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <DollarSign size={13} strokeWidth={2.6} style={{ color: TT.accent }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: TT.accentInk, letterSpacing: 1, textTransform: 'uppercase' }}>{t('trainerPayments.title', 'Payments')}</span>
                  </div>
                  {(moneyOverview.with_fee || 0) === 0 ? (
                    <div style={{ fontSize: 12, color: TT.textSub, fontWeight: 600 }}>
                      {t('trainerHome.money.setup', 'Set client fees to track payments')}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.text, letterSpacing: -0.8, lineHeight: 1 }}>${cobrosPending.toFixed(0)}</div>
                      <div style={{ fontSize: 11, color: cobrosPendingCount > 0 ? TT.hot : TT.good, fontWeight: 700, marginTop: 4 }}>
                        {cobrosPendingCount > 0 ? t('trainerHome.nPending', '{{count}} pending', { count: cobrosPendingCount }) : t('trainerHome.allPaidShort', 'All paid')}
                      </div>
                      {cobrosAvatars.length > 0 && (
                        <div style={{ display: 'flex', marginTop: 8 }}>
                          {cobrosAvatars.map((c, i) => (
                            <div key={i} style={{ marginLeft: i ? -8 : 0, border: `2px solid ${TT.surface}`, borderRadius: 999 }}>
                              <TAvatar name={c.full_name || '?'} size={22} idx={avatarIdx(c.client_id)} src={c.avatar_url} />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </TCard>
              </button>
            )}
            {/* Activos (30d) — green, taps to clients */}
            <button type="button" onClick={() => navigate('/trainer/clients')}
              style={{ padding: 0, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', display: 'block', height: '100%' }}>
              <TCard padded={14} style={{ height: '100%', background: TT.goodSoft, borderColor: 'transparent', boxShadow: `inset 3px 0 0 ${TT.good}, ${TT.shadow}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 7, background: TT.surface, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Activity size={13} strokeWidth={2.6} style={{ color: TT.good }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, color: TT.goodInk, letterSpacing: 1, textTransform: 'uppercase' }}>{t('trainerHome.kpi.active30', 'Active (30d)')}</span>
                </div>
                <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.goodInk, letterSpacing: -0.8, lineHeight: 1 }}>{retentionPct}<span style={{ fontSize: 13, color: TT.good, opacity: 0.7 }}>%</span></div>
                <div style={{ fontSize: 11, color: TT.goodInk, opacity: 0.75, fontWeight: 600, marginTop: 4 }}>{t('trainerHome.kpi.last30', 'last 30 days')}</div>
              </TCard>
            </button>
          </div>
        </div>

        {/* Recent PRs — compact celebration list, taps through to the client */}
        {prRows.length > 0 && (
          <div style={{ padding: '0 16px 18px' }}>
            <TSectionHeader title={t('trainerHome.recentPRs', 'Recent PRs')} />
            <TCard padded={0} style={{ overflow: 'hidden' }}>
              {prRows.map((p, i) => (
                <button key={p.id} type="button" onClick={() => navigate(`/trainer/clients/${p.clientId}`)}
                  className="tt-tap"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', background: 'transparent', border: 'none', borderTop: i > 0 ? `1px solid ${TT.border}` : 'none', textAlign: 'left', cursor: 'pointer' }}>
                  <TAvatar name={p.clientName} size={30} idx={avatarIdx(p.clientId)} src={p.avatarUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.clientName}</div>
                    <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.exercise}</div>
                  </div>
                  <span style={{ fontFamily: TFont.mono, fontSize: 11.5, fontWeight: 800, color: TT.accentInk, whiteSpace: 'nowrap' }}>{p.detail}</span>
                </button>
              ))}
            </TCard>
          </div>
        )}
      </div>

      {/* ─────────────────── DESKTOP LAYOUT ─────────────────── */}
      <div className="hidden md:block">
        <main style={{ padding: '24px 28px 32px', maxWidth: 1280, margin: '0 auto' }}>
          {/* Error banner (mirrors mobile) */}
          {error && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-2xl"
              style={{ background: TT.hotSoft, color: TT.hot, marginBottom: 18 }}>
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold">{t('trainerDashboard.errorTitle', 'Failed to load dashboard')}</p>
                <p className="text-[12px] mt-0.5 truncate">{error}</p>
              </div>
              <button type="button" onClick={() => fetchHomeData()} className="shrink-0 text-[12px] font-bold px-2 py-1 rounded-lg" style={{ background: TT.surface, color: TT.hot }}>
                {t('trainerDashboard.retry', 'Retry')}
              </button>
            </div>
          )}

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

          {/* Money card */}
          {moneyOverview && (
            <div style={{ marginBottom: 16, maxWidth: 460 }}>
              {renderMoneyCard()}
            </div>
          )}

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
                  {k.spark ? <TSparkBars data={k.spark} w={64} h={24} color={k.tone} /> : null}
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
            <TCard padded={0} style={{ overflow: 'hidden' }}>
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
                <button
                  type="button"
                  onClick={() => navigate('/trainer/calendar')}
                  className="tt-tap"
                  style={{ color: TT.accent, fontSize: 12, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {t('trainerHome.viewAgenda', 'View calendar')} →
                </button>
              </div>

              {/* Timeline body */}
              <div style={{ padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'relative', height: 120 }}>
                  {/* hour ticks — every 2h across the dynamic domain */}
                  {Array.from({ length: Math.floor(tlDomain.span / 2) + 1 }).map((_, i) => {
                    const hr = tlDomain.start + i * 2;
                    return (
                      <div key={i} style={{
                        position: 'absolute',
                        left: `${((hr - tlDomain.start) / tlDomain.span) * 100}%`,
                        top: 0, bottom: 0,
                        borderLeft: `1px dashed ${TT.border}`,
                      }}>
                        <div style={{
                          position: 'absolute', top: -2, left: 4,
                          fontSize: 10, color: TT.textMute,
                          fontFamily: TFont.mono, fontWeight: 700,
                        }}>{tickLabel(hr)}</div>
                      </div>
                    );
                  })}
                  {/* now line */}
                  {(() => {
                    const now = new Date();
                    const hours = now.getHours() + now.getMinutes() / 60;
                    const pct = Math.max(0, Math.min(100, ((hours - tlDomain.start) / tlDomain.span) * 100));
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
                    const left = Math.max(0, Math.min(100, ((startHr - tlDomain.start) / tlDomain.span) * 100));
                    const width = Math.max(2, Math.min(20, (dur / tlDomain.span) * 100, 100 - left));
                    const isNext = i === todaySessions.findIndex(x => x.status !== 'completed' && sessionEndMs(x) >= Date.now());
                    const tone = statusTone('on_track');
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
                  // Real program name from gym_programs; "No program" only when
                  // truly unassigned; '—' when the lookup itself failed.
                  const program = c.programId
                    ? (programNames == null ? '—' : (programNames[c.programId] || t('trainerHome.programFallback', 'No program')))
                    : t('trainerHome.programFallback', 'No program');
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

            {/* Right column: Need attention + Recent PRs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
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
                  const tone = statusTone(item.status);
                  const name = c.full_name || c.username || t('trainerDashboard.unknownFallback');
                  const reason = attentionReason(item);
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

            {/* Recent PRs — compact celebration list, taps through to the client */}
            {prRows.length > 0 && (
              <TCard padded={0}>
                <div style={{
                  padding: '14px 18px', borderBottom: `1px solid ${TT.border}`,
                  fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
                  color: TT.text, letterSpacing: -0.3,
                }}>
                  {t('trainerHome.recentPRs', 'Recent PRs')}
                </div>
                {prRows.map((p, i) => (
                  <button key={p.id} type="button" onClick={() => navigate(`/trainer/clients/${p.clientId}`)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 18px', background: 'transparent', border: 'none', borderTop: i > 0 ? `1px solid ${TT.border}` : 'none', textAlign: 'left', cursor: 'pointer' }}>
                    <TAvatar name={p.clientName} size={28} idx={avatarIdx(p.clientId)} src={p.avatarUrl} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.clientName}</div>
                      <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.exercise}</div>
                    </div>
                    <span style={{ fontFamily: TFont.mono, fontSize: 11, fontWeight: 800, color: TT.accentInk, whiteSpace: 'nowrap' }}>{p.detail}</span>
                  </button>
                ))}
              </TCard>
            )}
            </div>
          </div>

          {todayDate && (
            <div style={{ fontSize: 11, color: TT.textMute, marginTop: 24, textAlign: 'center' }}>
              {todayDate}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
