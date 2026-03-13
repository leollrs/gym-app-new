import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Users, CalendarCheck, Trophy, Dumbbell,
  BarChart3, Megaphone, Settings, LogOut, ChevronRight,
  TrendingUp, ShieldAlert, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const NAV_SECTIONS = [
  {
    label: 'MAIN',
    items: [
      { to: '/admin',              label: 'Overview',      icon: LayoutDashboard, exact: true },
      { to: '/admin/members',      label: 'Members',       icon: Users },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { to: '/admin/churn',        label: 'Churn Intel',   icon: AlertTriangle },
      { to: '/admin/analytics',    label: 'Analytics',     icon: TrendingUp },
    ],
  },
  {
    label: 'ENGAGE',
    items: [
      { to: '/admin/attendance',   label: 'Attendance',    icon: CalendarCheck },
      { to: '/admin/challenges',   label: 'Challenges',    icon: Trophy },
      { to: '/admin/programs',     label: 'Programs',      icon: Dumbbell },
      { to: '/admin/leaderboard',  label: 'Leaderboard',   icon: BarChart3 },
      { to: '/admin/announcements',label: 'Announcements', icon: Megaphone },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/admin/moderation',   label: 'Moderation',    icon: ShieldAlert },
      { to: '/admin/settings',     label: 'Settings',      icon: Settings },
    ],
  },
];

// Flat list for mobile nav filtering
const ALL_NAV = NAV_SECTIONS.flatMap(s => s.items);

// Bottom nav shows top 5 most-used on mobile
const MOBILE_NAV = ALL_NAV.filter(n =>
  ['/admin', '/admin/members', '/admin/challenges', '/admin/programs', '/admin/settings'].includes(n.to)
);

const linkClass = (active) =>
  `flex items-center gap-2.5 pl-3 pr-3 py-2 rounded-lg text-[13px] font-medium transition-all relative ${
    active
      ? 'bg-white/[0.03] text-[#D4AF37] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-[#D4AF37]'
      : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.02]'
  }`;

export default function AdminLayout({ children }) {
  const { profile, gymName, gymLogoUrl, signOut } = useAuth();
  const navigate = useNavigate();
  const [highRiskCount, setHighRiskCount] = useState(0);

  // Fetch critical + high risk count from pre-computed churn scores
  useEffect(() => {
    if (!profile?.gym_id) return;
    const fetchHighRisk = async () => {
      try {
        const { count } = await supabase
          .from('churn_risk_scores')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', profile.gym_id)
          .in('risk_tier', ['critical', 'high']);
        setHighRiskCount(count ?? 0);
      } catch (_) {
        // Fail silently — badge is non-critical
      }
    };
    fetchHighRisk();
  }, [profile?.gym_id]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#05070B] flex">

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[240px] flex-shrink-0 border-r border-white/6 min-h-screen sticky top-0 h-screen">
        {/* Sidebar header */}
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            {gymLogoUrl ? (
              <img
                src={gymLogoUrl}
                alt={gymName || 'Gym logo'}
                className="w-8 h-8 rounded-lg object-contain bg-black/40 border border-white/8 flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/8 flex items-center justify-center flex-shrink-0">
                <LayoutDashboard size={14} className="text-[#6B7280]" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#E5E7EB] truncate leading-tight">
                {gymName || 'Dashboard'}
              </p>
              <p className="text-[11px] text-[#6B7280] leading-tight">Admin</p>
            </div>
          </div>
          <div className="mt-4 border-b border-white/6" />
        </div>

        {/* Nav sections */}
        <nav className="flex-1 px-3 pb-3 overflow-y-auto">
          {NAV_SECTIONS.map((section, idx) => (
            <div key={section.label} className={idx > 0 ? 'mt-5' : ''}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em]">
                {section.label}
              </p>
              <div className="space-y-px">
                {section.items.map(({ to, label, icon: Icon, exact }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={exact}
                    className={({ isActive }) => linkClass(isActive)}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="flex-1">{label}</span>
                    {to === '/admin/churn' && highRiskCount > 0 && (
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EF4444] text-white leading-none">
                        {highRiskCount}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User + sign out */}
        <div className="px-3 py-3 border-t border-white/6">
          <div className="flex items-center gap-2.5 px-3 py-1.5 mb-1">
            <div className="w-6 h-6 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-[#D4AF37]">
                {profile?.full_name?.[0]?.toUpperCase() ?? 'A'}
              </span>
            </div>
            <p className="text-[13px] font-medium text-[#9CA3AF] truncate">{profile?.full_name ?? 'Admin'}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-[#6B7280] hover:text-[#EF4444] hover:bg-red-500/5 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Mobile top bar */}
        <header
          className="md:hidden flex items-center justify-between px-4 border-b border-white/6 bg-[#05070B]/95 backdrop-blur-xl flex-shrink-0"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: '12px', height: 'calc(52px + env(safe-area-inset-top))' }}
        >
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
              `flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
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
