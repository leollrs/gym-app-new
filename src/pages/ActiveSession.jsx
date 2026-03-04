import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Timer, CheckCircle, Trophy, Plus, Pause, Play, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

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
const FinishModal = ({ workout, sessionPRs, totalVolume, duration, onConfirm, onCancel, saving, error }) => (
  <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/30 backdrop-blur-sm">
    <div className="rounded-t-3xl w-full max-w-lg pb-10 pt-6 px-6 animate-fade-in"
      style={{ background: 'var(--bg-card)', boxShadow: '0 -8px 40px rgba(0,0,0,0.12)' }}>
      <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: 'rgba(0,0,0,0.12)' }} />
      <h2 className="font-bold text-[22px] mb-1" style={{ color: 'var(--text-primary)' }}>Finish Workout?</h2>
      <p className="text-[14px] mb-6" style={{ color: 'var(--text-muted)' }}>{workout} · {duration}</p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { value: `${(totalVolume / 1000).toFixed(1)}k`, label: 'Volume lbs' },
          { value: sessionPRs.length, label: 'New PRs' },
          { value: duration, label: 'Duration' },
        ].map(({ value, label }) => (
          <div key={label} className="rounded-2xl p-3 text-center" style={{ background: 'var(--bg-elevated)' }}>
            <p className="text-[22px] font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
            <p className="text-[11px] mt-0.5 uppercase font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</p>
          </div>
        ))}
      </div>

      {sessionPRs.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={16} className="text-amber-500" />
            <p className="text-amber-700 font-bold text-[13px]">Personal Records This Session</p>
          </div>
          {sessionPRs.map((pr, i) => (
            <p key={i} className="text-[13px] text-amber-900 py-0.5">
              🏆 {pr.exercise} — {pr.weight} lbs × {pr.reps}
            </p>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4 text-[13px] text-red-600">
          {error}
        </div>
      )}

      <button
        onClick={onConfirm}
        disabled={saving}
        className="w-full disabled:opacity-50 font-bold text-[17px] py-4 rounded-2xl transition-colors mb-3"
        style={{ background: 'var(--accent-gold)', color: '#000' }}
      >
        {saving ? 'Saving…' : 'Save Workout'}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="w-full font-semibold text-[15px] py-2 transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        Keep Going
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

  // ── Notification permission ─────────────────────────────────────────────────
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
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
      const { data: prs } = await supabase
        .from('personal_records')
        .select('exercise_id, weight_lbs, reps, estimated_1rm')
        .eq('profile_id', user.id)
        .in('exercise_id', exerciseIds);

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
        history: prevSetsMap[ex.id] || [],
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
          restored[ex.id] = draft.loggedSets[ex.id] ??
            Array.from({ length: ex.targetSets }).map(() => ({
              weight: '', reps: '', completed: false, isPR: false,
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
            weight: '',
            reps:   '',
            completed: false, isPR: false,
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
    if (restTimer <= 0) {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Rest Complete! 💪', {
          body: `Time for your next set of ${exercises[currentExerciseIndex]?.name ?? 'the exercise'}!`,
          icon: '/favicon.ico',
        });
      }
      setIsResting(false);
      return;
    }
    const interval = setInterval(() => setRestTimer(prev => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [isResting, restTimer, isPaused, exercises, currentExerciseIndex]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const totalVolume = Object.entries(loggedSets).reduce((sum, [, sets]) =>
    sum + sets.filter(s => s.completed).reduce((s2, set) =>
      s2 + (parseFloat(set.weight) || 0) * (parseInt(set.reps, 10) || 0), 0)
  , 0);

  const completedSets = Object.values(loggedSets).flat().filter(s => s.completed).length;
  const totalSets     = Object.values(loggedSets).flat().length;

  const handleUpdateSet = (exerciseId, setIndex, field, value) => {
    setLoggedSets(prev => {
      const updated = { ...prev, [exerciseId]: [...prev[exerciseId]] };
      updated[exerciseId][setIndex] = { ...updated[exerciseId][setIndex], [field]: value };
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
    setLoggedSets(prev => ({
      ...prev,
      [exerciseId]: [...prev[exerciseId], { weight: '', reps: '', completed: false, isPR: false }],
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
          totalExercises: exercises.length, sessionPRs,
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center"
        style={{ background: 'var(--bg-main)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(212,175,55,0.3)', borderTopColor: '#D4AF37' }} />
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Loading workout…</p>
        </div>
      </div>
    );
  }

  const currentExercise = exercises[currentExerciseIndex];
  const currentSets     = currentExercise ? (loggedSets[currentExercise.id] || []) : [];
  const knownPR         = currentExercise ? livePRs.current[currentExercise.id] : null;
  const restCircum      = 2 * Math.PI * 100;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex flex-col font-sans animate-fade-in"
      style={{ background: 'var(--bg-main)' }}>

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
          onConfirm={handleFinish} onCancel={() => setShowFinishModal(false)}
          saving={saving} error={saveError}
        />
      )}

      {/* ── Pause Overlay ─────────────────────────────────────────────────── */}
      {isPaused && (
        <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center backdrop-blur-2xl"
          style={{ background: 'rgba(248,250,252,0.97)' }}>
          <p className="text-[11px] uppercase tracking-[0.22em] font-bold mb-5"
            style={{ color: 'var(--text-muted)' }}>
            Workout Paused
          </p>
          <p className="font-bold tabular-nums leading-none mb-2"
            style={{ fontSize: 'clamp(60px,18vw,80px)', color: 'var(--text-primary)' }}>
            {formatTime(elapsedTime)}
          </p>
          <p className="text-[13px] mb-16" style={{ color: 'var(--text-muted)' }}>Timer stopped</p>

          <button
            onClick={() => setIsPaused(false)}
            className="w-24 h-24 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform mb-10"
            style={{ background: 'var(--accent-gold)' }}
          >
            <Play size={34} fill="black" className="text-black ml-2" />
          </button>

          <button
            onClick={() => { setIsPaused(false); setShowFinishModal(true); }}
            className="font-semibold text-[15px] hover:opacity-80 transition-opacity"
            style={{ color: 'var(--danger)' }}
          >
            End Workout
          </button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 px-4 py-4 flex items-center justify-between relative"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-main)' }}>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-0.5 transition-opacity hover:opacity-70 -ml-1 p-1"
          style={{ color: '#3B82F6' }}
        >
          <ChevronLeft size={26} strokeWidth={2.5} />
          <span className="text-[16px] font-semibold -ml-1">Back</span>
        </button>

        <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none">
          <h1 className="font-semibold text-[16px] tracking-tight leading-none"
            style={{ color: 'var(--text-primary)' }}>
            {routineName}
          </h1>
          <p className="font-medium text-[13px] flex items-center justify-center gap-1 mt-0.5"
            style={{ color: '#3B82F6' }}>
            <Timer size={11} strokeWidth={2.5} /> {formatTime(elapsedTime)}
          </p>
        </div>

        <button
          onClick={() => setIsPaused(true)}
          className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
          style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid var(--border-subtle)' }}
        >
          <Pause size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </header>

      {/* Progress bar */}
      <div className="flex-shrink-0 h-0.5" style={{ background: 'var(--border-subtle)' }}>
        <div
          className="h-full transition-all duration-500"
          style={{ width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%', background: 'var(--accent-gold)' }}
        />
      </div>

      {/* Resumed banner */}
      {savedSession?.loggedSets && (
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between"
          style={{ background: 'rgba(59,130,246,0.06)', borderBottom: '1px solid rgba(59,130,246,0.15)' }}>
          <p className="text-[12px] font-semibold" style={{ color: '#3B82F6' }}>
            Session resumed — your progress was saved
          </p>
          <button
            onClick={() => { localStorage.removeItem(sessionKey); navigate('/workouts'); }}
            className="text-[12px] font-semibold hover:opacity-70 transition-opacity"
            style={{ color: 'var(--danger)' }}
          >
            Discard
          </button>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex-shrink-0 flex items-center justify-center gap-5 py-2.5 text-[12px]"
        style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
        <span>{completedSets}/{totalSets} sets</span>
        <span style={{ color: 'var(--border-strong)' }}>·</span>
        <span>{(totalVolume / 1000).toFixed(1)}k lbs</span>
        {sessionPRs.length > 0 && (
          <>
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            <span className="flex items-center gap-1 font-semibold text-amber-600">
              <Trophy size={11} /> {sessionPRs.length} PR{sessionPRs.length > 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* ── Exercise Navigator ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setCurrentExerciseIndex(i => Math.max(0, i - 1))}
          disabled={currentExerciseIndex === 0}
          className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-25 active:scale-90 transition-all"
          style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--text-secondary)' }}
        >
          <ChevronLeft size={22} />
        </button>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5">
            {exercises.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentExerciseIndex(i)}
                className="rounded-full transition-all duration-300"
                style={{
                  width:  i === currentExerciseIndex ? 20 : 8,
                  height: 8,
                  background: i === currentExerciseIndex
                    ? 'var(--accent-gold)'
                    : 'rgba(0,0,0,0.12)',
                }}
              />
            ))}
          </div>
          <p className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {currentExerciseIndex + 1} / {exercises.length}
          </p>
        </div>

        <button
          onClick={() => setCurrentExerciseIndex(i => Math.min(exercises.length - 1, i + 1))}
          disabled={currentExerciseIndex === exercises.length - 1}
          className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-25 active:scale-90 transition-all"
          style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--text-secondary)' }}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {/* ── Rest Timer Chip (inline, not fullscreen) ─────────────────────── */}
      {isResting && !isPaused && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3"
          style={{ background: 'rgba(212,175,55,0.07)', borderBottom: '1px solid rgba(212,175,55,0.2)' }}>
          {/* Mini ring */}
          <div className="relative w-10 h-10 flex-shrink-0">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="3" />
              <circle
                cx="20" cy="20" r="16" fill="none"
                stroke="var(--accent-gold)" strokeWidth="3"
                strokeDasharray={2 * Math.PI * 16}
                strokeDashoffset={2 * Math.PI * 16 * (1 - restTimer / currentRestDuration)}
                strokeLinecap="round"
                className="transition-all duration-1000"
              />
            </svg>
            <Timer size={12} className="absolute inset-0 m-auto" style={{ color: 'var(--accent-gold)' }} />
          </div>

          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-gold-dark)' }}>
              Rest
            </p>
            <p className="font-bold text-[24px] tabular-nums leading-tight" style={{ color: 'var(--text-primary)' }}>
              {formatTime(restTimer)}
            </p>
          </div>

          <button
            onClick={() => setIsResting(false)}
            className="font-semibold text-[13px] px-4 py-2 rounded-xl active:scale-95 transition-all"
            style={{
              background: 'rgba(212,175,55,0.15)',
              color: 'var(--accent-gold-dark)',
              border: '1px solid rgba(212,175,55,0.3)',
            }}
          >
            Skip
          </button>
        </div>
      )}

      {/* ── Scrollable Exercise Area ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {currentExercise && (
          <div className="px-4 pt-5 pb-6">

            {/* Exercise header */}
            <div className="mb-5">
              <h2 className="font-bold tracking-tight leading-tight flex items-center gap-2.5"
                style={{ fontSize: 'clamp(20px,5vw,26px)', color: 'var(--text-primary)' }}>
                {currentExercise.name}
                {currentSets.some(s => s.isPR) && (
                  <Trophy size={18} className="text-amber-500 flex-shrink-0" />
                )}
              </h2>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  Target: {currentExercise.targetSets} × {currentExercise.targetReps} reps
                </p>
                {knownPR && (
                  <p className="text-[12px] flex items-center gap-1 text-amber-600">
                    <Trophy size={11} /> PR: {knownPR.weight} lbs × {knownPR.reps}
                  </p>
                )}
              </div>
            </div>

            {/* Column headers */}
            <div className="flex items-center gap-2 px-2 py-2 mb-2 text-[11px] font-semibold uppercase tracking-wider rounded-xl"
              style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--text-muted)' }}>
              <div className="w-8 text-center">Set</div>
              <div className="flex-1 min-w-[60px]">Previous</div>
              <div className="w-16 sm:w-20 text-center">lbs</div>
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

                return (
                  <div
                    key={setIndex}
                    className="flex items-center gap-2 px-2 py-2.5 rounded-2xl transition-all duration-300"
                    style={
                      set.isPR
                        ? { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }
                        : set.completed
                        ? { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }
                        : { background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-subtle)' }
                    }
                  >
                    <div className="w-8 text-center font-bold text-[15px]"
                      style={{ color: 'var(--text-muted)' }}>
                      {set.isPR
                        ? <Trophy size={14} className="text-amber-500 mx-auto" />
                        : setIndex + 1
                      }
                    </div>

                    <div className="flex-1 min-w-[60px] text-[13px] font-medium truncate"
                      style={{ color: 'var(--text-muted)' }}>
                      {prev
                        ? <>{prev.weight} <span className="opacity-50 text-[11px] mx-0.5">×</span> {prev.reps}</>
                        : '—'
                      }
                    </div>

                    <div className="w-16 sm:w-20">
                      <input
                        type="number" inputMode="decimal"
                        value={set.weight}
                        onChange={e => handleUpdateSet(currentExercise.id, setIndex, 'weight', e.target.value)}
                        placeholder="—"
                        disabled={set.completed}
                        className="w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors"
                        style={
                          set.isPR
                            ? { color: '#D97706', background: 'transparent' }
                            : set.completed
                            ? { color: '#059669', background: 'transparent' }
                            : { color: 'var(--text-primary)', background: 'var(--bg-elevated)' }
                        }
                      />
                    </div>

                    <div className="w-16 sm:w-20">
                      <input
                        type="number" inputMode="numeric"
                        value={set.reps}
                        onChange={e => handleUpdateSet(currentExercise.id, setIndex, 'reps', e.target.value)}
                        placeholder="—"
                        disabled={set.completed}
                        className="w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors"
                        style={
                          set.isPR
                            ? { color: '#D97706', background: 'transparent' }
                            : set.completed
                            ? { color: '#059669', background: 'transparent' }
                            : { color: 'var(--text-primary)', background: 'var(--bg-elevated)' }
                        }
                      />
                    </div>

                    <div className="w-10 flex flex-col items-center gap-0.5">
                      <button
                        onClick={() => handleToggleComplete(
                          currentExercise.id, setIndex,
                          currentExercise.name, currentExercise.restSeconds
                        )}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                        style={
                          set.isPR
                            ? { background: '#F59E0B', color: '#fff', transform: 'scale(1.1)', boxShadow: '0 4px 12px rgba(245,158,11,0.4)' }
                            : set.completed
                            ? { background: '#10B981', color: '#fff', transform: 'scale(1.1)', boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }
                            : prPending
                            ? { background: 'rgba(245,158,11,0.15)', border: '2px solid rgba(245,158,11,0.6)', color: '#D97706' }
                            : { background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)' }
                        }
                      >
                        {set.completed
                          ? <CheckCircle size={18} strokeWidth={3} />
                          : <div className="w-3.5 h-3.5 rounded-sm border-2" style={{ borderColor: 'var(--text-muted)', opacity: 0.5 }} />
                        }
                      </button>
                      {prPending && (
                        <span className="text-[9px] font-bold uppercase tracking-wide leading-none text-amber-600">
                          PR!
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add Set */}
            <button
              onClick={() => handleAddSet(currentExercise.id)}
              className="mt-3 w-full py-3 text-[13px] font-semibold rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 text-blue-600"
              style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}
            >
              <Plus size={14} /> Add Set
            </button>
          </div>
        )}
      </div>

      {/* ── Sticky Bottom — Finish Workout ───────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-4" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-main)' }}>
        <button
          onClick={() => setShowFinishModal(true)}
          className="w-full font-bold text-[17px] py-4 rounded-2xl transition-colors active:scale-[0.99]"
          style={{ background: 'var(--accent-gold)', color: '#000' }}
        >
          Finish Workout
        </button>
      </div>
    </div>
  );
};

export default ActiveSession;
