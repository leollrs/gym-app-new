import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import {
  LayoutDashboard, Users, CalendarCheck, Trophy, Dumbbell,
  BarChart3, Megaphone, Settings, LogOut, ChevronRight,
  TrendingUp, ShieldAlert, AlertTriangle, UserCheck, MoreHorizontal, X, MessageSquare, ShoppingBag, CalendarDays, DollarSign, ClipboardList, Download, Filter, Gift, MessageCircle, Mail, Palette, FlaskConical, Award, Wrench, UserCog, Bell, Send, Printer, Tv,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { ScanClaimProvider } from '../contexts/ScanClaimContext';
import { InsightsRangeProvider } from '../contexts/InsightsRangeContext';
import { supabase } from '../lib/supabase';
import UserAvatar from '../components/UserAvatar';

const AdminOnboardingWizard = lazy(() => import('../components/admin/AdminOnboardingWizard'));
const ScanFeedback = lazy(() => import('../components/admin/ScanFeedback'));
const GlobalSearch = lazy(() => import('../components/admin/GlobalSearch'));

// IA: 6 top-level sections aligned to admin jobs-to-be-done.
// Pages are regrouped here — every existing route stays alive.
const NAV_SECTIONS = [
  {
    labelKey: 'adminNav.sectionHome',
    items: [
      { to: '/admin',               labelKey: 'adminNav.overview',       icon: LayoutDashboard, exact: true },
      { to: '/admin/notifications', labelKey: 'adminNav.alerts',         icon: Bell, badge: 'unreadAdminNotifs' },
    ],
  },
  {
    labelKey: 'adminNav.sectionMembers',
    items: [
      { to: '/admin/members',  labelKey: 'adminNav.members',     icon: Users },
      { to: '/admin/segments', labelKey: 'adminNav.segments',    icon: Filter },
      { to: '/admin/churn',    labelKey: 'adminNav.churnIntel',  icon: AlertTriangle },
      { to: '/admin/print-cards', labelKey: 'adminNav.printCards', icon: Printer },
      { to: '/admin/trainers', labelKey: 'adminNav.trainers',    icon: UserCheck },
    ],
  },
  {
    labelKey: 'adminNav.sectionOutreach',
    items: [
      { to: '/admin/outreach',        labelKey: 'adminNav.outreach',       icon: Send },
      { to: '/admin/messages',        labelKey: 'adminNav.messages',       icon: MessageSquare },
      { to: '/admin/announcements',   labelKey: 'adminNav.announcements',  icon: Megaphone },
      { to: '/admin/email-templates', labelKey: 'adminNav.emailTemplates', icon: Palette },
      { to: '/admin/ab-testing',      labelKey: 'adminNav.abTesting',      icon: FlaskConical },
    ],
  },
  {
    labelKey: 'adminNav.sectionPrograms',
    items: [
      { to: '/admin/classes',    labelKey: 'adminNav.classes',    icon: CalendarDays, requiresConfig: 'classesEnabled' },
      { to: '/admin/programs',   labelKey: 'adminNav.programs',   icon: Dumbbell },
      { to: '/admin/challenges', labelKey: 'adminNav.challenges', icon: Trophy },
    ],
  },
  {
    labelKey: 'adminNav.sectionEngagement',
    items: [
      { to: '/admin/leaderboard', labelKey: 'adminNav.leaderboard', icon: BarChart3 },
      { to: '/admin/tv-setup',    labelKey: 'adminNav.tvDisplay',   icon: Tv },
      { to: '/admin/rewards',     labelKey: 'adminNav.rewards',     icon: Award },
      { to: '/admin/store',       labelKey: 'adminNav.store',       icon: ShoppingBag },
      { to: '/admin/referrals',   labelKey: 'adminNav.referrals',   icon: Gift },
    ],
  },
  {
    labelKey: 'adminNav.sectionInsights',
    items: [
      { to: '/admin/analytics',  labelKey: 'adminNav.analytics',  icon: TrendingUp },
      { to: '/admin/attendance', labelKey: 'adminNav.attendance', icon: CalendarCheck },
      { to: '/admin/revenue',    labelKey: 'adminNav.revenue',    icon: DollarSign },
      { to: '/admin/nps',        labelKey: 'adminNav.nps',        icon: MessageCircle },
      { to: '/admin/reports',    labelKey: 'adminNav.reports',    icon: Download },
    ],
  },
];

// Operations — oversight + scheduled-config surfaces. Rarely visited, high-stakes.
// Collapsed by default at the bottom of the rail; reachable via search.
const ADVANCED_PAGES = [
  { to: '/admin/moderation',        labelKey: 'adminNav.moderation',       icon: ShieldAlert,   descKey: 'adminNav.advancedDesc.moderation' },
  { to: '/admin/audit-log',         labelKey: 'adminNav.auditLog',         icon: ClipboardList, descKey: 'adminNav.advancedDesc.auditLog' },
  { to: '/admin/digest',            labelKey: 'adminNav.digest',           icon: Mail,          descKey: 'adminNav.advancedDesc.digest' },
  { to: '/admin/message-templates', labelKey: 'adminNav.messageTemplates', icon: MessageSquare, descKey: 'adminNav.advancedDesc.messageTemplates' },
];

// Bottom nav shows 4 most-used items + a "More" button
const MOBILE_PRIMARY_PATHS = ['/admin', '/admin/members', '/admin/classes', '/admin/messages'];

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
  const settingsItem = { to: '/admin/settings', labelKey: 'adminNav.settings', icon: Settings };
  const profileItem = { to: '/admin/profile', labelKey: 'adminNav.profile', icon: UserCog };
  const allNav = [...sections.flatMap(s => s.items), ...ADVANCED_PAGES, profileItem, settingsItem];
  return {
    sections,
    advancedPages: ADVANCED_PAGES,
    mobileNav: allNav.filter(n => MOBILE_PRIMARY_PATHS.includes(n.to)),
    mobileMoreNav: allNav.filter(n => !MOBILE_PRIMARY_PATHS.includes(n.to)),
  };
}

const linkClass = (active) =>
  `admin-nav-link ${
    active
      ? 'admin-nav-link-active'
      : ''
  }`;

export default function AdminLayout({ children }) {
  const { profile, gymName, gymLogoUrl, signOut, gymConfig, availableRoles } = useAuth();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [highRiskCount, setHighRiskCount] = useState(0);
  const [unreadAdminNotifs, setUnreadAdminNotifs] = useState(0);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);
  const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
  const [onlineAdmins, setOnlineAdmins] = useState([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
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

  // Show onboarding wizard for admins who haven't completed setup.
  // Multi-role users (e.g. member + admin via additional_roles) also need
  // the wizard the first time they enter the admin view.
  const isAdminEntitled = availableRoles?.some(r => r === 'admin' || r === 'super_admin');
  useEffect(() => {
    if (isAdminEntitled && gymConfig.setupCompleted === false) {
      setShowOnboardingWizard(true);
    }
  }, [isAdminEntitled, gymConfig.setupCompleted]);

  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(false);

  // Filter nav items based on gymConfig feature flags
  const { sections: filteredSections, advancedPages, mobileNav: MOBILE_NAV, mobileMoreNav: MOBILE_MORE_NAV } = getFilteredNav(gymConfig);
  const visibleSections = filteredSections;

  // Page index for the Cmd-K palette — translated labels + section name as
  // sub-text so admins can match either ("classes" or "programs section").
  // Built fresh every render off the i18n + gymConfig-filtered nav.
  const pageIndex = [
    ...filteredSections.flatMap(section =>
      section.items.map(item => ({
        kind: 'page',
        id: item.to,
        label: t(item.labelKey),
        sub: t(section.labelKey),
        route: item.to,
        haystack: `${t(item.labelKey)} ${t(section.labelKey)}`.toLowerCase(),
      })),
    ),
    ...advancedPages.map(item => ({
      kind: 'page',
      id: item.to,
      label: t(item.labelKey),
      sub: t('adminNav.advancedTools'),
      route: item.to,
      haystack: `${t(item.labelKey)} ${t('adminNav.advancedTools')}`.toLowerCase(),
    })),
    {
      kind: 'page',
      id: '/admin/settings',
      label: t('adminNav.settings'),
      sub: t('adminNav.settings'),
      route: '/admin/settings',
      haystack: t('adminNav.settings').toLowerCase(),
    },
    {
      kind: 'page',
      id: '/admin/profile',
      label: t('adminNav.profile'),
      sub: t('adminNav.profile'),
      route: '/admin/profile',
      haystack: t('adminNav.profile').toLowerCase(),
    },
  ];

  // Lock body scroll when More menu is open
  useEffect(() => {
    if (moreMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [moreMenuOpen]);

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

  // Unread admin-audience notifications (live).
  useEffect(() => {
    if (!profile?.id) return;
    const isSuperAdmin = profile.role === 'super_admin' || (profile.additional_roles || []).includes('super_admin');
    const audValues = isSuperAdmin ? ['admin', 'super_admin'] : ['admin'];
    const refreshUnread = () => {
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profile.id)
        .in('audience', audValues)
        .is('read_at', null)
        .is('dismissed_at', null)
        .then(({ count }) => setUnreadAdminNotifs(count || 0));
    };
    refreshUnread();
    const ch = supabase
      .channel(`admin-notifs-${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${profile.id}`,
      }, refreshUnread)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id, profile?.role]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <ScanClaimProvider>
    <InsightsRangeProvider>
    <div className="min-h-screen admin-shell flex">
      {/* Admin onboarding wizard for first-time gym setup */}
      {showOnboardingWizard && (
        <Suspense fallback={null}>
          <AdminOnboardingWizard onComplete={() => setShowOnboardingWizard(false)} />
        </Suspense>
      )}

      {/* Physical barcode/QR scanner feedback layer */}
      <Suspense fallback={null}>
        <ScanFeedback />
      </Suspense>

      <a href="#main-content" className="skip-to-content">
        {t('adminNav.skipToMain')}
      </a>

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[280px] xl:w-[320px] flex-shrink-0 admin-sidebar min-h-screen sticky top-0 h-screen">
        {/* Sidebar header */}
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            {gymLogoUrl ? (
              <img
                src={gymLogoUrl}
                alt={gymName || 'Gym logo'}
                className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
                style={{ background: 'var(--color-bg-active)', border: '1px solid var(--color-border-subtle)' }}
              />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-bg-hover)', border: '1px solid var(--color-border-subtle)' }}>
                <LayoutDashboard size={14} style={{ color: 'var(--color-text-subtle)' }} />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold truncate leading-tight"
                style={{ color: 'var(--color-text-primary)' }}>
                {gymName || 'Dashboard'}
              </p>
              <p className="text-[12px] leading-tight" style={{ color: 'var(--color-text-subtle)' }}>{t('adminNav.admin')}</p>
            </div>
          </div>
          <div className="mt-4" style={{ height: '1px', background: 'var(--color-border-subtle)' }} />
        </div>

        {/* Nav sections */}
        <nav aria-label="Admin sidebar navigation" className="flex-1 px-3 pb-3 overflow-y-auto">
          {visibleSections.map((section, idx) => (
            <div key={section.labelKey} className={idx > 0 ? 'mt-5' : ''}>
              <button
                onClick={() => setCollapsedSections((prev) => ({ ...prev, [section.labelKey]: !prev[section.labelKey] }))}
                className="w-full flex items-center justify-between px-3 mb-1.5 text-left"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: 'var(--color-text-subtle)' }}>
                  {t(section.labelKey)}
                </p>
                <ChevronRight
                  size={12}
                  className={`transition-transform ${collapsedSections[section.labelKey] ? '' : 'rotate-90'}`}
                  style={{ color: 'var(--color-text-subtle)' }}
                />
              </button>
              {!collapsedSections[section.labelKey] && (
                <div className="space-y-0.5">
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
                        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white leading-none"
                          style={{ background: 'var(--color-danger)' }}>
                          {highRiskCount}
                        </span>
                      )}
                      {to === '/admin/notifications' && unreadAdminNotifs > 0 && (
                        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white leading-none"
                          style={{ background: 'var(--color-accent)' }}>
                          {unreadAdminNotifs > 9 ? '9+' : unreadAdminNotifs}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Advanced Tools entry */}
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
            <button
              onClick={() => setAdvancedToolsOpen(prev => !prev)}
              className="admin-nav-link w-full"
            >
              <Wrench size={16} strokeWidth={1.75} />
              <span className="flex-1 text-left">{t('adminNav.advancedTools')}</span>
              <ChevronRight size={12} className={`transition-transform ${advancedToolsOpen ? 'rotate-90' : ''}`} />
            </button>
            {advancedToolsOpen && (
              <div className="mt-1 space-y-0.5">
                {advancedPages.map(({ to, labelKey, icon: Icon, descKey }) => (
                  <NavLink key={to} to={to} end={false} className={({ isActive }) => linkClass(isActive)}>
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="flex-1">{t(labelKey)}</span>
                  </NavLink>
                ))}
              </div>
            )}

            {/* Settings — below Advanced Tools */}
            <div className="mt-3 space-y-0.5">
              <NavLink to="/admin/settings" end={false} className={({ isActive }) => linkClass(isActive)}>
                <Settings size={16} strokeWidth={1.75} />
                <span className="flex-1">{t('adminNav.settings')}</span>
              </NavLink>
            </div>
          </div>
        </nav>

        {/* Online admins indicator (multi-admin) */}
        {onlineAdmins.length > 0 && (
          <div className="px-3 pb-2">
            <div className="px-3 py-2 rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--color-success) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-success) 10%, transparent)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'color-mix(in srgb, var(--color-success) 70%, var(--color-text-primary))' }}>Online Now</p>
              {onlineAdmins.map(a => (
                <div key={a.profile_id} className="flex items-center gap-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                    style={{ background: 'var(--color-success)' }} />
                  <span className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{a.profiles?.full_name || 'Admin'}</span>
                  {a.current_page && (
                    <span className="text-[9px] ml-auto flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>{a.current_page}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User + sign out */}
        <div className="px-3 py-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <button
            onClick={() => navigate('/admin/profile')}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 mb-1 rounded-lg transition-colors duration-200 text-left"
            onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--color-accent) 6%, transparent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <UserAvatar
              user={{
                ...profile,
                avatar_type: profile?.avatar_url ? 'photo' : profile?.avatar_design ? 'design' : 'color',
                avatar_value: profile?.avatar_url || profile?.avatar_design || profile?.avatar_color || '#6366F1',
              }}
              size={28}
            />
            <p className="text-[14px] font-medium truncate" style={{ color: 'var(--color-text-muted)' }}>{profile?.full_name ?? 'Admin'}</p>
            <ChevronRight size={14} className="ml-auto flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
          </button>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--color-danger) 5%, transparent)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut size={14} />
            {t('adminNav.signOut')}
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main id="main-content" className="flex-1 flex flex-col min-h-screen overflow-x-hidden overflow-y-auto"
        style={{ background: 'var(--color-admin-panel)' }}>
        {/* Mobile top bar — fixed so it never scrolls */}
        <header
          className="md:hidden flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-50"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: '12px',
            height: 'calc(56px + env(safe-area-inset-top))',
            background: 'var(--color-bg-nav)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}
        >
          {/* Left: gym logo or name */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {gymLogoUrl ? (
              <img
                src={gymLogoUrl}
                alt={gymName || 'Gym logo'}
                className="w-9 h-9 rounded-lg object-contain flex-shrink-0"
                style={{ background: 'var(--color-bg-active)', border: '1px solid var(--color-border-subtle)' }}
              />
            ) : (
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-bg-hover)', border: '1px solid var(--color-border-subtle)' }}>
                <LayoutDashboard size={15} style={{ color: 'var(--color-text-subtle)' }} />
              </div>
            )}
            <p className="text-[16px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{gymName || 'Dashboard'}</p>
          </div>

          {/* Right: notifications + alert badge + admin avatar */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => navigate('/admin/notifications')}
              aria-label={t('adminNav.notifications', 'Notifications')}
              className="relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Bell size={16} style={{ color: 'var(--color-text-primary)' }} />
              {unreadAdminNotifs > 0 && (
                <span
                  className="absolute top-1 right-1 w-2 h-2 rounded-full"
                  style={{
                    background: 'var(--color-accent)',
                    boxShadow: '0 0 0 2px var(--color-bg-hover)',
                  }}
                />
              )}
            </button>
            <button
              onClick={() => navigate('/admin/churn')}
              aria-label={t('adminNav.churnIntel')}
              className="relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <AlertTriangle size={16} style={{ color: 'var(--color-text-primary)' }} />
              {highRiskCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full"
                  style={{ background: 'var(--color-danger)', boxShadow: '0 0 0 2px var(--color-bg-hover)' }} />
              )}
            </button>
            <button
              onClick={() => navigate('/admin/profile')}
              aria-label={t('adminNav.profile')}
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 focus:ring-2 focus:outline-none overflow-hidden"
            >
              <UserAvatar
                user={{
                  ...profile,
                  avatar_type: profile?.avatar_url ? 'photo' : profile?.avatar_design ? 'design' : 'color',
                  avatar_value: profile?.avatar_url || profile?.avatar_design || profile?.avatar_color || '#6366F1',
                }}
                size={36}
              />
            </button>
          </div>
        </header>

        {/* Spacer for fixed header on mobile */}
        <div className="md:hidden flex-shrink-0" style={{ height: 'calc(56px + env(safe-area-inset-top))' }} />
        {/* Page content */}
        <div className="flex-1 pb-[calc(80px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
      </main>

      {/* ── Mobile "More" menu overlay ──────────────────────── */}
      {moreMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={() => setMoreMenuOpen(false)} />
      )}

      {/* ── Mobile "More" slide-up panel ────────────────────── */}
      <div
        ref={moreMenuRef}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-[70] transition-transform duration-300 ease-out ${
          moreMenuOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="rounded-t-2xl px-4 pt-3 overflow-hidden max-h-[70vh] overflow-y-auto"
          style={{ background: 'var(--color-bg-card)', borderTop: '1px solid var(--color-border-default)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
          {/* Panel header */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{t('adminNav.morePages')}</p>
            <button
              onClick={() => setMoreMenuOpen(false)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-subtle)' }}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
          {/* Grouped nav by section */}
          {filteredSections
            .map(section => ({
              ...section,
              items: section.items.filter(n => !MOBILE_PRIMARY_PATHS.includes(n.to)),
            }))
            .filter(section => section.items.length > 0)
            .map(section => (
              <div key={section.labelKey} className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-1"
                  style={{ color: 'var(--color-text-faint)' }}>{t(section.labelKey)}</p>
                <div className="grid grid-cols-4 gap-2">
                  {section.items.map(({ to, labelKey, icon: Icon, exact }) => (
                    <NavLink key={to} to={to} end={exact} onClick={() => setMoreMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex flex-col items-center gap-1 py-3 px-1 rounded-xl transition-colors ${
                          isActive ? '' : ''
                        }`
                      }
                      style={({ isActive }) => ({
                        color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        background: isActive ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'transparent',
                      })}>
                      <Icon size={22} strokeWidth={1.75} />
                      <span className="text-[10px] font-medium text-center leading-tight">{t(labelKey)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          {/* Advanced Tools subsection */}
          <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
            <button
              onClick={() => setAdvancedToolsOpen(prev => !prev)}
              className="w-full flex items-center gap-2 px-1 mb-1.5"
            >
              <Wrench size={12} style={{ color: 'var(--color-text-faint)' }} />
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-faint)' }}>{t('adminNav.advancedTools')}</p>
              <ChevronRight size={10} className={`ml-auto transition-transform ${advancedToolsOpen ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-faint)' }} />
            </button>
            {advancedToolsOpen && (
              <div className="grid grid-cols-4 gap-2">
                {advancedPages.map(({ to, labelKey, icon: Icon }) => (
                  <NavLink key={to} to={to} end={false} onClick={() => setMoreMenuOpen(false)}
                    className="flex flex-col items-center gap-1 py-3 px-1 rounded-xl transition-colors"
                    style={({ isActive }) => ({
                      color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      background: isActive ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'transparent',
                    })}>
                    <Icon size={22} strokeWidth={1.75} />
                    <span className="text-[10px] font-medium text-center leading-tight">{t(labelKey)}</span>
                  </NavLink>
                ))}
              </div>
            )}

            {/* Settings */}
            <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <NavLink to="/admin/settings" end={false} onClick={() => setMoreMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors"
                style={({ isActive }) => ({
                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  background: isActive ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'transparent',
                })}>
                <Settings size={20} strokeWidth={1.75} />
                <span className="text-[13px] font-medium">{t('adminNav.settings')}</span>
              </NavLink>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      <nav aria-label="Admin mobile navigation" className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'var(--color-bg-nav)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--color-border-default)',
        }}>
        {MOBILE_NAV.map(({ to, labelKey, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors"
            style={({ isActive }) => ({
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-subtle)',
            })}
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{t(labelKey)}</span>
          </NavLink>
        ))}
        {/* More button */}
        <button
          onClick={() => setMoreMenuOpen(prev => !prev)}
          className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors"
          style={{ color: moreMenuOpen || moreIsActive ? 'var(--color-accent)' : 'var(--color-text-subtle)' }}
          aria-label={t('adminNav.morePages')}
          aria-expanded={moreMenuOpen}
        >
          <MoreHorizontal size={20} />
          <span className="text-[10px] font-medium">{t('adminNav.more')}</span>
        </button>
      </nav>

      {/* Cmd-K global search palette (lazy — only the trigger ships eagerly) */}
      <Suspense fallback={null}>
        <GlobalSearch
          open={globalSearchOpen}
          onClose={() => setGlobalSearchOpen(false)}
          onToggle={() => setGlobalSearchOpen(o => !o)}
          pageIndex={pageIndex}
        />
      </Suspense>

    </div>
    </InsightsRangeProvider>
    </ScanClaimProvider>
  );
}
