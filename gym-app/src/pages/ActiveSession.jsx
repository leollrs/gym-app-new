import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Timer, CheckCircle, Trophy, Plus, Pause, Play, X, TrendingUp, MessageSquare, Activity, Video } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { computeSuggestion } from '../lib/overloadEngine';
import { requestNotificationPermission, scheduleRestDoneNotification, cancelRestNotification } from '../lib/restNotification';
import BodyDiagram from '../components/BodyDiagram';
import ExerciseProgressChart from '../components/ExerciseProgressChart';
import ExerciseVideoModal from '../components/ExerciseVideoModal';
import { exercises as localExercises } from '../data/exercises';

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
  <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-fade-in">
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

// ── Finish Modal ──────────────────────────────────────────────────────────────
const FinishModal = ({ workout, sessionPRs, totalVolume, duration, completedSets, totalSets, onConfirm, onCancel, saving, error }) => (
  <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 backdrop-blur-sm">
    <div className="rounded-t-3xl w-full max-w-lg pb-10 pt-6 px-6 animate-fade-in bg-[#0F172A] border-t border-white/10 shadow-[0_-8px_40px_rgba(0,0,0,0.6)]">
      <div className="w-10 h-1 rounded-full mx-auto mb-6 bg-white/20" />
      <h2 className="font-black text-[24px] mb-1 text-[#E5E7EB]">That's a wrap.</h2>
      <p className="text-[14px] mb-6 text-[#6B7280]">{workout} · {duration}</p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { value: `${(totalVolume / 1000).toFixed(1)}k`, label: 'Volume lbs' },
          { value: totalSets > 0 ? `${completedSets}/${totalSets}` : completedSets, label: 'Sets Done' },
          { value: duration, label: 'Duration' },
        ].map(({ value, label }) => (
          <div key={label} className="rounded-2xl p-3 text-center bg-white/5 border border-white/8">
            <p className="text-[24px] font-black text-[#E5E7EB]">{value}</p>
            <p className="text-[10px] mt-0.5 uppercase font-semibold text-[#6B7280]">{label}</p>
          </div>
        ))}
      </div>

      {sessionPRs.length > 0 && (
        <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={16} className="text-[#D4AF37]" />
            <p className="text-[#D4AF37] font-bold text-[13px]">{sessionPRs.length} New PR{sessionPRs.length > 1 ? 's' : ''} 🔥</p>
          </div>
          {sessionPRs.map((pr, i) => (
            <p key={i} className="text-[13px] text-[#E5E7EB] py-0.5">
              {pr.exercise} — {pr.weight} lbs × {pr.reps}
            </p>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-2xl p-3 mb-4 text-[13px] text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={onConfirm}
        disabled={saving}
        className="w-full disabled:opacity-50 font-black text-[17px] py-4 rounded-2xl transition-colors mb-3 bg-[#D4AF37] text-black"
      >
        {saving ? 'Saving…' : 'Save & finish'}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="w-full font-semibold text-[15px] py-2 transition-colors text-[#6B7280]"
      >
        Not done yet
      </button>
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
  const [showDemoExercise, setShowDemoExercise] = useState(null);   // exercise object
  const restNotificationScheduled = useRef(false);

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

  const touchStartXRef = useRef(0);

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
  const currentExerciseLocal = currentExercise ? localExercises.find(e => e.id === currentExercise.id) : null;
  const restCircum      = 2 * Math.PI * 100;

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

      {/* Finish Modal */}
      {showFinishModal && (
        <FinishModal
          workout={routineName} sessionPRs={sessionPRs}
          totalVolume={totalVolume} duration={formatTime(elapsedTime)}
          completedSets={completedSets} totalSets={totalSets}
          onConfirm={handleFinish} onCancel={() => setShowFinishModal(false)}
          saving={saving} error={saveError}
        />
      )}

      {/* ── Pause Overlay ─────────────────────────────────────────────────── */}
      {isPaused && (
        <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center backdrop-blur-2xl bg-[#F8FAFC]/97 dark:bg-[#0F172A]/97">
          <p className="text-[11px] uppercase tracking-[0.22em] font-bold mb-5 text-[#64748B] dark:text-slate-400">
            Workout Paused
          </p>
          <p className="font-bold tabular-nums leading-none mb-2 text-[#0F172A] dark:text-slate-100"
            style={{ fontSize: 'clamp(60px,18vw,80px)' }}>
            {formatTime(elapsedTime)}
          </p>
          <p className="text-[13px] mb-16 text-[#64748B] dark:text-slate-400">Timer stopped</p>

          <button
            onClick={() => setIsPaused(false)}
            className="w-24 h-24 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform mb-10 bg-[#D4AF37] dark:bg-amber-500"
          >
            <Play size={34} fill="black" className="text-black ml-2" />
          </button>

          <button
            onClick={() => { setIsPaused(false); setShowFinishModal(true); }}
            className="font-semibold text-[15px] hover:opacity-80 transition-opacity text-red-500 dark:text-red-400"
          >
            End Workout
          </button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="flex-shrink-0 px-4 pb-3 border-b border-white/10 bg-[#05070B]"
        style={{
          paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-0.5 transition-opacity hover:opacity-70 -ml-1 p-1 text-[#9CA3AF]"
          >
            <ChevronLeft size={24} strokeWidth={2.5} />
            <span className="text-[15px] font-semibold -ml-1">Back</span>
          </button>
          <button
            onClick={() => setIsPaused(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all shadow-sm bg-white/90 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300"
          >
            <Pause size={16} />
          </button>
        </div>

        <div className="text-center">
          <h1 className="font-bold text-[17px] tracking-tight leading-none text-[#E5E7EB]">
            {routineName}
          </h1>
        </div>
      </header>

      {/* Progress bar */}
      <div className="flex-shrink-0 h-0.5 bg-slate-200 dark:bg-white/10">
        <div
          className="h-full transition-all duration-500 bg-amber-500 dark:bg-amber-400"
          style={{ width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%' }}
        />
      </div>

      {/* Resumed banner */}
      {showResumedBanner && savedSession?.loggedSets && (
        <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between gap-3 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800/60">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300">
              <Timer size={14} />
            </div>
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-blue-700 dark:text-blue-200">
                Session resumed
              </span>
              <span className="text-[12px] text-blue-600/80 dark:text-blue-300/80">
                Your progress from last time was restored.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { localStorage.removeItem(sessionKey); navigate('/workouts'); }}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 bg-red-50/70 dark:bg-red-900/30"
            >
              Discard
            </button>
            <button
              onClick={() => setShowResumedBanner(false)}
              className="w-7 h-7 flex items-center justify-center rounded-full text-blue-500 hover:bg-blue-100/80 dark:text-blue-300 dark:hover:bg-blue-800/60"
              aria-label="Dismiss resumed session message"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Exercise Navigator ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
        <button
          onClick={() => setCurrentExerciseIndex(i => Math.max(0, i - 1))}
          disabled={currentExerciseIndex === 0}
          className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-25 active:scale-90 transition-all bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400"
        >
          <ChevronLeft size={22} />
        </button>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5">
            {exercises.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentExerciseIndex(i)}
                className={`rounded-full transition-all duration-300 h-2 ${
                  i === currentExerciseIndex ? 'w-5 bg-amber-500 dark:bg-amber-400' : 'w-2 bg-black/12 dark:bg-white/20'
                }`}
              />
            ))}
          </div>
          <p className="text-[11px] font-semibold tabular-nums text-[#64748B] dark:text-slate-400">
            {currentExerciseIndex + 1} / {exercises.length}
          </p>
        </div>

        <button
          onClick={() => setCurrentExerciseIndex(i => Math.min(exercises.length - 1, i + 1))}
          disabled={currentExerciseIndex === exercises.length - 1}
          className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-25 active:scale-90 transition-all bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {/* ── Rest Timer Overlay (full-screen) ─────────────────────────────── */}
      {isResting && !isPaused && (
        <div className="fixed inset-0 z-[115] flex flex-col items-center justify-center backdrop-blur-2xl bg-[#F8FAFC]/96 dark:bg-[#0F172A]/96">
          <p className="text-[11px] uppercase tracking-[0.22em] font-bold mb-4 text-amber-700 dark:text-amber-400">
            Rest
          </p>

          {/* Circular countdown */}
          <div className="relative w-40 h-40 mb-5">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r="48"
                fill="none"
                className="stroke-slate-300 dark:stroke-white/20"
                strokeWidth="6"
              />
              <circle
                cx="60"
                cy="60"
                r="48"
                fill="none"
                className="stroke-amber-500 dark:stroke-amber-400 transition-all duration-1000"
                strokeWidth="6"
                strokeDasharray={2 * Math.PI * 48}
                strokeDashoffset={2 * Math.PI * 48 * (1 - restTimer / currentRestDuration)}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Timer size={18} className="text-amber-700 dark:text-amber-400" />
              <p className="mt-1 font-bold tabular-nums leading-none text-[#0F172A] dark:text-slate-100" style={{ fontSize: 'clamp(32px,8vw,40px)' }}>
                {formatTime(restTimer)}
              </p>
            </div>
          </div>

          <p className="text-[13px] mb-6 text-[#64748B] dark:text-slate-400">
            Next set when the timer hits zero.
          </p>

          <button
            onClick={() => { setIsResting(false); cancelRestNotification(); restNotificationScheduled.current = false; }}
            className="px-6 py-3 rounded-2xl font-semibold text-[14px] active:scale-95 transition-transform shadow-sm bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-400 border border-amber-300 dark:border-amber-600"
          >
            Skip rest
          </button>
        </div>
      )}

      {/* ── Scrollable Exercise Area ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {currentExercise && (
          <div className="px-4 pt-5 pb-6">
            <div className="rounded-2xl bg-white dark:bg-slate-800 border border-black/5 dark:border-white/10 shadow-sm px-4 py-4 md:px-5 md:py-5">

              {/* Exercise header */}
              <div className="mb-5">
                <h2 className="font-bold tracking-tight leading-tight flex items-center gap-2.5 text-[#0F172A] dark:text-slate-100" style={{ fontSize: 'clamp(20px,5vw,26px)' }}>
                  <button
                    onClick={() => setShowProgressChart({ exerciseId: currentExercise.id, exerciseName: currentExercise.name })}
                    className="text-left hover:opacity-80 active:opacity-60 transition-opacity"
                  >
                    {currentExercise.name}
                  </button>
                  <TrendingUp
                    size={15}
                    className="text-slate-300 dark:text-slate-600 flex-shrink-0 cursor-pointer hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
                    onClick={() => setShowProgressChart({ exerciseId: currentExercise.id, exerciseName: currentExercise.name })}
                  />
                  {currentSets.some(s => s.isPR) && (
                    <Trophy size={18} className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
                  )}
                </h2>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <p className="text-[13px] text-[#64748B] dark:text-slate-400">
                    Target: {currentExercise.targetSets} × {currentExercise.targetReps} reps
                  </p>
                  {knownPR && (
                    <p className="text-[12px] flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <Trophy size={11} /> PR: {knownPR.weight} lbs × {knownPR.reps}
                    </p>
                  )}
                  {currentExercise && (
                    <button
                      onClick={() => setShowDemoExercise(currentExercise)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all active:scale-95 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-transparent hover:border-slate-300 dark:hover:border-white/20"
                    >
                      <Video size={11} />
                      Watch Demo
                    </button>
                  )}
                </div>
              </div>

              {/* ── Overload suggestion chip ── */}
              {currentExercise.suggestion && (() => {
                const s = currentExercise.suggestion;
                if (s.note === 'first_time') return (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-4 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700/50">
                    <TrendingUp size={13} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
                    <p className="text-[12px] text-indigo-700 dark:text-indigo-300">
                      First time here. Find your working weight — go light.
                    </p>
                  </div>
                );
                return (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50">
                    <TrendingUp size={14} className="text-amber-700 dark:text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider leading-none mb-0.5 text-amber-700 dark:text-amber-400">
                        {s.note === 'increase_weight' ? 'Increase weight ↑' : 'Add reps →'}
                      </p>
                      <p className="text-[14px] font-bold leading-tight text-[#0F172A] dark:text-slate-100">
                        {s.suggestedWeight} lbs × {s.suggestedReps} reps
                      </p>
                      <p className="text-[11px] mt-0.5 text-[#64748B] dark:text-slate-400">{s.label}</p>
                    </div>
                    <button
                      onClick={() => handleFillSuggestion(currentExercise.id, s)}
                      className="text-[12px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-all bg-amber-100 dark:bg-amber-800/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-600"
                    >
                      Fill
                    </button>
                  </div>
                );
              })()}

              {/* Muscles heatmap toggle + panel */}
              {completedSets > 0 && (
                <div className="mb-4">
                  <button
                    onClick={() => setShowHeatmap(v => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all mb-2 ${
                      showHeatmap
                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-600/60'
                        : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-transparent'
                    }`}
                  >
                    <Activity size={11} />
                    Muscles
                  </button>
                  {showHeatmap && (
                    <BodyDiagram
                      primaryRegions={workedRegions.primary}
                      secondaryRegions={workedRegions.secondary}
                      title="Muscles worked this session"
                      compact
                    />
                  )}
                </div>
              )}

              {/* Column headers */}
              <div className="flex items-center gap-2 px-2 py-2 mb-2 text-[11px] font-semibold uppercase tracking-wider rounded-xl bg-slate-100 dark:bg-slate-700/80 text-[#64748B] dark:text-slate-400">
                <div className="w-8 text-center">Set</div>
                <div className="flex-1 min-w-[60px]">Previous</div>
                <div className="w-20 sm:w-24 text-center">lbs</div>
                <div className="w-16 sm:w-20 text-center">Reps</div>
                <div className="w-10 flex justify-center">
                  <CheckCircle size={13} strokeWidth={2.5} />
                </div>
              </div>

              {/* Set rows */}
              <div className="flex flex-col gap-2">
                {currentSets.map((set, setIndex) => {
                  const prev      = currentExercise.history[setIndex];
                  const prPending = !set.completed && isPR(
                    currentExercise.id, set.weight, set.reps, livePRs.current
                  );
                  const notesKey = `${currentExercise.id}-${setIndex}`;

                  return (
                    <div key={setIndex}>
                      {/* Main set row */}
                      <div
                        className={`flex items-center gap-2 px-2 py-2.5 rounded-2xl transition-all duration-300 ${
                          set.isPR
                            ? 'bg-amber-100/80 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-600/60'
                            : set.completed
                            ? 'bg-emerald-100/80 dark:bg-emerald-900/40 border border-emerald-300 dark:border-emerald-700/60'
                            : 'bg-white dark:bg-slate-700/50 border border-slate-200 dark:border-white/10'
                        }`}
                        onTouchStart={e => {
                          if (e.touches?.[0]) touchStartXRef.current = e.touches[0].clientX;
                        }}
                        onTouchEnd={e => {
                          const endX = e.changedTouches?.[0]?.clientX ?? 0;
                          const deltaX = endX - touchStartXRef.current;
                          if (Math.abs(deltaX) > 40) {
                            handleToggleComplete(
                              currentExercise.id,
                              setIndex,
                              currentExercise.name,
                              currentExercise.restSeconds
                            );
                          }
                        }}
                      >
                        <div className="w-8 flex flex-col items-center justify-center gap-0.5">
                          <span className="font-bold text-[15px] text-[#64748B] dark:text-slate-400">
                            {set.isPR
                              ? <Trophy size={14} className="text-amber-500 mx-auto" />
                              : setIndex + 1
                            }
                          </span>
                          {!set.completed && currentSets.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSet(currentExercise.id, setIndex)}
                              className="text-[9px] font-bold text-red-400/70 hover:text-red-400 transition-colors leading-none"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {/* Previous — gold arrow, visually distinct */}
                        <div className="flex-1 min-w-[60px] text-[12px] font-semibold truncate">
                          {prev ? (
                            <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                              ↑ {prev.weight}
                              <span className="opacity-50 text-[10px] mx-0.5">×</span>
                              {prev.reps}
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </div>

                        <div className="w-20 sm:w-24">
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={set.weight}
                            onChange={e => handleUpdateSet(currentExercise.id, setIndex, 'weight', e.target.value)}
                            placeholder="—"
                            disabled={set.completed}
                            className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${
                              set.isPR
                                ? 'text-amber-700 dark:text-amber-400 bg-transparent'
                                : set.completed
                                ? 'text-emerald-700 dark:text-emerald-400 bg-transparent'
                                : 'text-[#0F172A] dark:text-slate-100 bg-slate-50 dark:bg-slate-600/50'
                            }`}
                          />
                        </div>

                        <div className="w-16 sm:w-20">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={set.reps}
                            onChange={e => handleUpdateSet(currentExercise.id, setIndex, 'reps', e.target.value)}
                            placeholder="—"
                            disabled={set.completed}
                            className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${
                              set.isPR
                                ? 'text-amber-700 dark:text-amber-400 bg-transparent'
                                : set.completed
                                ? 'text-emerald-700 dark:text-emerald-400 bg-transparent'
                                : 'text-[#0F172A] dark:text-slate-100 bg-slate-50 dark:bg-slate-600/50'
                            }`}
                          />
                        </div>

                        <div className="w-10 flex flex-col items-center gap-0.5">
                          <button
                            onClick={() => handleToggleComplete(
                              currentExercise.id, setIndex,
                              currentExercise.name, currentExercise.restSeconds
                            )}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                              set.isPR
                                ? 'bg-amber-500 dark:bg-amber-500 text-white scale-110 shadow-lg shadow-amber-500/40'
                                : set.completed
                                ? 'bg-emerald-500 dark:bg-emerald-500 text-white scale-[1.08] shadow-lg shadow-emerald-500/40'
                                : prPending
                                ? 'bg-amber-100 dark:bg-amber-900/50 border-2 border-amber-500 dark:border-amber-400 text-amber-700 dark:text-amber-400'
                                : 'bg-slate-50 dark:bg-slate-600/50 border border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {set.completed
                              ? <CheckCircle size={18} strokeWidth={3} />
                              : <div className="w-3.5 h-3.5 rounded-sm border-2 border-slate-400 dark:border-slate-500 opacity-50" />
                            }
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDuplicateLastSet(
                                currentExercise.id,
                                setIndex,
                                currentExercise.history
                              )
                            }
                            className="mt-0.5 text-[9px] font-semibold text-indigo-600 dark:text-indigo-300 disabled:opacity-40"
                            disabled={set.completed}
                          >
                            Use last
                          </button>
                          {prPending && (
                            <span className="text-[9px] font-bold uppercase tracking-wide leading-none text-amber-600 dark:text-amber-400">
                              PR!
                            </span>
                          )}
                        </div>
                      </div>

                      {/* RPE + Notes sub-row — appears after completing a set */}
                      {set.completed && (
                        <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
                          {/* RPE picker */}
                          <div className="flex items-center gap-1 flex-1">
                            <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider w-7 shrink-0">RPE</span>
                            <div className="flex gap-0.5">
                              {[6, 7, 8, 9, 10].map(v => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => handleUpdateSet(currentExercise.id, setIndex, 'rpe', set.rpe === v ? null : v)}
                                  className={`w-7 h-7 rounded-full text-[11px] font-bold transition-all active:scale-90 ${
                                    set.rpe === v
                                      ? 'bg-emerald-500 text-white shadow-sm'
                                      : 'bg-slate-100 dark:bg-slate-700/80 text-slate-500 dark:text-slate-300'
                                  }`}
                                >
                                  {v}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Notes toggle */}
                          <button
                            type="button"
                            onClick={() => setExpandedNotesSet(expandedNotesSet === notesKey ? null : notesKey)}
                            className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-all ${
                              set.notes
                                ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            <MessageSquare size={10} />
                            {set.notes ? 'Note' : '+ Note'}
                          </button>
                        </div>
                      )}

                      {/* Notes input — expands inline */}
                      {expandedNotesSet === notesKey && (
                        <div className="px-2 pb-1.5">
                          <input
                            type="text"
                            value={set.notes || ''}
                            onChange={e => handleUpdateSet(currentExercise.id, setIndex, 'notes', e.target.value)}
                            placeholder="Add a note for this set..."
                            autoFocus
                            className="w-full text-[13px] bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none border border-slate-200 dark:border-white/10"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Set */}
              <button
                onClick={() => handleAddSet(currentExercise.id)}
                className="mt-3 w-full py-3 text-[13px] font-semibold rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
              >
                <Plus size={14} /> Add Set
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky Bottom — Finish Workout ───────────────────────────────── */}
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

      {/* Exercise video demo modal */}
      {showDemoExercise && (
        <ExerciseVideoModal
          exerciseName={showDemoExercise.name}
          instructions={showDemoExercise.instructions}
          onClose={() => setShowDemoExercise(null)}
        />
      )}

    </div>
  );
};

export default ActiveSession;
