import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Dumbbell, Activity, User, Trophy, Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/',             icon: Home,     label: 'Dashboard',  end: true },
  { to: '/workouts',     icon: Dumbbell, label: 'Workouts' },
  { to: '/challenges',   icon: Trophy,   label: 'Challenges' },
  { to: '/social',       icon: Activity, label: 'Social' },
  { to: '/profile',      icon: User,     label: 'Profile' },
];

const Navigation = () => {
  const { gymName, user } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    const fetch = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('read', false);
      setUnread(count || 0);
    };
    fetch();
    const ch = supabase.channel('nav-notif')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${user.id}` },
        fetch)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [user?.id]);

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

          {/* Bell */}
          <button
            onClick={() => navigate('/notifications')}
            className="relative ml-1 p-2 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/4 transition-colors"
          >
            <Bell size={17} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#D4AF37] text-black text-[9px] font-black flex items-center justify-center leading-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
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
