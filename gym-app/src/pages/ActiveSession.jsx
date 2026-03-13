import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { computeSuggestion } from '../lib/overloadEngine';
import { requestNotificationPermission, scheduleRestDoneNotification, cancelRestNotification } from '../lib/restNotification';
import { addPoints, calculatePointsForAction } from '../lib/rewardsEngine';
import ExerciseProgressChart from '../components/ExerciseProgressChart';
import { exercises as localExercises } from '../data/exercises';
import Confetti from '../components/Confetti';

import SessionHeader from './active-session/SessionHeader';
import ExerciseCard from './active-session/ExerciseCard';
import RestTimer from './active-session/RestTimer';
import SessionSummary from './active-session/SessionSummary';

// ── PR Detection ──────────────────────────────────────────────────────────────
const epley1RM = (weight, reps) => {
  if (!weight || !reps || reps <= 0) return 0;
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
const PRBanner = ({ exercise, weight, reps, onDismiss }) => (
  <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-scale-pop">
    <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 max-w-xs">
      <Trophy size={24} className="flex-shrink-0 text-white" />
      <div className="flex-1">
        <p className="font-bold text-[15px] leading-tight text-white">New Personal Record!</p>
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

  // ── Session persistence ─────────────────────────────────────────────────────
  const sessionKey = `gym_session_${id}`;
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

  const [isResting, setIsResting]               = useState(false);
  const [restTimer, setRestTimer]               = useState(90);
  const [currentRestDuration, setCurrentRestDuration] = useState(90);

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
  const restNotificationScheduled = useRef(false);

  const touchStartXRef = useRef(0);

  // ── Notification permission ─────────────────────────────────────────────────
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // ── Load routine + prev session + PRs ──────────────────────────────────────
  useEffect(() => {
    if (!user || !profile) return;

    const load = async () => {
      setDataLoading(true);

      const { data: routine, error: routineErr } = await supabase
        .from('routines')
        .select(`
          id, name,
          routine_exercises(
            exercise_id, position, target_sets, target_reps, rest_seconds,
            exercises(id, name, muscle_group, equipment)
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
          history:     [],
        }));

      setExercises(sortedExercises);

      const exerciseIds = sortedExercises.map(e => e.id);
      const [{ data: prs }, { data: onboarding }] = await Promise.all([
        supabase.from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm')
          .eq('profile_id', user.id)
          .in('exercise_id', exerciseIds),
        supabase.from('member_onboarding')
          .select('fitness_level, primary_goal')
          .eq('profile_id', user.id)
          .maybeSingle(),
      ]);

      const prMap = {};
      prs?.forEach(pr => { prMap[pr.exercise_id] = { weight: pr.weight_lbs, reps: pr.reps }; });
      livePRs.current = prMap;

      const { data: lastSessions } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('profile_id', user.id)
        .eq('routine_id', id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1);

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

      // Fetch DB draft — more reliable than localStorage (survives browser restarts)
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: dbDraft } = await supabase
        .from('session_drafts')
        .select('*')
        .eq('profile_id', user.id)
        .eq('routine_id', id)
        .gte('updated_at', cutoff)
        .maybeSingle();

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

      if (draft?.loggedSets) {
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
        const initialSets = {};
        enriched.forEach(ex => {
          initialSets[ex.id] = Array.from({ length: ex.targetSets }).map(() => ({
            weight: '', reps: '', completed: false, isPR: false, rpe: null, notes: '',
          }));
        });
        setLoggedSets(initialSets);
      }

      setDataLoading(false);
    };

    load();
  }, [id, user, profile]);

  // ── Session timer — pauses when isPaused ────────────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    lastTickAt.current = Date.now();
    const interval = setInterval(() => {
      lastTickAt.current = Date.now();
      setElapsedTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  // ── Keep saveRef / draftSaveRef / isPausedRef in sync (synchronous, never stale) ──
  isPausedRef.current = isPaused;
  if (!dataLoading) {
    saveRef.current = {
      startedAt: startedAt.current,
      elapsedTime,
      loggedSets,
      sessionPRs,
      livePRs: livePRs.current,
      currentExerciseIndex,
      routineName,
    };
  }
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
    } catch { }
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
      if (saveRef.current) {
        try { localStorage.setItem(sessionKey, JSON.stringify(saveRef.current)); } catch { }
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        forceSave();
        saveDraftToDb();
      } else {
        // App returned to foreground — catch up seconds lost while backgrounded
        if (!isPausedRef.current) {
          const gapSeconds = Math.floor((Date.now() - lastTickAt.current) / 1000);
          if (gapSeconds > 1) {
            setElapsedTime(prev => prev + gapSeconds);
            lastTickAt.current = Date.now();
          }
        }
      }
    };
    window.addEventListener('beforeunload', forceSave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', forceSave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sessionKey]);

  // ── Rest timer — pauses with workout, fires notification when done ───────────
  useEffect(() => {
    if (!isResting || isPaused) return;
    // Schedule OS-level notification once when rest begins
    if (!restNotificationScheduled.current) {
      restNotificationScheduled.current = true;
      scheduleRestDoneNotification(
        exercises[currentExerciseIndex]?.name ?? 'exercise',
        restTimer
      );
    }
    if (restTimer <= 0) {
      setIsResting(false);
      return;
    }
    const interval = setInterval(() => setRestTimer(prev => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [isResting, restTimer, isPaused, exercises, currentExerciseIndex]);

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

        setCurrentRestDuration(restSeconds);
        setRestTimer(restSeconds);
        restNotificationScheduled.current = false;
        setIsResting(true);
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

    try {
      const { data: session, error: sessionErr } = await supabase
        .from('workout_sessions')
        .insert({
          profile_id: user.id, gym_id: profile.gym_id, routine_id: id,
          name: routineName, status: 'completed',
          started_at: startedAt.current, completed_at: new Date().toISOString(),
          duration_seconds: elapsedTime, total_volume_lbs: totalVolume,
          session_rating: sessionRating,
        })
        .select().single();

      if (sessionErr) throw sessionErr;

      for (let pos = 0; pos < exercises.length; pos++) {
        const exercise = exercises[pos];
        const completedOnly = (loggedSets[exercise.id] || []).filter(s => s.completed);
        if (completedOnly.length === 0) continue;

        const { data: se, error: seErr } = await supabase
          .from('session_exercises')
          .insert({ session_id: session.id, exercise_id: exercise.id, snapshot_name: exercise.name, position: pos + 1 })
          .select().single();
        if (seErr) throw seErr;

        const { error: setsErr } = await supabase.from('session_sets').insert(
          completedOnly.map((set, i) => ({
            session_exercise_id: se.id, set_number: i + 1,
            weight_lbs: parseFloat(set.weight) || 0, reps: parseInt(set.reps, 10) || 0,
            is_completed: true, is_pr: set.isPR,
            estimated_1rm: epley1RM(parseFloat(set.weight), parseInt(set.reps, 10)),
            suggested_weight_lbs: exercise.suggestion?.suggestedWeight ?? null,
            suggested_reps:       exercise.suggestion?.suggestedReps   ?? null,
            rpe: set.rpe ?? null,
            notes: set.notes || null,
          }))
        );
        if (setsErr) throw setsErr;
      }

      for (const pr of sessionPRs) {
        const e1rm = epley1RM(pr.weight, pr.reps);
        await supabase.from('personal_records').upsert({
          profile_id: user.id, gym_id: profile.gym_id, exercise_id: pr.exerciseId,
          weight_lbs: pr.weight, reps: pr.reps, estimated_1rm: e1rm,
          achieved_at: new Date().toISOString(), session_id: session.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id,exercise_id' });

        await supabase.from('pr_history').insert({
          profile_id: user.id, gym_id: profile.gym_id, exercise_id: pr.exerciseId,
          weight_lbs: pr.weight, reps: pr.reps, estimated_1rm: e1rm,
          achieved_at: new Date().toISOString(), session_id: session.id,
        });
      }

      // ── Post feed items ─────────────────────────────────────────────────
      const exercisesWithSets = exercises.filter(ex =>
        (loggedSets[ex.id] || []).some(s => s.completed)
      );
      // One workout_completed item
      await supabase.from('activity_feed_items').insert({
        gym_id:    profile.gym_id,
        actor_id:  user.id,
        type:      'workout_completed',
        is_public: true,
        data: {
          session_id:       session.id,
          routine_name:     routineName,
          duration_seconds: elapsedTime,
          total_volume_lbs: totalVolume,
          set_count:        completedSets,
          exercise_count:   exercisesWithSets.length,
        },
      });
      // One pr_hit item per PR
      for (const pr of sessionPRs) {
        await supabase.from('activity_feed_items').insert({
          gym_id:    profile.gym_id,
          actor_id:  user.id,
          type:      'pr_hit',
          is_public: true,
          data: {
            exercise_name: pr.exercise,
            weight_lbs:    pr.weight,
            reps:          pr.reps,
            estimated_1rm: epley1RM(pr.weight, pr.reps),
          },
        });
      }

      // ── Update streak_cache ─────────────────────────────────────────────────
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const { data: existingStreak } = await supabase
        .from('streak_cache')
        .select('current_streak_days, longest_streak_days, last_activity_date, streak_broken_at')
        .eq('profile_id', user.id)
        .single();

      if (!existingStreak) {
        // First ever session — create streak row
        await supabase.from('streak_cache').insert({
          profile_id: user.id,
          gym_id: profile.gym_id,
          current_streak_days: 1,
          longest_streak_days: 1,
          last_activity_date: today,
          streak_broken_at: null,
        });
      } else {
        const last = existingStreak.last_activity_date;
        const dayGap = last
          ? Math.floor((new Date(today) - new Date(last)) / 86400000)
          : 999;

        let newStreak, newLongest, newBrokenAt;

        if (dayGap <= 1) {
          // Same day or consecutive day — streak continues
          newStreak    = dayGap === 0 ? existingStreak.current_streak_days : existingStreak.current_streak_days + 1;
          newLongest   = Math.max(newStreak, existingStreak.longest_streak_days);
          newBrokenAt  = null; // streak is alive, clear any previous break
        } else {
          // Gap > 1 day — streak broke; record the moment it broke (day after last activity)
          newStreak    = 1;
          newLongest   = existingStreak.longest_streak_days;
          newBrokenAt  = existingStreak.streak_broken_at ?? new Date().toISOString(); // only set once per break
        }

        await supabase.from('streak_cache').update({
          current_streak_days: newStreak,
          longest_streak_days: newLongest,
          last_activity_date: today,
          streak_broken_at: newBrokenAt,
          updated_at: new Date().toISOString(),
        }).eq('profile_id', user.id);
      }

      // ── Update last_active_at on profile ───────────────────────────────────
      await supabase.from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', user.id);

      // ── Award XP ──────────────────────────────────────────────────────────
      let xpEarned = 0;
      // Workout completed
      const workoutXP = calculatePointsForAction('workout_completed');
      await addPoints(user.id, profile.gym_id, 'workout_completed', workoutXP, `Completed ${routineName}`);
      xpEarned += workoutXP;
      // PRs
      for (const pr of sessionPRs) {
        const prXP = calculatePointsForAction('pr_hit');
        await addPoints(user.id, profile.gym_id, 'pr_hit', prXP, `New PR: ${pr.exercise}`);
        xpEarned += prXP;
      }
      // First workout of the week bonus
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const { count: weekSessions } = await supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .gte('completed_at', startOfWeek.toISOString());
      if (weekSessions === 1) {
        const weeklyXP = calculatePointsForAction('first_weekly_workout');
        await addPoints(user.id, profile.gym_id, 'first_weekly_workout', weeklyXP, 'First workout this week');
        xpEarned += weeklyXP;
      }
      // Streak milestones — re-read the updated streak
      const { data: updatedStreak } = await supabase
        .from('streak_cache')
        .select('current_streak_days')
        .eq('profile_id', user.id)
        .single();
      const finalStreak = updatedStreak?.current_streak_days ?? 1;
      if (finalStreak === 7) {
        await addPoints(user.id, profile.gym_id, 'streak_7', calculatePointsForAction('streak_7'), '7-day streak!');
        xpEarned += calculatePointsForAction('streak_7');
      } else if (finalStreak === 30) {
        await addPoints(user.id, profile.gym_id, 'streak_30', calculatePointsForAction('streak_30'), '30-day streak!');
        xpEarned += calculatePointsForAction('streak_30');
      }

      localStorage.removeItem(sessionKey);
      // Clean up DB draft — fire-and-forget
      supabase.from('session_drafts')
        .delete()
        .eq('profile_id', user.id)
        .eq('routine_id', id);
      navigate('/session-summary', {
        replace: true,
        state: {
          routineName, elapsedTime, totalVolume, completedSets,
          totalSets,
          totalExercises: Object.values(loggedSets).filter(sets => sets.some(s => s.completed)).length, sessionPRs,
          completedAt: new Date().toISOString(),
          xpEarned,
        },
      });
    } catch (err) {
      setSaveError(err.message || 'Something went wrong saving your workout.');
      setSaving(false);
    }
  };

  // ── Loading screen ──────────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0F172A]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-amber-300 dark:border-amber-700 border-t-amber-500 dark:border-t-amber-400 rounded-full animate-spin" />
          <p className="text-[13px] text-[#64748B] dark:text-slate-400">Loading workout…</p>
        </div>
      </div>
    );
  }

  const currentExercise = exercises[currentExerciseIndex];
  const currentSets     = currentExercise ? (loggedSets[currentExercise.id] || []) : [];
  const knownPR         = currentExercise ? livePRs.current[currentExercise.id] : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex flex-col font-sans animate-fade-in bg-[#F8FAFC] dark:bg-[#0F172A]">

      {/* PR Banner */}
      {activePRBanner && (
        <PRBanner
          exercise={activePRBanner.exercise}
          weight={activePRBanner.weight}
          reps={activePRBanner.reps}
          onDismiss={() => setActivePRBanner(null)}
        />
      )}
      <Confetti active={showConfetti} onComplete={() => setShowConfetti(false)} />

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

      {/* Session Header (pause overlay, header bar, progress bar, resumed banner, exercise navigator) */}
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
        onDiscardSession={() => { localStorage.removeItem(sessionKey); navigate('/workouts'); }}
      />

      {/* Rest Timer Overlay (full-screen) */}
      {isResting && !isPaused && (
        <RestTimer
          restTimer={restTimer}
          currentRestDuration={currentRestDuration}
          formatTime={formatTime}
          onSkip={() => { setIsResting(false); cancelRestNotification(); restNotificationScheduled.current = false; }}
        />
      )}

      {/* Scrollable Exercise Area */}
      <div className="flex-1 overflow-y-auto">
        {currentExercise && (
          <ExerciseCard
            exercise={currentExercise}
            currentSets={currentSets}
            knownPR={knownPR}
            showPlateCalc={showPlateCalc}
            onTogglePlateCalc={() => setShowPlateCalc(v => !v)}
            showHeatmap={showHeatmap}
            onToggleHeatmap={() => setShowHeatmap(v => !v)}
            workedRegions={workedRegions}
            completedSetsCount={completedSets}
            expandedNotesSet={expandedNotesSet}
            onSetExpandedNotesSet={setExpandedNotesSet}
            showProgressChart={showProgressChart}
            onShowProgressChart={setShowProgressChart}
            onUpdateSet={handleUpdateSet}
            onToggleComplete={handleToggleComplete}
            onAddSet={handleAddSet}
            onRemoveSet={handleRemoveSet}
            onDuplicateLastSet={handleDuplicateLastSet}
            onFillSuggestion={handleFillSuggestion}
            isPRCheck={isPR}
            livePRs={livePRs.current}
            touchStartXRef={touchStartXRef}
          />
        )}
      </div>

      {/* Sticky Bottom — Finish Workout */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-slate-200 dark:border-white/10 bg-[#F8FAFC] dark:bg-[#0F172A]">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400 uppercase tracking-wide">
              How did it feel?
            </span>
            <div className="flex items-center gap-2">
              {[6, 7, 8, 9, 10].map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSessionRpe(v)}
                  className={`w-7 h-7 rounded-full text-[11px] font-semibold flex items-center justify-center ${
                    sessionRpe === v
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <span className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400 uppercase tracking-wide">
              Mood
            </span>
            <div className="flex items-center gap-1.5">
              {['easy', 'solid', 'crushed'].map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSessionFeeling(val)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-semibold capitalize ${
                    sessionFeeling === val
                      ? 'bg-amber-500 text-black'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowFinishModal(true)}
          className="mt-2 w-full font-bold text-[17px] py-4 rounded-2xl transition-colors active:scale-[0.99] bg-[#D4AF37] dark:bg-amber-500 text-black"
        >
          {completedSets === 0 ? 'End Session' : completedSets >= totalSets && totalSets > 0 ? 'Done — save it' : 'Finish Strong'}
        </button>
      </div>

      {/* Exercise progress chart modal */}
      {showProgressChart && (
        <ExerciseProgressChart
          exerciseId={showProgressChart.exerciseId}
          exerciseName={showProgressChart.exerciseName}
          onClose={() => setShowProgressChart(null)}
        />
      )}

    </div>
  );
};

export default ActiveSession;
