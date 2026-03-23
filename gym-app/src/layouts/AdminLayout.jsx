import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import {
  LayoutDashboard, Users, CalendarCheck, Trophy, Dumbbell,
  BarChart3, Megaphone, Settings, LogOut, ChevronRight,
  TrendingUp, ShieldAlert, AlertTriangle, UserCheck, MoreHorizontal, X, MessageSquare, ShoppingBag,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const NAV_SECTIONS = [
  {
    labelKey: 'adminNav.main',
    items: [
      { to: '/admin',              labelKey: 'adminNav.overview',      icon: LayoutDashboard, exact: true },
      { to: '/admin/members',      labelKey: 'adminNav.members',       icon: Users },
    ],
  },
  {
    labelKey: 'adminNav.intelligence',
    items: [
      { to: '/admin/churn',        labelKey: 'adminNav.churnIntel',   icon: AlertTriangle },
      { to: '/admin/analytics',    labelKey: 'adminNav.analytics',     icon: TrendingUp },
    ],
  },
  {
    labelKey: 'adminNav.engage',
    items: [
      { to: '/admin/attendance',   labelKey: 'adminNav.attendance',    icon: CalendarCheck },
      { to: '/admin/challenges',   labelKey: 'adminNav.challenges',    icon: Trophy },
      { to: '/admin/trainers',     labelKey: 'adminNav.trainers',      icon: UserCheck },
      { to: '/admin/programs',     labelKey: 'adminNav.programs',      icon: Dumbbell },
      { to: '/admin/leaderboard',  labelKey: 'adminNav.leaderboard',   icon: BarChart3 },
      { to: '/admin/messages',      labelKey: 'adminNav.messages',      icon: MessageSquare },
      { to: '/admin/store',        labelKey: 'adminNav.store',         icon: ShoppingBag },
      { to: '/admin/announcements',labelKey: 'adminNav.announcements', icon: Megaphone },
    ],
  },
  {
    labelKey: 'adminNav.system',
    items: [
      { to: '/admin/moderation',   labelKey: 'adminNav.moderation',    icon: ShieldAlert },
      { to: '/admin/settings',     labelKey: 'adminNav.settings',      icon: Settings },
    ],
  },
];

// Flat list for mobile nav filtering
const ALL_NAV = NAV_SECTIONS.flatMap(s => s.items);

// Bottom nav shows 4 most-used items + a "More" button
const MOBILE_PRIMARY_PATHS = ['/admin', '/admin/members', '/admin/challenges', '/admin/settings'];
const MOBILE_NAV = ALL_NAV.filter(n => MOBILE_PRIMARY_PATHS.includes(n.to));
const MOBILE_MORE_NAV = ALL_NAV.filter(n => !MOBILE_PRIMARY_PATHS.includes(n.to));

const linkClass = (active) =>
  `flex items-center gap-2.5 pl-3 pr-3 py-2 rounded-lg text-[13px] font-medium transition-all relative ${
    active
      ? 'bg-white/[0.03] text-[#D4AF37] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-[#D4AF37]'
      : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.02]'
  }`;

export default function AdminLayout({ children }) {
  const { profile, gymName, gymLogoUrl, signOut } = useAuth();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [highRiskCount, setHighRiskCount] = useState(0);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  // Close "More" menu on route change
  useEffect(() => {
    setMoreMenuOpen(false);
  }, [location.pathname]);

  // Close "More" menu on outside tap
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

  // Check if any "More" item is the active route
  const moreIsActive = MOBILE_MORE_NAV.some(
    n => n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to)
  );

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
      <a href="#main-content" className="skip-to-content">
        {t('adminNav.skipToMain')}
      </a>

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
              <p className="text-[11px] text-[#6B7280] leading-tight">{t('adminNav.admin')}</p>
            </div>
          </div>
          <div className="mt-4 border-b border-white/6" />
        </div>

        {/* Nav sections */}
        <nav aria-label="Admin sidebar navigation" className="flex-1 px-3 pb-3 overflow-y-auto">
          {NAV_SECTIONS.map((section, idx) => (
            <div key={section.labelKey} className={idx > 0 ? 'mt-5' : ''}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em]">
                {t(section.labelKey)}
              </p>
              <div className="space-y-px">
                {section.items.map(({ to, labelKey, icon: Icon, exact }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={exact}
                    className={({ isActive }) => linkClass(isActive)}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="flex-1">{t(labelKey)}</span>
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
            {t('adminNav.signOut')}
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main id="main-content" className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Mobile top bar */}
        <header
          className="md:hidden flex items-center justify-between px-4 border-b border-white/6 bg-[#05070B]/95 backdrop-blur-xl flex-shrink-0"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: '12px', height: 'calc(52px + env(safe-area-inset-top))' }}
        >
          <p className="text-[15px] font-bold text-[#E5E7EB]">{t('adminNav.admin')}</p>
          <button onClick={handleSignOut} aria-label={t('adminNav.signOut')} className="text-[#6B7280] hover:text-[#EF4444] transition-colors">
            <LogOut size={18} />
          </button>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
      </main>

      {/* ── Mobile "More" menu overlay ──────────────────────── */}
      {moreMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
      )}

      {/* ── Mobile "More" slide-up panel ────────────────────── */}
      <div
        ref={moreMenuRef}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-[70] transition-transform duration-300 ease-out ${
          moreMenuOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="bg-[#0F172A] border-t border-white/8 rounded-t-2xl px-4 pt-3 pb-4">
          {/* Panel header */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-semibold text-[#9CA3AF]">{t('adminNav.morePages')}</p>
            <button
              onClick={() => setMoreMenuOpen(false)}
              className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/[0.04] transition-colors"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
          {/* Nav grid */}
          <div className="grid grid-cols-4 gap-2">
            {MOBILE_MORE_NAV.map(({ to, labelKey, icon: Icon, exact }) => (
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
                <span className="text-[10px] font-medium text-center leading-tight">{t(labelKey)}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      <nav aria-label="Admin mobile navigation" className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/8 bg-[#05070B]/95 backdrop-blur-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {MOBILE_NAV.map(({ to, labelKey, icon: Icon, exact }) => (
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
            <span className="text-[10px] font-medium">{t(labelKey)}</span>
          </NavLink>
        ))}
        {/* More button */}
        <button
          onClick={() => setMoreMenuOpen(prev => !prev)}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
            moreMenuOpen || moreIsActive ? 'text-[#D4AF37]' : 'text-[#6B7280]'
          }`}
          aria-label={t('adminNav.morePages')}
          aria-expanded={moreMenuOpen}
        >
          <MoreHorizontal size={20} />
          <span className="text-[10px] font-medium">{t('adminNav.more')}</span>
        </button>
      </nav>

    </div>
  );
}
