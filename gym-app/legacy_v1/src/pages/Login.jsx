import React, { useState } from 'react';
import { Dumbbell } from 'lucide-react';

export default function Login({ onLogin }) {
    const [username, setUsername] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (username.trim()) {
            onLogin(username.trim().toLowerCase());
        }
    };

    return (
        <div className="flex-col flex-center" style={{ minHeight: '80vh', gap: '32px' }}>

            <div className="flex-col flex-center" style={{ gap: '16px' }}>
                <div style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '24px',
                    borderRadius: '50%',
                    boxShadow: '0 0 40px var(--primary-glow)'
                }}>
                    <Dumbbell size={48} color="var(--primary)" />
                </div>
                <h1 className="text-gradient" style={{ fontSize: '3rem' }}>LIFTR</h1>
                <p className="text-secondary" style={{ textAlign: 'center', maxWidth: '80%' }}>
                    Progressive overload. Social workouts. Serious gains.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="glass-panel p-6 flex-col" style={{ width: '100%', padding: '32px 24px', gap: '20px' }}>
                <div className="flex-col" style={{ gap: '8px' }}>
                    <label className="text-secondary" style={{ fontSize: '0.9rem', fontWeight: 500 }}>Username</label>
                    <input
                        type="text"
                        placeholder="e.g. fitleo"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoFocus
                    />
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginTop: '12px' }}>
                    Enter Gym
                </button>
                <p className="text-tertiary" style={{ fontSize: '0.85rem', textAlign: 'center', marginTop: '12px' }}>
                    *Use "fitleo" for pre-populated mock data
                </p>
            </form>

        </div>
    );
}
