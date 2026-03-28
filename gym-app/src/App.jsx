import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { usePostHog } from '@posthog/react';
import QRCodeModal from './components/QRCodeModal';
import './App.css';

import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Skeleton from './components/Skeleton';
import { initPushNotifications } from './lib/pushNotifications';

// ── Eagerly loaded (critical path for members) ──────────────
import Navigation from './components/Navigation';
import AppTour from './components/AppTour';
import Dashboard from './pages/Dashboard';
import Workouts from './pages/Workouts';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/Onboarding';

// ── Lazy-loaded member pages (loaded on navigation) ─────────
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
const FirstWorkoutWelcome = lazy(() => import('./components/FirstWorkoutWelcome'));
const TVDisplay        = lazy(() => import('./pages/TVDisplay'));
const QuickStart       = lazy(() => import('./pages/QuickStart'));
const HealthSync       = lazy(() => import('./pages/HealthSync'));

// ── Lazy-loaded trainer pages ───────────────────────────────
const TrainerLayout       = lazy(() => import('./layouts/TrainerLayout'));
const TrainerDashboard    = lazy(() => import('./pages/trainer/TrainerDashboard'));
const TrainerClients      = lazy(() => import('./pages/trainer/TrainerClients'));
const TrainerPrograms     = lazy(() => import('./pages/trainer/TrainerPrograms'));
const TrainerClientNotes  = lazy(() => import('./pages/trainer/TrainerClientNotes'));
const TrainerAnalytics    = lazy(() => import('./pages/trainer/TrainerAnalytics'));
const TrainerSchedule     = lazy(() => import('./pages/trainer/TrainerSchedule'));
const TrainerWorkoutPlans = lazy(() => import('./pages/trainer/TrainerWorkoutPlans'));

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
  const [watchQROpen, setWatchQROpen] = useState(false);

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

  return (
    <Suspense fallback={<LoadingScreen />}>
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

      {/* Onboarding */}
      <Route path="/onboarding" element={<OnboardingRoute><ErrorBoundary><Onboarding /></ErrorBoundary></OnboardingRoute>} />

      {/* First-win welcome screen (post-onboarding, pre-dashboard) */}
      <Route path="/welcome" element={<ProtectedRoute><FirstWorkoutWelcome /></ProtectedRoute>} />

      {/* TV display — no auth required, no nav */}
      <Route path="/tv-display" element={<ErrorBoundary><TVDisplay /></ErrorBoundary>} />

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
                <Route path="/analytics"    element={<AdminAnalytics />} />
                <Route path="/moderation"   element={<AdminModeration />} />
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

                {/* Redirects: standalone pages now live inside hub pages */}
                <Route path="/workout-log"       element={<Navigate to="/progress?tab=log" replace />} />
                <Route path="/strength"          element={<Navigate to="/progress?tab=strength" replace />} />
                <Route path="/personal-records"  element={<Navigate to="/progress?tab=records" replace />} />
                <Route path="/metrics"           element={<Navigate to="/progress?tab=body" replace />} />
                <Route path="/leaderboard"       element={<Navigate to="/community?tab=leaderboard" replace />} />

                {/* Utility */}
                <Route path="/checkin"           element={<CheckIn />} />
                <Route path="/rewards"           element={<Rewards />} />
                <Route path="/health-sync"       element={<HealthSync />} />

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
