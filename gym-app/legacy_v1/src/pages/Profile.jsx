import React from 'react';
import { LogOut, Settings, Award } from 'lucide-react';

export default function Profile({ user, onLogout }) {
    return (
        <div className="flex-col" style={{ gap: '24px' }}>

            <div className="flex-col flex-center" style={{ marginTop: '20px', gap: '16px' }}>
                <div style={{
                    width: '100px', height: '100px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '2.5rem', fontWeight: 700, color: '#000',
                    boxShadow: '0 8px 32px var(--primary-glow)'
                }}>
                    {user.displayName[0].toUpperCase()}
                </div>

                <div className="flex-col flex-center" style={{ gap: '4px' }}>
                    <h1 className="outfit-font" style={{ fontSize: '1.8rem' }}>{user.displayName}</h1>
                    <span className="text-tertiary" style={{ fontSize: '0.9rem' }}>@{user.username}</span>
                </div>
            </div>

            <div className="card glass-panel flex-col" style={{ gap: '12px' }}>
                <div className="flex-between">
                    <span className="text-secondary" style={{ fontSize: '0.9rem' }}>Current Goal</span>
                    <button className="text-primary-color" style={{ fontSize: '0.8rem' }}>Edit</button>
                </div>
                <p style={{ fontWeight: 500 }}>{user.goals}</p>
            </div>

            <div className="flex-col" style={{ gap: '8px' }}>
                <button className="card flex-between" style={{ padding: '16px 20px' }}>
                    <div className="flex-center" style={{ gap: '12px' }}>
                        <Award size={20} className="text-primary-color" />
                        <span style={{ fontWeight: 500 }}>Personal Records</span>
                    </div>
                </button>

                <button className="card flex-between" style={{ padding: '16px 20px' }}>
                    <div className="flex-center" style={{ gap: '12px' }}>
                        <Settings size={20} className="text-secondary" />
                        <span style={{ fontWeight: 500 }}>Settings</span>
                    </div>
                </button>

                <button onClick={onLogout} className="card flex-between" style={{ padding: '16px 20px', borderColor: 'rgba(255, 59, 48, 0.2)' }}>
                    <div className="flex-center" style={{ gap: '12px' }}>
                        <LogOut size={20} className="text-danger" />
                        <span style={{ fontWeight: 500, color: 'var(--danger)' }}>Logout</span>
                    </div>
                </button>
            </div>

        </div>
    );
}
