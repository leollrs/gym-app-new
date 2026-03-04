import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, CalendarCheck, Trophy, Dumbbell,
  BarChart3, Megaphone, Settings, LogOut, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const NAV = [
  { to: '/admin',              label: 'Overview',      icon: LayoutDashboard, exact: true },
  { to: '/admin/members',      label: 'Members',       icon: Users },
  { to: '/admin/attendance',   label: 'Attendance',    icon: CalendarCheck },
  { to: '/admin/challenges',   label: 'Challenges',    icon: Trophy },
  { to: '/admin/programs',     label: 'Programs',      icon: Dumbbell },
  { to: '/admin/leaderboard',  label: 'Leaderboard',   icon: BarChart3 },
  { to: '/admin/announcements',label: 'Announcements', icon: Megaphone },
  { to: '/admin/settings',     label: 'Settings',      icon: Settings },
];

// Bottom nav shows top 5 most-used on mobile
const MOBILE_NAV = NAV.filter(n =>
  ['/admin', '/admin/members', '/admin/challenges', '/admin/programs', '/admin/settings'].includes(n.to)
);

const linkClass = (active) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
    active
      ? 'bg-[#D4AF37]/10 text-[#D4AF37]'
      : 'text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/5'
  }`;

export default function AdminLayout({ children }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#05070B] flex">

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[240px] flex-shrink-0 border-r border-white/6 min-h-screen sticky top-0 h-screen">
        {/* Gym name */}
        <div className="px-5 py-5 border-b border-white/6">
          <p className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-widest mb-0.5">Admin</p>
          <p className="text-[16px] font-bold text-[#E5E7EB] truncate">
            {profile?.gym_id ? 'My Gym' : 'Dashboard'}
          </p>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) => linkClass(isActive)}
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User + sign out */}
        <div className="px-3 py-4 border-t border-white/6">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-[#D4AF37]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-[#D4AF37]">
                {profile?.full_name?.[0]?.toUpperCase() ?? 'A'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{profile?.full_name ?? 'Admin'}</p>
              <p className="text-[11px] text-[#6B7280] capitalize">{profile?.role}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#6B7280] hover:text-[#EF4444] hover:bg-red-500/5 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/6 bg-[#05070B]/95 backdrop-blur-xl flex-shrink-0">
          <p className="text-[15px] font-bold text-[#E5E7EB]">Admin</p>
          <button onClick={handleSignOut} className="text-[#6B7280] hover:text-[#EF4444] transition-colors">
            <LogOut size={18} />
          </button>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/8 bg-[#05070B]/95 backdrop-blur-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {MOBILE_NAV.map(({ to, label, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
                isActive ? 'text-[#D4AF37]' : 'text-[#6B7280]'
              }`
            }
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
      </nav>

    </div>
  );
}
