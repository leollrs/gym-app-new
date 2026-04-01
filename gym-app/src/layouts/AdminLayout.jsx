import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import {
  LayoutDashboard, Users, CalendarCheck, Trophy, Dumbbell,
  BarChart3, Megaphone, Settings, LogOut, ChevronRight,
  TrendingUp, ShieldAlert, AlertTriangle, UserCheck, MoreHorizontal, X, MessageSquare, ShoppingBag, CalendarDays, DollarSign, ClipboardList, Download, Filter, Gift, MessageCircle, Mail, Target, Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const AdminOnboardingWizard = lazy(() => import('../components/admin/AdminOnboardingWizard'));

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
      { to: '/admin/segments',    labelKey: 'adminNav.segments',      icon: Filter },
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
      { to: '/admin/classes',      labelKey: 'adminNav.classes',       icon: CalendarDays, requiresConfig: 'classesEnabled' },
      { to: '/admin/store',        labelKey: 'adminNav.store',         icon: ShoppingBag },
      { to: '/admin/revenue',     labelKey: 'adminNav.revenue',       icon: DollarSign },
      { to: '/admin/announcements',labelKey: 'adminNav.announcements', icon: Megaphone },
      { to: '/admin/referrals',  labelKey: 'adminNav.referrals',     icon: Gift },
      { to: '/admin/nps',        labelKey: 'adminNav.nps',            icon: MessageCircle },
    ],
  },
  {
    labelKey: 'adminNav.system',
    items: [
      { to: '/admin/moderation',   labelKey: 'adminNav.moderation',    icon: ShieldAlert },
      { to: '/admin/audit-log',   labelKey: 'adminNav.auditLog',      icon: ClipboardList },
      { to: '/admin/reports',     labelKey: 'adminNav.reports',        icon: Download },
      { to: '/admin/digest',     labelKey: 'adminNav.digest',          icon: Mail },
      { to: '/admin/settings',     labelKey: 'adminNav.settings',      icon: Settings },
    ],
  },
];

// Bottom nav shows 4 most-used items + a "More" button
const MOBILE_PRIMARY_PATHS = ['/admin', '/admin/members', '/admin/challenges', '/admin/settings'];

// Helper: filter nav items by gymConfig feature flags
function filterNavItems(items, config) {
  return items.filter(item => {
    if (!item.requiresConfig) return true;
    return !!config?.[item.requiresConfig];
  });
}

function getFilteredNav(config) {
  const sections = NAV_SECTIONS.map(s => ({
    ...s,
    items: filterNavItems(s.items, config),
  }));
  const allNav = sections.flatMap(s => s.items);
  return {
    sections,
    mobileNav: allNav.filter(n => MOBILE_PRIMARY_PATHS.includes(n.to)),
    mobileMoreNav: allNav.filter(n => !MOBILE_PRIMARY_PATHS.includes(n.to)),
  };
}

const linkClass = (active) =>
  `flex items-center gap-2.5 pl-3 pr-3 py-2.5 rounded-lg text-[14px] font-medium transition-all relative ${
    active
      ? 'bg-white/[0.03] text-[#D4AF37] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-[#D4AF37]'
      : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.02]'
  }`;

export default function AdminLayout({ children }) {
  const { profile, gymName, gymLogoUrl, signOut, gymConfig } = useAuth();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [highRiskCount, setHighRiskCount] = useState(0);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);
  const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
  const [onlineAdmins, setOnlineAdmins] = useState([]);
  const [navSearch, setNavSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState({});

  // Admin presence heartbeat (multi-admin awareness)
  useEffect(() => {
    if (!profile?.gym_id || !gymConfig?.multiAdminEnabled) return;
    const page = location.pathname.replace('/admin', '') || '/';
    // Initial heartbeat
    supabase.rpc('admin_heartbeat', { p_page: page }).catch(() => {});
    // Periodic heartbeat every 60s
    const interval = setInterval(() => {
      const currentPage = location.pathname.replace('/admin', '') || '/';
      supabase.rpc('admin_heartbeat', { p_page: currentPage }).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [profile?.gym_id, gymConfig?.multiAdminEnabled, location.pathname]);

  // Fetch online admins (for multi-admin gyms)
  useEffect(() => {
    if (!profile?.gym_id || !gymConfig?.multiAdminEnabled) return;
    const fetchOnline = async () => {
      try {
        const twoMinAgo = new Date(Date.now() - 120_000).toISOString();
        const { data } = await supabase
          .from('admin_presence')
          .select('profile_id, current_page, last_seen_at, profiles(full_name)')
          .eq('gym_id', profile.gym_id)
          .gte('last_seen_at', twoMinAgo)
          .neq('profile_id', profile.id);
        setOnlineAdmins(data || []);
      } catch { /* non-critical */ }
    };
    fetchOnline();
    const interval = setInterval(fetchOnline, 30_000);
    return () => clearInterval(interval);
  }, [profile?.gym_id, profile?.id, gymConfig?.multiAdminEnabled]);

  // Show onboarding wizard for admins who haven't completed setup
  useEffect(() => {
    if (profile?.role === 'admin' && gymConfig.setupCompleted === false) {
      setShowOnboardingWizard(true);
    }
  }, [profile?.role, gymConfig.setupCompleted]);

  // Filter nav items based on gymConfig feature flags
  const { sections: filteredSections, mobileNav: MOBILE_NAV, mobileMoreNav: MOBILE_MORE_NAV } = getFilteredNav(gymConfig);
  const navQuery = navSearch.trim().toLowerCase();
  const visibleSections = filteredSections
    .map((section) => ({
      ...section,
      items: navQuery
        ? section.items.filter((item) => t(item.labelKey).toLowerCase().includes(navQuery))
        : section.items,
    }))
    .filter((section) => section.items.length > 0);

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
      {/* Admin onboarding wizard for first-time gym setup */}
      {showOnboardingWizard && (
        <Suspense fallback={null}>
          <AdminOnboardingWizard onComplete={() => setShowOnboardingWizard(false)} />
        </Suspense>
      )}

      <a href="#main-content" className="skip-to-content">
        {t('adminNav.skipToMain')}
      </a>

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[280px] xl:w-[320px] flex-shrink-0 border-r border-white/6 min-h-screen sticky top-0 h-screen">
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
              <p className="text-[15px] font-semibold text-[#E5E7EB] truncate leading-tight">
                {gymName || 'Dashboard'}
              </p>
              <p className="text-[12px] text-[#6B7280] leading-tight">{t('adminNav.admin')}</p>
            </div>
          </div>
          <div className="mt-4 border-b border-white/6" />
          <div className="mt-4 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder={t('adminNav.search', { defaultValue: 'Search pages...' })}
              className="w-full bg-[#0F172A] border border-white/8 rounded-xl pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40"
            />
          </div>
        </div>

        {/* Nav sections */}
        <nav aria-label="Admin sidebar navigation" className="flex-1 px-3 pb-3 overflow-y-auto">
          {visibleSections.map((section, idx) => (
            <div key={section.labelKey} className={idx > 0 ? 'mt-5' : ''}>
              <button
                onClick={() => setCollapsedSections((prev) => ({ ...prev, [section.labelKey]: !prev[section.labelKey] }))}
                className="w-full flex items-center justify-between px-3 mb-1.5 text-left"
              >
                <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-[0.08em]">
                  {t(section.labelKey)}
                </p>
                <ChevronRight
                  size={12}
                  className={`text-[#6B7280] transition-transform ${collapsedSections[section.labelKey] ? '' : 'rotate-90'}`}
                />
              </button>
              {!collapsedSections[section.labelKey] && (
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
              )}
            </div>
          ))}
          {visibleSections.length === 0 && (
            <p className="px-3 py-4 text-[12px] text-[#6B7280]">No pages match that search.</p>
          )}
        </nav>

        {/* Online admins indicator (multi-admin) */}
        {onlineAdmins.length > 0 && (
          <div className="px-3 pb-2">
            <div className="px-3 py-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
              <p className="text-[10px] font-semibold text-emerald-400/80 uppercase tracking-wider mb-1.5">Online Now</p>
              {onlineAdmins.map(a => (
                <div key={a.profile_id} className="flex items-center gap-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  <span className="text-[11px] text-[#9CA3AF] truncate">{a.profiles?.full_name || 'Admin'}</span>
                  {a.current_page && (
                    <span className="text-[9px] text-[#6B7280] ml-auto flex-shrink-0">{a.current_page}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User + sign out */}
        <div className="px-3 py-3 border-t border-white/6">
          <div className="flex items-center gap-2.5 px-3 py-1.5 mb-1">
            <div className="w-6 h-6 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-[#D4AF37]">
                {profile?.full_name?.[0]?.toUpperCase() ?? 'A'}
              </span>
            </div>
            <p className="text-[14px] font-medium text-[#9CA3AF] truncate">{profile?.full_name ?? 'Admin'}</p>
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
          <button onClick={handleSignOut} aria-label={t('adminNav.signOut')} className="text-[#6B7280] hover:text-[#EF4444] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
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
        <div className="bg-[#0F172A] border-t border-white/8 rounded-t-2xl px-4 pt-3 pb-4 overflow-hidden">
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
