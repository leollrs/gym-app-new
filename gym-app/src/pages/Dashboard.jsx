import { useState, useEffect, useReducer, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, ChevronLeft, Apple, ClipboardList,
  Dumbbell, Pencil, Trophy, Play, Flame, QrCode, CheckCircle2,
} from 'lucide-react';
import { programTemplates } from '../data/programTemplates';
import { isSameDay, isBefore, startOfDay, startOfWeek } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { runNotificationScheduler } from '../lib/notificationScheduler';
import { getCached, setCache } from '../lib/queryCache';
import { computeStreakFromSessions } from '../lib/achievements';
import { getRewardTier, getUserPoints } from '../lib/rewardsEngine';
import { getLevel } from '../components/LevelBadge';
import { exercises as exerciseLibrary } from '../data/exercises';
import GymPulse from '../components/GymPulse';
import { getTodayChallenge } from '../lib/dailyChallenges';

import DayStrip from '../components/DayStrip';
import WorkoutHeroCard from '../components/WorkoutHeroCard';
import RoutinePickerModal from '../components/RoutinePickerModal';
import CoachMark from '../components/CoachMark';
import QRCodeModal from '../components/QRCodeModal';
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
const initialState = {
  loading: true,
  stats: { sessions: 0, streak: 0 },
  allRoutines: [],
  schedule: {},
  selectedRoutine: null,
  selectedRoutineExercises: [],
  lastSessionForRoutine: null,
  scheduledWorkoutDays: [],
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
  <div className={`rounded-2xl bg-white/[0.04] animate-pulse ${className}`} />
);

const DashboardSkeleton = () => (
  <div className="space-y-5">
    <PulseBlock className="h-10" />
    <PulseBlock className="h-16" />
    <PulseBlock className="h-8 w-64" />
    <PulseBlock className="h-[360px] rounded-2xl" />
  </div>
);

/* ── Main ────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile, lifetimePoints: ctxLifetimePoints, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');

  const [state, dispatch] = useReducer(dashReducer, initialState);
  const {
    loading, stats, allRoutines,
    schedule, selectedRoutine, selectedRoutineExercises,
    lastSessionForRoutine, scheduledWorkoutDays,
  } = state;

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [todaysSessions, setTodaysSessions] = useState([]);
  const [todaysSessionsLoaded, setTodaysSessionsLoaded] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [localSkipped, setLocalSkipped] = useState(false);
  const skippedToday = localSkipped || profile?.skip_suggestion_date === today;
  const [weekSessions, setWeekSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(() => readActiveSession());
  const [allActiveDrafts, setAllActiveDrafts] = useState(() => readAllActiveSessions());
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveChallenge, setLiveChallenge] = useState(null);
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
  const [planWeek, setPlanWeek] = useState(1);
  const [planSelectedDay, setPlanSelectedDay] = useState(null);

  const activeSetsCompleted = activeSession
    ? Object.values(activeSession.loggedSets).flat().filter(s => s.completed).length
    : 0;
  const activeSetsTotal = activeSession
    ? Object.values(activeSession.loggedSets).flat().length
    : 0;

  useEffect(() => { document.title = 'Dashboard | TuGymPR'; }, []);

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

  // Hydrate from cache
  useEffect(() => {
    const cached = getCached(`dash:${user?.id}`);
    if (cached?.data) dispatch({ type: 'HYDRATE', payload: cached.data });
  }, [user?.id]);

  // Load data
  useEffect(() => {
    if (!user || !profile) return;
    let cancelled = false;

    const load = async () => {
      const hasCached = !!getCached(`dash:${user.id}`)?.data;
      if (!hasCached) dispatch({ type: 'SET_LOADING', payload: true });

      const [sessionsRes, routinesRes, scheduleRes, progRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, name, completed_at, total_volume_lbs, duration_seconds, routine_id')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(50),
        supabase
          .from('routines')
          .select('id, name, description, created_at, routine_exercises(id, exercise_id, target_sets, target_reps, position, exercises(name, name_es, video_url))')
          .eq('created_by', user.id)
          .eq('is_template', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('workout_schedule')
          .select('day_of_week, routine_id')
          .eq('profile_id', user.id),
        supabase
          .from('generated_programs')
          .select('id, program_start, split_type, expires_at, routines_a_count')
          .eq('profile_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const scheduleData = !scheduleRes.error ? (scheduleRes.data || []) : [];

      const allSessions = sessionsRes.data || [];
      const fetchedRoutines = routinesRes.data || [];

      // Fetch training days and gym hours for smart streak
      const [{ data: prefData }, { data: gymData }] = await Promise.all([
        supabase.from('profiles').select('preferred_training_days').eq('id', user.id).maybeSingle(),
        supabase.from('gyms').select('open_days').eq('id', profile.gym_id).maybeSingle(),
      ]);
      const DAY_NAME_TO_DOW = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
      const prefDays = prefData?.preferred_training_days || [];
      const restDays = prefDays.length > 0
        ? [0,1,2,3,4,5,6].filter(d => !prefDays.some(name => DAY_NAME_TO_DOW[name] === d))
        : [];
      const gymOpenDays = gymData?.open_days || [];
      const gymClosedDays = gymOpenDays.length > 0
        ? [0,1,2,3,4,5,6].filter(d => !gymOpenDays.includes(d))
        : [];
      const streak = computeStreakFromSessions(allSessions, { restDays, gymClosedDays, userId: user.id });

      const todaySessionsFiltered = allSessions.filter(s => {
        const d = new Date(s.completed_at);
        return d.toDateString() === new Date().toDateString();
      });

      const today = new Date();

      // Resolve active program early so we can filter schedule entries
      const fetchedProgram = !progRes.error ? progRes.data : null;
      setActiveProgram(fetchedProgram || null);
      const programStart = fetchedProgram ? new Date(fetchedProgram.program_start) : null;

      const scheduleMap = {};
      for (const row of scheduleData) {
        const routine = fetchedRoutines.find(r => r.id === row.routine_id);
        if (routine) {
          // When an active program exists, only include Auto: routines created
          // after the program start — this filters out stale manual schedule entries
          if (fetchedProgram) {
            const isAutoRoutine = routine.name.startsWith('Auto:');
            const createdAfterProgram = new Date(routine.created_at || 0) >= programStart;
            if (!isAutoRoutine || !createdAfterProgram) continue;
          }
          scheduleMap[row.day_of_week] = {
            routineId: row.routine_id,
            label: routine.name.replace('Auto: ', '').replace(/ [AB]$/, ''),
          };
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
      if (!pickedRoutine && scheduleMap[todayDow]) {
        pickedRoutine = fetchedRoutines.find(r => r.id === scheduleMap[todayDow].routineId) || null;
      }
      if (cancelled) return;

      if (!pickedRoutine && fetchedRoutines.length > 0) {
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
        if (d >= weekStart) {
          const localKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          trainedDateSet.add(localKey);
        }
      }
      const trainedDates = [...trainedDateSet];

      const payload = {
        stats: { sessions: allSessions.length, streak },
        allRoutines: fetchedRoutines,
        schedule: scheduleMap,
        selectedRoutine: pickedRoutine,
        selectedRoutineExercises: pickedExercises,
        lastSessionForRoutine: lastSession,
        scheduledWorkoutDays: trainedDates,
      };

      // Store all sessions from this week so past-day views can show summaries
      const weekSessionsFiltered = allSessions.filter(s => {
        const d = new Date(s.completed_at);
        return d >= weekStart;
      });

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
      runNotificationScheduler(user.id, profile.gym_id).catch(() => {});

      // Fetch actual points for level display
      const pointsData = await getUserPoints(user.id);
      if (!cancelled) setUserPoints(pointsData.lifetime_points || 0);

      // Fetch first active challenge
      const { data: challengeData } = await supabase
        .from('challenges')
        .select('id, name, type, start_date, end_date')
        .eq('gym_id', profile.gym_id)
        .lte('start_date', new Date().toISOString())
        .gte('end_date', new Date().toISOString())
        .order('start_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (challengeData) {
        setLiveChallenge(challengeData);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [user, profile, refreshKey]);

  useEffect(() => {
    if (loading) return;
    const dow = selectedDate.getDay();
    const assigned = schedule[dow];

    if (assigned) {
      const routine = allRoutines.find(r => r.id === assigned.routineId);
      if (routine) {
        const exercises = (routine.routine_exercises || [])
          .sort((a, b) => (a.position || 0) - (b.position || 0));
        dispatch({
          type: 'SET_SELECTED_ROUTINE',
          payload: { routine, exercises, lastSession: null },
        });
        return;
      }
    }
    if (isSameDay(selectedDate, new Date())) return;
    dispatch({
      type: 'SET_SELECTED_ROUTINE',
      payload: { routine: null, exercises: [], lastSession: null },
    });
  }, [selectedDate, schedule, loading, allRoutines]);

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
        label: routine ? routine.name.replace('Auto: ', '').replace(/ [AB]$/, '') : 'Workout',
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

  /* ── Derived data ──────────────────────────────────────── */
  const isPastDay = isBefore(startOfDay(selectedDate), startOfDay(new Date())) && !isSameDay(selectedDate, new Date());
  const pastDaySessions = isPastDay
    ? weekSessions.filter(s => {
        const d = new Date(s.completed_at);
        return d.toLocaleDateString() === selectedDate.toLocaleDateString();
      })
    : [];

  const liftCount = selectedRoutineExercises.length;
  const estimatedMin = lastSessionForRoutine?.duration_seconds
    ? Math.round(lastSessionForRoutine.duration_seconds / 60)
    : liftCount * 4;
  const estimatedCal = Math.round(estimatedMin * 5.2);

  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const selectedDayName = t(`days.${DAY_KEYS[selectedDate.getDay()]}`, { ns: 'common' });
  const isToday = isSameDay(selectedDate, new Date());

  const workoutType = selectedRoutine
    ? selectedRoutine.name.replace('Auto: ', '').replace(/ [AB]$/, '')
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

  const hasRoutines = allRoutines.length > 0;

  // Level / XP — use actual points from reward_points table
  const { level, xpIntoLevel, xpForNext, progress: xpProgress } = getLevel(userPoints);
  const tier = getRewardTier(userPoints);

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto w-full max-w-[680px] md:max-w-4xl px-5 pt-6 pb-28 space-y-0">

        {/* ════════════════════════════════════════════════════
            HEADER — My Plan + Icons
           ════════════════════════════════════════════════════ */}
        <header className="flex items-center justify-between mb-2" data-tour="tour-my-plan">
          <button
            type="button"
            onClick={() => setShowPlanInfo(true)}
            className="flex items-center gap-1.5 active:scale-[0.97] transition-transform"
          >
            <span className="text-[16px] font-bold text-[var(--color-text-primary)]">{t('dashboard.myPlan')}</span>
            <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
          </button>

          <div className="flex items-center gap-2" data-tour="tour-quick-buttons">
            <Link to="/nutrition"
              className="flex items-center gap-1.5 px-3 h-[34px] rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] active:scale-[0.98] hover:bg-white/[0.06] transition-all duration-200"
              aria-label="Nutrition">
              <Apple size={14} className="text-[#10B981]" />
              <span className="text-[10px] font-bold text-[var(--color-text-muted)]">{t('dashboard.nutrition')}</span>
            </Link>
            <button
              type="button"
              onClick={() => setShowQR(true)}
              className="flex items-center gap-1.5 px-3 h-[34px] rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] active:scale-[0.98] hover:bg-white/[0.06] transition-all duration-200"
              aria-label="QR Code"
            >
              <QrCode size={14} className="text-[#D4AF37]" />
              <span className="text-[10px] font-bold text-[var(--color-text-muted)]">{t('dashboard.qr')}</span>
            </button>
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton />
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
                />
              </section>

              {/* ════════════════════════════════════════════════
                  2. TODAY'S WORKOUT — Dominant, action-first
                 ════════════════════════════════════════════════ */}
              <section className="mb-3">
                <div className="flex items-end justify-between mb-1">
                  <div>
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.12em]">
                      {isToday ? t('dashboard.today') : selectedDayName}
                    </p>
                    <h1 className="text-[28px] font-bold text-[var(--color-text-primary)] tracking-tight leading-tight mt-0.5">
                      {workoutType}
                    </h1>
                  </div>

                  {selectedRoutine ? (
                    <div className="flex items-center gap-1 mb-1">
                      <button
                        type="button"
                        onClick={() => handleAssignDay(selectedDate.getDay())}
                        className="w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] hover:bg-white/[0.06] transition-colors duration-200"
                        aria-label="Change workout"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/workouts/${selectedRoutine.id}/edit?from=/`)}
                        className="w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] hover:bg-white/[0.06] transition-colors duration-200"
                        aria-label="Edit workout"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>

              {/* ════════════════════════════════════════════════
                  2b. WORKOUT STATS — Compact inline row
                 ════════════════════════════════════════════════ */}
              {selectedRoutine && (
                <section className="mb-5">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5 bg-white/[0.04] rounded-lg px-2.5 py-1.5">
                      <Dumbbell size={11} className="text-[var(--color-text-muted)]" />
                      {liftCount} {t('dashboard.exercises')}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] bg-white/[0.04] rounded-lg px-2.5 py-1.5">
                      {estimatedMin} {t('dashboard.min')}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] bg-white/[0.04] rounded-lg px-2.5 py-1.5">
                      ~{estimatedCal} {t('dashboard.cal')}
                    </span>
                  </div>
                </section>
              )}

              {/* ════════════════════════════════════════════════
                  3. HERO CARD — Elevated, primary CTA
                 ════════════════════════════════════════════════ */}
              <section className="mb-3" data-tour="tour-hero-card">
                {/* Wait for today's sessions to load before rendering hero to prevent flash */}
                {isToday && !todaysSessionsLoaded ? (
                  <div className="w-full rounded-[20px] bg-white/[0.04] animate-pulse" style={{ aspectRatio: '9 / 10' }} />
                ) : isToday && todaysSessions.length > 0 && selectedRoutine && todaysSessions.some(s => s.routine_id === selectedRoutine.id) && !(activeSession && activeSession.routineId === selectedRoutine.id) ? (
                  <div className="w-full rounded-2xl bg-gradient-to-br from-[#10B981]/8 to-[#10B981]/[0.01] border border-[#10B981]/15 p-6 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={28} className="text-[#10B981]" />
                    </div>
                    <p className="font-bold text-[18px] text-[var(--color-text-primary)]">{t('dashboard.workoutAlreadyCompleted')}</p>
                    <p className="text-[13px] text-[var(--color-text-muted)] mt-1.5 mb-5">
                      {t('dashboard.greatJobToday')} <span className="text-[#10B981] font-semibold">{workoutType}</span> {t('dashboard.sessionIsDone')}
                    </p>

                    {/* Link to session summary */}
                    {(() => {
                      const doneSession = todaysSessions.find(s => s.routine_id === selectedRoutine.id);
                      if (!doneSession) return null;
                      const vol = parseFloat(doneSession.total_volume_lbs) || 0;
                      const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
                      return (
                        <Link
                          to="/session-summary"
                          state={{
                            routineName: doneSession.name,
                            elapsedTime: doneSession.duration_seconds,
                            totalVolume: vol,
                            sessionId: doneSession.id,
                            completedAt: doneSession.completed_at,
                          }}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.08] transition-colors mb-3 text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                            <Trophy size={16} className="text-[#10B981]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">{doneSession.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              <span>{Math.round((doneSession.duration_seconds || 0) / 60)}m</span>
                              <span className="text-[var(--color-border-subtle)]">&middot;</span>
                              <span>{volStr} lbs</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-medium text-[#10B981]">{t('dashboard.viewSummary')}</span>
                        </Link>
                      );
                    })()}

                    {/* Additional workouts done today (non-scheduled) */}
                    {(() => {
                      const extras = todaysSessions.filter(s => s.routine_id !== selectedRoutine.id);
                      if (extras.length === 0) return null;
                      return (
                        <div className="mb-3">
                          <p className="text-[10px] font-semibold text-[#D4AF37] uppercase tracking-[0.12em] mb-2">
                            {t('dashboard.alsoCompletedToday')}
                          </p>
                          {extras.map(session => {
                            const vol = parseFloat(session.total_volume_lbs) || 0;
                            const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
                            return (
                              <Link
                                key={session.id}
                                to="/session-summary"
                                state={{
                                  routineName: session.name,
                                  elapsedTime: session.duration_seconds,
                                  totalVolume: vol,
                                  sessionId: session.id,
                                  completedAt: session.completed_at,
                                }}
                                className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.08] transition-colors mb-1.5 text-left"
                              >
                                <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                                  <Dumbbell size={13} className="text-[#D4AF37]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-semibold text-[var(--color-text-primary)] truncate">{session.name}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    <span>{Math.round((session.duration_seconds || 0) / 60)}m</span>
                                    <span className="text-[var(--color-border-subtle)]">&middot;</span>
                                    <span>{volStr} lbs</span>
                                  </div>
                                </div>
                                <ChevronRight size={12} className="text-[var(--color-text-muted)]" />
                              </Link>
                            );
                          })}
                        </div>
                      );
                    })()}

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
                                <Play size={13} fill="#60A5FA" className="text-[#60A5FA]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-semibold text-[var(--color-text-primary)] truncate">{draft.routineName || t('dashboard.workout')}</p>
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
                      className="w-full py-3.5 rounded-2xl text-[13px] font-bold text-[var(--color-text-primary)] bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
                    >
                      {t('dashboard.doAnotherWorkout')}
                    </button>
                  </div>
                ) : isToday && todaysSessions.length > 0 && selectedRoutine && !todaysSessions.some(s => s.routine_id === selectedRoutine.id) && !(activeSession && activeSession.routineId === selectedRoutine.id) && !skippedToday ? (
                  /* Trained today but with a different routine — scheduled one still pending */
                  <div className="w-full rounded-2xl bg-gradient-to-br from-[#D4AF37]/8 to-[#D4AF37]/[0.01] border border-[#D4AF37]/15 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                        <Flame size={20} className="text-[#D4AF37]" />
                      </div>
                      <div>
                        <p className="font-bold text-[15px] text-[var(--color-text-primary)]">{t('dashboard.alreadyTrainedToday')}</p>
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{t('dashboard.butPrefix')} <span className="text-[#D4AF37] font-semibold">{workoutType}</span> {t('dashboard.butSuffix')}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/session/${selectedRoutine.id}`}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[13px] font-bold text-white bg-[#D4AF37] hover:bg-[#C4A030] active:scale-[0.98] transition-all"
                      >
                        <Play size={14} fill="white" /> {t('dashboard.finishWorkout', { workout: workoutType })}
                      </Link>
                      <button
                        onClick={handleSkipSuggestion}
                        className="px-4 py-3.5 rounded-2xl text-[12px] font-semibold text-[var(--color-text-muted)] bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
                      >
                        {t('dashboard.skip')}
                      </button>
                    </div>
                  </div>
                ) : isToday && skippedToday && todaysSessions.length > 0 ? (
                  /* User dismissed the "already trained" banner — show completed state */
                  <div className="w-full rounded-2xl bg-gradient-to-br from-[#10B981]/8 to-[#10B981]/[0.01] border border-[#10B981]/15 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 size={16} className="text-[#10B981]" />
                      <p className="text-[13px] font-semibold text-[#10B981]">{t('dashboard.youveTrainedToday')}</p>
                    </div>
                    {todaysSessions.slice(0, 3).map(session => {
                      const vol = parseFloat(session.total_volume_lbs) || 0;
                      const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
                      return (
                        <Link key={session.id} to="/session-summary"
                          state={{ routineName: session.name, elapsedTime: session.duration_seconds, totalVolume: vol, sessionId: session.id, completedAt: session.completed_at }}
                          className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.08] transition-colors mb-1.5 text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-[var(--color-text-primary)] truncate">{session.name}</p>
                            <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              <span>{Math.round((session.duration_seconds || 0) / 60)}m</span>
                              <span className="text-[var(--color-border-subtle)]">&middot;</span>
                              <span>{volStr} lbs</span>
                            </div>
                          </div>
                          <ChevronRight size={12} className="text-[var(--color-text-muted)]" />
                        </Link>
                      );
                    })}
                    <button onClick={() => navigate('/workouts')}
                      className="w-full mt-2 py-3 rounded-xl text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors">
                      {t('dashboard.doAnotherWorkout')}
                    </button>
                  </div>
                ) : isPastDay && pastDaySessions.length > 0 ? (
                  /* Past day WITH completed sessions — show summary */
                  <div className="w-full rounded-2xl bg-gradient-to-br from-[#C9A227]/8 to-[#C9A227]/[0.01] border border-[#C9A227]/15 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 size={16} className="text-[#C9A227]" />
                      <p className="text-[13px] font-semibold text-[#C9A227]">{t('dashboard.workoutCompleted')}</p>
                    </div>
                    {pastDaySessions.map(session => {
                      const vol = parseFloat(session.total_volume_lbs) || 0;
                      const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
                      return (
                        <Link
                          key={session.id}
                          to="/session-summary"
                          state={{
                            routineName: session.name,
                            elapsedTime: session.duration_seconds,
                            totalVolume: vol,
                            sessionId: session.id,
                            completedAt: session.completed_at,
                          }}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.08] transition-colors mb-1.5 text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-[#C9A227]/10 flex items-center justify-center flex-shrink-0">
                            <Trophy size={16} className="text-[#C9A227]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">{session.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              <span>{Math.round((session.duration_seconds || 0) / 60)}m</span>
                              <span className="text-[var(--color-border-subtle)]">&middot;</span>
                              <span>{volStr} lbs</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-medium text-[#C9A227]">{t('dashboard.viewSummary')}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : isPastDay ? (
                  /* Past day with NO completed sessions — muted message */
                  <div className="w-full rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] p-5 text-center">
                    <p className="text-[14px] text-[var(--color-text-muted)]">{t('dashboard.thisDayHasPassed')}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{t('dashboard.noWorkoutLogged')}</p>
                  </div>
                ) : selectedRoutine ? (
                  <WorkoutHeroCard
                    routineId={selectedRoutine.id}
                    exercises={allExercisesWithMedia}
                    isActive={!!activeSession && activeSession.routineId === selectedRoutine.id}
                    isCompleted={isToday && todaysSessions.some(s => s.routine_id === selectedRoutine.id)}
                    activeSetsCompleted={activeSetsCompleted}
                    activeSetsTotal={activeSetsTotal}
                    activeElapsedTime={activeSession?.elapsedTime}
                  />
                ) : hasRoutines ? (
                  <div className="w-full rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] p-5 text-center">
                    <p className="text-[32px] mb-3">😴</p>
                    <p className="font-bold text-[var(--color-text-muted)] text-[16px]">{t('dashboard.restDay')}</p>
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
                  <div className="rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] p-5 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
                      <Dumbbell size={24} className="text-[var(--color-text-muted)]" />
                    </div>
                    <p className="font-bold text-[var(--color-text-muted)] text-[15px]">{t('dashboard.noRoutinesYet')}</p>
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
              </section>

              {/* ════════════════════════════════════════════════
                  5. REWARDS — Level + Daily Challenge
                 ════════════════════════════════════════════════ */}
              <section className="mb-3">
                <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent mb-3" />
                <div className="flex items-stretch gap-3" data-tour="tour-level">
                  {/* Level / XP */}
                  <Link
                    to="/rewards"
                    className="flex-1 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] p-5 active:scale-[0.98] hover:bg-white/[0.06] transition-all duration-200"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[13px] font-bold text-[var(--color-text-primary)]">
                        {t('dashboard.lvl')} {level}
                      </span>
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${tier.color}12`,
                          color: tier.color,
                        }}
                      >
                        {tier.name}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${xpProgress}%`, backgroundColor: tier.color }}
                      />
                    </div>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                      {xpIntoLevel}/{xpForNext} {t('dashboard.xp')}
                    </p>
                  </Link>

                  {/* Challenge of the Day */}
                  <Link
                    to="/community?tab=challenges"
                    className="flex-1 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] p-5 active:scale-[0.98] hover:bg-white/[0.06] transition-all duration-200"
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <Flame size={11} className="text-orange-400/70" />
                      <span className="text-[9px] font-bold text-orange-400/70 uppercase tracking-wider">
                        {t('dashboard.challengeOfTheDay')}
                      </span>
                    </div>
                    <p className="text-[12px] font-semibold text-[var(--color-text-primary)] leading-tight">
                      {t(`challenges.dailyChallengeNames.${getTodayChallenge().nameKey}`, getTodayChallenge().name)}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)] font-medium mt-1.5">
                      {t(`challenges.dailyChallengeDescs.${getTodayChallenge().descKey}`, getTodayChallenge().desc)}
                    </p>
                  </Link>
                </div>
              </section>

              {/* ════════════════════════════════════════════════
                  6. GYM ACTIVITY
                 ════════════════════════════════════════════════ */}
              <section className="mt-0 mb-6">
                <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent mb-3" />
                <GymPulse />
              </section>

            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ── PLAN INFO MODAL ─────────────────────────────── */}
      {showPlanInfo && (() => {
        const prog = activeProgram;
        const weekNum = prog
          ? Math.min(Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1, Math.ceil((new Date(prog.expires_at) - new Date(prog.program_start)) / (7 * 86400000)))
          : 0;
        const totalWeeks = prog
          ? Math.ceil((new Date(prog.expires_at) - new Date(prog.program_start)) / (7 * 86400000))
          : 0;
        const daysElapsed = prog ? Math.floor((new Date() - new Date(prog.program_start)) / 86400000) : 0;
        const daysTotal = prog ? Math.max(1, Math.floor((new Date(prog.expires_at) - new Date(prog.program_start)) / 86400000)) : 1;
        const progress = Math.min(Math.round((daysElapsed / daysTotal) * 100), 100);
        const programName = prog?.split_type
          ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          : null;

        // Find template to get week data
        const templateId = prog?.split_type ? `tmpl_${prog.split_type}` : null;
        const template = templateId ? programTemplates.find(t => t.id === templateId) : null;
        const templateWeeks = template?.weeks || {};
        const weekKeys = Object.keys(templateWeeks).map(Number).sort((a, b) => a - b);
        const hasTemplateData = weekKeys.length > 0;

        // Current view week
        const viewWeek = String(planWeek);
        const currentWeekDays = templateWeeks[viewWeek] || [];
        const canPrev = planWeek > 1;
        const canNext = planWeek < (weekKeys.length || totalWeeks);

        // Build 7-day view for current week
        const DAY_LABELS = [t('days.sunday', { ns: 'common' }), t('days.monday', { ns: 'common' }), t('days.tuesday', { ns: 'common' }), t('days.wednesday', { ns: 'common' }), t('days.thursday', { ns: 'common' }), t('days.friday', { ns: 'common' }), t('days.saturday', { ns: 'common' })];
        const fullWeek = DAY_LABELS.map((label, i) => {
          const workoutDay = currentWeekDays[i];
          if (workoutDay) return { label, name: workoutDay.name, exercises: workoutDay.exercises || [], isRest: false };
          return { label, name: label, exercises: [], isRest: true };
        });

        return (
          <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center pointer-events-none">
            <div
              className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-t-[28px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] border-b-0 shadow-[0_-8px_40px_rgba(0,0,0,0.6)] overflow-hidden pointer-events-auto"
              style={{ paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))' }}
            >
              {/* Handle + Close */}
              <div className="relative flex justify-center pt-4 pb-3 shrink-0">
                <div className="w-8 h-[3px] rounded-full bg-[var(--color-border-subtle)]" />
                <button
                  onClick={() => setShowPlanInfo(false)}
                  className="absolute right-4 top-3 w-11 h-11 rounded-full bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] flex items-center justify-center text-[var(--color-text-muted)] transition-colors duration-200"
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
                      <h2 className="text-[20px] font-semibold text-[var(--color-text-primary)] tracking-tight mt-1">{programName}</h2>
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
                            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors duration-200 ${
                              canPrev ? 'bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'
                            }`}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="text-[14px] font-bold text-[var(--color-text-primary)]">
                            {t('dashboard.weekLabel', { week: planWeek })} <span className="text-[var(--color-text-muted)] font-normal">{t('dashboard.ofTotal', { total: weekKeys.length })}</span>
                          </span>
                          <button
                            onClick={() => canNext && setPlanWeek(w => w + 1)}
                            disabled={!canNext}
                            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors duration-200 ${
                              canNext ? 'bg-[var(--color-surface-hover)] hover:bg-[var(--color-bg-deep)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'
                            }`}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                        <div className="h-[2px] rounded-full bg-[var(--color-surface-hover)]">
                          <div
                            className="h-full rounded-full bg-[#10B981]/50 transition-all duration-300"
                            style={{ width: `${(planWeek / weekKeys.length) * 100}%` }}
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
                                <span className={`text-[13px] font-medium w-20 ${day.isRest ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>
                                  {day.label}
                                </span>
                                {day.isRest ? (
                                  <span className="text-[11px] text-[var(--color-text-muted)]">{t('dashboard.restDay')}</span>
                                ) : (
                                  <span className="text-[11px] text-[var(--color-text-muted)]">
                                    {day.name} · {day.exercises.length} {t('dashboard.exercises')}
                                  </span>
                                )}
                              </div>
                              {!day.isRest && (
                                <ChevronRight size={14} className={`text-[var(--color-text-muted)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              )}
                            </button>

                            {/* Expanded exercises */}
                            {isExpanded && !day.isRest && (
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
      })()}

      {/* ── QR CODE MODAL ────────────────────────────────── */}
      {showQR && (
        <QRCodeModal
          payload={profile?.qr_code_payload || user?.id || ''}
          memberName={profile?.full_name || 'Member'}
          displayFormat={profile?.display_format || 'qr_code'}
          gymName={profile?.gym_name || ''}
          onClose={() => setShowQR(false)}
        />
      )}

      {/* ── ROUTINE PICKER MODAL ────────────────────────── */}
      <RoutinePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        dayOfWeek={pickerDay}
        routines={allRoutines}
        currentRoutineId={schedule[pickerDay]?.routineId}
        onSelect={handleAssignRoutine}
        onClear={handleClearDay}
      />

      {/* App Tour moved to PlatformLayout so it persists across page navigations */}

    </div>
  );
};

export default Dashboard;
