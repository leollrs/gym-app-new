import { useState, useEffect, useReducer, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, ChevronLeft, ClipboardList,
  Dumbbell, Pencil, Trophy, Play, Flame, QrCode, CheckCircle2, MessageCircle, CalendarCheck,
  Activity, ArrowLeftRight, Trash2, Leaf, CalendarPlus, History,
} from 'lucide-react';
import { programTemplateNames } from '../data/programTemplateNames';
import { isSameDay, isBefore, startOfDay, startOfWeek, format } from 'date-fns';
import { es as esLocale, enUS } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getCached, setCache } from '../lib/queryCache';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { computeStreakFromSessions } from '../lib/achievements';
import { hasCardioLoggedAfter, hasRecentCardioLog, recordCardioLogged } from '../lib/cardioLedger';
import { getRewardTier } from '../lib/rewardsEngine';
import { getLevel } from '../components/LevelBadge';
import { exercises as exerciseLibrary } from '../data/exercises';
import { localizeRoutineName } from '../lib/exerciseName';
import { translateCreativeName } from '../lib/programNaming';
import { getCurrentWeekClamped, getTotalProgramWeeks, getProgramWeekNum } from '../lib/programWeek';
import { AppleHealthSourceBadge } from '../components/AppleHealthBadge';
import { tg } from '../lib/genderText';
import GymPulse from '../components/GymPulse';
import GymWOD from '../components/GymWOD';
import { getTodayChallenge } from '../lib/dailyChallenges';

import DayStrip from '../components/DayStrip';
import WorkoutHeroCard from '../components/WorkoutHeroCard';
import ReadinessModal from '../components/ReadinessModal';
import { useRecentSessionsWithSets } from '../hooks/useSupabaseQuery';
import { computeDashboardReadiness, loadCachedRecoveryMetrics } from '../lib/readinessEngine';
import CoachMark from '../components/CoachMark';
// 8 modals lazy-loaded — most users never open them in a session, but eagerly
// importing them inflated the Dashboard chunk by ~30-50 KB. Each is gated by
// its open state so the chunk only fetches when the user actually opens it.
const RoutinePickerModal     = lazy(() => import('../components/RoutinePickerModal'));
const QRCodeModal            = lazy(() => import('../components/QRCodeModal'));
const ReferralRewardBanner   = lazy(() => import('../components/ReferralRewardBanner'));
const NPSSurveyModal         = lazy(() => import('../components/NPSSurveyModal'));
const CardioLogModal         = lazy(() => import('../components/CardioLogModal'));
const MyPlanModal            = lazy(() => import('../components/MyPlanModal'));
const BackdatedWorkoutModal  = lazy(() => import('../components/BackdatedWorkoutModal'));
const DeletedWorkoutsModal   = lazy(() => import('../components/DeletedWorkoutsModal'));
const WellnessCheckinModal   = lazy(() => import('../components/WellnessCheckinModal'));
// AppTour moved to App.jsx to persist across page navigations

// Build a lookup: exercise_id → videoUrl
const videoMap = {};
const exerciseNameMap = {};
for (const ex of exerciseLibrary) {
  if (ex.videoUrl) videoMap[ex.id] = ex.videoUrl;
  exerciseNameMap[ex.id] = ex.name;
}

/* ── Helpers ──────────────────────────────────────────────── */
const readActiveSession = () => {
  try {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('gym_session_')) continue;
      const data = JSON.parse(localStorage.getItem(key));
      if (data?.loggedSets && data?.startedAt && new Date(data.startedAt).getTime() > oneDayAgo) {
        return { routineId: key.replace('gym_session_', ''), ...data };
      }
    }
  } catch { }
  return null;
};

/** Read ALL active draft sessions from localStorage (for showing resume banners) */
const readAllActiveSessions = () => {
  const sessions = [];
  try {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('gym_session_')) continue;
      const data = JSON.parse(localStorage.getItem(key));
      if (data?.loggedSets && data?.startedAt && new Date(data.startedAt).getTime() > oneDayAgo) {
        sessions.push({ routineId: key.replace('gym_session_', ''), ...data });
      }
    }
  } catch { }
  return sessions;
};


/* ── Reducer ─────────────────────────────────────────────── */
const makeInitialState = (userId) => {
  // Hydrate synchronously from cache (sessionStorage → now localStorage via
  // queryCache). This eliminates the skeleton flash on tab switch — by the
  // time render happens we already have data.
  const cached = userId ? getCached(`dash:${userId}`)?.data : null;
  const base = {
    stats: { sessions: 0, streak: 0 },
    allRoutines: [],
    schedule: {},
    selectedRoutine: null,
    selectedRoutineExercises: [],
    lastSessionForRoutine: null,
    scheduledWorkoutDays: [],
  };
  if (cached) return { ...base, ...cached, loading: false };
  return { ...base, loading: true };
};

function dashReducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'HYDRATE':
      return { ...state, ...action.payload, loading: false };
    case 'SET_ALL':
      return { ...state, ...action.payload, loading: false };
    case 'SET_SCHEDULE':
      return { ...state, schedule: action.payload };
    case 'SET_SELECTED_ROUTINE':
      return {
        ...state,
        selectedRoutine: action.payload.routine,
        selectedRoutineExercises: action.payload.exercises,
        lastSessionForRoutine: action.payload.lastSession,
      };
    default:
      return state;
  }
}

/* ── Skeleton ────────────────────────────────────────────── */
const PulseBlock = ({ className }) => (
  <div className={`rounded-2xl animate-pulse ${className}`} style={{ background: 'var(--color-surface-hover)' }} />
);

const DashboardSkeleton = ({ ariaLabel }) => (
  <div className="space-y-5" aria-busy={true} aria-label={ariaLabel}>
    <PulseBlock className="h-10" />
    <PulseBlock className="h-16" />
    <PulseBlock className="h-8 w-64" />
    <PulseBlock className="h-[360px] rounded-2xl" />
  </div>
);

/* ── Live Cardio Hero (with ticking timer) ───────────────── */
const LiveCardioHeroCard = ({ liveCardioSession: lc, t }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!lc?.running) return;
    const id = setInterval(() => setTick(k => k + 1), 1000);
    return () => clearInterval(id);
  }, [lc?.running]);

  let totalSec = lc.accumulatedSec || 0;
  if (lc.running && lc.startedAt) {
    totalSec += (Date.now() - new Date(lc.startedAt).getTime()) / 1000;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const typeName = t(`cardio.types.${lc.cardioType}`, lc.cardioType);

  return (
    <Link
      to="/cardio-live"
      className="w-full rounded-2xl bg-gradient-to-br from-[#10B981]/12 to-[#10B981]/[0.02] border border-[#10B981]/20 p-6 text-center active:scale-[0.99] transition-transform block"
    >
      <div className="w-14 h-14 rounded-2xl bg-[#10B981]/15 flex items-center justify-center mx-auto mb-4">
        <Activity size={28} className="text-[#10B981]" />
      </div>
      <p className="font-bold text-[18px]" style={{ color: 'var(--color-text-primary)' }}>
        {typeName} {t('cardio.inProgress', 'in progress')}
      </p>
      <p className="text-[32px] font-black tabular-nums mt-2 text-[#10B981]">
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </p>
      <p className="text-[13px] mt-3 font-semibold" style={{ color: '#10B981' }}>
        {t('dashboard.tapToResume')}
      </p>
    </Link>
  );
};

/* ── Main ────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile, lifetimePoints: ctxLifetimePoints, refreshProfile, gymConfig } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'workout'|'cardio', id, name }

  const [state, dispatch] = useReducer(dashReducer, user?.id, makeInitialState);
  const {
    loading, stats, allRoutines,
    schedule, selectedRoutine, selectedRoutineExercises,
    lastSessionForRoutine, scheduledWorkoutDays,
  } = state;

  const [selectedDate, setSelectedDate] = useState(new Date());
  // Tracks the routine the dashboard auto-picked for *today* on load. Used to
  // restore today's view when the user navigates away and returns to today on
  // a day with no explicit schedule (so we don't keep stale routine data from
  // another day, e.g. Mon's workout still showing after returning to a closed Sunday).
  const autoTodayRoutineIdRef = useRef(null);
  // Hero-related data slots are cached so Dashboard re-mounts (e.g. returning
  // from the Workouts tab) paint immediately instead of flashing the skeleton.
  // The `todaysSessionsLoaded` sentinel starts as "true" whenever we already
  // have cached hero state, which is what the hero renderer actually checks.
  const heroCacheKey = `dashboard-hero-${user?.id || 'anon'}`;
  const [todaysSessions, setTodaysSessions] = useCachedState(`${heroCacheKey}-today`, []);
  const [weekCardioSessions, setWeekCardioSessions] = useCachedState(`${heroCacheKey}-week-cardio`, []);
  const [todaysSessionsLoaded, setTodaysSessionsLoaded] = useState(() => hasCachedState(`${heroCacheKey}-today`));
  const today = new Date().toISOString().split('T')[0];
  const [localSkipped, setLocalSkipped] = useState(false);
  const skippedToday = localSkipped || profile?.skip_suggestion_date === today;
  const [weekSessions, setWeekSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(() => readActiveSession());
  const [allActiveDrafts, setAllActiveDrafts] = useState(() => readAllActiveSessions());
  const [showBackdatedModal, setShowBackdatedModal] = useState(false);
  const [showDeletedModal, setShowDeletedModal] = useState(false);
  // Opens the Recovery / Readiness modal from the post-workout action row
  // (next to Edit / Swap). Independent from the hero-card pill so both
  // surfaces can drive the same modal without lifting state from the card.
  const [readinessOpen, setReadinessOpen] = useState(false);
  // True while AppTour is running. We use it to force-render the Recovery
  // pill so the "tour-recovery-pill" stop always has its anchor on screen,
  // even on a training day where the normal gate would hide the pill until
  // after the workout. Driven by the `app-tour-active` window event.
  const [appTourActive, setAppTourActive] = useState(() => {
    try { return !!window.__appTourActive; } catch { return false; }
  });
  useEffect(() => {
    const onTour = (e) => setAppTourActive(!!e?.detail);
    window.addEventListener('app-tour-active', onTour);
    return () => window.removeEventListener('app-tour-active', onTour);
  }, []);
  // Bumped whenever a wellness check-in is saved. Wired into the readiness
  // memo's deps so the score on the Recovery pill refreshes immediately
  // instead of waiting for the user to open + close the Readiness modal
  // (which previously was the only thing that re-keyed the memo).
  const [wellnessRefreshKey, setWellnessRefreshKey] = useState(0);
  // Refresh active drafts when page becomes visible (user returns from a workout)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setAllActiveDrafts(readAllActiveSessions());
        setActiveSession(readActiveSession());
        setLiveCardioSession(readLiveCardio());
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    // Also refresh on mount (covers React Router navigation)
    setAllActiveDrafts(readAllActiveSessions());
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);
  // Live cardio session state — refreshed on mount + visibility change.
  // Four guards, any one of which kills the entry:
  //   1. phase must be 'tracking' (saveDraft only writes that phase).
  //   2. lastUpdate must be present and < 12h old (covers stale OS kills and
  //      old bundles that didn't write the field).
  //   3. accumulatedSec > 0 OR running === true (an empty draft isn't live).
  //   4. The cardio ledger must NOT contain a "logged" event newer than this
  //      draft's startedAt. The ledger is an append-only tombstone written by
  //      LiveCardio.handleSubmit on every successful (or queued) log — it
  //      survives DB delete, WebView restart, and bundle updates, so the
  //      "delete then restart resurrects the run" failure mode is fixed at
  //      the source: even if the localStorage draft is stuck, the ledger
  //      proves the run was already finished.
  const LIVE_CARDIO_STALE_MS = 12 * 60 * 60 * 1000;
  const readLiveCardio = () => {
    try {
      const lc = JSON.parse(localStorage.getItem('tugympr_live_cardio'));
      if (!lc) return null;
      const isLive = (lc.accumulatedSec > 0 || lc.running) && lc.phase === 'tracking';
      const isFresh = lc.lastUpdate && (Date.now() - lc.lastUpdate) < LIVE_CARDIO_STALE_MS;
      const supersededByLog = lc.startedAt
        ? hasCardioLoggedAfter(user?.id, lc.startedAt)
        : hasRecentCardioLog(user?.id, 6 * 60 * 60 * 1000);
      if (!isLive || !isFresh || supersededByLog) {
        localStorage.removeItem('tugympr_live_cardio');
        return null;
      }
      return lc;
    } catch {}
    return null;
  };
  const [liveCardioSession, setLiveCardioSession] = useState(readLiveCardio);
  useEffect(() => {
    const refresh = () => setLiveCardioSession(readLiveCardio());
    refresh(); // on mount
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);

  const [refreshKey, setRefreshKey] = useState(0);

  // Bump refreshKey when the tab becomes visible again — covers the case
  // where the user backgrounds the app, completes a workout on Watch, etc.
  // (Within-app tab navigation is already handled by the locationKey effect
  // below; the keep-alive wrapper in App.jsx keeps Dashboard mounted across
  // tab switches.)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setRefreshKey((k) => k + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const [liveChallenge, setLiveChallenge] = useState(null);
  const [gymClosedDays, setGymClosedDays] = useState(new Set());
  const [todayClassBookings, setTodayClassBookings] = useState([]);
  const [userPoints, setUserPoints] = useState(ctxLifetimePoints ?? 0);
  useEffect(() => { if (ctxLifetimePoints != null) setUserPoints(ctxLifetimePoints); }, [ctxLifetimePoints]);
  const handleSkipSuggestion = async () => {
    setLocalSkipped(true);
    supabase.from('profiles').update({ skip_suggestion_date: today }).eq('id', user.id)
      .then(() => refreshProfile());
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDay, setPickerDay] = useState(0);
  const [activeProgram, setActiveProgram] = useState(null);
  const [showPlanInfo, setShowPlanInfo] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showCardioLog, setShowCardioLog] = useState(false);
  const [showWellnessCheckin, setShowWellnessCheckin] = useState(false);
  const [planWeek, setPlanWeek] = useState(1);
  const [planSelectedDay, setPlanSelectedDay] = useState(null);
  const [fullTemplates, setFullTemplates] = useState(null);
  const [loadError, setLoadError] = useState('');

  // Lazy-load full programTemplates only when plan info panel is opened
  useEffect(() => {
    if (showPlanInfo && !fullTemplates) {
      import('../data/programTemplates').then(m => setFullTemplates(m.programTemplates || m.default?.programTemplates || []));
    }
  }, [showPlanInfo, fullTemplates]);

  // Daily wellness check-in prompt on Dashboard mount. Fires once per session,
  // and only when (a) no DB row exists for today's date, (b) no localStorage
  // cache of today's check-in, and (c) the user hasn't already skipped today.
  // This is the surface the 9 AM local notification taps into — users arrive
  // on Dashboard and the modal should be waiting for them.
  const wellnessPromptFiredRef = useRef(false);
  useEffect(() => {
    if (!user?.id || wellnessPromptFiredRef.current) return;
    wellnessPromptFiredRef.current = true;
    let cancelled = false;
    const d = new Date();
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // localStorage short-circuits — either a saved checkin or a "skipped
    // today" marker means we don't re-prompt.
    try {
      const raw = localStorage.getItem('tugympr_wellness_last_checkin');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.date === dateKey && typeof parsed.soreness === 'number') return;
      }
      if (localStorage.getItem('tugympr_wellness_skipped_date') === dateKey) return;
    } catch {}
    (async () => {
      const { data } = await supabase
        .from('wellness_checkins')
        .select('soreness')
        .eq('profile_id', user.id)
        .eq('checkin_date', dateKey)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        // Slight delay so the Dashboard paints first.
        setTimeout(() => {
          if (cancelled) return;
          // Don't pop the wellness modal over the first-launch demo. AppTour
          // sets window.__appTourActive while running and writes
          // `app_tour_completed_<userId>` to localStorage on dismiss/finish —
          // wait for both signals before prompting so a brand-new user
          // sees the tour first, then can do wellness check-ins later.
          if (window.__appTourActive) return;
          try {
            if (localStorage.getItem(`app_tour_completed_${user.id}`) !== 'true') return;
          } catch {}
          setShowWellnessCheckin(true);
        }, 800);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleWellnessSkip = useCallback(() => {
    try {
      const d = new Date();
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      localStorage.setItem('tugympr_wellness_skipped_date', dateKey);
    } catch {}
    setShowWellnessCheckin(false);
  }, []);

  const activeSetsCompleted = activeSession
    ? Object.values(activeSession.loggedSets).flat().filter(s => s.completed).length
    : 0;
  const activeSetsTotal = activeSession
    ? Object.values(activeSession.loggedSets).flat().length
    : 0;

  useEffect(() => { document.title = t('pages.dashboard.title'); }, [t]);

  // Scroll locking for modals
  useEffect(() => {
    if (showPlanInfo) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showPlanInfo]);
  useEffect(() => {
    if (showQR) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showQR]);
  useEffect(() => {
    if (showCardioLog) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showCardioLog]);
  useEffect(() => {
    if (pickerOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [pickerOpen]);

  // Re-check active session & refresh data on every render/navigation
  const location = useLocation();
  const locationKey = location.key;

  useEffect(() => {
    setActiveSession(readActiveSession());
    setAllActiveDrafts(readAllActiveSessions());
    setLiveCardioSession(readLiveCardio());
    setRefreshKey(k => k + 1);
  }, [locationKey]);

  // Also refresh on visibility change (e.g. app foregrounded)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setActiveSession(readActiveSession());
        setAllActiveDrafts(readAllActiveSessions());
        setRefreshKey(k => k + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Refresh when another page signals that the user's programs changed
  // (regenerate, reactivate, switch). Dashboard is a keep-alive route so it
  // stays mounted across navigation — without this listener, the home page
  // can keep rendering the previous program until the user manually pulls
  // to refresh or backgrounds + foregrounds the app.
  useEffect(() => {
    const onProgramsChanged = () => {
      autoTodayRoutineIdRef.current = null;
      setRefreshKey(k => k + 1);
    };
    window.addEventListener('tugympr:programs-changed', onProgramsChanged);
    return () => window.removeEventListener('tugympr:programs-changed', onProgramsChanged);
  }, []);

  // Hydrate from cache — fires when user.id becomes available (reducer init may
  // have run before auth resolved). If we already have state from the reducer's
  // lazy init, this is a no-op update; React Query persist cache will keep it
  // fresh in the background via the main load effect below.
  useEffect(() => {
    const cached = getCached(`dash:${user?.id}`);
    if (cached?.data) dispatch({ type: 'HYDRATE', payload: cached.data });
  }, [user?.id]);

  // In-flight guard for the dashboard load. Visibility-change handlers above
  // bump refreshKey, which can re-run this effect before the previous fetch
  // resolves (tab back fast → 2-3 simultaneous Supabase reads). The ref makes
  // the second invocation no-op until the first completes.
  const fetchingRef = useRef(false);
  // When a load is skipped due to fetchingRef, mark a rerun as pending so the
  // in-flight load can retrigger after it finishes. Without this, the
  // in-flight load may complete under `cancelled=true` (deps changed during
  // await) and skip its dispatch — leaving state stuck at loading=true until
  // the user navigates away and back.
  const rerunPendingRef = useRef(false);

  // Load data
  useEffect(() => {
    if (!user || !profile) return;
    let cancelled = false;

    const load = async () => {
      if (fetchingRef.current) {
        rerunPendingRef.current = true;
        return;
      }
      fetchingRef.current = true;
      rerunPendingRef.current = false;
      try {
      setLoadError('');
      const hasCached = !!getCached(`dash:${user.id}`)?.data;
      if (!hasCached) dispatch({ type: 'SET_LOADING', payload: true });

      // Start RPC + class bookings + cardio sessions in parallel (gymConfig is from AuthContext, available immediately)
      const rpcPromise = supabase.rpc('get_dashboard_data');
      const classPromise = gymConfig?.classesEnabled
        ? supabase
            .from('gym_class_bookings')
            .select('id, schedule_id, status, booking_date, gym_class_schedules(start_time, end_time, gym_classes(name, name_es, image_url))')
            .eq('profile_id', user.id)
            .eq('booking_date', new Date().toISOString().split('T')[0])
            .in('status', ['confirmed', 'attended'])
        : Promise.resolve({ data: [] });
      const weekCardioStart = startOfWeek(new Date(), { weekStartsOn: 0 });
      const cardioPromise = supabase
        .from('cardio_sessions')
        .select('id, cardio_type, duration_seconds, calories_burned, distance_km, started_at')
        .eq('profile_id', user.id)
        .gte('started_at', weekCardioStart.toISOString());

      const [{ data: rpcData, error: rpcError }, { data: classBookings }, { data: cardioData }] = await Promise.all([rpcPromise, classPromise, cardioPromise]);

      if (rpcError) {
        if (!cancelled) {
          dispatch({ type: 'SET_LOADING', payload: false });
          setLoadError(t('dashboard.loadError', 'We could not load your dashboard right now. Pull to refresh or try again in a moment.'));
        }
        return;
      }

      // Class bookings + cardio sessions already fetched in parallel above
      if (!cancelled) setTodayClassBookings(classBookings || []);
      if (!cancelled) setWeekCardioSessions(cardioData || []);

      // ── Live-cardio reconciliation ────────────────────────────────────
      // Two signals can prove the localStorage draft is dead, even though
      // the saveDraft loop never got to clean it up:
      //   a) DB has any cardio_session for this user (logged-then-still-here)
      //   b) Ledger has a "logged" tombstone (logged-then-deleted — the
      //      exact scenario where the DB row is gone but the run definitely
      //      finished). The ledger survives delete by design.
      // We only kill the draft if its lastUpdate is older than 30s, so a
      // genuinely active run is never touched.
      if (!cancelled) {
        try {
          const raw = localStorage.getItem('tugympr_live_cardio');
          const lc = raw ? JSON.parse(raw) : null;
          if (lc) {
            const stale = !lc.lastUpdate || (Date.now() - lc.lastUpdate) > 30_000;
            const dbHas = Array.isArray(cardioData) && cardioData.length > 0;
            const ledgerHas = lc.startedAt
              ? hasCardioLoggedAfter(user?.id, lc.startedAt)
              : hasRecentCardioLog(user?.id, 6 * 60 * 60 * 1000);
            if (stale && (dbHas || ledgerHas)) {
              localStorage.removeItem('tugympr_live_cardio');
              setLiveCardioSession(null);
            }
          }
        } catch {}
      }

      const allSessions = rpcData?.sessions || [];
      const fetchedRoutines = rpcData?.routines || [];
      const scheduleData = rpcData?.schedule || [];
      const gymHoursData = rpcData?.gym_hours || [];

      // Apply gym closed days from RPC result
      const closed = new Set((gymHoursData).filter(h => h.is_closed).map(h => h.day_of_week));
      setGymClosedDays(closed);

      // Streak: compute client-side using the gap-bridging rule (rest days
      // between trained days always count). The server-side streak_cache is
      // only used as a floor in case the client-side fetch missed sessions.
      let streak = rpcData?.streak?.current_streak_days ?? 0;
      try {
        const gymClosedArr = (gymHoursData || []).filter(h => h.is_closed).map(h => h.day_of_week);
        const computed = computeStreakFromSessions(allSessions, {
          gymClosedDays: gymClosedArr,
        });
        if (Number.isFinite(computed) && computed > streak) streak = computed;
      } catch {
        // keep cached streak
      }

      const todaySessionsFiltered = allSessions.filter(s => {
        const d = new Date(s.completed_at);
        return d.toDateString() === new Date().toDateString();
      });

      const today = new Date();

      // Resolve active program early so we can filter schedule entries
      const fetchedProgram = rpcData?.program || null;
      setActiveProgram(fetchedProgram || null);
      const programStart = fetchedProgram ? new Date(fetchedProgram.program_start) : null;

      const scheduleMap = {};
      const sMap = fetchedProgram?.schedule_map;
      // Calendar week index (Sun-Sat) since the week containing program_start.
      // Anniversary-based math (`floor(days/7)+1`) broke for mid-week signups:
      // the user thinks of "this week" as Sun→Sat, not Thu→Wed.
      const programWeekNum = (() => {
        if (!fetchedProgram || !programStart) return 0;
        const start = new Date(programStart);
        start.setHours(0, 0, 0, 0);
        const startSunday = new Date(start);
        startSunday.setDate(startSunday.getDate() - startSunday.getDay());
        const todayMid = new Date(today);
        todayMid.setHours(0, 0, 0, 0);
        return Math.floor((todayMid - startSunday) / 86400000 / 7) + 1;
      })();
      const isWeek1 = programWeekNum === 1;
      // Prefer the new total_calendar_weeks field; fall back to duration_weeks
      // for legacy programs that don't have partial-week metadata.
      const totalProgramWeeks = sMap?.total_calendar_weeks ?? fetchedProgram?.duration_weeks ?? 6;
      const hasWrappedDays = (sMap?.wrapped_dows?.length ?? 0) > 0;
      const isLastWeek = hasWrappedDays && programWeekNum === totalProgramWeeks;

      // Build a reverse map: normalDow → routineId from workout_schedule
      const normalDowToRoutineId = {};
      const autoRoutines = fetchedProgram
        ? fetchedRoutines.filter(r => r.name.startsWith('Auto:') && new Date(r.created_at || 0) >= programStart)
        : [];
      for (const row of scheduleData) {
        const routine = fetchedRoutines.find(r => r.id === row.routine_id);
        if (routine) {
          if (fetchedProgram) {
            if (!routine.name.startsWith('Auto:') || new Date(routine.created_at || 0) < programStart) continue;
          }
          normalDowToRoutineId[row.day_of_week] = row.routine_id;
        }
      }

      // Helper: build scheduleMap from a partial week map (week1 or last week)
      const buildFromPartialMap = (partialMap) => {
        for (const entry of partialMap) {
          const normalDow = sMap.normal_dows[entry.routine_index];
          const routineId = normalDow !== undefined ? normalDowToRoutineId[normalDow] : null;
          const routine = routineId ? fetchedRoutines.find(r => r.id === routineId) : null;
          if (routine) {
            scheduleMap[entry.day_of_week] = {
              routineId: routine.id,
              label: localizeRoutineName(routine.name).replace(/ [AB]$/, ''),
            };
          }
        }
      };

      if (isWeek1 && sMap?.week1_map && sMap?.normal_dows) {
        // Week 1: use the shifted DOW mapping
        buildFromPartialMap(sMap.week1_map);
      } else if (isLastWeek && sMap?.last_week_map && sMap?.normal_dows) {
        // Last week: only the remaining routines from week 1's wrap
        buildFromPartialMap(sMap.last_week_map);
      } else {
        // Normal weeks: use workout_schedule directly (packed Mon-start)
        for (const row of scheduleData) {
          const routine = fetchedRoutines.find(r => r.id === row.routine_id);
          if (routine) {
            if (fetchedProgram) {
              if (!routine.name.startsWith('Auto:') || new Date(routine.created_at || 0) < programStart) continue;
            }
            scheduleMap[row.day_of_week] = {
              routineId: row.routine_id,
              label: localizeRoutineName(routine.name).replace(/ [AB]$/, ''),
            };
          }
        }
      }

      const lastPerformedMap = {};
      for (const s of allSessions) {
        if (s.routine_id && !lastPerformedMap[s.routine_id]) {
          lastPerformedMap[s.routine_id] = s.completed_at;
        }
      }

      const todayDow = today.getDay();
      const activeRoutineId = readActiveSession()?.routineId;
      let pickedRoutine = null;

      if (activeRoutineId) {
        pickedRoutine = fetchedRoutines.find(r => r.id === activeRoutineId) || null;
      }
      // If the user already completed a workout today, prefer that routine so
      // the hero card reflects the completed state instead of suggesting a
      // different one. Pick the most-recently-completed session of the day.
      //
      // Caveat: if there's an active program AND the completed routine is an
      // OLD program routine (Auto: + created before this program_start), skip
      // it. After regenerate, the old routine still exists in the DB (it's
      // still claimed by the previous, now-expired program's schedule_map),
      // so the find() succeeds and the hero would stick on the old routine.
      // Falling through to the scheduleMap branch surfaces the new program's
      // routine for today, which is what the user expects to see.
      if (!pickedRoutine && todaySessionsFiltered.length > 0) {
        const sortedToday = [...todaySessionsFiltered]
          .filter(s => s.routine_id)
          .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
        for (const s of sortedToday) {
          const candidate = fetchedRoutines.find(r => r.id === s.routine_id);
          if (!candidate) continue;
          if (fetchedProgram
              && candidate.name?.startsWith('Auto:')
              && new Date(candidate.created_at || 0) < programStart) {
            continue;
          }
          pickedRoutine = candidate;
          break;
        }
      }
      if (!pickedRoutine && scheduleMap[todayDow]) {
        pickedRoutine = fetchedRoutines.find(r => r.id === scheduleMap[todayDow].routineId) || null;
      }
      if (cancelled) return;

      // If the user has a schedule at all and today isn't in it, today is a
      // REST DAY — don't fall back to "least-recently-trained" or program
      // rotation, that just bulldozes over the user's chosen schedule and
      // shows a workout on their planned rest day.
      const hasUserSchedule = Object.keys(scheduleMap).length > 0;

      if (!pickedRoutine && !hasUserSchedule && fetchedRoutines.length > 0) {
        if (fetchedProgram) {
          const programRoutines = fetchedRoutines.filter(r =>
            r.name.startsWith('Auto:') && new Date(r.created_at || 0) >= programStart
          );
          if (programRoutines.length > 0) {
            const todayIndex = todayDow === 0 ? 6 : todayDow - 1;
            pickedRoutine = programRoutines[todayIndex % programRoutines.length] || programRoutines[0];
          }
        }

        if (!pickedRoutine) {
          const sorted = [...fetchedRoutines].sort((a, b) => {
            const aTime = lastPerformedMap[a.id] ? new Date(lastPerformedMap[a.id]).getTime() : 0;
            const bTime = lastPerformedMap[b.id] ? new Date(lastPerformedMap[b.id]).getTime() : 0;
            return aTime - bTime;
          });
          pickedRoutine = sorted[0];
        }
      }

      let pickedExercises = [];
      let lastSession = null;
      if (pickedRoutine) {
        pickedExercises = (pickedRoutine.routine_exercises || [])
          .sort((a, b) => (a.position || 0) - (b.position || 0));
        lastSession = allSessions.find(s => s.routine_id === pickedRoutine.id) ?? null;
      }

      const weekStart = startOfWeek(today, { weekStartsOn: 0 });
      const trainedDateSet = new Set();
      for (const s of allSessions) {
        const d = new Date(s.completed_at);
        const localKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        trainedDateSet.add(localKey);
      }
      // Also mark days with cardio sessions as trained
      for (const cs of (cardioData || [])) {
        const d = new Date(cs.started_at);
        const localKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        trainedDateSet.add(localKey);
      }
      const trainedDates = [...trainedDateSet];

      // Snapshot what the dashboard auto-picked for today so we can restore
      // it after the user navigates between days.
      autoTodayRoutineIdRef.current = pickedRoutine?.id || null;

      const payload = {
        stats: { sessions: allSessions.length, streak },
        allRoutines: fetchedRoutines,
        schedule: scheduleMap,
        selectedRoutine: pickedRoutine,
        selectedRoutineExercises: pickedExercises,
        lastSessionForRoutine: lastSession,
        scheduledWorkoutDays: trainedDates,
      };

      // Store all sessions so past-week day views can show summaries
      const weekSessionsFiltered = allSessions;

      // Always update today's sessions even if effect was "cancelled" by a newer run
      // (todaysSessions is idempotent — latest data is always correct)
      setTodaysSessions(todaySessionsFiltered);
      setTodaysSessionsLoaded(true);
      setWeekSessions(weekSessionsFiltered);
      setActiveSession(readActiveSession());
      setAllActiveDrafts(readAllActiveSessions());

      if (cancelled) return;
      const cached = getCached(`dash:${user.id}`);
      if (!cached?.data || JSON.stringify(cached.data) !== JSON.stringify(payload)) {
        dispatch({ type: 'SET_ALL', payload });
      }
      setCache(`dash:${user.id}`, payload);
      // Notification generation is owned entirely by the server-side
      // `scheduled-reminders` cron now. The old client-side
      // runNotificationScheduler call here duplicated it — inserting rows
      // on app-open that either skipped the push (quiet hours) or got
      // suppressed (app foregrounded), so the user saw in-app notifications
      // they never received as a banner. It also used different dedup-key
      // formats than the server, so the two didn't dedup against each other.

      // Schedule the daily wellness check-in reminder (9 AM local, 7 days
      // ahead). Idempotent — re-scheduling cancels and replaces.
      import('../lib/wellnessReminder')
        .then((m) => m.scheduleWellnessReminders?.())
        .catch(() => {});

      // Background cardio sync from health store (non-blocking, at most once/hour)
      try {
        const healthSettings = JSON.parse(localStorage.getItem('tugympr_health_settings') || '{}');
        if (healthSettings.enabled || healthSettings.sync_enabled) {
          const SYNC_KEY = 'tugympr_cardio_sync_ts';
          const lastSync = parseInt(localStorage.getItem(SYNC_KEY) || '0', 10);
          if (Date.now() - lastSync >= 3600000) {
            import('../lib/healthSync').then(mod => {
              if (mod.syncCardioFromHealth) {
                mod.syncCardioFromHealth(user.id, profile.gym_id).catch(() => {});
              }
            }).catch(() => {});
          }
        }
      } catch { /* health sync check failed — non-critical */ }

      // Use challenge from RPC result (already fetched in single call)
      if (rpcData?.challenge) {
        setLiveChallenge(rpcData.challenge);
      }

      // Class bookings already fetched in parallel with RPC (see Promise.all above)
      } finally {
        fetchingRef.current = false;
        // If another load was requested while this one was in flight, trigger
        // it now. Bumping refreshKey re-runs this effect with a fresh
        // `cancelled=false` closure, so the new load can dispatch.
        if (rerunPendingRef.current) {
          rerunPendingRef.current = false;
          setRefreshKey((k) => k + 1);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [user, profile, refreshKey]);

  // Resolve the routine + exercises payload at render scope so we can memoize
  // it. Dispatching a fresh inline object each effect run breaks memo equality
  // for any consumer of selectedRoutine/selectedRoutineExercises.
  const selectedRoutinePayload = useMemo(() => {
    if (loading) return null;
    const dow = selectedDate.getDay();
    const assigned = schedule[dow];

    if (assigned) {
      const routine = allRoutines.find(r => r.id === assigned.routineId);
      if (routine) {
        const exercises = (routine.routine_exercises || [])
          .sort((a, b) => (a.position || 0) - (b.position || 0));
        return { routine, exercises, lastSession: null };
      }
    }
    // Today with no scheduled routine: restore the dashboard's auto-picked
    // routine (rest/closed days will have null here, which correctly clears
    // any stale routine carried over from navigating other days).
    if (isSameDay(selectedDate, new Date())) {
      const autoId = autoTodayRoutineIdRef.current;
      if (autoId) {
        const autoRoutine = allRoutines.find(r => r.id === autoId);
        if (autoRoutine) {
          const exercises = (autoRoutine.routine_exercises || [])
            .sort((a, b) => (a.position || 0) - (b.position || 0));
          return { routine: autoRoutine, exercises, lastSession: null };
        }
      }
    }
    return { routine: null, exercises: [], lastSession: null };
  }, [selectedDate, schedule, loading, allRoutines]);

  useEffect(() => {
    if (!selectedRoutinePayload) return;
    dispatch({ type: 'SET_SELECTED_ROUTINE', payload: selectedRoutinePayload });
  }, [selectedRoutinePayload]);

  const handleAssignRoutine = useCallback(async (routineId) => {
    if (!user || !profile) return;
    const dow = pickerDay;

    await supabase
      .from('workout_schedule')
      .upsert(
        { profile_id: user.id, gym_id: profile.gym_id, day_of_week: dow, routine_id: routineId, updated_at: new Date().toISOString() },
        { onConflict: 'profile_id,day_of_week' }
      )
      .then(() => {}).catch(() => {});

    const routine = allRoutines.find(r => r.id === routineId);
    const newSchedule = {
      ...schedule,
      [dow]: {
        routineId,
        label: routine ? localizeRoutineName(routine.name).replace(/ [AB]$/, '') : 'Workout',
      },
    };
    dispatch({ type: 'SET_SCHEDULE', payload: newSchedule });

    if (selectedDate.getDay() === dow && routine) {
      const exercises = (routine.routine_exercises || [])
        .sort((a, b) => (a.position || 0) - (b.position || 0));
      dispatch({
        type: 'SET_SELECTED_ROUTINE',
        payload: { routine, exercises, lastSession: null },
      });
    }
  }, [user, profile, pickerDay, allRoutines, schedule, selectedDate]);

  const handleClearDay = useCallback(async () => {
    if (!user) return;
    const dow = pickerDay;

    await supabase
      .from('workout_schedule')
      .delete()
      .eq('profile_id', user.id)
      .eq('day_of_week', dow)
      .then(() => {}).catch(() => {});

    const newSchedule = { ...schedule };
    delete newSchedule[dow];
    dispatch({ type: 'SET_SCHEDULE', payload: newSchedule });

    if (selectedDate.getDay() === dow) {
      dispatch({
        type: 'SET_SELECTED_ROUTINE',
        payload: { routine: null, exercises: [], lastSession: null },
      });
    }
  }, [user, pickerDay, schedule, selectedDate]);

  const handleAssignDay = useCallback((dayOfWeek) => {
    setPickerDay(dayOfWeek);
    setPickerOpen(true);
  }, []);

  /**
   * Callback for when a cardio session is logged (e.g. from CardioLogModal).
   * The log_cardio_session RPC updates streak_cache, so we refresh the dashboard
   * to pick up the new streak value and any XP earned.
   * @param {{ session_id: string, xp_earned: number, streak: number }} result - RPC result
   */
  const handleCardioLogged = useCallback((result) => {
    // Optimistically update streak if the RPC returned the new value
    if (result?.streak != null) {
      dispatch({
        type: 'HYDRATE',
        payload: { stats: { sessions: stats.sessions, streak: result.streak } },
      });
    }
    // Clear live cardio state and trigger full refresh
    setLiveCardioSession(null);
    setRefreshKey(k => k + 1);
  }, [stats.sessions]);

  const handleDeleteSession = useCallback(async () => {
    if (!deleteConfirm) return;
    const { type, id } = deleteConfirm;

    // Cardio sessions: client-side soft-delete. Snapshot the row to a local
    // backup bucket so the restore modal can offer it for 24h, then delete
    // from the DB. Also clears the live-cardio draft (defensive — covers the
    // ghost-hero bug where deleting a finished run made it look in-progress).
    if (type === 'cardio') {
      const { data: existing } = await supabase
        .from('cardio_sessions')
        .select('id, started_at, profile_id, cardio_type')
        .eq('id', id)
        .single();
      const { error } = await supabase.from('cardio_sessions').delete().eq('id', id);
      if (error) {
        showToast(t('dashboard.deleteError', 'Failed to delete'), 'error');
        setDeleteConfirm(null);
        return;
      }
      try {
        const KEY = `tugympr_deleted_cardio_${user.id}`;
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        list.push({
          backupId: `cardio_${id}`,
          row: existing,
          deletedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        // Trim expired entries while we're here.
        const fresh = list.filter(b => new Date(b.expiresAt).getTime() > Date.now());
        localStorage.setItem(KEY, JSON.stringify(fresh));
      } catch {}
      localStorage.removeItem('tugympr_live_cardio');
      setLiveCardioSession(null);
      // Tombstone: the act of deleting a cardio is a strong signal that the
      // run was completed. Recording it in the ledger means even if some
      // future code path resurrects the localStorage draft, the dashboard's
      // readLiveCardio will see a ledger entry newer than the draft's
      // startedAt and refuse to display it.
      recordCardioLogged(user?.id, {
        id: existing?.id || id,
        cardioType: existing?.cardio_type,
        startedAt: existing?.started_at,
        loggedAt: existing?.completed_at || new Date().toISOString(),
      });
      showToast(t('dashboard.sessionDeleted', 'Session deleted'), 'success');
      setWeekCardioSessions(prev => prev.filter(s => s.id !== id));
      setDeleteConfirm(null);
      return;
    }

    // Lifting session — soft-delete via RPC. RPC snapshots the session,
    // refunds points, and returns a backup_id we can use to undo within 24h.
    const { data, error } = await supabase.rpc('soft_delete_workout_session', { p_session_id: id });
    if (error) {
      showToast(t('dashboard.deleteError', 'Failed to delete'), 'error');
      setDeleteConfirm(null);
      return;
    }

    setTodaysSessions(prev => prev.filter(s => s.id !== id));
    setWeekSessions(prev => prev.filter(s => s.id !== id));

    const backupId = data?.backup_id;
    const refunded = data?.points_refunded || 0;
    const baseMsg = refunded > 0
      ? t('dashboard.sessionDeletedRefund', { points: refunded, defaultValue: `Session deleted · ${refunded} pts removed` })
      : t('dashboard.sessionDeleted', 'Session deleted');

    showToast(baseMsg, 'success', backupId ? {
      durationMs: 8000,
      action: {
        label: t('dashboard.undo', 'Undo'),
        onClick: async () => {
          const { error: restoreErr } = await supabase.rpc('restore_deleted_session', { p_backup_id: backupId });
          if (restoreErr) {
            showToast(t('dashboard.restoreFailed', 'Could not restore session'), 'error');
            return;
          }
          showToast(t('dashboard.sessionRestored', 'Session restored'), 'success');
          setRefreshKey(k => k + 1);
        },
      },
    } : undefined);

    setDeleteConfirm(null);
  }, [deleteConfirm, showToast, t]);

  /* ── Derived data ──────────────────────────────────────── */
  const isPastDay = isBefore(startOfDay(selectedDate), startOfDay(new Date())) && !isSameDay(selectedDate, new Date());
  const pastDaySessions = isPastDay
    ? weekSessions.filter(s => {
        const d = new Date(s.completed_at);
        return d.toLocaleDateString() === selectedDate.toLocaleDateString();
      })
    : [];

  const liftCount = selectedRoutineExercises.length;
  // Same formula as WorkoutBuilder: sets × (rest + 45s work/transition per set)
  const estimatedMin = (() => {
    if (liftCount === 0) return 0;
    let totalSec = 0;
    for (const ex of selectedRoutineExercises) {
      const sets = ex.target_sets || 3;
      const rest = ex.rest_seconds || 90;
      totalSec += sets * (rest + 45);
    }
    return Math.round(totalSec / 60);
  })();
  const estimatedCal = Math.round(estimatedMin * 5.2);

  // Derive today's and selected-day cardio from week-wide fetch. Memoize so
  // downstream effects/memos that take these arrays as deps don't churn on
  // every Dashboard re-render (each call produced a fresh array reference
  // before, defeating reference-equality checks elsewhere).
  const todayCardioSessions = useMemo(
    () => weekCardioSessions.filter(cs => isSameDay(new Date(cs.started_at), new Date())),
    [weekCardioSessions],
  );
  const selectedDayCardioSessions = useMemo(
    () => weekCardioSessions.filter(cs =>
      new Date(cs.started_at).toLocaleDateString() === selectedDate.toLocaleDateString()
    ),
    [weekCardioSessions, selectedDate],
  );

  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const selectedDayName = t(`days.${DAY_KEYS[selectedDate.getDay()]}`, { ns: 'common' });
  const isToday = isSameDay(selectedDate, new Date());

  // True only on the user's actual birthday (server-driven points are awarded
  // separately by the daily process_birthdays cron — see migration 0350).
  const isBirthdayToday = useMemo(() => {
    if (!profile?.date_of_birth) return false;
    const [, m, d] = profile.date_of_birth.split('-').map(Number);
    if (!m || !d) return false;
    const now = new Date();
    return now.getMonth() + 1 === m && now.getDate() === d;
  }, [profile?.date_of_birth]);
  const hasTrainedToday = todaysSessions.length > 0 || todayCardioSessions.length > 0;

  // Recovery score shown on the post-completion Recovery chip. Mirrors the
  // memo in WorkoutHeroCard so the chip and the hero pill never drift.
  const { data: recoveryRecentSessions = [] } = useRecentSessionsWithSets(user?.id, 14);
  const readinessScore = useMemo(() => {
    let todaySoreness = null;
    try {
      const d = new Date();
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const raw = localStorage.getItem('tugympr_wellness_last_checkin');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.date === dateKey && typeof parsed.soreness === 'number') {
          todaySoreness = parsed.soreness;
        }
      }
    } catch { /* ignore */ }
    const cachedMetrics = loadCachedRecoveryMetrics();
    return computeDashboardReadiness({
      sessions: recoveryRecentSessions,
      recoveryMetrics: cachedMetrics,
      soreness: todaySoreness,
    });
  }, [recoveryRecentSessions, readinessOpen, wellnessRefreshKey]);

  // Gym is only "closed" if gym_hours says closed AND there's no program workout scheduled
  // (user who chose "Start Today" on a closed day overrides the gym schedule)
  const gymNormallyClosed = gymClosedDays.has(selectedDate.getDay());
  const hasScheduledWorkout = !!schedule[selectedDate.getDay()];
  const isGymClosedToday = gymNormallyClosed && !hasScheduledWorkout && !selectedRoutine;

  const workoutType = isGymClosedToday
    ? t('dashboard.gymClosed', 'Gym Closed')
    : selectedRoutine
      ? localizeRoutineName(selectedRoutine.name).replace(/ [AB]$/, '')
      : t('dashboard.restDay');

  const allExercisesWithMedia = useMemo(() => {
    return selectedRoutineExercises.map(ex => {
      const rawVideo = ex.exercises?.video_url || videoMap[ex.exercise_id] || null;
      let video = null;
      if (rawVideo) {
        if (rawVideo.startsWith('/') || rawVideo.startsWith('http')) {
          video = rawVideo;
        } else {
          const { data } = supabase.storage.from('exercise-videos').getPublicUrl(rawVideo);
          video = data?.publicUrl || null;
        }
      }
      return {
        id: ex.id,
        name: ex.exercises?.name || 'Exercise',
        name_es: ex.exercises?.name_es || null,
        sets: ex.target_sets,
        reps: ex.target_reps,
        video,
      };
    });
  }, [selectedRoutineExercises]);

  // Preload exercise videos into cache so hero card loads instantly
  useEffect(() => {
    const videos = allExercisesWithMedia.filter(ex => ex.video).map(ex => ex.video);
    if (videos.length === 0) return;
    videos.forEach(url => {
      // Use link preload for the first video (visible immediately)
      // and fetch for the rest to warm the service worker cache
      const link = document.querySelector(`link[href="${url}"]`);
      if (!link) {
        fetch(url, { mode: 'no-cors' }).catch(() => {});
      }
    });
  }, [allExercisesWithMedia]);

  const hasRoutines = allRoutines.length > 0;

  // Level / XP — use actual points from reward_points table
  const { level, xpIntoLevel, xpForNext, progress: xpProgress } = getLevel(userPoints);
  const tier = getRewardTier(userPoints);

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      {/* Referral reward celebration banner */}
      <Suspense fallback={null}>
        <ReferralRewardBanner />
      </Suspense>

      <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 lg:px-8 pt-6 pb-28 md:pb-12 space-y-0">

        {/* ════════════════════════════════════════════════════
            HEADER — My Plan + Icons
           ════════════════════════════════════════════════════ */}
        <header className="flex items-center justify-between mb-2.5" data-tour="tour-my-plan">
          {/* My Plan pill */}
          <button
            type="button"
            onClick={() => {
              // Default the modal to the user's CURRENT program week so they
              // see what's happening now, not week 1 of an in-progress program.
              if (activeProgram?.program_start) {
                setPlanWeek(Math.max(1, getCurrentWeekClamped(activeProgram)));
              }
              setShowPlanInfo(true);
            }}
            className="inline-flex items-center gap-[7px] h-10 px-3.5 rounded-[14px] active:scale-[0.97] transition-transform focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            style={{
              background: 'var(--color-bg-card, #fff)',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
            }}
          >
            <span className="text-[13px] font-extrabold" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{t('dashboard.myPlan')}</span>
            <ChevronDown size={13} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2.2} />
          </button>

          <div className="flex items-center gap-2" data-tour="tour-quick-buttons">
            {/* Nutrition pill */}
            <Link to="/progress?tab=nutrition"
              className="inline-flex items-center gap-[7px] h-10 px-3.5 rounded-[14px] active:scale-[0.98] transition-all duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
              style={{
                background: 'var(--color-bg-card, #fff)',
                boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
              }}
              aria-label={t('dashboard.ariaNutrition', 'Nutrition')}>
              <Leaf size={15} style={{ color: 'var(--color-accent)' }} strokeWidth={2.2} />
              <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{t('dashboard.nutrition')}</span>
            </Link>
            {/* Messages icon button */}
            <Link
              to="/messages"
              className="w-10 h-10 rounded-[14px] flex items-center justify-center active:scale-[0.96] transition-all duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
              style={{
                background: 'var(--color-bg-card, #fff)',
                boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
              }}
              aria-label={t('dashboard.ariaMessages', 'Messages')}
            >
              <MessageCircle size={17} style={{ color: 'var(--color-text-primary)' }} strokeWidth={2} />
            </Link>
            {/* Classes shortcut — only when the gym has classes enabled.
                Otherwise classes is buried two taps deep inside MyGym. */}
            {gymConfig?.classesEnabled && (
              <Link
                to="/classes"
                className="w-10 h-10 rounded-[14px] flex items-center justify-center active:scale-[0.96] transition-all duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                style={{
                  background: 'var(--color-bg-card, #fff)',
                  boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
                }}
                aria-label={t('dashboard.ariaClasses', 'Classes')}
              >
                <CalendarCheck size={17} style={{ color: 'var(--color-text-primary)' }} strokeWidth={2} />
              </Link>
            )}
            {/* QR — dark prominent button.
                The QRCodeModal calls into Capacitor plugins (screen-brightness,
                wallet, share) and signQRPayload, any of which can reject on
                unsupported devices. We open the modal only when we have a real
                payload AND the auth profile is loaded so the modal never mounts
                in a half-initialised state, and we wrap the open call in
                try/catch so a plugin rejection can't crash the page. */}
            <button
              type="button"
              onClick={() => {
                try {
                  if (!profile && !user?.id) {
                    showToast(
                      t('dashboard.qrError', { defaultValue: 'Could not open QR' }),
                      'error'
                    );
                    return;
                  }
                  setShowQR(true);
                } catch (err) {
                  console.error('[QR] open failed:', err);
                  showToast(
                    t('dashboard.qrError', { defaultValue: 'Could not open QR' }),
                    'error'
                  );
                }
              }}
              className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center active:scale-[0.96] transition-all duration-200 focus:ring-2 focus:outline-none"
              style={{
                background: 'var(--color-text-primary, #0A0D10)',
                boxShadow: '0 4px 10px rgba(0,0,0,0.18)',
              }}
              aria-label={t('dashboard.ariaQRCode', 'QR Code')}
            >
              <QrCode size={22} style={{ color: 'var(--color-bg-primary, #F7F7F5)' }} strokeWidth={2.2} />
            </button>
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton ariaLabel={t('dashboard.loadingDashboard', 'Loading dashboard')} />
        ) : loadError ? (
          <div className="rounded-3xl border border-red-500/20 bg-red-500/5 px-5 py-6 text-center">
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-2">
              {t('dashboard.unavailable', 'Dashboard unavailable')}
            </p>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              {loadError}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key="dashboard-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="space-y-0"
            >

              {/* ════════════════════════════════════════════════
                  1. DAY STRIP
                 ════════════════════════════════════════════════ */}
              <section className="mb-3">
                <DayStrip
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onAssignDay={handleAssignDay}
                  workoutDays={scheduledWorkoutDays}
                  schedule={schedule}
                  earliestDate={profile?.created_at}
                />
              </section>

              {/* ════════════════════════════════════════════════
                  1a. BIRTHDAY BANNER (today only)
                 ════════════════════════════════════════════════ */}
              {isToday && isBirthdayToday && (
                <section className="mb-3">
                  <div
                    className="relative w-full rounded-2xl p-4 overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 22%, transparent) 0%, color-mix(in srgb, var(--color-accent) 6%, transparent) 100%)',
                      border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
                        style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}
                        aria-hidden="true"
                      >
                        🎂
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {t('dashboard.birthdayTitle', { defaultValue: 'Happy birthday, {{name}}!', name: (profile?.full_name || '').split(' ')[0] || t('dashboard.birthdayFallbackName', { defaultValue: 'friend' }) })}
                        </p>
                        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                          {t('dashboard.birthdayBody', { defaultValue: 'Have a great workout — today is your day. 🎉' })}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* ════════════════════════════════════════════════
                  1b. TODAY'S CLASS BANNER
                 ════════════════════════════════════════════════ */}
              {isToday && todayClassBookings.length > 0 && (() => {
                // A class is "passed" once its end_time (fallback: start_time) is
                // earlier than now. The banner header switches when every booked
                // class today has passed — per-row ✓ checked-in still surfaces
                // attendance independently.
                const now = Date.now();
                const allPassed = todayClassBookings.every((b) => {
                  const sched = b.gym_class_schedules;
                  const endStr = sched?.end_time || sched?.start_time;
                  if (!b.booking_date || !endStr) return false;
                  const endAt = new Date(`${b.booking_date}T${endStr}`).getTime();
                  return Number.isFinite(endAt) && endAt < now;
                });
                const tone = allPassed ? '#9CA3AF' : '#818CF8';
                return (
                <section className="mb-3">
                  <Link
                    to="/classes"
                    className="block w-full rounded-2xl bg-gradient-to-br p-4 transition-all active:scale-[0.99]"
                    style={{
                      backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${tone} 10%, transparent), color-mix(in srgb, ${tone} 2%, transparent))`,
                      border: `1px solid color-mix(in srgb, ${tone} 20%, transparent)`,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: `color-mix(in srgb, ${tone} 15%, transparent)` }}
                      >
                        <CalendarCheck size={20} style={{ color: tone }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold" style={{ color: tone }}>
                          {t(allPassed ? 'dashboard.classAlreadyPassed' : 'dashboard.todayHasClass')}
                        </p>
                        {todayClassBookings.map(booking => {
                          const sched = booking.gym_class_schedules;
                          const cls = sched?.gym_classes;
                          const className = i18n.language === 'es' && cls?.name_es ? cls.name_es : cls?.name;
                          const isCheckedIn = booking.status === 'attended';
                          return (
                            <p key={booking.id} className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                              {className} · {sched?.start_time?.slice(0, 5)}
                              {isCheckedIn && (
                                <span className="text-[#10B981] font-semibold ml-1.5">
                                  ✓ {t('dashboard.classCheckedIn')}
                                </span>
                              )}
                            </p>
                          );
                        })}
                      </div>
                      <ChevronRight
                        size={16}
                        className="flex-shrink-0"
                        style={{ color: `color-mix(in srgb, ${tone} 60%, transparent)` }}
                      />
                    </div>
                  </Link>
                </section>
                );
              })()}

              {/* ════════════════════════════════════════════════
                  2. DATE LABEL + EDIT / SWAP — above hero
                 ════════════════════════════════════════════════ */}
              <section className="mb-1.5">
                <div className="flex items-center justify-between gap-3.5">
                  <p
                    className="text-[11px] uppercase tracking-[0.12em]"
                    style={{
                      color: 'var(--color-text-muted)',
                      fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
                      fontWeight: 800,
                    }}
                  >
                    {(() => {
                      const dfLocale = i18n.language === 'es' ? esLocale : enUS;
                      const dateStr = format(selectedDate, 'EEE MMM d', { locale: dfLocale }).toUpperCase();
                      return isToday
                        ? `${t('dashboard.today').toUpperCase()} · ${dateStr}`
                        : dateStr;
                    })()}
                  </p>
                  <div className="flex items-center gap-2">
                    {/* Edit + Swap make no sense once the day's workout is
                        already in the bag — collapse them so the Recovery
                        chip has room to breathe and show its score. */}
                    {selectedRoutine && !isGymClosedToday && !(isToday && hasTrainedToday) && (
                      <>
                        <button
                          type="button"
                          onClick={() => navigate(`/workouts/${selectedRoutine.id}/edit?from=/`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold tracking-[0.04em] active:scale-[0.95] transition-all"
                          style={{
                            background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                            color: 'var(--color-text-primary)',
                            border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
                          }}
                        >
                          <Pencil size={13} strokeWidth={2.4} style={{ color: 'var(--color-accent)' }} />
                          {t('dashboard.edit', 'Edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAssignDay(selectedDate.getDay())}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold tracking-[0.04em] active:scale-[0.95] transition-all"
                          style={{
                            background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                            color: 'var(--color-text-primary)',
                            border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
                          }}
                        >
                          <ArrowLeftRight size={13} strokeWidth={2.4} style={{ color: 'var(--color-accent)' }} />
                          {t('dashboard.swap', 'Swap')}
                        </button>
                      </>
                    )}
                    {/* Recovery / Readiness map access. Shown whenever Edit +
                        Swap aren't competing for the row: post-workout, on
                        rest days (no routine for the day), and on gym-closed
                        days. Edit/Swap's own gate up top is the inverse, so
                        the two never overlap. */}
                    {isToday && (hasTrainedToday || isGymClosedToday || !selectedRoutine || appTourActive) && (
                      <button
                        type="button"
                        onClick={() => setReadinessOpen(true)}
                        aria-label={t('workoutHeroCard.openReadiness', 'View recovery map')}
                        data-tour="tour-recovery-pill"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold tracking-[0.04em] active:scale-[0.95] transition-all"
                        style={{
                          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                          color: 'var(--color-accent)',
                          border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
                        }}
                      >
                        <Activity size={13} strokeWidth={2.4} />
                        {t('dashboard.recovery', 'Recovery')}
                        <span className="tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {readinessScore}%
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowDeletedModal(true)}
                      aria-label={t('dashboard.recentlyDeleted', 'Recently deleted')}
                      className="flex items-center justify-center w-9 h-9 rounded-full active:scale-[0.95] transition-all"
                      style={{
                        background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                        color: 'var(--color-text-primary)',
                        border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
                      }}
                    >
                      <History size={14} strokeWidth={2.4} style={{ color: 'var(--color-accent)' }} />
                    </button>
                  </div>
                </div>
              </section>

              {/* Resume banners removed — the hero card already shows resume state */}

              {/* ════════════════════════════════════════════════
                  3. HERO CARD — Elevated, primary CTA
                 ════════════════════════════════════════════════ */}
              <section className="mb-3" data-tour="tour-hero-card">
                {/* Wait for today's sessions to load before rendering hero to prevent flash */}
                {isToday && !todaysSessionsLoaded ? (
                  <div className="w-full rounded-[20px] animate-pulse" style={{ aspectRatio: '9 / 10', background: 'var(--color-surface-hover)' }} aria-busy={true} aria-label={t('dashboard.loadingWorkout', 'Loading workout')} />
                ) : isToday && liveCardioSession ? (
                  /* ── Live cardio in progress — green hero card ── */
                  <LiveCardioHeroCard liveCardioSession={liveCardioSession} t={t} />
                ) : isToday && (() => {
                  // Filter today's sessions: drop any whose routine is an
                  // Auto: routine created BEFORE the active program started.
                  // Without this, regenerating mid-day pins the hero to the
                  // morning workout from the now-expired program, so the
                  // home page keeps reading as the OLD program instead of
                  // the freshly-regenerated one. The session itself is kept
                  // in `todaysSessions` for streak/points/log purposes.
                  const programStart = activeProgram?.program_start
                    ? new Date(activeProgram.program_start)
                    : null;
                  const relevantSessions = todaysSessions.filter(s => {
                    if (!s.routine_id) return true;
                    if (!programStart) return true;
                    const routine = allRoutines.find(r => r.id === s.routine_id);
                    if (!routine) return true;
                    if (!routine.name?.startsWith('Auto:')) return true;
                    return new Date(routine.created_at || 0) >= programStart;
                  });
                  return relevantSessions.length > 0 && !(activeSession && selectedRoutine && activeSession.routineId === selectedRoutine.id);
                })() ? (
                  (() => {
                    const programStart = activeProgram?.program_start
                      ? new Date(activeProgram.program_start)
                      : null;
                    const relevantSessions = todaysSessions.filter(s => {
                      if (!s.routine_id) return true;
                      if (!programStart) return true;
                      const routine = allRoutines.find(r => r.id === s.routine_id);
                      if (!routine) return true;
                      if (!routine.name?.startsWith('Auto:')) return true;
                      return new Date(routine.created_at || 0) >= programStart;
                    });
                    // The most-recently-completed RELEVANT session drives the
                    // hero. Sessions from a now-expired program are filtered
                    // out above so the hero doesn't pin to the old routine.
                    const primarySession = relevantSessions[0];
                    const primaryName = primarySession?.name || workoutType;
                    return (
                  <div className="flex flex-col gap-3">
                    {/* Hero card stays on screen in a completed state.
                        The trash button lives inside the card itself (top-right). */}
                    <WorkoutHeroCard
                      routineId={primarySession?.routine_id || selectedRoutine?.id}
                      exercises={allExercisesWithMedia}
                      isCompleted
                      completedSession={primarySession}
                      routineName={primaryName}
                      exerciseCount={liftCount}
                      estimatedMin={estimatedMin}
                      estimatedCal={estimatedCal}
                      cardioAttached={isToday && todayCardioSessions.length > 0}
                      onDelete={(session) =>
                        setDeleteConfirm({ type: 'workout', id: session.id, name: session.name })
                      }
                    />

                    <div className="w-full rounded-[22px] p-5" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                      <p className="text-[13px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
                        {t('dashboard.greatJobToday')} <span className="text-[#10B981] font-semibold">{primaryName}</span> {t('dashboard.sessionIsDone')}
                      </p>

                    {/* Additional workouts done today (everything beyond the primary one) */}
                    {(() => {
                      const extras = todaysSessions.filter(s => s.id !== primarySession?.id);
                      if (extras.length === 0) return null;
                      return (
                        <div className="mb-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--color-accent, #2EC4C4)' }}>
                            {t('dashboard.alsoCompletedToday')}
                          </p>
                          {extras.map(session => {
                            const vol = parseFloat(session.total_volume_lbs) || 0;
                            const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
                            return (
                              <div key={session.id} className="relative mb-1.5">
                                <Link
                                  to="/session-summary"
                                  state={{
                                    routineName: session.name,
                                    elapsedTime: session.duration_seconds,
                                    totalVolume: vol,
                                    sessionId: session.id,
                                    completedAt: session.completed_at,
                                  }}
                                  className="flex items-center gap-3 px-4 pr-11 py-2.5 rounded-xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] transition-colors text-left"
                                >
                                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 10%, transparent)' }}>
                                    <Dumbbell size={13} style={{ color: 'var(--color-accent, #2EC4C4)' }} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{session.name}</p>
                                    <div className="flex items-center gap-2 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
                                      <span>{Math.round((session.duration_seconds || 0) / 60)}m</span>
                                      <span style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                      <span>{volStr} lbs</span>
                                    </div>
                                  </div>
                                  <ChevronRight size={12} style={{ color: 'var(--color-text-subtle)' }} />
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirm({ type: 'workout', id: session.id, name: session.name })}
                                  className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-red-500/10 transition-colors flex-shrink-0"
                                  style={{ color: 'var(--color-text-muted)' }}
                                  aria-label={t('dashboard.deleteSession', 'Delete session')}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Cardio sessions completed today */}
                    {todayCardioSessions.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-[10px] font-semibold text-[#10B981] uppercase tracking-[0.12em]">
                            {t('dashboard.cardioToday', 'Cardio')}
                          </p>
                          {/iphone|ipad/i.test(navigator.userAgent) && (
                            <AppleHealthSourceBadge label={t('dashboard.fromAppleHealth', 'Apple Health')} small />
                          )}
                        </div>
                        {todayCardioSessions.map(cs => {
                          const mins = Math.round((cs.duration_seconds || 0) / 60);
                          const cals = Math.round(cs.calories_burned || 0);
                          const typeName = t(`cardio.types.${cs.cardio_type}`, cs.cardio_type);
                          return (
                            <div key={cs.id} className="relative mb-1.5 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => navigate(`/cardio/${cs.id}`)}
                                className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[var(--color-surface-hover)] text-left active:scale-[0.99] transition-transform"
                              >
                                <div className="w-8 h-8 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                                  <Activity size={13} className="text-[#10B981]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{typeName}</p>
                                  <div className="flex items-center gap-2 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
                                    <span>{mins}m</span>
                                    {cals > 0 && (
                                      <>
                                        <span style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                        <span>{cals} kcal</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm({ type: 'cardio', id: cs.id, name: typeName })}
                                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-red-500/10 transition-colors flex-shrink-0"
                                style={{ color: 'var(--color-text-muted)' }}
                                aria-label={t('dashboard.deleteSession', 'Delete session')}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* In-progress workouts (drafts) — show resume */}
                    {allActiveDrafts.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] font-semibold text-[#60A5FA] uppercase tracking-[0.12em] mb-2">
                          {t('dashboard.inProgress')}
                        </p>
                        {allActiveDrafts.map(draft => {
                          const draftSets = Object.values(draft.loggedSets || {}).flat();
                          const completed = draftSets.filter(s => s.completed).length;
                          const total = draftSets.length;
                          return (
                            <Link
                              key={draft.routineId}
                              to={`/session/${draft.routineId}`}
                              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#60A5FA]/10 border border-[#60A5FA]/20 hover:bg-[#60A5FA]/15 transition-colors mb-1.5"
                            >
                              <div className="w-8 h-8 rounded-lg bg-[#60A5FA]/15 flex items-center justify-center flex-shrink-0">
                                <Play size={13} fill="var(--color-blue-soft)" className="text-[#60A5FA]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{draft.routineName || t('dashboard.workout')}</p>
                                <p className="text-[10px] text-[#60A5FA]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {completed}/{total} {t('dashboard.sets')} · {t('dashboard.tapToResume')}
                                </p>
                              </div>
                              <ChevronRight size={12} className="text-[#60A5FA]" />
                            </Link>
                          );
                        })}
                      </div>
                    )}

                    <button
                      onClick={() => navigate('/workouts')}
                      className="w-full py-3.5 rounded-full text-[13px] font-bold transition-colors"
                      style={{ color: 'var(--color-text-primary)', background: 'var(--color-surface-hover)' }}
                    >
                      {t('dashboard.doAnotherWorkout')}
                    </button>
                    </div>
                  </div>
                    );
                  })()
                ) : isToday && hasTrainedToday && selectedRoutine && !todaysSessions.some(s => s.routine_id === selectedRoutine.id) && !(activeSession && activeSession.routineId === selectedRoutine.id) && !skippedToday ? (
                  /* Trained today (workout or cardio) but scheduled routine still pending */
                  <div className="w-full rounded-[22px] p-6" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 12%, transparent)' }}>
                        <Flame size={20} style={{ color: '#FF5A2E' }} />
                      </div>
                      <div>
                        <p className="font-bold text-[15px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: -0.3 }}>{t('dashboard.alreadyTrainedToday')}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('dashboard.butPrefix')} <span style={{ color: 'var(--color-accent, #2EC4C4)', fontWeight: 600 }}>{workoutType}</span> {t('dashboard.butSuffix')}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/session/${selectedRoutine.id}`}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full text-[12px] font-bold text-white active:scale-[0.98] transition-all min-w-0 overflow-hidden"
                        style={{ background: 'var(--color-accent, #2EC4C4)' }}
                      >
                        <Play size={14} fill="white" className="flex-shrink-0" /> <span className="truncate">{t('dashboard.finishWorkout', { workout: workoutType })}</span>
                      </Link>
                      <button
                        onClick={handleSkipSuggestion}
                        className="px-4 py-3.5 rounded-full text-[12px] font-semibold transition-colors"
                        style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-hover)' }}
                      >
                        {t('dashboard.skip')}
                      </button>
                    </div>
                  </div>
                ) : isToday && skippedToday && hasTrainedToday ? (
                  /* User dismissed the "already trained" banner — show completed state */
                  <div
                    className="w-full rounded-[22px] p-5"
                    style={{
                      background: 'linear-gradient(180deg, color-mix(in srgb, #10B981 10%, transparent) 0%, var(--color-bg-card) 100%)',
                      border: '1px solid color-mix(in srgb, #10B981 18%, transparent)',
                      boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center"
                        style={{ background: 'color-mix(in srgb, #10B981 14%, transparent)', border: '1px solid color-mix(in srgb, #10B981 28%, transparent)' }}
                      >
                        <CheckCircle2 size={16} strokeWidth={2.4} style={{ color: '#10B981' }} />
                      </div>
                      <p
                        className="text-[14px]"
                        style={{
                          color: '#10B981',
                          fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
                          fontWeight: 800,
                          letterSpacing: -0.2,
                        }}
                      >
                        {t('dashboard.youveTrainedToday')}
                      </p>
                    </div>
                    {todaysSessions.slice(0, 3).map(session => {
                      const vol = parseFloat(session.total_volume_lbs) || 0;
                      const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
                      return (
                        <div key={session.id} className="relative mb-1.5">
                          <Link to="/session-summary"
                            state={{ routineName: session.name, elapsedTime: session.duration_seconds, totalVolume: vol, sessionId: session.id, completedAt: session.completed_at }}
                            className="flex items-center gap-3 px-4 pr-11 py-2.5 rounded-xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{session.name}</p>
                              <div className="flex items-center gap-2 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
                                <span>{Math.round((session.duration_seconds || 0) / 60)}m</span>
                                <span style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                <span>{volStr} lbs</span>
                              </div>
                            </div>
                            <ChevronRight size={12} style={{ color: 'var(--color-text-subtle)' }} />
                          </Link>
                          <button onClick={() => setDeleteConfirm({ type: 'workout', id: session.id, name: session.name })}
                            className="absolute top-1/2 right-2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors"
                            style={{ color: '#EF4444' }} aria-label={t('dashboard.deleteSession', 'Delete session')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                    {todayCardioSessions.map(cs => {
                      const mins = Math.round((cs.duration_seconds || 0) / 60);
                      const cals = Math.round(cs.calories_burned || 0);
                      const typeName = t(`cardio.types.${cs.cardio_type}`, cs.cardio_type);
                      return (
                        <div key={cs.id} className="relative mb-1.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/cardio/${cs.id}`)}
                            className="w-full flex items-center gap-3 px-4 pr-11 py-2.5 rounded-xl bg-[var(--color-surface-hover)] text-left active:scale-[0.99] transition-transform"
                          >
                            <div className="w-8 h-8 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                              <Activity size={13} className="text-[#10B981]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{typeName}</p>
                              <div className="flex items-center gap-2 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
                                <span>{mins}m</span>
                                {cals > 0 && (
                                  <>
                                    <span style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                    <span>{cals} kcal</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
                          </button>
                          <button onClick={() => setDeleteConfirm({ type: 'cardio', id: cs.id, name: typeName })}
                            className="absolute top-1/2 right-2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors"
                            style={{ color: '#EF4444' }} aria-label={t('dashboard.deleteSession', 'Delete session')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => navigate('/workouts')}
                      className="w-full mt-3 py-3 rounded-[14px] transition-colors active:scale-[0.98]"
                      style={{
                        background: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border-subtle)',
                        color: 'var(--color-text-primary)',
                        fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: -0.15,
                      }}
                    >
                      {t('dashboard.doAnotherWorkout')}
                    </button>
                  </div>
                ) : isPastDay && (pastDaySessions.length > 0 || selectedDayCardioSessions.length > 0) ? (
                  /* Past day WITH completed sessions — show summary */
                  <div className="w-full rounded-[22px] p-5" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 size={16} style={{ color: 'var(--color-accent, #2EC4C4)' }} />
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--color-accent, #2EC4C4)' }}>{t('dashboard.workoutCompleted')}</p>
                    </div>
                    {pastDaySessions.map(session => {
                      const vol = parseFloat(session.total_volume_lbs) || 0;
                      const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
                      return (
                        <div key={session.id} className="relative mb-1.5">
                          <Link
                            to="/session-summary"
                            state={{
                              routineName: session.name,
                              elapsedTime: session.duration_seconds,
                              totalVolume: vol,
                              sessionId: session.id,
                              completedAt: session.completed_at,
                            }}
                            className="flex items-center gap-3 px-4 pr-11 py-3 rounded-xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] transition-colors text-left"
                          >
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 10%, transparent)' }}>
                              <Trophy size={16} style={{ color: 'var(--color-accent, #2EC4C4)' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{session.name}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
                                <span>{Math.round((session.duration_seconds || 0) / 60)}m</span>
                                <span style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                <span>{volStr} lbs</span>
                              </div>
                            </div>
                            <span className="text-[10px] font-medium text-[var(--color-accent,#2EC4C4)]">{t('dashboard.viewSummary')}</span>
                          </Link>
                          <button onClick={() => setDeleteConfirm({ type: 'workout', id: session.id, name: session.name })}
                            className="absolute top-1/2 right-2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors"
                            style={{ color: '#EF4444' }} aria-label={t('dashboard.deleteSession', 'Delete session')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                    {selectedDayCardioSessions.map(cs => {
                      const mins = Math.round((cs.duration_seconds || 0) / 60);
                      const cals = Math.round(cs.calories_burned || 0);
                      const typeName = t(`cardio.types.${cs.cardio_type}`, cs.cardio_type);
                      return (
                        <div key={cs.id} className="relative mb-1.5">
                          <div className="flex items-center gap-3 px-4 pr-11 py-2.5 rounded-xl bg-[var(--color-surface-hover)] text-left">
                            <div className="w-9 h-9 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                              <Activity size={13} className="text-[#10B981]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{typeName}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
                                <span>{mins}m</span>
                                {cals > 0 && (
                                  <>
                                    <span style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                    <span>{cals} kcal</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <button onClick={() => setDeleteConfirm({ type: 'cardio', id: cs.id, name: typeName })}
                            className="absolute top-1/2 right-2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors"
                            style={{ color: '#EF4444' }} aria-label={t('dashboard.deleteSession', 'Delete session')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : isPastDay ? (
                  /* Past day with NO completed sessions — muted message */
                  <div className="w-full rounded-[22px] p-5 text-center" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                    <p className="text-[14px] text-[var(--color-text-muted)]">{t('dashboard.thisDayHasPassed')}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{t('dashboard.noWorkoutLogged')}</p>
                  </div>
                ) : isGymClosedToday ? (
                  <div className="w-full rounded-2xl bg-red-500/5 border border-red-500/15 p-5 text-center">
                    <p className="text-[32px] mb-3">🔒</p>
                    <p className="font-bold text-red-400 text-[16px]">{t('dashboard.gymClosed', 'Gym Closed')}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-1.5 mb-4">
                      {t('dashboard.gymClosedMessage', 'The gym is closed today. Rest up and come back stronger!')}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate('/workouts')}
                      className="inline-flex items-center gap-2 py-3 px-5 rounded-2xl text-[13px] font-bold transition-colors"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
                    >
                      <Dumbbell size={15} />
                      {t('dashboard.trainOutsideGym', 'Want to train outside the gym?')}
                    </button>
                  </div>
                ) : selectedRoutine ? (
                  <WorkoutHeroCard
                    routineId={selectedRoutine.id}
                    exercises={allExercisesWithMedia}
                    isActive={!!activeSession && activeSession.routineId === selectedRoutine.id}
                    isCompleted={isToday && todaysSessions.some(s => s.routine_id === selectedRoutine.id)}
                    completedSession={isToday ? todaysSessions.find(s => s.routine_id === selectedRoutine.id) || null : null}
                    activeSetsCompleted={activeSetsCompleted}
                    activeSetsTotal={activeSetsTotal}
                    routineName={workoutType}
                    exerciseCount={liftCount}
                    estimatedMin={estimatedMin}
                    estimatedCal={estimatedCal}
                    onAttachCardio={() => setShowCardioLog(true)}
                    cardioAttached={isToday && todayCardioSessions.length > 0}
                  />
                ) : isToday && todayCardioSessions.length > 0 ? (
                  /* Rest day but cardio was done — show cardio completed card */
                  <div
                    className="w-full rounded-[22px] p-5"
                    style={{
                      background: 'linear-gradient(180deg, color-mix(in srgb, #10B981 10%, transparent) 0%, var(--color-bg-card) 100%)',
                      border: '1px solid color-mix(in srgb, #10B981 18%, transparent)',
                      boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center"
                        style={{ background: 'color-mix(in srgb, #10B981 14%, transparent)', border: '1px solid color-mix(in srgb, #10B981 28%, transparent)' }}
                      >
                        <CheckCircle2 size={16} strokeWidth={2.4} style={{ color: '#10B981' }} />
                      </div>
                      <p
                        className="text-[14px]"
                        style={{
                          color: '#10B981',
                          fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
                          fontWeight: 800,
                          letterSpacing: -0.2,
                        }}
                      >
                        {t('dashboard.youveTrainedToday')}
                      </p>
                    </div>
                    {todayCardioSessions.map(cs => {
                      const mins = Math.round((cs.duration_seconds || 0) / 60);
                      const cals = Math.round(cs.calories_burned || 0);
                      const typeName = t(`cardio.types.${cs.cardio_type}`, cs.cardio_type);
                      return (
                        <div key={cs.id} className="relative mb-1.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/cardio/${cs.id}`)}
                            className="w-full flex items-center gap-3 px-4 pr-11 py-2.5 rounded-xl bg-[var(--color-surface-hover)] text-left active:scale-[0.99] transition-transform"
                          >
                            <div className="w-8 h-8 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                              <Activity size={13} className="text-[#10B981]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{typeName}</p>
                              <div className="flex items-center gap-2 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
                                <span>{mins}m</span>
                                {cals > 0 && (
                                  <>
                                    <span style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                    <span>{cals} kcal</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
                          </button>
                          <button onClick={() => setDeleteConfirm({ type: 'cardio', id: cs.id, name: typeName })}
                            className="absolute top-1/2 right-2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors"
                            style={{ color: '#EF4444' }} aria-label={t('dashboard.deleteSession', 'Delete session')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => navigate('/workouts')}
                      className="w-full mt-3 py-3 rounded-[14px] transition-colors active:scale-[0.98]"
                      style={{
                        background: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border-subtle)',
                        color: 'var(--color-text-primary)',
                        fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: -0.15,
                      }}
                    >
                      {t('dashboard.doAnotherWorkout')}
                    </button>
                  </div>
                ) : hasRoutines ? (
                  <div className="w-full rounded-[22px] p-5 text-center" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                    <p className="text-[32px] mb-3">😴</p>
                    <p className="font-bold text-[var(--color-text-muted)] text-[16px]" style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: -0.3 }}>{t('dashboard.restDay')}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-1.5 mb-4">
                      {t('dashboard.recoverMessage')}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleAssignDay(selectedDate.getDay())}
                      className="text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] transition-colors duration-200"
                    >
                      {t('dashboard.assignWorkoutInstead')}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-[22px] p-5 text-center" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--color-surface-hover)' }}>
                      <Dumbbell size={24} className="text-[var(--color-text-muted)]" />
                    </div>
                    <p className="font-bold text-[var(--color-text-muted)] text-[15px]" style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: -0.3 }}>{t('dashboard.noRoutinesYet')}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-1.5 mb-5">
                      {t('dashboard.createRoutineOrProgram')}
                    </p>
                    <Link
                      to="/workouts"
                      className="inline-flex items-center gap-2 py-3 px-6 rounded-2xl bg-[#10B981] text-white font-bold text-[13px]"
                    >
                      <Play size={14} fill="white" />
                      {t('dashboard.goToWorkouts')}
                    </Link>
                  </div>
                )}

                {/* Log a past workout — only relevant when looking at a past
                    day on the strip. Backfills a missed session (no streak credit). */}
                {isPastDay && (
                  <button
                    type="button"
                    onClick={() => setShowBackdatedModal(true)}
                    className="w-full flex items-center gap-3 mt-3 px-4 py-3 rounded-[18px] active:scale-[0.99] transition-transform focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                    style={{
                      background: 'var(--color-bg-card)',
                      boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.04)',
                    }}
                  >
                    <div
                      className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}
                    >
                      <CalendarPlus size={16} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-bold text-[14px]" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
                        {t('dashboard.logPastWorkout', 'Log a past workout')}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {t('dashboard.logPastWorkoutHint', "Backfill a missed session — doesn't count toward streak")}
                      </p>
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} strokeWidth={2} />
                  </button>
                )}
              </section>

              {/* ════════════════════════════════════════════════
                  4. ATTACH CARDIO FINISHER — its own card
                  Used to live as a row inside WorkoutHeroCard. Lifted out so
                  it has the same visual weight as other dashboard cards and
                  isn't visually glued to the hero. Only show on today's
                  view when a lifting routine is queued and the user hasn't
                  already finished any cardio for the day.
                 ════════════════════════════════════════════════ */}
              {isToday && selectedRoutine && !isGymClosedToday && (
                <section className="mb-3">
                  <button
                    type="button"
                    onClick={() => navigate('/cardio-live')}
                    aria-label={t('workoutHeroCard.addCardioFinisher', 'Add cardio finisher')}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-[22px] active:scale-[0.99] transition-transform focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    style={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)',
                      boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)',
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
                    >
                      <Activity size={18} style={{ color: 'var(--color-accent)' }} strokeWidth={2.3} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p
                        className="text-[14px] leading-tight"
                        style={{
                          color: 'var(--color-text-primary)',
                          fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
                          fontWeight: 800,
                          letterSpacing: -0.2,
                        }}
                      >
                        {t('workoutHeroCard.addCardioFinisher', 'Add cardio finisher')}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {todayCardioSessions.length > 0
                          ? t('workoutHeroCard.cardioAttachedHint', 'Cardio logged today — tap to add another')
                          : t('workoutHeroCard.cardioFinisherHint', 'Finish strong with a quick cardio burn')}
                      </p>
                    </div>
                    <span
                      className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold"
                      style={{
                        background: todayCardioSessions.length > 0
                          ? 'rgba(16,185,129,0.15)'
                          : 'var(--color-accent)',
                        color: todayCardioSessions.length > 0 ? '#10B981' : '#001512',
                        fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
                      }}
                    >
                      {todayCardioSessions.length > 0
                        ? t('workoutHeroCard.attached', 'Attached')
                        : t('workoutHeroCard.attach', 'Attach')}
                    </span>
                  </button>
                </section>
              )}

              {/* ════════════════════════════════════════════════
                  5. REWARDS — Level + Daily Challenge
                 ════════════════════════════════════════════════ */}
              <section className="mb-3">
                <div className="grid gap-2.5" style={{ gridTemplateColumns: '1fr 1.2fr' }} data-tour="tour-level">
                  {/* Level / XP */}
                  <Link
                    to="/rewards"
                    className="rounded-[22px] p-3.5 active:scale-[0.98] transition-all duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                    style={{ background: 'var(--color-bg-card, #fff)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[16px] font-extrabold" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: -0.3 }}>
                        {t('dashboard.lvl')} {level}
                      </span>
                      <span
                        className="text-[9px] font-extrabold px-[7px] py-[2px] rounded-full uppercase"
                        style={{
                          background: 'var(--color-surface-hover, #F2F2EF)',
                          color: 'var(--color-text-muted)',
                          letterSpacing: 0.8,
                        }}
                      >
                        {t(`rewards.tiers.${tier.nameKey}`)}
                      </span>
                    </div>
                    <div className="h-[5px] rounded-full overflow-hidden mt-2.5" style={{ background: 'var(--color-surface-hover, #F2F2EF)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${Math.max(xpProgress, 2)}%`, background: 'linear-gradient(90deg, #6D5FDB, #8B7DFF)' }}
                      />
                    </div>
                    <p className="text-[10px] font-semibold mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                      {xpIntoLevel}/{xpForNext} {t('dashboard.xp')}
                    </p>
                  </Link>

                  {/* Challenge of the Day */}
                  <Link
                    to="/community?tab=challenges"
                    className="rounded-[22px] p-3.5 active:scale-[0.98] transition-all duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                    style={{ background: 'var(--color-bg-card, #fff)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Flame size={12} style={{ color: '#FF5A2E' }} fill="#FF5A2E" strokeWidth={0} />
                      <span className="text-[9px] font-extrabold uppercase" style={{ color: '#FF5A2E', letterSpacing: 1 }}>
                        {t('dashboard.challengeOfTheDay')}
                      </span>
                    </div>
                    <p className="text-[15px] font-extrabold leading-tight mt-1" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: -0.3 }}>
                      {tg(t, `challenges.dailyChallengeNames.${getTodayChallenge().nameKey}`, { defaultValue: getTodayChallenge().name })}
                    </p>
                    <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                      {t(`challenges.dailyChallengeDescs.${getTodayChallenge().descKey}`, getTodayChallenge().desc)}
                    </p>
                  </Link>
                </div>
              </section>

              {/* ════════════════════════════════════════════════
                  6+7. WOD + GYM ACTIVITY — side-by-side on desktop
                 ════════════════════════════════════════════════ */}
              <div className="lg:grid lg:grid-cols-2 lg:gap-4">
              <section className="mt-0 mb-3 lg:mb-0">
                <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-subtle)] to-transparent mb-3 lg:hidden" />
                <GymWOD />
              </section>

              <section className="mt-0 mb-6 lg:mb-0">
                <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-subtle)] to-transparent mb-3 lg:hidden" />
                <GymPulse />
              </section>
              </div>

            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ── PLAN INFO MODAL (warm-paper redesign) ─────────── */}
      {showPlanInfo && (() => {
        const prog = activeProgram;
        const totalWeeks = prog ? getTotalProgramWeeks(prog) : 0;
        const weekNum = prog ? getCurrentWeekClamped(prog) : 0;
        const daysElapsed = prog ? Math.floor((new Date() - new Date(prog.program_start)) / 86400000) : 0;
        const daysTotal = prog ? Math.max(1, totalWeeks * 7) : 1;
        const progress = Math.min(Math.round((daysElapsed / daysTotal) * 100), 100);
        const progStartDow = prog ? new Date(prog.program_start).getDay() : 1;
        // Find template to get week data and localized name
        const templateId = prog?.split_type ? `tmpl_${prog.split_type}` : null;
        const nameEntry = templateId ? programTemplateNames[templateId] : null;
        const fullTemplate = templateId && fullTemplates ? fullTemplates.find(t => t.id === templateId) : null;
        // Use schedule_map from the program (authoritative DOW→routine index mapping)
        const sMap = prog?.schedule_map || null;
        // Prefer the creative `display_name` from schedule_map for personal
        // programs ("Apex Build") over the generic split label ("Upper / Lower")
        // so the My Plan header matches what the user sees on the Workouts page.
        const programName = sMap?.display_name
          ? translateCreativeName(sMap.display_name)
          : nameEntry
            ? (i18n.language === 'es' && nameEntry.name_es ? nameEntry.name_es : nameEntry.name)
            : prog?.split_type
              ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              : null;
        const templateWeeks = fullTemplate?.weeks || {};
        const weekKeys = Object.keys(templateWeeks).map(Number).sort((a, b) => a - b);
        const hasTemplateData = weekKeys.length > 0;
        const hasWrapped = (sMap?.wrapped_dows?.length ?? 0) > 0;

        // Build DOW→routine_index maps for each week type
        const normalDowMap = {};
        const week1DowMap = {};
        const lastWeekDowMap = {};
        if (sMap?.routine_day_map) {
          for (const e of sMap.routine_day_map) normalDowMap[e.day_of_week] = e.routine_index;
        }
        if (sMap?.week1_map) {
          for (const e of sMap.week1_map) week1DowMap[e.day_of_week] = e.routine_index;
        }
        if (sMap?.last_week_map) {
          for (const e of sMap.last_week_map) lastWeekDowMap[e.day_of_week] = e.routine_index;
        }

        // Select the correct DOW map for the viewed week
        // Week 1 ALWAYS uses week1 map (handles "Start Today" on non-standard days)
        let activeDowMap;
        if (planWeek === 1 && Object.keys(week1DowMap).length > 0) {
          activeDowMap = week1DowMap;
        } else if (hasWrapped && planWeek === totalWeeks) {
          activeDowMap = lastWeekDowMap;
        } else {
          activeDowMap = normalDowMap;
        }

        // Resolve template week (week 1 partial uses template week 1, week 2 also uses template week 1)
        const effectiveTemplateWeek = hasWrapped && planWeek > 1
          ? Math.min(planWeek - 1, weekKeys.length)
          : Math.min(planWeek, weekKeys.length);
        const currentWeekDays = templateWeeks[String(effectiveTemplateWeek)] || templateWeeks['1'] || [];

        // Variant-aware lookup of the user's actual routines. Personal programs
        // persist routine_ids_a + routine_ids_b in schedule_map (odd weeks → A,
        // even weeks → B). When present, prefer these over the generic split
        // template so the modal shows the same creative routine names and
        // exercise mix the user actually trains. Falls back to the template
        // for legacy programs / gym-assigned templates.
        const variantIdsA = sMap?.routine_ids_a;
        const variantIdsB = sMap?.routine_ids_b;
        const hasUserVariants = Array.isArray(variantIdsA) && variantIdsA.length > 0
          && Array.isArray(variantIdsB) && variantIdsB.length > 0;
        const variantIdsForWeek = hasUserVariants
          ? (planWeek % 2 === 1 ? variantIdsA : variantIdsB)
          : null;

        const canPrev = planWeek > 1;
        const canNext = planWeek < totalWeeks;

        // Build 7-day view, using the active DOW map for this week
        const DAY_LABELS = [t('days.sunday', { ns: 'common' }), t('days.monday', { ns: 'common' }), t('days.tuesday', { ns: 'common' }), t('days.wednesday', { ns: 'common' }), t('days.thursday', { ns: 'common' }), t('days.friday', { ns: 'common' }), t('days.saturday', { ns: 'common' })];
        const activeDowSet = new Set(Object.keys(activeDowMap).map(Number));

        // Compute the actual calendar date for each day-of-week in the
        // currently-viewed plan week so we can mark which sessions the user
        // has already completed (✓ badge in MyPlanModal).
        const trainedDateSet = new Set(scheduledWorkoutDays || []);
        const weekStartDate = prog?.program_start
          ? new Date(new Date(prog.program_start).getTime() + (planWeek - 1) * 7 * 86400000)
          : null;
        const dateKeyForDow = (dow) => {
          if (!weekStartDate) return null;
          const d = new Date(weekStartDate.getTime() + dow * 86400000);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        const fullWeek = DAY_LABELS.map((label, dow) => {
          const isClosed = gymClosedDays.has(dow);
          const dateKey = dateKeyForDow(dow);
          const completed = !!(dateKey && trainedDateSet.has(dateKey));
          // Only show "closed" if gym is closed AND no workout is scheduled for this DOW
          // (user who chose "Start Today" on a closed day overrides gym hours)
          if (isClosed && !activeDowSet.has(dow)) return { label, name: label, exercises: [], isRest: false, isClosed: true, completed };

          // For week 1, any day before start that has no workout = "not started"
          if (planWeek === 1 && !activeDowSet.has(dow) && dow !== 0) {
            // All non-workout days in week 1 before start are "not yet started"
            return { label, name: label, exercises: [], isRest: true, isClosed: false, notStarted: true, completed };
          }
          if (hasWrapped) {
            if (planWeek === totalWeeks && !activeDowSet.has(dow)) {
              return { label, name: label, exercises: [], isRest: true, isClosed: false, completed };
            }
          }

          // Look up routine index for this DOW using the active week's map
          const routineIdx = activeDowMap[dow];

          // Personal A/B variant program: pull the user's actual routine for
          // this slot so the modal shows e.g. "Apex Build · 6 exercises" with
          // the actual exercise picks, not the generic split template.
          if (routineIdx !== undefined && variantIdsForWeek) {
            const rid = variantIdsForWeek[routineIdx];
            const routine = rid ? allRoutines.find(r => r.id === rid) : null;
            if (routine) {
              const routineName = localizeRoutineName(routine.name).replace(/ [AB]$/, '');
              const exercises = (routine.routine_exercises || [])
                .slice()
                .sort((a, b) => (a.position || 0) - (b.position || 0))
                .map(re => ({
                  id: re.exercise_id,
                  sets: re.target_sets,
                }));
              return { label, name: routineName, exercises, isRest: false, isClosed: false, completed };
            }
          }

          if (routineIdx !== undefined && currentWeekDays[routineIdx]) {
            const workoutDay = currentWeekDays[routineIdx];
            return { label, name: (i18n.language === 'es' && workoutDay.name_es ? workoutDay.name_es : workoutDay.name), exercises: workoutDay.exercises || [], isRest: false, isClosed: false, completed };
          }

          // No routine on this DOW = rest day
          return { label, name: label, exercises: [], isRest: true, isClosed: false, completed };
        });

        return showPlanInfo ? (
          <Suspense fallback={null}>
            <MyPlanModal
              open={showPlanInfo}
              onClose={() => setShowPlanInfo(false)}
              activeProgram={prog}
              programName={programName}
              totalWeeks={totalWeeks}
              weekNum={weekNum}
              progress={progress}
              planWeek={planWeek}
              setPlanWeek={setPlanWeek}
              canPrev={canPrev}
              canNext={canNext}
              fullWeek={fullWeek}
              planSelectedDay={planSelectedDay}
              setPlanSelectedDay={setPlanSelectedDay}
              exerciseNameMap={exerciseNameMap}
              onManagePrograms={() => { setShowPlanInfo(false); navigate('/workouts'); }}
              onTrainOutsideGym={() => { setShowPlanInfo(false); navigate('/workouts'); }}
            />
          </Suspense>
        ) : null;
        // legacy inline markup retained below (kept un-rendered for diff safety)
        /* eslint-disable */
        const _unused = (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none" role="dialog" aria-modal="true" aria-label={t('dashboard.myPlan')}>
            <div
              className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-3xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] shadow-2xl overflow-hidden pointer-events-auto"
            >
              {/* Handle + Close */}
              <div className="relative flex justify-center pt-4 pb-3 shrink-0">
                <div className="w-8 h-[3px] rounded-full bg-[var(--color-border-subtle)]" />
                <button
                  onClick={() => setShowPlanInfo(false)}
                  className="absolute right-4 top-3 w-11 h-11 rounded-full bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] flex items-center justify-center text-[var(--color-text-muted)] transition-colors duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                  aria-label={t('dashboard.ariaClose', 'Close')}
                >
                  <span className="text-[16px]">✕</span>
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-6 pb-6">

                {prog ? (
                  <>
                    {/* Program info */}
                    <div className="mb-5">
                      <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.12em]">{t('dashboard.currentProgram')}</p>
                      <h2 className="text-[20px] text-[var(--color-text-primary)] mt-1" style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: -0.5 }}>{programName}</h2>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-medium text-[var(--color-text-muted)]">{t('dashboard.weekXOfY', { current: weekNum, total: totalWeeks })}</span>
                        <span className="text-[10px] font-medium text-[var(--color-text-muted)]">{progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--color-surface-hover)]">
                        <div className="h-full rounded-full bg-[#10B981] transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    </div>

                    {/* Week navigator */}
                    {hasTemplateData && (
                      <div className="mb-5">
                        <div className="flex items-center justify-between mb-2">
                          <button
                            onClick={() => canPrev && setPlanWeek(w => w - 1)}
                            disabled={!canPrev}
                            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none ${
                              canPrev ? 'bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'
                            }`}
                            aria-label={t('dashboard.ariaPreviousWeek', 'Previous week')}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="text-[14px] font-bold text-[var(--color-text-primary)]">
                            {t('dashboard.weekLabel', { week: planWeek })} <span className="text-[var(--color-text-muted)] font-normal">{t('dashboard.ofTotal', { total: totalWeeks })}</span>
                          </span>
                          <button
                            onClick={() => canNext && setPlanWeek(w => w + 1)}
                            disabled={!canNext}
                            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors duration-200 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none ${
                              canNext ? 'bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'
                            }`}
                            aria-label={t('dashboard.ariaNextWeek', 'Next week')}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                        <div className="h-[2px] rounded-full bg-[var(--color-surface-hover)]">
                          <div
                            className="h-full rounded-full bg-[#10B981]/50 transition-all duration-300"
                            style={{ width: `${(planWeek / totalWeeks) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Weekly schedule — tap day to expand */}
                    <div className="space-y-1">
                      {fullWeek.map((day, i) => {
                        const isExpanded = planSelectedDay === i;
                        return (
                          <div key={i}>
                            <button
                              type="button"
                              onClick={() => setPlanSelectedDay(isExpanded ? null : i)}
                              className={`w-full flex items-center justify-between py-3 px-3.5 rounded-xl text-left transition-colors ${
                                day.isRest
                                  ? ''
                                  : isExpanded ? 'bg-[var(--color-bg-deep)]' : 'bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)]'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <span className={`text-[13px] font-medium w-20 ${day.isClosed ? 'text-red-400' : day.isRest ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>
                                  {day.label}
                                </span>
                                {day.isClosed ? (
                                  <span className="text-[11px] text-red-400 flex items-center gap-1">🔒 {t('dashboard.gymClosed', 'Gym Closed')}</span>
                                ) : day.notStarted ? (
                                  <span className="text-[11px] text-[var(--color-text-muted)] italic">{t('dashboard.notYetStarted', 'Program not yet started')}</span>
                                ) : day.isRest ? (
                                  <span className="text-[11px] text-[var(--color-text-muted)]">{t('dashboard.restDay')}</span>
                                ) : (
                                  <span className="text-[11px] text-[var(--color-text-muted)]">
                                    {day.name} · {day.exercises.length} {t('dashboard.exercises')}
                                  </span>
                                )}
                              </div>
                              {!day.isRest && !day.isClosed && (
                                <ChevronRight size={14} className={`text-[var(--color-text-muted)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              )}
                            </button>

                            {/* Gym closed — offer to train outside */}
                            {isExpanded && day.isClosed && (
                              <div className="mx-3.5 mb-1 px-3.5 py-3 rounded-lg bg-red-500/5 border border-red-500/15 text-center">
                                <p className="text-[11px] text-[var(--color-text-muted)] mb-2">{t('dashboard.gymClosedMessage', 'The gym is closed today. Rest up and come back stronger!')}</p>
                                <button
                                  type="button"
                                  onClick={() => navigate('/workouts')}
                                  className="text-[11px] font-semibold transition-colors"
                                  style={{ color: 'var(--color-accent, #2EC4C4)' }}
                                >
                                  {t('dashboard.trainOutsideGym', 'Want to train outside the gym?')}
                                </button>
                              </div>
                            )}

                            {/* Expanded exercises */}
                            {isExpanded && !day.isRest && !day.isClosed && (
                              <div className="mx-3.5 mb-1 px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-hover)] border border-[var(--color-border-subtle)]">
                                <div className="space-y-1.5">
                                  {day.exercises.map((ex, ei) => (
                                    <div key={ei} className="flex items-center justify-between">
                                      <p className="text-[12px] text-[var(--color-text-muted)]">
                                        <span className="text-[var(--color-text-muted)] mr-1.5">{ei + 1}.</span>
                                        {exerciseNameMap[ex.id] || ex.id}
                                      </p>
                                      <p className="text-[10px] text-[var(--color-text-muted)]">
                                        {ex.sets} {t('dashboard.sets')}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center">
                    <p className="text-[32px] mb-3">📋</p>
                    <p className="text-[16px] font-bold text-[var(--color-text-muted)]">{t('dashboard.noActiveProgram')}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-1.5 mb-5">{t('dashboard.startProgramHint')}</p>
                  </div>
                )}
              </div>

              {/* Bottom actions */}
              <div className="shrink-0 px-6 pt-3 pb-5 flex gap-3 bg-gradient-to-t from-[var(--color-bg-card)] via-[var(--color-bg-card)] to-transparent">
                <button
                  onClick={() => { setShowPlanInfo(false); navigate('/workouts'); }}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-[13px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
                >
                  {prog ? t('dashboard.managePrograms') : t('dashboard.browsePrograms')}
                </button>
              </div>
            </div>
          </div>
        );
        void _unused;
        /* eslint-enable */
      })()}

      {/* ── QR CODE MODAL ──────────────────────────────────
          Only mount when we actually have a payload to render. Without this
          guard, QRCodeModal would mount with payload="" which causes
          signQRPayload to reject (and the rejection bubbles up as the cryptic
          [reject]@capacitor stack the field tester reported). */}
      {showQR && (profile?.qr_code_payload || user?.id) && (
        <Suspense fallback={null}>
          <QRCodeModal
            payload={profile?.qr_code_payload || user?.id || ''}
            memberName={profile?.full_name || 'Member'}
            displayFormat={profile?.display_format || 'qr_code'}
            gymName={profile?.gym_name || ''}
            onClose={() => setShowQR(false)}
          />
        </Suspense>
      )}

      {/* ── ROUTINE PICKER MODAL ────────────────────────── */}
      {pickerOpen && (
        <Suspense fallback={null}>
          <RoutinePickerModal
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            dayOfWeek={pickerDay}
            routines={allRoutines}
            currentRoutineId={schedule[pickerDay]?.routineId}
            onSelect={handleAssignRoutine}
            onClear={handleClearDay}
          />
        </Suspense>
      )}

      {/* App Tour moved to PlatformLayout so it persists across page navigations */}

      {/* ── CARDIO LOG MODAL ────────────────────────────── */}
      {showCardioLog && (
        <Suspense fallback={null}>
          <CardioLogModal
            isOpen={showCardioLog}
            onClose={() => setShowCardioLog(false)}
            onLogged={() => setRefreshKey(k => k + 1)}
          />
        </Suspense>
      )}

      {/* ── NPS SURVEY MODAL ─────────────────────────────── */}
      <Suspense fallback={null}>
        <NPSSurveyModal />
      </Suspense>

      {/* ── BACKDATED WORKOUT MODAL ──────────────────────── */}
      {showBackdatedModal && (
        <Suspense fallback={null}>
          <BackdatedWorkoutModal
            open={showBackdatedModal}
            onClose={() => setShowBackdatedModal(false)}
            routines={allRoutines}
            onSaved={() => {
              setShowBackdatedModal(false);
              setRefreshKey(k => k + 1);
            }}
          />
        </Suspense>
      )}

      {/* ── RECOVERY / READINESS MODAL ─────────────────── */}
      <ReadinessModal open={readinessOpen} onClose={() => setReadinessOpen(false)} />

      {/* ── RECENTLY DELETED WORKOUTS MODAL ─────────────── */}
      {showDeletedModal && (
        <Suspense fallback={null}>
          <DeletedWorkoutsModal
            open={showDeletedModal}
            onClose={() => setShowDeletedModal(false)}
            onRestored={() => setRefreshKey(k => k + 1)}
          />
        </Suspense>
      )}

      {/* Daily wellness check-in prompt (one-tap soreness slider). Auto-
          shown on Dashboard mount when no entry exists for today and the
          user hasn't already skipped today's prompt. */}
      {showWellnessCheckin && (
        <Suspense fallback={null}>
          <WellnessCheckinModal
            open={showWellnessCheckin}
            onClose={handleWellnessSkip}
            onSaved={() => setWellnessRefreshKey(k => k + 1)}
          />
        </Suspense>
      )}

      {/* Delete session confirmation */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center px-6"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            role="dialog"
            aria-modal="true"
            aria-label={t('dashboard.deleteSessionTitle', 'Delete session?')}
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl p-6 border"
              style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }}
            >
              <p className="font-bold text-[16px] mb-2" style={{ color: 'var(--color-text-primary)' }}>
                {t('dashboard.deleteSessionTitle', 'Delete session?')}
              </p>
              <p className="text-[13px] mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{deleteConfirm.name}</span>
              </p>
              <p className="text-[12px] mb-5" style={{ color: 'var(--color-text-muted)' }}>
                {t('dashboard.deleteSessionWarning', 'This will permanently remove this session and all its data. This cannot be undone.')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
                >
                  {t('common.cancel', { ns: 'common', defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleDeleteSession}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-colors active:opacity-80"
                    style={{ background: '#EF4444', color: '#fff' }}
                >
                  {t('dashboard.deleteConfirm', 'Delete')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default Dashboard;
