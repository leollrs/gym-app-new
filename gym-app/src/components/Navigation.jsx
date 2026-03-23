import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { Home, Dumbbell, PlayCircle, BarChart2, Users, Bell, Trophy, Flame } from 'lucide-react';
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
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('streak_cache')
      .select('current_streak_days')
      .eq('profile_id', user.id)
      .maybeSingle()
      .then(({ data }) => setStreak(data?.current_streak_days || 0))
      .catch(() => {});
  }, [user?.id, location.pathname]);

  const isRecordActive =
    location.pathname.startsWith('/record') ||
    location.pathname.startsWith('/session/');

  return (
  <>
    {/* ── Desktop Top Navigation ──────────────────────────────────── */}
    <nav aria-label="Main navigation" className="hidden md:block sticky top-0 z-50 border-b border-white/6 bg-[#03050A]/90 backdrop-blur-2xl">
      <div className="container flex justify-between items-center py-3.5">

        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
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
        </div>

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
      style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(52px + env(safe-area-inset-top))', transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {/* Brand on the left */}
      <div className="flex items-center gap-2.5 min-w-0">
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
      </div>

      {/* Streak + Rewards + Notifications + Profile on the right */}
      <div className="flex items-center gap-2">
        {/* Streak badge */}
        <button
          type="button"
          onClick={() => navigate('/rewards')}
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
      style={{ paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom))', paddingTop: '0.35rem', transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
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
  </>
  );
};

export default Navigation;
