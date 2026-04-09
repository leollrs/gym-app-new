import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { Home, Dumbbell, PlayCircle, BarChart2, Users, Bell, Trophy, Flame, X, Snowflake, CheckCircle2, MessageCircle, ChevronLeft, ChevronRight, QrCode, Gift, Apple, Settings, User, BookOpen, LogOut } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import UserAvatar from './UserAvatar';

// ── Prefetch map for lazy-loaded route chunks ────────────────────────────────
const PREFETCH_MAP = {
  '/record': () => import('../pages/QuickStart'),
  '/progress': () => import('../pages/Progress'),
  '/community': () => import('../pages/Community'),
  '/social': () => import('../pages/SocialFeed'),
  '/notifications': () => import('../pages/Notifications'),
  '/profile': () => import('../pages/Profile'),
  '/rewards': () => import('../pages/Rewards'),
  '/referrals': () => import('../pages/Referrals'),
  '/messages': () => import('../pages/Messages'),
  '/classes': () => import('../pages/Classes'),
};
const prefetched = new Set();
const prefetchRoute = (to) => {
  const loader = PREFETCH_MAP[to];
  if (loader && !prefetched.has(to)) {
    prefetched.add(to);
    loader();
  }
};

// ── Member nav schema (Strava-style) ──────────────────────────────────────────
// labels resolved via t() at render time
// Items with requiresConfig are conditionally shown based on gymConfig flags
const MEMBER_TABS = [
  { id: 'home', to: '/', icon: Home, labelKey: 'nav.home', end: true },
  { id: 'workouts', to: '/workouts', icon: Dumbbell, labelKey: 'nav.workouts' },
  { id: 'record', to: '/record', icon: PlayCircle, labelKey: 'nav.start', isPrimary: true },
  { id: 'progress', to: '/progress', icon: BarChart2, labelKey: 'nav.progress' },
  { id: 'community', to: '/community', icon: Users, labelKey: 'nav.community' },
];

// ── Sidebar nav sections for lg: desktop ──────────────────────────────────────
const SIDEBAR_SECTIONS = [
  {
    labelKey: 'nav.sidebarMain',
    defaultLabel: 'Main',
    items: [
      { id: 'home', to: '/', icon: Home, labelKey: 'nav.home', end: true },
      { id: 'workouts', to: '/workouts', icon: Dumbbell, labelKey: 'nav.workouts' },
      { id: 'exercises', to: '/exercises', icon: BookOpen, labelKey: 'nav.exercises', defaultLabel: 'Exercises' },
      { id: 'progress', to: '/progress', icon: BarChart2, labelKey: 'nav.progress' },
    ],
  },
  {
    labelKey: 'nav.sidebarSocial',
    defaultLabel: 'Social',
    items: [
      { id: 'community', to: '/community', icon: Users, labelKey: 'nav.community' },
      { id: 'messages', to: '/messages', icon: MessageCircle, labelKey: 'nav.messages', defaultLabel: 'Messages' },
    ],
  },
  {
    labelKey: 'nav.sidebarYou',
    defaultLabel: 'You',
    items: [
      { id: 'rewards', to: '/rewards', icon: Trophy, labelKey: 'nav.rewards', defaultLabel: 'Rewards' },
      { id: 'checkin', to: '/checkin', icon: QrCode, labelKey: 'nav.checkIn', defaultLabel: 'Check In' },
      { id: 'nutrition', to: '/progress?tab=nutrition', icon: Apple, labelKey: 'nav.nutrition', defaultLabel: 'Nutrition' },
      { id: 'profile', to: '/profile', icon: User, labelKey: 'nav.profile', defaultLabel: 'Profile' },
    ],
  },
];

const Navigation = () => {
  const { gymName, gymLogoUrl, user, profile, unreadNotifications, gymConfig } = useAuth();

  // Filter tabs based on gymConfig feature flags
  const activeTabs = MEMBER_TABS.filter(tab => {
    if (!tab.requiresConfig) return true;
    return !!gymConfig?.[tab.requiresConfig];
  });
  const desktopTabs = activeTabs.filter(tab => tab.id !== 'record');
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [streak, setStreak] = useState(0);
  const [streakData, setStreakData] = useState(null);
  const [showStreakModal, setShowStreakModal] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Scroll locking for streak modal
  useEffect(() => {
    if (showStreakModal) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showStreakModal]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('streak_cache')
      .select('current_streak_days, longest_streak_days, last_activity_date, streak_broken_at, streak_freeze_used, streak_freeze_reset_at')
      .eq('profile_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setStreak(data?.current_streak_days || 0);
        setStreakData(data);
      })
      .catch(() => {});
  }, [user?.id, location.pathname]);

  // Fetch unread DM count
  useEffect(() => {
    if (!user?.id) return;
    const fetchUnread = async () => {
      // Get conversation IDs the user is part of
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`);
      if (!convs || convs.length === 0) { setUnreadMessages(0); return; }
      const convIds = convs.map(c => c.id);
      const { count } = await supabase
        .from('direct_messages')
        .select('*', { count: 'exact', head: true })
        .neq('sender_id', user.id)
        .is('read_at', null)
        .in('conversation_id', convIds);
      setUnreadMessages(count || 0);
    };
    fetchUnread();

    // Realtime subscription for new DMs (debounced to prevent excessive refetches)
    // Note: direct_messages has no receiver_id column, so we can't filter by
    // receiver at the channel level. RLS already restricts events to the user's
    // conversations. We narrow to INSERT events only (new messages) since the
    // unread count is also re-fetched on every route change via location.pathname.
    let debounceTimer;
    const channel = supabase
      .channel('nav-dm-unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchUnread(), 2000);
      })
      .subscribe();
    return () => { clearTimeout(debounceTimer); supabase.removeChannel(channel); };
  }, [user?.id, location.pathname]);

  const [streakMonths, setStreakMonths] = useState([]);
  const [freezeStatus, setFreezeStatus] = useState(null); // { used, max }
  const [viewedMonthIndex, setViewedMonthIndex] = useState(0); // 0 = current month

  const loadStreakDays = useCallback(async () => {
    if (!user?.id) return;

    const [sessionsRes, profileRes, gymHoursRes, closuresRes, holidaysRes, freezesRes] = await Promise.all([
      supabase.from('workout_sessions')
        .select('completed_at')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false }),
      supabase.from('profiles').select('preferred_training_days, created_at').eq('id', user.id).maybeSingle(),
      profile?.gym_id ? supabase.from('gym_hours').select('day_of_week, is_closed').eq('gym_id', profile.gym_id) : Promise.resolve({ data: [] }),
      profile?.gym_id ? supabase.from('gym_closures').select('closure_date').eq('gym_id', profile.gym_id) : Promise.resolve({ data: [] }),
      profile?.gym_id ? supabase.from('gym_holidays').select('date, is_closed').eq('gym_id', profile.gym_id) : Promise.resolve({ data: [] }),
      supabase.from('streak_freezes').select('month, used_count, max_allowed, frozen_dates').eq('profile_id', user.id),
    ]);

    // Helper: date → 'YYYY-MM-DD'
    const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    // Set of all dates with a completed workout
    const workoutDates = new Set(
      (sessionsRes.data || []).map(s => toKey(new Date(s.completed_at)))
    );

    // Account creation date — nothing before this counts
    const createdAt = profileRes.data?.created_at ? new Date(profileRes.data.created_at) : new Date();
    const createdAtKey = toKey(createdAt);

    // Rest days: days the user is NOT scheduled to train
    const DAY_MAP = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const prefDays = profileRes.data?.preferred_training_days || [];
    const restDowSet = new Set(
      prefDays.length > 0 ? [0,1,2,3,4,5,6].filter(d => !prefDays.some(name => DAY_MAP[name] === d)) : []
    );

    // Gym closed days (recurring day-of-week)
    const gymClosedSet = new Set(
      (gymHoursRes.data || []).filter(h => h.is_closed).map(h => h.day_of_week)
    );

    // Specific closure dates (gym_closures + gym_holidays)
    const closureDateSet = new Set([
      ...(closuresRes.data || []).map(c => c.closure_date),
      ...(holidaysRes.data || []).filter(h => h.is_closed).map(h => h.date),
    ]);

    // Frozen dates from DB (keyed by date string)
    const frozenDateSet = new Set();
    const freezesByMonth = {};
    for (const f of (freezesRes.data || [])) {
      freezesByMonth[f.month] = f;
      for (const d of (f.frozen_dates || [])) {
        frozenDateSet.add(typeof d === 'string' ? d : toKey(new Date(d)));
      }
    }

    const today = new Date();
    const todayKey = toKey(today);

    // ── CALENDAR GENERATION ────────────────────────────────────
    // Streak count comes from streak_cache (already in `streak` state).
    // Calendar only determines visual status per day.
    // Show ALL days in each month (including future days, styled differently).
    const startDate = new Date(createdAt.getFullYear(), createdAt.getMonth(), 1);
    const months = [];
    let cursor = new Date(today.getFullYear(), today.getMonth(), 1);

    while (cursor >= startDate) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthDays = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const key = toKey(d);
        const dow = d.getDay();
        const isToday = key === todayKey;
        const isFuture = d > today;
        const hasWorkout = workoutDates.has(key);
        const beforeAccount = key < createdAtKey;
        const isFrozen = frozenDateSet.has(key);
        const isClosureDate = closureDateSet.has(key);

        let status;
        if (isFuture) {
          status = 'future';
        } else if (beforeAccount) {
          status = 'before-account';
        } else if (isToday && !hasWorkout) {
          status = 'today';
        } else if (hasWorkout) {
          status = 'done';
        } else if (isFrozen) {
          status = 'frozen';
        } else if (isClosureDate || gymClosedSet.has(dow)) {
          status = 'rest';
        } else if (prefDays.length > 0 && restDowSet.has(dow)) {
          status = 'rest';
        } else {
          status = 'missed';
        }

        monthDays.push({ date: d, key, dow, status, isToday });
      }

      const label = cursor.toLocaleDateString(i18n.language === 'es' ? 'es-ES' : 'en-US', { month: 'long', year: 'numeric' });
      const isCurrent = year === today.getFullYear() && month === today.getMonth();
      months.push({ label, days: monthDays, year, month, isCurrent });
      cursor = new Date(year, month - 1, 1);
    }

    // Set freeze status for current month
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
    const currentFreeze = freezesByMonth[currentMonthKey];
    setFreezeStatus({
      used: currentFreeze?.used_count || 0,
      max: currentFreeze?.max_allowed || 2,
    });

    setStreakMonths(months);
    setViewedMonthIndex(0); // Reset to current month when data loads
  }, [user?.id, profile?.gym_id, streakData, i18n.language]);

  const isRecordActive =
    location.pathname.startsWith('/record') ||
    location.pathname.startsWith('/session/');

  return (
  <>
    {/* ── Desktop Sidebar (lg: and above) ───────────────────────────── */}
    <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-[240px] z-50 border-r overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-subtle)' }}>
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <Link to="/my-gym" className="flex items-center gap-2.5 min-w-0 no-underline">
          {gymLogoUrl && (
            <img
              src={gymLogoUrl}
              alt={gymName || 'Gym logo'}
              className="h-8 w-8 rounded-xl object-contain border border-white/10 bg-black/10 flex-shrink-0"
            />
          )}
          <div
            className="text-[19px] font-black tracking-tight truncate"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}
          >
            {gymName || 'GymApp'}
          </div>
        </Link>
      </div>

      {/* Record / Start CTA */}
      <div className="px-4 mb-4">
        <button
          type="button"
          onClick={() => navigate('/record')}
          onMouseEnter={() => prefetchRoute('/record')}
          aria-label={t('nav.start')}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#D4AF37] text-black text-[13px] font-bold shadow-sm hover:bg-[#f2d36b] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        >
          <PlayCircle size={16} className="flex-shrink-0" />
          {t('nav.start')}
        </button>
      </div>

      {/* Nav sections */}
      <nav aria-label="Sidebar navigation" className="flex-1 px-3 pb-3 overflow-y-auto">
        {SIDEBAR_SECTIONS.map((section, idx) => (
          <div key={section.labelKey} className={idx > 0 ? 'mt-5' : ''}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--color-text-subtle)' }}>
              {t(section.labelKey, { defaultValue: section.defaultLabel })}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ id: itemId, to, icon: Icon, labelKey, defaultLabel, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  aria-label={t(labelKey, { defaultValue: defaultLabel })}
                  onMouseEnter={() => prefetchRoute(to)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                      isActive
                        ? 'bg-[#D4AF37]/10 text-[#D4AF37] font-semibold'
                        : 'hover:bg-white/[0.04]'
                    }`
                  }
                  style={({ isActive }) => isActive ? undefined : { color: 'var(--color-text-muted)' }}
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                      <span className="flex-1">{t(labelKey, { defaultValue: defaultLabel })}</span>
                      {itemId === 'messages' && unreadMessages > 0 && (
                        <span className="min-w-[18px] h-[18px] rounded-full bg-[#D4AF37] text-black text-[10px] font-bold flex items-center justify-center">
                          {unreadMessages > 9 ? '9+' : unreadMessages}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 pb-4 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <NavLink
          to="/notifications"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              isActive ? 'bg-[#D4AF37]/10 text-[#D4AF37] font-semibold' : 'hover:bg-white/[0.04]'
            }`
          }
          style={({ isActive }) => isActive ? undefined : { color: 'var(--color-text-muted)' }}
        >
          <Bell size={16} />
          <span className="flex-1">{t('nav.notifications', { defaultValue: 'Notifications' })}</span>
          {unreadNotifications > 0 && (
            <span className="min-w-[18px] h-[18px] rounded-full bg-[#D4AF37] text-black text-[10px] font-bold flex items-center justify-center">
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              isActive ? 'bg-[#D4AF37]/10 text-[#D4AF37] font-semibold' : 'hover:bg-white/[0.04]'
            }`
          }
          style={({ isActive }) => isActive ? undefined : { color: 'var(--color-text-muted)' }}
        >
          <Settings size={16} />
          <span>{t('nav.settings', { defaultValue: 'Settings' })}</span>
        </NavLink>
        {/* Profile */}
        <button
          onClick={() => navigate('/profile')}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors mt-1"
        >
          <UserAvatar user={profile} size={28} />
          <span className="flex-1 text-left text-[13px] font-medium truncate" style={{ color: 'var(--color-text-muted)' }}>
            {profile?.full_name || 'Profile'}
          </span>
        </button>
      </div>
    </aside>

    {/* ── Desktop Top Navigation (md: only, hidden on lg: where sidebar shows) ── */}
    <nav aria-label="Main navigation" className="hidden md:block lg:hidden sticky top-0 z-50 border-b border-white/6 backdrop-blur-2xl" style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)' }}>
      <div className="container flex justify-between items-center py-3.5">

        {/* Brand */}
        <Link to="/my-gym" className="flex items-center gap-2.5 min-w-0 no-underline">
          {gymLogoUrl && (
            <img
              src={gymLogoUrl}
              alt={gymName || 'Gym logo'}
              className="h-8 w-8 rounded-xl object-contain border border-white/10 bg-black/10 flex-shrink-0"
            />
          )}
          <div
            className="text-[21px] font-black tracking-tight text-gradient truncate"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            {gymName || 'GymApp'}
          </div>
        </Link>

        {/* Links (Home / Workouts / Social / You, with prominent Start) + right actions */}
        <div className="flex items-center gap-3">
          {desktopTabs.map(({ id, to, icon: Icon, labelKey, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={t(labelKey)}
              onMouseEnter={() => prefetchRoute(to)}
              onTouchStart={() => prefetchRoute(to)}
              style={{ '--nav-inactive': 'var(--color-text-subtle)', '--nav-hover': 'var(--color-text-primary)' }}
              className={({ isActive }) =>
                `relative flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-lg transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                  isActive
                    ? 'text-[#D4AF37]'
                    : '[color:var(--nav-inactive)] hover:[color:var(--nav-hover)] hover:bg-white/4'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
                  {t(labelKey)}
                  {isActive && (
                    <span className="absolute bottom-0 left-3 right-3 h-px bg-[#D4AF37] rounded-full opacity-70" />
                  )}
                </>
              )}
            </NavLink>
          ))}
          {/* Desktop Record button */}
          <button
            type="button"
            onClick={() => navigate('/record')}
            onMouseEnter={() => prefetchRoute('/record')}
            onTouchStart={() => prefetchRoute('/record')}
            aria-label={t('nav.start')}
            className="ml-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#D4AF37] text-black text-[13px] font-semibold shadow-sm hover:bg-[#f2d36b] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <PlayCircle size={16} className="flex-shrink-0" />
            {t('nav.start')}
          </button>

          {/* Desktop messages + notifications + profile */}
          <div className="flex items-center gap-2 ml-2">
            <button
              type="button"
              onClick={() => navigate('/messages')}
              className="relative w-11 h-11 rounded-full bg-white/5 flex items-center justify-center hover:text-[#D4AF37] active:scale-95 transition-transform transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Messages"
            >
              <MessageCircle size={16} />
              {unreadMessages > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-[#D4AF37] text-black text-[10px] font-bold flex items-center justify-center">
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate('/notifications')}
              className="relative w-11 h-11 rounded-full bg-white/5 flex items-center justify-center hover:text-[#D4AF37] active:scale-95 transition-transform transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Notifications"
            >
              <Bell size={16} />
              {unreadNotifications > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-[#D4AF37] text-black text-[10px] font-bold flex items-center justify-center">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>
            <button
              onClick={() => navigate('/profile')}
              className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform overflow-hidden focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              aria-label="Profile"
            >
              <UserAvatar user={profile} size={44} />
            </button>
          </div>
        </div>
      </div>
    </nav>

    {/* ── Mobile Top Header ───────────────────────────────────────── */}
    <header
      className="md:hidden fixed top-0 left-0 right-0 z-50 backdrop-blur-2xl border-b border-white/6 px-4 flex items-center justify-between"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)', paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))', height: 'calc(52px + var(--safe-area-top, env(safe-area-inset-top)))', transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {/* Brand on the left */}
      <Link to="/my-gym" className="flex items-center gap-2.5 min-w-0 no-underline">
        {gymLogoUrl && (
          <img
            src={gymLogoUrl}
            alt={gymName || 'Gym logo'}
            className="h-8 w-8 rounded-lg object-contain border border-white/10 bg-white/5 flex-shrink-0"
          />
        )}
        <span
          className="text-[22px] font-black tracking-tight truncate"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}
        >
          {gymName || 'GymApp'}
        </span>
      </Link>

      {/* Streak + Rewards + Notifications + Profile on the right */}
      <div className="flex items-center gap-2">
        {/* Streak badge */}
        <button
          type="button"
          onClick={() => { loadStreakDays(); setShowStreakModal(true); }}
          aria-label="View streak"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full shrink-0 active:scale-95 transition-transform min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
          streak > 0
            ? 'bg-orange-500/15 border border-orange-500/25'
            : 'bg-white/[0.04] border border-white/[0.06]'
        }`}>
          <Flame size={14} className={streak > 0 ? 'text-orange-400' : ''} style={streak > 0 ? undefined : { color: 'var(--color-text-subtle)' }} />
          <span className={`text-[14px] font-black ${streak > 0 ? 'text-orange-400' : ''}`} style={streak > 0 ? undefined : { color: 'var(--color-text-subtle)' }}>
            {streak}
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/rewards')}
          onTouchStart={() => prefetchRoute('/rewards')}
          className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center hover:text-[#D4AF37] active:scale-95 transition-transform transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-primary)' }}
          aria-label="Rewards"
        >
          <Trophy size={16} />
        </button>
        {/* Messages moved to Community tab */}
        <button
          type="button"
          onClick={() => navigate('/notifications')}
          onTouchStart={() => prefetchRoute('/notifications')}
          className="relative w-11 h-11 rounded-full bg-white/10 flex items-center justify-center hover:text-[#D4AF37] active:scale-95 transition-transform transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-primary)' }}
          aria-label="Notifications"
        >
          <Bell size={16} />
          {unreadNotifications > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-[#D4AF37] text-black text-[10px] font-bold flex items-center justify-center">
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </button>
        <button
          onClick={() => navigate('/profile')}
          className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform overflow-hidden focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          aria-label="Profile"
        >
          <UserAvatar user={profile} size={44} />
        </button>
      </div>
    </header>

    {/* ── Mobile Bottom Navigation (Strava-style 5 tabs with center Record) ─── */}
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-2xl border-t border-white/6 flex items-end justify-around px-2"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 95%, transparent)',
        paddingBottom: 'calc(0.25rem + var(--safe-area-bottom, env(safe-area-inset-bottom)))',
        paddingTop: '0.35rem',
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)',
      }}
    >
      {activeTabs.map(({ id, to, icon: Icon, labelKey, end, isPrimary }) => {
        if (isPrimary) {
          return (
            <button
              key={id}
              type="button"
              data-tour="tour-nav-record"
              onClick={() => navigate('/record')}
              onTouchStart={() => prefetchRoute('/record')}
              className="flex flex-col items-center justify-end min-w-[64px]"
              style={{ paddingBottom: '2px' }}
              aria-label={t(labelKey)}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform -mt-5"
                style={{
                  backgroundColor: 'var(--color-secondary, #8B5CF6)',
                  boxShadow: isRecordActive
                    ? '0 10px 15px -3px color-mix(in srgb, var(--color-secondary, #8B5CF6) 40%, transparent)'
                    : '0 10px 15px -3px color-mix(in srgb, var(--color-secondary, #8B5CF6) 30%, transparent)',
                }}
              >
                <PlayCircle size={24} className="text-white" strokeWidth={2.5} />
              </div>
              <span
                className="text-[10px] font-semibold mt-1 tracking-wide"
                style={{ color: isRecordActive ? 'var(--color-secondary, #8B5CF6)' : 'var(--color-text-muted)' }}
              >
                {t(labelKey)}
              </span>
            </button>
          );
        }

        return (
          <NavLink
            key={id}
            to={to}
            end={end}
            data-tour={`tour-nav-${id}`}
            aria-label={t(labelKey)}
            onTouchStart={() => prefetchRoute(to)}
            onClick={() => { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; setTimeout(() => { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; }, 100); }}
            style={{ '--tab-active-color': 'var(--color-accent, #FF8A00)' }}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[52px] min-h-[44px] justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                isActive
                  ? '[color:var(--tab-active-color)]'
                  : '[color:var(--color-text-subtle)] hover:[color:var(--color-text-muted)]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={21} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-semibold tracking-wide">{t(labelKey)}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  {/* Streak Detail Modal */}
  {showStreakModal && createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" role="button" tabIndex={-1} aria-label="Close streak details" onClick={() => setShowStreakModal(false)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowStreakModal(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="streak-modal-title" className="rounded-[20px] w-full max-w-sm border overflow-hidden flex flex-col" style={{ maxHeight: '85vh', background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
        {/* Header (fixed) */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${streak > 0 ? 'bg-orange-500/15' : 'bg-white/[0.04]'}`}>
              <Flame size={20} className={streak > 0 ? 'text-orange-400' : ''} style={streak > 0 ? undefined : { color: 'var(--color-text-subtle)' }} />
            </div>
            <div>
              <p id="streak-modal-title" className="text-[18px] font-bold truncate" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-primary)' }}>{t('navigation.streaks.dayStreak', { ns: 'pages', count: streak })}</p>
              <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{t('navigation.streaks.longest', { ns: 'pages', count: streakData?.longest_streak_days || streak })}</p>
            </div>
          </div>
          <button onClick={() => setShowStreakModal(false)} aria-label={t('nav.close', { ns: 'common', defaultValue: 'Close' })} className="w-11 h-11 rounded-lg bg-white/[0.04] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ color: 'var(--color-text-subtle)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Freeze status */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${freezeStatus?.used >= freezeStatus?.max ? 'bg-blue-500/10' : 'bg-white/[0.04]'}`}>
            <Snowflake size={14} className={freezeStatus?.used > 0 ? 'text-blue-400' : ''} style={freezeStatus?.used > 0 ? undefined : { color: 'var(--color-text-subtle)' }} />
            <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {freezeStatus?.used >= freezeStatus?.max
                ? t('navigation.streaks.monthlyFreezeUsed', { ns: 'pages' })
                : t('navigation.streaks.freezeAvailable', { ns: 'pages', count: (freezeStatus?.max || 2) - (freezeStatus?.used || 0) })}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-3 flex-shrink-0">
          {[
            { color: 'bg-[#10B981]', label: t('navigation.legend.trained', { ns: 'pages' }) },
            { color: 'bg-[#6B7280]', label: t('navigation.legend.restDay', { ns: 'pages' }) },
            { color: 'bg-red-500', label: t('navigation.legend.missed', { ns: 'pages' }) },
            { color: 'bg-blue-400', label: t('navigation.legend.frozen', { ns: 'pages' }) },
            { color: 'bg-[#D4AF37]', label: t('navigation.legend.today', { ns: 'pages', defaultValue: 'Today' }) },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-[9px]" style={{ color: 'var(--color-text-subtle)' }}>
              <span className={`w-2 h-2 rounded-sm ${color}`} />
              {label}
            </span>
          ))}
        </div>

        {/* Single-month calendar with navigation */}
        <div className="px-5 pb-5">
          {streakMonths.length > 0 && (() => {
            const monthData = streakMonths[viewedMonthIndex] || streakMonths[0];
            const firstDayDow = monthData.days.length > 0 ? monthData.days[0].dow : 0;
            const padCount = firstDayDow;
            const canGoBack = viewedMonthIndex < streakMonths.length - 1;
            const canGoForward = viewedMonthIndex > 0;

            return (
              <div>
                {/* Month navigation header */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    type="button"
                    onClick={() => canGoBack && setViewedMonthIndex(i => i + 1)}
                    disabled={!canGoBack}
                    aria-label={t('navigation.streaks.prevMonth', { ns: 'pages', defaultValue: 'Previous month' })}
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none disabled:opacity-20"
                    style={{ color: 'var(--color-text-muted)', background: canGoBack ? 'rgba(255,255,255,0.04)' : 'transparent' }}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <p className="text-[14px] font-bold capitalize" style={{ color: 'var(--color-text-primary)' }}>
                    {monthData.label}
                  </p>
                  <button
                    type="button"
                    onClick={() => canGoForward && setViewedMonthIndex(i => i - 1)}
                    disabled={!canGoForward}
                    aria-label={t('navigation.streaks.nextMonth', { ns: 'pages', defaultValue: 'Next month' })}
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none disabled:opacity-20"
                    style={{ color: 'var(--color-text-muted)', background: canGoForward ? 'rgba(255,255,255,0.04)' : 'transparent' }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                {/* Day-of-week labels */}
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {(t('days.initials', { returnObjects: true }) || ['S','M','T','W','T','F','S']).map((d, i) => (
                    <div key={i} className="text-center text-[8px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{d}</div>
                  ))}
                </div>
                {/* Day cells */}
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: padCount }, (_, i) => <div key={`pad-${i}`} />)}
                  {monthData.days.map(day => {
                    const dayNum = day.date.getDate();
                    let bg = 'bg-white/[0.04]';
                    let colorStyle = 'var(--color-text-muted)';
                    let ring = '';
                    let opacity = '';

                    if (day.status === 'future') { bg = 'bg-white/[0.06]'; colorStyle = 'var(--color-text-subtle)'; opacity = 'opacity-60'; }
                    else if (day.status === 'before-account') { bg = 'bg-white/[0.03]'; colorStyle = 'var(--color-text-subtle)'; opacity = 'opacity-30'; }
                    else if (day.status === 'done') { bg = 'bg-[#10B981]'; colorStyle = '#fff'; }
                    else if (day.status === 'rest') { bg = 'bg-[#6B7280]/20'; colorStyle = 'var(--color-text-subtle)'; }
                    else if (day.status === 'broken') { bg = 'bg-red-500/20'; colorStyle = 'rgb(248 113 113)'; ring = 'ring-1 ring-red-500/40'; }
                    else if (day.status === 'frozen') { bg = 'bg-blue-400/20'; colorStyle = 'rgb(96 165 250)'; }
                    else if (day.status === 'today') { bg = 'bg-[#D4AF37]/15'; colorStyle = '#D4AF37'; ring = 'ring-2 ring-[#D4AF37]/50'; }
                    else if (day.status === 'missed') { bg = 'bg-red-500/10'; colorStyle = 'rgb(248 113 113 / 0.6)'; }

                    return (
                      <div key={day.key} className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-bold ${bg} ${ring} ${opacity}`} style={{ fontVariantNumeric: 'tabular-nums', color: colorStyle }}>
                        {dayNum}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Broken at info */}
        {streakData?.streak_broken_at && (
          <div className="px-5 pb-4 flex-shrink-0">
            <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('navigation.streaks.lastBroken', { ns: 'pages' })}: {new Date(streakData.streak_broken_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  )}
  </>
  );
};

export default Navigation;
