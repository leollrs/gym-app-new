import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Dumbbell, Activity, User, Tv, BookOpen } from 'lucide-react';

const Navigation = () => {
  return (
    <>
      {/* Desktop Top Navigation */}
      <nav className="hidden md:block sticky top-0 z-50 border-b border-white/5 bg-[#0A0D14]/80 backdrop-blur-2xl">
        <div className="container flex justify-between items-center py-4">
          <div className="text-[22px] font-bold flex items-center gap-0 tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            <span className="text-gradient">Iron</span><span className="text-white">Forge</span>
          </div>
          <div className="flex gap-6 items-center">
            {[
              { to: '/',         icon: Home,     label: 'Dashboard', end: true },
              { to: '/workouts', icon: Dumbbell, label: 'Workouts' },
              { to: '/exercises',icon: BookOpen, label: 'Exercises' },
              { to: '/social',   icon: Activity, label: 'Social' },
              { to: '/profile',  icon: User,     label: 'Profile' },
            ].map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 text-[14px] font-medium transition-colors px-1 py-0.5 ${
                    isActive ? 'text-white' : 'text-slate-500 hover:text-slate-200'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
            <NavLink
              to="/tv-display"
              className="ml-2 flex items-center gap-1.5 text-[13px] font-medium text-amber-500/70 hover:text-amber-400 transition-colors border border-amber-500/20 px-3 py-1.5 rounded-lg"
            >
              <Tv size={14} /> Gym TV
            </NavLink>
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0A0D14]/90 backdrop-blur-2xl border-t border-white/8 flex justify-around items-center pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5 px-2">
        {[
          { to: '/',          icon: Home,     label: 'Home',      end: true },
          { to: '/workouts',  icon: Dumbbell, label: 'Workouts' },
          { to: '/exercises', icon: BookOpen, label: 'Exercises' },
          { to: '/social',    icon: Activity, label: 'Social' },
          { to: '/profile',   icon: User,     label: 'Profile' },
        ].map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-2 transition-colors min-w-[44px] min-h-[44px] justify-center ${
                isActive ? 'text-blue-400' : 'text-slate-600'
              }`
            }
          >
            <Icon size={22} />
            <span className="text-[10px] font-semibold">{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
};

export default Navigation;
