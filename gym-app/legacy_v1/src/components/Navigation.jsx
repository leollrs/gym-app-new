import React from 'react';
import { Home, Dumbbell, Users, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Navigation() {
    const location = useLocation();
    const navigate = useNavigate();

    const navItems = [
        { path: '/', icon: Home, label: 'Home' },
        { path: '/workouts', icon: Dumbbell, label: 'Workouts' },
        { path: '/social', icon: Users, label: 'Social' },
        { path: '/profile', icon: User, label: 'Profile' }
    ];

    return (
        <nav className="glass-bottom-nav">
            {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;

                return (
                    <button
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        className="flex-col flex-center"
                        style={{
                            gap: '4px',
                            color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                            flex: 1
                        }}
                    >
                        <Icon size={24} style={{ opacity: isActive ? 1 : 0.7 }} />
                        <span style={{ fontSize: '0.75rem', fontWeight: isActive ? 600 : 400 }}>
                            {item.label}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}
