import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import {
  Building2, Users, BarChart3, Search, Settings, LogOut,
  ScrollText, MoreHorizontal, X, Shield,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const NAV_SECTIONS = [
  {
    label: 'MAIN',
    items: [
      { to: '/platform',            label: 'Gyms',           icon: Building2, exact: true },
      { to: '/platform/analytics',   label: 'Analytics',      icon: BarChart3 },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      { to: '/platform/members',    label: 'Member Lookup',  icon: Search },
      { to: '/platform/audit-log',  label: 'Audit Log',      icon: ScrollText },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/platform/settings',   label: 'Settings',       icon: Settings },
    ],
  },
];

const ALL_NAV = NAV_SECTIONS.flatMap(s => s.items);

const MOBILE_PRIMARY_PATHS = ['/platform', '/platform/analytics', '/platform/members', '/platform/settings'];
const MOBILE_NAV = ALL_NAV.filter(n => MOBILE_PRIMARY_PATHS.includes(n.to));
const MOBILE_MORE_NAV = ALL_NAV.filter(n => !MOBILE_PRIMARY_PATHS.includes(n.to));

const linkClass = (active) =>
  `flex items-center gap-2.5 pl-3 pr-3 py-2 rounded-lg text-[13px] font-medium transition-all relative ${
    active
      ? 'bg-white/[0.03] text-[#D4AF37] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-[#D4AF37]'
      : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.02]'
  }`;

export default function PlatformLayout({ children }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    setMoreMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleClick = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [moreMenuOpen]);

  const moreIsActive = MOBILE_MORE_NAV.some(
    n => n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to)
  );

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#05070B] flex">
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-[240px] flex-shrink-0 border-r border-white/6 min-h-screen sticky top-0 h-screen">
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/15 border border-[#D4AF37]/20 flex items-center justify-center flex-shrink-0">
              <Shield size={14} className="text-[#D4AF37]" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#E5E7EB] truncate leading-tight">
                Platform Admin
              </p>
              <p className="text-[11px] text-[#D4AF37] leading-tight">Super Admin</p>
            </div>
          </div>
          <div className="mt-4 border-b border-white/6" />
        </div>

        <nav aria-label="Platform sidebar navigation" className="flex-1 px-3 pb-3 overflow-y-auto">
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
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-white/6">
          <div className="flex items-center gap-2.5 px-3 py-1.5 mb-1">
            <div className="w-6 h-6 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-[#D4AF37]">
                {profile?.full_name?.[0]?.toUpperCase() ?? 'S'}
              </span>
            </div>
            <p className="text-[13px] font-medium text-[#9CA3AF] truncate">{profile?.full_name ?? 'Super Admin'}</p>
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

      {/* Main content */}
      <main id="main-content" className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <header
          className="md:hidden flex items-center justify-between px-4 border-b border-white/6 bg-[#05070B]/95 backdrop-blur-xl flex-shrink-0"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: '12px', height: 'calc(52px + env(safe-area-inset-top))' }}
        >
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[#D4AF37]" />
            <p className="text-[15px] font-bold text-[#E5E7EB]">Platform</p>
          </div>
          <button onClick={handleSignOut} aria-label="Sign out" className="text-[#6B7280] hover:text-[#EF4444] transition-colors">
            <LogOut size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
      </main>

      {/* Mobile "More" menu overlay */}
      {moreMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
      )}

      {/* Mobile "More" slide-up panel */}
      <div
        ref={moreMenuRef}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-[70] transition-transform duration-300 ease-out ${
          moreMenuOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="bg-[#0F172A] border-t border-white/8 rounded-t-2xl px-4 pt-3 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-semibold text-[#9CA3AF]">More Pages</p>
            <button
              onClick={() => setMoreMenuOpen(false)}
              className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/[0.04] transition-colors"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MOBILE_MORE_NAV.map(({ to, label, icon: Icon, exact }) => (
              <NavLink
                key={to}
                to={to}
                end={exact}
                onClick={() => setMoreMenuOpen(false)}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 py-3 px-1 rounded-xl transition-colors ${
                    isActive
                      ? 'text-[#D4AF37] bg-[#D4AF37]/10'
                      : 'text-[#9CA3AF] hover:bg-white/[0.04]'
                  }`
                }
              >
                <Icon size={22} strokeWidth={1.75} />
                <span className="text-[10px] font-medium text-center leading-tight">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav aria-label="Platform mobile navigation" className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/8 bg-[#05070B]/95 backdrop-blur-2xl"
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
        {MOBILE_MORE_NAV.length > 0 && (
          <button
            onClick={() => setMoreMenuOpen(prev => !prev)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
              moreMenuOpen || moreIsActive ? 'text-[#D4AF37]' : 'text-[#6B7280]'
            }`}
            aria-label="More platform pages"
            aria-expanded={moreMenuOpen}
          >
            <MoreHorizontal size={20} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        )}
      </nav>
    </div>
  );
}
