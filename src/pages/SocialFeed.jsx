import React, { useState } from 'react';
import { recentActivity, currentUser } from '../mockDb';
import { Heart, MessageCircle, Share2, Plus } from 'lucide-react';

const SocialFeed = () => {
    // Local state for interactive mockup testing
    const [activities, setActivities] = useState([...recentActivity]);

    const handleToggleLike = (id) => {
        setActivities(prev => prev.map(activity => {
            if (activity.id === id) {
                const isLiked = activity.hasLiked;
                return {
                    ...activity,
                    hasLiked: !isLiked,
                    likes: isLiked ? activity.likes - 1 : activity.likes + 1
                };
            }
            return activity;
        }));
    };

    return (
        <div className="container main-content animate-fade-in pb-24 md:pb-8">

            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 className="text-h2 font-bold mb-2">Social Feed</h1>
                    <p className="text-muted">See what your gym friends are up to.</p>
                </div>
                <button className="btn-secondary" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Plus size={16} /> Add Friend
                </button>
            </header>

            {/* Activity Timeline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '600px', margin: '0 auto' }}>

                {/* Post Input Header (Fake) */}
                <div className="glass-card" style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '1rem' }}>
                    <img
                        src={currentUser.avatarUrl}
                        alt={currentUser.username}
                        style={{ width: '40px', height: '40px', borderRadius: '50%' }}
                    />
                    <div style={{ flex: 1, background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        Share a PR, workout, or photo...
                    </div>
                </div>

                {activities.map(activity => (
                    <div key={activity.id} className="glass-card" style={{ padding: '1.5rem' }}>

                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <img
                                    src={activity.avatarUrl}
                                    alt={activity.username}
                                    style={{ width: '48px', height: '48px', borderRadius: '50%' }}
                                />
                                <div>
                                    <h3 className="font-bold text-regular">
                                        {activity.username} <span className="text-muted font-normal text-small"> {activity.action}</span>
                                    </h3>
                                    <p className="text-small text-muted">{activity.time}</p>
                                </div>
                            </div>
                        </div>

                        {/* Content Body */}
                        <div style={{
                            background: 'var(--bg-secondary)',
                            padding: '1.5rem',
                            borderRadius: 'var(--radius-md)',
                            borderLeft: '4px solid var(--accent-primary)',
                            marginBottom: '1rem'
                        }}>
                            <p className="text-large font-bold">{activity.detail}</p>
                        </div>

                        {/* Interaction Footer */}
                        <div style={{ display: 'flex', gap: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
                            <button
                                onClick={() => handleToggleLike(activity.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    color: activity.hasLiked ? 'var(--danger)' : 'var(--text-muted)',
                                    transition: 'color 0.2s',
                                    transform: activity.hasLiked ? 'scale(1.1)' : 'scale(1)'
                                }}
                                className="hover:text-danger">
                                <Heart size={18} fill={activity.hasLiked ? 'currentColor' : 'none'} />
                                <span className="text-small font-medium">{activity.likes}</span>
                            </button>
                            <button style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', transition: 'color 0.2s' }} className="hover:text-accent">
                                <MessageCircle size={18} /> <span className="text-small font-medium">{activity.comments}</span>
                            </button>
                            <button style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginLeft: 'auto', transition: 'color 0.2s' }} className="hover:text-white">
                                <Share2 size={18} />
                            </button>
                        </div>

                    </div>
                ))}

                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    <p className="text-small">You're all caught up!</p>
                </div>
            </div>
        </div>
    );
};

export default SocialFeed;
