import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Dumbbell, Activity, User, Tv } from 'lucide-react';

const Navigation = () => {
    return (
        <>
            {/* Desktop Top Navigation */}
            <nav className="glass hidden md:block sticky top-0 z-50 py-4">
                <div className="container flex justify-between items-center">
                    <div className="text-h2 font-bold flex items-center gap-2">
                        <span className="text-gradient">Iron</span>Forge
                    </div>
                    <div className="flex gap-8 items-center">
                        <NavLink to="/" className={({ isActive }) => `flex items-center gap-2 font-medium transition-colors ${isActive ? 'text-accent' : 'text-muted hover:text-white'}`}>
                            <Home size={18} /> Dashboard
                        </NavLink>
                        <NavLink to="/workouts" className={({ isActive }) => `flex items-center gap-2 font-medium transition-colors ${isActive ? 'text-accent' : 'text-muted hover:text-white'}`}>
                            <Dumbbell size={18} /> Workouts
                        </NavLink>
                        <NavLink to="/social" className={({ isActive }) => `flex items-center gap-2 font-medium transition-colors ${isActive ? 'text-accent' : 'text-muted hover:text-white'}`}>
                            <Activity size={18} /> Social
                        </NavLink>
                        <NavLink to="/profile" className={({ isActive }) => `flex items-center gap-2 font-medium transition-colors ${isActive ? 'text-accent' : 'text-muted hover:text-white'}`}>
                            <User size={18} /> Profile
                        </NavLink>

                        {/* Temporary Admin Link */}
                        <NavLink to="/tv-display" className="ml-4 flex items-center gap-2 font-medium text-warning hover:text-white transition-colors">
                            <Tv size={18} /> Gym TV
                        </NavLink>
                    </div>
                </div>
            </nav>

            {/* Mobile Bottom Navigation */}
            <nav className="glass md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center border-t border-white/10 border-b-0 rounded-t-2xl pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 px-4">
                <NavLink to="/" className={({ isActive }) => `flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-accent' : 'text-muted'}`}>
                    <Home size={24} />
                    <span className="text-[10px] font-medium">Home</span>
                </NavLink>
                <NavLink to="/workouts" className={({ isActive }) => `flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-accent' : 'text-muted'}`}>
                    <Dumbbell size={24} />
                    <span className="text-[10px] font-medium">Workouts</span>
                </NavLink>
                <NavLink to="/social" className={({ isActive }) => `flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-accent' : 'text-muted'}`}>
                    <Activity size={24} />
                    <span className="text-[10px] font-medium">Social</span>
                </NavLink>
                <NavLink to="/profile" className={({ isActive }) => `flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-accent' : 'text-muted'}`}>
                    <User size={24} />
                    <span className="text-[10px] font-medium">Profile</span>
                </NavLink>
            </nav>
        </>
    );
};

export default Navigation;
