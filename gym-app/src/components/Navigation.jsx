import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { Home, Dumbbell, PlayCircle, BarChart2, Users, Bell, Trophy, Flame, X, Snowflake, CheckCircle2, MessageCircle, ChevronLeft, ChevronRight, QrCode, Gift, Apple, Settings, User, BookOpen, LogOut, Shield, Calendar as CalendarIcon, Share2 as ShareIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { selectInBatches } from '../lib/churn/batchedSelect';
import UserAvatar from './UserAvatar';
import { useCachedState } from '../hooks/useCachedState';
import { ShareStreakSheet } from './share/QuickShareSheets';

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
  const [streakRaw, setStreakRaw] = useState(0);
  const [streakData, setStreakData] = useState(null);
  const [streakDerived, setStreakDerived] = useState(null); // null = no override yet
  const [longestDerived, setLongestDerived] = useState(null);
  // Prefer calendar-derived value when available; fall back to raw cache.
  const streak = streakDerived !== null ? streakDerived : streakRaw;
  const setStreak = setStreakRaw; // so existing setters still feed the raw value
  const [showStreakModal, setShowStreakModal] = useState(false);
  const [shareStreakOpen, setShareStreakOpen] = useState(false);
  const streakOpenedAtRef = useRef(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Scroll locking for streak modal
  useEffect(() => {
    if (showStreakModal) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showStreakModal]);

  // Defensive: clear any stuck body scroll lock on route change
  useEffect(() => { document.body.style.overflow = ''; }, [location.pathname]);

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

  // Fetch unread DM count — re-runs on every route change and on user change
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
      const { data: unreadRows } = await selectInBatches(
        (ids) => supabase
          .from('direct_messages')
          .select('id')
          .neq('sender_id', user.id)
          .is('read_at', null)
          .in('conversation_id', ids),
        convIds
      );
      setUnreadMessages(unreadRows ? unreadRows.length : 0);
    };
    fetchUnread();
  }, [user?.id, location.pathname]);

  // Realtime subscription for new DMs — subscribed once per user, not per route change.
  // Note: direct_messages has no receiver_id column, so we can't filter by
  // receiver at the channel level. RLS already restricts events to the user's
  // conversations. We narrow to INSERT events only (new messages) since the
  // unread count is also re-fetched on every route change via location.pathname.
  useEffect(() => {
    if (!user?.id) return;
    let debounceTimer;
    const fetchUnread = async () => {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`);
      if (!convs || convs.length === 0) { setUnreadMessages(0); return; }
      const convIds = convs.map(c => c.id);
      const { data: unreadRows } = await selectInBatches(
        (ids) => supabase
          .from('direct_messages')
          .select('id')
          .neq('sender_id', user.id)
          .is('read_at', null)
          .in('conversation_id', ids),
        convIds
      );
      setUnreadMessages(unreadRows ? unreadRows.length : 0);
    };
    const channel = supabase
      .channel('nav-dm-unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchUnread(), 2000);
      })
      .subscribe();
    return () => { clearTimeout(debounceTimer); supabase.removeChannel(channel); };
  }, [user?.id]);

  const streakCalCacheKey = `streak-calendar-${user?.id || 'anon'}`;
  const streakFreezeCacheKey = `streak-freeze-${user?.id || 'anon'}`;
  const [streakMonths, setStreakMonths] = useCachedState(streakCalCacheKey, []);
  const [freezeStatus, setFreezeStatus] = useCachedState(streakFreezeCacheKey, null);
  const [viewedMonthIndex, setViewedMonthIndex] = useState(0); // 0 = current month

  const loadStreakDays = useCallback(async () => {
    if (!user?.id) return;

    const [sessionsRes, cardioRes, profileRes, gymHoursRes, closuresRes, holidaysRes, freezesRes] = await Promise.all([
      supabase.from('workout_sessions')
        .select('completed_at')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false }),
      // Cardio is training too — count cardio_sessions toward the calendar
      // streak so a run on Tuesday doesn't read as a missed day.
      supabase.from('cardio_sessions')
        .select('completed_at, started_at')
        .eq('profile_id', user.id),
      supabase.from('profiles').select('preferred_training_days, created_at').eq('id', user.id).maybeSingle(),
      profile?.gym_id ? supabase.from('gym_hours').select('day_of_week, is_closed').eq('gym_id', profile.gym_id) : Promise.resolve({ data: [] }),
      profile?.gym_id ? supabase.from('gym_closures').select('closure_date').eq('gym_id', profile.gym_id) : Promise.resolve({ data: [] }),
      profile?.gym_id ? supabase.from('gym_holidays').select('date, is_closed').eq('gym_id', profile.gym_id) : Promise.resolve({ data: [] }),
      supabase.from('streak_freezes').select('month, used_count, max_allowed, frozen_dates').eq('profile_id', user.id),
    ]);

    // Helper: date → 'YYYY-MM-DD'
    const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    // Set of all dates with a completed workout OR cardio session
    const workoutDates = new Set(
      (sessionsRes.data || []).map(s => toKey(new Date(s.completed_at)))
    );
    for (const c of (cardioRes.data || [])) {
      const ts = c.completed_at || c.started_at;
      if (ts) workoutDates.add(toKey(new Date(ts)));
    }
    // Sorted ascending — used by the "fallback rest window" logic below to
    // find the nearest training day for any given gap day.
    const sortedWorkoutKeys = [...workoutDates].sort();

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
        } else if (prefDays.length === 0) {
          // Fallback when the user hasn't set preferred_training_days:
          // mirror the server-side _streak_gap_day_protected logic — if the
          // gap is within 7 days of a real training day (in either
          // direction), treat as a rest day. Otherwise it's a real miss.
          // This matches migration 0352's semantics.
          const gapMs = 7 * 24 * 60 * 60 * 1000;
          const dayMs = d.getTime();
          let nearestKey = null;
          let nearestDiff = Infinity;
          for (let i = 0; i < sortedWorkoutKeys.length; i += 1) {
            const wk = sortedWorkoutKeys[i];
            const wkDate = new Date(wk + 'T00:00:00');
            const diff = Math.abs(dayMs - wkDate.getTime());
            if (diff < nearestDiff) {
              nearestDiff = diff;
              nearestKey = wk;
            }
            if (wkDate.getTime() > dayMs && diff > gapMs) break; // sorted, can stop
          }
          status = nearestKey && nearestDiff <= gapMs ? 'rest' : 'missed';
        } else {
          status = 'missed';
        }

        // Persist `dayNum` (1-31) only. useCachedState round-trips this
        // payload through JSON, which would silently downgrade a Date
        // object to an ISO string and crash any consumer that called
        // `day.date.getDate()`. We dropped the `date` field entirely — if
        // a future consumer needs the full Date, derive it from
        // `new Date(day.key + 'T00:00:00')` at the call site.
        monthDays.push({ dayNum: day, key, dow, status, isToday });
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
      max: currentFreeze?.max_allowed || 1,
    });

    setStreakMonths(months);
    setViewedMonthIndex(0); // Reset to current month when data loads

    // ── DERIVE STREAK FROM CALENDAR ────────────────────────────
    // streak_cache.current_streak_days can drift from reality (backend cron
    // edge cases, deleted sessions, stale data). The calendar is the source
    // of truth — compute the current streak by walking back from today.
    //
    // RULE (per product spec): every day counts toward the streak — trained,
    // rest, frozen, and gym-closed days all add +1. Today (no workout yet)
    // is not counted but doesn't break. The streak ends only at a `missed`
    // day or when we reach the account creation date. The chain must contain
    // at least one trained day.
    {
      const STATUS_BY_KEY = new Map();
      for (const m of months) for (const d of m.days) STATUS_BY_KEY.set(d.key, d.status);
      let derived = 0;
      let sawDone = false;
      let walk = new Date(today);
      // Safety cap: don't walk further than user creation or 1000 days.
      for (let i = 0; i < 1000; i++) {
        const k = toKey(walk);
        if (k < createdAtKey) break;
        const s = STATUS_BY_KEY.get(k);
        if (s === 'missed') break;
        if (s === 'done') { derived += 1; sawDone = true; }
        else if (s === 'today') { /* today, no workout yet — neither count nor break */ }
        else if (s === 'rest' || s === 'frozen') { derived += 1; }
        else if (s === 'future' || s === 'before-account' || !s) { /* skip */ }
        walk.setDate(walk.getDate() - 1);
      }
      const finalStreak = sawDone ? derived : 0;
      setStreakDerived((prev) => (prev === finalStreak ? prev : finalStreak));
    }

    // ── DERIVE LONGEST STREAK FROM CALENDAR ────────────────────
    try {
      const allDays = (months || []).slice().reverse().flatMap((m) => (m && m.days) || []);
      let maxRun = 0;
      let curRun = 0;
      let sawDoneInRun = false;
      const commit = () => {
        if (sawDoneInRun && curRun > maxRun) maxRun = curRun;
        curRun = 0;
        sawDoneInRun = false;
      };
      for (const d of allDays) {
        const s = d && d.status;
        if (s === 'missed') { commit(); }
        else if (s === 'done') { curRun += 1; sawDoneInRun = true; }
        else if (s === 'rest' || s === 'frozen') { curRun += 1; }
      }
      commit();
      setLongestDerived((prev) => (prev === maxRun ? prev : maxRun));
    } catch (err) {
      console.error('[streak] longest derivation failed', err);
    }
  }, [user?.id, profile?.gym_id, streakData, i18n.language]);

  // Listen for external requests to open the streak modal (e.g. from CheckIn page)
  useEffect(() => {
    const handler = () => { streakOpenedAtRef.current = Date.now(); loadStreakDays(); setShowStreakModal(true); };
    window.addEventListener('tugympr:open-streak-modal', handler);
    return () => window.removeEventListener('tugympr:open-streak-modal', handler);
  }, [loadStreakDays]);

  // Prewarm the streak calendar data as soon as the user + streakData are known,
  // so the modal has everything ready instead of waiting on 6 Supabase queries
  // after the user taps the flame pill.
  useEffect(() => {
    if (user?.id && streakData !== null) { loadStreakDays(); }
  }, [user?.id, streakData, loadStreakDays]);

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
      <nav aria-label={t('navigation.sidebarNavigation', { ns: 'pages', defaultValue: 'Sidebar navigation' })} className="flex-1 px-3 pb-3 overflow-y-auto">
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
    <nav aria-label={t('navigation.mainNavigation', { ns: 'pages', defaultValue: 'Main navigation' })} className="hidden md:block lg:hidden sticky top-0 z-50 border-b border-white/6 backdrop-blur-2xl" style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)' }}>
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
              aria-label={t('nav.messages', { defaultValue: 'Messages' })}
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
              aria-label={t('nav.notifications', { defaultValue: 'Notifications' })}
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
              aria-label={t('nav.profile', { defaultValue: 'Profile' })}
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
          onClick={() => { streakOpenedAtRef.current = Date.now(); loadStreakDays(); setShowStreakModal(true); }}
          aria-label={t('navigation.viewStreak', { ns: 'pages', defaultValue: 'View streak' })}
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
          aria-label={t('nav.rewards', { defaultValue: 'Rewards' })}
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
      aria-label={t('navigation.mobileNavigation', { ns: 'pages', defaultValue: 'Mobile navigation' })}
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-2xl border-t border-white/6 flex items-end justify-around px-2"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 95%, transparent)',
        paddingBottom: 'calc(0.75rem + var(--safe-area-bottom, env(safe-area-inset-bottom)))',
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
  {/* Streak Detail Modal — Liquid Glass / iOS 26 redesign */}
  {showStreakModal && createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-3 sm:px-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)' }}
      role="button" tabIndex={-1} aria-label={t('navigation.closeStreakDetails', { ns: 'pages', defaultValue: 'Close streak details' })}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (Date.now() - streakOpenedAtRef.current < 400) return;
        setShowStreakModal(false);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowStreakModal(false); }}
    >
      <div
        role="dialog" aria-modal="true" aria-labelledby="streak-modal-title"
        className="relative rounded-[28px] w-full max-w-[420px] overflow-hidden flex flex-col animate-fade-in"
        style={{
          maxHeight: '90vh',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.12)',
          fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Share button — surfaces the streak-kind ShareSheet so the user
            can post their day-count to IG / WA / Messages. Placed next to
            close so it's discoverable but doesn't compete with the hero. */}
        <button
          onClick={() => setShareStreakOpen(true)}
          aria-label={t('share.share', { ns: 'pages', defaultValue: 'Share' })}
          className="absolute top-3 right-14 w-9 h-9 rounded-full flex items-center justify-center z-10 focus:outline-none focus:ring-2"
          style={{
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.25)',
            color: '#fff',
            '--tw-ring-color': 'rgba(255,255,255,0.6)',
          }}
        >
          {/* Inline arrow icon (the Share2 from lucide isn't imported here) */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>

        {/* Close button (floats above the hero) */}
        <button
          onClick={() => setShowStreakModal(false)}
          aria-label={t('nav.close', { ns: 'common', defaultValue: 'Close' })}
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center z-10 focus:outline-none focus:ring-2"
          style={{
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.25)',
            color: '#fff',
            '--tw-ring-color': 'rgba(255,255,255,0.6)',
          }}
        >
          <X size={16} strokeWidth={2.5} />
        </button>

        <div className="overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* ── Hero: orange gradient with big streak number + flame ─────────── */}
          <div
            className="relative overflow-hidden px-5 pt-7 pb-6"
            style={{
              background: 'linear-gradient(160deg, #FF8F4A 0%, #FF5A2E 70%, #DA3E10 115%)',
              color: '#fff',
            }}
          >
            {/* Decorative orbs */}
            <div aria-hidden className="absolute -top-6 -right-6 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
            <div aria-hidden className="absolute -bottom-10 -left-8 w-32 h-32 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }} />

            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-[10px] font-extrabold tracking-[1.4px] opacity-85 uppercase">
                  {t('navigation.streaks.currentStreak', { ns: 'pages', defaultValue: 'Current Streak' })}
                </p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span id="streak-modal-title" className="text-[64px] leading-none tracking-[-2.5px]" style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                    {streak}
                  </span>
                  <span className="text-[22px] opacity-80" style={{ fontWeight: 800 }}>
                    {t('navigation.streaks.days', { ns: 'pages', defaultValue: 'days' })}
                  </span>
                </div>
                <p className="text-[12px] opacity-85 mt-1" style={{ fontWeight: 600 }}>
                  {t('navigation.streaks.longest', { ns: 'pages', count: Math.max(longestDerived ?? 0, streakData?.longest_streak_days ?? 0, streak) })}
                </p>
              </div>
              <div
                className="text-[56px] leading-none"
                style={{ filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.25))', opacity: 0.95 }}
              >
                <Flame size={64} fill="#FFD27A" color="#FFE9B8" strokeWidth={1.2} />
              </div>
            </div>

            {/* Milestone progress bar — proportional scale (0–100 days) */}
            {(() => {
              const milestones = [7, 14, 30, 100];
              const SCALE_MAX = 100;
              const pct = Math.max(0, Math.min(100, (streak / SCALE_MAX) * 100));
              return (
                <div className="relative mt-5 pb-1">
                  <div className="relative h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }}>
                    <div
                      className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: '#fff', boxShadow: '0 0 12px rgba(255,255,255,0.55)' }}
                    />
                    {milestones.map((m) => (
                      <div
                        key={`tick-${m}`}
                        className="absolute top-1/2 -translate-y-1/2 w-[2px] h-[10px] rounded-full"
                        style={{ left: `${(m / SCALE_MAX) * 100}%`, transform: 'translate(-50%, -50%)', background: streak >= m ? '#fff' : 'rgba(255,255,255,0.55)' }}
                      />
                    ))}
                  </div>
                  <div className="relative h-[26px] mt-2 text-[10px]" style={{ fontWeight: 700 }}>
                    {milestones.map((m) => {
                      const reached = streak >= m;
                      return (
                        <div
                          key={m}
                          className="absolute top-0 text-center"
                          style={{ left: `${(m / SCALE_MAX) * 100}%`, transform: 'translateX(-50%)', opacity: reached ? 1 : 0.65, whiteSpace: 'nowrap' }}
                        >
                          <div className="text-[12px]" style={{ fontWeight: 900 }}>{reached ? '✓' : m}</div>
                          <div style={{ letterSpacing: 0.4, marginTop: 1, fontSize: 9 }}>{t('navigation.streaks.daysUpper', { ns: 'pages', defaultValue: 'DAYS' })}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Stat strip ─────────────────────────────────────────────────── */}
          <div className="px-4 pt-4 grid grid-cols-3 gap-2.5">
            {(() => {
              const monthDone = (streakMonths[0]?.days || []).filter(d => d.status === 'done').length;
              const freezesLeft = Math.max(0, (freezeStatus?.max || 1) - (freezeStatus?.used || 0));
              const items = [
                { l: t('navigation.streaks.longestLabel', { ns: 'pages', defaultValue: 'Longest' }), v: Math.max(longestDerived ?? 0, streakData?.longest_streak_days ?? 0, streak), u: t('navigation.streaks.days', { ns: 'pages', defaultValue: 'days' }), c: '#10B981' },
                { l: t('navigation.streaks.thisMonthLabel', { ns: 'pages', defaultValue: 'This month' }), v: monthDone, u: t('navigation.streaks.trained', { ns: 'pages', defaultValue: 'trained' }), c: 'var(--color-accent)' },
                { l: t('navigation.streaks.freezesLabel', { ns: 'pages', defaultValue: 'Freezes' }), v: freezesLeft, u: t('navigation.streaks.left', { ns: 'pages', defaultValue: 'left' }), c: '#60A5FA' },
              ];
              return items.map((s) => (
                <div key={s.l} className="rounded-[16px] p-3"
                     style={{ background: 'var(--color-bg-elevated, var(--color-surface-hover))', border: '1px solid var(--color-border-subtle)' }}>
                  <p className="text-[9px] uppercase tracking-[0.6px]" style={{ color: 'var(--color-text-subtle)', fontWeight: 700 }}>{s.l}</p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-[24px] leading-none tracking-[-0.8px]" style={{ fontWeight: 900, color: s.c, fontVariantNumeric: 'tabular-nums' }}>{s.v}</span>
                    <span className="text-[10px]" style={{ color: 'var(--color-text-subtle)', fontWeight: 600 }}>{s.u}</span>
                  </div>
                </div>
              ));
            })()}
          </div>

          {/* ── Freeze info card ───────────────────────────────────────────── */}
          <div className="px-4 pt-3">
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-[16px]"
                 style={{ background: 'color-mix(in srgb, #60A5FA 10%, transparent)', border: '1px solid color-mix(in srgb, #60A5FA 25%, transparent)' }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                   style={{ background: 'color-mix(in srgb, #60A5FA 18%, transparent)' }}>
                <Snowflake size={16} color="#60A5FA" strokeWidth={2.4} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px]" style={{ color: 'var(--color-text-primary)', fontWeight: 800, letterSpacing: '-0.2px' }}>
                  {t('navigation.streaks.freezeTitle', { ns: 'pages', defaultValue: 'Streak freeze protection' })}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {freezeStatus?.used >= freezeStatus?.max
                    ? t('navigation.streaks.monthlyFreezeUsed', { ns: 'pages' })
                    : t('navigation.streaks.freezeAvailable', { ns: 'pages', count: Math.max(0, (freezeStatus?.max || 1) - (freezeStatus?.used || 0)) })}
                </p>
              </div>
              <Shield size={14} style={{ color: 'var(--color-text-subtle)' }} />
            </div>
          </div>

          {/* ── Share streak ─────────────────────────────────────────────── */}
          {/* Streak shares are the highest-retention social hook in fitness apps
              (Strava's milestone celebrations, Duolingo's 100-day flexes). Only
              surface when the streak crosses 3 days — sharing a 1-day streak
              reads as desperate and depresses click-through. */}
          {streak >= 3 && (
            <div className="px-4 pt-3">
              <button
                type="button"
                onClick={() => setShareStreakOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-bg-secondary, #0A0D10)',
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: 0.2,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <ShareIcon size={14} />
                {t('navigation.streaks.share', { ns: 'pages', defaultValue: 'Share streak' })}
              </button>
            </div>
          )}

          {/* ── Calendar card ──────────────────────────────────────────────── */}
          <div className="px-4 pt-3 pb-4">
            <div className="rounded-[20px] p-4"
                 style={{ background: 'var(--color-bg-elevated, var(--color-surface-hover))', border: '1px solid var(--color-border-subtle)' }}>
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
                      <div className="flex items-center gap-2">
                        <CalendarIcon size={14} style={{ color: 'var(--color-text-muted)' }} />
                        <p className="text-[15px] capitalize" style={{ color: 'var(--color-text-primary)', fontWeight: 800, letterSpacing: '-0.3px' }}>
                          {monthData.label}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => canGoBack && setViewedMonthIndex(i => i + 1)}
                          disabled={!canGoBack}
                          aria-label={t('navigation.streaks.prevMonth', { ns: 'pages', defaultValue: 'Previous month' })}
                          className="w-8 h-8 min-w-[44px] min-h-[44px] rounded-[10px] inline-flex items-center justify-center transition-opacity focus:outline-none focus:ring-2 disabled:opacity-25"
                          style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', '--tw-ring-color': 'var(--color-accent)' }}
                        >
                          <ChevronLeft size={14} strokeWidth={2.4} />
                        </button>
                        <button
                          type="button"
                          onClick={() => canGoForward && setViewedMonthIndex(i => i - 1)}
                          disabled={!canGoForward}
                          aria-label={t('navigation.streaks.nextMonth', { ns: 'pages', defaultValue: 'Next month' })}
                          className="w-8 h-8 min-w-[44px] min-h-[44px] rounded-[10px] inline-flex items-center justify-center transition-opacity focus:outline-none focus:ring-2 disabled:opacity-25"
                          style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', '--tw-ring-color': 'var(--color-accent)' }}
                        >
                          <ChevronRight size={14} strokeWidth={2.4} />
                        </button>
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3">
                      {[
                        { c: '#10B981', ring: false, label: t('navigation.legend.trained', { ns: 'pages' }) },
                        { c: '#FF5A2E', ring: false, label: t('navigation.legend.missed', { ns: 'pages' }) },
                        { c: 'var(--color-text-muted)', ring: false, label: t('navigation.legend.restDay', { ns: 'pages' }) },
                        { c: '#60A5FA', ring: false, label: t('navigation.legend.frozen', { ns: 'pages' }) },
                        { c: 'var(--color-accent)', ring: true, label: t('navigation.legend.today', { ns: 'pages', defaultValue: 'Today' }) },
                      ].map(x => (
                        <div key={x.label} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>
                          <span className="w-[10px] h-[10px] rounded-[3px]" style={{ background: x.ring ? 'transparent' : x.c, border: x.ring ? `2px solid ${x.c}` : 'none' }} />
                          {x.label}
                        </div>
                      ))}
                    </div>

                    {/* Day-of-week labels */}
                    <div className="grid grid-cols-7 gap-1 mb-1.5">
                      {(t('days.initials', { returnObjects: true }) || ['S','M','T','W','T','F','S']).map((d, i) => (
                        <div key={i} className="text-center text-[10px]" style={{ color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.6px' }}>{d}</div>
                      ))}
                    </div>

                    {/* Day cells */}
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: padCount }, (_, i) => <div key={`pad-${i}`} />)}
                      {monthData.days.map(day => {
                        // Prefer the persisted dayNum. Fall back to the
                        // YYYY-MM-DD key for legacy cache entries written
                        // before we started storing dayNum (those still have
                        // a stringified `date` and would crash on .getDate()).
                        const dayNum = day.dayNum
                          ?? (typeof day.key === 'string' ? parseInt(day.key.slice(-2), 10) : NaN);
                        let bg = 'var(--color-bg-card)';
                        let fg = 'var(--color-text-muted)';
                        let border = 'none';
                        let opacity = 1;
                        let dot = null;
                        let ice = false;

                        if (day.status === 'future') { bg = 'var(--color-bg-card)'; fg = 'var(--color-text-subtle)'; opacity = 0.55; }
                        else if (day.status === 'before-account') { bg = 'transparent'; fg = 'var(--color-text-subtle)'; opacity = 0.3; }
                        else if (day.status === 'done') { bg = 'color-mix(in srgb, #10B981 22%, transparent)'; fg = '#10B981'; dot = '#10B981'; }
                        else if (day.status === 'rest') { bg = 'color-mix(in srgb, var(--color-text-muted) 14%, transparent)'; fg = 'var(--color-text-subtle)'; }
                        else if (day.status === 'frozen') { bg = 'color-mix(in srgb, #60A5FA 22%, transparent)'; fg = '#60A5FA'; ice = true; }
                        else if (day.status === 'today') { bg = 'var(--color-bg-card)'; fg = 'var(--color-text-primary)'; border = '2px solid var(--color-accent)'; }
                        else if (day.status === 'missed') { bg = 'color-mix(in srgb, #FF5A2E 18%, transparent)'; fg = '#FF5A2E'; }

                        return (
                          <div key={day.key} className="aspect-square rounded-[10px] flex items-center justify-center text-[11px] relative"
                               style={{ background: bg, color: fg, border, opacity, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                            {dayNum}
                            {ice && <span className="absolute top-[2px] right-[3px] text-[8px] leading-none">❄</span>}
                            {dot && <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full" style={{ background: dot }} />}
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
              <p className="text-[11px] text-center mt-3" style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>
                {t('navigation.streaks.lastBroken', { ns: 'pages' })}: {new Date(streakData.streak_broken_at).toLocaleDateString(i18n.language || undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )}
  {/* Streak share sheet. Mounted at the Navigation level so it overlays
      everything (including the streak modal it was triggered from). */}
  <ShareStreakSheet
    open={shareStreakOpen}
    onClose={() => setShareStreakOpen(false)}
    streakDays={streak}
    user={profile}
    gym={gymName}
    gymLogo={gymLogoUrl}
  />
  </>
  );
};

export default Navigation;
