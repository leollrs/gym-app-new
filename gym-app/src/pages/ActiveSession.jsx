import React, { useState, useEffect, useRef, useMemo, Component } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Trophy, Dumbbell, Plus, Search, X, ArrowLeftRight, Star, SlidersHorizontal, Minus, Play, Pause, ChevronLeft, SkipForward } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { computeSuggestion, computeIntraSessionSuggestion } from '../lib/overloadEngine';
import { requestNotificationPermission, scheduleRestDoneNotification, cancelRestNotification } from '../lib/restNotification';
import { startWorkoutNotification, updateWorkoutNotification, cancelWorkoutNotification } from '../lib/workoutNotification';
import { startLiveActivity, updateLiveActivity, endLiveActivity } from '../lib/liveActivityBridge';
import { syncWorkoutToWatch, syncWorkoutEnded, onWatchMessage } from '../lib/watchBridge';
import { useTranslation } from 'react-i18next';
import { exName, exInstructions, localizeRoutineName } from '../lib/exerciseName';
import { cacheWorkoutData, getCachedWorkoutData } from '../lib/offlineQueue';

import ExerciseProgressChart from '../components/ExerciseProgressChart';
import { exercises as localExercises, MUSCLE_GROUPS, EQUIPMENT } from '../data/exercises';
import Confetti from '../components/Confetti';

import SessionHeader from './active-session/SessionHeader';
import ExerciseCard from './active-session/ExerciseCard';
import RestTimer from './active-session/RestTimer';
import SessionSummary from './active-session/SessionSummary';
import { selectWarmUps } from '../lib/warmUpSelector';
import { selectCoolDownStretches } from '../lib/cooldownSelector';

const IS_EMPTY_SESSION = (id) => id === 'empty';

// ── Warm-Up Timer — auto-starting, drift-free, same style as rest timer ─────
const WarmUpTimer = ({ durationSec, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(durationSec);
  const [done, setDone] = useState(false);
  const startedAtRef = useRef(Date.now()); // auto-start immediately
  const rafRef = useRef(null);
  const completedRef = useRef(false);

  // Reset and auto-start on exercise change
  useEffect(() => {
    setTimeLeft(durationSec);
    setDone(false);
    completedRef.current = false;
    startedAtRef.current = Date.now();
    return () => cancelAnimationFrame(rafRef.current);
  }, [durationSec]);

  // Drift-free tick
  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const remaining = Math.max(0, durationSec - elapsed);
      setTimeLeft(remaining);

      if (remaining <= 0 && !completedRef.current) {
        completedRef.current = true;
        setDone(true);
        // Vibrate + alert
        try { navigator.vibrate?.([200, 100, 200]); } catch {}
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [durationSec, onComplete]);

  const progress = 1 - (timeLeft / durationSec);
  const circumference = 2 * Math.PI * 58;
  const dashOffset = circumference * (1 - progress);
  const displaySeconds = Math.ceil(timeLeft);
  const mins = Math.floor(displaySeconds / 60);
  const secs = displaySeconds % 60;

  return (
    <div className="w-full rounded-2xl p-5" style={{ backgroundColor: 'var(--color-bg-card)' }}>
      {/* Timer display — same layout as rest timer */}
      <div className="flex items-center justify-center py-6">
        <div className="relative w-32 h-32">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="58" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
            <circle
              cx="64" cy="64" r="58" fill="none"
              stroke={done ? '#10B981' : '#f97316'}
              strokeWidth="5" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[32px] font-black tabular-nums" style={{ color: done ? '#10B981' : 'var(--color-text-primary)' }}>
              {done ? '✓' : mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : secs}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── In-Session Cardio — open timer with finish + distance/intensity ──────────
const InSessionCardio = ({ exercise, onComplete, onSkip, t, i18n }) => {
  const [phase, setPhase] = useState('ready'); // ready → running → done
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState('');
  const [intensity, setIntensity] = useState('moderate');
  const startRef = useRef(null);
  const accumRef = useRef(0);
  const rafRef = useRef(null);

  // Drift-free count-up timer
  useEffect(() => {
    if (phase !== 'running') { cancelAnimationFrame(rafRef.current); return; }
    if (!startRef.current) startRef.current = Date.now();
    const tick = () => {
      const e = accumRef.current + (Date.now() - startRef.current) / 1000;
      setElapsed(Math.floor(e));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  // Reset on exercise change
  useEffect(() => {
    setPhase('ready'); setElapsed(0); setDistance(''); setIntensity('moderate');
    accumRef.current = 0; startRef.current = null;
    return () => cancelAnimationFrame(rafRef.current);
  }, [exercise.id]);

  const handlePauseResume = () => {
    if (phase === 'running') {
      accumRef.current += (Date.now() - startRef.current) / 1000;
      startRef.current = null;
      setPhase('ready'); // paused
    } else {
      startRef.current = Date.now();
      setPhase('running');
    }
  };

  const handleFinish = () => {
    if (phase === 'running') {
      accumRef.current += (Date.now() - startRef.current) / 1000;
      startRef.current = null;
    }
    setElapsed(Math.floor(accumRef.current));
    setPhase('done');
  };

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const exNameStr = i18n.language === 'es' && exercise.name_es ? exercise.name_es : exercise.name;

  const INTENSITIES = ['easy', 'moderate', 'hard', 'max'];
  const INT_COLORS = { easy: '#22C55E', moderate: '#F59E0B', hard: '#EF4444', max: '#DC2626' };

  return (
    <div className="px-4 pt-3 pb-4">
      <div className="rounded-2xl border border-white/[0.06] overflow-hidden" style={{ background: 'var(--color-bg-card)' }}>
        {/* Exercise name */}
        <div className="px-4 py-3.5 text-center">
          <h2 className="text-[18px] font-black leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>
            {exNameStr}
          </h2>
        </div>

        {phase !== 'done' ? (
          <>
            {/* Timer */}
            <div className="text-center pb-4">
              <p className="text-[48px] font-black tabular-nums" style={{ color: phase === 'running' ? '#10B981' : 'var(--color-text-primary)' }}>
                {timeStr}
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {phase === 'running' ? t('cardio.tracking', 'Tracking...') : elapsed > 0 ? t('cardio.paused', 'Paused') : t('cardio.tapToStart', 'Tap to start')}
              </p>
            </div>

            {/* Controls */}
            <div className="flex justify-center gap-3 px-4 pb-4">
              <button
                onClick={handlePauseResume}
                className="px-8 py-3 rounded-2xl font-bold text-[14px] active:scale-[0.97] transition-transform"
                style={phase === 'running'
                  ? { backgroundColor: 'rgba(239,68,68,0.15)', color: '#EF4444' }
                  : { backgroundColor: '#10B981', color: '#fff' }
                }
              >
                {phase === 'running' ? t('cardio.pause', 'Pause') : elapsed > 0 ? t('cardio.resume', 'Resume') : t('cardio.start', 'Start')}
              </button>
              {elapsed > 10 && phase !== 'running' && (
                <button
                  onClick={handleFinish}
                  className="px-6 py-3 rounded-2xl font-bold text-[14px] active:scale-[0.97] transition-transform"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
                >
                  {t('cardio.finish', 'Finish')}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Done — show summary + distance/intensity */}
            <div className="text-center pb-3">
              <p className="text-[32px] font-black tabular-nums" style={{ color: '#10B981' }}>{timeStr}</p>
            </div>

            {/* Distance (optional) */}
            <div className="px-4 pb-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('cardio.distance', 'Distance')} ({t('cardio.optional', 'optional')})
              </label>
              <input
                type="number" inputMode="decimal" min="0" step="0.1" placeholder="0.0"
                value={distance} onChange={e => setDistance(e.target.value)}
                className="w-full border border-white/[0.06] rounded-xl px-3 py-2.5 outline-none"
                style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '16px' }}
              />
            </div>

            {/* Intensity */}
            <div className="px-4 pb-4">
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('cardio.intensity', 'Intensity')}
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {INTENSITIES.map(i => (
                  <button key={i} type="button" onClick={() => setIntensity(i)}
                    className="py-2 rounded-lg text-[10px] font-bold uppercase border transition-all"
                    style={intensity === i
                      ? { backgroundColor: `${INT_COLORS[i]}20`, borderColor: `${INT_COLORS[i]}50`, color: INT_COLORS[i] }
                      : { borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
                    }
                  >{t(`cardio.intensities.${i}`, i)}</button>
                ))}
              </div>
            </div>

            {/* Complete button */}
            <div className="px-4 pb-4">
              <button
                onClick={() => onComplete(Math.floor(accumRef.current))}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] active:scale-[0.97] transition-transform"
                style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
              >
                {t('activeSession.completeSet', 'Complete')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Skip */}
      <button
        onClick={onSkip}
        className="w-full mt-3 py-2 text-[12px] font-medium text-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {t('activeSession.skipExercise', 'Skip')}
      </button>
    </div>
  );
};

// ── Error Boundary ──────────────────────────────────────────────────────────
class ActiveSessionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('ActiveSession error boundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>Something went wrong.</p>
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>Your workout data has been saved locally.</p>
            <button
              onClick={() => window.history.back()}
              className="mt-4 px-6 py-3 rounded-2xl bg-[#D4AF37] text-black font-bold text-[14px]"
            >
              Go Back
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── PR Detection ──────────────────────────────────────────────────────────────
const epley1RM = (weight, reps) => {
  if (!weight || !reps || reps <= 0) return 0;
  // Use Brzycki formula for reps > 12 to avoid overestimation (Fix #26)
  if (reps > 12) return weight / (1.0278 - 0.0278 * reps);
  return weight * (1 + reps / 30);
};

const isPR = (exerciseId, weight, reps, knownPRs) => {
  const w = parseFloat(weight);
  const r = parseInt(reps, 10);
  if (!w || !r) return false;
  const pr = knownPRs[exerciseId];
  if (!pr) return true;
  return epley1RM(w, r) > epley1RM(pr.weight, pr.reps);
};

// ── PR Celebration Banner ─────────────────────────────────────────────────────
const PRBanner = ({ exercise, weight, reps, onDismiss, t }) => (
  <div className="fixed top-0 left-0 right-0 z-[200] animate-scale-pop" style={{ paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))' }}>
    <div className="bg-gradient-to-r from-amber-600 via-yellow-500 to-orange-500 px-5 py-5 shadow-2xl flex items-center gap-4 w-full" style={{ boxShadow: '0 8px 32px rgba(212, 175, 55, 0.4)' }}>
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20 flex-shrink-0"><Trophy size={28} className="text-white drop-shadow-lg" /></div>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-[17px] leading-tight text-white tracking-wide uppercase drop-shadow-sm">{t('activeSession.newPersonalRecord')}</p>
        <p className="text-[14px] text-white/90 mt-1 font-semibold truncate">{exercise} — {weight} lbs × {reps}</p>
      </div>
      <button onClick={onDismiss} aria-label="Dismiss" className="w-11 h-11 flex items-center justify-center text-white/70 hover:text-white text-[20px] leading-none ml-1 transition-colors duration-200 flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-full">×</button>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const ActiveSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();
  const { t, i18n } = useTranslation('pages');

  // ── Class booking context (when starting from a class template) ────────────
  const classBookingId = location.state?.classBookingId ?? null;
  const className = location.state?.className ?? null;

  // ── Check for conflicting active session ──────────────────────────────────
  const [conflictSession, setConflictSession] = useState(null);
  const [showConflict, setShowConflict] = useState(false);

  useEffect(() => {
    try {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('gym_session_')) continue;
        const otherId = key.replace('gym_session_', '');
        if (otherId === id) continue; // same session, not a conflict
        const data = JSON.parse(localStorage.getItem(key));
        if (data?.loggedSets && data?.startedAt && new Date(data.startedAt).getTime() > oneDayAgo) {
          setConflictSession({ routineId: otherId, routineName: data.routineName || 'Workout', key });
          setShowConflict(true);
          break;
        }
      }
    } catch { }
  }, [id]);

  const handleDiscardConflict = () => {
    if (conflictSession) {
      localStorage.removeItem(conflictSession.key);
      localStorage.removeItem(`gym_rest_${conflictSession.routineId}`);
      // Also clean up DB draft
      if (user?.id) {
        supabase.from('session_drafts').delete()
          .eq('profile_id', user.id).eq('routine_id', conflictSession.routineId)
          .then(() => {}).catch(() => {});
      }
    }
    setShowConflict(false);
    setConflictSession(null);
  };

  const handleResumeConflict = () => {
    if (conflictSession) {
      navigate(`/session/${conflictSession.routineId}`, { replace: true });
    }
  };

  // ── Check if this routine is scheduled for a different day ─────────────────
  const [wrongDayInfo, setWrongDayInfo] = useState(null);
  const [showWrongDay, setShowWrongDay] = useState(false);

  // Scroll locking for dialog overlays
  useEffect(() => {
    if (showConflict) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showConflict]);
  useEffect(() => {
    if (showWrongDay) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showWrongDay]);
  useEffect(() => {
    if (!user?.id || !id || IS_EMPTY_SESSION(id)) return;
    // Skip check if resuming an existing draft
    try {
      const existing = localStorage.getItem(`gym_session_${id}`);
      if (existing) return; // resuming — no warning needed
    } catch { }

    const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    supabase
      .from('workout_schedule')
      .select('day_of_week, routine_id')
      .eq('profile_id', user.id)
      .then(({ data: schedule }) => {
        if (!schedule?.length) return;
        const todayDow = new Date().getDay();
        const todaysRoutineId = schedule.find(s => s.day_of_week === todayDow)?.routine_id;
        const thisRoutineDay = schedule.find(s => s.routine_id === id);

        // If this routine is scheduled for a different day (and it's not today's routine)
        if (thisRoutineDay && thisRoutineDay.day_of_week !== todayDow && id !== todaysRoutineId) {
          setWrongDayInfo({
            scheduledDay: t(`days.${DAY_KEYS[thisRoutineDay.day_of_week]}`, { ns: 'common' }),
            todayDay: t(`days.${DAY_KEYS[todayDow]}`, { ns: 'common' }),
          });
          setShowWrongDay(true);
        }
      });
  }, [user?.id, id]);

  // ── Session persistence ─────────────────────────────────────────────────────
  const sessionKey = `gym_session_${id}`;
  const sessionEndedRef = useRef(false); // true when finished or discarded — prevents unmount re-save
  const [savedSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`gym_session_${id}`)) ?? null; }
    catch { return null; }
  });

  const [dataLoading, setDataLoading] = useState(true);
  const [routineName, setRoutineName] = useState('');
  const [exercises, setExercises]     = useState([]);
  const onboardingRef = useRef(null); // cached onboarding for intra-session suggestions

  // Warm-up phase: 'gate' (show splash), 'active' (doing warm-ups), 'done' (skipped or finished)
  const [warmUpPhase, setWarmUpPhase] = useState(() =>
    savedSession || IS_EMPTY_SESSION(id) ? 'done' : 'gate'
  );
  const [warmUpExercises, setWarmUpExercises] = useState([]);
  const [warmUpIndex, setWarmUpIndex] = useState(0);

  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(
    savedSession?.currentExerciseIndex ?? 0
  );
  const [isPaused, setIsPaused] = useState(savedSession?.isPaused ?? false);

  const startedAt = useRef(savedSession?.startedAt ?? new Date().toISOString());
  const [elapsedTime, setElapsedTime] = useState(savedSession?.elapsedTime ?? 0);

  // ── Rest timer state — persisted to localStorage so it survives iOS suspension
  const restStateKey = `gym_rest_${id}`;
  const savedRest = useRef(() => {
    try {
      const raw = localStorage.getItem(restStateKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Check if rest is still active
      if (parsed?.restStartedAt && parsed?.duration) {
        const elapsed = (Date.now() - parsed.restStartedAt) / 1000;
        if (elapsed < parsed.duration) return parsed;
      }
      // Expired — clean up
      localStorage.removeItem(restStateKey);
      return null;
    } catch { return null; }
  });
  const restoredRest = useRef(savedRest.current());

  const [isResting, setIsResting] = useState(() => !!restoredRest.current);
  const [currentRestDuration, setCurrentRestDuration] = useState(() =>
    restoredRest.current?.duration ?? 90
  );
  const [restTimer, setRestTimer] = useState(() => {
    if (!restoredRest.current) return 90;
    const elapsed = (Date.now() - restoredRest.current.restStartedAt) / 1000;
    return Math.max(0, Math.round(restoredRest.current.duration - elapsed));
  });
  const restStartedAt = useRef(restoredRest.current?.restStartedAt ?? null);
  const currentRestDurationRef = useRef(restoredRest.current?.duration ?? 90);

  const [showFinishModal, setShowFinishModal] = useState(false);
  const [workoutComplete, setWorkoutComplete] = useState(false);
  const [cooldownPhase, setCooldownPhase] = useState('none'); // none → active → done
  const [cooldownIndex, setCooldownIndex] = useState(0);
  const [saving, setSaving]                   = useState(false);
  const [saveError, setSaveError]             = useState('');

  const [activePRBanner, setActivePRBanner] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [sessionPRs, setSessionPRs]         = useState(savedSession?.sessionPRs ?? []);
  const livePRs = useRef({});
  // Always holds the latest state so beforeunload/visibilitychange can save without stale closures
  const saveRef = useRef(null);
  const lastTickAt = useRef(Date.now());
  const isPausedRef = useRef(savedSession?.isPaused ?? false);
  const draftSaveRef = useRef(null);

  const [loggedSets, setLoggedSets] = useState({});
  const [showResumedBanner, setShowResumedBanner] = useState(!!savedSession?.loggedSets);
  const [sessionRpe, setSessionRpe] = useState(null);
  const [sessionFeeling, setSessionFeeling] = useState(null);
  const [expandedNotesSet, setExpandedNotesSet] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showProgressChart, setShowProgressChart] = useState(null); // { exerciseId, exerciseName }
  const [sessionRating, setSessionRating] = useState(null);
  const [showPlateCalc, setShowPlateCalc] = useState(false);
  const [saveWarning, setSaveWarning] = useState('');
  const [error, setError] = useState(null);

  // ── Auto workout ender state ───────────────────────────────────────────────
  const [showAutoEndPrompt, setShowAutoEndPrompt] = useState(false);
  const autoEndPromptDismissed = useRef(false); // true once user taps "keep going"
  const autoEndTriggered = useRef(false); // prevents double-fire of auto-finish

  // ── Exercise Swap state ─────────────────────────────────────────────────────
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapSearch, setSwapSearch] = useState('');
  const [swapSelectedReason, setSwapSelectedReason] = useState(null);
  const [exerciseSwaps, setExerciseSwaps] = useState([]); // { original_exercise_id, new_exercise_id, reason }
  useEffect(() => {
    if (showSwapModal) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showSwapModal]);
  const [watchHeartRate, setWatchHeartRate] = useState(null); // { bpm, avgBPM, zone }
  const watchHRSummary = useRef(null); // { averageBPM, maxBPM, minBPM }
  const restNotificationScheduled = useRef(false);
  const handleFinishRef = useRef(null);
  const sessionStartTime = useRef(Date.now() - (savedSession?.elapsedTime ?? 0) * 1000);

  const touchStartXRef = useRef(0);

  // ── Notification permission ─────────────────────────────────────────────────
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // ── Save draft on unmount (navigating away without finishing) ──────────────
  useEffect(() => {
    return () => {
      // Don't re-save if the session was finished or discarded
      if (sessionEndedRef.current) return;
      // Persist the latest state to localStorage so re-entering resumes
      if (saveRef.current?.loggedSets && Object.keys(saveRef.current.loggedSets).length > 0) {
        try { localStorage.setItem(sessionKey, JSON.stringify(saveRef.current)); } catch { }
      }
      // Also fire a DB draft save
      if (draftSaveRef.current) {
        const payload = draftSaveRef.current;
        supabase.from('session_drafts')
          .upsert(payload, { onConflict: 'profile_id,routine_id' })
          .then(() => {})
          .catch(() => {});
      }
    };
  }, [sessionKey]);

  // ── Apple Watch message handler ────────────────────────────────────────────
  useEffect(() => {
    const unsub = onWatchMessage((msg) => {
      if (!msg?.action) return;
      switch (msg.action) {
        case 'complete_set': {
          const curEx = exercises[currentExerciseIndex];
          if (!curEx) return;
          const sets = loggedSets[curEx.id] || [];
          const idx = sets.findIndex(s => !s.completed);
          if (idx < 0) return;
          const weight = msg.actualWeight ? String(msg.actualWeight) : sets[idx].weight;
          const reps = msg.actualReps ? String(msg.actualReps) : sets[idx].reps;
          setLoggedSets(prev => {
            const updated = { ...prev, [curEx.id]: [...prev[curEx.id]] };
            updated[curEx.id][idx] = { ...updated[curEx.id][idx], weight, reps };
            return updated;
          });
          setTimeout(() => {
            handleToggleComplete(curEx.id, idx, exName(curEx), adjustedRestSeconds ?? curEx.restSeconds ?? 90);
          }, 50);
          break;
        }
        case 'skip_rest':
          setRestTimer(0);
          setIsResting(false);
          break;
        case 'end_workout':
          setShowFinishModal(true);
          break;
        case 'save_and_end':
          // Watch confirmed save — trigger finish directly without modal
          handleFinishRef.current?.();
          break;
        case 'submit_rpe':
          if (msg.rpe) setSessionRpe(msg.rpe);
          break;
        case 'heart_rate_update':
          setWatchHeartRate({ bpm: msg.bpm, avgBPM: msg.avgBPM, zone: msg.zone });
          break;
        case 'heart_rate_summary':
          watchHRSummary.current = { averageBPM: msg.averageBPM, maxBPM: msg.maxBPM, minBPM: msg.minBPM };
          break;
      }
    });
    return unsub;
  }, [exercises, currentExerciseIndex, loggedSets]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── State for empty workout mode (add exercise picker) ────────────────────
  const isEmptyMode = IS_EMPTY_SESSION(id);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState('');
  const [previewExercise, setPreviewExercise] = useState(null);
  const [adjustedRestSeconds, setAdjustedRestSeconds] = useState(null);
  // Favorites: user's own saved exercises are auto-favorites
  const [favoriteExerciseIds, setFavoriteExerciseIds] = useState(new Set());
  // DB exercises (with Spanish names) — fetched when modal opens
  const [dbExerciseMap, setDbExerciseMap] = useState({});
  useEffect(() => {
    if (!user?.id || !showAddExercise) return;
    Promise.all([
      supabase.from('exercise_favorites').select('exercise_id').eq('profile_id', user.id),
      supabase.from('exercises').select('id, name, name_es, muscle_group, equipment'),
    ]).then(([favRes, exRes]) => {
      if (favRes.data) setFavoriteExerciseIds(new Set(favRes.data.map(r => r.exercise_id)));
      if (exRes.data) {
        const map = {};
        exRes.data.forEach(e => { map[e.id] = e; });
        setDbExerciseMap(map);
      }
    });
  }, [user?.id, showAddExercise]);

  // Merge local exercises with DB Spanish names
  const enrichedLocalExercises = useMemo(() => {
    return localExercises.map(ex => {
      const db = dbExerciseMap[ex.id];
      return db ? { ...ex, name_es: db.name_es } : ex;
    });
  }, [dbExerciseMap]);

  const filteredLibraryExercises = useMemo(() => {
    if (!showAddExercise) return [];
    const q = exerciseSearch.toLowerCase().trim();
    const addedIds = new Set(exercises.map(e => e.id));
    return enrichedLocalExercises.filter(ex => {
      if (addedIds.has(ex.id)) return false;
      if (selectedMuscle && ex.muscle !== selectedMuscle) return false;
      if (selectedEquipment && ex.equipment !== selectedEquipment) return false;
      if (showFavoritesOnly && !favoriteExerciseIds.has(ex.id)) return false;
      if (q) {
        const name = (exName(ex) || ex.name).toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    }).slice(0, 50);
  }, [exerciseSearch, selectedMuscle, selectedEquipment, showAddExercise, exercises, showFavoritesOnly, favoriteExerciseIds, enrichedLocalExercises]);

  const handleAddExerciseToSession = (libEx) => {
    const newEx = {
      id:          libEx.id,
      name:        libEx.name,
      name_es:     libEx.name_es || null,
      targetSets:  libEx.defaultSets || 3,
      targetReps:  libEx.defaultReps ? parseInt(libEx.defaultReps, 10) || 10 : 10,
      restSeconds: 90,
      videoUrl:    libEx.videoUrl || null,
      instructions:    libEx.instructions || null,
      instructions_es: libEx.instructions_es || null,
      history:     [],
      suggestion:  null,
    };
    setExercises(prev => [...prev, newEx]);
    setLoggedSets(prev => ({
      ...prev,
      [libEx.id]: Array.from({ length: newEx.targetSets }).map(() => ({
        weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '',
      })),
    }));
    // If this is the first exercise added, navigate to it and start Live Activity
    if (exercises.length === 0) {
      setCurrentExerciseIndex(0);
      startLiveActivity({
        routineName,
        totalSets: newEx.targetSets,
        completedSets: 0,
        currentExerciseName: newEx.name,
        startTimestamp: sessionStartTime.current,
      }).catch(e => console.warn('[LiveActivity] start failed:', e));
    }
    setShowAddExercise(false);
    setExerciseSearch('');
    setSelectedMuscle('');
    setWorkoutComplete(false);
    // Navigate to the newly added exercise
    if (exercises.length > 0) {
      setCurrentExerciseIndex(exercises.length); // will be the new last index after state update
    }
  };

  // ── Load routine + prev session + PRs ──────────────────────────────────────
  useEffect(() => {
    if (!user || !profile) return;

    // Empty workout mode — restore from localStorage if resuming, else start fresh
    if (isEmptyMode) {
      setRoutineName(savedSession?.routineName || t('activeSession.emptyWorkout'));
      if (savedSession?.exercises?.length > 0) {
        // Resuming an in-progress empty workout
        setExercises(savedSession.exercises);
        setLoggedSets(savedSession.loggedSets || {});
        if (savedSession.sessionPRs) setSessionPRs(savedSession.sessionPRs);
        if (savedSession.livePRs) livePRs.current = savedSession.livePRs;
        if (savedSession.currentExerciseIndex != null) setCurrentExerciseIndex(savedSession.currentExerciseIndex);
        if (savedSession.elapsedTime) setElapsedTime(savedSession.elapsedTime);
        if (savedSession.startedAt) startedAt.current = savedSession.startedAt;
        setShowResumedBanner(true);
      } else {
        setExercises([]);
        setLoggedSets({});
      }
      setDataLoading(false);
      return;
    }

    const load = async () => {
      try {
      setDataLoading(true);

      const { data: routine, error: routineErr } = await supabase
        .from('routines')
        .select(`
          id, name,
          routine_exercises(
            exercise_id, position, target_sets, target_reps, rest_seconds, group_id, group_type,
            exercises(id, name, name_es, muscle_group, equipment, video_url, instructions, instructions_es)
          )
        `)
        .eq('id', id)
        .single();

      if (routineErr || !routine) { setDataLoading(false); return; }

      setRoutineName(localizeRoutineName(routine.name));

      const sortedExercises = (routine.routine_exercises || [])
        .sort((a, b) => a.position - b.position)
        .map(re => ({
          id:          re.exercise_id,
          name:        re.exercises?.name ?? re.exercise_id,
          name_es:     re.exercises?.name_es || null,
          targetSets:  re.target_sets,
          targetReps:  re.target_reps,
          restSeconds: re.rest_seconds,
          groupId:     re.group_id || null,
          groupType:   re.group_type || null,
          muscle:      re.exercises?.muscle_group || localExercises.find(e => e.id === re.exercise_id)?.muscle || null,
          videoUrl:    re.exercises?.video_url || null,
          instructions:    re.exercises?.instructions || null,
          instructions_es: re.exercises?.instructions_es || null,
          history:     [],
        }));

      setExercises(sortedExercises);

      // Select muscle-relevant warm-ups based on exercises in this routine
      if (warmUpPhase !== 'done') {
        const muscleGroups = [...new Set(sortedExercises.map(e => e.muscle).filter(Boolean))];
        setWarmUpExercises(selectWarmUps(muscleGroups));
      }

      const exerciseIds = sortedExercises.map(e => e.id);
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Fetch PRs, onboarding, last session, and DB draft in parallel (was 4 sequential queries)
      const [{ data: prs }, { data: onboarding }, { data: lastSessions }, { data: dbDraft }] = await Promise.all([
        supabase.from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm')
          .eq('profile_id', user.id)
          .in('exercise_id', exerciseIds),
        supabase.from('member_onboarding')
          .select('fitness_level, primary_goal, initial_weight_lbs, sex')
          .eq('profile_id', user.id)
          .maybeSingle(),
        supabase
          .from('workout_sessions')
          .select('id')
          .eq('profile_id', user.id)
          .eq('routine_id', id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1),
        supabase
          .from('session_drafts')
          .select('logged_sets, session_prs, live_prs, current_exercise_index, elapsed_time, started_at, is_paused')
          .eq('profile_id', user.id)
          .eq('routine_id', id)
          .gte('updated_at', cutoff)
          .maybeSingle(),
      ]);

      const prMap = {};
      prs?.forEach(pr => { prMap[pr.exercise_id] = { weight: pr.weight_lbs, reps: pr.reps }; });
      livePRs.current = prMap;
      onboardingRef.current = onboarding;

      const prevSetsMap = {};
      if (lastSessions?.length > 0) {
        const { data: prevExercises } = await supabase
          .from('session_exercises')
          .select(`exercise_id, session_sets(set_number, weight_lbs, reps, is_completed)`)
          .eq('session_id', lastSessions[0].id);

        prevExercises?.forEach(se => {
          prevSetsMap[se.exercise_id] = (se.session_sets || [])
            .filter(s => s.is_completed)
            .sort((a, b) => a.set_number - b.set_number)
            .map(s => ({ weight: s.weight_lbs, reps: s.reps }));
        });
      }

      const enriched = sortedExercises.map(ex => {
        const libEx = localExercises.find(e => e.id === ex.id);
        const exerciseMeta = libEx ? { movementPattern: libEx.movementPattern } : null;
        return {
        ...ex,
        movementPattern: libEx?.movementPattern || null,
        history:    prevSetsMap[ex.id] || [],
        suggestion: computeSuggestion(prevSetsMap[ex.id] || [], onboarding, ex.targetReps, 0, exerciseMeta),
        };
      });
      setExercises(enriched);

      // DB draft wins; fall back to localStorage if no DB draft
      const draft = dbDraft
        ? {
            loggedSets:            dbDraft.logged_sets,
            sessionPRs:            dbDraft.session_prs,
            livePRs:               dbDraft.live_prs,
            currentExerciseIndex:  dbDraft.current_exercise_index,
            elapsedTime:           dbDraft.elapsed_time,
            startedAt:             dbDraft.started_at,
            isPaused:              dbDraft.is_paused ?? false,
          }
        : savedSession
          ? {
              loggedSets:           savedSession.loggedSets,
              sessionPRs:           savedSession.sessionPRs,
              livePRs:              savedSession.livePRs,
              currentExerciseIndex: savedSession.currentExerciseIndex,
              elapsedTime:          savedSession.elapsedTime,
              startedAt:            savedSession.startedAt,
              isPaused:             savedSession.isPaused ?? false,
            }
          : null;

      // Check if draft exercises match the current routine — discard stale drafts
      const currentExerciseIds = new Set(enriched.map(ex => ex.id));
      const draftExerciseIds = draft?.loggedSets ? Object.keys(draft.loggedSets) : [];
      const draftMatchesRoutine = draftExerciseIds.length > 0 &&
        draftExerciseIds.some(eid => currentExerciseIds.has(eid));

      if (draft?.loggedSets && draftMatchesRoutine) {
        const restored = {};
        enriched.forEach(ex => {
          restored[ex.id] = draft.loggedSets[ex.id]?.map(s => ({
            weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '', ...s,
          })) ?? Array.from({ length: ex.targetSets }).map(() => ({
            weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '',
          }));
        });
        setLoggedSets(restored);
        if (draft.sessionPRs)           setSessionPRs(draft.sessionPRs);
        if (draft.livePRs)              livePRs.current = draft.livePRs;
        if (draft.currentExerciseIndex) setCurrentExerciseIndex(draft.currentExerciseIndex);
        if (draft.elapsedTime)          setElapsedTime(draft.elapsedTime);
        if (draft.startedAt)            startedAt.current = draft.startedAt;
        if (draft.isPaused) {
          setIsPaused(true);
          isPausedRef.current = true;
        }
        // Sync DB draft back to localStorage so fast local reads also work
        if (dbDraft) {
          try { localStorage.setItem(sessionKey, JSON.stringify(draft)); } catch { }
        }
      } else {
        // Draft is stale or doesn't exist — clear old drafts and start fresh
        if (draft && !draftMatchesRoutine) {
          try { localStorage.removeItem(sessionKey); } catch { }
          if (dbDraft) {
            supabase.from('session_drafts').delete()
              .eq('profile_id', user.id).eq('routine_id', id).then(() => {});
          }
        }
        const initialSets = {};
        enriched.forEach(ex => {
          initialSets[ex.id] = Array.from({ length: ex.targetSets }).map(() => ({
            weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '',
          }));
        });
        setLoggedSets(initialSets);
      }

      // Cache workout data for offline use
      try { cacheWorkoutData(id, { exercises: enriched, routineName: localizeRoutineName(routine.name) }); } catch { }

      setDataLoading(false);
      } catch (err) {
        console.error('ActiveSession load error:', err);
        // Attempt to recover from offline cache
        const cached = getCachedWorkoutData(id);
        if (cached?.exercises?.length) {
          setExercises(cached.exercises);
          setRoutineName(cached.routineName || '');
          const initialSets = {};
          cached.exercises.forEach(ex => {
            initialSets[ex.id] = Array.from({ length: ex.targetSets }).map(() => ({
              weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '',
            }));
          });
          setLoggedSets(initialSets);
          setDataLoading(false);
        } else {
          setError(err.message || 'Failed to load workout data.');
          setDataLoading(false);
        }
      }
    };

    load();
  }, [id, user, profile]);

  // ── Persistent lock-screen notification + Live Activity ─────────────────────
  useEffect(() => {
    if (dataLoading || !exercises.length) return;
    const cs = Object.values(loggedSets).flat().filter(s => s.completed).length;
    const ts = Object.values(loggedSets).flat().length;
    // Start Live Activity (lock screen + Dynamic Island) — iOS only
    startLiveActivity({
      routineName,
      totalSets: ts,
      completedSets: cs,
      currentExerciseName: exName(exercises[currentExerciseIndex]) ?? '',
      startTimestamp: sessionStartTime.current,
    }).then(() => {
      console.log('[LiveActivity] started — skipping fallback notification');
    }).catch(e => {
      console.warn('[LiveActivity] start failed, using notification fallback:', e);
      // Only use notification fallback if Live Activity failed
      if (ts > 0) startWorkoutNotification(sessionStartTime.current, cs, ts);
    });
  }, [dataLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dataLoading) return;
    const cs = Object.values(loggedSets).flat().filter(s => s.completed).length;
    const ts = Object.values(loggedSets).flat().length;
    if (ts === 0) return; // Don't update with empty state

    // Guard against race condition: if restStartedAt is set but isResting hasn't
    // updated yet (React state is async), skip this update to avoid briefly showing
    // "LOG NEXT SET" before the rest countdown appears on the Live Activity.
    if (!isResting && restStartedAt.current) {
      const restElapsed = (Date.now() - restStartedAt.current) / 1000;
      if (restElapsed < currentRestDurationRef.current) {
        return; // Rest was just started but isResting state hasn't caught up yet
      }
    }

    try {
      const now = Math.floor((Date.now() - sessionStartTime.current) / 1000);
      const curEx = exercises[currentExerciseIndex];
      const curExSets = curEx ? (loggedSets[curEx.id] || []) : [];
      const curExDone = curExSets.filter(s => s.completed).length;
      const curExTotal = curExSets.length;
      const exLabel = curEx ? `${exName(curEx)} ${curExDone}/${curExTotal}` : '';
      updateLiveActivity({
        elapsedSeconds: now,
        completedSets: cs,
        totalSets: ts,
        currentExerciseName: exLabel,
        isResting,
        restRemainingSeconds: isResting && restStartedAt.current
          ? Math.max(0, Math.ceil((restStartedAt.current + currentRestDurationRef.current * 1000 - Date.now()) / 1000))
          : 0,
      });
      // Sync to Apple Watch — send actual set weight/reps if available
      const watchSetIdx = curEx ? (loggedSets[curEx.id] || []).findIndex(s => !s.completed) : -1;
      const watchActiveSet = watchSetIdx >= 0 ? loggedSets[curEx.id][watchSetIdx] : null;
      const watchRestRemaining = isResting && restStartedAt.current
        ? Math.max(0, Math.ceil((restStartedAt.current + currentRestDurationRef.current * 1000 - Date.now()) / 1000))
        : 0;
      syncWorkoutToWatch({
        exerciseName: exName(curEx) ?? '',
        setNumber: curExDone + 1,
        totalSets: ts,
        suggestedWeight: watchActiveSet?.weight ? Number(watchActiveSet.weight) : (curEx?.suggestedWeight ?? 0),
        suggestedReps: watchActiveSet?.reps ? Number(watchActiveSet.reps) : (curEx?.suggestedReps ?? 0),
        restSeconds: curEx?.rest_seconds ?? 90,
        isResting,
        elapsedSeconds: now,
        exerciseCategory: curEx?.category || curEx?.muscle_group || 'unknown',
        restRemainingSeconds: watchRestRemaining,
      });
    } catch (e) { console.warn('Live Activity update failed:', e); }
  }, [loggedSets, dataLoading, isResting, restTimer, currentExerciseIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session timer — pauses when isPaused, drift-free via Date.now() ─────────
  useEffect(() => {
    if (isPaused) return;
    // Anchor the start time so elapsed = (now - startTime) / 1000
    sessionStartTime.current = Date.now() - elapsedTime * 1000;
    lastTickAt.current = Date.now();
    const interval = setInterval(() => {
      lastTickAt.current = Date.now();
      setElapsedTime(Math.floor((Date.now() - sessionStartTime.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto workout ender — 2h prompt, 3h hard stop ──────────────────────────
  const TWO_HOURS = 2 * 60 * 60;
  const THREE_HOURS = 3 * 60 * 60;

  useEffect(() => {
    if (showAutoEndPrompt) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showAutoEndPrompt]);

  useEffect(() => {
    if (dataLoading) return;
    // Check every 10 seconds using drift-free elapsed calculation
    const check = setInterval(() => {
      const now = Math.floor((Date.now() - sessionStartTime.current) / 1000);

      // 3-hour hard stop — auto-finish regardless
      if (now >= THREE_HOURS && !autoEndTriggered.current) {
        autoEndTriggered.current = true;
        setShowAutoEndPrompt(false);
        handleFinishRef.current?.();
        return;
      }

      // 2-hour prompt — only if not already dismissed and not already showing
      if (now >= TWO_HOURS && !autoEndPromptDismissed.current && !showAutoEndPrompt && !autoEndTriggered.current) {
        setShowAutoEndPrompt(true);
      }
    }, 10_000);
    return () => clearInterval(check);
  }, [dataLoading, showAutoEndPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep refs in sync (synchronous, never stale) ───────────────────────────
  isPausedRef.current = isPaused;
  currentRestDurationRef.current = currentRestDuration;
  // Always update saveRef so visibilitychange/beforeunload never uses stale data
  saveRef.current = {
    startedAt: startedAt.current,
    elapsedTime,
    loggedSets,
    sessionPRs,
    livePRs: livePRs.current,
    currentExerciseIndex,
    routineName,
    exerciseSwaps,
    isPaused,
    ...(isEmptyMode && { exercises }), // Save exercises for empty mode restore
  };
  if (!dataLoading && user && profile && !isEmptyMode) {
    draftSaveRef.current = {
      profile_id: user.id,
      gym_id: profile.gym_id,
      routine_id: id,
      routine_name: routineName,
      started_at: startedAt.current,
      elapsed_time: elapsedTime,
      logged_sets: loggedSets,
      session_prs: sessionPRs,
      live_prs: livePRs.current,
      current_exercise_index: currentExerciseIndex,
      is_paused: isPaused,
      updated_at: new Date().toISOString(),
    };
  }

  // ── Save draft to DB (fire-and-forget) ──────────────────────────────────────
  const saveDraftToDb = async (overrideLoggedSets = null) => {
    if (!draftSaveRef.current) return;
    const payload = overrideLoggedSets
      ? { ...draftSaveRef.current, logged_sets: overrideLoggedSets }
      : draftSaveRef.current;
    try {
      await supabase.from('session_drafts')
        .upsert(payload, { onConflict: 'profile_id,routine_id' });
    } catch (err) {
      console.warn('Draft save failed:', err);
      setSaveWarning('Draft save failed — your data is still saved locally.');
      setTimeout(() => setSaveWarning(''), 3000);
    }
  };

  // ── Persist to localStorage ─────────────────────────────────────────────────
  useEffect(() => {
    if (dataLoading) return;
    try {
      localStorage.setItem(sessionKey, JSON.stringify({
        startedAt: startedAt.current,
        elapsedTime,
        loggedSets,
        sessionPRs,
        livePRs: livePRs.current,
        currentExerciseIndex,
        routineName,
        ...(isEmptyMode && { exercises }), // Persist exercises for empty mode
      }));
    } catch { }
  }, [loggedSets, sessionPRs, dataLoading, sessionKey, currentExerciseIndex, elapsedTime, routineName, exercises, isEmptyMode]);

  // ── Force-save on browser close or tab switch to background ─────────────────
  useEffect(() => {
    const forceSave = () => {
      if (saveRef.current && saveRef.current.loggedSets && Object.keys(saveRef.current.loggedSets).length > 0) {
        try { localStorage.setItem(sessionKey, JSON.stringify(saveRef.current)); } catch { }
      }
    };
    const onForeground = () => {
      // App returned to foreground — catch up elapsed workout time
      if (!isPausedRef.current) {
        const gapSeconds = Math.floor((Date.now() - lastTickAt.current) / 1000);
        if (gapSeconds > 1) {
          setElapsedTime(prev => prev + gapSeconds);
          lastTickAt.current = Date.now();
        }
      }
      // Catch up rest timer — read from localStorage (source of truth, survives suspension)
      try {
        const raw = localStorage.getItem(`gym_rest_${id}`);
        if (raw) {
          const { restStartedAt: rsa, duration } = JSON.parse(raw);
          const elapsedRest = (Date.now() - rsa) / 1000;
          const remaining = Math.round(duration - elapsedRest);
          restStartedAt.current = rsa;
          currentRestDurationRef.current = duration;
          if (remaining <= 0) {
            setRestTimer(0);
            setIsResting(false);
            restStartedAt.current = null;
            localStorage.removeItem(`gym_rest_${id}`);
            window.scrollTo(0, 0);
          } else {
            setRestTimer(remaining);
            setIsResting(true);
          }
        }
      } catch { }
    };
    const onBackground = () => {
      forceSave();
      if (draftSaveRef.current) saveDraftToDb();
    };

    // Web fallback
    const onVisibility = () => {
      if (document.hidden) onBackground();
      else onForeground();
    };
    window.addEventListener('beforeunload', forceSave);
    document.addEventListener('visibilitychange', onVisibility);

    // iOS/Android native: use Capacitor App plugin (visibilitychange is unreliable on iOS)
    let appStateCleanup = null;
    if (window.Capacitor?.isNativePlatform?.()) {
      import('@capacitor/app').then(({ App: CapApp }) => {
        const listener = CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) onForeground();
          else onBackground();
        });
        appStateCleanup = listener;
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener('beforeunload', forceSave);
      document.removeEventListener('visibilitychange', onVisibility);
      if (appStateCleanup?.remove) appStateCleanup.remove();
    };
  }, [sessionKey]);

  // ── Rest timer — timestamp-based so it survives app backgrounding ────────────
  useEffect(() => {
    if (!isResting || isPaused) return;
    // Schedule OS-level notification once when rest begins
    if (!restNotificationScheduled.current) {
      restNotificationScheduled.current = true;
      if (!restStartedAt.current) restStartedAt.current = Date.now();
      scheduleRestDoneNotification(
        exName(exercises[currentExerciseIndex]) ?? 'exercise',
        restTimer
      );
    }
    if (restTimer <= 0) {
      setIsResting(false);
      restStartedAt.current = null;
      try { localStorage.removeItem(restStateKey); } catch { }
      // Haptic feedback when rest completes (vibration pattern: buzz-pause-buzz-pause-buzz)
      try { navigator.vibrate?.([200, 100, 200, 100, 200]); } catch { }
      window.scrollTo(0, 0);
      return;
    }
    // Tick every second — always recalculate from anchor timestamp (drift-proof)
    const interval = setInterval(() => {
      if (!restStartedAt.current) return;
      const elapsed = Math.floor((Date.now() - restStartedAt.current) / 1000);
      const remaining = Math.max(0, currentRestDurationRef.current - elapsed);
      setRestTimer(remaining);
    }, 500); // 500ms for snappier recovery after background
    return () => clearInterval(interval);
  }, [isResting, restTimer, isPaused, exercises, currentExerciseIndex, restStateKey]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const handleRemoveSet = (exerciseId, setIndex) => {
    setLoggedSets(prev => {
      const current = prev[exerciseId] || [];
      if (current.length <= 1) return prev; // keep at least 1 set
      const updated = current.filter((_, i) => i !== setIndex);
      return { ...prev, [exerciseId]: updated };
    });
  };

  const totalVolume = Object.entries(loggedSets).reduce((sum, [, sets]) =>
    sum + sets.filter(s => s.completed).reduce((s2, set) =>
      s2 + (parseFloat(set.weight) || 0) * (parseInt(set.reps, 10) || 0), 0)
  , 0);

  const completedSets = Object.values(loggedSets).flat().filter(s => s.completed).length;
  const totalSets     = Object.values(loggedSets).flat().length;

  // ── Derive worked muscle regions from completed sets ────────────────────────
  const workedRegions = useMemo(() => {
    const primary   = new Set();
    const secondary = new Set();
    exercises.forEach(ex => {
      const sets = loggedSets[ex.id] || [];
      if (!sets.some(s => s.completed)) return;
      const local = localExercises.find(e => e.id === ex.id);
      if (!local) return;
      (local.primaryRegions   || []).forEach(r => primary.add(r));
      (local.secondaryRegions || []).forEach(r => secondary.add(r));
    });
    return { primary: [...primary], secondary: [...secondary] };
  }, [exercises, loggedSets]);

  const handleUpdateSet = (exerciseId, setIndex, field, value) => {
    // Auto-dismiss resumed banner on first user interaction
    if (showResumedBanner) setShowResumedBanner(false);
    let val = value;
    if (field === 'weight' || field === 'reps') {
      const n = field === 'reps' ? parseInt(value, 10) : parseFloat(value);
      if (value !== '' && value !== '-' && !isNaN(n) && n < 0) val = '0';
    }
    setLoggedSets(prev => {
      const updated = { ...prev, [exerciseId]: [...prev[exerciseId]] };
      updated[exerciseId][setIndex] = { ...updated[exerciseId][setIndex], [field]: val };
      return updated;
    });
  };

  const handleToggleComplete = (exerciseId, setIndex, exerciseName, restSeconds) => {
    if (showResumedBanner) setShowResumedBanner(false);
    setLoggedSets(prev => {
      const updated = { ...prev, [exerciseId]: [...prev[exerciseId]] };
      const set = { ...updated[exerciseId][setIndex] };
      const completing = !set.completed;
      set.completed = completing;

      if (completing) {
        const prDetected = isPR(exerciseId, set.weight, set.reps, livePRs.current);
        set.isPR = prDetected;

        if (prDetected) {
          const newPR = { weight: parseFloat(set.weight), reps: parseInt(set.reps, 10) };
          livePRs.current = { ...livePRs.current, [exerciseId]: newPR };
          const prEntry = { exerciseId, exercise: exerciseName, ...newPR };
          setSessionPRs(s => [...s.filter(p => p.exerciseId !== exerciseId), prEntry]);
          setActivePRBanner(prEntry);
          setShowConfetti(true);
          setTimeout(() => setActivePRBanner(null), 4000);
        }

        // Check if this was the last set — if so, skip rest and auto-finish
        const allSets = Object.values(updated).flat();
        const nowCompleted = allSets.filter(s => s.completed).length;
        const isLastSet = nowCompleted >= allSets.length;

        if (!isLastSet) {
          // ── Superset/circuit logic: skip rest if there's a next exercise in the group ──
          const curEx = exercises.find(e => e.id === exerciseId);
          const groupId = curEx?.groupId;
          if (groupId) {
            const groupExercises = exercises.filter(e => e.groupId === groupId);
            const curGroupIdx = groupExercises.findIndex(e => e.id === exerciseId);
            const isLastInGroup = curGroupIdx === groupExercises.length - 1;

            if (!isLastInGroup) {
              // Move to next exercise in the group WITHOUT rest
              const nextGroupEx = groupExercises[curGroupIdx + 1];
              const nextIdx = exercises.findIndex(e => e.id === nextGroupEx.id);
              if (nextIdx >= 0) {
                setTimeout(() => setCurrentExerciseIndex(nextIdx), 50);
              }
            } else {
              // Last exercise in group — rest, then go back to first exercise in group for next round
              setCurrentRestDuration(restSeconds);
              setRestTimer(restSeconds);
              restNotificationScheduled.current = false;
              restStartedAt.current = Date.now();
              currentRestDurationRef.current = restSeconds;
              try {
                localStorage.setItem(restStateKey, JSON.stringify({
                  restStartedAt: Date.now(),
                  duration: restSeconds,
                }));
              } catch { }
              setIsResting(true);
              // After rest, navigate back to first exercise in group that still has incomplete sets
              const firstWithSets = groupExercises.find(ge => {
                const sets = updated[ge.id] || [];
                return sets.some(s => !s.completed);
              });
              if (firstWithSets) {
                const firstIdx = exercises.findIndex(e => e.id === firstWithSets.id);
                if (firstIdx >= 0) setTimeout(() => setCurrentExerciseIndex(firstIdx), 50);
              } else {
                // All group sets complete — move to next non-group exercise
                const lastGroupExIdx = exercises.findIndex(e => e.id === groupExercises[groupExercises.length - 1].id);
                if (lastGroupExIdx < exercises.length - 1) {
                  setTimeout(() => setCurrentExerciseIndex(lastGroupExIdx + 1), 50);
                }
              }
            }
          } else {
            // Normal (non-grouped) exercise — trigger rest as usual
            setCurrentRestDuration(restSeconds);
            setRestTimer(restSeconds);
            restNotificationScheduled.current = false;
            restStartedAt.current = Date.now();
            currentRestDurationRef.current = restSeconds;
            try {
              localStorage.setItem(restStateKey, JSON.stringify({
                restStartedAt: Date.now(),
                duration: restSeconds,
              }));
            } catch { }
            setIsResting(true);
          }
        } else {
          // Last set — trigger finish after state updates
          setTimeout(() => handleFinish(), 100);
        }
      } else {
        set.isPR = false;
      }

      updated[exerciseId][setIndex] = set;

      // ── Intra-session progressive overload: update suggestion for next set ──
      if (completing) {
        const completedSetsThisSession = updated[exerciseId]
          .filter(s => s.completed && s.weight && s.reps)
          .map(s => ({ weight: parseFloat(s.weight), reps: parseInt(s.reps, 10) }));

        const curExForSuggestion = exercises.find(e => e.id === exerciseId);
        const intraResult = computeIntraSessionSuggestion(
          completedSetsThisSession,
          onboardingRef.current,
          curExForSuggestion?.targetReps,
          curExForSuggestion?.movementPattern,
        );

        if (intraResult) {
          // Update the exercise's suggestion for the next set
          setTimeout(() => {
            setExercises(prev => prev.map(ex =>
              ex.id === exerciseId ? { ...ex, suggestion: intraResult } : ex
            ));
          }, 0);
        }
      }

      // Immediately persist — bypasses the React render cycle race condition
      // (visibilitychange can fire before the next render updates saveRef)
      try {
        localStorage.setItem(sessionKey, JSON.stringify({ ...saveRef.current, loggedSets: updated }));
      } catch { }
      saveDraftToDb(updated); // fire-and-forget DB save

      return updated;
    });
  };

  const handleAddSet = (exerciseId) => {
    const exercise = exercises.find(e => e.id === exerciseId);
    const currentSetsForEx = loggedSets[exerciseId] || [];
    const newSetIndex = currentSetsForEx.length;

    // Try history entry at same index, then last history entry, then last completed set
    const histEntry = exercise?.history?.[newSetIndex] ?? exercise?.history?.[exercise.history.length - 1] ?? null;
    let lastCompleted = null;
    for (let i = currentSetsForEx.length - 1; i >= 0; i--) {
      if (currentSetsForEx[i]?.completed && currentSetsForEx[i].weight && currentSetsForEx[i].reps) {
        lastCompleted = currentSetsForEx[i];
        break;
      }
    }
    const source = histEntry || lastCompleted;

    setLoggedSets(prev => ({
      ...prev,
      [exerciseId]: [
        ...prev[exerciseId],
        {
          weight: source ? String(source.weight ?? '') : '',
          reps: source ? String(source.reps ?? '') : '',
          completed: false, isPR: false, rpe: null, notes: '',
        },
      ],
    }));
  };

  const handleDuplicateLastSet = (exerciseId, setIndex, historyForExercise) => {
    setLoggedSets(prev => {
      const current = prev[exerciseId] || [];
      if (!current.length) return prev;
      // Find last completed set before this index
      let source = null;
      for (let i = setIndex - 1; i >= 0; i--) {
        if (current[i]?.completed && current[i].weight && current[i].reps) {
          source = current[i];
          break;
        }
      }
      // Fall back to previous session history
      if (!source && historyForExercise?.length) {
        source = historyForExercise[Math.min(setIndex, historyForExercise.length - 1)];
      }
      if (!source) return prev;
      const updated = { ...prev, [exerciseId]: [...current] };
      updated[exerciseId][setIndex] = {
        ...updated[exerciseId][setIndex],
        weight: String(source.weight ?? ''),
        reps: String(source.reps ?? ''),
      };
      return updated;
    });
  };

  // Fill all incomplete sets with the engine's suggestion
  const handleFillSuggestion = (exerciseId, suggestion) => {
    if (!suggestion?.suggestedWeight) return;
    setLoggedSets(prev => ({
      ...prev,
      [exerciseId]: prev[exerciseId].map(s =>
        s.completed ? s : {
          ...s,
          weight: String(suggestion.suggestedWeight),
          reps:   String(suggestion.suggestedReps),
        }
      ),
    }));
  };

  // ── Exercise Swap ──────────────────────────────────────────────────────────
  const swapTargetExercise = showSwapModal ? exercises[currentExerciseIndex] : null;
  const swapTargetMuscle = useMemo(() => {
    if (!swapTargetExercise) return '';
    const local = localExercises.find(e => e.id === swapTargetExercise.id);
    return local?.muscle || '';
  }, [swapTargetExercise]);

  const filteredSwapExercises = useMemo(() => {
    if (!showSwapModal || !swapTargetExercise) return [];
    const q = swapSearch.toLowerCase().trim();
    const currentIds = new Set(exercises.map(e => e.id));
    return localExercises.filter(ex => {
      if (currentIds.has(ex.id)) return false; // already in session
      if (swapTargetMuscle && ex.muscle !== swapTargetMuscle) return false;
      if (q && !ex.name.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 50);
  }, [showSwapModal, swapSearch, swapTargetExercise, swapTargetMuscle, exercises]);

  const handleSwapExercise = (newLibEx) => {
    if (!swapTargetExercise) return;
    const oldExId = swapTargetExercise.id;
    const reason = swapSelectedReason || null;

    // Build the new exercise object (same shape as existing ones)
    const newEx = {
      id:          newLibEx.id,
      name:        newLibEx.name,
      name_es:     newLibEx.name_es || null,
      targetSets:  swapTargetExercise.targetSets,
      targetReps:  swapTargetExercise.targetReps,
      restSeconds: swapTargetExercise.restSeconds,
      videoUrl:    newLibEx.videoUrl || null,
      instructions:    newLibEx.instructions || null,
      instructions_es: newLibEx.instructions_es || null,
      history:     [],
      suggestion:  null, // clear progressive overload — will be recalculated if needed
    };

    // Replace exercise in the exercises array at the same position
    setExercises(prev => prev.map((ex, i) =>
      i === currentExerciseIndex ? newEx : ex
    ));

    // Transfer existing sets to the new exercise (keep any already-logged sets)
    setLoggedSets(prev => {
      const existingSets = prev[oldExId] || [];
      const updated = { ...prev };
      delete updated[oldExId];
      // Keep logged sets structure but clear suggestion-based prefills on incomplete sets
      updated[newLibEx.id] = existingSets.map(s =>
        s.completed ? s : { ...s, weight: '', reps: '' }
      );
      return updated;
    });

    // Log the swap for session summary
    setExerciseSwaps(prev => [...prev, {
      original_exercise_id: oldExId,
      original_exercise_name: exName(swapTargetExercise),
      new_exercise_id: newLibEx.id,
      new_exercise_name: newLibEx.name,
      reason,
    }]);

    // Close modal and reset state
    setShowSwapModal(false);
    setSwapSearch('');
    setSwapSelectedReason(null);
  };

  const handleFinish = async () => {
    setSaving(true);
    setSaveError('');

    try {
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const payload = {
        routine_id: isEmptyMode ? null : id,
        routine_name: routineName,
        started_at: startedAt.current,
        completed_at: now.toISOString(),
        local_date: localDate,
        duration_seconds: elapsedTime,
        total_volume_lbs: totalVolume,
        completed_sets: completedSets,
        exercises: exercises.filter(ex => (loggedSets[ex.id] || []).some(s => s.completed)).map((exercise, pos) => ({
          exercise_id: exercise.id,
          name: exercise.name,
          position: pos + 1,
          suggested_weight: exercise.suggestion?.suggestedWeight ?? null,
          suggested_reps: exercise.suggestion?.suggestedReps ?? null,
          sets: (loggedSets[exercise.id] || []).filter(s => s.completed).map((set, i) => ({
            weight: parseFloat(set.weight) || 0,
            reps: parseInt(set.reps, 10) || 0,
            is_pr: set.isPR || false,
            rpe: set.rpe ?? null,
            notes: set.notes || null,
          })),
        })),
        session_prs: sessionPRs.map(pr => ({
          exercise_id: pr.exerciseId,
          exercise_name: pr.exercise,
          weight: pr.weight,
          reps: pr.reps,
        })),
        exercise_swaps: exerciseSwaps.length > 0 ? exerciseSwaps : undefined,
      };

      const { data: result, error: rpcError } = await supabase.rpc('complete_workout', { p_payload: payload });
      if (rpcError) throw rpcError;

      sessionEndedRef.current = true;
      localStorage.removeItem(sessionKey);
      // Also clear DB draft
      supabase.from('session_drafts').delete()
        .eq('profile_id', user.id).eq('routine_id', id).then(() => {}).catch(() => {});
      cancelWorkoutNotification();
      endLiveActivity({ elapsedSeconds: elapsedTime, completedSets, totalSets });
      syncWorkoutEnded({ duration: elapsedTime, totalVolume, prsHit: sessionPRs.length, setsCompleted: completedSets });

      // Link completed session to class booking so instructors see member results
      if (classBookingId && result?.session_id) {
        supabase.rpc('link_class_workout', {
          p_booking_id: classBookingId,
          p_session_id: result.session_id,
        }).catch((err) => console.warn('Failed to link class booking:', err));
      }

      navigate('/session-summary', {
        replace: true,
        state: {
          routineName, elapsedTime, totalVolume, completedSets,
          totalSets,
          totalExercises: Object.values(loggedSets).filter(sets => sets.some(s => s.completed)).length, sessionPRs, exerciseSwaps,
          completedAt: new Date().toISOString(),
          xpEarned: result.xp_earned,
          sessionId: result.session_id,
          streak: result.streak,
          heartRate: watchHRSummary.current || (watchHeartRate ? { averageBPM: watchHeartRate.avgBPM, maxBPM: watchHeartRate.bpm, minBPM: 0 } : null),
          workedMuscleGroups: [...new Set(exercises.filter(ex => (loggedSets[ex.id] || []).some(s => s.completed)).map(ex => ex.muscle).filter(Boolean))],
        },
      });
    } catch (err) {
      setSaveError(err.message || 'Something went wrong saving your workout.');
      setSaving(false);
    }
  };
  handleFinishRef.current = handleFinish;

  // ── Error screen ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>Failed to load workout</p>
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-6 py-3 rounded-2xl bg-[#D4AF37] text-black font-bold text-[15px]"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // ── Loading screen ──────────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--color-bg-card)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-amber-700 border-t-amber-400 rounded-full animate-spin" />
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>Loading workout…</p>
        </div>
      </div>
    );
  }

  // Guard against out-of-bounds index (Fix #2) — skip for empty mode
  if (!isEmptyMode && (currentExerciseIndex < 0 || currentExerciseIndex >= exercises.length)) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>No exercises found</p>
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>This workout may have been modified.</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-6 py-3 rounded-2xl bg-[#D4AF37] text-black font-bold text-[15px]"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // ── Warm-up gate page (only show after exercises loaded AND warm-ups selected) ──
  if (warmUpPhase === 'gate' && !dataLoading && warmUpExercises.length > 0) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: 'var(--color-bg-primary)', paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))' }}>
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          {/* Icon */}
          <div className="w-24 h-24 rounded-[28px] flex items-center justify-center mb-8" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.08))' }}>
            <span className="text-[44px]">🔥</span>
          </div>

          {/* Title */}
          <h2 className="text-[28px] font-black tracking-tight mb-3" style={{ color: 'var(--color-text-primary)' }}>
            {t('activeSession.warmUpReady', 'Warm Up')}
          </h2>

          {/* Subtitle */}
          <p className="text-[15px] leading-relaxed max-w-[280px] text-center" style={{ color: 'var(--color-text-muted)' }}>
            {t('activeSession.warmUpDesc2', { count: warmUpExercises.length, defaultValue: `${warmUpExercises.length} exercises to get your muscles ready` })}
          </p>

          {/* Exercise list preview */}
          <div className="w-full max-w-xs mt-8 space-y-2">
            {warmUpExercises.map((wu, idx) => (
              <div key={wu.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                <span className="text-[14px] font-bold tabular-nums w-5 text-right" style={{ color: 'var(--color-text-subtle)' }}>{idx + 1}</span>
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {i18n.language === 'es' && wu.name_es ? wu.name_es : wu.name}
                </span>
                <span className="ml-auto text-[12px] tabular-nums" style={{ color: 'var(--color-text-subtle)' }}>{wu.durationSec}s</span>
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="w-full px-6 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] space-y-3">
          <button
            onClick={() => { setWarmUpPhase('active'); setWarmUpIndex(0); }}
            className="w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.97] transition-transform"
            style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
          >
            {t('activeSession.enterWarmUp', 'Start Warm-Up')}
          </button>
          <button
            onClick={() => setWarmUpPhase('done')}
            className="w-full py-3 rounded-2xl font-semibold text-[13px] transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('activeSession.skipWarmUp', 'Skip')}
          </button>
        </div>
      </div>
    );
  }

  // If we reach here while still in gate (no warm-ups available), treat as done
  const isInWarmUp = warmUpPhase === 'active';
  const currentExercise = exercises[currentExerciseIndex];
  const currentSets     = currentExercise ? (loggedSets[currentExercise.id] || []) : [];
  const knownPR         = currentExercise ? livePRs.current[currentExercise.id] : null;

  // Detect if current exercise is a cardio exercise (timer-based, no weight)
  const currentLocalExForCardio = currentExercise ? localExercises.find(e => e.id === currentExercise.id) : null;
  const isCurrentCardio = currentLocalExForCardio?.isCardio || currentLocalExForCardio?.category === 'Cardio' || currentLocalExForCardio?.muscle === 'Cardio';

  // ── Derived: is current set ready to complete? ─────────────────────────────
  const activeSetIndex = currentSets.findIndex(s => !s.completed);
  const activeSet = activeSetIndex >= 0 ? currentSets[activeSetIndex] : null;
  const allSetsComplete = activeSetIndex === -1;
  const hasNextExercise = currentExerciseIndex < exercises.length - 1;
  // Bodyweight exercises (pull-ups, dips, etc.) do not require a weight to complete a set
  const currentLocalEx = currentExercise ? localExercises.find(e => e.id === currentExercise.id) : null;
  const isCurrentBodyweight = currentLocalEx?.equipment === 'Bodyweight';
  const canComplete = activeSet
    && activeSet.reps
    && !isNaN(Number(activeSet.reps)) && Number(activeSet.reps) > 0
    && (isCurrentBodyweight
      ? (activeSet.weight === '' || activeSet.weight === '0' || (!isNaN(Number(activeSet.weight)) && Number(activeSet.weight) >= 0))
      : (activeSet.weight && !isNaN(Number(activeSet.weight)) && Number(activeSet.weight) > 0));
  const handleCompleteSet = () => {
    if (!canComplete || !currentExercise) return;
    handleToggleComplete(
      currentExercise.id,
      activeSetIndex,
      exName(currentExercise),
      adjustedRestSeconds ?? currentExercise.restSeconds ?? 90
    );
  };

  const handleNext = () => {
    if (hasNextExercise) {
      // If current exercise is in a group, skip to the first exercise after the entire group
      const curEx = exercises[currentExerciseIndex];
      if (curEx?.groupId) {
        const lastGroupIdx = exercises.reduce((last, ex, idx) => ex.groupId === curEx.groupId ? idx : last, currentExerciseIndex);
        if (lastGroupIdx < exercises.length - 1) {
          setCurrentExerciseIndex(lastGroupIdx + 1);
        } else {
          setWorkoutComplete(true);
        }
      } else {
        setCurrentExerciseIndex(currentExerciseIndex + 1);
      }
    } else {
      setWorkoutComplete(true);
    }
  };

  // ── Skip/remove exercise from current session ──────────────────────────────
  const handleSkipExercise = () => {
    // Skip just advances to the next exercise without removing it
    if (currentExerciseIndex < exercises.length - 1) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
    } else {
      setWorkoutComplete(true);
    }
  };

  const handleRemoveExercise = () => {
    // Remove exercise from session (doesn't delete from routine)
    if (exercises.length <= 1) {
      setWorkoutComplete(true);
      return;
    }
    const idx = currentExerciseIndex;
    setExercises(prev => prev.filter((_, i) => i !== idx));
    if (idx >= exercises.length - 1) {
      setCurrentExerciseIndex(Math.max(0, idx - 1));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex flex-col font-sans animate-fade-in" style={{ background: 'var(--color-bg-primary)' }}>

      {/* Conflict dialog — another workout is already running */}
      {showConflict && conflictSession && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="dialog" aria-labelledby="conflict-dialog-title">
          <div className="rounded-[20px] w-full max-w-sm p-6 border border-white/[0.06]" style={{ background: 'var(--color-bg-card)' }}>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <Dumbbell size={22} className="text-amber-400" />
            </div>
            <h3 id="conflict-dialog-title" className="text-[18px] font-bold text-center mb-2 truncate" style={{ color: 'var(--color-text-primary)' }}>Workout Already Running</h3>
            <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
              You have <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{conflictSession.routineName}</span> in progress. What would you like to do?
            </p>
            <div className="space-y-2.5">
              <button
                onClick={handleResumeConflict}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#60A5FA] hover:bg-[#4B91E8] transition-colors"
              >
                Resume {conflictSession.routineName}
              </button>
              <button
                onClick={handleDiscardConflict}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] transition-colors"
                style={{ backgroundColor: '#EF4444', color: '#FFFFFF' }}
              >
                Discard & Start New
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full py-3 rounded-2xl font-medium text-[13px] hover:opacity-80 transition-colors"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wrong day warning — this routine is scheduled for a different day */}
      {showWrongDay && wrongDayInfo && !showConflict && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="dialog" aria-labelledby="wrong-day-dialog-title">
          <div className="rounded-[20px] w-full max-w-sm p-6 border border-white/[0.06]" style={{ background: 'var(--color-bg-card)' }}>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-[24px]">📅</span>
            </div>
            <h3 id="wrong-day-dialog-title" className="text-[18px] font-bold text-center mb-2 truncate" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.wrongDayTitle', "Different Day's Workout")}</h3>
            <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
              {t('activeSession.wrongDayMessage', { scheduledDay: wrongDayInfo.scheduledDay, todayDay: wrongDayInfo.todayDay, defaultValue: 'This routine is scheduled for {{scheduledDay}}, but today is {{todayDay}}. Do you want to proceed anyway?' })}
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => setShowWrongDay(false)}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#D4AF37] hover:bg-[#C4A030] transition-colors"
              >
                {t('activeSession.startAnyway', 'Yes, Start Anyway')}
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full py-3 rounded-2xl font-medium text-[13px] hover:opacity-80 transition-colors"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                {t('activeSession.goBack', 'Go Back')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PR Banner */}
      {activePRBanner && (
        <PRBanner
          exercise={activePRBanner.exercise}
          weight={activePRBanner.weight}
          reps={activePRBanner.reps}
          onDismiss={() => setActivePRBanner(null)}
          t={t}
        />
      )}
      <Confetti active={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Save Warning Toast */}
      {saveWarning && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-scale-pop">
          <div className="bg-[#D4AF37]/15 border border-[#D4AF37]/30 px-4 py-2.5 rounded-xl shadow-lg">
            <p className="text-[12px] text-amber-200">{saveWarning}</p>
          </div>
        </div>
      )}

      {/* Auto workout ender — 2h still-going prompt */}
      {showAutoEndPrompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="dialog" aria-labelledby="auto-end-dialog-title">
          <div className="rounded-[20px] w-full max-w-sm p-6 border border-white/[0.06]" style={{ background: 'var(--color-bg-card)' }}>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-[24px]" role="img" aria-label="clock">&#9200;</span>
            </div>
            <h3 id="auto-end-dialog-title" className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t('activeSession.autoEndTitle', "You've been working out for 2 hours")}
            </h3>
            <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
              {t('activeSession.autoEndMessage', 'Are you still going? The session will auto-finish at 3 hours.')}
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => { autoEndPromptDismissed.current = true; setShowAutoEndPrompt(false); }}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              >
                {t('activeSession.keepGoing', 'Yes, keep going')}
              </button>
              <button
                onClick={() => { setShowAutoEndPrompt(false); setShowFinishModal(true); }}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] border border-white/[0.06] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('activeSession.finishWorkout', 'Finish workout')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish Modal */}
      {showFinishModal && (
        <SessionSummary
          workout={routineName} sessionPRs={sessionPRs}
          totalVolume={totalVolume} duration={formatTime(elapsedTime)}
          completedSets={completedSets} totalSets={totalSets}
          onConfirm={handleFinish} onCancel={() => setShowFinishModal(false)}
          saving={saving} error={saveError}
          sessionRating={sessionRating} onRatingChange={setSessionRating}
        />
      )}

      {/* Session Header */}
      <SessionHeader
        routineName={isInWarmUp ? t('activeSession.warmUpPhase', 'Warm-Up') : cooldownPhase === 'active' ? t('activeSession.cooldownPhase', 'Cool Down') : routineName}
        className={className}
        isPaused={isPaused}
        elapsedTime={elapsedTime}
        formatTime={formatTime}
        completedSets={completedSets}
        totalSets={totalSets}
        exercises={isInWarmUp ? warmUpExercises : cooldownPhase === 'active' ? selectCoolDownStretches([...new Set(exercises.map(e => e.muscle).filter(Boolean))]) : exercises}
        currentExerciseIndex={isInWarmUp ? warmUpIndex : cooldownPhase === 'active' ? cooldownIndex : currentExerciseIndex}
        showResumedBanner={showResumedBanner}
        savedSession={savedSession}
        sessionKey={sessionKey}
        onNavigateBack={() => navigate(-1)}
        onPause={() => setIsPaused(true)}
        onResume={() => setIsPaused(false)}
        onEndWorkout={() => { setIsPaused(false); setShowFinishModal(true); }}
        onSetCurrentExerciseIndex={setCurrentExerciseIndex}
        onDismissResumedBanner={() => setShowResumedBanner(false)}
        watchHeartRate={watchHeartRate}
        onDiscardSession={() => { sessionEndedRef.current = true; localStorage.removeItem(sessionKey); supabase.from('session_drafts').delete().eq('profile_id', user.id).eq('routine_id', id).then(() => {}).catch(() => {}); cancelWorkoutNotification(); endLiveActivity(); syncWorkoutEnded({ duration: elapsedTime, totalVolume: 0, prsHit: 0, setsCompleted: 0 }); navigate('/workouts'); }}
      />

      {/* Rest Timer Overlay */}
      {isResting && !isPaused && (
        <RestTimer
          restTimer={restTimer}
          currentRestDuration={currentRestDuration}
          formatTime={formatTime}
          onSkip={() => {
            // Persist any adjusted rest duration before skipping
            if (currentRestDuration !== (adjustedRestSeconds ?? currentRestDuration)) {
              setAdjustedRestSeconds(currentRestDuration);
            }
            setIsResting(false); restStartedAt.current = null; cancelRestNotification(); restNotificationScheduled.current = false; try { localStorage.removeItem(restStateKey); } catch { }
            window.scrollTo(0, 0);
          }}
          onAdjustRest={(delta) => {
            const newDuration = Math.max(15, currentRestDuration + delta);
            setCurrentRestDuration(newDuration);
            currentRestDurationRef.current = newDuration;
            setAdjustedRestSeconds(newDuration); // persist for future sets
            // Recalculate remaining from anchor
            if (restStartedAt.current) {
              const elapsed = Math.floor((Date.now() - restStartedAt.current) / 1000);
              const remaining = Math.max(0, newDuration - elapsed);
              setRestTimer(remaining);
              // Update localStorage
              try {
                localStorage.setItem(restStateKey, JSON.stringify({ restStartedAt: restStartedAt.current, duration: newDuration }));
              } catch { }
            }
          }}
          upcomingExercise={(() => {
            const curEx = exercises[currentExerciseIndex];
            if (!curEx) return null;
            const curSets = loggedSets[curEx.id] || [];
            const allCompleted = curSets.length > 0 && curSets.every(s => s.completed);
            if (!allCompleted) return null;
            // Find next exercise that still has incomplete sets
            for (let i = currentExerciseIndex + 1; i < exercises.length; i++) {
              const nextSets = loggedSets[exercises[i].id] || [];
              if (nextSets.some(s => !s.completed)) return exercises[i];
            }
            return null;
          })()}
        />
      )}

      {/* Warm-Up Active Phase — rendered in the exercise area, same layout as ExerciseCard */}
      {isInWarmUp && warmUpExercises.length > 0 && (() => {
        const wu = warmUpExercises[warmUpIndex];
        if (!wu) return null;
        const wuName = i18n.language === 'es' && wu.name_es ? wu.name_es : wu.name;
        const localWu = localExercises.find(e => e.id === wu.id);

        return (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-3 pb-32">
              {/* Exercise card — mirrors ExerciseCard layout */}
              <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                {/* Video placeholder / demo area */}
                {localWu?.videoUrl ? (
                  <div className="relative w-full aspect-video bg-black/40 flex items-center justify-center">
                    <video src={localWu.videoUrl} className="w-full h-full object-cover" muted loop playsInline autoPlay />
                  </div>
                ) : (
                  <div className="w-full h-32 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.08), rgba(234,88,12,0.03))' }}>
                    <span className="text-[48px]">🔥</span>
                  </div>
                )}

                {/* Exercise info */}
                <div className="px-4 pt-4 pb-3">
                  <h3 className="text-[18px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                    {wuName}
                  </h3>
                  <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--color-text-subtle)' }}>
                    {localWu?.instructions || `${wu.durationSec} seconds`}
                  </p>
                </div>

                {/* Timer — same card style as rest timer */}
                <div className="px-4 pb-4">
                  <WarmUpTimer
                    key={wu.id}
                    durationSec={wu.durationSec}
                    onComplete={() => {
                      const isLast = warmUpIndex === warmUpExercises.length - 1;
                      if (isLast) {
                        setWarmUpPhase('done');
                      } else {
                        setWarmUpIndex(i => i + 1);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Skip link */}
              <button
                onClick={() => setWarmUpPhase('done')}
                className="w-full mt-4 py-2 text-[12px] font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('activeSession.skipWarmUp', 'Skip to workout')}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Scrollable Exercise Area */}
      {!isInWarmUp && <div className="flex-1 overflow-y-auto">
        {exercises.length === 0 && isEmptyMode ? (
          /* ── Empty workout — no exercises yet ── */
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-4">
              <Dumbbell size={28} style={{ color: 'var(--color-text-subtle)' }} />
            </div>
            <p className="text-[16px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.noExercisesYet')}</p>
            <p className="text-[13px] mb-6" style={{ color: 'var(--color-text-subtle)' }}>{t('activeSession.tapToAddExercises')}</p>
            <button
              onClick={() => setShowAddExercise(true)}
              className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-[#D4AF37] text-black font-bold text-[14px] active:scale-[0.97] transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              <Plus size={18} />
              {t('activeSession.addExercise')}
            </button>
          </div>
        ) : workoutComplete ? (
          cooldownPhase === 'active' ? (
            /* ── Cooldown active — same layout as warm-up ── */
            (() => {
              const muscleGroups = [...new Set(exercises.map(e => e.muscle).filter(Boolean))];
              const stretches = selectCoolDownStretches(muscleGroups);
              const stretch = stretches[cooldownIndex];
              if (!stretch) { setCooldownPhase('done'); return null; }
              const stretchName = i18n.language === 'es' && stretch.name_es ? stretch.name_es : stretch.name;

              return (
                <div className="flex-1 overflow-y-auto">
                  <div className="px-4 pt-3 pb-32">
                    {/* Card — same as warm-up exercise card */}
                    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                      {/* Blue gradient header (warm-up uses orange) */}
                      <div className="w-full h-32 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(96,165,250,0.03))' }}>
                        <span className="text-[48px]">🧘</span>
                      </div>

                      {/* Stretch info */}
                      <div className="px-4 pt-4 pb-3">
                        <h3 className="text-[18px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                          {stretchName}
                        </h3>
                        <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                          {stretch.durationSec}s · {t('activeSession.cooldownPhase', 'Cool Down')} {cooldownIndex + 1}/{stretches.length}
                        </p>
                      </div>

                      {/* Timer */}
                      <div className="px-4 pb-4">
                        <WarmUpTimer
                          key={stretch.id}
                          durationSec={stretch.durationSec}
                          onComplete={() => {
                            const isLast = cooldownIndex >= stretches.length - 1;
                            if (isLast) { setCooldownPhase('done'); } else { setCooldownIndex(i => i + 1); }
                          }}
                        />
                      </div>
                    </div>

                    {/* Skip */}
                    <button
                      onClick={() => setCooldownPhase('done')}
                      className="w-full mt-4 py-2 text-[12px] font-medium"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {t('activeSession.skipWarmUp', 'Skip')}
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            /* ── Workout complete gate — cooldown option ── */
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/20 flex items-center justify-center mb-4">
                <Trophy size={28} className="text-[#10B981]" />
              </div>
              <p className="text-[18px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('activeSession.workoutCompleteTitle', 'Workout Complete!')}
              </p>
              <p className="text-[13px] mb-6" style={{ color: 'var(--color-text-subtle)' }}>
                {t('activeSession.workoutCompleteSubtitle', 'Add more exercises or finish your workout')}
              </p>
              {cooldownPhase === 'none' && (
                <button
                  onClick={() => { setCooldownPhase('active'); setCooldownIndex(0); }}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl text-[13px] font-semibold mb-3 transition-colors active:scale-[0.97]"
                  style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#60A5FA' }}
                >
                  🧘 {t('activeSession.startCooldown', 'Cool Down Stretches')}
                </button>
              )}
              {cooldownPhase === 'done' && (
                <p className="text-[12px] font-semibold text-[#10B981] mb-3">✓ {t('activeSession.cooldownDone', 'Cool down complete')}</p>
              )}
            </div>
          )
        ) : currentExercise ? (() => {
          // ── Superset/Circuit context ──
          const groupId = currentExercise.groupId;
          const groupType = currentExercise.groupType;
          const groupExercises = groupId ? exercises.filter(e => e.groupId === groupId) : [];
          const groupOtherNames = groupExercises.filter(e => e.id !== currentExercise.id).map(e => exName(e));
          const curGroupIdx = groupExercises.findIndex(e => e.id === currentExercise.id);
          const nextInGroup = curGroupIdx >= 0 && curGroupIdx < groupExercises.length - 1 ? groupExercises[curGroupIdx + 1] : null;
          // Calculate current round for grouped exercises
          const completedSetsForThis = currentSets.filter(s => s.completed).length;
          const totalRounds = currentSets.length;

          return (
            <div>
              {/* Group badge + round indicator */}
              {groupId && groupType && (
                <div className="px-4 pt-3 pb-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                      groupType === 'superset' ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20' : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                    }`}>
                      {groupType === 'superset' ? t('activeSession.superset') : t('activeSession.circuit')}
                    </span>
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      {t('activeSession.roundXOfY', { current: completedSetsForThis + 1, total: totalRounds })}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                    {groupType === 'superset'
                      ? t('activeSession.supersetWith', { name: groupOtherNames.join(', ') })
                      : t('activeSession.circuitWith', { names: groupOtherNames.join(', ') })
                    }
                  </p>
                </div>
              )}
              {isCurrentCardio ? (
                /* Cardio exercise — open-ended timer, user controls start/finish */
                <InSessionCardio
                  key={`cardio-${currentExercise.id}`}
                  exercise={currentExercise}
                  onComplete={(durationSec) => {
                    // Mark the set as completed with the actual duration
                    if (currentSets.length > 0) {
                      const incompleteIdx = currentSets.findIndex(s => !s.completed);
                      if (incompleteIdx >= 0) {
                        // Store duration in the reps field for logging
                        handleUpdateSet(currentExercise.id, incompleteIdx, 'reps', Math.ceil(durationSec / 60));
                        handleUpdateSet(currentExercise.id, incompleteIdx, 'weight', '0');
                        handleToggleComplete(currentExercise.id, incompleteIdx, exName(currentExercise), 0);
                      }
                    }
                  }}
                  onSkip={handleSkipExercise}
                  t={t}
                  i18n={i18n}
                />
              ) : (
                <ExerciseCard
                  exercise={currentExercise}
                  currentSets={currentSets}
                  knownPR={knownPR}
                  onUpdateSet={handleUpdateSet}
                  onToggleComplete={handleToggleComplete}
                  onAddSet={handleAddSet}
                  onRemoveSet={handleRemoveSet}
                  onDuplicateLastSet={handleDuplicateLastSet}
                  onFillSuggestion={handleFillSuggestion}
                  onSwap={currentSets.some(s => s.completed) ? undefined : () => { setSwapSearch(''); setSwapSelectedReason(null); setShowSwapModal(true); }}
                  onSkip={handleSkipExercise}
                  onRemoveExercise={exercises.length > 1 ? handleRemoveExercise : undefined}
                  isPRCheck={isPR}
                  livePRs={livePRs.current}
                  nextInGroup={nextInGroup}
                  groupType={groupType}
                  adjustedRestSeconds={adjustedRestSeconds}
                />
              )}
              {/* Connector line + next-in-group prompt */}
              {nextInGroup && groupType && !allSetsComplete && (
                <div className="px-4 pb-2">
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                    groupType === 'superset' ? 'border-purple-500/20 bg-purple-500/[0.06]' : 'border-blue-500/20 bg-blue-500/[0.06]'
                  }`}>
                    <div className={`w-0.5 h-4 rounded-full ${groupType === 'superset' ? 'bg-purple-500/50' : 'bg-blue-500/50'}`} />
                    <span className={`text-[11px] font-semibold ${groupType === 'superset' ? 'text-purple-400' : 'text-blue-400'}`}>
                      {t('activeSession.nextInSuperset', { name: exName(nextInGroup) })}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })() : null}
      </div>}

      {/* ── Add Exercise Modal ──────────────────── */}
      <AnimatePresence>
        {showAddExercise && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] flex flex-col"
            style={{ backgroundColor: 'var(--color-bg-primary)', paddingTop: 'env(safe-area-inset-top, 0px)' }}
          >
            {/* Header — title + close */}
            <div className="flex items-center gap-2 px-4 pt-4 pb-3">
              <h3 className="text-[18px] font-bold flex-1" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.addExercise')}</h3>
              <button
                onClick={() => { setShowAddExercise(false); setExerciseSearch(''); setSelectedMuscle(''); setShowFilters(false); setShowFavoritesOnly(false); setPreviewExercise(null); }}
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors"
                style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Search bar with filter + star inside */}
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default))' }}>
                <Search size={16} style={{ color: 'var(--color-text-subtle)' }} className="shrink-0" />
                <input
                  type="text"
                  value={exerciseSearch}
                  onChange={e => setExerciseSearch(e.target.value)}
                  placeholder={t('activeSession.searchExercises')}
                  className="flex-1 text-[14px] bg-transparent focus:outline-none min-w-0"
                  style={{ color: 'var(--color-text-primary)' }}
                  autoFocus
                />
                {/* Star */}
                <button
                  onClick={() => setShowFavoritesOnly(v => !v)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0 active:scale-90 transition-transform"
                  aria-label="Favorites"
                >
                  <Star size={16} fill={showFavoritesOnly ? 'var(--color-accent)' : 'none'} style={{ color: showFavoritesOnly ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
                </button>
                {/* Filter */}
                <button
                  onClick={() => setShowFilters(v => !v)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0 active:scale-90 transition-transform"
                  aria-label="Filter"
                >
                  <SlidersHorizontal size={16} style={{ color: (showFilters || selectedMuscle) ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
                </button>
              </div>
            </div>

            {/* Active filter badges */}
            {(selectedMuscle || selectedEquipment) && (
              <div className="px-4 pb-2 flex gap-2">
                {selectedMuscle && (
                  <button onClick={() => setSelectedMuscle('')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/20 active:scale-95">
                    {t(`muscleGroups.${selectedMuscle}`, selectedMuscle)}
                    <X size={12} />
                  </button>
                )}
                {selectedEquipment && (
                  <button onClick={() => setSelectedEquipment('')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-[#60A5FA]/15 text-[#60A5FA] border border-[#60A5FA]/20 active:scale-95">
                    {selectedEquipment}
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-1.5">
              {filteredLibraryExercises.map(ex => {
                const isFav = favoriteExerciseIds.has(ex.id);
                const isPreview = previewExercise?.id === ex.id;
                return (
                  <div key={ex.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {/* Exercise info — tap to preview */}
                      <button
                        onClick={() => setPreviewExercise(isPreview ? null : ex)}
                        className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors active:scale-[0.98]"
                        style={{
                          backgroundColor: isPreview ? 'var(--color-accent-soft))' : 'var(--color-bg-card)',
                          border: isPreview ? '1px solid rgba(212,175,55,0.2)' : '1px solid var(--color-border-default))',
                        }}
                      >
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                          {isFav ? <Star size={14} fill="var(--color-accent)" style={{ color: 'var(--color-accent)' }} /> : <Dumbbell size={14} style={{ color: 'var(--color-text-subtle)' }} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{exName(ex) || ex.name}</p>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t(`muscleGroups.${ex.muscle}`, ex.muscle)} · {ex.equipment}</p>
                        </div>
                      </button>
                      {/* Add button */}
                      <button
                        onClick={() => handleAddExerciseToSession(ex)}
                        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                        style={{ backgroundColor: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)' }}
                        aria-label="Add"
                      >
                        <Plus size={18} style={{ color: 'var(--color-accent)' }} />
                      </button>
                    </div>
                    {/* Inline preview — right below the tapped exercise */}
                    {isPreview && (
                      <div className="rounded-2xl p-4 ml-2" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid rgba(212,175,55,0.15)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ backgroundColor: 'rgba(212,175,55,0.1)', color: 'var(--color-accent)' }}>{t(`muscleGroups.${ex.muscle}`, ex.muscle)}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>{ex.equipment}</span>
                          <span className="text-[11px] ml-auto" style={{ color: 'var(--color-text-subtle)' }}>{ex.defaultSets} sets × {ex.defaultReps} reps</span>
                        </div>
                        {(exInstructions(ex) || ex.instructions) && (
                          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                            {exInstructions(ex) || ex.instructions}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredLibraryExercises.length === 0 && (
                <div className="text-center pt-12">
                  <Dumbbell size={28} style={{ color: 'var(--color-text-subtle)' }} className="mx-auto mb-3" />
                  <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('activeSession.noExercisesFound', 'No matching exercises')}</p>
                </div>
              )}
            </div>

            {/* Filter Modal */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[260] flex items-end justify-center"
                  onClick={() => setShowFilters(false)}
                >
                  <div className="absolute inset-0 bg-black/60" />
                  <motion.div
                    initial={{ y: 300 }}
                    animate={{ y: 0 }}
                    exit={{ y: 300 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="relative w-full max-w-lg rounded-t-[24px] pb-8 pt-5 px-5"
                    style={{ backgroundColor: 'var(--color-bg-card)' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ backgroundColor: 'var(--color-border-default)' }} />

                    {/* Muscle filter */}
                    <p className="text-[14px] font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.filterByMuscle', 'Muscle Group')}</p>
                    <div className="grid grid-cols-3 gap-2 mb-5">
                      <button
                        onClick={() => setSelectedMuscle('')}
                        className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${!selectedMuscle ? 'bg-[#D4AF37] text-black' : ''}`}
                        style={selectedMuscle ? { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' } : {}}
                      >
                        {t('muscleGroups.All', 'All')}
                      </button>
                      {MUSCLE_GROUPS.map(mg => (
                        <button
                          key={mg}
                          onClick={() => setSelectedMuscle(selectedMuscle === mg ? '' : mg)}
                          className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${selectedMuscle === mg ? 'bg-[#D4AF37] text-black' : ''}`}
                          style={selectedMuscle !== mg ? { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' } : {}}
                        >
                          {t(`muscleGroups.${mg}`, mg)}
                        </button>
                      ))}
                    </div>

                    {/* Equipment filter */}
                    <p className="text-[14px] font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.filterByEquipment', 'Equipment')}</p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <button
                        onClick={() => setSelectedEquipment('')}
                        className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${!selectedEquipment ? 'bg-[#60A5FA] text-black' : ''}`}
                        style={selectedEquipment ? { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' } : {}}
                      >
                        {t('muscleGroups.All', 'All')}
                      </button>
                      {EQUIPMENT.map(eq => (
                        <button
                          key={eq}
                          onClick={() => setSelectedEquipment(selectedEquipment === eq ? '' : eq)}
                          className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${selectedEquipment === eq ? 'bg-[#60A5FA] text-black' : ''}`}
                          style={selectedEquipment !== eq ? { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' } : {}}
                        >
                          {eq}
                        </button>
                      ))}
                    </div>

                    {/* Apply */}
                    <button
                      onClick={() => setShowFilters(false)}
                      className="w-full py-3 rounded-xl font-bold text-[14px] bg-[#D4AF37] text-black active:scale-[0.97] transition-transform"
                    >
                      {t('activeSession.applyFilters', 'Apply')}
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Exercise Swap Modal ────────────────────────────────── */}
      <AnimatePresence>
        {showSwapModal && swapTargetExercise && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-md flex flex-col"
            style={{ paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))' }}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {t('activeSession.swapTitle', { exercise: exName(swapTargetExercise) })}
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {swapTargetMuscle && `${swapTargetMuscle} · `}{t('activeSession.swapSubtitle')}
                </p>
              </div>
              <button
                onClick={() => { setShowSwapModal(false); setSwapSearch(''); setSwapSelectedReason(null); }}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.06] hover:opacity-80 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ml-3 shrink-0"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Reason chips */}
            <div className="px-4 pb-3 flex gap-2">
              {[
                { key: 'equipment_busy', label: t('activeSession.swapReasonEquipment') },
                { key: 'injury', label: t('activeSession.swapReasonInjury') },
                { key: 'preference', label: t('activeSession.swapReasonPreference') },
              ].map(r => (
                <button
                  key={r.key}
                  onClick={() => setSwapSelectedReason(swapSelectedReason === r.key ? null : r.key)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                    swapSelectedReason === r.key
                      ? 'bg-[#D4AF37] text-black'
                      : 'bg-white/[0.06] hover:bg-white/[0.1]'
                  }`}
                  style={swapSelectedReason !== r.key ? { color: 'var(--color-text-muted)' } : undefined}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="px-4 pb-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-subtle)' }} />
                <input
                  type="text"
                  value={swapSearch}
                  onChange={e => setSwapSearch(e.target.value)}
                  placeholder={t('activeSession.swapSearchPlaceholder')}
                  className="w-full pl-9 pr-4 py-3 rounded-xl border border-white/[0.06] text-[14px] focus:border-[#D4AF37]/40 focus:outline-none"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
                  autoFocus
                />
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-1.5">
              {filteredSwapExercises.map(ex => (
                <button
                  key={ex.id}
                  onClick={() => handleSwapExercise(ex)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-[#D4AF37]/30 text-left transition-colors active:scale-[0.98] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  style={{ background: 'var(--color-bg-card)' }}
                >
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                    <ArrowLeftRight size={14} className="text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{ex.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{ex.muscle} · {ex.equipment}</p>
                  </div>
                  <span className="text-[12px] font-semibold text-[#D4AF37] shrink-0">{t('activeSession.swapSelect')}</span>
                </button>
              ))}
              {filteredSwapExercises.length === 0 && (
                <p className="text-center text-[13px] pt-8" style={{ color: 'var(--color-text-subtle)' }}>{t('activeSession.swapNoResults')}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sticky Bottom — Single primary action ──────────────── */}
      <div className="flex-shrink-0 px-4 pb-6 pt-4" style={{ backgroundColor: 'var(--color-bg-primary)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {isInWarmUp ? (
          /* Warm-up mode — same button style as Complete Set, advances warm-up */
          <button
            onClick={() => {
              const isLast = warmUpIndex === warmUpExercises.length - 1;
              if (isLast) {
                setWarmUpPhase('done');
              } else {
                setWarmUpIndex(i => i + 1);
              }
            }}
            className="w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] shadow-[0_4px_24px_rgba(212,175,55,0.3)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{
              backgroundColor: warmUpIndex === warmUpExercises.length - 1 ? '#10B981' : '#D4AF37',
              color: warmUpIndex === warmUpExercises.length - 1 ? '#FFFFFF' : '#000000',
            }}
          >
            {warmUpIndex === warmUpExercises.length - 1
              ? t('activeSession.beginWorkout', 'Begin Workout')
              : t('activeSession.nextWarmUp', 'Next')}
          </button>
        ) : exercises.length === 0 && isEmptyMode ? (
          /* Empty mode with no exercises — no bottom button needed, CTA is in the center */
          null
        ) : isEmptyMode ? (
          /* Empty mode with exercises — show add exercise + complete/next */
          <div className="flex gap-2.5">
            <button
              onClick={() => setShowAddExercise(true)}
              className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/[0.06] border border-white/[0.06] text-[#D4AF37] active:scale-[0.95] transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              aria-label={t('activeSession.addExercise')}
            >
              <Plus size={22} />
            </button>
            <div className="flex-1">
              {allSetsComplete ? (
                <button
                  onClick={handleNext}
                  className="w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] bg-[#D4AF37] text-black shadow-[0_4px_24px_rgba(212,175,55,0.3)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                >
                  {hasNextExercise ? `${t('activeSession.nextExerciseButton')} →` : `${t('activeSession.finishWorkoutButton')} →`}
                </button>
              ) : (
                <button
                  onClick={handleCompleteSet}
                  disabled={!canComplete}
                  className={`w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                    canComplete
                      ? 'bg-[#D4AF37] text-black shadow-[0_4px_24px_rgba(212,175,55,0.3)]'
                      : 'cursor-not-allowed'
                  }`}
                  style={!canComplete ? { backgroundColor: 'var(--color-border-subtle)', color: 'var(--color-text-subtle)' } : undefined}
                >
                  {t('activeSession.completeSet')} →
                </button>
              )}
            </div>
          </div>
        ) : workoutComplete && cooldownPhase === 'active' ? (
          /* Cooldown active — Next/Skip buttons */
          (() => {
            const muscleGroups = [...new Set(exercises.map(e => e.muscle).filter(Boolean))];
            const stretches = selectCoolDownStretches(muscleGroups);
            const isLast = cooldownIndex >= stretches.length - 1;
            return (
              <div className="space-y-2">
                <button
                  onClick={() => {
                    if (isLast) { setCooldownPhase('done'); } else { setCooldownIndex(i => i + 1); }
                  }}
                  className="w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:outline-none"
                  style={isLast ? { backgroundColor: '#10B981', color: '#fff' } : { backgroundColor: 'var(--color-accent)', color: '#000' }}
                >
                  {isLast ? t('activeSession.finishCooldown', 'Finish Cool Down') : t('activeSession.nextWarmUp', 'Next')}
                </button>
                <button
                  onClick={() => setCooldownPhase('done')}
                  className="w-full text-[12px] font-medium py-2"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('activeSession.skipWarmUp', 'Skip')}
                </button>
              </div>
            );
          })()
        ) : workoutComplete ? (
          /* Workout complete — user chooses to add more, cooldown, or finish */
          <div className="flex gap-2.5">
            <button
              onClick={() => setShowAddExercise(true)}
              className="flex-1 flex items-center justify-center gap-2 font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] bg-white/[0.06] border border-white/[0.06] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            >
              <Plus size={18} />
              {t('activeSession.addExercise')}
            </button>
            <button
              onClick={() => setShowFinishModal(true)}
              className="flex-1 font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] bg-[#10B981] text-white shadow-[0_4px_24px_rgba(16,185,129,0.3)] focus:ring-2 focus:ring-[#10B981] focus:outline-none"
            >
              {t('activeSession.finishWorkoutButton')} →
            </button>
          </div>
        ) : (
          /* Normal mode */
          <div className="flex gap-2.5">
            <button
              onClick={() => setShowAddExercise(true)}
              className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/[0.06] border border-white/[0.06] text-[#D4AF37] active:scale-[0.95] transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              aria-label={t('activeSession.addExercise')}
            >
              <Plus size={22} />
            </button>
            <div className="flex-1">
              {allSetsComplete ? (
                <button
                  onClick={handleNext}
                  className="w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] bg-[#D4AF37] text-black shadow-[0_4px_24px_rgba(212,175,55,0.3)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                >
                  {hasNextExercise ? `${t('activeSession.nextExerciseButton')} →` : `${t('activeSession.finishWorkoutButton')} →`}
                </button>
              ) : (
                <button
                  onClick={handleCompleteSet}
                  disabled={!canComplete}
                  className={`w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                    canComplete
                      ? 'bg-[#D4AF37] text-black shadow-[0_4px_24px_rgba(212,175,55,0.3)]'
                      : 'bg-white/[0.06] cursor-not-allowed'
                  }`}
                  style={!canComplete ? { color: 'var(--color-text-muted)' } : undefined}
                >
                  {t('activeSession.completeSet')} →
                </button>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

const ActiveSessionWithBoundary = (props) => (
  <ActiveSessionErrorBoundary>
    <ActiveSession {...props} />
  </ActiveSessionErrorBoundary>
);

export default ActiveSessionWithBoundary;
