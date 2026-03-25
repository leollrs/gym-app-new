import React, { useState, useEffect, useRef, useMemo, Component } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { computeSuggestion } from '../lib/overloadEngine';
import { requestNotificationPermission, scheduleRestDoneNotification, cancelRestNotification } from '../lib/restNotification';
import { startWorkoutNotification, updateWorkoutNotification, cancelWorkoutNotification } from '../lib/workoutNotification';
import { startLiveActivity, updateLiveActivity, endLiveActivity } from '../lib/liveActivityBridge';
import { syncWorkoutToWatch, syncWorkoutEnded, onWatchMessage } from '../lib/watchBridge';
import { useTranslation } from 'react-i18next';

import ExerciseProgressChart from '../components/ExerciseProgressChart';
import { exercises as localExercises } from '../data/exercises';
import Confetti from '../components/Confetti';

import SessionHeader from './active-session/SessionHeader';
import ExerciseCard from './active-session/ExerciseCard';
import RestTimer from './active-session/RestTimer';
import SessionSummary from './active-session/SessionSummary';

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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#05070B]">
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <p className="text-[17px] font-bold text-white">Something went wrong.</p>
            <p className="text-[13px] text-slate-400">Your workout data has been saved locally.</p>
            <button
              onClick={() => window.history.back()}
              className="mt-4 px-6 py-3 rounded-2xl bg-[#D4AF37] text-black font-bold text-[15px]"
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
  <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-scale-pop">
    <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 max-w-xs">
      <Trophy size={24} className="flex-shrink-0 text-white" />
      <div className="flex-1">
        <p className="font-bold text-[15px] leading-tight text-white">{t('activeSession.newPersonalRecord')}</p>
        <p className="text-[12px] text-white/90 mt-0.5">{exercise} — {weight} lbs × {reps}</p>
      </div>
      <button onClick={onDismiss} className="text-white/70 hover:text-white text-[20px] leading-none ml-1">×</button>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const ActiveSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { t } = useTranslation('pages');

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

  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(
    savedSession?.currentExerciseIndex ?? 0
  );
  const [isPaused, setIsPaused] = useState(false);

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
  const [saving, setSaving]                   = useState(false);
  const [saveError, setSaveError]             = useState('');

  const [activePRBanner, setActivePRBanner] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [sessionPRs, setSessionPRs]         = useState(savedSession?.sessionPRs ?? []);
  const livePRs = useRef({});
  // Always holds the latest state so beforeunload/visibilitychange can save without stale closures
  const saveRef = useRef(null);
  const lastTickAt = useRef(Date.now());
  const isPausedRef = useRef(false);
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
            handleToggleComplete(curEx.id, idx, curEx.name, curEx.restSeconds || 90);
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

  // ── Load routine + prev session + PRs ──────────────────────────────────────
  useEffect(() => {
    if (!user || !profile) return;

    const load = async () => {
      try {
      setDataLoading(true);

      const { data: routine, error: routineErr } = await supabase
        .from('routines')
        .select(`
          id, name,
          routine_exercises(
            exercise_id, position, target_sets, target_reps, rest_seconds,
            exercises(id, name, muscle_group, equipment, video_url)
          )
        `)
        .eq('id', id)
        .single();

      if (routineErr || !routine) { setDataLoading(false); return; }

      setRoutineName(routine.name);

      const sortedExercises = (routine.routine_exercises || [])
        .sort((a, b) => a.position - b.position)
        .map(re => ({
          id:          re.exercise_id,
          name:        re.exercises?.name ?? re.exercise_id,
          targetSets:  re.target_sets,
          targetReps:  re.target_reps,
          restSeconds: re.rest_seconds,
          videoUrl:    re.exercises?.video_url || null,
          history:     [],
        }));

      setExercises(sortedExercises);

      const exerciseIds = sortedExercises.map(e => e.id);
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Fetch PRs, onboarding, last session, and DB draft in parallel (was 4 sequential queries)
      const [{ data: prs }, { data: onboarding }, { data: lastSessions }, { data: dbDraft }] = await Promise.all([
        supabase.from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm')
          .eq('profile_id', user.id)
          .in('exercise_id', exerciseIds),
        supabase.from('member_onboarding')
          .select('fitness_level, primary_goal')
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
          .select('logged_sets, session_prs, live_prs, current_exercise_index, elapsed_time, started_at')
          .eq('profile_id', user.id)
          .eq('routine_id', id)
          .gte('updated_at', cutoff)
          .maybeSingle(),
      ]);

      const prMap = {};
      prs?.forEach(pr => { prMap[pr.exercise_id] = { weight: pr.weight_lbs, reps: pr.reps }; });
      livePRs.current = prMap;

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

      const enriched = sortedExercises.map(ex => ({
        ...ex,
        history:    prevSetsMap[ex.id] || [],
        suggestion: computeSuggestion(prevSetsMap[ex.id] || [], onboarding, ex.targetReps),
      }));
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
          }
        : savedSession
          ? {
              loggedSets:           savedSession.loggedSets,
              sessionPRs:           savedSession.sessionPRs,
              livePRs:              savedSession.livePRs,
              currentExerciseIndex: savedSession.currentExerciseIndex,
              elapsedTime:          savedSession.elapsedTime,
              startedAt:            savedSession.startedAt,
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

      setDataLoading(false);
      } catch (err) {
        console.error('ActiveSession load error:', err);
        setError(err.message || 'Failed to load workout data.');
        setDataLoading(false);
      }
    };

    load();
  }, [id, user, profile]);

  // ── Persistent lock-screen notification + Live Activity ─────────────────────
  useEffect(() => {
    if (dataLoading || !exercises.length) return;
    try {
      const cs = Object.values(loggedSets).flat().filter(s => s.completed).length;
      const ts = Object.values(loggedSets).flat().length;
      // startWorkoutNotification disabled — Live Activity replaces it
      startLiveActivity({
        routineName,
        totalSets: ts,
        completedSets: cs,
        currentExerciseName: exercises[currentExerciseIndex]?.name ?? '',
        startTimestamp: sessionStartTime.current,
      });
    } catch (e) { console.warn('Workout notification start failed:', e); }
  }, [dataLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dataLoading) return;
    try {
      const cs = Object.values(loggedSets).flat().filter(s => s.completed).length;
      const ts = Object.values(loggedSets).flat().length;
      const now = Math.floor((Date.now() - sessionStartTime.current) / 1000);
      const curEx = exercises[currentExerciseIndex];
      const curExSets = curEx ? (loggedSets[curEx.id] || []) : [];
      const curExDone = curExSets.filter(s => s.completed).length;
      const curExTotal = curExSets.length;
      const exLabel = curEx ? `${curEx.name} ${curExDone}/${curExTotal}` : '';
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
        exerciseName: curEx?.name ?? '',
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
  };
  if (!dataLoading && user && profile) {
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
      }));
    } catch { }
  }, [loggedSets, sessionPRs, dataLoading, sessionKey, currentExerciseIndex, elapsedTime, routineName]);

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
        exercises[currentExerciseIndex]?.name ?? 'exercise',
        restTimer
      );
    }
    if (restTimer <= 0) {
      setIsResting(false);
      restStartedAt.current = null;
      try { localStorage.removeItem(restStateKey); } catch { }
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
          setCurrentRestDuration(restSeconds);
          setRestTimer(restSeconds);
          restNotificationScheduled.current = false;
          restStartedAt.current = Date.now();
          currentRestDurationRef.current = restSeconds;
          // Persist rest state so it survives iOS app suspension
          try {
            localStorage.setItem(restStateKey, JSON.stringify({
              restStartedAt: Date.now(),
              duration: restSeconds,
            }));
          } catch { }
          setIsResting(true);
        } else {
          // Last set — trigger finish after state updates
          setTimeout(() => handleFinish(), 100);
        }
      } else {
        set.isPR = false;
      }

      updated[exerciseId][setIndex] = set;

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

  const handleFinish = async () => {
    setSaving(true);
    setSaveError('');
    setShowFinishModal(false); // close modal if open

    try {
      const payload = {
        routine_id: id,
        routine_name: routineName,
        started_at: startedAt.current,
        completed_at: new Date().toISOString(),
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
      navigate('/session-summary', {
        replace: true,
        state: {
          routineName, elapsedTime, totalVolume, completedSets,
          totalSets,
          totalExercises: Object.values(loggedSets).filter(sets => sets.some(s => s.completed)).length, sessionPRs,
          completedAt: new Date().toISOString(),
          xpEarned: result.xp_earned,
          sessionId: result.session_id,
          streak: result.streak,
          heartRate: watchHRSummary.current || (watchHeartRate ? { averageBPM: watchHeartRate.avgBPM, maxBPM: watchHeartRate.bpm, minBPM: 0 } : null),
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#05070B]">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-[17px] font-bold text-white">Failed to load workout</p>
          <p className="text-[13px] text-slate-400">{error}</p>
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0F172A]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-amber-700 border-t-amber-400 rounded-full animate-spin" />
          <p className="text-[13px] text-slate-400">Loading workout…</p>
        </div>
      </div>
    );
  }

  // Guard against out-of-bounds index (Fix #2)
  if (currentExerciseIndex < 0 || currentExerciseIndex >= exercises.length) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#05070B]">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-[17px] font-bold text-white">No exercises found</p>
          <p className="text-[13px] text-slate-400">This workout may have been modified.</p>
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

  const currentExercise = exercises[currentExerciseIndex];
  const currentSets     = currentExercise ? (loggedSets[currentExercise.id] || []) : [];
  const knownPR         = currentExercise ? livePRs.current[currentExercise.id] : null;

  // ── Derived: is current set ready to complete? ─────────────────────────────
  const activeSetIndex = currentSets.findIndex(s => !s.completed);
  const activeSet = activeSetIndex >= 0 ? currentSets[activeSetIndex] : null;
  const allSetsComplete = activeSetIndex === -1;
  const hasNextExercise = currentExerciseIndex < exercises.length - 1;
  const canComplete = activeSet
    && activeSet.reps && activeSet.weight
    && !isNaN(Number(activeSet.reps)) && Number(activeSet.reps) > 0
    && !isNaN(Number(activeSet.weight)) && Number(activeSet.weight) > 0;

  const handleCompleteSet = () => {
    if (!canComplete || !currentExercise) return;
    handleToggleComplete(
      currentExercise.id,
      activeSetIndex,
      currentExercise.name,
      currentExercise.restSeconds || 90
    );
  };

  const handleNext = () => {
    if (hasNextExercise) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
    } else {
      setShowFinishModal(true);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex flex-col font-sans animate-fade-in bg-[#05070B]">

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
          <div className="bg-amber-900/90 border border-amber-500/30 px-4 py-2.5 rounded-xl shadow-lg">
            <p className="text-[12px] text-amber-200">{saveWarning}</p>
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
        routineName={routineName}
        isPaused={isPaused}
        elapsedTime={elapsedTime}
        formatTime={formatTime}
        completedSets={completedSets}
        totalSets={totalSets}
        exercises={exercises}
        currentExerciseIndex={currentExerciseIndex}
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
          onSkip={() => { setIsResting(false); restStartedAt.current = null; cancelRestNotification(); restNotificationScheduled.current = false; try { localStorage.removeItem(restStateKey); } catch { } }}
        />
      )}

      {/* Scrollable Exercise Area */}
      <div className="flex-1 overflow-y-auto">
        {currentExercise && (
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
            isPRCheck={isPR}
            livePRs={livePRs.current}
          />
        )}
      </div>

      {/* ── Sticky Bottom — Single primary action ──────────────── */}
      <div className="flex-shrink-0 px-5 pb-6 pt-4 bg-gradient-to-t from-[#05070B] via-[#05070B] to-transparent">
        {allSetsComplete ? (
          <button
            onClick={handleNext}
            className="w-full font-black text-[17px] py-4.5 rounded-2xl transition-all active:scale-[0.98] bg-[#D4AF37] text-black shadow-[0_4px_24px_rgba(212,175,55,0.3)]"
          >
            {hasNextExercise ? `${t('activeSession.nextExerciseButton')} →` : `${t('activeSession.finishWorkoutButton')} →`}
          </button>
        ) : (
          <button
            onClick={handleCompleteSet}
            disabled={!canComplete}
            className={`w-full font-black text-[17px] py-4.5 rounded-2xl transition-all active:scale-[0.98] ${
              canComplete
                ? 'bg-[#D4AF37] text-black shadow-[0_4px_24px_rgba(212,175,55,0.3)]'
                : 'bg-white/[0.06] text-[#4B5563] cursor-not-allowed'
            }`}
          >
            {t('activeSession.completeSet')} →
          </button>
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
