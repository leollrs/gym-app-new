import React, { useMemo, useState } from 'react';
import { USERS, WORKOUT_LOGS } from '../mockDb';
import { UserPlus, Copy } from 'lucide-react';

export default function SocialFeed({ currentUser }) {
    const [friendInput, setFriendInput] = useState('');

    // Get friends' recent workout logs
    const feed = useMemo(() => {
        const friendIds = currentUser.friends || [];
        return WORKOUT_LOGS
            .filter(log => friendIds.includes(log.userId))
            .map(log => ({ ...log, user: USERS[log.userId] }))
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [currentUser.friends]);

    const handleAddFriend = (e) => {
        e.preventDefault();
        if (friendInput) {
            alert(`Mock: Added ${friendInput} as friend!`);
            setFriendInput('');
        }
    };

    return (
        <div className="flex-col" style={{ gap: '24px' }}>

            <div style={{ marginTop: '10px' }}>
                <h1 className="outfit-font" style={{ fontSize: '2rem', marginBottom: '8px' }}>
                    Community <span className="text-gradient">Feed</span>
                </h1>
                <p className="text-secondary" style={{ fontSize: '0.95rem' }}>
                    See what your friends are lifting.
                </p>
            </div>

            {/* Add Friend */}
            <form onSubmit={handleAddFriend} className="flex-center" style={{ gap: '8px' }}>
                <input
                    type="text"
                    placeholder="Add by username or link..."
                    value={friendInput}
                    onChange={(e) => setFriendInput(e.target.value)}
                    style={{ flex: 1, padding: '12px 16px', borderRadius: 'var(--radius-round)' }}
                />
                <button type="submit" className="btn-icon" style={{ background: 'var(--primary)', color: '#000', border: 'none' }}>
                    <UserPlus size={20} />
                </button>
            </form>

            {/* Feed */}
            <div className="flex-col" style={{ gap: '16px' }}>
                {feed.length === 0 ? (
                    <p className="text-tertiary" style={{ textAlign: 'center', marginTop: '20px' }}>
                        No recent friend activity. Go add some friends!
                    </p>
                ) : (
                    feed.map(log => (
                        <div key={log.id} className="card glass-panel flex-col" style={{ gap: '16px' }}>
                            <div className="flex-between">
                                <div className="flex-center" style={{ gap: '10px' }}>
                                    <div className="btn-icon" style={{ width: '36px', height: '36px', background: 'var(--bg-surface-elevated)' }}>
                                        {log.user.displayName[0]}
                                    </div>
                                    <div className="flex-col">
                                        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{log.user.displayName}</span>
                                        <span className="text-tertiary" style={{ fontSize: '0.75rem' }}>
                                            {new Date(log.date).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <p style={{ fontSize: '1.05rem', fontWeight: 500, marginBottom: '8px' }}>
                                    Crushed <span className="text-primary-color">{log.workoutName}</span>
                                </p>
                                <div className="flex-center" style={{ background: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: 'var(--radius-sm)', gap: '12px' }}>
                                    <span className="text-secondary" style={{ fontSize: '0.85rem' }}>
                                        {log.exercises.length} Exercises
                                    </span>
                                    <span className="text-tertiary">|</span>
                                    <span className="text-secondary" style={{ fontSize: '0.85rem' }}>
                                        {log.exercises.reduce((sum, e) => sum + e.sets.length, 0)} Sets Total
                                    </span>
                                </div>
                            </div>

                            <button className="btn-secondary flex-center" style={{ padding: '8px', gap: '6px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)' }}>
                                <Copy size={16} />
                                Try this Workout
                            </button>
                        </div>
                    ))
                )}
            </div>

        </div>
    );
}
