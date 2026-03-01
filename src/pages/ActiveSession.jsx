import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Timer, CheckCircle, Info, Trophy, Plus, Zap } from 'lucide-react';
import { workoutHistory, personalRecords } from '../mockDb';

// ── PR Detection ─────────────────────────────────────────────────────────────
// Estimate one-rep max using Epley formula: w * (1 + r/30)
const epley1RM = (weight, reps) => {
  if (!weight || !reps || reps <= 0) return 0;
  return weight * (1 + reps / 30);
};

const isPR = (exerciseId, weight, reps, knownPRs) => {
  const w = parseFloat(weight);
  const r = parseInt(reps, 10);
  if (!w || !r) return false;
  const pr = knownPRs[exerciseId];
  if (!pr) return true; // First ever log = PR
  return epley1RM(w, r) > epley1RM(pr.weight, pr.reps);
};

// ── PR Celebration Banner ─────────────────────────────────────────────────────
const PRBanner = ({ exercise, weight, reps, onDismiss }) => (
  <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-fade-in">
    <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 max-w-xs">
      <Trophy size={24} className="flex-shrink-0" />
      <div className="flex-1">
        <p className="font-bold text-[15px] leading-tight">New Personal Record!</p>
        <p className="text-[12px] opacity-90 mt-0.5">{exercise} — {weight} lbs × {reps}</p>
      </div>
      <button onClick={onDismiss} className="text-white/70 hover:text-white text-[20px] leading-none ml-1">×</button>
    </div>
  </div>
);

// ── Finish Modal ──────────────────────────────────────────────────────────────
const FinishModal = ({ workout, sessionPRs, totalVolume, duration, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 backdrop-blur-sm">
    <div className="bg-[#1C1C1E] rounded-t-3xl w-full max-w-lg pb-10 pt-6 px-6 animate-fade-in">
      <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />
      <h2 className="text-white font-bold text-[22px] mb-1">Finish Workout?</h2>
      <p className="text-slate-400 text-[14px] mb-6">{workout} · {duration}</p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white/5 rounded-2xl p-3 text-center">
          <p className="text-[22px] font-bold text-white">{(totalVolume / 1000).toFixed(1)}k</p>
          <p className="text-[11px] text-slate-500 mt-0.5 uppercase font-semibold">Volume lbs</p>
        </div>
        <div className="bg-white/5 rounded-2xl p-3 text-center">
          <p className="text-[22px] font-bold text-white">{sessionPRs.length}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 uppercase font-semibold">New PRs</p>
        </div>
        <div className="bg-white/5 rounded-2xl p-3 text-center">
          <p className="text-[22px] font-bold text-white">{duration}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 uppercase font-semibold">Duration</p>
        </div>
      </div>

      {sessionPRs.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={16} className="text-amber-400" />
            <p className="text-amber-400 font-bold text-[13px]">Personal Records This Session</p>
          </div>
          {sessionPRs.map((pr, i) => (
            <p key={i} className="text-[13px] text-slate-300 py-0.5">
              🏆 {pr.exercise} — {pr.weight} lbs × {pr.reps}
            </p>
          ))}
        </div>
      )}

      <button onClick={onConfirm} className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold text-[17px] py-4 rounded-2xl transition-colors mb-3">
        Save Workout
      </button>
      <button onClick={onCancel} className="w-full text-slate-400 font-semibold text-[15px] py-2 transition-colors hover:text-white">
        Keep Going
      </button>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const ActiveSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const workoutData = workoutHistory[id] || workoutHistory['cw1'];
  const { routineName, exercises } = workoutData;

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isResting, setIsResting] = useState(false);
  const [restTimer, setRestTimer] = useState(90);
  const [currentRestDuration, setCurrentRestDuration] = useState(90);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [activePRBanner, setActivePRBanner] = useState(null);
  const [sessionPRs, setSessionPRs] = useState([]);
  const livePRs = useRef({ ...personalRecords });

  const [loggedSets, setLoggedSets] = useState(
    exercises.reduce((acc, ex) => {
      acc[ex.id] = Array.from({ length: ex.targetSets }).map((_, i) => ({
        weight: ex.history[i]?.weight ?? '',
        reps: ex.history[i]?.reps ?? '',
        completed: false,
        isPR: false,
      }));
      return acc;
    }, {})
  );

  useEffect(() => {
    const interval = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isResting) return;
    if (restTimer <= 0) { setIsResting(false); return; }
    const interval = setInterval(() => setRestTimer(prev => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [isResting, restTimer]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const totalVolume = Object.entries(loggedSets).reduce((sum, [, sets]) =>
    sum + sets.filter(s => s.completed).reduce((s2, set) =>
      s2 + (parseFloat(set.weight) || 0) * (parseInt(set.reps, 10) || 0), 0)
  , 0);

  const completedSets = Object.values(loggedSets).flat().filter(s => s.completed).length;
  const totalSets = Object.values(loggedSets).flat().length;

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
          livePRs.current = {
            ...livePRs.current,
            [exerciseId]: { ...newPR, date: new Date().toISOString().split('T')[0], label: exerciseName }
          };
          const prEntry = { exercise: exerciseName, ...newPR };
          setSessionPRs(s => [...s.filter(p => p.exercise !== exerciseName), prEntry]);
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
      return updated;
    });
  };

  const handleAddSet = (exerciseId) => {
    setLoggedSets(prev => ({
      ...prev,
      [exerciseId]: [...prev[exerciseId], { weight: '', reps: '', completed: false, isPR: false }]
    }));
  };

  return (
    <div className="fixed inset-0 bg-[#0A0D14] z-[100] overflow-y-auto pb-36 animate-fade-in font-sans">
      <div className="fixed top-0 inset-x-0 h-64 bg-gradient-to-b from-blue-900/20 to-transparent pointer-events-none" />

      {activePRBanner && (
        <PRBanner
          exercise={activePRBanner.exercise}
          weight={activePRBanner.weight}
          reps={activePRBanner.reps}
          onDismiss={() => setActivePRBanner(null)}
        />
      )}

      {showFinishModal && (
        <FinishModal
          workout={routineName}
          sessionPRs={sessionPRs}
          totalVolume={totalVolume}
          duration={formatTime(elapsedTime)}
          onConfirm={() => navigate('/')}
          onCancel={() => setShowFinishModal(false)}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-4 border-b border-white/5 flex justify-between items-center bg-[#0A0D14]/80 backdrop-blur-2xl">
        <button onClick={() => navigate(-1)} className="text-blue-500 hover:text-blue-400 transition-colors p-1 -ml-1 flex items-center">
          <ChevronLeft size={28} strokeWidth={2.5} />
          <span className="text-[17px] font-semibold -ml-1">List</span>
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <h1 className="font-semibold text-[17px] text-white tracking-tight leading-none">{routineName}</h1>
          <p className="text-blue-500 font-medium text-[13px] flex items-center justify-center gap-1 mt-0.5">
            <Timer size={12} strokeWidth={2.5} /> {formatTime(elapsedTime)}
          </p>
        </div>
        <button
          onClick={() => setShowFinishModal(true)}
          className="bg-blue-500 hover:bg-blue-400 text-white font-semibold text-[15px] px-4 py-1.5 rounded-full transition-colors"
        >
          Finish
        </button>
      </header>

      {/* Progress bar */}
      <div className="h-0.5 bg-white/5">
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%' }}
        />
      </div>

      {/* Quick stats */}
      <div className="flex items-center justify-center gap-6 py-3 text-[13px] text-slate-400 border-b border-white/5">
        <span className="flex items-center gap-1.5">
          <Zap size={13} className="text-blue-400" />
          {completedSets}/{totalSets} sets
        </span>
        <span>·</span>
        <span>{(totalVolume / 1000).toFixed(1)}k lbs</span>
        {sessionPRs.length > 0 && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1 text-amber-400 font-semibold">
              <Trophy size={12} /> {sessionPRs.length} PR{sessionPRs.length > 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* Floating rest timer */}
      {isResting && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/10 text-white px-6 py-3.5 rounded-full flex items-center gap-4 shadow-2xl z-50">
          <div className="relative w-8 h-8">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
              <circle
                cx="16" cy="16" r="13" fill="none"
                stroke="#3b82f6" strokeWidth="2.5"
                strokeDasharray={`${2 * Math.PI * 13}`}
                strokeDashoffset={`${2 * Math.PI * 13 * (1 - restTimer / currentRestDuration)}`}
                strokeLinecap="round"
                className="transition-all duration-1000"
              />
            </svg>
            <Timer size={14} className="absolute inset-0 m-auto text-blue-400" />
          </div>
          <div className="font-semibold text-[22px] tabular-nums tracking-tight">{formatTime(restTimer)}</div>
          <button
            onClick={() => setIsResting(false)}
            className="text-slate-400 text-[14px] font-medium hover:text-white transition-colors bg-white/5 px-3 py-1 rounded-full"
          >
            Skip
          </button>
        </div>
      )}

      {/* Exercise list */}
      <div className="container max-w-2xl mx-auto px-4 mt-6 flex flex-col gap-6">
        {exercises.map((exercise, exIndex) => {
          const sets = loggedSets[exercise.id] || [];
          const hasPR = sets.some(s => s.isPR);

          return (
            <div key={exercise.id} className="bg-[#131929] backdrop-blur-md rounded-3xl overflow-hidden border border-white/5 shadow-lg">
              <div className="px-5 pt-5 pb-3 flex justify-between items-start">
                <div>
                  <h2 className="font-semibold text-[20px] text-white tracking-tight leading-tight mb-1 flex items-center gap-2">
                    <span className="text-blue-500 opacity-70 text-[16px]">{exIndex + 1}.</span>
                    {exercise.name}
                    {hasPR && <Trophy size={16} className="text-amber-400" />}
                  </h2>
                  <p className="text-[13px] text-slate-400 flex items-center gap-1.5">
                    <Info size={13} className="opacity-70" />
                    Target: {exercise.targetReps} reps
                    {personalRecords[exercise.id] && (
                      <span className="ml-1 text-amber-500/70">
                        · PR: {personalRecords[exercise.id].weight} × {personalRecords[exercise.id].reps}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-5 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-black/10">
                <div className="w-8 text-center">Set</div>
                <div className="flex-1 min-w-[60px]">Previous</div>
                <div className="w-16 sm:w-20 text-center">lbs</div>
                <div className="w-16 sm:w-20 text-center">Reps</div>
                <div className="w-10 text-center flex justify-center"><CheckCircle size={14} strokeWidth={2.5} /></div>
              </div>

              <div className="flex flex-col bg-black/10 px-3 pb-3">
                {sets.map((set, setIndex) => {
                  const prev = exercise.history[setIndex];
                  const prPending = !set.completed && isPR(exercise.id, set.weight, set.reps, livePRs.current);

                  return (
                    <div
                      key={setIndex}
                      className={`flex items-center gap-2 px-2 py-2 mb-1.5 rounded-2xl transition-all duration-300 ${
                        set.isPR
                          ? 'bg-amber-500/10 border border-amber-500/25'
                          : set.completed
                          ? 'bg-emerald-500/10 border border-emerald-500/20'
                          : 'bg-white/[0.03] border border-white/5 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="w-8 text-center font-bold text-slate-400 text-[15px]">
                        {set.isPR ? <Trophy size={14} className="text-amber-400 mx-auto" /> : setIndex + 1}
                      </div>

                      <div className="flex-1 min-w-[60px] text-[13px] font-medium text-slate-400 truncate">
                        {prev ? <>{prev.weight} <span className="opacity-50 text-[11px] mx-0.5">×</span> {prev.reps}</> : '—'}
                      </div>

                      <div className="w-16 sm:w-20">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={set.weight}
                          onChange={e => handleUpdateSet(exercise.id, setIndex, 'weight', e.target.value)}
                          placeholder="—"
                          disabled={set.completed}
                          className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${
                            set.isPR ? 'text-amber-400 bg-transparent'
                            : set.completed ? 'text-emerald-400 bg-transparent'
                            : 'bg-[#2C2C2E] text-white focus:bg-[#3A3A3C]'
                          }`}
                        />
                      </div>
                      <div className="w-16 sm:w-20">
                        <input
                          type="number"
                          inputMode="numeric"
                          value={set.reps}
                          onChange={e => handleUpdateSet(exercise.id, setIndex, 'reps', e.target.value)}
                          placeholder="—"
                          disabled={set.completed}
                          className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${
                            set.isPR ? 'text-amber-400 bg-transparent'
                            : set.completed ? 'text-emerald-400 bg-transparent'
                            : 'bg-[#2C2C2E] text-white focus:bg-[#3A3A3C]'
                          }`}
                        />
                      </div>

                      <div className="w-10 flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => handleToggleComplete(exercise.id, setIndex, exercise.name, exercise.restSeconds)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                            set.isPR
                              ? 'bg-amber-500 text-white scale-110 shadow-[0_4px_12px_rgba(245,158,11,0.4)]'
                              : set.completed
                              ? 'bg-emerald-500 text-white scale-110 shadow-[0_4px_12px_rgba(16,185,129,0.3)]'
                              : prPending
                              ? 'bg-amber-500/20 border-2 border-amber-500/60 text-amber-400'
                              : 'bg-[#2C2C2E] text-slate-400 border border-white/10 hover:bg-[#3A3A3C]'
                          }`}
                        >
                          {set.completed
                            ? <CheckCircle size={18} strokeWidth={3} />
                            : <div className="w-3.5 h-3.5 rounded-sm border-2 border-slate-500/50" />
                          }
                        </button>
                        {prPending && (
                          <span className="text-[9px] text-amber-400 font-bold uppercase tracking-wide leading-none">PR!</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                <button
                  onClick={() => handleAddSet(exercise.id)}
                  className="mt-1 py-2.5 mx-2 text-[13px] font-semibold text-blue-500 bg-blue-500/10 rounded-xl hover:bg-blue-500/20 transition-colors flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Add Set
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActiveSession;
