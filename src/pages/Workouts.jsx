import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Plus, Search, Dumbbell, Clock, ChevronRight } from 'lucide-react';

const mockCustomWorkouts = [
    { id: 'cw1', name: 'Push Day (Hypertrophy)', exercises: 7, lastPerformed: '2 days ago', isGymProgram: false },
    { id: 'cw2', name: 'Pull & Abs', exercises: 6, lastPerformed: '4 days ago', isGymProgram: false },
    { id: 'cw3', name: 'Leg Day Annihilation', exercises: 5, lastPerformed: '5 days ago', isGymProgram: false }
];

const mockGymPrograms = [
    { id: 'gp1', name: 'IronForge Powerbuilding - Phase 1', instructor: 'Coach Sarah', duration: '8 weeks', level: 'Intermediate' },
    { id: 'gp2', name: 'Summer Shred', instructor: 'Coach Mike', duration: '6 weeks', level: 'All Levels' }
];

const Workouts = () => {
    const [activeTab, setActiveTab] = useState('my-routines'); // 'my-routines' or 'gym-programs'
    const [routines, setRoutines] = useState([...mockCustomWorkouts]);
    const [isCreating, setIsCreating] = useState(false);
    const [newRoutineName, setNewRoutineName] = useState('');

    const handleCreateRoutine = (e) => {
        e.preventDefault();
        if (!newRoutineName.trim()) return;

        const newRoutine = {
            id: `cw${Date.now()}`,
            name: newRoutineName,
            exercises: 0,
            lastPerformed: 'Never',
            isGymProgram: false
        };

        setRoutines([newRoutine, ...routines]);
        setNewRoutineName('');
        setIsCreating(false);
    };

    return (
        <div className="container main-content animate-fade-in pb-24 md:pb-8">

            <header style={{ marginBottom: '2rem' }}>
                <h1 className="text-h2 font-bold mb-2">Workouts</h1>
                <p className="text-muted">Manage your routines or start a new program.</p>
            </header>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                <button
                    onClick={() => setActiveTab('my-routines')}
                    style={{
                        color: activeTab === 'my-routines' ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontWeight: activeTab === 'my-routines' ? 600 : 400,
                        borderBottom: activeTab === 'my-routines' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                        paddingBottom: '0.5rem',
                        marginBottom: '-1rem',
                        transition: 'all 0.2s ease'
                    }}
                >
                    My Routines
                </button>
                <button
                    onClick={() => setActiveTab('gym-programs')}
                    style={{
                        color: activeTab === 'gym-programs' ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontWeight: activeTab === 'gym-programs' ? 600 : 400,
                        borderBottom: activeTab === 'gym-programs' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                        paddingBottom: '0.5rem',
                        marginBottom: '-1rem',
                        transition: 'all 0.2s ease'
                    }}
                >
                    Gym Programs
                </button>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                <button
                    onClick={() => setIsCreating(true)}
                    className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '1.5rem 1rem' }}>
                    <div style={{ background: 'var(--accent-primary)', borderRadius: '50%', padding: '0.75rem', color: 'white' }}>
                        <Plus size={24} />
                    </div>
                    <span className="font-bold">Create Routine</span>
                </button>
                <button className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '1.5rem 1rem' }}>
                    <div style={{ background: 'var(--bg-tertiary)', borderRadius: '50%', padding: '0.75rem', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        <Search size={24} />
                    </div>
                    <span className="font-bold">Start Empty</span>
                </button>
            </div>

            {/* Creation Form Overlay */}
            {isCreating && (
                <div style={{ marginBottom: '2rem' }} className="glass-card animate-fade-in border-l-4 border-l-blue-500">
                    <h3 className="font-bold text-large mb-3">Name your routine</h3>
                    <form onSubmit={handleCreateRoutine} className="flex gap-2">
                        <input
                            type="text"
                            value={newRoutineName}
                            onChange={(e) => setNewRoutineName(e.target.value)}
                            placeholder="e.g. Upper Body Power"
                            autoFocus
                            className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                        />
                        <button type="button" onClick={() => setIsCreating(false)} className="btn-secondary px-4">Cancel</button>
                        <button type="submit" className="btn-primary px-6">Save</button>
                    </form>
                </div>
            )}

            {/* Content Area */}
            {activeTab === 'my-routines' ? (
                <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 className="text-large font-bold">Saved Routines</h2>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {routines.map(workout => (
                            <div key={workout.id} className="glass" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                                <div>
                                    <h3 className="font-bold mb-1">{workout.name}</h3>
                                    <div className="text-small text-muted flex items-center gap-3">
                                        <span className="flex items-center gap-1"><Dumbbell size={14} /> {workout.exercises} ex</span>
                                        <span className="flex items-center gap-1"><Clock size={14} /> {workout.lastPerformed}</span>
                                    </div>
                                </div>
                                <Link to={`/session/${workout.id}`} className="btn-primary flex items-center justify-center gap-2 transition-transform hover:scale-105 active:scale-95" style={{ padding: '0.5rem 1rem' }}>
                                    <Play size={16} fill="currentColor" /> Start
                                </Link>
                            </div>
                        ))}
                    </div>
                </section>
            ) : (
                <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 className="text-large font-bold">Featured Programs</h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', '@media (min-width: 768px)': { gridTemplateColumns: '1fr 1fr' } }}>
                        {mockGymPrograms.map(program => (
                            <div key={program.id} className="glass-card" style={{ padding: '0' }}>
                                <div style={{ height: '120px', background: 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))', borderTopLeftRadius: 'var(--radius-lg)', borderTopRightRadius: 'var(--radius-lg)', position: 'relative' }}>
                                    {/* Decorative background overlay */}
                                    <div style={{ position: 'absolute', inset: 0, opacity: 0.1, backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%239C92AC\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
                                </div>
                                <div style={{ padding: '1.5rem' }}>
                                    <span className="text-small text-accent font-bold uppercase tracking-wider">{program.level}</span>
                                    <h3 className="text-large font-bold mt-1 mb-2">{program.name}</h3>
                                    <div className="flex justify-between items-center text-small text-muted mb-4">
                                        <span>By {program.instructor}</span>
                                        <span className="flex items-center gap-1"><Clock size={14} /> {program.duration}</span>
                                    </div>
                                    <button className="w-full btn-secondary flex justify-center items-center gap-2">
                                        View Details <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};

export default Workouts;
