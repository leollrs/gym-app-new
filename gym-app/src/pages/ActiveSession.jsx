import React, { useState, useEffect, useRef, useMemo, useCallback, Component } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Trophy, Dumbbell, Plus, Search, X, ArrowLeftRight, Star, SlidersHorizontal, Minus, Play, Pause, ChevronLeft, SkipForward, Flame, Unlink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { computeSuggestion, computeIntraSessionSuggestion, applyReadinessToSuggestion, epley1RM as engineEpley1RM } from '../lib/overloadEngine';
import { computeReadiness, exerciseReadiness } from '../lib/readinessEngine';
import { getMesocyclePosition, MESO_DELOAD_FACTOR } from '../lib/mesocycle';
import { requestNotificationPermission, scheduleRestDoneNotification, cancelRestNotification } from '../lib/restNotification';
import { startWorkoutNotification, updateWorkoutNotification, cancelWorkoutNotification } from '../lib/workoutNotification';
import { startLiveActivity, updateLiveActivity, endLiveActivity } from '../lib/liveActivityBridge';
import { syncWorkoutToWatch, syncWorkoutEnded, onWatchMessage } from '../lib/watchBridge';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { exName, exInstructions, localizeRoutineName } from '../lib/exerciseName';
import { cacheWorkoutData, getCachedWorkoutData, flushQueue } from '../lib/offlineQueue';
import { useWakeLock } from '../hooks/useWakeLock';
import { clearCachedState } from '../hooks/useCachedState';
import { clearCache as clearQueryCache } from '../lib/queryCache';
import { useToast } from '../contexts/ToastContext';

import { usePostHog } from '@posthog/react';
import { useQueryClient } from '@tanstack/react-query';
import ExerciseProgressChart from '../components/ExerciseProgressChart';
import { exercises as localExercises, MUSCLE_GROUPS, EQUIPMENT } from '../data/exercises';
import Confetti from '../components/Confetti';

import SessionHeader from './active-session/SessionHeader';
import ExerciseCard from './active-session/ExerciseCard';
import SupersetPickerModal from '../components/SupersetPickerModal';
import LazyVideoTile from '../components/LazyVideoTile';
import { getSessionSuggestions } from '../lib/sessionExerciseSuggestions';
import { getSwapMatchScore, filterByReason } from '../lib/swapMatchScore';
import RestTimer from './active-session/RestTimer';
import SessionSummary from './active-session/SessionSummary';
import { selectWarmUps } from '../lib/warmUpSelector';
import { selectCoolDownStretches } from '../lib/cooldownSelector';

const IS_EMPTY_SESSION = (id) => id === 'empty';

// Chip filters for the in-session Add Exercise modal. Mirrors the chip set
// used by the standalone Exercise Library so the same mental model carries.
// `all` is the no-op default.
const ADD_EXERCISE_CHIP_REGIONS = {
  push:  ['front_delts', 'side_delts', 'upper_chest', 'mid_chest', 'lower_chest', 'triceps'],
  pull:  ['upper_back', 'mid_back', 'lats', 'lower_back', 'traps', 'biceps', 'rear_delts'],
  chest: ['upper_chest', 'mid_chest', 'lower_chest'],
  back:  ['upper_back', 'mid_back', 'lats', 'lower_back', 'traps'],
  arms:  ['biceps', 'triceps', 'forearms', 'front_delts', 'side_delts', 'rear_delts'],
  legs:  ['quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'glute_med', 'calves', 'tibialis', 'soleus'],
  core:  ['upper_abs', 'mid_abs', 'lower_abs', 'abs', 'obliques', 'serratus'],
};

// ── Warm-Up Timer — auto-starting, drift-free, same style as rest timer ─────
const WarmUpTimer = ({ durationSec, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(durationSec);
  const [done, setDone] = useState(false);
  const startedAtRef = useRef(Date.now()); // auto-start immediately
  const rafRef = useRef(null);
  const completedRef = useRef(false);
  const lastDisplayedRef = useRef(Math.ceil(durationSec));

  // Reset and auto-start on exercise change
  useEffect(() => {
    setTimeLeft(durationSec);
    setDone(false);
    completedRef.current = false;
    startedAtRef.current = Date.now();
    lastDisplayedRef.current = Math.ceil(durationSec);
    return () => cancelAnimationFrame(rafRef.current);
  }, [durationSec]);

  // Drift-free tick — RAF runs every frame, but state only updates when the
  // displayed (ceil'd) seconds actually change. Cuts setState rate from ~60Hz
  // to ~1Hz with no visible difference.
  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const remaining = Math.max(0, durationSec - elapsed);
      const displayed = Math.ceil(remaining);
      if (displayed !== lastDisplayedRef.current) {
        lastDisplayedRef.current = displayed;
        setTimeLeft(remaining);
      }

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
    <div className="w-full rounded-2xl p-5" style={{ backgroundColor: 'var(--color-bg-card)' }} role="timer" aria-label={done ? 'Timer complete' : `${mins > 0 ? `${mins} minutes ${secs} seconds` : `${secs} seconds`} remaining`}>
      {/* Timer display */}
      <div className="flex items-center justify-center py-8">
        <div className="relative w-44 h-44">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128" aria-hidden="true">
            <circle cx="64" cy="64" r="58" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
            <circle
              cx="64" cy="64" r="58" fill="none"
              stroke={done ? '#10B981' : '#f97316'}
              strokeWidth="5" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[38px] font-black tabular-nums" style={{ color: done ? '#10B981' : 'var(--color-text-primary)' }}>
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
                  : { backgroundColor: 'var(--color-success, #10B981)', color: 'var(--color-text-on-secondary, #fff)' }
                }
              >
                {phase === 'running' ? t('cardio.pause', 'Pause') : elapsed > 0 ? t('cardio.resume', 'Resume') : t('cardio.start', 'Start')}
              </button>
              {elapsed > 10 && phase !== 'running' && (
                <button
                  onClick={handleFinish}
                  className="px-6 py-3 rounded-2xl font-bold text-[14px] active:scale-[0.97] transition-transform"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
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
                aria-label={t('cardio.distance', 'Distance')}
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
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
              >
                {t('activeSession.completeCardio', 'Complete')}
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
    this.state = { hasError: false, errorMessage: '', errorStack: '' };
  }
  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: (error && (error.message || String(error))) || 'Unknown error',
      errorStack: (error && error.stack) || '',
    };
  }
  componentDidCatch(error, info) {
    try { console.error('[ActiveSession] crash:', error, info?.componentStack); } catch {}
    try { this.setState({ errorStack: (info?.componentStack || '') + '\n' + (error?.stack || '') }); } catch {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto" style={{ background: 'var(--color-bg-primary)' }}>
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center max-w-full">
            <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{i18n.t('pages:activeSession.somethingWentWrong')}</p>
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{i18n.t('pages:activeSession.dataSavedLocally')}</p>
            <pre className="mt-3 p-3 rounded-xl text-[11px] text-left whitespace-pre-wrap break-words max-w-full overflow-auto" style={{ background: 'rgba(239,68,68,0.08)', color: '#EF4444', fontFamily: 'ui-monospace, monospace', maxHeight: 240 }}>
{this.state.errorMessage}
{this.state.errorStack ? '\n\n' + this.state.errorStack : ''}
            </pre>
            <button
              onClick={() => window.history.back()}
              className="mt-2 px-6 py-3 rounded-2xl bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] font-bold text-[14px]"
            >
              {i18n.t('pages:activeSession.goBack')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── PR Detection ──────────────────────────────────────────────────────────────
// Delegate to the engine's canonical 1RM (single source of truth — picks up the
// corrected Epley/Brzycki 10-rep crossover + the reps>=30 Epley fallback).
// Kept as a local alias so the many in-component call sites don't change.
const epley1RM = engineEpley1RM;

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
    <div className="bg-gradient-to-r from-amber-600 via-yellow-500 to-orange-500 px-5 py-5 shadow-2xl flex items-center gap-3 w-full" style={{ boxShadow: '0 8px 32px rgba(212, 175, 55, 0.4)' }}>
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20 flex-shrink-0"><Trophy size={28} className="text-white drop-shadow-lg" /></div>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-[17px] leading-tight text-white tracking-wide uppercase drop-shadow-sm">{t('activeSession.newPersonalRecord')}</p>
        <p className="text-[14px] text-white/90 mt-1 font-semibold truncate">{t('activeSession.prSubtitle', { exercise, weight, reps })}</p>
      </div>
      <button onClick={onDismiss} aria-label={t('activeSession.dismiss', { defaultValue: 'Dismiss' })} className="w-9 h-9 flex items-center justify-center text-white/70 hover:text-white text-[20px] leading-none transition-colors duration-200 flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-full">×</button>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const ActiveSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, gymName } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // ── Display unit toggle for weight inputs (lb / kg) ─────────────────────────
  // Persists across navigations within the session via localStorage so the
  // user doesn't have to re-pick on every exercise card. Defaults from the
  // user's profile preference; flipping it doesn't mutate the saved profile.
  const [weightUnit, setWeightUnit] = useState(() => {
    try {
      const saved = localStorage.getItem('tugympr_session_weight_unit');
      if (saved === 'kg' || saved === 'lb') return saved;
    } catch {}
    return profile?.metric_units === false ? 'lb' : (profile?.metric_units === true ? 'kg' : 'lb');
  });
  useEffect(() => {
    try { localStorage.setItem('tugympr_session_weight_unit', weightUnit); } catch {}
  }, [weightUnit]);
  const toggleWeightUnit = useCallback(() => {
    setWeightUnit((u) => (u === 'kg' ? 'lb' : 'kg'));
  }, []);

  // ── Class booking context (when starting from a class template) ────────────
  const classBookingId = location.state?.classBookingId ?? null;
  const className = location.state?.className ?? null;
  // Watch-initiated starts can't carry react-router state through the
  // window.__watchPendingNav channel, so they encode skipWarmUp as a query
  // param. Honour either source.
  const skipWarmUp = location.state?.skipWarmUp
    ?? (new URLSearchParams(location.search || '').get('skipWarmUp') === '1');

  // ── Check for conflicting active session ──────────────────────────────────
  const [conflictSession, setConflictSession] = useState(null);
  const [showConflict, setShowConflict] = useState(false);

  useEffect(() => {
    try {
      // Only show the "discard previous workout" modal when the OTHER draft has
      // been untouched for at least 1 hour. Anything more recent is treated as
      // a still-active session and the user is sent to it directly via the
      // existing conflict resume path. This keeps people from being prompted
      // to discard a session they were actively using a few minutes ago.
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const oneHourAgoTs = Date.now() - 60 * 60 * 1000;
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('gym_session_')) continue;
        const otherId = key.replace('gym_session_', '');
        if (otherId === id) continue; // same session, not a conflict
        const data = JSON.parse(localStorage.getItem(key));
        if (!data?.loggedSets || !data?.startedAt) continue;
        if (new Date(data.startedAt).getTime() <= oneDayAgo) continue;
        // lastUpdated falls back to startedAt if older drafts didn't track it
        const lastTouch = data.lastUpdated
          ? new Date(data.lastUpdated).getTime()
          : new Date(data.startedAt).getTime();
        if (lastTouch > oneHourAgoTs) continue; // recently active — skip prompt
        setConflictSession({ routineId: otherId, routineName: data.routineName || 'Workout', key });
        setShowConflict(true);
        break;
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
    try {
      // When the watch hands us a fresh exercise (?exerciseId=… / ?exerciseName=…),
      // it's the start of a brand-new free-lift session. Any leftover
      // gym_session_empty draft would make ActiveSession resume the wrong
      // workout — exercises wouldn't be the watch's pick, sets logged from
      // the wrist would land on the wrong exercise, and the user would see
      // "ghost" data. Drop the draft so we boot clean.
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('exerciseId') || params.get('exerciseName')) {
          try { localStorage.removeItem(`gym_session_${id}`); } catch {}
          return null;
        }
      }
      return JSON.parse(localStorage.getItem(`gym_session_${id}`)) ?? null;
    } catch { return null; }
  });

  // ── Instant hydration from localStorage ────────────────────────────────────
  // If we have a saved draft AND cached routine definition, we can render the
  // workout page on the FIRST render — no spinner, no DB wait. The DB fetch
  // below becomes a silent background revalidation.
  const cachedRoutineInitial = useMemo(() => {
    if (IS_EMPTY_SESSION(id)) return null;
    try { return getCachedWorkoutData(id); } catch { return null; }
  }, [id]);

  const canHydrateInstantly =
    IS_EMPTY_SESSION(id) ||
    (savedSession?.loggedSets && Object.keys(savedSession.loggedSets).length > 0 &&
     (savedSession.exercises?.length > 0 || cachedRoutineInitial?.exercises?.length > 0));

  const [dataLoading, setDataLoading] = useState(!canHydrateInstantly);
  const [routineName, setRoutineName] = useState(
    savedSession?.routineName || cachedRoutineInitial?.routineName || ''
  );

  // Keep the screen awake while a workout is active — released on unmount.
  useWakeLock(true);
  const [exercises, setExercises] = useState(() => {
    // Prefer exercises persisted in the draft (respects removed/skipped), then
    // fall back to the cached routine definition so suggestions/history shapes
    // are still populated before the DB revalidation finishes.
    if (savedSession?.exercises?.length > 0) return savedSession.exercises;
    if (cachedRoutineInitial?.exercises?.length > 0) return cachedRoutineInitial.exercises;
    return [];
  });
  const onboardingRef = useRef(null); // cached onboarding for intra-session suggestions
  const [skipUndo, setSkipUndo] = useState(null); // { fromIndex, timerId } — floating undo after skipping an exercise

  // Warm-up phase: 'gate' (show splash), 'active' (doing warm-ups), 'done' (skipped or finished)
  const [warmUpPhase, setWarmUpPhase] = useState(() => {
    if (skipWarmUp) return 'done';
    if (IS_EMPTY_SESSION(id)) return 'done';
    if (savedSession?.warmUpPhase === 'done') return 'done';
    // If was mid warm-up ('active') or has any saved data, restart warm-up gate
    if (savedSession) return savedSession.warmUpPhase === 'active' ? 'gate' : 'done';
    return 'gate';
  });
  const [warmUpExercises, setWarmUpExercises] = useState([]);
  const [warmUpIndex, setWarmUpIndex] = useState(0);

  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(
    savedSession?.currentExerciseIndex ?? 0
  );
  const [isPaused, setIsPaused] = useState(savedSession?.isPaused ?? false);
  const [removedExerciseIds, setRemovedExerciseIds] = useState(savedSession?.removedExerciseIds ?? []);
  // Skipped exercises are treated as "done" for Live Activity totals — their sets
  // drop out of the denominator so the Dynamic Island doesn't show phantom
  // uncompleted sets the user has already moved past.
  const [skippedExerciseIds, setSkippedExerciseIds] = useState(savedSession?.skippedExerciseIds ?? []);

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

  // ── Trainer coaching cues (migration 0357) ───────────────────────────────
  // Realtime channel below subscribes to session_cues filtered by client_id.
  // Rest extensions arriving while NOT resting are queued here and applied
  // on the next set's rest-start. isRestingRef mirrors isResting so the
  // realtime callback can branch without stale-closure bugs.
  const pendingRestExtendRef = useRef(0);
  const isRestingRef = useRef(!!restoredRest.current);
  useEffect(() => { isRestingRef.current = isResting; }, [isResting]);

  // Trainer-logged sets (cue 'set_log', migration 0549). Assigned after
  // handleToggleComplete is defined; a ref so the once-subscribed realtime
  // callback and the resume backfill always call the latest closure.
  const applyTrainerSetRef = useRef(null);

  // Coach cue banner state — { id, type, text } | null. Auto-dismisses.
  const [coachCue, setCoachCue] = useState(null);
  useEffect(() => {
    if (!coachCue?.id) return undefined;
    const timer = setTimeout(() => setCoachCue(null), 8000);
    return () => clearTimeout(timer);
  }, [coachCue?.id]);

  // Subscribe to incoming coaching cues. Each INSERT is applied (rest_extend
  // bumps timer or queues; others surface as a banner) and ack'd server-side.
  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = supabase
      .channel(`active-session-cues-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'session_cues',
        filter: `client_id=eq.${user.id}`,
      }, (payload) => {
        const cue = payload?.new;
        if (!cue || cue.acknowledged) return;

        let bannerText = '';
        if (cue.cue_type === 'rest_extend') {
          const seconds = Number(cue.payload?.seconds) || 30;
          if (isRestingRef.current && restStartedAt.current) {
            currentRestDurationRef.current += seconds;
            setRestTimer((t) => t + seconds);
            try {
              const raw = localStorage.getItem(restStateKey);
              if (raw) {
                const parsed = JSON.parse(raw);
                parsed.duration = (parsed.duration || 0) + seconds;
                localStorage.setItem(restStateKey, JSON.stringify(parsed));
              }
            } catch {}
            bannerText = t('activeSession.cue.restExtended', `Coach extended rest by ${seconds}s`, { seconds });
          } else {
            pendingRestExtendRef.current += seconds;
            bannerText = t('activeSession.cue.restQueued', `Coach added ${seconds}s to your next rest`, { seconds });
          }
        } else if (cue.cue_type === 'weight_adjust') {
          const pct = Number(cue.payload?.percent) || 0;
          bannerText = pct < 0
            ? t('activeSession.cue.reduceWeight', `Coach: drop weight by ${Math.abs(pct)}% on this set`, { pct: Math.abs(pct) })
            : t('activeSession.cue.bumpWeight', `Coach: bump weight by ${pct}% on this set`, { pct });
        } else if (cue.cue_type === 'drop_set') {
          bannerText = t('activeSession.cue.dropSet', 'Coach: do a drop set after this set');
        } else if (cue.cue_type === 'note') {
          const note = (cue.payload?.text || '').toString().slice(0, 200);
          bannerText = note ? `${t('activeSession.cue.notePrefix', 'Coach')}: ${note}` : t('activeSession.cue.noteEmpty', 'Coach left a note');
        } else if (cue.cue_type === 'set_log') {
          // Trainer logged a set on the client's behalf (0549). Apply through
          // the normal completion path; ack ONLY when it applied, so the
          // resume backfill retries cues that landed mid-hydration.
          const applied = applyTrainerSetRef.current?.(cue.payload);
          if (!applied) return;
          bannerText = t('activeSession.cue.setLogged', 'Coach logged set {{n}}: {{w}} × {{r}}', {
            n: (Number(cue.payload?.set_index) || 0) + 1,
            w: cue.payload?.weight || '—',
            r: cue.payload?.reps || '—',
          });
        }

        if (bannerText) setCoachCue({ id: cue.id, type: cue.cue_type, text: bannerText });

        // Ack server-side (fire and forget — banner already showed locally)
        supabase.rpc('ack_session_cue', { p_cue_id: cue.id }).then(({ error }) => {
          if (error) logger.warn('ack_session_cue failed', error.message);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // restStateKey is stable for a given session; intentionally tracked once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Backfill trainer set logs that arrived while the app was suspended — iOS
  // drops the websocket in background and realtime INSERTs don't replay, so
  // without this a set the trainer logged while the member's phone was locked
  // would sit unacknowledged forever. On mount + every foreground resume,
  // fetch this session's unacked set_log cues and apply the LAST one per
  // (exercise, set) slot; superseded ones are acked without applying (the
  // trainer corrected their own entry). Other cue types stay momentary by
  // design — a 20-minute-old "rest +30s" is meaningless on resume.
  useEffect(() => {
    if (!user?.id || dataLoading) return undefined;
    let cancelled = false;
    const ack = (cueId) => {
      supabase.rpc('ack_session_cue', { p_cue_id: cueId }).then(({ error }) => {
        if (error) logger.warn('ack_session_cue failed', error.message);
      });
    };
    const backfill = async () => {
      const { data, error } = await supabase
        .from('session_cues')
        .select('id, payload, created_at')
        .eq('client_id', user.id)
        .eq('cue_type', 'set_log')
        .eq('acknowledged', false)
        .gte('created_at', startedAt.current)
        .order('created_at', { ascending: true })
        .limit(30);
      if (cancelled || error || !data?.length) {
        if (error) logger.warn('set_log backfill failed', error.message);
        return;
      }
      const bySlot = new Map(); // last cue per (exercise, set) wins
      data.forEach(cue => bySlot.set(`${cue.payload?.exercise_id}:${cue.payload?.set_index}`, cue));
      let lastApplied = null;
      for (const cue of data) {
        const isLatestForSlot = bySlot.get(`${cue.payload?.exercise_id}:${cue.payload?.set_index}`)?.id === cue.id;
        if (!isLatestForSlot) { ack(cue.id); continue; }
        if (applyTrainerSetRef.current?.(cue.payload)) {
          lastApplied = cue;
          ack(cue.id);
        }
      }
      if (lastApplied) {
        setCoachCue({
          id: lastApplied.id, type: 'set_log',
          text: t('activeSession.cue.setLogged', 'Coach logged set {{n}}: {{w}} × {{r}}', {
            n: (Number(lastApplied.payload?.set_index) || 0) + 1,
            w: lastApplied.payload?.weight || '—',
            r: lastApplied.payload?.reps || '—',
          }),
        });
      }
    };
    backfill();
    const onVis = () => { if (document.visibilityState === 'visible') backfill(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, dataLoading]);

  const [showFinishModal, setShowFinishModal] = useState(false);
  const [workoutComplete, setWorkoutComplete] = useState(false);
  const [cooldownPhase, setCooldownPhase] = useState('none'); // none → active → done
  const [cooldownIndex, setCooldownIndex] = useState(0);
  const [saving, setSaving]                   = useState(false);
  const [saveError, setSaveError]             = useState('');
  // Pause action sheet — shows when user taps pause; offers Resume / Save for
  // later / Delete session. The SessionHeader's full-screen pause overlay
  // stays underneath but our modal (z-[300]) covers it visually.
  const [showPauseSheet, setShowPauseSheet] = useState(false);
  const [showDeleteSessionConfirm, setShowDeleteSessionConfirm] = useState(false);

  const [activePRBanner, setActivePRBanner] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [sessionPRs, setSessionPRs]         = useState(savedSession?.sessionPRs ?? []);
  const livePRs = useRef({});
  // Always holds the latest state so beforeunload/visibilitychange can save without stale closures
  const saveRef = useRef(null);
  const lastTickAt = useRef(Date.now());
  const isPausedRef = useRef(savedSession?.isPaused ?? false);
  const draftSaveRef = useRef(null);

  // Synchronously hydrate loggedSets from localStorage so the first render
  // shows all the user's previously logged sets — no spinner, no flash.
  const [loggedSets, setLoggedSets] = useState(() => savedSession?.loggedSets || {});
  // Show the "Discard previous workout?" / resumed banner only when the saved
  // draft has actually gone stale (>=60 minutes since the user last touched
  // it). Previously this fired on every session resume after 5 minutes, which
  // surfaced the discard prompt during normal in-gym warm-up time. Prefer the
  // `lastUpdated` timestamp (added in the persist effect below); fall back to
  // `startedAt` for older drafts that pre-date the field.
  const timeSinceLastTouch = (() => {
    const ref = savedSession?.lastUpdated || savedSession?.startedAt;
    return ref ? (Date.now() - new Date(ref).getTime()) / 60000 : 0;
  })();
  const STALE_DRAFT_MINUTES = 60;
  const [showResumedBanner, setShowResumedBanner] = useState(
    !!savedSession?.loggedSets && timeSinceLastTouch >= STALE_DRAFT_MINUTES
  );
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
  // Inline custom-exercise creator inside the swap modal (Feat 1).
  const [swapCustomName, setSwapCustomName] = useState('');
  const [swapCustomSaving, setSwapCustomSaving] = useState(false);
  // Same inline creator inside the Add Exercise modal so the user can spin
  // up a brand-new exercise without first having to pick one to swap. The
  // active chip filter seeds the muscle group when possible (Chest chip →
  // muscle_group: 'Chest', etc.).
  const [addCustomName, setAddCustomName] = useState('');
  const [addCustomSaving, setAddCustomSaving] = useState(false);
  // In-session list manager (Feat 3) — full-list view with reorder / swap /
  // delete / add. Triggered by the list icon next to the segmented nav.
  const [showListManager, setShowListManager] = useState(false);
  // Multi-select inside the in-session list manager — picks 2+ exercises to
  // group as a superset/circuit on the fly without leaving the workout.
  const [listGroupSel, setListGroupSel] = useState(() => new Set());
  const toggleListGroupSel = (idx) => {
    setListGroupSel((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };
  const handleListGroup = (type) => {
    if (listGroupSel.size < 2) return;
    const gid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setExercises((prev) => prev.map((ex, i) =>
      listGroupSel.has(i) ? { ...ex, groupId: gid, groupType: type } : ex
    ));
    setListGroupSel(new Set());
  };
  const handleListUngroup = (groupId) => {
    setExercises((prev) => prev.map((ex) =>
      ex.groupId === groupId ? { ...ex, groupId: null, groupType: null } : ex
    ));
  };
  // Quick-superset state: when the user taps the inline "Superset" pill we
  // either open a picker (to choose a partner from the routine / add a new
  // one) or — if the current exercise is already grouped — unlink the group.
  const [showSupersetPicker, setShowSupersetPicker] = useState(false);
  // When true, the next `handleAddExerciseToSession` call also groups the
  // newly-added exercise with whatever exercise was active when the picker
  // opened. Cleared once consumed (or when the AddExercise modal closes).
  const supersetPendingForRef = useRef(null);

  const handleQuickSupersetToggle = useCallback(() => {
    setExercises((prev) => {
      const idx = currentExerciseIndex;
      if (idx < 0 || idx >= prev.length) return prev;
      const cur = prev[idx];
      if (cur.groupId) {
        // Already in a group — single-tap dissolves it.
        return prev.map((ex) => ex.groupId === cur.groupId ? { ...ex, groupId: null, groupType: null } : ex);
      }
      // Not in a group — defer the actual pairing to the picker.
      setShowSupersetPicker(true);
      return prev;
    });
  }, [currentExerciseIndex]);

  const handleSupersetPickExisting = useCallback((otherExerciseId) => {
    setExercises((prev) => {
      const idx = currentExerciseIndex;
      if (idx < 0 || idx >= prev.length) return prev;
      const gid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      return prev.map((ex, i) => {
        if (i === idx || ex.id === otherExerciseId) {
          return { ...ex, groupId: gid, groupType: 'superset' };
        }
        return ex;
      });
    });
    setShowSupersetPicker(false);
  }, [currentExerciseIndex]);

  const handleSupersetAddNew = useCallback(() => {
    const cur = exercises[currentExerciseIndex];
    if (cur) supersetPendingForRef.current = cur.id;
    setShowSupersetPicker(false);
    setShowAddExercise(true);
  }, [exercises, currentExerciseIndex]);
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

        // ── In-workout actions surfaced from the Watch action pills ──
        case 'add_set': {
          // Append a blank set to the current exercise. We can't call
          // handleAddSet from here directly (it's defined later in the
          // file and would create a forward-ref problem), so duplicate
          // the minimal logic. Same shape handleAddSet uses.
          const curEx = exercises[currentExerciseIndex];
          if (!curEx) break;
          setLoggedSets(prev => {
            const cur = prev[curEx.id] || [];
            return {
              ...prev,
              [curEx.id]: [
                ...cur,
                { weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '' },
              ],
            };
          });
          break;
        }
        case 'remove_set': {
          // Drop the LAST not-yet-completed set so we never lose logged data.
          const curEx = exercises[currentExerciseIndex];
          if (!curEx) break;
          setLoggedSets(prev => {
            const cur = prev[curEx.id] || [];
            // Find the last unfilled, non-completed slot
            for (let i = cur.length - 1; i >= 0; i--) {
              if (!cur[i].completed) {
                if (cur.length <= 1) return prev; // never wipe to zero
                const copy = cur.slice();
                copy.splice(i, 1);
                return { ...prev, [curEx.id]: copy };
              }
            }
            return prev;
          });
          break;
        }
        case 'skip_set': {
          // Mark the current pending set as skipped + completed (matches
          // the iPhone's existing handleRemoveSet behaviour).
          const curEx = exercises[currentExerciseIndex];
          if (!curEx) break;
          const sets = loggedSets[curEx.id] || [];
          const idx = sets.findIndex(s => !s.completed);
          if (idx < 0) break;
          setLoggedSets(prev => {
            const cur = prev[curEx.id] || [];
            const copy = cur.slice();
            copy[idx] = { ...copy[idx], skipped: true, completed: true };
            return { ...prev, [curEx.id]: copy };
          });
          break;
        }
        case 'add_exercise': {
          const exId = msg.exerciseId;
          const exName = msg.exerciseName;
          if (!exId && !exName) break;
          const found = exId ? localExercises.find(e => e.id === exId) : null;
          const stub = found || {
            id:           exId || `watch_${Date.now()}`,
            name:         exName || 'Exercise',
            name_es:      null,
            defaultSets:  3,
            defaultReps:  10,
            videoUrl:     null,
            instructions: null,
          };
          handleAddExerciseToSession(stub);
          // The user added this from the watch *because they want to do it
          // now*, so jump the active exercise pointer to it. Snapshot the
          // current length BEFORE the state update lands — after append
          // the new exercise lives at index `exercises.length`.
          const newIndex = exercises.length;
          setTimeout(() => {
            setCurrentExerciseIndex(newIndex);
          }, 60);
          break;
        }
      }
    });
    return unsub;
  }, [exercises, currentExerciseIndex, loggedSets]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── State for empty workout mode (add exercise picker) ────────────────────
  const isEmptyMode = IS_EMPTY_SESSION(id);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState('');
  // Active chip filter for the in-session library grid. 'all' = no filter.
  const [addExerciseChip, setAddExerciseChip] = useState('all');
  // Tracks where the AddExercise modal was opened from so closing returns
  // the user to that surface (e.g. tapping X from inside the list manager
  // reopens the list manager instead of dropping back to the workout view).
  const [addExerciseOrigin, setAddExerciseOrigin] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState('');
  const [previewExercise, setPreviewExercise] = useState(null);
  const [adjustedRestSeconds, setAdjustedRestSeconds] = useState(null);
  // Favorites: user's own saved exercises are auto-favorites
  const [favoriteExerciseIds, setFavoriteExerciseIds] = useState(new Set());
  // DB exercises (gym's own catalogue + user-created customs). Fetched once
  // per session so customs added via the swap modal show up in search/swap
  // next time without a page reload. Re-fetched when the Add Exercise modal
  // opens too, so a brand-new custom created mid-session is visible.
  const [dbExerciseMap, setDbExerciseMap] = useState({});
  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      supabase.from('exercise_favorites').select('exercise_id').eq('user_id', user.id),
      supabase.from('exercises').select('id, name, name_es, muscle_group, equipment, default_sets, default_reps, rest_seconds, instructions, instructions_es, video_url, primary_regions, secondary_regions'),
    ]).then(([favRes, exRes]) => {
      if (favRes.data) setFavoriteExerciseIds(new Set(favRes.data.map(r => r.exercise_id)));
      if (exRes.data) {
        const map = {};
        exRes.data.forEach(e => { map[e.id] = e; });
        setDbExerciseMap(map);
      }
    });
  }, [user?.id, showAddExercise]);

  // Library-shaped list = static local data (with DB Spanish names merged in)
  // + any DB-only customs that don't exist locally. Custom rows lack the
  // hand-curated `muscleScores`; we default them to {} so they still pass
  // muscle-filter checks and just won't rank high in suggestions.
  const enrichedLocalExercises = useMemo(() => {
    const localIds = new Set(localExercises.map(e => e.id));
    const dbCustoms = Object.values(dbExerciseMap)
      .filter((db) => !localIds.has(db.id))
      .map((db) => ({
        id: db.id,
        name: db.name,
        name_es: db.name_es || null,
        muscle: db.muscle_group || 'Full Body',
        equipment: db.equipment || 'Bodyweight',
        category: 'Strength',
        defaultSets: db.default_sets || 3,
        defaultReps: db.default_reps || 10,
        restSeconds: db.rest_seconds || 90,
        instructions: db.instructions || null,
        instructions_es: db.instructions_es || null,
        primaryRegions: db.primary_regions || [],
        secondaryRegions: db.secondary_regions || [],
        videoUrl: db.video_url || null,
        muscleScores: {},
      }));
    const enrichedLocal = localExercises.map((ex) => {
      const db = dbExerciseMap[ex.id];
      return db ? { ...ex, name_es: db.name_es } : ex;
    });
    return [...enrichedLocal, ...dbCustoms];
  }, [dbExerciseMap]);

  const filteredLibraryExercises = useMemo(() => {
    if (!showAddExercise) return [];
    const q = exerciseSearch.toLowerCase().trim();
    const addedIds = new Set(exercises.map(e => e.id));
    const chipRegions = ADD_EXERCISE_CHIP_REGIONS[addExerciseChip] || null;
    return enrichedLocalExercises.filter(ex => {
      if (addedIds.has(ex.id)) return false;
      if (selectedMuscle && ex.muscle !== selectedMuscle) return false;
      if (selectedEquipment && ex.equipment !== selectedEquipment) return false;
      if (showFavoritesOnly && !favoriteExerciseIds.has(ex.id)) return false;
      if (chipRegions) {
        const exRegions = ex.primaryRegions || [];
        if (!exRegions.some((r) => chipRegions.includes(r))) return false;
      }
      if (q) {
        const name = (exName(ex) || ex.name).toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    }).slice(0, 50);
  }, [exerciseSearch, selectedMuscle, selectedEquipment, showAddExercise, exercises, showFavoritesOnly, favoriteExerciseIds, enrichedLocalExercises, addExerciseChip]);

  // Suggested-for-this-session picks — computed once per `exercises` list
  // change. Hidden when the user is searching/filtering so it doesn't fight
  // for attention.
  const suggestedExercises = useMemo(() => {
    if (!showAddExercise) return [];
    return getSessionSuggestions(exercises, { topN: 6, library: enrichedLocalExercises });
  }, [exercises, enrichedLocalExercises, showAddExercise]);

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
    // Superset pending: when the user opened the AddExercise modal from the
    // SupersetPickerModal's "Add new" CTA, group the newly-added exercise
    // with the originating exercise. Cleared after consumption.
    const supersetWithId = supersetPendingForRef.current;
    supersetPendingForRef.current = null;
    setExercises(prev => {
      if (supersetWithId) {
        const gid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        return [
          ...prev.map(ex => ex.id === supersetWithId ? { ...ex, groupId: gid, groupType: 'superset' } : ex),
          { ...newEx, groupId: gid, groupType: 'superset' },
        ];
      }
      return [...prev, newEx];
    });
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
        workoutLabel: t('activeSession.liveActivityWorkout', 'Workout'),
        restLabel: t('activeSession.rest', 'Rest'),
      }).catch(() => {});
    }
    setShowAddExercise(false);
    setExerciseSearch('');
    setSelectedMuscle('');
    setWorkoutComplete(false);
    // Return to whichever surface the user opened the modal from. If they
    // came from the list manager, drop them back into the list (which now
    // includes the newly-added exercise) so they can keep adding without
    // bouncing through the workout view.
    const wasFromListManager = addExerciseOrigin === 'list-manager';
    setAddExerciseOrigin(null);
    setAddExerciseChip('all');
    if (wasFromListManager) {
      setShowListManager(true);
    } else if (exercises.length > 0) {
      // Workout-origin path: focus the newly-added exercise.
      setCurrentExerciseIndex(exercises.length);
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

      // ── Watch-initiated free lift: seed the exercise from URL params ─
      // The Watch's free-lift picker hands us `?exerciseId=...&exerciseName=...`.
      // Resolve it against the bundled library; if not found, drop a
      // minimal stub using just the supplied name so set logging still
      // works. Only fires when there are no exercises yet (fresh start —
      // we don't want to re-add it during a resume).
      const params = new URLSearchParams(location.search || '');
      const watchExId = params.get('exerciseId');
      const watchExName = params.get('exerciseName');
      const alreadyHasExercises = (savedSession?.exercises?.length || 0) > 0;
      if ((watchExId || watchExName) && !alreadyHasExercises) {
        const found = watchExId ? localExercises.find((e) => e.id === watchExId) : null;
        const stub = found || {
          id:           watchExId || `watch_${Date.now()}`,
          name:         watchExName || 'Exercise',
          name_es:      null,
          defaultSets:  3,
          defaultReps:  10,
          videoUrl:     null,
          instructions: null,
        };
        // Defer so the empty-state setExercises([]) above commits first.
        setTimeout(() => handleAddExerciseToSession(stub), 0);
      }
      return;
    }

    const load = async () => {
      try {
      // If we already hydrated from localStorage, this fetch is a background
      // revalidation — don't flip dataLoading back to true or the spinner
      // will briefly replace the workout UI. Only show the spinner when we
      // have no local data at all.
      if (!canHydrateInstantly) setDataLoading(true);

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
      const [{ data: prs }, { data: onboarding }, { data: lastSessions }, { data: dbDraft }, { data: recoverySessions }, { data: mesoDates }] = await Promise.all([
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
          .select('id, completed_at')
          .eq('profile_id', user.id)
          .eq('routine_id', id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(6),
        supabase
          .from('session_drafts')
          .select('logged_sets, session_prs, live_prs, current_exercise_index, elapsed_time, started_at, is_paused, exercises, removed_exercise_ids, skipped_exercise_ids')
          .eq('profile_id', user.id)
          .eq('routine_id', id)
          .gte('updated_at', cutoff)
          .maybeSingle(),
        // Cross-routine recent sessions WITH sets — feeds per-muscle readiness
        // (#1) so a split program's other-day fatigue still softens today's
        // targets. 7-day window matches computeReadiness's default.
        supabase
          .from('workout_sessions')
          .select('id, completed_at, session_exercises(exercise_id, session_sets(weight_lbs, reps, is_completed))')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', new Date(Date.now() - 7 * 86400000).toISOString())
          .order('completed_at', { ascending: false }),
        // Session DATES over ~10 weeks for mesocycle week-counting (#4) —
        // lightweight (no sets); drives the planned deload week.
        supabase
          .from('workout_sessions')
          .select('completed_at')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', new Date(Date.now() - 70 * 86400000).toISOString())
          .order('completed_at', { ascending: false }),
      ]);

      const prMap = {};
      prs?.forEach(pr => { prMap[pr.exercise_id] = { weight: pr.weight_lbs, reps: pr.reps }; });
      livePRs.current = prMap;
      onboardingRef.current = onboarding;

      const prevSetsMap = {};
      // consecutiveMap[exerciseId] = how many of the most recent sessions show
      // an UNBROKEN run of strength progression (each session's best estimated
      // 1RM beating the prior one). Feeds the deload trigger in computeSuggestion
      // (shouldDeload fires at >= 4). Previously this was hardcoded to 0, so the
      // automatic deload never fired.
      const consecutiveMap = {};
      // Per-muscle readiness map (#1) — built from ALL completed sessions in the
      // last 7 days (cross-routine, so a split program's other-day fatigue isn't
      // missed), letting the overload suggestion soften targets for fatigued
      // muscles. Empty history → all-fresh map → modulation is a safe no-op.
      const readinessMap = computeReadiness(
        (recoverySessions || []).map(s => ({
          id: s.id,
          completed_at: s.completed_at,
          workout_sets: (s.session_exercises || []).flatMap(se =>
            (se.session_sets || []).map(st => ({
              exercise_id: se.exercise_id,
              weight_lbs: st.weight_lbs,
              reps: st.reps,
              completed: st.is_completed,
            }))
          ),
        })),
        { windowDays: 7 },
      );

      // Mesocycle position (#4) — on the cycle's planned deload week, pull all
      // working weights back. Derived from ~10 weeks of session dates; no
      // stored state, and a missed week naturally resets the cycle.
      const meso = getMesocyclePosition(mesoDates || [], { level: onboarding?.fitness_level });
      const mesoDeloadFactor = meso.isDeloadWeek ? MESO_DELOAD_FACTOR : 1;
      if (lastSessions?.length > 0) {
        // Sessions are already ordered newest-first. Pull every exercise's sets
        // across all of them in ONE query, then derive both the most-recent
        // history (for suggestions) and the per-exercise progression streak.
        const sessionOrder = lastSessions.map(s => s.id); // newest → oldest
        const sessionRank = new Map(sessionOrder.map((sid, i) => [sid, i]));

        const { data: allExercises } = await supabase
          .from('session_exercises')
          .select(`session_id, exercise_id, session_sets(set_number, weight_lbs, reps, is_completed, rpe)`)
          .in('session_id', sessionOrder);

        // exerciseId → array indexed by session rank (0 = newest) of best e1RM
        const bestByExercise = {};
        (allExercises || []).forEach(se => {
          const completed = (se.session_sets || [])
            .filter(s => s.is_completed)
            .sort((a, b) => a.set_number - b.set_number)
            .map(s => ({ weight: s.weight_lbs, reps: s.reps, rpe: s.rpe }));

          // Most-recent session populates the suggestion history (incl. RPE so
          // computeSuggestion can autoregulate aggressiveness — #2).
          if (sessionRank.get(se.session_id) === 0) {
            prevSetsMap[se.exercise_id] = completed.map(s => ({ weight: s.weight, reps: s.reps, rpe: s.rpe }));
          }

          const rank = sessionRank.get(se.session_id);
          if (rank == null) return;
          const bestE1RM = completed.reduce((m, s) => Math.max(m, epley1RM(s.weight, s.reps)), 0);
          if (!bestByExercise[se.exercise_id]) bestByExercise[se.exercise_id] = [];
          bestByExercise[se.exercise_id][rank] = bestE1RM;
        });

        // Count the trailing run of strictly-increasing best e1RM (newest first).
        Object.entries(bestByExercise).forEach(([exId, bests]) => {
          let streak = 0;
          for (let i = 0; i < bests.length - 1; i++) {
            const cur = bests[i];
            const prev = bests[i + 1];
            if (cur != null && prev != null && cur > prev) streak++;
            else break;
          }
          consecutiveMap[exId] = streak;
        });
      }

      // Read recovery-driven deload opt-in (set by ReadinessModal when score
      // is low). Consumed once per session and cleared on draft start below.
      let recoveryDeloadFactor = 1;
      try {
        const flag = localStorage.getItem('recovery_deload_pending_v1');
        if (flag) {
          const parsed = JSON.parse(flag);
          // Honor the flag if it was set in the last 6h.
          if (parsed && typeof parsed.factor === 'number'
              && parsed.factor > 0 && parsed.factor < 1
              && Date.now() - (parsed.setAt || 0) < 6 * 60 * 60 * 1000) {
            recoveryDeloadFactor = parsed.factor;
          }
        }
      } catch {
        // ignore parse errors
      }

      const enriched = sortedExercises.map(ex => {
        const libEx = localExercises.find(e => e.id === ex.id);
        const exerciseMeta = libEx ? { movementPattern: libEx.movementPattern } : null;
        const prevForEx = prevSetsMap[ex.id] || [];
        const baseSuggestion = computeSuggestion(prevForEx, onboarding, ex.targetReps, consecutiveMap[ex.id] || 0, exerciseMeta, prMap[ex.id] || null);
        // ── Diagnostic for fix #5 (suggested PR accuracy) ────────────────────
        // The "Suggested" chip is derived from the most recent completed
        // session only (see lastSessions[0] above). It does NOT cross-reference
        // the personal_records table, so if a PR was set on a different day
        // than the most recent session it can drift behind. Logging the inputs
        // vs. output here so we can diagnose stale suggestions in the field.
        // Safe to leave on — only fires once per session per exercise.
        try {
          // eslint-disable-next-line no-console
          console.log('[ActiveSession] suggestion inputs', {
            exerciseId: ex.id,
            exerciseName: ex.name,
            prevSetsCount: prevForEx.length,
            prevSetsSample: prevForEx.slice(0, 3),
            knownPR: prMap[ex.id] || null,
            targetReps: ex.targetReps,
            suggestion: baseSuggestion,
          });
        } catch { /* logging is non-critical */ }
        // Per-muscle readiness modulation (#1): soften THIS exercise's target
        // when its prime-mover muscle is still fatigued — recovery-aware, still
        // one tap to accept.
        const exReadiness = readinessMap ? exerciseReadiness(readinessMap, ex.id) : null;
        let suggestion = applyReadinessToSuggestion(baseSuggestion, exReadiness);

        // The whole-body opt-in deload (ReadinessModal flag) still applies, but
        // as a FLOOR — take whichever is lighter so the per-muscle and global
        // signals never stack into an absurdly light target. Keeps reps alone so
        // users still hit their target rep range at the lighter load.
        if (recoveryDeloadFactor < 1 && baseSuggestion?.suggestedWeight) {
          const globalWeight = Math.max(5, Math.round(baseSuggestion.suggestedWeight * recoveryDeloadFactor / 2.5) * 2.5);
          if (!suggestion?.suggestedWeight || globalWeight < suggestion.suggestedWeight) {
            suggestion = {
              ...baseSuggestion,
              suggestedWeight: globalWeight,
              note: 'recovery_deload',
              label: `Recovery deload — ${Math.round((1 - recoveryDeloadFactor) * 100)}% lighter`,
            };
          }
        }

        // Planned mesocycle deload (#4): on the cycle's deload week, pull every
        // working weight back. Same "lighter wins" rule so it never stacks with
        // the per-muscle or whole-body deloads.
        if (mesoDeloadFactor < 1 && baseSuggestion?.suggestedWeight) {
          const mesoWeight = Math.max(5, Math.round(baseSuggestion.suggestedWeight * mesoDeloadFactor / 2.5) * 2.5);
          if (!suggestion?.suggestedWeight || mesoWeight < suggestion.suggestedWeight) {
            suggestion = {
              ...baseSuggestion,
              suggestedWeight: mesoWeight,
              note: 'meso_deload',
              label: `Deload week — ${Math.round((1 - mesoDeloadFactor) * 100)}% lighter (planned recovery)`,
            };
          }
        }
        return {
          ...ex,
          movementPattern: libEx?.movementPattern || null,
          history:    prevSetsMap[ex.id] || [],
          suggestion,
        };
      });

      // Clear the deload flag once consumed so it doesn't persist into the
      // next session.
      if (recoveryDeloadFactor < 1) {
        try { localStorage.removeItem('recovery_deload_pending_v1'); } catch { /* ignore */ }
      }
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
            exercises:             Array.isArray(dbDraft.exercises) ? dbDraft.exercises : null,
            removedExerciseIds:    dbDraft.removed_exercise_ids ?? [],
            skippedExerciseIds:    dbDraft.skipped_exercise_ids ?? [],
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
              exercises:            Array.isArray(savedSession.exercises) ? savedSession.exercises : null,
              removedExerciseIds:   savedSession.removedExerciseIds ?? [],
              skippedExerciseIds:   savedSession.skippedExerciseIds ?? [],
            }
          : null;

      // If the draft has its own exercises array (because the user swapped /
      // added / removed mid-session), prefer it over the routine snapshot —
      // but RE-ENRICH each entry with the latest PR + suggestion data so
      // `prevSetsMap`/`prMap` updates from this session's queries still apply.
      // Falls back to the routine-derived `enriched` only when no draft
      // exercises are stored (fresh start, or pre-0368 draft with no column).
      let finalExercises;
      if (draft?.exercises && draft.exercises.length > 0) {
        finalExercises = draft.exercises.map(draftEx => {
          const enrichedMatch = enriched.find(e => e.id === draftEx.id);
          const libEx = localExercises.find(e => e.id === draftEx.id);
          const prevForEx = prevSetsMap[draftEx.id] || [];
          const baseSuggestion = enrichedMatch?.suggestion
            ?? applyReadinessToSuggestion(
                 computeSuggestion(prevForEx, onboarding, draftEx.targetReps, consecutiveMap[draftEx.id] || 0,
                                   libEx ? { movementPattern: libEx.movementPattern } : null,
                                   prMap[draftEx.id] || null),
                 readinessMap ? exerciseReadiness(readinessMap, draftEx.id) : null,
               );
          return {
            ...draftEx,
            movementPattern: libEx?.movementPattern || draftEx.movementPattern || null,
            history: prevForEx,
            suggestion: baseSuggestion,
          };
        });
      } else {
        // Filter out exercises that were removed during a previous session
        const draftRemovedIds = draft?.removedExerciseIds ?? [];
        finalExercises = draftRemovedIds.length > 0
          ? enriched.filter(ex => !draftRemovedIds.includes(ex.id))
          : enriched;
        if (draftRemovedIds.length > 0) setRemovedExerciseIds(draftRemovedIds);
      }
      if (draft?.removedExerciseIds?.length > 0) setRemovedExerciseIds(draft.removedExerciseIds);
      const draftSkippedIds = draft?.skippedExerciseIds ?? [];
      if (draftSkippedIds.length > 0) setSkippedExerciseIds(draftSkippedIds);
      setExercises(finalExercises);

      // Check if draft exercises match the current routine — discard stale drafts
      const currentExerciseIds = new Set(finalExercises.map(ex => ex.id));
      const draftExerciseIds = draft?.loggedSets ? Object.keys(draft.loggedSets) : [];
      const draftMatchesRoutine = draftExerciseIds.length > 0 &&
        draftExerciseIds.some(eid => currentExerciseIds.has(eid));

      if (draft?.loggedSets && draftMatchesRoutine) {
        const restored = {};
        finalExercises.forEach(ex => {
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
        finalExercises.forEach(ex => {
          initialSets[ex.id] = Array.from({ length: ex.targetSets }).map(() => ({
            weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '',
          }));
        });
        setLoggedSets(initialSets);
      }

      // Cache workout data for offline use
      try { cacheWorkoutData(id, { exercises: finalExercises, routineName: localizeRoutineName(routine.name) }); } catch { }

      setDataLoading(false);
      } catch (err) {
        console.error('ActiveSession load failed', err);
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
          setError(t('activeSession.loadFailed', "Couldn't load this workout. Go back and try again."));
          setDataLoading(false);
        }
      }
    };

    load();
  }, [id, user, profile]);

  // ── Persistent lock-screen notification + Live Activity ─────────────────────
  useEffect(() => {
    if (dataLoading || !exercises.length) return;
    posthog?.capture('workout_started', { routine_name: routineName, exercise_count: exercises.length });
    // Exclude skipped exercises' remaining sets from the totals so the Live
    // Activity denominator reflects what the user actually still has to do.
    // (Removed exercises are already pruned from loggedSets in handleRemoveExercise.)
    const activeSetsFlat = Object.entries(loggedSets)
      .filter(([exId]) => !skippedExerciseIds.includes(exId))
      .flatMap(([, sets]) => sets);
    const skippedCompleted = Object.entries(loggedSets)
      .filter(([exId]) => skippedExerciseIds.includes(exId))
      .flatMap(([, sets]) => sets)
      .filter(s => s.completed).length;
    const cs = activeSetsFlat.filter(s => s.completed).length + skippedCompleted;
    const ts = activeSetsFlat.length + skippedCompleted;
    // Start Live Activity (lock screen + Dynamic Island) — iOS only
    startLiveActivity({
      routineName,
      totalSets: ts,
      completedSets: cs,
      currentExerciseName: exName(exercises[currentExerciseIndex]) ?? '',
      startTimestamp: sessionStartTime.current,
      // Pass localized labels so iOS widget reads in user's language. The
      // Swift-side fallback still hardcodes English if the plugin ignores
      // these keys — see flag in return notes.
      workoutLabel: t('activeSession.liveActivityWorkout', 'Workout'),
      restLabel: t('activeSession.rest', 'Rest'),
    }).then(() => {
      // Live Activity started — skip fallback notification
    }).catch(() => {
      // Only use notification fallback if Live Activity failed
      if (ts > 0) startWorkoutNotification(sessionStartTime.current, cs, ts);
    });
  }, [dataLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dataLoading) return;
    // Recompute totals every tick so deletions/skips immediately move the
    // Dynamic Island denominator. Skipped exercises are treated as completed:
    // their remaining sets drop out, and any sets the user had already logged
    // on them still count toward `completedSets`.
    const activeSetsFlat = Object.entries(loggedSets)
      .filter(([exId]) => !skippedExerciseIds.includes(exId))
      .flatMap(([, sets]) => sets);
    const skippedCompleted = Object.entries(loggedSets)
      .filter(([exId]) => skippedExerciseIds.includes(exId))
      .flatMap(([, sets]) => sets)
      .filter(s => s.completed).length;
    const cs = activeSetsFlat.filter(s => s.completed).length + skippedCompleted;
    const ts = activeSetsFlat.length + skippedCompleted;
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
        isPaused,
        workoutLabel: t('activeSession.liveActivityWorkout', 'Workout'),
        restLabel: t('activeSession.rest', 'Rest'),
      });
      // Sync to Apple Watch — send actual set weight/reps if available
      const watchSetIdx = curEx ? (loggedSets[curEx.id] || []).findIndex(s => !s.completed) : -1;
      const watchActiveSet = watchSetIdx >= 0 ? loggedSets[curEx.id][watchSetIdx] : null;
      const watchRestRemaining = isResting && restStartedAt.current
        ? Math.max(0, Math.ceil((restStartedAt.current + currentRestDurationRef.current * 1000 - Date.now()) / 1000))
        : 0;
      // The Watch's "SET X OF Y" eyebrow expects per-exercise totals —
      // it's the count of sets for the *current* exercise, not the
      // workout-wide total (which the Live Activity uses). Sending `ts`
      // here was making the watch report inflated set counts whenever
      // the workout had multiple exercises.
      // Cap setNumber at totalSets so the moment the user finishes the
      // last set we don't briefly broadcast "SET 5 OF 4" before the
      // phone advances to the next exercise.
      const cappedSetNumber = curExTotal > 0
        ? Math.min(curExDone + 1, curExTotal)
        : curExDone + 1;
      syncWorkoutToWatch({
        exerciseName: exName(curEx) ?? '',
        setNumber: cappedSetNumber,
        totalSets: curExTotal,
        suggestedWeight: watchActiveSet?.weight ? Number(watchActiveSet.weight) : (curEx?.suggestedWeight ?? 0),
        suggestedReps: watchActiveSet?.reps ? Number(watchActiveSet.reps) : (curEx?.suggestedReps ?? 0),
        restSeconds: curEx?.rest_seconds ?? 90,
        isResting,
        elapsedSeconds: now,
        exerciseCategory: curEx?.category || curEx?.muscle_group || 'unknown',
        restRemainingSeconds: watchRestRemaining,
      });
    } catch (e) { /* Live Activity update failed — non-critical */ }
  }, [loggedSets, dataLoading, isResting, restTimer, currentExerciseIndex, isPaused, skippedExerciseIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session timer — pauses when isPaused, drift-free via Date.now() ─────────
  // Date.now() can jump backward on NTP sync / time-zone change. Clamp the
  // computed elapsed to a monotonic floor so the displayed timer never goes
  // backward mid-session (would feel like a bug to the user, even briefly).
  useEffect(() => {
    if (isPaused) return;
    sessionStartTime.current = Date.now() - elapsedTime * 1000;
    lastTickAt.current = Date.now();
    let lastElapsedFloor = elapsedTime;
    const interval = setInterval(() => {
      const computed = Math.floor((Date.now() - sessionStartTime.current) / 1000);
      const next = computed > lastElapsedFloor ? computed : lastElapsedFloor;
      lastElapsedFloor = next;
      lastTickAt.current = Date.now();
      setElapsedTime(next);
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
    // Refreshed on every render so forceSave (visibilitychange/beforeunload)
    // preserves an accurate "last touched" timestamp — used by the conflict
    // dialog gate to avoid prompting users mid-session (fix #11).
    lastUpdated: new Date().toISOString(),
    elapsedTime,
    loggedSets,
    sessionPRs,
    livePRs: livePRs.current,
    currentExerciseIndex,
    routineName,
    exerciseSwaps,
    isPaused,
    warmUpPhase,
    removedExerciseIds,
    skippedExerciseIds,
    exercises, // Persist exercises so removed ones stay removed on reload
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
      // Persist the live exercises array so swaps / adds / removals survive
      // app kill, WebView eviction, or device reboot — not just localStorage
      // (which iOS may purge under memory pressure). Schema column added in
      // migration 0368.
      exercises,
      removed_exercise_ids: removedExerciseIds,
      skipped_exercise_ids: skippedExerciseIds,
      updated_at: new Date().toISOString(),
    };
  }

  // ── Save draft to DB (fire-and-forget) ──────────────────────────────────────
  const saveDraftToDb = async (overrideLoggedSets = null) => {
    // Never save after finish/discard — a save landing after the discard's
    // DELETE leaves a zombie session_drafts row that resurrects the "Resume"
    // chip every time this routine is reopened (DB draft wins on load).
    if (sessionEndedRef.current) return;
    if (!draftSaveRef.current) return;
    const payload = overrideLoggedSets
      ? { ...draftSaveRef.current, logged_sets: overrideLoggedSets }
      : draftSaveRef.current;
    try {
      await supabase.from('session_drafts')
        .upsert(payload, { onConflict: 'profile_id,routine_id' });
    } catch (err) {
      // Draft save failed — non-critical, data still in localStorage
      setSaveWarning(t('activeSession.draftSaveFailed'));
      setTimeout(() => setSaveWarning(''), 3000);
    }
  };

  // ── Reactive DB-draft persistence (debounced) ──────────────────────────────
  // Catches every state change (typing, swap, skip, remove, navigate) so the
  // session survives an iOS WebView eviction or a phone reboot — not just an
  // explicit "Complete Set" tap. Debounced 700ms so we don't spam Supabase
  // on every keystroke. handleToggleComplete still fires its own immediate
  // saveDraftToDb for the on-completion case.
  const dbSaveDebounceRef = useRef(null);
  useEffect(() => {
    if (dataLoading || !draftSaveRef.current) return;
    if (dbSaveDebounceRef.current) clearTimeout(dbSaveDebounceRef.current);
    dbSaveDebounceRef.current = setTimeout(() => {
      try { saveDraftToDb(); } catch { /* non-critical */ }
    }, 700);
    return () => {
      if (dbSaveDebounceRef.current) clearTimeout(dbSaveDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, loggedSets, currentExerciseIndex, removedExerciseIds, skippedExerciseIds, isPaused, dataLoading]);

  // ── Persist to localStorage ─────────────────────────────────────────────────
  useEffect(() => {
    // sessionEndedRef guard: after discard removes the draft, the elapsed
    // timer keeps ticking until unmount — one tick re-ran this effect and
    // REWROTE the draft, so the workout "always kept showing as resume".
    if (dataLoading || sessionEndedRef.current) return;
    try {
      localStorage.setItem(sessionKey, JSON.stringify({
        startedAt: startedAt.current,
        lastUpdated: new Date().toISOString(),
        elapsedTime,
        loggedSets,
        sessionPRs,
        livePRs: livePRs.current,
        currentExerciseIndex,
        routineName,
        warmUpPhase,
        removedExerciseIds,
        skippedExerciseIds,
        exercises, // Persist exercises so removed ones stay removed on reload
      }));
    } catch { }
  }, [loggedSets, sessionPRs, dataLoading, sessionKey, currentExerciseIndex, elapsedTime, routineName, exercises, warmUpPhase, removedExerciseIds]);

  // ── Force-save on browser close or tab switch to background ─────────────────
  useEffect(() => {
    const forceSave = () => {
      if (sessionEndedRef.current) return; // finished/discarded — never re-save
      if (saveRef.current && saveRef.current.loggedSets && Object.keys(saveRef.current.loggedSets).length > 0) {
        try { localStorage.setItem(sessionKey, JSON.stringify(saveRef.current)); } catch { }
      }
      // Also fire-and-forget the DB save. supabase-js will queue the request;
      // it may complete on next foreground if the app was suspended mid-flight.
      // Skip if no draft ref (component still loading).
      if (draftSaveRef.current) {
        try { saveDraftToDb(); } catch { /* non-critical */ }
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
      // Catch up rest timer — read from localStorage (source of truth, survives suspension).
      // If the user paused before backgrounding, the persisted state has isPaused === true
      // and we must NOT auto-resume the countdown — wait for an explicit Resume tap.
      try {
        const raw = localStorage.getItem(`gym_rest_${id}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const { restStartedAt: rsa, duration, isPaused: persistedPaused } = parsed;
          if (persistedPaused) {
            // Frozen — keep the timer where it was, don't tick during background.
            restStartedAt.current = rsa ?? null;
            currentRestDurationRef.current = duration ?? currentRestDurationRef.current;
            // Don't touch setIsResting / setRestTimer — leave whatever was there.
            return;
          }
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
      // Re-flush any queued offline writes (failed saves from earlier sessions).
      try { flushQueue(supabase); } catch { }
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
    // Tick every 100ms — visually smoother, still drift-proof since each tick
    // recomputes the remaining time from the anchor timestamp instead of
    // decrementing a counter. (RAF would require restructuring the cleanup
    // contract, so a shortened interval is the minimal-risk path here.)
    const interval = setInterval(() => {
      if (!restStartedAt.current) return;
      const elapsed = Math.floor((Date.now() - restStartedAt.current) / 1000);
      const remaining = Math.max(0, currentRestDurationRef.current - elapsed);
      setRestTimer(remaining);
    }, 100);
    return () => clearInterval(interval);
  }, [isResting, restTimer, isPaused, exercises, currentExerciseIndex, restStateKey]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const handleRemoveSet = (exerciseId, setIndex) => {
    setLoggedSets(prev => {
      const current = prev[exerciseId] || [];
      // Don't allow skipping if it's the only non-skipped set left
      const nonSkipped = current.filter(s => !s.skipped);
      if (nonSkipped.length <= 1) return prev;
      const updated = [...current];
      updated[setIndex] = { ...updated[setIndex], skipped: true, completed: true };
      // Persist immediately
      const newSets = { ...prev, [exerciseId]: updated };
      try {
        localStorage.setItem(sessionKey, JSON.stringify({ ...saveRef.current, loggedSets: newSets }));
      } catch { }
      saveDraftToDb(newSets);
      return newSets;
    });
  };

  // Drops contribute to total volume (weight × reps per drop) so a set with
  // an extended dropset still rolls up correctly into session stats.
  const totalVolume = Object.entries(loggedSets).reduce((sum, [, sets]) =>
    sum + sets.filter(s => s.completed && !s.skipped).reduce((s2, set) => {
      let setVol = (parseFloat(set.weight) || 0) * (parseInt(set.reps, 10) || 0);
      if (Array.isArray(set.drops)) {
        for (const d of set.drops) {
          setVol += (parseFloat(d.weight) || 0) * (parseInt(d.reps, 10) || 0);
        }
      }
      return s2 + setVol;
    }, 0)
  , 0);

  // Helper: is an exercise bodyweight? Local data uses `equipment === 'Bodyweight'`.
  // TODO: if the data model later adds `is_bodyweight`, prefer that explicit flag.
  const isBodyweightExercise = useCallback((ex) => {
    if (!ex) return false;
    const local = localExercises.find(e => e.id === ex.id);
    const eq = (ex.equipment || local?.equipment || '').toString().toLowerCase();
    return eq === 'bodyweight';
  }, []);

  // Display-only volume: bodyweight sets logged with weight 0 don't add anything
  // to the visible volume number — they show as "BW × N reps" instead. This does
  // NOT change the value sent to the DB (`totalVolume` is still the source of truth
  // for `total_volume_lbs`).
  const displayedVolume = useMemo(() => {
    return Object.entries(loggedSets).reduce((sum, [exId, sets]) => {
      const ex = exercises.find(e => e.id === exId);
      const bw = isBodyweightExercise(ex);
      return sum + sets.filter(s => s.completed && !s.skipped).reduce((s2, set) => {
        const w = parseFloat(set.weight) || 0;
        const r = parseInt(set.reps, 10) || 0;
        if (bw && w === 0) return s2; // BW × N reps — exclude from displayed volume
        return s2 + w * r;
      }, 0);
    }, 0);
  }, [loggedSets, exercises, isBodyweightExercise]);

  const completedSets = Object.values(loggedSets).flat().filter(s => s.completed && !s.skipped).length;
  const totalSets     = Object.values(loggedSets).flat().length;

  // ── Derive worked muscle regions from completed sets ────────────────────────
  const workedRegions = useMemo(() => {
    const primary   = new Set();
    const secondary = new Set();
    exercises.forEach(ex => {
      const sets = loggedSets[ex.id] || [];
      if (!sets.some(s => s.completed && !s.skipped)) return;
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
      // Synchronously persist typed values to localStorage so a kill/lock between
      // keystroke and the next render doesn't lose the input. The debounced DB
      // save useEffect picks this up shortly after.
      try {
        localStorage.setItem(sessionKey, JSON.stringify({ ...saveRef.current, loggedSets: updated }));
      } catch { }
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
        // Snapshot the exercise's group state onto the set itself so the
        // completed-set chip remembers whether it was logged while the
        // exercise was supersetted, even if the user ungroups later.
        const curEx = exercises.find(e => e.id === exerciseId);
        set.groupType = curEx?.groupType || null;
        set.groupId = curEx?.groupId || null;

        const prDetected = isPR(exerciseId, set.weight, set.reps, livePRs.current);
        set.isPR = prDetected;

        if (prDetected) {
          // Capture the previous best BEFORE we overwrite it — SharePRSheet
          // renders the delta ("up from X lbs") when this is available.
          const previousBest = livePRs.current?.[exerciseId] || null;
          const newPR = { weight: parseFloat(set.weight), reps: parseInt(set.reps, 10) };
          livePRs.current = { ...livePRs.current, [exerciseId]: newPR };
          const prEntry = {
            exerciseId,
            exercise: exerciseName,
            ...newPR,
            previousWeight: previousBest?.weight ?? null,
          };
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
              const queuedExtend = pendingRestExtendRef.current || 0;
              pendingRestExtendRef.current = 0;
              const totalRest = restSeconds + queuedExtend;
              setCurrentRestDuration(totalRest);
              setRestTimer(totalRest);
              restNotificationScheduled.current = false;
              restStartedAt.current = Date.now();
              currentRestDurationRef.current = totalRest;
              try {
                localStorage.setItem(restStateKey, JSON.stringify({
                  restStartedAt: Date.now(),
                  duration: totalRest,
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
            const queuedExtend = pendingRestExtendRef.current || 0;
            pendingRestExtendRef.current = 0;
            const totalRest = restSeconds + queuedExtend;
            setCurrentRestDuration(totalRest);
            setRestTimer(totalRest);
            restNotificationScheduled.current = false;
            restStartedAt.current = Date.now();
            currentRestDurationRef.current = totalRest;
            try {
              localStorage.setItem(restStateKey, JSON.stringify({
                restStartedAt: Date.now(),
                duration: totalRest,
              }));
            } catch { }
            setIsResting(true);
          }
        } else {
          // Last set — trigger finish after state updates
          // Use ref to avoid stale closure (this runs inside setLoggedSets updater)
          setTimeout(() => handleFinishRef.current?.(), 100);
        }
      } else {
        set.isPR = false;
      }

      updated[exerciseId][setIndex] = set;

      // ── Intra-session progressive overload: update suggestion for next set ──
      if (completing) {
        const completedSetsThisSession = updated[exerciseId]
          .filter(s => s.completed && !s.skipped && s.weight && s.reps)
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

  // ── Trainer-logged sets (cue 'set_log', migration 0549) ──────────────────
  // The trainer types weight/reps in TrainerLiveSession; we stamp them on the
  // target set and run the SAME completion path a member tap uses (PR
  // detection + confetti, rest timer, superset hops, auto-finish, draft
  // persistence — which echoes back to the trainer's live view). Editing an
  // already-completed set only rewrites its values: no re-toggle, no second
  // rest timer. Re-assigned every render so callbacks see fresh state.
  applyTrainerSetRef.current = (p) => {
    const exId = p?.exercise_id;
    const setIndex = Number(p?.set_index);
    if (!exId || !Number.isInteger(setIndex) || setIndex < 0) return false;
    const ex = exercises.find(e => e.id === exId);
    const sets = loggedSets[exId];
    if (!ex || !Array.isArray(sets) || setIndex >= sets.length) return false;
    const weight = (p.weight ?? '').toString().trim().slice(0, 8);
    const reps = (p.reps ?? '').toString().trim().slice(0, 5);
    if (!reps) return false;
    const wasCompleted = !!sets[setIndex]?.completed;
    setLoggedSets(prev => {
      const cur = prev[exId];
      if (!Array.isArray(cur) || setIndex >= cur.length) return prev;
      const updated = { ...prev, [exId]: [...cur] };
      updated[exId][setIndex] = { ...updated[exId][setIndex], weight, reps, skipped: false, coachLogged: true };
      try {
        localStorage.setItem(sessionKey, JSON.stringify({ ...saveRef.current, loggedSets: updated }));
      } catch { }
      if (wasCompleted) saveDraftToDb(updated); // value-only edit — persist now
      return updated;
    });
    if (!wasCompleted) {
      // Queued after the value-stamping updater above, so the completion
      // logic (PR check reads set.weight/reps) sees the coach's numbers.
      handleToggleComplete(exId, setIndex, ex.name_es || ex.name || '', ex.restSeconds ?? 90);
    }
    return true;
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

  // Returns { sameMuscle: [...], otherMuscles: [...] } so the modal can
  // surface the exact-muscle picks first and still let the user pick a
  // different muscle group when needed (e.g. trade traps day for biceps).
  const filteredSwapExercises = useMemo(() => {
    if (!showSwapModal || !swapTargetExercise) return { sameMuscle: [], otherMuscles: [] };
    const q = swapSearch.toLowerCase().trim();
    const currentIds = new Set(exercises.map(e => e.id));
    // Pull the static-library row for the swap target so we have its
    // primaryRegions / muscleScores / movementPattern for the match score.
    const targetLib = localExercises.find((e) => e.id === swapTargetExercise.id) || swapTargetExercise;
    const sameMuscle = [];
    const otherMuscles = [];
    for (const ex of enrichedLocalExercises) {
      if (currentIds.has(ex.id)) continue;
      if (q) {
        const hay = `${ex.name || ''} ${ex.name_es || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (swapTargetMuscle && ex.muscle === swapTargetMuscle) {
        sameMuscle.push(ex);
      } else {
        otherMuscles.push(ex);
      }
      if (sameMuscle.length + otherMuscles.length >= 100) break;
    }
    // Reason-driven filtering — equipment_busy / injury cull candidates
    // that wouldn't help. Decorate each survivor with a `_swapMatch` score
    // and sort within each bucket so the highest-fit alternative is first.
    const decorate = (list) => list
      .map((ex) => ({ ...ex, _swapMatch: getSwapMatchScore(targetLib, ex) }))
      .sort((a, b) => (b._swapMatch || 0) - (a._swapMatch || 0));
    return {
      sameMuscle: decorate(filterByReason(sameMuscle, swapSelectedReason, targetLib)).slice(0, 50),
      otherMuscles: decorate(filterByReason(otherMuscles, swapSelectedReason, targetLib)).slice(0, 30),
    };
  }, [showSwapModal, swapSearch, swapTargetExercise, swapTargetMuscle, exercises, enrichedLocalExercises, swapSelectedReason]);

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
    setSwapCustomName('');
  };

  // Inline custom-exercise create from inside the swap modal (Feat 1).
  // Mirrors handleCreateExercise in ExerciseLibrary but skinnier — only asks
  // for a name, inherits muscle / equipment / sets / reps / rest from the
  // exercise being swapped out. After save, immediately swap into the session.
  const handleCreateCustomAndSwap = async () => {
    const name = swapCustomName.trim();
    if (!name || !user?.id || !profile?.gym_id || !swapTargetExercise) return;
    setSwapCustomSaving(true);
    try {
      const VALID_MUSCLES = new Set(['Chest','Back','Shoulders','Biceps','Triceps','Legs','Glutes','Core','Calves','Forearms','Traps','Full Body','Warm-Up']);
      const muscle_group = VALID_MUSCLES.has(swapTargetMuscle) ? swapTargetMuscle : 'Full Body';
      const sourceLib = localExercises.find(e => e.id === swapTargetExercise.id);
      const equipment = sourceLib?.equipment || 'Bodyweight';
      const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await supabase.from('exercises').insert({
        id,
        gym_id: profile.gym_id,
        created_by: user.id,
        name,
        muscle_group,
        equipment,
        category: 'Strength',
        default_sets: swapTargetExercise.targetSets || 3,
        default_reps: swapTargetExercise.targetReps || 10,
        rest_seconds: swapTargetExercise.restSeconds || 90,
        is_active: true,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('handleCreateCustomAndSwap insert failed:', error);
        showToast(t('activeSession.customExerciseError', "Couldn't create that exercise. Try again."), 'error');
        return;
      }
      // Build a library-shaped object so handleSwapExercise can consume it.
      const newLibEx = {
        id,
        name,
        name_es: null,
        muscle: muscle_group,
        equipment,
        videoUrl: null,
        instructions: null,
        instructions_es: null,
      };
      // Cache the new row into `dbExerciseMap` immediately so search /
      // swap / suggestions can use it for the rest of this session
      // without waiting for a refetch.
      setDbExerciseMap((prev) => ({
        ...prev,
        [id]: {
          id,
          name,
          name_es: null,
          muscle_group,
          equipment,
          default_sets: swapTargetExercise.targetSets || 3,
          default_reps: swapTargetExercise.targetReps || 10,
          rest_seconds: swapTargetExercise.restSeconds || 90,
          instructions: null,
          instructions_es: null,
          video_url: null,
          primary_regions: [],
          secondary_regions: [],
        },
      }));
      handleSwapExercise(newLibEx);
    } finally {
      setSwapCustomSaving(false);
    }
  };

  // Inline "Create custom exercise" inside the Add Exercise modal. Inserts
  // into the gym's `exercises` catalogue (visible to this user in future
  // sessions), then appends the new exercise to the active session in one
  // shot. Muscle group is inferred from the active chip filter when it
  // maps cleanly; otherwise defaults to 'Full Body'.
  const handleCreateCustomAndAdd = async () => {
    const name = addCustomName.trim();
    if (!name || !user?.id || !profile?.gym_id) return;
    setAddCustomSaving(true);
    try {
      const CHIP_TO_MUSCLE = {
        chest: 'Chest',
        back:  'Back',
        legs:  'Legs',
        core:  'Core',
        arms:  'Biceps',
        push:  'Chest',
        pull:  'Back',
      };
      const VALID_MUSCLES = new Set(['Chest','Back','Shoulders','Biceps','Triceps','Legs','Glutes','Core','Calves','Forearms','Traps','Full Body','Warm-Up']);
      const fromChip = CHIP_TO_MUSCLE[addExerciseChip];
      const muscle_group = (fromChip && VALID_MUSCLES.has(fromChip))
        ? fromChip
        : (selectedMuscle && VALID_MUSCLES.has(selectedMuscle) ? selectedMuscle : 'Full Body');
      const equipment = selectedEquipment || 'Bodyweight';
      const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await supabase.from('exercises').insert({
        id,
        gym_id: profile.gym_id,
        created_by: user.id,
        name,
        muscle_group,
        equipment,
        category: 'Strength',
        default_sets: 3,
        default_reps: 10,
        rest_seconds: 90,
        is_active: true,
      });
      if (error) {
        console.warn('handleCreateCustomAndAdd insert failed:', error);
        showToast(t('activeSession.customExerciseError', "Couldn't create that exercise. Try again."), 'error');
        return;
      }
      // Cache locally so future searches / suggestions / swaps pick it up
      // without waiting for a refetch.
      setDbExerciseMap((prev) => ({
        ...prev,
        [id]: {
          id,
          name,
          name_es: null,
          muscle_group,
          equipment,
          default_sets: 3,
          default_reps: 10,
          rest_seconds: 90,
          instructions: null,
          instructions_es: null,
          video_url: null,
          primary_regions: [],
          secondary_regions: [],
        },
      }));
      // Library-shaped object for the active-session adder.
      handleAddExerciseToSession({
        id,
        name,
        name_es: null,
        muscle: muscle_group,
        equipment,
        defaultSets: 3,
        defaultReps: 10,
        videoUrl: null,
        instructions: null,
        instructions_es: null,
      });
      setAddCustomName('');
    } finally {
      setAddCustomSaving(false);
    }
  };

  const handleFinish = async () => {
    // Double-submit guard — bail out if a save is already in flight
    if (saving) return;
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
        exercises: exercises.filter(ex => (loggedSets[ex.id] || []).some(s => s.completed && !s.skipped)).map((exercise, pos) => ({
          exercise_id: exercise.id,
          name: exercise.name,
          position: pos + 1,
          suggested_weight: exercise.suggestion?.suggestedWeight ?? null,
          suggested_reps: exercise.suggestion?.suggestedReps ?? null,
          sets: (loggedSets[exercise.id] || []).filter(s => s.completed && !s.skipped).map((set, i) => ({
            weight: parseFloat(set.weight) || 0,
            reps: parseInt(set.reps, 10) || 0,
            is_pr: set.isPR || false,
            rpe: set.rpe ?? null,
            notes: set.notes || null,
            // Dropsets: array of {weight, reps} performed immediately after
            // the top set with no rest. The current `complete_workout` RPC
            // ignores this field — a follow-up migration will surface it on
            // `session_sets.drops` so it shows in the workout log.
            drops: Array.isArray(set.drops) && set.drops.length > 0
              ? set.drops
                  .map((d) => ({
                    weight: parseFloat(d.weight) || 0,
                    reps: parseInt(d.reps, 10) || 0,
                  }))
                  .filter((d) => d.reps > 0)
              : null,
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

      // v2 wraps complete_workout and surfaces completed_sets + exercise_count
      // alongside session_id/xp_earned/streak so SessionSummary doesn't need a
      // client-side fallback formula.
      const { data: result, error: rpcError } = await supabase.rpc('complete_workout_v2', { p_payload: payload });
      if (rpcError) throw rpcError;

      // Bust the dashboard's cached state so the fresh data shows up
      // immediately when the user navigates back. Without this, the stale
      // todaysSessions array (cached via useCachedState in localStorage)
      // hides the just-completed workout until the next manual refresh.
      try {
        const heroKey = `dashboard-hero-${user?.id || 'anon'}`;
        clearCachedState(`${heroKey}-today`);
        clearCachedState(`${heroKey}-week-cardio`);
        clearQueryCache(`dash:${user?.id}`);
      } catch {}

      // Invalidate every leaderboard query so the just-finished workout's
      // volume / workouts / streak / improvement / PR / check-in numbers
      // are reflected the moment the user opens the leaderboard. Realtime
      // subscriptions on the Leaderboard page handle the equivalent update
      // for OTHER members in the gym.
      try {
        const LEADERBOARD_KEYS = [
          'leaderboard',
          'leaderboard-improved',
          'leaderboard-consistency',
          'leaderboard-prs',
          'leaderboard-checkins',
          'leaderboard-newcomers',
        ];
        for (const key of LEADERBOARD_KEYS) {
          queryClient.invalidateQueries({ queryKey: [key], exact: false });
        }
      } catch {}

      posthog?.capture('workout_completed', {
        duration_seconds: elapsedTime,
        total_volume: totalVolume,
        sets_completed: completedSets,
        prs_hit: sessionPRs.length,
      });

      sessionEndedRef.current = true;
      draftSaveRef.current = null;
      localStorage.removeItem(sessionKey);
      // Also clear DB draft — skip for empty/free sessions: they have no
      // session_drafts row and their id 'empty' isn't a valid UUID (22P02).
      if (!isEmptyMode) {
        supabase.from('session_drafts').delete()
          .eq('profile_id', user.id).eq('routine_id', id).then(() => {}).catch(() => {});
      }
      cancelWorkoutNotification();
      endLiveActivity({ elapsedSeconds: elapsedTime, completedSets, totalSets });
      syncWorkoutEnded({ duration: elapsedTime, totalVolume, prsHit: sessionPRs.length, setsCompleted: completedSets });
      // Tell the rest of the app a workout just landed. GymWOD (and any other
      // listener) only re-checks "completed today" on this event or on
      // visibilitychange — and the Dashboard is keep-alive, so without this
      // the WOD card kept showing "Start/Resume" right after finishing it.
      try { window.dispatchEvent(new CustomEvent('tugympr:workouts-changed')); } catch { /* noop */ }

      // Link completed session to class booking so instructors see member results
      if (classBookingId && result?.session_id) {
        supabase.rpc('link_class_workout', {
          p_booking_id: classBookingId,
          p_session_id: result.session_id,
        }).catch(() => {});
      }

      // Prefer server-computed counts (immune to stale closures) with client fallback
      const serverSets = result.completed_sets ?? completedSets;
      const serverExercises = result.exercise_count ?? Object.values(loggedSets).filter(sets => sets.some(s => s.completed && !s.skipped)).length;

      navigate('/session-summary', {
        replace: true,
        state: {
          routineName, elapsedTime, totalVolume,
          completedSets: serverSets,
          totalSets: serverSets, // all sent sets are completed (we only send completed)
          totalExercises: serverExercises, sessionPRs, exerciseSwaps,
          completedAt: new Date().toISOString(),
          xpEarned: result.xp_earned,
          sessionId: result.session_id,
          streak: result.streak,
          heartRate: watchHRSummary.current || (watchHeartRate ? { averageBPM: watchHeartRate.avgBPM, maxBPM: watchHeartRate.bpm, minBPM: 0 } : null),
          workedMuscleGroups: [...new Set(exercises.filter(ex => (loggedSets[ex.id] || []).some(s => s.completed && !s.skipped)).map(ex => ex.muscle).filter(Boolean))],
        },
      });
    } catch (err) {
      // Re-persist the draft so data is never lost on failed saves (e.g. spotty gym WiFi).
      // localStorage.removeItem only runs after a successful RPC, but we persist
      // explicitly here as a safety net in case anything in the try block touched it.
      try { localStorage.setItem(sessionKey, JSON.stringify(saveRef.current)); } catch { }
      console.error('Workout save failed', err);
      setSaveError(t('workout.saveFailedRetry', "Couldn't save your workout. Tap retry."));
      setSaving(false);
      // Surface a non-dismissable toast with a Retry CTA so the user can re-run save.
      try {
        showToast(
          t('workout.saveFailedRetry', "Couldn't save your workout. Tap retry."),
          'error',
          {
            durationMs: 600000, // 10 min — effectively non-dismissable until user acts
            action: {
              label: t('workout.retry', 'Retry'),
              onClick: () => { handleFinishRef.current?.(); },
            },
          }
        );
      } catch { /* toast provider may be unavailable in tests */ }
    }
  };
  handleFinishRef.current = handleFinish;

  // ── Error screen ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.failedToLoad')}</p>
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-6 py-3 rounded-2xl bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] font-bold text-[15px]"
          >
            {t('activeSession.goBack')}
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
          <div className="w-10 h-10 border-2 border-amber-700 border-t-amber-400 rounded-full animate-spin" role="status" aria-busy={true} aria-label={t('activeSession.loadingWorkout')} />
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('activeSession.loadingWorkout')}</p>
        </div>
      </div>
    );
  }

  // Guard against out-of-bounds index (Fix #2) — skip for empty mode
  if (!isEmptyMode && (currentExerciseIndex < 0 || currentExerciseIndex >= exercises.length)) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.noExercisesFound')}</p>
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('activeSession.workoutModified')}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-6 py-3 rounded-2xl bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] font-bold text-[15px]"
          >
            {t('activeSession.goBack')}
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
            <Flame size={40} className="text-orange-400" />
          </div>

          {/* Title */}
          <h2 className="text-[28px] font-black tracking-tight mb-3" style={{ color: 'var(--color-text-primary)' }}>
            {t('activeSession.warmUpReady', 'Warm Up')}
          </h2>

          {/* Subtitle */}
          <p className="text-[15px] leading-relaxed max-w-[280px] text-center" style={{ color: 'var(--color-text-muted)' }}>
            {t('activeSession.warmUpDesc2', { count: warmUpExercises.length, defaultValue: '{{count}} exercises to get your muscles ready' })}
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
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
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
          <button
            onClick={() => {
              // Bail out: clear any draft we may have already written and
              // bounce HOME. Mirrors the discard-session cleanup so we
              // don't leave orphan state behind.
              posthog?.capture('workout_abandoned', { routine_name: routineName, duration_seconds: 0, from: 'warmup_gate' });
              sessionEndedRef.current = true;
              draftSaveRef.current = null;
              try { localStorage.removeItem(sessionKey); } catch {}
              if (user?.id && !isEmptyMode) {
                supabase.from('session_drafts').delete().eq('profile_id', user.id).eq('routine_id', id).then(() => {}, () => {});
              }
              try { cancelWorkoutNotification(); } catch {}
              try { endLiveActivity(); } catch {}
              try { syncWorkoutEnded({ duration: 0, totalVolume: 0, prsHit: 0, setsCompleted: 0 }); } catch {}
              navigate('/');
            }}
            className="w-full py-2 rounded-2xl font-semibold text-[12px] transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('activeSession.cancelWorkout', 'Cancel')}
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
  // The user can complete a set if either: (a) they've manually entered both
  // weight and reps, OR (b) the overload engine produced a suggestion we can
  // commit on their behalf. (b) prevents the previous bug where the input
  // appeared to show "75 lb" via placeholder but committed empty when the
  // user tapped Complete. Cardio exercises also satisfy the suggestion path.
  // Use first source that yields a positive number (??-fallback would stop on 0).
  const _firstPositive = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };
  const _trMatch = String(currentExercise?.targetReps ?? '').match(/^\s*(\d+)/);
  const suggestedW = _firstPositive(
    currentExercise?.suggestion?.suggestedWeight,
    currentExercise?.suggestedWeight,
  );
  const suggestedR = _firstPositive(
    currentExercise?.suggestion?.suggestedReps,
    currentExercise?.suggestedReps,
    _trMatch ? _trMatch[1] : null,
  );
  const repsValid  = activeSet && activeSet.reps !== '' && activeSet.reps != null
    && !isNaN(Number(activeSet.reps)) && Number(activeSet.reps) > 0;
  const weightValid = activeSet && activeSet.weight !== '' && activeSet.weight !== undefined
    && !isNaN(Number(activeSet.weight)) && Number(activeSet.weight) >= 0;
  const canComplete = activeSet && (repsValid || (suggestedR && Number(suggestedR) > 0))
    && (weightValid || (suggestedW && Number(suggestedW) > 0));
  const handleCompleteSet = () => {
    if (!canComplete || !currentExercise) return;
    // Backfill empty fields with the engine suggestion before committing.
    const exId = currentExercise.id;
    if (!weightValid && suggestedW && Number(suggestedW) > 0) {
      handleUpdateSet(exId, activeSetIndex, 'weight', String(suggestedW));
    }
    if (!repsValid && suggestedR && Number(suggestedR) > 0) {
      handleUpdateSet(exId, activeSetIndex, 'reps', String(suggestedR));
    }
    handleToggleComplete(
      exId,
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
    const fromIndex = currentExerciseIndex;
    const skippedEx = exercises[fromIndex];
    const wasLast = fromIndex >= exercises.length - 1;
    // Skip just advances to the next exercise without removing it
    if (!wasLast) {
      setCurrentExerciseIndex(fromIndex + 1);
    } else {
      setWorkoutComplete(true);
    }
    // Mark exercise as skipped so the Live Activity totalSets excludes its
    // remaining uncompleted sets (they're effectively "done" from the user's
    // POV). Also tag the in-memory loggedSets so the post-workout summary can
    // distinguish "skipped" from "never started" — without breaking PR
    // detection, which already filters on `s.completed && !s.skipped`.
    if (skippedEx?.id) {
      setSkippedExerciseIds(prev => prev.includes(skippedEx.id) ? prev : [...prev, skippedEx.id]);
      setLoggedSets(prev => {
        const cur = prev[skippedEx.id];
        if (!cur || cur.length === 0) return prev;
        return {
          ...prev,
          [skippedEx.id]: cur.map(s => (
            s.completed ? s : { ...s, skipped: true, completed: true }
          )),
        };
      });
    }
    // If the user just skipped the LAST exercise, the iOS Live Activity would
    // otherwise hang on "rest in progress" forever. Tear it down explicitly so
    // the lock screen widget clears at the same time the user hits the
    // workout-complete gate.
    if (wasLast) {
      try { endLiveActivity(); } catch { /* non-critical */ }
      try { cancelWorkoutNotification(); } catch { /* non-critical */ }
    }
    // Clear any previous undo timer
    if (skipUndo?.timerId) clearTimeout(skipUndo.timerId);
    const timerId = setTimeout(() => setSkipUndo(null), 6000);
    setSkipUndo({ fromIndex, timerId, skippedExerciseId: skippedEx?.id });
  };
  const handleUndoSkip = () => {
    if (!skipUndo) return;
    if (skipUndo.timerId) clearTimeout(skipUndo.timerId);
    if (skipUndo.skippedExerciseId) {
      setSkippedExerciseIds(prev => prev.filter(id => id !== skipUndo.skippedExerciseId));
      // Restore any sets we marked as skipped → back to incomplete so the user
      // can log them. We only undo sets we ourselves marked (skipped:true with
      // no real weight/reps) — sets the user actually logged stay completed.
      setLoggedSets(prev => {
        const cur = prev[skipUndo.skippedExerciseId];
        if (!cur || cur.length === 0) return prev;
        return {
          ...prev,
          [skipUndo.skippedExerciseId]: cur.map(s => (
            s.skipped
              ? { ...s, skipped: false, completed: false }
              : s
          )),
        };
      });
    }
    setWorkoutComplete(false);
    setCurrentExerciseIndex(skipUndo.fromIndex);
    setSkipUndo(null);
  };

  const handleRemoveExercise = () => {
    handleRemoveExerciseAt(currentExerciseIndex);
  };

  // Generalized: remove the exercise at any index (used by the list manager).
  const handleRemoveExerciseAt = (idx) => {
    if (exercises.length <= 1) {
      setWorkoutComplete(true);
      return;
    }
    const removedEx = exercises[idx];
    if (removedEx) {
      setRemovedExerciseIds(prev => [...prev, removedEx.id]);
      setLoggedSets(prev => {
        const updated = { ...prev };
        delete updated[removedEx.id];
        return updated;
      });
    }
    setExercises(prev => prev.filter((_, i) => i !== idx));
    // Keep currentExerciseIndex pointing at a sensible exercise.
    setCurrentExerciseIndex(prevIdx => {
      if (idx < prevIdx) return prevIdx - 1;
      if (idx === prevIdx) return Math.max(0, Math.min(prevIdx, exercises.length - 2));
      return prevIdx;
    });
  };

  // Reorder: move exercise from `fromIdx` to `toIdx` (used by list manager).
  // Position is pinned: `currentExerciseIndex` never moves on reorder. The
  // exercise sitting at that index simply changes, and per-exercise set
  // progress lives in `loggedSets` keyed by exercise id — so the moved
  // exercise resumes from wherever the user left it whenever they navigate
  // back to its new position.
  const handleReorderExercise = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    setExercises(prev => {
      if (fromIdx >= prev.length || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // Open the swap modal targeted at a specific row (list manager).
  // Simplest path: navigate the active exercise to that index, then open swap
  // — swap modal already keys off currentExerciseIndex.
  const handleSwapAtIndex = (idx) => {
    setCurrentExerciseIndex(idx);
    setSwapSearch('');
    setSwapSelectedReason(null);
    setSwapCustomName('');
    setShowListManager(false);
    setShowSwapModal(true);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex flex-col font-sans animate-fade-in" style={{ background: 'var(--color-bg-primary)' }}>

      {/* Coach cue banner — fires when trainer sends a live cue */}
      {coachCue && (
        <div
          className="fixed top-0 left-0 right-0 z-[250] mx-auto max-w-md px-4 pt-3 pointer-events-none animate-fade-in"
          role="status"
          aria-live="polite"
        >
          <div
            className="rounded-2xl px-4 py-3 shadow-lg pointer-events-auto flex items-start gap-3 border"
            style={{
              background: 'linear-gradient(135deg, rgba(46,224,224,0.18), rgba(46,224,224,0.08))',
              borderColor: 'rgba(46,224,224,0.4)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] mt-0.5" style={{ color: '#2EE0E0' }}>
              {t('activeSession.cue.coachLabel', 'Coach')}
            </div>
            <div className="flex-1 text-[13px] leading-snug font-medium" style={{ color: '#fff' }}>
              {coachCue.text}
            </div>
            <button
              type="button"
              onClick={() => setCoachCue(null)}
              aria-label={t('activeSession.cue.dismiss', 'Dismiss')}
              className="text-white/60 hover:text-white text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Conflict dialog — another workout is already running */}
      {showConflict && conflictSession && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="dialog" aria-labelledby="conflict-dialog-title">
          <div className="rounded-[20px] w-full max-w-sm p-6 border border-white/[0.06]" style={{ background: 'var(--color-bg-card)' }}>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <Dumbbell size={22} className="text-amber-400" />
            </div>
            <h3 id="conflict-dialog-title" className="text-[18px] font-bold text-center mb-2 truncate" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.conflictTitle', { defaultValue: 'Workout Already Running' })}</h3>
            <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
              {t('activeSession.conflictBodyPre', { defaultValue: 'You have' })} <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{conflictSession.routineName}</span> {t('activeSession.conflictBodyPost', { defaultValue: 'in progress. What would you like to do?' })}
            </p>
            <div className="space-y-2.5">
              <button
                onClick={handleResumeConflict}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#60A5FA] hover:bg-[#4B91E8] transition-colors"
              >
                {t('activeSession.conflictResume', { name: conflictSession.routineName, defaultValue: `Resume ${conflictSession.routineName}` })}
              </button>
              <button
                onClick={handleDiscardConflict}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] transition-colors"
                style={{ backgroundColor: '#EF4444', color: '#FFFFFF' }}
              >
                {t('activeSession.conflictDiscardStartNew', { defaultValue: 'Discard & Start New' })}
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full py-3 rounded-2xl font-medium text-[13px] hover:opacity-80 transition-colors"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                {t('activeSession.goBack')}
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
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-[var(--color-text-on-accent,#000)] bg-[#D4AF37] hover:bg-[#C4A030] transition-colors"
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
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-[var(--color-text-on-accent,#000)] bg-[#D4AF37] hover:bg-[#C4A030] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
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

      {/* Superset Picker — opened by the quick "Superset" pill in the active
          set logging panel. Lets the user pair the current exercise with an
          existing routine exercise or trigger the AddExercise flow with a
          pending-group flag. */}
      <SupersetPickerModal
        open={showSupersetPicker}
        onClose={() => setShowSupersetPicker(false)}
        currentExerciseId={exercises[currentExerciseIndex]?.id}
        exercises={exercises}
        onPickExisting={handleSupersetPickExisting}
        onAddNew={handleSupersetAddNew}
      />

      {/* Finish Modal */}
      {showFinishModal && (
        <SessionSummary
          workout={routineName} sessionPRs={sessionPRs}
          totalVolume={displayedVolume} duration={formatTime(elapsedTime)}
          completedSets={completedSets} totalSets={totalSets}
          onConfirm={handleFinish} onCancel={() => setShowFinishModal(false)}
          saving={saving} error={saveError} onRetry={handleFinish}
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
        loggedSets={loggedSets}
        currentExerciseIndex={isInWarmUp ? warmUpIndex : cooldownPhase === 'active' ? cooldownIndex : currentExerciseIndex}
        showResumedBanner={showResumedBanner}
        savedSession={savedSession}
        sessionKey={sessionKey}
        onNavigateBack={() => navigate(-1)}
        onPause={() => {
          setIsPaused(true);
          // Open the action sheet so the user can choose Resume / Save for
          // later / Delete session. The SessionHeader's own full-screen pause
          // overlay still renders behind us — that's fine, our z-[300] modal
          // covers it and dismissing it falls back to the existing flow.
          setShowPauseSheet(true);
          // Persist pause state alongside the rest timer so foreground/resume on
          // iOS background doesn't auto-tick the countdown past the pause point.
          try {
            const raw = localStorage.getItem(restStateKey);
            const prev = raw ? JSON.parse(raw) : {};
            localStorage.setItem(restStateKey, JSON.stringify({
              ...prev,
              restStartedAt: prev.restStartedAt ?? restStartedAt.current,
              duration: prev.duration ?? currentRestDurationRef.current,
              isPaused: true,
              pausedAt: Date.now(),
            }));
          } catch { }
        }}
        onResume={() => {
          setIsPaused(false);
          // Clear the pause flag so the rest countdown can resume ticking.
          try {
            const raw = localStorage.getItem(restStateKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.isPaused) {
                const next = { ...parsed };
                delete next.isPaused;
                delete next.pausedAt;
                // Re-anchor restStartedAt so the timer continues from where the
                // user paused (do not credit the paused interval to "elapsed rest").
                if (parsed.pausedAt && parsed.restStartedAt) {
                  const pausedFor = Date.now() - parsed.pausedAt;
                  next.restStartedAt = parsed.restStartedAt + pausedFor;
                  restStartedAt.current = next.restStartedAt;
                }
                localStorage.setItem(restStateKey, JSON.stringify(next));
              }
            }
          } catch { }
        }}
        onEndWorkout={() => { setIsPaused(false); setShowFinishModal(true); }}
        onSetCurrentExerciseIndex={setCurrentExerciseIndex}
        onOpenListManager={() => setShowListManager(true)}
        onDismissResumedBanner={() => setShowResumedBanner(false)}
        watchHeartRate={watchHeartRate}
        onDiscardSession={() => { posthog?.capture('workout_abandoned', { routine_name: routineName, duration_seconds: elapsedTime }); sessionEndedRef.current = true; draftSaveRef.current = null; localStorage.removeItem(sessionKey); if (!isEmptyMode) supabase.from('session_drafts').delete().eq('profile_id', user.id).eq('routine_id', id).then(() => {}).catch(() => {}); cancelWorkoutNotification(); endLiveActivity(); syncWorkoutEnded({ duration: elapsedTime, totalVolume: 0, prsHit: 0, setsCompleted: 0 }); navigate('/workouts'); }}
      />

      {/* ── Pause action sheet — Resume / Save for later / Delete ────────── */}
      {showPauseSheet && !showDeleteSessionConfirm && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
          role="dialog"
          aria-labelledby="pause-sheet-title"
        >
          <div className="rounded-[20px] w-full max-w-sm p-6 border" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }}>
            <h3 id="pause-sheet-title" className="text-[18px] font-bold text-center mb-1" style={{ color: 'var(--color-text-primary)' }}>
              {t('activeSession.pauseTitle', { defaultValue: 'Workout paused' })}
            </h3>
            <p className="text-[13px] text-center leading-relaxed mb-5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('activeSession.pauseSubtitle', { defaultValue: 'What would you like to do?' })}
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => {
                  setShowPauseSheet(false);
                  setIsPaused(false);
                  try {
                    const raw = localStorage.getItem(restStateKey);
                    if (raw) {
                      const parsed = JSON.parse(raw);
                      if (parsed?.isPaused) {
                        const next = { ...parsed };
                        delete next.isPaused;
                        delete next.pausedAt;
                        if (parsed.pausedAt && parsed.restStartedAt) {
                          const pausedFor = Date.now() - parsed.pausedAt;
                          next.restStartedAt = parsed.restStartedAt + pausedFor;
                          restStartedAt.current = next.restStartedAt;
                        }
                        localStorage.setItem(restStateKey, JSON.stringify(next));
                      }
                    }
                  } catch { /* non-critical */ }
                }}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] active:scale-[0.97] transition-transform"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }}
              >
                {t('activeSession.resume', 'Resume')}
              </button>

              {/* Save for later — keep the draft, navigate home. */}
              <button
                onClick={() => {
                  try {
                    if (saveRef.current) {
                      localStorage.setItem(sessionKey, JSON.stringify({
                        ...saveRef.current,
                        isPaused: true,
                        lastUpdated: new Date().toISOString(),
                      }));
                    }
                  } catch { /* non-critical */ }
                  try { saveDraftToDb(); } catch { /* non-critical */ }
                  try { cancelWorkoutNotification(); } catch { /* non-critical */ }
                  try { endLiveActivity(); } catch { /* non-critical */ }
                  sessionEndedRef.current = true;
                  setShowPauseSheet(false);
                  navigate('/workouts');
                }}
                className="w-full py-3.5 rounded-2xl font-semibold text-[14px] transition-colors text-left px-4"
                style={{
                  backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <span className="block">{t('activeSession.saveForLater', { defaultValue: 'Save for later' })}</span>
                <span className="block text-[11px] font-normal mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('activeSession.saveForLaterDesc', { defaultValue: 'Stop tracking — your progress is saved.' })}
                </span>
              </button>

              {/* Finalize workout — go to summary now */}
              <button
                type="button"
                onClick={() => { setShowPauseSheet(false); setIsPaused(false); setShowFinishModal(true); }}
                className="w-full py-3.5 rounded-2xl font-semibold text-[14px] transition-colors text-left px-4"
                style={{
                  backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <span className="block">{t('activeSession.finishWorkoutNow', { defaultValue: 'Finalizar Entrenamiento' })}</span>
                <span className="block text-[11px] font-normal mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('activeSession.finishWorkoutNowDesc', { defaultValue: 'Termina aquí y ve al resumen.' })}
                </span>
              </button>

              {/* Delete session — clear draft, navigate home (with confirm) */}
              <button
                onClick={() => setShowDeleteSessionConfirm(true)}
                className="w-full py-3.5 rounded-2xl font-semibold text-[14px] transition-colors text-left px-4"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.10)',
                  color: '#EF4444',
                  border: '1px solid rgba(239,68,68,0.25)',
                }}
              >
                <span className="block">{t('activeSession.deleteSession', { defaultValue: 'Delete session' })}</span>
                <span className="block text-[11px] font-normal mt-0.5" style={{ color: 'rgba(239,68,68,0.75)' }}>
                  {t('activeSession.deleteSessionDesc', { defaultValue: 'Discard this workout and go back.' })}
                </span>
              </button>

              <button
                onClick={() => { setShowPauseSheet(false); setIsPaused(false); }}
                className="w-full py-3 rounded-2xl font-medium text-[13px]"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                {t('activeSession.close', { defaultValue: 'Close' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete-session confirmation — second tap to prevent fat-finger loss */}
      {showDeleteSessionConfirm && (
        <div
          className="fixed inset-0 z-[310] flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)' }}
          role="dialog"
          aria-labelledby="delete-session-title"
        >
          <div className="rounded-[20px] w-full max-w-sm p-6 border" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }}>
            <h3 id="delete-session-title" className="text-[16px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t('activeSession.deleteSessionConfirm', { defaultValue: 'Delete this workout? Your logged sets will be lost.' })}
            </h3>
            <div className="space-y-2.5 mt-5">
              <button
                onClick={() => {
                  posthog?.capture('workout_abandoned', { routine_name: routineName, duration_seconds: elapsedTime, source: 'pause_sheet' });
                  sessionEndedRef.current = true;
                  try { localStorage.removeItem(sessionKey); } catch { /* non-critical */ }
                  try {
                    if (user?.id && !isEmptyMode) {
                      supabase.from('session_drafts').delete()
                        .eq('profile_id', user.id).eq('routine_id', id)
                        .then(() => {}).catch(() => {});
                    }
                  } catch { /* non-critical */ }
                  try { cancelWorkoutNotification(); } catch { /* non-critical */ }
                  try { endLiveActivity(); } catch { /* non-critical */ }
                  try { syncWorkoutEnded({ duration: elapsedTime, totalVolume: 0, prsHit: 0, setsCompleted: 0 }); } catch { /* non-critical */ }
                  setShowDeleteSessionConfirm(false);
                  setShowPauseSheet(false);
                  navigate('/workouts');
                }}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white"
                style={{ backgroundColor: '#EF4444' }}
              >
                {t('activeSession.deleteSessionConfirmAction', { defaultValue: 'Yes, delete' })}
              </button>
              <button
                onClick={() => setShowDeleteSessionConfirm(false)}
                className="w-full py-3 rounded-2xl font-medium text-[13px]"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                {t('activeSession.goBack', 'Go Back')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skip-undo floating banner */}
      {skipUndo && !isResting && !workoutComplete && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] rounded-full flex items-center gap-2 px-3 py-2 animate-fade-in"
          style={{
            bottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
          }}
        >
          <span className="text-[12px] font-semibold pl-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('activeSession.exerciseSkipped', 'Exercise skipped')}
          </span>
          <button
            onClick={handleUndoSkip}
            className="px-3 py-1 rounded-full text-[12px] font-bold active:scale-95 transition-transform"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-on-accent, #001512)',
            }}
          >
            {t('activeSession.undo', 'Undo')}
          </button>
        </div>
      )}

      {/* Rest Timer Overlay */}
      {isResting && !isPaused && restTimer > 0 && (
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
              // The OS-level "Rest Complete!" notification was scheduled when
              // rest first started, with the ORIGINAL duration. Cancel and
              // reschedule with the new remaining time so it doesn't fire
              // early (the bug where users tapped +15s and still got the
              // alert at the original mark).
              try {
                cancelRestNotification();
                if (remaining > 0) {
                  scheduleRestDoneNotification(
                    exName(exercises[currentExerciseIndex]) ?? 'exercise',
                    remaining
                  );
                }
              } catch { /* non-critical */ }
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
                    <video src={localWu.videoUrl} className="w-full h-full object-cover" muted loop playsInline autoPlay aria-label={t('activeSession.exerciseDemoAria', { name: wuName, defaultValue: `${wuName} exercise demonstration` })} />
                  </div>
                ) : (
                  <div className="w-full h-24" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.1), rgba(234,88,12,0.03))' }} />
                )}

                {/* Exercise info */}
                <div className="px-4 pt-4 pb-3">
                  <h3 className="text-[18px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                    {wuName}
                  </h3>
                  <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--color-text-subtle)' }}>
                    {localWu?.instructions || `${wu.durationSec} ${t('activeSession.secondsLong', { defaultValue: 'seconds' })}`}
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
              className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] font-bold text-[14px] active:scale-[0.97] transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
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
                      <div className="w-full h-24" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(96,165,250,0.03))' }} />

                      {/* Stretch info */}
                      <div className="px-4 pt-4 pb-3">
                        <h3 className="text-[18px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                          {stretchName}
                        </h3>
                        <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                          {stretch.durationSec}{t('activeSession.secondsShort', { defaultValue: 's' })} · {t('activeSession.cooldownStretchOf', { current: cooldownIndex + 1, total: stretches.length, defaultValue: 'Stretch {{current}} of {{total}}' })}
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

                    {/* Skip controls live in the sticky footer below — having
                        a second skip button inline confused users (fix #11).
                        The bottom bar exposes both "Next stretch" and
                        "Skip all cooldown" with distinct labels. */}
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
                  {t('activeSession.startCooldown', 'Cool Down Stretches')}
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
                <>
                {/* Bodyweight badge moved into ExerciseCard, next to the
                    exercise name, so it pairs with the lift it labels
                    instead of floating above the card. */}
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
                  onAddExercise={() => setShowAddExercise(true)}
                  onRemoveExercise={exercises.length > 1 ? handleRemoveExercise : undefined}
                  isPRCheck={isPR}
                  livePRs={livePRs.current}
                  nextInGroup={nextInGroup}
                  groupType={groupType}
                  groupId={currentExercise.groupId}
                  canStartSuperset={exercises.length >= 2 || currentExercise.groupId}
                  onToggleSuperset={handleQuickSupersetToggle}
                  adjustedRestSeconds={adjustedRestSeconds}
                  unit={weightUnit}
                  onToggleUnit={toggleWeightUnit}
                />
                </>
              )}
              {/* The "Next in superset" callout used to render here too;
                  ExerciseCard renders the same banner inside the card body,
                  so this outer copy was a duplicate. */}
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
            role="dialog"
            aria-label={t('activeSession.addExercise')}
          >
            {/* Header — title + close */}
            <div className="flex items-center gap-2 px-4 pt-4 pb-3">
              <h3 className="text-[18px] font-bold flex-1" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.addExercise')}</h3>
              <button
                onClick={() => {
                  const wasFromListManager = addExerciseOrigin === 'list-manager';
                  setShowAddExercise(false);
                  setExerciseSearch('');
                  setSelectedMuscle('');
                  setShowFilters(false);
                  setShowFavoritesOnly(false);
                  setPreviewExercise(null);
                  setAddExerciseChip('all');
                  setAddExerciseOrigin(null);
                  setAddCustomName('');
                  if (wasFromListManager) setShowListManager(true);
                }}
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors"
                style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' }}
                aria-label={t('activeSession.close', { defaultValue: 'Close' })}
              >
                <X size={20} />
              </button>
            </div>

            {/* Search bar — favorites toggle inside, filter button removed
                (chip pills below cover muscle filtering). */}
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default))' }}>
                <Search size={16} style={{ color: 'var(--color-text-subtle)' }} className="shrink-0" />
                <input
                  type="text"
                  value={exerciseSearch}
                  onChange={e => setExerciseSearch(e.target.value)}
                  placeholder={t('activeSession.searchExercises')}
                  aria-label={t('activeSession.searchExercises')}
                  className="flex-1 text-[14px] bg-transparent focus:outline-none min-w-0"
                  style={{ color: 'var(--color-text-primary)' }}
                  autoFocus
                />
                <button
                  onClick={() => setShowFavoritesOnly(v => !v)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0 active:scale-90 transition-transform"
                  aria-label={t('activeSession.toggleFavoritesFilter', { defaultValue: 'Toggle favorites filter' })}
                  aria-pressed={showFavoritesOnly}
                >
                  <Star size={16} fill={showFavoritesOnly ? 'var(--color-accent)' : 'none'} style={{ color: showFavoritesOnly ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
                </button>
              </div>
            </div>

            {/* Chip pills — same vocabulary as the standalone Exercise Library
                so the mental model is consistent across the two surfaces. */}
            {(() => {
              const chipDefs = [
                { id: 'all',   label: t('exerciseLibrary.filterAll', { defaultValue: 'All' }) },
                { id: 'push',  label: t('exerciseLibrary.filterPush', { defaultValue: 'Push' }) },
                { id: 'pull',  label: t('exerciseLibrary.filterPull', { defaultValue: 'Pull' }) },
                { id: 'chest', label: t('muscleGroups.Chest', 'Chest') },
                { id: 'back',  label: t('muscleGroups.Back', 'Back') },
                { id: 'arms',  label: t('exerciseLibrary.filterArms', { defaultValue: 'Arms' }) },
                { id: 'legs',  label: t('muscleGroups.Legs', 'Legs') },
                { id: 'core',  label: t('muscleGroups.Core', 'Core') },
              ];
              return (
                <div className="px-4 pb-3 overflow-x-auto no-scrollbar">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    {chipDefs.map((c) => {
                      const active = c.id === addExerciseChip;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setAddExerciseChip(c.id)}
                          className="text-[12px] font-bold px-3.5 py-1.5 rounded-full transition-all active:scale-95"
                          style={{
                            background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                            color: active ? 'var(--color-text-on-accent, #0A0D14)' : 'var(--color-text-muted)',
                            border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          }}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Active filter badges */}
            {(selectedMuscle || selectedEquipment) && (
              <div className="px-4 pb-2 flex gap-2">
                {selectedMuscle && (
                  <button onClick={() => setSelectedMuscle('')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/20 active:scale-95" aria-label={t('activeSession.removeFilter', { name: t(`muscleGroups.${selectedMuscle}`, selectedMuscle), defaultValue: `Remove ${t(`muscleGroups.${selectedMuscle}`, selectedMuscle)} filter` })}>
                    {t(`muscleGroups.${selectedMuscle}`, selectedMuscle)}
                    <X size={12} />
                  </button>
                )}
                {selectedEquipment && (
                  <button onClick={() => setSelectedEquipment('')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-[#60A5FA]/15 text-[#60A5FA] border border-[#60A5FA]/20 active:scale-95" aria-label={t('activeSession.removeFilter', { name: selectedEquipment, defaultValue: `Remove ${selectedEquipment} filter` })}>
                    {selectedEquipment}
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Inline "Create your own" — same shape as the swap modal's
                custom creator. Saves to the gym's exercises table so the
                new exercise is available in future sessions. */}
            <div className="px-4 pb-3">
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={addCustomName}
                  onChange={(e) => setAddCustomName(e.target.value)}
                  placeholder={t('activeSession.addCustomPlaceholder', { defaultValue: 'Custom exercise (e.g. Sled Push)' })}
                  aria-label={t('activeSession.addCustomPlaceholder', { defaultValue: 'Custom exercise name' })}
                  maxLength={60}
                  onKeyDown={(e) => { if (e.key === 'Enter' && addCustomName.trim() && !addCustomSaving) handleCreateCustomAndAdd(); }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-dashed text-[13px] focus:outline-none"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)',
                    background: 'transparent',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <button
                  onClick={handleCreateCustomAndAdd}
                  disabled={!addCustomName.trim() || addCustomSaving}
                  className="px-3 py-2.5 rounded-xl text-[12px] font-bold flex items-center gap-1 disabled:opacity-40 active:scale-[0.97] transition-transform"
                  style={{
                    background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)',
                    color: 'var(--color-accent)',
                  }}
                >
                  <Plus size={14} strokeWidth={2.5} />
                  {addCustomSaving
                    ? t('activeSession.swapCustomSaving', { defaultValue: 'Saving…' })
                    : t('activeSession.swapCustomCreate', { defaultValue: 'Create' })}
                </button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                {t('activeSession.addCustomHint', { defaultValue: "We'll save it to your gym's catalogue so it's available next time." })}
              </p>
            </div>

            {/* Results — 2-column video-tile grid (matches the Exercise
                Library's "All Exercises" modal style). Tapping a tile adds
                the exercise to the active session immediately and closes the
                modal. */}
            <div className="flex-1 overflow-y-auto px-4 pb-6">
              {/* Suggested-for-this-session — surfaces complementary muscle
                  picks based on what's already in the routine. Hidden when
                  the user is actively filtering / searching so the explicit
                  filter wins. */}
              {suggestedExercises.length > 0 && !exerciseSearch && addExerciseChip === 'all' && !selectedMuscle && !selectedEquipment && !showFavoritesOnly && (
                <div className="mb-5">
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--color-accent)' }}>
                      {t('activeSession.suggestedForWorkout', { defaultValue: 'Suggested for this workout' })}
                    </p>
                    <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('activeSession.suggestedCount', { count: suggestedExercises.length, defaultValue: `${suggestedExercises.length} picks` })}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {suggestedExercises.map((ex) => {
                      const raw = ex.videoUrl || ex.video_url || ex.video;
                      const vsrc = raw
                        ? (/^(https?:|blob:|data:)/.test(raw)
                            ? raw
                            : `https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/${raw}`)
                        : null;
                      return (
                        <button
                          key={`sug-${ex.id}`}
                          type="button"
                          onClick={() => handleAddExerciseToSession(ex)}
                          className="relative aspect-[4/5] rounded-xl overflow-hidden text-left active:scale-[0.98] transition-transform"
                          style={{
                            background: '#000',
                            border: '1px solid color-mix(in srgb, var(--color-accent) 32%, transparent)',
                            boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-accent) 10%, transparent)',
                          }}
                          aria-label={t('activeSession.addExerciseAria', { name: exName(ex) || ex.name, defaultValue: `Add ${exName(ex) || ex.name}` })}
                        >
                          {vsrc ? (
                            <LazyVideoTile
                              src={vsrc}
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent)' }} />
                          )}
                          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)' }} />
                          <span
                            className="absolute top-2 left-2 inline-flex items-center justify-center rounded-full"
                            style={{
                              width: 26,
                              height: 26,
                              background: 'var(--color-accent)',
                              color: 'var(--color-text-on-accent, #0A0D14)',
                            }}
                          >
                            <Plus size={14} strokeWidth={2.6} />
                          </span>
                          <span
                            className="absolute top-2 right-2 inline-flex items-center gap-0.5 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded tabular-nums"
                            style={{
                              background: 'var(--color-accent)',
                              color: 'var(--color-text-on-accent, #0A0D14)',
                              letterSpacing: 0.4,
                            }}
                            aria-label={t('activeSession.suggestionMatchAria', { pct: Math.round(ex._suggestionMatch || 0), defaultValue: `${Math.round(ex._suggestionMatch || 0)}% match` })}
                          >
                            {Math.round(ex._suggestionMatch || 0)}%
                          </span>
                          <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
                            <p className="text-[11px] font-extrabold leading-tight" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                              {exName(ex) || ex.name}
                            </p>
                            <p className="text-[9px] font-semibold mt-0.5 opacity-85 uppercase tracking-wider" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                              {t(`muscleGroups.${ex.muscle}`, ex.muscle)}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--color-text-muted)' }}>
                {t('exerciseLibrary.countExercises', { count: filteredLibraryExercises.length, defaultValue: `${filteredLibraryExercises.length} exercises` })}
              </p>
              {filteredLibraryExercises.length === 0 ? (
                <div
                  className="rounded-2xl py-12 px-4 text-center"
                  style={{ background: 'var(--color-surface-hover)', border: '1px dashed var(--color-border-subtle)' }}
                >
                  <Dumbbell size={28} style={{ color: 'var(--color-text-subtle)' }} className="mx-auto mb-3" />
                  <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('activeSession.noExercisesFound', 'No matching exercises')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredLibraryExercises.map((ex) => {
                    const isFav = favoriteExerciseIds.has(ex.id);
                    const raw = ex.videoUrl || ex.video_url || ex.video;
                    const vsrc = raw
                      ? (/^(https?:|blob:|data:)/.test(raw)
                          ? raw
                          : `https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/${raw}`)
                      : null;
                    return (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => handleAddExerciseToSession(ex)}
                        className="relative aspect-[4/5] rounded-xl overflow-hidden text-left active:scale-[0.98] transition-transform"
                        style={{ background: '#000', border: '1px solid var(--color-border-subtle)' }}
                        aria-label={t('activeSession.addExerciseAria', { name: exName(ex) || ex.name, defaultValue: `Add ${exName(ex) || ex.name}` })}
                      >
                        {vsrc ? (
                          <LazyVideoTile
                            src={vsrc}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent)' }} />
                        )}
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)' }} />
                        {isFav && (
                          <span
                            className="absolute top-2 right-2 rounded-full p-1.5"
                            style={{ background: 'rgba(0,0,0,0.45)' }}
                            aria-hidden="true"
                          >
                            <Star size={12} fill="var(--color-accent)" style={{ color: 'var(--color-accent)' }} />
                          </span>
                        )}
                        <span
                          className="absolute top-2 left-2 inline-flex items-center justify-center rounded-full"
                          style={{
                            width: 26,
                            height: 26,
                            background: 'var(--color-accent)',
                            color: 'var(--color-text-on-accent, #0A0D14)',
                          }}
                        >
                          <Plus size={14} strokeWidth={2.6} />
                        </span>
                        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
                          <p className="text-[11px] font-extrabold leading-tight" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                            {exName(ex) || ex.name}
                          </p>
                          <p className="text-[10px] font-semibold mt-0.5 opacity-85" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                            {t(`muscleGroups.${ex.muscle}`, ex.muscle)}{ex.equipment ? ` · ${ex.equipment}` : ''}
                          </p>
                        </div>
                      </button>
                    );
                  })}
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
                  className="fixed inset-0 z-[260] flex items-center justify-center px-4"
                  role="dialog"
                  aria-label={t('activeSession.filterExercises', { defaultValue: 'Filter exercises' })}
                  onClick={() => setShowFilters(false)}
                >
                  <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="relative w-full max-w-lg rounded-[24px] pb-6 pt-5 px-5"
                    style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
                    onClick={e => e.stopPropagation()}
                  >

                    {/* Muscle filter */}
                    <p className="text-[14px] font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>{t('activeSession.filterByMuscle', 'Muscle Group')}</p>
                    <div className="grid grid-cols-3 gap-2 mb-5">
                      <button
                        onClick={() => setSelectedMuscle('')}
                        className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${!selectedMuscle ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)]' : ''}`}
                        style={selectedMuscle ? { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' } : {}}
                      >
                        {t('muscleGroups.All', 'All')}
                      </button>
                      {MUSCLE_GROUPS.map(mg => (
                        <button
                          key={mg}
                          onClick={() => setSelectedMuscle(selectedMuscle === mg ? '' : mg)}
                          className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${selectedMuscle === mg ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)]' : ''}`}
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
                          {t(`exerciseLibrary.equipmentNames.${eq}`, eq)}
                        </button>
                      ))}
                    </div>

                    {/* Apply */}
                    <button
                      onClick={() => setShowFilters(false)}
                      className="w-full py-3 rounded-xl font-bold text-[14px] bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] active:scale-[0.97] transition-transform"
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

      {/* ── In-session Exercise List Manager (Feat 3) ─────────────
          Reorder (up/down), swap (opens swap modal targeted at the row),
          delete, and add at end. Opens from the list icon next to the
          segmented progress bar.                                       */}
      <AnimatePresence>
        {showListManager && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[260] flex flex-col"
            style={{ backgroundColor: 'var(--color-bg-primary)', paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))' }}
            role="dialog"
            aria-label={t('activeSession.exerciseListTitle', 'Exercise list')}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {t('activeSession.exerciseListTitle', 'Exercise list')}
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('activeSession.exerciseListSubtitle', { defaultValue: '{{count}} exercises · reorder, swap, or remove', count: exercises.length })}
                </p>
              </div>
              <button
                onClick={() => setShowListManager(false)}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.06] hover:opacity-80 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ml-3 shrink-0"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label={t('activeSession.close', { defaultValue: 'Close' })}
              >
                <X size={20} />
              </button>
            </div>

            {/* Superset / Circuit toolbar — always visible whenever the
                routine has at least two exercises so the affordance is
                obvious. Banner mode below 2 selected, action mode at 2+. */}
            {exercises.length >= 2 && (
              <div className="mx-4 mb-2 p-3 rounded-2xl flex items-center gap-2"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
                }}
              >
                {listGroupSel.size >= 2 ? (
                  <>
                    <span className="text-[12px] font-semibold flex-1" style={{ color: 'var(--color-accent)' }}>
                      {t('activeSession.groupSelectedCount', { count: listGroupSel.size, defaultValue: `${listGroupSel.size} selected — group as:` })}
                    </span>
                    <button
                      onClick={() => handleListGroup('superset')}
                      className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[11px] font-bold active:scale-95 transition-transform"
                    >
                      {t('activeSession.superset', 'Superset')}
                    </button>
                    <button
                      onClick={() => handleListGroup('circuit')}
                      className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-bold active:scale-95 transition-transform"
                    >
                      {t('activeSession.circuit', 'Circuit')}
                    </button>
                  </>
                ) : (
                  <span className="text-[12px] font-semibold leading-snug" style={{ color: 'var(--color-accent)' }}>
                    {t('activeSession.supersetHint', {
                      defaultValue: 'Tap the checkbox on 2+ exercises to group them as a Superset or Circuit.',
                    })}
                  </span>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {exercises.map((ex, idx) => {
                const isActive = idx === currentExerciseIndex;
                const setCount = (loggedSets[ex.id] || []).length;
                const completedCount = (loggedSets[ex.id] || []).filter(s => s.completed && !s.skipped).length;
                const isInGroup = !!ex.groupId;
                const isSelectedForGroup = listGroupSel.has(idx);
                // Match the SessionHeader rule: tint the row when at least
                // one logged set on this exercise was completed inside a
                // superset/circuit, or — when no sets are logged yet — when
                // the exercise is currently paired.
                const rowGroupType = (() => {
                  const sets = loggedSets[ex.id] || [];
                  for (const s of sets) {
                    if (s?.completed && !s?.skipped && s.groupType) return s.groupType;
                  }
                  return ex.groupType || null;
                })();
                const ROW_TONE = { superset: '#8B5CF6', circuit: '#3B82F6' };
                const tone = ROW_TONE[rowGroupType] || 'var(--color-accent)';
                return (
                  <div
                    key={ex.id}
                    className="rounded-2xl flex items-center gap-2 px-3 py-3"
                    style={{
                      background: rowGroupType
                        ? `color-mix(in srgb, ${tone} 8%, var(--color-bg-card))`
                        : 'var(--color-bg-card)',
                      border: isActive
                        ? `1.5px solid color-mix(in srgb, ${tone} 60%, transparent)`
                        : rowGroupType
                          ? `1px solid color-mix(in srgb, ${tone} 28%, transparent)`
                          : '1px solid var(--color-border-subtle)',
                    }}
                  >
                    {/* Grouping checkbox — explicit affordance to multi-select
                        for superset/circuit creation. */}
                    <button
                      type="button"
                      onClick={() => toggleListGroupSel(idx)}
                      aria-label={isSelectedForGroup ? t('activeSession.ariaDeselect', 'Deselect') : t('activeSession.ariaSelect', 'Select to group')}
                      className="w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        background: isSelectedForGroup ? tone : 'transparent',
                        borderColor: isSelectedForGroup ? tone : 'var(--color-border-strong, rgba(255,255,255,0.25))',
                        color: ROW_TONE[rowGroupType] ? '#000' : 'var(--color-text-on-accent, #000)',
                      }}
                    >
                      {isSelectedForGroup && <span className="text-[12px] font-bold leading-none">&#10003;</span>}
                    </button>

                    {/* Position badge */}
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold tabular-nums"
                      style={{
                        background: isActive ? tone : 'color-mix(in srgb, var(--color-text-primary) 8%, transparent)',
                        color: isActive ? (ROW_TONE[rowGroupType] ? '#000' : 'var(--color-text-on-accent, #000)') : 'var(--color-text-muted)',
                      }}
                    >
                      {idx + 1}
                    </div>

                    <button
                      onClick={() => { setCurrentExerciseIndex(idx); setShowListManager(false); }}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {exName(ex)}
                        </p>
                        {ex.groupType && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                            ex.groupType === 'superset' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
                          }`}>
                            {ex.groupType === 'superset' ? t('activeSession.superset', 'Superset') : t('activeSession.circuit', 'Circuit')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                        {ex.targetSets} × {ex.targetReps}{setCount > 0 ? ` · ${completedCount}/${setCount}` : ''}
                      </p>
                    </button>

                    {isInGroup && (
                      <button
                        type="button"
                        onClick={() => handleListUngroup(ex.groupId)}
                        className="w-9 h-9 flex items-center justify-center rounded-lg active:scale-90 transition-transform focus:outline-none hover:text-red-400"
                        style={{ color: 'var(--color-text-muted)' }}
                        aria-label={t('activeSession.ungroup', 'Ungroup')}
                      >
                        <Unlink size={16} />
                      </button>
                    )}

                    {/* Up / down */}
                    <button
                      onClick={() => handleReorderExercise(idx, idx - 1)}
                      disabled={idx === 0}
                      className="w-9 h-9 flex items-center justify-center rounded-lg disabled:opacity-25 active:scale-90 transition-transform focus:outline-none"
                      style={{ color: 'var(--color-text-muted)' }}
                      aria-label={t('activeSession.moveUpAria', 'Move up')}
                    >
                      <ChevronLeft size={18} className="rotate-90" />
                    </button>
                    <button
                      onClick={() => handleReorderExercise(idx, idx + 1)}
                      disabled={idx === exercises.length - 1}
                      className="w-9 h-9 flex items-center justify-center rounded-lg disabled:opacity-25 active:scale-90 transition-transform focus:outline-none"
                      style={{ color: 'var(--color-text-muted)' }}
                      aria-label={t('activeSession.moveDownAria', 'Move down')}
                    >
                      <ChevronLeft size={18} className="-rotate-90" />
                    </button>

                    {/* Swap */}
                    <button
                      onClick={() => handleSwapAtIndex(idx)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg active:scale-90 transition-transform focus:outline-none"
                      style={{ color: 'var(--color-text-muted)' }}
                      aria-label={t('activeSession.swap', 'Swap')}
                    >
                      <ArrowLeftRight size={16} />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleRemoveExerciseAt(idx)}
                      disabled={exercises.length <= 1}
                      className="w-9 h-9 flex items-center justify-center rounded-lg active:scale-90 transition-transform disabled:opacity-25 focus:outline-none hover:text-red-400"
                      style={{ color: 'var(--color-text-muted)' }}
                      aria-label={t('activeSession.removeExercise', 'Remove')}
                    >
                      <Minus size={18} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add exercise — reuses the existing add-exercise picker */}
            <div className="flex-shrink-0 px-4 pb-6 pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <button
                onClick={() => { setShowListManager(false); setAddExerciseOrigin('list-manager'); setShowAddExercise(true); }}
                className="w-full py-3.5 rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform focus:outline-none"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
                  border: '1.5px solid color-mix(in srgb, var(--color-accent) 50%, transparent)',
                  color: 'var(--color-accent)',
                }}
              >
                <Plus size={18} strokeWidth={2.5} />
                {t('activeSession.addExercise', 'Add exercise')}
              </button>
            </div>
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
            className="fixed inset-0 z-[250] flex flex-col"
            style={{ backgroundColor: 'var(--color-bg-primary)', paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))' }}
            role="dialog"
            aria-label={t('activeSession.swapTitle', { exercise: exName(swapTargetExercise) })}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {t('activeSession.swapTitle', { exercise: exName(swapTargetExercise) })}
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                  {swapTargetMuscle && `${t(`muscleGroups.${swapTargetMuscle}`, swapTargetMuscle)} · `}{t('activeSession.swapSubtitle')}
                </p>
              </div>
              <button
                onClick={() => { setShowSwapModal(false); setSwapSearch(''); setSwapSelectedReason(null); }}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.06] hover:opacity-80 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ml-3 shrink-0"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label={t('activeSession.close', { defaultValue: 'Close' })}
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
                      ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)]'
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
                  aria-label={t('activeSession.swapSearchPlaceholder')}
                  className="w-full pl-9 pr-4 py-3 rounded-xl border border-white/[0.06] text-[14px] focus:border-[#D4AF37]/40 focus:outline-none"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
                  autoFocus
                />
              </div>
            </div>

            {/* Inline custom-exercise creator — saves to gym's exercises table
                under the swap target's muscle, then immediately swaps in. */}
            <div className="px-4 pb-3">
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={swapCustomName}
                  onChange={e => setSwapCustomName(e.target.value)}
                  placeholder={t('activeSession.swapCustomPlaceholder', { defaultValue: 'Custom exercise (e.g. Sitting Trap Raise)' })}
                  aria-label={t('activeSession.swapCustomPlaceholder', { defaultValue: 'Custom exercise name' })}
                  maxLength={60}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-dashed border-white/[0.12] text-[13px] focus:border-[#D4AF37]/50 focus:outline-none"
                  style={{ background: 'transparent', color: 'var(--color-text-primary)' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && swapCustomName.trim() && !swapCustomSaving) handleCreateCustomAndSwap(); }}
                />
                <button
                  onClick={handleCreateCustomAndSwap}
                  disabled={!swapCustomName.trim() || swapCustomSaving}
                  className="px-3 py-2.5 rounded-xl text-[12px] font-bold flex items-center gap-1 disabled:opacity-40 active:scale-[0.97] transition-transform"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)', color: 'var(--color-accent)' }}
                >
                  <Plus size={14} strokeWidth={2.5} />
                  {swapCustomSaving ? t('activeSession.swapCustomSaving', { defaultValue: 'Saving…' }) : t('activeSession.swapCustomCreate', { defaultValue: 'Create' })}
                </button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                {t('activeSession.swapCustomHint', { defaultValue: "We'll add it under {{muscle}} so it's available next time.", muscle: t(`muscleGroups.${swapTargetMuscle}`, swapTargetMuscle) || t('activeSession.swapCustomMuscleFallback', 'this muscle') })}
              </p>
            </div>

            {/* Results — same-muscle picks first as a 2-col tile grid, then
                an "Other muscles" grid. Same video-tile style as the Add
                Exercise modal so the experience stays consistent. */}
            <div className="flex-1 overflow-y-auto px-4 pb-6">
              {filteredSwapExercises.sameMuscle.length > 0 && swapTargetMuscle && (
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] pb-2" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('activeSession.swapSameMuscle', { defaultValue: '{{muscle}} alternatives', muscle: t(`muscleGroups.${swapTargetMuscle}`, swapTargetMuscle) })}
                </p>
              )}
              {filteredSwapExercises.sameMuscle.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {filteredSwapExercises.sameMuscle.map((ex) => {
                    const raw = ex.videoUrl || ex.video_url || ex.video;
                    const vsrc = raw
                      ? (/^(https?:|blob:|data:)/.test(raw)
                          ? raw
                          : `https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/${raw}`)
                      : null;
                    return (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => handleSwapExercise(ex)}
                        className="relative aspect-[4/5] rounded-xl overflow-hidden text-left active:scale-[0.98] transition-transform"
                        style={{
                          background: '#000',
                          border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
                        }}
                        aria-label={t('activeSession.swapToAria', { name: exName(ex) || ex.name, defaultValue: `Swap to ${exName(ex) || ex.name}` })}
                      >
                        {vsrc ? (
                          <LazyVideoTile
                            src={vsrc}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent)' }} />
                        )}
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)' }} />
                        <span
                          className="absolute top-2 left-2 inline-flex items-center justify-center rounded-full"
                          style={{ width: 26, height: 26, background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #0A0D14)' }}
                        >
                          <ArrowLeftRight size={13} strokeWidth={2.6} />
                        </span>
                        {typeof ex._swapMatch === 'number' && (
                          <span
                            className="absolute top-2 right-2 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded tabular-nums"
                            style={{
                              background: 'var(--color-accent)',
                              color: 'var(--color-text-on-accent, #0A0D14)',
                              letterSpacing: 0.4,
                            }}
                            aria-label={t('activeSession.swapMatchAria', { pct: ex._swapMatch, defaultValue: `${ex._swapMatch}% match` })}
                          >
                            {ex._swapMatch}%
                          </span>
                        )}
                        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
                          <p className="text-[11px] font-extrabold leading-tight" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                            {exName(ex) || ex.name}
                          </p>
                          <p className="text-[10px] font-semibold mt-0.5 opacity-85" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                            {t(`muscleGroups.${ex.muscle}`, ex.muscle)}{ex.equipment ? ` · ${ex.equipment}` : ''}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {filteredSwapExercises.otherMuscles.length > 0 && (
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] pb-2" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('activeSession.swapOtherMuscles', 'Other muscles')}
                </p>
              )}
              {filteredSwapExercises.otherMuscles.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {filteredSwapExercises.otherMuscles.map((ex) => {
                    const raw = ex.videoUrl || ex.video_url || ex.video;
                    const vsrc = raw
                      ? (/^(https?:|blob:|data:)/.test(raw)
                          ? raw
                          : `https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/${raw}`)
                      : null;
                    return (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => handleSwapExercise(ex)}
                        className="relative aspect-[4/5] rounded-xl overflow-hidden text-left active:scale-[0.98] transition-transform"
                        style={{ background: '#000', border: '1px solid var(--color-border-subtle)' }}
                        aria-label={t('activeSession.swapToAria', { name: exName(ex) || ex.name, defaultValue: `Swap to ${exName(ex) || ex.name}` })}
                      >
                        {vsrc ? (
                          <LazyVideoTile
                            src={vsrc}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.05), transparent)' }} />
                        )}
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)' }} />
                        <span
                          className="absolute top-2 left-2 inline-flex items-center justify-center rounded-full"
                          style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.55)', color: 'var(--color-text-primary)' }}
                        >
                          <ArrowLeftRight size={13} strokeWidth={2.6} />
                        </span>
                        {typeof ex._swapMatch === 'number' && (
                          <span
                            className="absolute top-2 right-2 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded tabular-nums"
                            style={{
                              background: 'rgba(0,0,0,0.55)',
                              color: '#fff',
                              letterSpacing: 0.4,
                            }}
                            aria-label={t('activeSession.swapMatchAria', { pct: ex._swapMatch, defaultValue: `${ex._swapMatch}% match` })}
                          >
                            {ex._swapMatch}%
                          </span>
                        )}
                        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
                          <p className="text-[11px] font-extrabold leading-tight" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                            {exName(ex) || ex.name}
                          </p>
                          <p className="text-[10px] font-semibold mt-0.5 opacity-85" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                            {t(`muscleGroups.${ex.muscle}`, ex.muscle)}{ex.equipment ? ` · ${ex.equipment}` : ''}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {filteredSwapExercises.sameMuscle.length === 0 && filteredSwapExercises.otherMuscles.length === 0 && (
                <div
                  className="rounded-2xl py-12 px-4 text-center"
                  style={{ background: 'var(--color-surface-hover)', border: '1px dashed var(--color-border-subtle)' }}
                >
                  <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('activeSession.swapNoResults')}
                  </p>
                </div>
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
                  onClick={hasNextExercise ? handleNext : () => setShowFinishModal(true)}
                  className={`w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:ring-2 focus:outline-none ${
                    hasNextExercise
                      ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] shadow-[0_4px_24px_rgba(212,175,55,0.3)] focus:ring-[#D4AF37]'
                      : 'bg-[#10B981] text-[var(--color-text-on-secondary,#fff)] shadow-[0_4px_24px_rgba(16,185,129,0.3)] focus:ring-[#10B981]'
                  }`}
                >
                  {hasNextExercise ? `${t('activeSession.nextExerciseButton')} →` : `${t('activeSession.finishWorkoutButton')} →`}
                </button>
              ) : (
                <button
                  onClick={handleCompleteSet}
                  disabled={!canComplete}
                  className={`w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                    canComplete
                      ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] shadow-[0_4px_24px_rgba(212,175,55,0.3)]'
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
          /* Cooldown active — distinct primary "Next stretch" and secondary
              "Skip all cooldown" controls. Two near-identical "Skip" buttons
              were confusing users (fix #11). */
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
                  className="w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:outline-none flex items-center justify-center gap-2"
                  style={isLast ? { backgroundColor: 'var(--color-success, #10B981)', color: 'var(--color-text-on-secondary, #fff)' } : { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
                >
                  <SkipForward size={16} strokeWidth={2.4} />
                  {isLast
                    ? t('activeSession.finishCooldown', 'Finish Cool Down')
                    : t('cooldown.nextStretch', { defaultValue: 'Next stretch' })}
                </button>
                <button
                  onClick={() => setCooldownPhase('done')}
                  className="w-full text-[12px] font-semibold py-2.5 rounded-xl transition-colors active:scale-[0.97]"
                  style={{ color: '#EF4444', border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)' }}
                >
                  {t('cooldown.skipCooldown', { defaultValue: 'Skip cooldown' })}
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
              className="flex-1 font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] bg-[#10B981] text-[var(--color-text-on-secondary,#fff)] shadow-[0_4px_24px_rgba(16,185,129,0.3)] focus:ring-2 focus:ring-[#10B981] focus:outline-none"
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
                  onClick={hasNextExercise ? handleNext : () => setShowFinishModal(true)}
                  className={`w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:ring-2 focus:outline-none ${
                    hasNextExercise
                      ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] shadow-[0_4px_24px_rgba(212,175,55,0.3)] focus:ring-[#D4AF37]'
                      : 'bg-[#10B981] text-[var(--color-text-on-secondary,#fff)] shadow-[0_4px_24px_rgba(16,185,129,0.3)] focus:ring-[#10B981]'
                  }`}
                >
                  {hasNextExercise ? `${t('activeSession.nextExerciseButton')} →` : `${t('activeSession.finishWorkoutButton')} →`}
                </button>
              ) : (
                <button
                  onClick={handleCompleteSet}
                  disabled={!canComplete}
                  className={`w-full font-bold text-[14px] py-4.5 rounded-2xl transition-all duration-200 active:scale-[0.98] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                    canComplete
                      ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] shadow-[0_4px_24px_rgba(212,175,55,0.3)]'
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
