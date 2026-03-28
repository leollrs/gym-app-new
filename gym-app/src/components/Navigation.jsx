import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { Home, Dumbbell, PlayCircle, BarChart2, Users, Bell, Trophy, Flame, X, Snowflake, CheckCircle2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

// ── Prefetch map for lazy-loaded route chunks ────────────────────────────────
const PREFETCH_MAP = {
  '/record': () => import('../pages/QuickStart'),
  '/progress': () => import('../pages/Progress'),
  '/community': () => import('../pages/Community'),
  '/social': () => import('../pages/SocialFeed'),
  '/notifications': () => import('../pages/Notifications'),
  '/profile': () => import('../pages/Profile'),
  '/rewards': () => import('../pages/Rewards'),
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
const MEMBER_TABS = [
  { id: 'home', to: '/', icon: Home, labelKey: 'nav.home', end: true },
  { id: 'workouts', to: '/workouts', icon: Dumbbell, labelKey: 'nav.workouts' },
  { id: 'record', to: '/record', icon: PlayCircle, labelKey: 'nav.start', isPrimary: true },
  { id: 'progress', to: '/progress', icon: BarChart2, labelKey: 'nav.progress' },
  { id: 'community', to: '/community', icon: Users, labelKey: 'nav.community' },
];

const DESKTOP_TABS = MEMBER_TABS.filter(tab => tab.id !== 'record');

const Navigation = () => {
  const { gymName, gymLogoUrl, user, profile, unreadNotifications } = useAuth();
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [streak, setStreak] = useState(0);
  const [streakData, setStreakData] = useState(null);
  const [showStreakModal, setShowStreakModal] = useState(false);

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

  const [streakMonths, setStreakMonths] = useState([]);
  const scrollRef = useRef(null);

  const loadStreakDays = useCallback(async () => {
    if (!user?.id) return;

    const [sessionsRes, profileRes, gymRes] = await Promise.all([
      supabase.from('workout_sessions')
        .select('completed_at')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false }),
      supabase.from('profiles').select('preferred_training_days, created_at').eq('id', user.id).maybeSingle(),
      profile?.gym_id ? supabase.from('gyms').select('open_days').eq('id', profile.gym_id).maybeSingle() : Promise.resolve({ data: null }),
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

    // Gym closed days
    const gymOpenDays = gymRes.data?.open_days || [];
    const gymClosedSet = new Set(
      gymOpenDays.length > 0 ? [0,1,2,3,4,5,6].filter(d => !gymOpenDays.includes(d)) : []
    );

    const today = new Date();
    const todayKey = toKey(today);

    // ── STREAK CALCULATION ─────────────────────────────────────
    // Walk backwards from today. A day is "valid" if:
    //   1. User trained
    //   2. Gym was closed
    //   3. It's a rest day (user not scheduled)
    //   4. Freeze used (one per calendar month, only if streak already started)
    // The streak breaks at the first unprotected miss, or at account creation.

    const streakDayKeys = new Set();
    let frozenKey = null;
    let hasAtLeastOneWorkout = false;
    let currentFreezeMonth = null; // track which month's freeze has been used

    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = toKey(d);
      const dow = d.getDay();

      // Stop before account existed
      if (d < new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate())) break;

      const hasWorkout = workoutDates.has(key);

      if (hasWorkout) {
        hasAtLeastOneWorkout = true;
        streakDayKeys.add(key);
      } else if (key === todayKey) {
        // Today — not yet trained, don't break the streak
        continue;
      } else if (gymClosedSet.has(dow)) {
        // Gym closed — neutral, streak continues
        streakDayKeys.add(key);
      } else if (prefDays.length > 0 && restDowSet.has(dow)) {
        // User's rest day — neutral, streak continues
        streakDayKeys.add(key);
      } else if (hasAtLeastOneWorkout) {
        // This is a training day with no workout — check freeze
        const freezeMonth = `${d.getFullYear()}-${d.getMonth()}`;
        if (currentFreezeMonth !== freezeMonth && !frozenKey) {
          // Use freeze for this month
          currentFreezeMonth = freezeMonth;
          frozenKey = key;
          streakDayKeys.add(key);
        } else {
          // No freeze available — streak breaks
          break;
        }
      } else {
        // No workout ever logged yet — don't count as missed
        break;
      }
    }

    // ── CALENDAR GENERATION ────────────────────────────────────
    // Show months from account creation month to current month
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
        if (d > today) break;
        const key = toKey(d);
        const dow = d.getDay();
        const isToday = key === todayKey;
        const hasWorkout = workoutDates.has(key);
        const inStreak = streakDayKeys.has(key);
        const beforeAccount = key < createdAtKey;

        let status;
        if (beforeAccount) {
          status = 'future'; // invisible — before account existed
        } else if (isToday && !hasWorkout) {
          status = 'today';
        } else if (hasWorkout) {
          status = 'done';
        } else if (key === frozenKey) {
          status = 'frozen';
        } else if (inStreak && (gymClosedSet.has(dow) || (prefDays.length > 0 && restDowSet.has(dow)))) {
          status = 'rest';
        } else if (gymClosedSet.has(dow)) {
          status = 'rest'; // gym closed even outside streak — not "missed"
        } else if (prefDays.length > 0 && restDowSet.has(dow)) {
          status = 'rest'; // rest day even outside streak — not "missed"
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

    setStreakMonths(months);
  }, [user?.id, profile?.gym_id, streakData, i18n.language]);

  const isRecordActive =
    location.pathname.startsWith('/record') ||
    location.pathname.startsWith('/session/');

  return (
  <>
    {/* ── Desktop Top Navigation ──────────────────────────────────── */}
    <nav aria-label="Main navigation" className="hidden md:block sticky top-0 z-50 border-b border-white/6 bg-[#03050A]/90 backdrop-blur-2xl">
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
          {DESKTOP_TABS.map(({ id, to, icon: Icon, labelKey, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={t(labelKey)}
              onMouseEnter={() => prefetchRoute(to)}
              onTouchStart={() => prefetchRoute(to)}
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
            className="ml-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#D4AF37] text-black text-[13px] font-semibold shadow-sm hover:bg-[#f2d36b] transition-colors"
          >
            <PlayCircle size={16} className="flex-shrink-0" />
            {t('nav.start')}
          </button>

          {/* Desktop notifications + profile */}
          <div className="flex items-center gap-2 ml-2">
            <button
              type="button"
              onClick={() => navigate('/notifications')}
              className="relative w-11 h-11 rounded-full bg-white/5 flex items-center justify-center text-slate-300 hover:text-[#D4AF37] active:scale-95 transition-transform transition-colors"
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
              className="w-11 h-11 rounded-full bg-white/5 border border-white/20 flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform overflow-hidden"
              aria-label="Profile"
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Profile"
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className="text-[#D4AF37] font-bold text-[12px]">
                  {profile?.full_name?.[0]?.toUpperCase() ?? 'U'}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </nav>

    {/* ── Mobile Top Header ───────────────────────────────────────── */}
    <header
      className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[#05070B]/90 backdrop-blur-2xl border-b border-white/6 px-4 flex items-center justify-between"
      style={{ paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))', height: 'calc(52px + var(--safe-area-top, env(safe-area-inset-top)))', transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
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
          className="text-[22px] font-black tracking-tight text-white truncate"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
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
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full shrink-0 active:scale-95 transition-transform ${
          streak > 0
            ? 'bg-orange-500/15 border border-orange-500/25'
            : 'bg-white/[0.04] border border-white/[0.06]'
        }`}>
          <Flame size={14} className={streak > 0 ? 'text-orange-400' : 'text-[#6B7280]'} />
          <span className={`text-[14px] font-black ${streak > 0 ? 'text-orange-400' : 'text-[#6B7280]'}`}>
            {streak}
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/rewards')}
          onTouchStart={() => prefetchRoute('/rewards')}
          className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-slate-200 hover:text-[#D4AF37] active:scale-95 transition-transform transition-colors"
          aria-label="Rewards"
        >
          <Trophy size={16} />
        </button>
        <button
          type="button"
          onClick={() => navigate('/notifications')}
          onTouchStart={() => prefetchRoute('/notifications')}
          className="relative w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-slate-200 hover:text-[#D4AF37] active:scale-95 transition-transform transition-colors"
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
          className="w-11 h-11 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform overflow-hidden"
          aria-label="Profile"
        >
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt="Profile"
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <span className="text-[#D4AF37] font-bold text-[12px]">
              {profile?.full_name?.[0]?.toUpperCase() ?? 'U'}
            </span>
          )}
        </button>
      </div>
    </header>

    {/* ── Mobile Bottom Navigation (Strava-style 5 tabs with center Record) ─── */}
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#05070B]/95 backdrop-blur-2xl border-t border-white/6 flex items-end justify-around px-2"
      style={{ paddingBottom: 'calc(0.25rem + var(--safe-area-bottom, env(safe-area-inset-bottom)))', paddingTop: '0.35rem', transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {MEMBER_TABS.map(({ id, to, icon: Icon, labelKey, end, isPrimary }) => {
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
                className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform -mt-5 ${
                  isRecordActive
                    ? 'bg-[#FF8A00] shadow-[#FF8A00]/40'
                    : 'bg-[#FF8A00] shadow-[#FF8A00]/30'
                }`}
              >
                <PlayCircle size={24} className="text-white" strokeWidth={2.5} />
              </div>
              <span
                className={`text-[10px] font-semibold mt-1 tracking-wide ${
                  isRecordActive ? 'text-[#FF8A00]' : 'text-[#9CA3AF]'
                }`}
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
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[52px] min-h-[44px] justify-center ${
                isActive
                  ? 'text-[#FF8A00]'
                  : 'text-slate-500 hover:text-slate-300'
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShowStreakModal(false)}>
      <div className="rounded-[20px] w-full max-w-sm border overflow-hidden flex flex-col" style={{ maxHeight: '85vh', background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${streak > 0 ? 'bg-orange-500/15' : 'bg-white/[0.04]'}`}>
              <Flame size={20} className={streak > 0 ? 'text-orange-400' : 'text-[#6B7280]'} />
            </div>
            <div>
              <p className="text-[20px] font-bold text-[#E5E7EB]" style={{ fontVariantNumeric: 'tabular-nums' }}>{t('navigation.streaks.dayStreak', { ns: 'pages', count: streak })}</p>
              <p className="text-[11px] text-[#6B7280]">{t('navigation.streaks.longest', { ns: 'pages', count: streakData?.longest_streak_days || streak })}</p>
            </div>
          </div>
          <button onClick={() => setShowStreakModal(false)} className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center text-[#6B7280]">
            <X size={16} />
          </button>
        </div>

        {/* Freeze status */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${streakData?.streak_freeze_used ? 'bg-blue-500/10' : 'bg-white/[0.04]'}`}>
            <Snowflake size={14} className={streakData?.streak_freeze_used ? 'text-blue-400' : 'text-[#6B7280]'} />
            <span className="text-[11px] font-medium text-[#9CA3AF]">
              {streakData?.streak_freeze_used ? t('navigation.streaks.monthlyFreezeUsed', { ns: 'pages' }) : t('navigation.streaks.freezeAvailable', { ns: 'pages' })}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-5 pb-3 flex-shrink-0">
          {[
            { color: 'bg-[#10B981]', label: t('navigation.legend.trained', { ns: 'pages' }) },
            { color: 'bg-[#6B7280]', label: t('navigation.legend.restDay', { ns: 'pages' }) },
            { color: 'bg-red-500', label: t('navigation.legend.missed', { ns: 'pages' }) },
            { color: 'bg-blue-400', label: t('navigation.legend.frozen', { ns: 'pages' }) },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-[9px] text-[#6B7280]">
              <span className={`w-2 h-2 rounded-sm ${color}`} />
              {label}
            </span>
          ))}
        </div>

        {/* Scrollable month-by-month calendar */}
        <div ref={scrollRef} className="overflow-y-auto flex-1 min-h-0 px-5 pb-5">
          {streakMonths.map((monthData, mi) => {
            const firstDayDow = monthData.days.length > 0 ? monthData.days[0].dow : 0;
            // Pad to start on Sunday (Sun=0 cols, Mon=1 col, ... Sat=6 cols)
            const padCount = firstDayDow;

            return (
              <div key={`${monthData.year}-${monthData.month}`} className={mi > 0 ? 'mt-5' : ''}>
                {/* Month header */}
                <p className="text-[12px] font-semibold text-[#9CA3AF] mb-2">{monthData.label}</p>
                {/* Day-of-week labels */}
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {(t('days.initials', { returnObjects: true }) || ['S','M','T','W','T','F','S']).map((d, i) => (
                    <div key={i} className="text-center text-[8px] font-semibold text-[#4B5563]">{d}</div>
                  ))}
                </div>
                {/* Day cells */}
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: padCount }, (_, i) => <div key={`pad-${i}`} />)}
                  {monthData.days.map(day => {
                    const dayNum = day.date.getDate();
                    let bg = 'bg-white/[0.04]';
                    let textColor = 'text-[#4B5563]';
                    let ring = '';

                    if (day.status === 'done') { bg = 'bg-[#10B981]'; textColor = 'text-white'; }
                    else if (day.status === 'rest') { bg = 'bg-[#6B7280]/20'; textColor = 'text-[#6B7280]'; }
                    else if (day.status === 'broken') { bg = 'bg-red-500/20'; textColor = 'text-red-400'; ring = 'ring-1 ring-red-500/40'; }
                    else if (day.status === 'frozen') { bg = 'bg-blue-400/20'; textColor = 'text-blue-400'; }
                    else if (day.status === 'today') { bg = 'bg-white/[0.06]'; textColor = 'text-[#E5E7EB]'; ring = 'ring-1 ring-[#D4AF37]/40'; }
                    else if (day.status === 'missed') { bg = 'bg-red-500/10'; textColor = 'text-red-400/60'; }

                    return (
                      <div key={day.key} className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-bold ${bg} ${textColor} ${ring}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {dayNum}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Broken at info */}
        {streakData?.streak_broken_at && (
          <div className="px-5 pb-4 flex-shrink-0">
            <p className="text-[10px] text-[#4B5563]">
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
