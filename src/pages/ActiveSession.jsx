import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Play, Square, Timer, CheckCircle, Info } from 'lucide-react';

// Mock data for an active session
const mockWorkoutPlan = {
    id: 'cw1',
    name: 'Push Day (Hypertrophy)',
    exercises: [
        {
            id: 'e1',
            name: 'Barbell Bench Press',
            targetSets: 3,
            targetReps: '8-10',
            history: [{ weight: 185, reps: 10 }, { weight: 185, reps: 9 }, { weight: 185, reps: 8 }]
        },
        {
            id: 'e2',
            name: 'Incline Dumbbell Press',
            targetSets: 3,
            targetReps: '10-12',
            history: [{ weight: 70, reps: 12 }, { weight: 70, reps: 10 }, { weight: 70, reps: 9 }]
        },
        {
            id: 'e3',
            name: 'Cable Tricep Pushdown',
            targetSets: 4,
            targetReps: '12-15',
            history: [{ weight: 50, reps: 15 }, { weight: 55, reps: 12 }, { weight: 55, reps: 10 }, { weight: 55, reps: 10 }]
        }
    ]
};

const ActiveSession = () => {
    const navigate = useNavigate();
    const [elapsedTime, setElapsedTime] = useState(0);
    const [isResting, setIsResting] = useState(false);
    const [restTimer, setRestTimer] = useState(90); // Default 90s rest

    // Track logged sets [exerciseId]: [{ weight, reps, completed }]
    const [loggedSets, setLoggedSets] = useState(
        mockWorkoutPlan.exercises.reduce((acc, ex) => {
            acc[ex.id] = Array.from({ length: ex.targetSets }).map((_, i) => ({
                weight: ex.history[i]?.weight || '',
                reps: ex.history[i]?.reps || '',
                completed: false
            }));
            return acc;
        }, {})
    );

    // Global Session Timer
    useEffect(() => {
        const interval = setInterval(() => {
            setElapsedTime(prev => prev + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Rest Timer
    useEffect(() => {
        let interval;
        if (isResting && restTimer > 0) {
            interval = setInterval(() => {
                setRestTimer(prev => prev - 1);
            }, 1000);
        } else if (restTimer === 0) {
            setIsResting(false);
        }
        return () => clearInterval(interval);
    }, [isResting, restTimer]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleUpdateSet = (exerciseId, setIndex, field, value) => {
        setLoggedSets(prev => {
            const updated = { ...prev };
            updated[exerciseId][setIndex] = {
                ...updated[exerciseId][setIndex],
                [field]: value
            };
            return updated;
        });
    };

    const handleToggleComplete = (exerciseId, setIndex) => {
        setLoggedSets(prev => {
            const updated = { ...prev };
            const set = updated[exerciseId][setIndex];
            const isCompleting = !set.completed;

            updated[exerciseId][setIndex] = {
                ...set,
                completed: isCompleting
            };

            // Trigger Rest Timer automatically when a set is completed
            if (isCompleting) {
                setIsResting(true);
                setRestTimer(90); // Reset to 90s
            }

            return updated;
        });
    };

    const finishWorkout = () => {
        // In a real app we'd save this to the DB.
        navigate('/');
    };

    return (
        <div className="fixed inset-0 bg-[#0A0D14] z-[100] overflow-y-auto pb-32 animate-fade-in font-sans">

            {/* Ambient Background Glow */}
            <div className="fixed top-0 inset-x-0 h-64 bg-gradient-to-b from-blue-900/20 to-transparent pointer-events-none" />

            {/* Sticky iOS-style Header */}
            <header className="sticky top-0 z-10 px-4 py-4 border-b border-white/5 flex justify-between items-center bg-[#0A0D14]/80 backdrop-blur-2xl supports-[backdrop-filter]:bg-[#0A0D14]/60">
                <div className="flex items-center gap-2">
                    <button onClick={() => navigate(-1)} className="text-blue-500 hover:text-blue-400 transition-colors p-1 -ml-1 flex items-center">
                        <ChevronLeft size={28} strokeWidth={2.5} />
                        <span className="text-[17px] font-semibold -ml-1">List</span>
                    </button>
                </div>

                <div className="absolute left-1/2 -translate-x-1/2 text-center flex flex-col items-center">
                    <h1 className="font-semibold text-[17px] text-white tracking-tight">{mockWorkoutPlan.name}</h1>
                    <p className="text-blue-500 font-medium text-[13px] flex items-center gap-1 mt-0.5">
                        <Timer size={12} strokeWidth={2.5} /> {formatTime(elapsedTime)}
                    </p>
                </div>

                <button onClick={finishWorkout} className="bg-blue-500 text-white font-semibold text-[15px] px-4 py-1.5 rounded-full hover:bg-blue-400 transition-colors">
                    Finish
                </button>
            </header>

            {/* Floating Rest Timer Overlay */}
            {isResting && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-[#1C1C1E]/90 backdrop-blur-xl border border-white/10 text-white px-6 py-3.5 rounded-full flex items-center gap-4 shadow-2xl z-50 animate-bounce">
                    <Timer size={22} className="text-blue-500" strokeWidth={2} />
                    <div className="font-semibold text-[22px] tabular-nums tracking-tight">{formatTime(restTimer)}</div>
                    <button onClick={() => setIsResting(false)} className="text-slate-400 text-[15px] ml-2 font-medium hover:text-white transition-colors bg-white/5 px-3 py-1 rounded-full">
                        Skip
                    </button>
                </div>
            )}

            {/* Exercises List */}
            <div className="container max-w-2xl mx-auto px-4 mt-6 flex flex-col gap-6 relative z-0">
                {mockWorkoutPlan.exercises.map((exercise, exIndex) => (
                    <div key={exercise.id} className="bg-[#1C1C1E]/60 backdrop-blur-md rounded-3xl overflow-hidden border border-white/5 shadow-lg">

                        {/* Exercise Header */}
                        <div className="px-5 pt-5 pb-3 flex justify-between items-start">
                            <div>
                                <h2 className="font-semibold text-[20px] text-white tracking-tight leading-tight mb-1">
                                    <span className="text-blue-500 mr-2 opacity-80">{exIndex + 1}.</span>
                                    {exercise.name}
                                </h2>
                                <p className="text-[13px] text-slate-400 font-medium flex items-center gap-1.5">
                                    <Info size={14} className="opacity-70" /> Target: {exercise.targetReps} reps
                                </p>
                            </div>
                        </div>

                        {/* Set Headers */}
                        <div className="flex items-center gap-2 px-5 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-black/10">
                            <div className="w-8 text-center">Set</div>
                            <div className="flex-1 min-w-[60px]">Previous</div>
                            <div className="w-16 sm:w-20 text-center">lbs</div>
                            <div className="w-16 sm:w-20 text-center">Reps</div>
                            <div className="w-10 text-center flex justify-center"><CheckCircle size={14} strokeWidth={2.5} /></div>
                        </div>

                        {/* Sets Logging Rows */}
                        <div className="flex flex-col bg-black/10 px-3 pb-3">
                            {loggedSets[exercise.id].map((set, setIndex) => {
                                const isCompleted = set.completed;
                                const prevStats = exercise.history[setIndex];

                                return (
                                    <div
                                        key={setIndex}
                                        className={`flex items-center gap-2 px-2 py-2 mb-1.5 rounded-2xl transition-all duration-300 ${isCompleted ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-white/[0.03] border border-white/5 hover:bg-white/[0.06]'}`}
                                    >
                                        <div className="w-8 text-center font-bold text-slate-400 text-[15px]">{setIndex + 1}</div>

                                        {/* Previous Context */}
                                        <div className="flex-1 min-w-[60px] text-[13px] font-medium text-slate-400 truncate mt-0.5">
                                            {prevStats ? <>{prevStats.weight} <span className="opacity-50 text-[11px] mx-0.5">x</span> {prevStats.reps}</> : '-'}
                                        </div>

                                        {/* Inputs - iOS grouped style */}
                                        <div className="w-16 sm:w-20">
                                            <input
                                                type="number"
                                                value={set.weight}
                                                onChange={(e) => handleUpdateSet(exercise.id, setIndex, 'weight', e.target.value)}
                                                placeholder="-"
                                                className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${isCompleted ? 'text-emerald-400 bg-transparent' : 'bg-[#2C2C2E] text-white focus:bg-[#3A3A3C]'}`}
                                                disabled={isCompleted}
                                            />
                                        </div>
                                        <div className="w-16 sm:w-20">
                                            <input
                                                type="number"
                                                value={set.reps}
                                                onChange={(e) => handleUpdateSet(exercise.id, setIndex, 'reps', e.target.value)}
                                                placeholder="-"
                                                className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${isCompleted ? 'text-emerald-400 bg-transparent' : 'bg-[#2C2C2E] text-white focus:bg-[#3A3A3C]'}`}
                                                disabled={isCompleted}
                                            />
                                        </div>

                                        {/* Checkbox Toggle */}
                                        <div className="w-10 flex justify-center ml-1">
                                            <button
                                                onClick={() => handleToggleComplete(exercise.id, setIndex)}
                                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${isCompleted ? 'bg-emerald-500 text-white scale-110 shadow-[0_4px_12px_rgba(16,185,129,0.3)]' : 'bg-[#2C2C2E] text-slate-400 border border-white/10 hover:bg-[#3A3A3C]'}`}
                                            >
                                                {isCompleted ? <CheckCircle size={18} strokeWidth={3} /> : <div className="w-3.5 h-3.5 rounded-sm border-2 border-slate-500/50" />}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Add Set Button */}
                            <button
                                onClick={() => {
                                    setLoggedSets(prev => ({
                                        ...prev,
                                        [exercise.id]: [...prev[exercise.id], { weight: '', reps: '', completed: false }]
                                    }));
                                }}
                                className="mt-1 py-2.5 mx-2 text-[13px] font-semibold text-blue-500 bg-blue-500/10 rounded-xl hover:bg-blue-500/20 transition-colors"
                            >
                                + Add Set
                            </button>
                        </div>
                    </div>
                ))}
            </div>

        </div>
    );
};

export default ActiveSession;
