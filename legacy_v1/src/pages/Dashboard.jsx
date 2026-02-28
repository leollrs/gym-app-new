import React, { useMemo } from 'react';
import { Play, Plus, History } from 'lucide-react';
import { WORKOUT_LOGS, WORKOUT_TEMPLATES, suggestNextTargets, EXERCISES } from '../mockDb';
import { useNavigate } from 'react-router-dom';

export default function Dashboard({ user }) {
    const navigate = useNavigate();

    // Find user's last workout log
    const userLogs = useMemo(() => {
        return WORKOUT_LOGS.filter(log => log.userId === user.id)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [user.id]);

    const lastLog = userLogs[0];

    // Pick a suggested workout (mock: just grab their last one, or a default template)
    const suggestedWorkout = useMemo(() => {
        if (lastLog) {
            // Find the template
            const tpl = WORKOUT_TEMPLATES.find(t => t.name === lastLog.workoutName);
            if (tpl) return { ...tpl, reason: 'Based on your last session' };
        }
        return { ...WORKOUT_TEMPLATES[0], reason: 'Recommended split' };
    }, [lastLog]);

    return (
        <div className="flex-col" style={{ gap: '24px' }}>

            {/* Header section */}
            <div style={{ marginTop: '10px' }}>
                <h1 className="outfit-font" style={{ fontSize: '2rem', marginBottom: '8px' }}>
                    Ready to crush it, <span className="text-gradient">{user.displayName}</span>?
                </h1>
                <p className="text-secondary" style={{ fontSize: '0.95rem' }}>
                    Current Focus: {user.goals}
                </p>
            </div>

            {/* Suggested Workout Card */}
            <section className="flex-col" style={{ gap: '12px' }}>
                <div className="flex-between">
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Suggested Workout</h2>
                    <span className="text-primary-color" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                        {suggestedWorkout.reason}
                    </span>
                </div>

                <div className="card glass-panel flex-col" style={{ gap: '16px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{
                        position: 'absolute', top: '-50px', right: '-50px',
                        width: '150px', height: '150px',
                        background: 'var(--primary)', filter: 'blur(70px)', opacity: 0.15
                    }} />

                    <div>
                        <h3 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>{suggestedWorkout.name}</h3>
                        <p className="text-secondary" style={{ fontSize: '0.9rem' }}>{suggestedWorkout.description}</p>
                    </div>

                    {/* Show a mini-preview of exercises with progressive overload notes */}
                    <div className="flex-col" style={{ gap: '10px', marginTop: '8px' }}>
                        {suggestedWorkout.exercises.slice(0, 3).map((ex, i) => {
                            const exDef = EXERCISES.find(e => e.id === ex.exerciseId);
                            // Calculate target override
                            const targets = suggestNextTargets(ex.exerciseId, userLogs);

                            return (
                                <div key={i} className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bg-surface-border)' }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{exDef?.name}</span>
                                    <div className="flex-col" style={{ alignItems: 'flex-end', gap: '2px' }}>
                                        <span style={{ fontSize: '0.85rem' }}>
                                            {targets.suggestedReps} reps @ {targets.suggestedWeight} lbs
                                        </span>
                                        {targets.note && (
                                            <span className="text-primary-color" style={{ fontSize: '0.65rem', fontWeight: 600 }}>
                                                ↑ Overload Focus
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        className="btn btn-primary"
                        style={{ marginTop: '8px' }}
                        onClick={() => console.log('Start workout')}
                    >
                        <Play size={20} fill="currentColor" />
                        Start Workout
                    </button>
                </div>
            </section>

            {/* Quick Actions */}
            <section className="flex-col" style={{ gap: '12px' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Quick Actions</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <button className="card flex-col flex-center" style={{ gap: '12px', padding: '24px 16px' }}>
                        <div className="btn-icon" style={{ background: 'var(--bg-surface)' }}>
                            <Plus size={24} color="var(--primary)" />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Custom Workout</span>
                    </button>

                    <button className="card flex-col flex-center" style={{ gap: '12px', padding: '24px 16px' }}>
                        <div className="btn-icon" style={{ background: 'var(--bg-surface)' }}>
                            <History size={24} color="var(--secondary)" />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>History</span>
                    </button>
                </div>
            </section>

        </div>
    );
}
