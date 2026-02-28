import React from 'react';
import { currentUser } from '../mockDb';
import { Settings, Award, CalendarDays, Activity, Grid } from 'lucide-react';

const mockAchievements = [
    { id: 'ach1', title: 'First Steps', description: 'Log your first workout', date: '2023-11-16', icon: '🏃‍♂️', unlocked: true },
    { id: 'ach2', title: 'Consistency King', description: 'Hit the gym 4 times in a week', date: '2024-01-10', icon: '👑', unlocked: true },
    { id: 'ach3', title: 'Century Club', description: 'Log 100 workouts', date: '2025-05-22', icon: '💯', unlocked: true },
    { id: 'ach4', title: '1-Ton Total Volume', description: 'Lift 2000 lbs in a single workout', date: '2025-08-14', icon: '🦍', unlocked: true },
    { id: 'ach5', title: 'Early Bird', description: 'Workout before 6 AM 5 times', date: null, icon: '🌅', unlocked: false },
    { id: 'ach6', title: 'Squat Master', description: 'Log a squat session 10 times in a month', date: null, icon: '🦵', unlocked: false }
];

const Profile = () => {
    return (
        <div className="container main-content animate-fade-in pb-24 md:pb-8">

            {/* Header / Top Section */}
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                <h1 className="text-h2 font-bold focus:outline-none">Profile</h1>
                <button className="glass" style={{ padding: '0.5rem', borderRadius: '50%', color: 'var(--text-primary)' }}>
                    <Settings size={20} />
                </button>
            </header>

            {/* User Info Card */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '2rem', padding: '2rem 1.5rem' }}>
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <img
                        src={currentUser.avatarUrl}
                        alt={currentUser.username}
                        style={{ width: '96px', height: '96px', borderRadius: '50%', border: '4px solid var(--accent-primary)', padding: '2px' }}
                    />
                    <div style={{
                        position: 'absolute',
                        bottom: '-4px',
                        right: '-4px',
                        background: 'var(--accent-primary)',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '1rem',
                        border: '2px solid var(--bg-secondary)',
                        boxShadow: 'var(--shadow-sm)'
                    }}>
                        Lvl {currentUser.stats.level}
                    </div>
                </div>

                <h2 className="text-h3 font-bold">{currentUser.fullName}</h2>
                <p className="text-muted text-regular mb-1">@{currentUser.username}</p>
                <p className="text-small text-accent font-medium mb-4 flex items-center gap-1">
                    <CalendarDays size={14} /> Joined {currentUser.joinDate.split('-')[0]}
                </p>

                {/* Global Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', width: '100%', marginTop: '1rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
                    <div>
                        <p className="text-large font-bold">{currentUser.stats.workoutsCompleted}</p>
                        <p className="text-small text-muted flex items-center justify-center gap-1 mt-1"><Activity size={12} /> Workouts</p>
                    </div>
                    <div>
                        <p className="text-large font-bold">4</p>
                        <p className="text-small text-muted flex items-center justify-center gap-1 mt-1"><Award size={12} /> PRs</p>
                    </div>
                    <div>
                        <p className="text-large font-bold">12</p>
                        <p className="text-small text-muted flex items-center justify-center gap-1 mt-1"><Grid size={12} /> Badges</p>
                    </div>
                </div>
            </div>

            {/* Achievements Section */}
            <section>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 className="text-large font-bold">Achievements Hub</h3>
                    <span className="text-small text-accent font-medium">4 / 6 Unlocked</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', '@media (min-width: 768px)': { gridTemplateColumns: 'repeat(2, 1fr)' } }}>
                    {mockAchievements.map(ach => (
                        <div key={ach.id} className="glass" style={{
                            display: 'flex',
                            gap: '1rem',
                            alignItems: 'center',
                            padding: '1.25rem',
                            borderRadius: 'var(--radius-md)',
                            opacity: ach.unlocked ? 1 : 0.5,
                            filter: ach.unlocked ? 'none' : 'grayscale(100%)',
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{
                                background: ach.unlocked ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-tertiary)',
                                width: '64px',
                                height: '64px',
                                minWidth: '64px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '2rem',
                                border: ach.unlocked ? '2px solid var(--accent-primary)' : '2px dashed var(--border-color)'
                            }}>
                                {ach.icon}
                            </div>
                            <div>
                                <h4 className="font-bold mb-0.5">{ach.title}</h4>
                                <p className="text-small text-muted">{ach.description}</p>
                                {ach.unlocked && <p className="text-small text-accent mt-1" style={{ fontSize: '0.7rem' }}>Unlocked • {ach.date}</p>}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

        </div>
    );
};

export default Profile;
