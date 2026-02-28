import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
    currentUser,
    announcements,
    upcomingWorkouts,
    progressData
} from '../mockDb';
import {
    Trophy,
    Flame,
    TrendingUp,
    Calendar,
    ChevronRight,
    Bell,
    Play
} from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell
} from 'recharts';

const StatCard = ({ icon: Icon, label, value, color }) => (
    <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
        <div style={{
            backgroundColor: `rgba(var(--${color}-rgb, 59, 130, 246), 0.1)`,
            color: `var(--${color}, var(--accent-primary))`,
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)'
        }}>
            <Icon size={24} />
        </div>
        <div>
            <p className="text-small text-muted font-medium">{label}</p>
            <p className="text-large font-bold">{value}</p>
        </div>
    </div>
);

const Dashboard = () => {
    // Local state for interactive mockup testing
    const [workoutsDone, setWorkoutsDone] = useState(currentUser.stats.workoutsCompleted);
    const [volume, setVolume] = useState(currentUser.stats.totalVolumeLbs);
    const [hasCompletedToday, setHasCompletedToday] = useState(false);

    // Copy progress data so we can mutate it
    const [chartData, setChartData] = useState([...progressData]);

    const handleCompleteWorkout = () => {
        if (hasCompletedToday) return; // Prevent double clicking

        // Simulate completing "Heavy Lower Body" (approx 8500 lbs volume)
        const workoutVolume = 8500;

        setWorkoutsDone(prev => prev + 1);
        setVolume(prev => prev + workoutVolume);
        setHasCompletedToday(true);

        // Add fake volume to "Today" (Assuming today is index 0 for mockup sake or just updating a day)
        // Let's just update Wednesday which was 0
        setChartData(prev => {
            const newData = [...prev];
            newData[2] = { day: 'Wed', volume: workoutVolume };
            return newData;
        });
    };

    return (
        <div className="container main-content animate-fade-in pb-24 md:pb-8">
            {/* Header Section */}
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <img
                        src={currentUser.avatarUrl}
                        alt="Profile"
                        style={{ width: '56px', height: '56px', borderRadius: '50%', border: '2px solid var(--accent-primary)' }}
                    />
                    <div>
                        <h1 className="text-h3 font-bold">Hey, {currentUser.username}</h1>
                        <p className="text-small text-muted">{currentUser.homeGym} • Level {currentUser.stats.level}</p>
                    </div>
                </div>
                <button className="glass" style={{ padding: '0.5rem', borderRadius: '50%', color: 'var(--text-primary)' }}>
                    <Bell size={20} />
                </button>
            </header>

            {/* Quick Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <StatCard icon={Flame} label="Day Streak" value={currentUser.stats.currentStreak} color="warning" />
                <StatCard icon={Trophy} label="Workouts" value={workoutsDone} color="success" />
                <StatCard icon={TrendingUp} label="Volume (lbs)" value={(volume / 1000).toFixed(1) + 'k'} color="accent-primary" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', '@media (min-width: 768px)': { gridTemplateColumns: '2fr 1fr' } }}>

                {/* Left Column (Main Content) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    {/* Active Routine / Next Workout */}
                    <section>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h2 className="text-large font-bold">Up Next</h2>
                            <a href="/workouts" className="text-small text-accent" style={{ display: 'flex', alignItems: 'center' }}>
                                View Plan <ChevronRight size={16} />
                            </a>
                        </div>

                        <div className="glass-card" style={{ position: 'relative', overflow: 'hidden', padding: '1.5rem' }}>
                            <div style={{
                                position: 'absolute', top: 0, right: 0, bottom: 0, left: '50%',
                                background: 'radial-gradient(circle at top right, rgba(59, 130, 246, 0.15), transparent 70%)',
                                pointerEvents: 'none'
                            }} />

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <span style={{
                                            background: hasCompletedToday ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                                            color: hasCompletedToday ? 'var(--success)' : 'var(--accent-secondary)',
                                            padding: '0.2rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600
                                        }}>
                                            {hasCompletedToday ? 'Completed' : upcomingWorkouts[0].date}
                                        </span>
                                        {!hasCompletedToday && (
                                            <span className="text-small text-muted flex items-center gap-1">
                                                <Calendar size={14} /> {upcomingWorkouts[0].duration}
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="text-h2 font-bold mb-1" style={{ opacity: hasCompletedToday ? 0.5 : 1 }}>
                                        {upcomingWorkouts[0].name}
                                    </h3>
                                    <p className="text-muted text-small">{upcomingWorkouts[0].exercises} exercises • {upcomingWorkouts[0].type}</p>
                                </div>

                                <Link
                                    to={`/session/${upcomingWorkouts[0].id}`}
                                    className="btn-primary flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                                    style={{
                                        borderRadius: '50%', width: '3.5rem', height: '3.5rem', padding: 0,
                                        boxShadow: 'var(--shadow-glow)',
                                        background: 'linear-gradient(135deg, var(--accent-primary), #2563eb)'
                                    }}>
                                    <Play size={24} fill="currentColor" style={{ marginLeft: '4px' }} />
                                </Link>
                            </div>
                        </div>
                    </section>

                    {/* Volume Chart */}
                    <section>
                        <h2 className="text-large font-bold mb-4">Volume This Week</h2>
                        <div className="glass-card" style={{ height: '240px', padding: '1rem' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                                        contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}
                                    />
                                    <Bar dataKey="volume" radius={[4, 4, 0, 0]}>
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.volume > 0 ? 'var(--accent-primary)' : 'transparent'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </section>
                </div>

                {/* Right Column (Sidebar) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    {/* Gym Announcements */}
                    <section>
                        <h2 className="text-large font-bold mb-4">Gym News</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {announcements.map(ann => (
                                <div key={ann.id} className="glass" style={{ padding: '1rem', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${ann.type === 'event' ? 'var(--warning)' : 'var(--accent-primary)'}` }}>
                                    <h4 className="font-bold text-regular mb-1">{ann.title}</h4>
                                    <p className="text-small text-muted line-clamp-2">{ann.message}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
