import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { usePostHog } from '@posthog/react';
import QRCodeModal from './components/QRCodeModal';
import './App.css';

import { useAuth } from './contexts/AuthContext';
import { useToast } from './contexts/ToastContext';
import ErrorBoundary from './components/ErrorBoundary';
import Skeleton from './components/Skeleton';
import { initPushNotifications } from './lib/pushNotifications';
import { supabase } from './lib/supabase';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import { getQueue } from './lib/offlineQueue';

// ── Eagerly loaded (critical path for members) ──────────────
import Navigation from './components/Navigation';
import AppTour from './components/AppTour';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/Onboarding';

// ── Lazy-loaded member pages (loaded on navigation) ─────────
const Workouts = lazy(() => import('./pages/Workouts'));
const SocialFeed       = lazy(() => import('./pages/SocialFeed'));
const ActiveSession    = lazy(() => import('./pages/ActiveSession'));
const Profile          = lazy(() => import('./pages/Profile'));
const MemberSettings   = lazy(() => import('./pages/MemberSettings'));
const WorkoutBuilder   = lazy(() => import('./pages/WorkoutBuilder'));
const SessionSummary   = lazy(() => import('./pages/SessionSummary'));
const Nutrition        = lazy(() => import('./pages/Nutrition'));
const MyGym            = lazy(() => import('./pages/MyGym'));
const CheckIn          = lazy(() => import('./pages/CheckIn'));
const ExerciseLibraryPage = lazy(() => import('./pages/ExerciseLibrary').then(m => ({ default: m.ExerciseLibraryPage })));
const Challenges       = lazy(() => import('./pages/Challenges'));
const Progress         = lazy(() => import('./pages/Progress'));
const Community        = lazy(() => import('./pages/Community'));
const Notifications    = lazy(() => import('./pages/Notifications'));
const NotificationSettings = lazy(() => import('./pages/NotificationSettings'));
const Rewards          = lazy(() => import('./pages/Rewards'));
const Referrals        = lazy(() => import('./pages/Referrals'));
const FirstWorkoutWelcome = lazy(() => import('./components/FirstWorkoutWelcome'));
const TVDisplay        = lazy(() => import('./pages/TVDisplay'));
const QuickStart       = lazy(() => import('./pages/QuickStart'));
const HealthSync       = lazy(() => import('./pages/HealthSync'));
const Classes          = lazy(() => import('./pages/Classes'));
const Messages         = lazy(() => import('./pages/Messages'));

// ── Lazy-loaded trainer pages ───────────────────────────────
const TrainerLayout       = lazy(() => import('./layouts/TrainerLayout'));
const TrainerDashboard    = lazy(() => import('./pages/trainer/TrainerDashboard'));
const TrainerClients      = lazy(() => import('./pages/trainer/TrainerClients'));
const TrainerPrograms     = lazy(() => import('./pages/trainer/TrainerPrograms'));
const TrainerClientNotes  = lazy(() => import('./pages/trainer/TrainerClientNotes'));
const TrainerAnalytics    = lazy(() => import('./pages/trainer/TrainerAnalytics'));
const TrainerSchedule     = lazy(() => import('./pages/trainer/TrainerSchedule'));
const TrainerWorkoutPlans = lazy(() => import('./pages/trainer/TrainerWorkoutPlans'));
const TrainerClasses      = lazy(() => import('./pages/trainer/TrainerClasses'));

// ── Lazy-loaded admin pages ─────────────────────────────────
const AdminLayout        = lazy(() => import('./layouts/AdminLayout'));
const AdminOverview      = lazy(() => import('./pages/admin/AdminOverview'));
const AdminMembers       = lazy(() => import('./pages/admin/AdminMembers'));
const AdminAttendance    = lazy(() => import('./pages/admin/AdminAttendance'));
const AdminChallenges    = lazy(() => import('./pages/admin/AdminChallenges'));
const AdminPrograms      = lazy(() => import('./pages/admin/AdminPrograms'));
const AdminLeaderboard   = lazy(() => import('./pages/admin/AdminLeaderboard'));
const AdminAnnouncements = lazy(() => import('./pages/admin/AdminAnnouncements'));
const AdminSettings      = lazy(() => import('./pages/admin/AdminSettings'));
const AdminAnalytics     = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminModeration    = lazy(() => import('./pages/admin/AdminModeration'));
const AdminChurn         = lazy(() => import('./pages/admin/AdminChurn'));
const AdminTrainers      = lazy(() => import('./pages/admin/AdminTrainers'));
const AdminMessaging     = lazy(() => import('./pages/admin/AdminMessaging'));
const AdminStore         = lazy(() => import('./pages/admin/AdminStore'));
const AdminClasses       = lazy(() => import('./pages/admin/AdminClasses'));
const AdminSegments      = lazy(() => import('./pages/admin/AdminSegments'));
const AdminRevenue       = lazy(() => import('./pages/admin/AdminRevenue'));
const AdminAuditLog      = lazy(() => import('./pages/admin/AdminAuditLog'));
const AdminReports       = lazy(() => import('./pages/admin/AdminReports'));
const AdminReferrals     = lazy(() => import('./pages/admin/AdminReferrals'));
const AdminNPS           = lazy(() => import('./pages/admin/AdminNPS'));
const AdminDigestConfig  = lazy(() => import('./pages/admin/AdminDigestConfig'));

// ── Lazy-loaded platform super-admin pages ──────────────────
const PlatformLayout     = lazy(() => import('./layouts/PlatformLayout'));
const GymsOverview       = lazy(() => import('./pages/platform/GymsOverview'));
const GymDetail          = lazy(() => import('./pages/platform/GymDetail'));
const PlatformAnalytics  = lazy(() => import('./pages/platform/PlatformAnalytics'));
const MemberLookup       = lazy(() => import('./pages/platform/MemberLookup'));
const PlatformSettings   = lazy(() => import('./pages/platform/PlatformSettings'));
const AuditLog           = lazy(() => import('./pages/platform/AuditLog'));
const SmsManagement      = lazy(() => import('./pages/platform/SmsManagement'));
const ErrorLogs          = lazy(() => import('./pages/platform/ErrorLogs'));

// ── APPLY SAVED THEME PREFERENCE ────────────────────────────
(() => {
  const saved = localStorage.getItem('theme');
  if (!saved) return; // No preference saved — respect index.html system preference check
  if (saved === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
})();

// ── SCROLL TO TOP ON NAVIGATION ──────────────────────────────
// Disable browser scroll restoration — we handle it manually
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.getElementById('main-content')?.scrollTo(0, 0);
    // Retry after lazy components mount
    const t1 = setTimeout(() => { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; }, 50);
    const t2 = setTimeout(() => { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; }, 150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [pathname]);
  return null;
}

// ── LOADING SCREEN (animated runner) ─────────────────────────
const LoadingScreen = () => (
  <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
    <div className="flex flex-col items-center gap-6">
      {/* Animated running figure */}
      <div className="relative w-20 h-20">
        <svg
          viewBox="0 0 64 64"
          fill="none"
          className="w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Ground line */}
          <line x1="8" y1="56" x2="56" y2="56" stroke="#D4AF37" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="3 3">
            <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.6s" repeatCount="indefinite" />
          </line>

          {/* Head */}
          <circle cx="32" cy="12" r="5" fill="#D4AF37">
            <animate attributeName="cy" values="12;10.5;12" dur="0.5s" repeatCount="indefinite" />
          </circle>

          {/* Body */}
          <line x1="32" y1="17" x2="32" y2="34" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="y1" values="17;15.5;17" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="34;32.5;34" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Left arm */}
          <line x1="32" y1="22" x2="22" y2="28" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="22;40;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="22;20.5;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="28;26;28" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Right arm */}
          <line x1="32" y1="22" x2="40" y2="28" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="40;22;40" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="22;20.5;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="28;26;28" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Left leg */}
          <line x1="32" y1="34" x2="22" y2="52" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="22;40;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="34;32.5;34" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="52;54;52" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Right leg */}
          <line x1="32" y1="34" x2="40" y2="52" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="40;22;40" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="34;32.5;34" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="52;54;52" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Dust particles */}
          <circle r="1.5" fill="#D4AF37" opacity="0">
            <animate attributeName="cx" values="24;12;8" dur="0.8s" repeatCount="indefinite" />
            <animate attributeName="cy" values="54;52;48" dur="0.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0.2;0" dur="0.8s" repeatCount="indefinite" />
          </circle>
          <circle r="1" fill="#D4AF37" opacity="0">
            <animate attributeName="cx" values="26;16;10" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
            <animate attributeName="cy" values="55;50;46" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.15;0" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      {/* Pulsing dots instead of "Loading..." text */}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  </div>
);

// ── GYM DEACTIVATED SCREEN ────────────────────────────────
const GymDeactivatedScreen = () => {
  const { signOut, gymName } = useAuth();
  return (
    <div className="min-h-screen bg-[#05070B] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#E5E7EB] mb-3">Account Deactivated</h1>
        <p className="text-[14px] text-[#9CA3AF] mb-2">
          {gymName
            ? `Your gym "${gymName}" has been deactivated by the platform administrator.`
            : 'Your gym has been deactivated by the platform administrator.'}
        </p>
        <p className="text-[13px] text-[#6B7280] mb-8">
          All accounts associated with this gym have been suspended. Please contact your gym owner or our support team for more information.
        </p>
        <button
          onClick={signOut}
          className="bg-white/6 hover:bg-white/10 border border-white/8 text-[#E5E7EB] rounded-xl px-6 py-3 text-[13px] font-medium transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};

// ── MEMBER BLOCKED SCREEN (individual deactivation/ban) ───
const MemberBlockedScreen = () => {
  const { signOut, memberBlocked } = useAuth();
  const isBanned = memberBlocked === 'banned';
  return (
    <div className="min-h-screen bg-[#05070B] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 ${
          isBanned
            ? 'bg-red-500/10 border border-red-500/20'
            : 'bg-orange-500/10 border border-orange-500/20'
        }`}>
          <svg className={`w-8 h-8 ${isBanned ? 'text-red-400' : 'text-orange-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#E5E7EB] mb-3">
          {isBanned ? 'Account Banned' : 'Account Deactivated'}
        </h1>
        <p className="text-[14px] text-[#9CA3AF] mb-2">
          {isBanned
            ? 'Your account has been banned by an administrator.'
            : 'Your account has been deactivated by an administrator.'}
        </p>
        <p className="text-[13px] text-[#6B7280] mb-8">
          {isBanned
            ? 'You are no longer able to access this platform. If you believe this is a mistake, please contact your gym administration.'
            : 'Your access has been temporarily suspended. Please contact your gym administration for more information.'}
        </p>
        <button
          onClick={signOut}
          className="bg-white/6 hover:bg-white/10 border border-white/8 text-[#E5E7EB] rounded-xl px-6 py-3 text-[13px] font-medium transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};

const isSuperAdmin = (profile) => profile?.role === 'super_admin';
const isAdmin = (profile) => profile?.role === 'admin' || profile?.role === 'super_admin';
const isTrainer = (profile) => profile?.role === 'trainer';

// ── PROTECTED ROUTE (member) ───────────────────────────────
const ProtectedRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked } = useAuth();
  if (loading) return null;
  if (!user)   return <Navigate to="/login" replace />;
  if (!profile) return null;
  if (gymDeactivated) return <GymDeactivatedScreen />;
  if (memberBlocked) return <MemberBlockedScreen />;
  if (isSuperAdmin(profile)) return <Navigate to="/platform" replace />;
  if (!profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  if (isAdmin(profile))   return <Navigate to="/admin" replace />;
  if (isTrainer(profile)) return <Navigate to="/trainer" replace />;
  return children;
};

// ── ONBOARDING ROUTE ───────────────────────────────────────
// Allows authenticated but not-yet-onboarded users through.
// Redirects away if already onboarded.
const OnboardingRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked } = useAuth();
  if (loading) return null;
  if (!user)   return <Navigate to="/login" replace />;
  if (!profile) return null;
  if (gymDeactivated) return <GymDeactivatedScreen />;
  if (memberBlocked) return <MemberBlockedScreen />;
  if (profile.is_onboarded) {
    if (isSuperAdmin(profile)) return <Navigate to="/platform" replace />;
    if (isAdmin(profile))      return <Navigate to="/admin" replace />;
    if (isTrainer(profile))    return <Navigate to="/trainer" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
};

// ── ADMIN ROUTE ────────────────────────────────────────────
const AdminRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked } = useAuth();
  if (loading) return null;
  if (!user)            return <Navigate to="/login" replace />;
  if (gymDeactivated)   return <GymDeactivatedScreen />;
  if (memberBlocked)    return <MemberBlockedScreen />;
  if (isSuperAdmin(profile)) return <Navigate to="/platform" replace />;
  if (!isAdmin(profile)) return <Navigate to="/" replace />;
  return children;
};

// ── PLATFORM ROUTE (super_admin only) ─────────────────────
const PlatformRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (!user)                  return <Navigate to="/login" replace />;
  if (!isSuperAdmin(profile)) return <Navigate to="/" replace />;
  return children;
};

// ── TRAINER ROUTE ──────────────────────────────────────────
const TrainerRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked } = useAuth();
  if (loading) return null;
  if (!user)              return <Navigate to="/login" replace />;
  if (gymDeactivated)     return <GymDeactivatedScreen />;
  if (memberBlocked)      return <MemberBlockedScreen />;
  if (!isTrainer(profile)) return <Navigate to="/" replace />;
  return children;
};

// ── AUTHENTICATED ROUTE (any role, no role-based redirects) ─
// Used for pages like TVDisplay that need auth but are accessible to all roles.
const AuthenticatedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user)   return <Navigate to="/login" replace />;
  return children;
};

// ── PUBLIC ROUTE ───────────────────────────────────────────
const PublicRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (user && !profile) return null;
  if (user && profile && isSuperAdmin(profile)) return <Navigate to="/platform" replace />;
  if (user && profile && !profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  if (user && profile?.is_onboarded) {
    if (isAdmin(profile))   return <Navigate to="/admin" replace />;
    if (isTrainer(profile)) return <Navigate to="/trainer" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
};

// RecordEntry removed — /record now renders QuickStart directly

// ── APP ────────────────────────────────────────────────────
function App() {
  const { user, profile, gymName, gymConfig, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const posthog = usePostHog();
  const { showToast } = useToast();
  const { t } = useTranslation('common');
  const [watchQROpen, setWatchQROpen] = useState(false);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const deepLinkProcessed = useRef(false);

  // ── Online / Offline awareness ──────────────────────────────
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Flush offline queue when connectivity is restored
  useEffect(() => {
    if (isOnline) {
      import('./lib/offlineQueue').then(({ flushQueue }) => {
        flushQueue(supabase);
      });
    }
  }, [isOnline]);

  // Track page views
  useEffect(() => {
    if (posthog) posthog.capture('$pageview', { $current_url: `https://app.tugympr.com${location.pathname}` });
  }, [location.pathname, posthog]);

  // Listen for Watch-triggered actions
  useEffect(() => {
    const qrHandler = () => setWatchQROpen(true);
    const navHandler = (e) => {
      if (e.detail) {
        // Store in localStorage so it survives app restarts
        localStorage.setItem('watchPendingNav', e.detail);
        // Try navigating immediately if auth is ready
        if (user && !loading) {
          localStorage.removeItem('watchPendingNav');
          navigate(e.detail);
        }
      }
    };

    window.addEventListener('watch-open-qr', qrHandler);
    window.addEventListener('watch-navigate', navHandler);

    return () => {
      window.removeEventListener('watch-open-qr', qrHandler);
      window.removeEventListener('watch-navigate', navHandler);
    };
  }, [navigate, user, loading]);

  // Process pending Watch navigation once auth is loaded
  useEffect(() => {
    if (!loading && user) {
      const pending = localStorage.getItem('watchPendingNav') || window.__watchPendingNav;
      if (pending) {
        localStorage.removeItem('watchPendingNav');
        window.__watchPendingNav = null;
        navigate(pending);
      }
    }
  }, [loading, user, navigate]);

  // Register for push notifications once user is logged in + onboarded
  useEffect(() => {
    if (!loading && user?.id && profile?.gym_id && profile?.is_onboarded) {
      initPushNotifications({
        userId: user.id,
        gymId: profile.gym_id,
        onNotificationTap: (data) => {
          navigate(data?.route || '/notifications');
        },
      });
    }
  }, [loading, user?.id, profile?.gym_id, profile?.is_onboarded, navigate]);

  // ── Deep link handling: /referral/:code, ?ref=:code, /add-friend/:code ──
  useEffect(() => {
    if (loading || deepLinkProcessed.current) return;

    const path = location.pathname;
    const searchParams = new URLSearchParams(location.search);

    // ── Handle /siri/* deep links (triggered by Siri Shortcuts / App Intents) ──
    const siriMatch = path.match(/^\/siri\/(.+)$/);
    if (siriMatch) {
      const siriAction = siriMatch[1];
      deepLinkProcessed.current = true;

      if (!user) {
        // Not authenticated — send to login, the action is lost (acceptable for Siri)
        navigate('/login', { replace: true });
        return;
      }

      const siriRoutes = {
        'start-workout': '/quick-start',
        'check-in':      '/checkin',
        'gym-card':      '/profile?showQR=1',
        'streak':        '/profile',
        'log-food':      '/progress?tab=nutrition',
      };

      const target = siriRoutes[siriAction] || '/';
      navigate(target, { replace: true });
      return;
    }

    // ── Handle /invite/:code ──
    const inviteMatch = path.match(/^\/invite\/([^/]+)$/);
    if (inviteMatch) {
      const inviteCode = inviteMatch[1];
      deepLinkProcessed.current = true;
      if (user) {
        // Already logged in — invite codes are for new accounts
        showToast('Invite codes are for new accounts', 'info');
        navigate('/', { replace: true });
      } else {
        // Store code and redirect to signup with pre-filled invite code
        localStorage.setItem('pendingInviteCode', inviteCode.toUpperCase());
        navigate('/signup', { replace: true });
      }
      return;
    }

    // ── Handle /referral/:code ──
    const referralMatch = path.match(/^\/referral\/([^/]+)$/);
    const refParam = searchParams.get('ref');
    const referralCode = referralMatch?.[1] || refParam;

    if (referralCode) {
      deepLinkProcessed.current = true;
      if (user) {
        // User is already logged in — referral codes are for new signups
        showToast('Referral codes are for new signups', 'info');
        navigate('/', { replace: true });
      } else {
        // Store code and redirect to signup
        localStorage.setItem('pendingReferralCode', referralCode);
        navigate('/signup', { replace: true });
      }
      return;
    }

    // ── Handle /add-friend/:code ──
    const friendMatch = path.match(/^\/add-friend\/([^/]+)$/);
    if (friendMatch) {
      const friendCode = friendMatch[1];
      deepLinkProcessed.current = true;

      if (!user || !profile) {
        // Not logged in — store for later and redirect to login
        localStorage.setItem('pendingFriendCode', friendCode);
        navigate('/login', { replace: true });
        return;
      }

      // Look up the profile by friend_code and send a friend request
      (async () => {
        try {
          const { data: friendProfile, error: lookupErr } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('friend_code', friendCode)
            .eq('gym_id', profile.gym_id)
            .single();

          if (lookupErr || !friendProfile) {
            showToast('Friend code not found', 'error');
            navigate('/', { replace: true });
            return;
          }

          // Don't send to self
          if (friendProfile.id === user.id) {
            navigate('/', { replace: true });
            return;
          }

          // Check if friendship already exists
          const { count } = await supabase
            .from('friendships')
            .select('id', { count: 'exact', head: true })
            .or(
              `and(user_id.eq.${user.id},friend_id.eq.${friendProfile.id}),and(user_id.eq.${friendProfile.id},friend_id.eq.${user.id})`
            );

          if (count > 0) {
            showToast('You are already friends or have a pending request', 'info');
            navigate('/', { replace: true });
            return;
          }

          // Insert friend request
          const { error: insertErr } = await supabase
            .from('friendships')
            .insert({
              user_id: user.id,
              friend_id: friendProfile.id,
              status: 'pending',
            });

          if (insertErr) {
            showToast('Could not send friend request', 'error');
          } else {
            showToast(`Friend request sent to ${friendProfile.full_name}!`, 'success');
          }
        } catch {
          showToast('Could not send friend request', 'error');
        }
        navigate('/', { replace: true });
      })();
      return;
    }
  }, [loading, user, profile, location.pathname, location.search, navigate, showToast]);

  // Process pending friend code after login (stored from deep link while unauthenticated)
  useEffect(() => {
    if (loading || !user || !profile) return;
    const pendingFriendCode = localStorage.getItem('pendingFriendCode');
    if (!pendingFriendCode) return;

    localStorage.removeItem('pendingFriendCode');

    (async () => {
      try {
        const { data: friendProfile, error: lookupErr } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('friend_code', pendingFriendCode)
          .eq('gym_id', profile.gym_id)
          .single();

        if (lookupErr || !friendProfile || friendProfile.id === user.id) return;

        const { count } = await supabase
          .from('friendships')
          .select('id', { count: 'exact', head: true })
          .or(
            `and(user_id.eq.${user.id},friend_id.eq.${friendProfile.id}),and(user_id.eq.${friendProfile.id},friend_id.eq.${user.id})`
          );

        if (count > 0) {
          showToast('You are already friends or have a pending request', 'info');
          return;
        }

        const { error: insertErr } = await supabase
          .from('friendships')
          .insert({
            user_id: user.id,
            friend_id: friendProfile.id,
            status: 'pending',
          });

        if (insertErr) {
          showToast('Could not send friend request', 'error');
        } else {
          showToast(`Friend request sent to ${friendProfile.full_name}!`, 'success');
        }
      } catch {
        showToast('Could not send friend request', 'error');
      }
    })();
  }, [loading, user, profile, showToast]);

  return (
    <Suspense fallback={<LoadingScreen />}>
    {!isOnline && !offlineDismissed && (
      <div className="fixed top-0 left-0 right-0 z-[999] flex items-center justify-center gap-2 py-2 px-4 animate-slide-down"
        style={{ background: 'var(--color-warning, #F59E0B)', color: '#000' }}>
        <WifiOff size={14} />
        <span className="text-[12px] font-semibold">{t('offline')}</span>
        {(() => { const q = getQueue(); return q.length > 0 ? <span className="text-[11px] opacity-80">({q.length})</span> : null; })()}
        <button onClick={() => setOfflineDismissed(true)} className="ml-auto text-black/60 hover:text-black" aria-label="Dismiss">
          <span className="text-[16px] leading-none font-bold">&times;</span>
        </button>
      </div>
    )}
    {watchQROpen && profile?.qr_code_payload && (
      <QRCodeModal
        payload={profile.qr_code_payload}
        memberName={profile?.full_name}
        displayFormat={gymConfig?.qrDisplayFormat}
        gymName={gymName}
        onClose={() => setWatchQROpen(false)}
      />
    )}
    <ScrollToTop />
    <Routes>

      {/* Public — unauthenticated only */}
      <Route path="/login"  element={<PublicRoute><ErrorBoundary><Login /></ErrorBoundary></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><ErrorBoundary><Signup /></ErrorBoundary></PublicRoute>} />

      {/* Deep link catch routes — the useEffect above handles redirect logic */}
      <Route path="/siri/*"            element={<LoadingScreen />} />
      <Route path="/invite/:code"     element={<LoadingScreen />} />
      <Route path="/referral/:code"   element={<LoadingScreen />} />
      <Route path="/add-friend/:code" element={<LoadingScreen />} />

      {/* Onboarding */}
      <Route path="/onboarding" element={<OnboardingRoute><ErrorBoundary><Onboarding /></ErrorBoundary></OnboardingRoute>} />

      {/* First-win welcome screen (post-onboarding, pre-dashboard) */}
      <Route path="/welcome" element={<ProtectedRoute><FirstWorkoutWelcome /></ProtectedRoute>} />

      {/* TV display — auth required, no nav (any authenticated user/role) */}
      <Route path="/tv-display" element={<AuthenticatedRoute><ErrorBoundary><TVDisplay /></ErrorBoundary></AuthenticatedRoute>} />

      {/* Platform super-admin dashboard */}
      <Route
        path="/platform/*"
        element={
          <PlatformRoute>
            <PlatformLayout>
              <ErrorBoundary>
              <Suspense fallback={<Skeleton variant="page" />}>
              <Routes>
                <Route path="/"             element={<GymsOverview />} />
                <Route path="/gym/:gymId"   element={<GymDetail />} />
                <Route path="/analytics"    element={<PlatformAnalytics />} />
                <Route path="/members"      element={<MemberLookup />} />
                <Route path="/settings"     element={<PlatformSettings />} />
                <Route path="/sms"          element={<SmsManagement />} />
                <Route path="/audit-log"    element={<AuditLog />} />
                <Route path="/error-logs"  element={<ErrorLogs />} />
                <Route path="*"            element={<Navigate to="/platform" replace />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
            </PlatformLayout>
          </PlatformRoute>
        }
      />

      {/* Admin dashboard */}
      <Route
        path="/admin/*"
        element={
          <AdminRoute>
            <AdminLayout>
              <ErrorBoundary>
              <Suspense fallback={<Skeleton variant="page" />}>
              <Routes>
                <Route path="/"             element={<AdminOverview />} />
                <Route path="/members"      element={<AdminMembers />} />
                <Route path="/churn"        element={<AdminChurn />} />
                <Route path="/attendance"   element={<AdminAttendance />} />
                <Route path="/challenges"   element={<AdminChallenges />} />
                <Route path="/trainers"     element={<AdminTrainers />} />
                <Route path="/programs"     element={<AdminPrograms />} />
                <Route path="/leaderboard"  element={<AdminLeaderboard />} />
                <Route path="/announcements" element={<AdminAnnouncements />} />
                <Route path="/messages"      element={<AdminMessaging />} />
                <Route path="/store"        element={<AdminStore />} />
                <Route path="/revenue"     element={<AdminRevenue />} />
                <Route path="/analytics"    element={<AdminAnalytics />} />
                <Route path="/moderation"   element={<AdminModeration />} />
                <Route path="/classes"      element={<AdminClasses />} />
                <Route path="/segments"    element={<AdminSegments />} />
                <Route path="/audit-log"   element={<AdminAuditLog />} />
                <Route path="/reports"     element={<AdminReports />} />
                <Route path="/referrals"   element={<AdminReferrals />} />
                <Route path="/nps"         element={<AdminNPS />} />
                <Route path="/digest"      element={<AdminDigestConfig />} />
                <Route path="/settings"     element={<AdminSettings />} />
                <Route path="*"            element={<Navigate to="/admin" replace />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
            </AdminLayout>
          </AdminRoute>
        }
      />

      {/* Trainer dashboard */}
      <Route
        path="/trainer/*"
        element={
          <TrainerRoute>
            <TrainerLayout>
              <ErrorBoundary>
              <Suspense fallback={<Skeleton variant="page" />}>
              <Routes>
                <Route path="/"                element={<TrainerDashboard />} />
                <Route path="/clients"         element={<TrainerClients />} />
                <Route path="/client/:clientId" element={<TrainerClientNotes />} />
                <Route path="/schedule"        element={<TrainerSchedule />} />
                <Route path="/plans"           element={<TrainerWorkoutPlans />} />
                <Route path="/analytics"       element={<TrainerAnalytics />} />
                <Route path="/programs"        element={<TrainerPrograms />} />
                <Route path="/classes"        element={<TrainerClasses />} />
                <Route path="*"              element={<Navigate to="/trainer" replace />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
            </TrainerLayout>
          </TrainerRoute>
        }
      />

      {/* Protected — member app with nav */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <div className="app-wrapper">
              <a href="#main-content" className="skip-to-content">
                Skip to main content
              </a>
              <Navigation />
              <AppTour userId={user?.id} />
              <div id="main-content" role="main">
              <ErrorBoundary>
              <Suspense fallback={<Skeleton variant="page" />}>
              <Routes>
                {/* Home */}
                <Route path="/"                  element={<Dashboard />} />

                {/* Train / programming */}
                <Route path="/workouts"          element={<Workouts />} />
                <Route path="/workouts/:id/edit" element={<WorkoutBuilder />} />
                <Route path="/exercises"         element={<ExerciseLibraryPage />} />

                {/* Record / sessions */}
                <Route path="/record"            element={<QuickStart />} />
                <Route path="/session/:id"       element={<ActiveSession />} />
                <Route path="/session-summary"   element={<SessionSummary />} />

                {/* Social & community */}
                <Route path="/community"         element={<Community />} />
                <Route path="/social"            element={<SocialFeed />} />
                <Route path="/challenges"        element={<Challenges />} />
                <Route path="/notifications"          element={<Notifications />} />
                <Route path="/notification-settings" element={<NotificationSettings />} />

                {/* Progress (consolidated hub) */}
                <Route path="/progress"          element={<Progress />} />

                {/* You / self */}
                <Route path="/profile"           element={<Profile />} />
                <Route path="/settings"          element={<MemberSettings />} />
                <Route path="/nutrition"         element={<Nutrition />} />
                <Route path="/my-gym"           element={<MyGym />} />
                <Route path="/classes"          element={<Classes />} />

                {/* Redirects: standalone pages now live inside hub pages */}
                <Route path="/workout-log"       element={<Navigate to="/progress?tab=log" replace />} />
                <Route path="/strength"          element={<Navigate to="/progress?tab=strength" replace />} />
                <Route path="/personal-records"  element={<Navigate to="/progress?tab=records" replace />} />
                <Route path="/metrics"           element={<Navigate to="/progress?tab=body" replace />} />
                <Route path="/leaderboard"       element={<Navigate to="/community?tab=leaderboard" replace />} />

                {/* Utility */}
                <Route path="/checkin"           element={<CheckIn />} />
                <Route path="/rewards"           element={<Rewards />} />
                <Route path="/referrals"         element={<Referrals />} />
                <Route path="/health-sync"       element={<HealthSync />} />
                <Route path="/messages"          element={<Messages />} />
                <Route path="/messages/:conversationId" element={<Messages />} />

                <Route path="*"                  element={<Navigate to="/" replace />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

    </Routes>
    </Suspense>
  );
}

export default App;
