import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Dumbbell, Activity, User, Trophy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/',             icon: Home,     label: 'Dashboard',  end: true },
  { to: '/workouts',     icon: Dumbbell, label: 'Workouts' },
  { to: '/leaderboard',  icon: Trophy,   label: 'Leaderboard' },
  { to: '/social',       icon: Activity, label: 'Social' },
  { to: '/profile',      icon: User,     label: 'Profile' },
];

const Navigation = () => {
  const { gymName } = useAuth();
  return (
  <>
    {/* Desktop Top Navigation */}
    <nav className="hidden md:block sticky top-0 z-50 border-b border-white/6 bg-[#03050A]/90 backdrop-blur-2xl">
      <div className="container flex justify-between items-center py-3.5">

        {/* Brand */}
        <div
          className="text-[21px] font-black tracking-tight text-gradient"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {gymName || 'GymApp'}
        </div>

        {/* Links */}
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'text-[#D4AF37]'
                    : 'text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/4'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
                  {label}
                  {isActive && (
                    <span className="absolute bottom-0 left-3 right-3 h-px bg-[#D4AF37] rounded-full opacity-70" />
                  )}
                </>
              )}
            </NavLink>
          ))}

        </div>
      </div>
    </nav>

    {/* Mobile Bottom Navigation */}
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#05070B]/95 backdrop-blur-2xl border-t border-white/6 flex justify-around items-center pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2 px-1">
      {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[52px] min-h-[44px] justify-center ${
              isActive ? 'text-[#D4AF37]' : 'text-[#4B5563] hover:text-[#9CA3AF]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={21} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-semibold tracking-wide">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  </>
  );
};

export default Navigation;
