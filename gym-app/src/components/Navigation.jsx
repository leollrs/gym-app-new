import React from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { Home, Dumbbell, Activity, User, Trophy, MapPin, PlayCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// ── Member nav schema (Strava-style) ──────────────────────────────────────────
// We keep a single source of truth for main tabs used on both desktop and mobile.
const MEMBER_TABS = [
  {
    id: 'home',
    to: '/',
    icon: Home,
    label: 'Home',
    end: true,
  },
  {
    id: 'train',
    to: '/workouts',
    icon: Dumbbell,
    label: 'Train',
  },
  {
    id: 'record',
    to: '/record',
    icon: PlayCircle,
    label: 'Record',
    isPrimary: true,
  },
  {
    id: 'social',
    to: '/social',
    icon: Activity,
    label: 'Social',
  },
  {
    id: 'you',
    to: '/profile',
    icon: User,
    label: 'You',
  },
];

const DESKTOP_TABS = MEMBER_TABS.filter(tab => tab.id !== 'record');

const Navigation = () => {
  const { gymName, gymLogoUrl, user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isRecordActive =
    location.pathname.startsWith('/record') ||
    location.pathname.startsWith('/session/');

  return (
  <>
    {/* ── Desktop Top Navigation ──────────────────────────────────── */}
    <nav className="hidden md:block sticky top-0 z-50 border-b border-white/6 bg-[#03050A]/90 backdrop-blur-2xl">
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

        {/* Links (Home / Train / Social / You, with prominent Record) */}
        <div className="flex items-center gap-1">
          {DESKTOP_TABS.map(({ id, to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
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
                  {label}
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
            className="ml-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#D4AF37] text-black text-[13px] font-semibold shadow-sm hover:bg-[#f2d36b] transition-colors"
          >
            <PlayCircle size={16} className="flex-shrink-0" />
            Record
          </button>
        </div>
      </div>
    </nav>

    {/* ── Mobile Top Header ───────────────────────────────────────── */}
    <header
      className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white/90 dark:bg-[#05070B]/90 backdrop-blur-2xl border-b border-black/8 dark:border-white/6 flex items-center justify-between px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(64px + env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {gymLogoUrl && (
          <img
            src={gymLogoUrl}
            alt={gymName || 'Gym logo'}
            className="h-8 w-8 rounded-lg object-contain border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex-shrink-0"
          />
        )}
        <span
          className="text-[22px] font-black tracking-tight text-[#0F172A] dark:text-white truncate"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {gymName || 'GymApp'}
        </span>
      </div>

      {/* Profile avatar in header */}
      <button
        onClick={() => navigate('/profile')}
        className="w-10 h-10 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-70"
        aria-label="Profile"
      >
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt="Profile"
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span className="text-[#D4AF37] font-bold text-[13px]">
            {profile?.full_name?.[0]?.toUpperCase() ?? 'U'}
          </span>
        )}
      </button>
    </header>

    {/* ── Mobile Bottom Navigation (Strava-style 5 tabs with center Record) ─── */}
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-[#05070B]/95 backdrop-blur-2xl border-t border-black/8 dark:border-white/6 flex items-end justify-around px-2"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))', paddingTop: '0.5rem' }}
    >
      {MEMBER_TABS.map(({ id, to, icon: Icon, label, end, isPrimary }) => {
        if (isPrimary) {
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate('/record')}
              className="flex flex-col items-center justify-end min-w-[64px]"
              style={{ paddingBottom: '2px' }}
              aria-label="Record"
            >
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform -mt-5 ${
                  isRecordActive
                    ? 'bg-[#D4AF37] shadow-[#D4AF37]/40'
                    : 'bg-[#10B981] shadow-[#10B981]/30'
                }`}
              >
                <PlayCircle size={24} className="text-black" strokeWidth={2.5} />
              </div>
              <span
                className={`text-[10px] font-semibold mt-1 tracking-wide ${
                  isRecordActive ? 'text-[#D4AF37]' : 'text-[#10B981]'
                }`}
              >
                {label}
              </span>
            </button>
          );
        }

        return (
          <NavLink
            key={id}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[52px] min-h-[44px] justify-center ${
                isActive
                  ? 'text-[#D4AF37]'
                  : 'text-[#94A3B8] dark:text-slate-500 hover:text-[#64748B] dark:hover:text-slate-300'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={21} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-semibold tracking-wide">{label}</span>
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
