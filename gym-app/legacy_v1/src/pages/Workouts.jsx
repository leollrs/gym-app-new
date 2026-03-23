import React, { useState } from 'react';
import { WORKOUT_TEMPLATES } from '../mockDb';
import { Play } from 'lucide-react';

export default function Workouts() {
    const [templates, setTemplates] = useState(WORKOUT_TEMPLATES);

    return (
        <div className="flex-col" style={{ gap: '24px' }}>

            <div style={{ marginTop: '10px' }}>
                <h1 className="outfit-font" style={{ fontSize: '2rem', marginBottom: '8px' }}>
                    Your <span className="text-gradient">Workouts</span>
                </h1>
                <p className="text-secondary" style={{ fontSize: '0.95rem' }}>
                    Select a template or create a new routine.
                </p>
            </div>

            <div className="flex-col" style={{ gap: '16px' }}>
                {templates.map(tpl => (
                    <div key={tpl.id} className="card glass-panel flex-col" style={{ gap: '12px' }}>
                        <div>
                            <h3 style={{ fontSize: '1.25rem' }}>{tpl.name}</h3>
                            <p className="text-secondary" style={{ fontSize: '0.9rem' }}>{tpl.description}</p>
                        </div>
                        <div className="flex-between">
                            <span className="text-tertiary" style={{ fontSize: '0.85rem' }}>
                                {tpl.exercises.length} Exercises
                            </span>
                            <button className="btn-icon" style={{ borderRadius: 'var(--radius-sm)', width: 'auto', padding: '0 16px', background: 'var(--primary)', color: '#000', border: 'none' }}>
                                <Play size={16} fill="currentColor" />
                                <span style={{ marginLeft: '6px', fontSize: '0.9rem' }}>Start</span>
                            </button>
                        </div>
                    </div>
                ))}

                <button className="card flex-center" style={{ borderStyle: 'dashed', borderColor: 'var(--text-tertiary)', background: 'transparent', padding: '24px' }}>
                    <span className="text-primary-color" style={{ fontWeight: 600 }}>+ Create New Template</span>
                </button>
            </div>

        </div>
    );
}
