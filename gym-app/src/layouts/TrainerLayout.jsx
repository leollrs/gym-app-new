import { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Home, Users, CalendarDays, ClipboardList, MessageSquare, Bell, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const NAV = [
  { to: '/trainer',          labelKey: 'trainerNav.home',     icon: Home,           exact: true },
  { to: '/trainer/clients',  labelKey: 'trainerNav.clients',  icon: Users },
  { to: '/trainer/calendar', labelKey: 'trainerNav.calendar', icon: CalendarDays },
  { to: '/trainer/plans',    labelKey: 'trainerNav.plans',    icon: ClipboardList },
  { to: '/trainer/messages', labelKey: 'trainerNav.messages', icon: MessageSquare },
];

const sidebarLinkClass = (active) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
    active
      ? 'text-[var(--color-accent)]'
      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
  }`;

export default function TrainerLayout({ children }) {
  const { t } = useTranslation('common');
  const { profile, gymName, gymLogoUrl, signOut } = useAuth();
  const navigate = useNavigate();

  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
      .eq('is_read', false)
      .then(({ count }) => setUnreadNotifs(count || 0));
    supabase
      .from('direct_messages')
      .select('id, conversation_id, conversations!inner(participant_1, participant_2)', { count: 'exact', head: true })
      .neq('sender_id', profile.id)
      .is('read_at', null)
      .or(`participant_1.eq.${profile.id},participant_2.eq.${profile.id}`, { referencedTable: 'conversations' })
      .then(({ count }) => setUnreadMessages(count || 0));
  }, [profile?.id]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--color-bg-primary)' }}>
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      {/* ── Desktop sidebar ─────────────────────────── */}
      <aside
        className="hidden md:flex flex-col w-[220px] flex-shrink-0 min-h-screen sticky top-0 h-screen"
        style={{ borderRight: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-secondary)' }}
      >
        <Link to="/my-gym" className="px-5 py-5 no-underline" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--color-accent)' }}>Trainer</p>
          <div className="flex items-center gap-2.5">
            {gymLogoUrl && (
              <img src={gymLogoUrl} alt={gymName || 'Gym'} className="w-7 h-7 rounded-lg object-contain flex-shrink-0"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)' }} />
            )}
            <p className="text-[16px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{gymName || 'My Gym'}</p>
          </div>
        </Link>

        <nav aria-label="Trainer sidebar" className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, labelKey, icon: Icon, exact }) => (
            <NavLink key={to} to={to} end={exact}
              className={({ isActive }) => sidebarLinkClass(isActive)}
              style={({ isActive }) => isActive ? { background: 'var(--color-accent-glow)' } : undefined}>
              <Icon size={17} /> {t(labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <button
            onClick={() => navigate('/trainer/profile')}
            className="w-full flex items-center gap-3 px-3 py-2 mb-1 rounded-xl hover:bg-white/[0.04] transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-accent-glow)' }}>
              <span className="text-[11px] font-bold" style={{ color: 'var(--color-accent)' }}>{profile?.full_name?.[0]?.toUpperCase() ?? 'T'}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{profile?.full_name ?? 'Trainer'}</p>
              <p className="text-[11px] capitalize" style={{ color: 'var(--color-text-muted)' }}>{profile?.role}</p>
            </div>
          </button>
          <button onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium hover:bg-red-500/5 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}>
            <LogOut size={15} /> {t('trainerNav.signOut', 'Sign out')}
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────── */}
      <main id="main-content" className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Mobile header */}
        <header
          className="md:hidden fixed top-0 left-0 right-0 z-50 backdrop-blur-2xl px-4 flex items-center justify-between"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)',
            borderBottom: '1px solid var(--color-border-subtle)',
            paddingTop: 'env(safe-area-inset-top)',
            height: 'calc(52px + env(safe-area-inset-top))',
          }}
        >
          {/* Left: Gym branding → MyGym */}
          <Link to="/my-gym" className="flex items-center gap-2.5 min-w-0 no-underline">
            {gymLogoUrl && (
              <img src={gymLogoUrl} alt={gymName || 'Gym'} className="h-8 w-8 rounded-lg object-contain flex-shrink-0"
                style={{ border: '1px solid var(--color-border-default)', background: 'var(--color-bg-subtle)' }} />
            )}
            <span className="text-[22px] font-black tracking-tight truncate"
              style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
              {gymName || 'GymApp'}
            </span>
          </Link>

          {/* Right: Social · Notifications · Profile */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/trainer/social')}
              className="relative w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform focus:ring-2 focus:outline-none"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}
              aria-label={t('trainerNav.social', 'Social')}>
              <Users size={16} />
            </button>
            <button type="button" onClick={() => navigate('/trainer/notifications')}
              className="relative w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform focus:ring-2 focus:outline-none"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}
              aria-label={t('trainerNav.notifications', 'Notifications')}>
              <Bell size={16} />
              {unreadNotifs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>
                  {unreadNotifs > 9 ? '9+' : unreadNotifs}
                </span>
              )}
            </button>
            <button type="button" onClick={() => navigate('/trainer/profile')}
              className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform focus:ring-2 focus:outline-none"
              style={{ background: 'var(--color-accent-glow)' }}
              aria-label={t('trainerNav.profile', 'Profile')}>
              <span className="text-[14px] font-bold" style={{ color: 'var(--color-accent)' }}>
                {profile?.full_name?.[0]?.toUpperCase() ?? 'T'}
              </span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto pt-[calc(52px+env(safe-area-inset-top))] pb-[calc(68px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom nav (5 tabs) ──────────────── */}
      <nav
        aria-label="Trainer mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex backdrop-blur-2xl"
        style={{
          backgroundColor: 'var(--color-bg-nav)',
          borderTop: '1px solid var(--color-border-subtle)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {NAV.map(({ to, labelKey, icon: Icon, exact }) => (
          <NavLink key={to} to={to} end={exact}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors relative ${
                isActive ? '' : ''
              }`
            }
            style={({ isActive }) => ({ color: isActive ? 'var(--color-accent)' : 'var(--color-text-subtle)' })}
          >
            <span className="relative">
              <Icon size={20} />
              {to === '/trainer/messages' && unreadMessages > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
