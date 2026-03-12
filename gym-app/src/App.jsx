import { Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

import { useAuth } from './contexts/AuthContext';

import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import Workouts from './pages/Workouts';
import SocialFeed from './pages/SocialFeed';
import ActiveSession from './pages/ActiveSession';
import Profile from './pages/Profile';
import WorkoutBuilder from './pages/WorkoutBuilder';
import SessionSummary from './pages/SessionSummary';
import WorkoutLog from './pages/WorkoutLog';
import BodyMetrics from './pages/BodyMetrics';
import Strength from './pages/Strength';
import Nutrition from './pages/Nutrition';
import CheckIn from './pages/CheckIn';
import { ExerciseLibraryPage } from './pages/ExerciseLibrary';
import Leaderboard from './pages/Leaderboard';
import Challenges from './pages/Challenges';
import Notifications from './pages/Notifications';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/Onboarding';
import TVDisplay from './pages/TVDisplay';

// Trainer pages
import TrainerLayout from './layouts/TrainerLayout';
import TrainerClients from './pages/trainer/TrainerClients';
import TrainerPrograms from './pages/trainer/TrainerPrograms';

// Admin pages
import AdminLayout from './layouts/AdminLayout';
import AdminOverview from './pages/admin/AdminOverview';
import AdminMembers from './pages/admin/AdminMembers';
import AdminAttendance from './pages/admin/AdminAttendance';
import AdminChallenges from './pages/admin/AdminChallenges';
import AdminPrograms from './pages/admin/AdminPrograms';
import AdminLeaderboard from './pages/admin/AdminLeaderboard';
import AdminAnnouncements from './pages/admin/AdminAnnouncements';
import AdminSettings from './pages/admin/AdminSettings';
import AdminAnalytics from './pages/admin/AdminAnalytics';
import AdminModeration from './pages/admin/AdminModeration';
import AdminChurn from './pages/admin/AdminChurn';

// ── LOADING SCREEN ─────────────────────────────────────────
const LoadingScreen = () => (
  <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      <p className="text-[13px] text-[#4B5563]">Loading…</p>
    </div>
  </div>
);

const isAdmin = (profile) => profile?.role === 'admin' || profile?.role === 'super_admin';
const isTrainer = (profile) => profile?.role === 'trainer';

// ── PROTECTED ROUTE (member) ───────────────────────────────
const ProtectedRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" replace />;
  if (profile && !profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  if (isAdmin(profile))   return <Navigate to="/admin" replace />;
  if (isTrainer(profile)) return <Navigate to="/trainer" replace />;
  return children;
};

// ── ADMIN ROUTE ────────────────────────────────────────────
const AdminRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)            return <Navigate to="/login" replace />;
  if (!isAdmin(profile)) return <Navigate to="/" replace />;
  return children;
};

// ── TRAINER ROUTE ──────────────────────────────────────────
const TrainerRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)              return <Navigate to="/login" replace />;
  if (!isTrainer(profile)) return <Navigate to="/" replace />;
  return children;
};

// ── PUBLIC ROUTE ───────────────────────────────────────────
const PublicRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user && profile?.is_onboarded) {
    if (isAdmin(profile))   return <Navigate to="/admin" replace />;
    if (isTrainer(profile)) return <Navigate to="/trainer" replace />;
    return <Navigate to="/" replace />;
  }
  if (user && profile && !profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  return children;
};

// ── RECORD ENTRY ────────────────────────────────────────────
// Central handler for the Record tab / FAB.
// Later we can inspect in-progress sessions and deep-link into ActiveSession.
const RecordEntry = () => {
  return <Navigate to="/workouts" replace />;
};

// ── APP ────────────────────────────────────────────────────
function App() {
  return (
    <Routes>

      {/* Public — unauthenticated only */}
      <Route path="/login"  element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />

      {/* Onboarding */}
      <Route path="/onboarding" element={<Onboarding />} />

      {/* TV display — no auth required, no nav */}
      <Route path="/tv-display" element={<TVDisplay />} />

      {/* Admin dashboard */}
      <Route
        path="/admin/*"
        element={
          <AdminRoute>
            <AdminLayout>
              <Routes>
                <Route path="/"             element={<AdminOverview />} />
                <Route path="/members"      element={<AdminMembers />} />
                <Route path="/churn"        element={<AdminChurn />} />
                <Route path="/attendance"   element={<AdminAttendance />} />
                <Route path="/challenges"   element={<AdminChallenges />} />
                <Route path="/programs"     element={<AdminPrograms />} />
                <Route path="/leaderboard"  element={<AdminLeaderboard />} />
                <Route path="/announcements" element={<AdminAnnouncements />} />
                <Route path="/analytics"    element={<AdminAnalytics />} />
                <Route path="/moderation"   element={<AdminModeration />} />
                <Route path="/settings"     element={<AdminSettings />} />
              </Routes>
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
              <Routes>
                <Route path="/"         element={<TrainerClients />} />
                <Route path="/programs" element={<TrainerPrograms />} />
              </Routes>
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
              <Navigation />
              <Routes>
                {/* Home */}
                <Route path="/"                  element={<Dashboard />} />

                {/* Train / programming */}
                <Route path="/workouts"          element={<Workouts />} />
                <Route path="/workouts/:id/edit" element={<WorkoutBuilder />} />
                <Route path="/exercises"         element={<ExerciseLibraryPage />} />

                {/* Record / sessions */}
                <Route path="/record"            element={<RecordEntry />} />
                <Route path="/session/:id"       element={<ActiveSession />} />
                <Route path="/session-summary"   element={<SessionSummary />} />
                <Route path="/workout-log"       element={<WorkoutLog />} />

                {/* Social & community */}
                <Route path="/social"            element={<SocialFeed />} />
                <Route path="/leaderboard"       element={<Leaderboard />} />
                <Route path="/challenges"        element={<Challenges />} />
                <Route path="/notifications"     element={<Notifications />} />

                {/* You / self */}
                <Route path="/profile"           element={<Profile />} />
                <Route path="/metrics"           element={<BodyMetrics />} />
                <Route path="/strength"          element={<Strength />} />
                <Route path="/nutrition"         element={<Nutrition />} />

                {/* Utility */}
                <Route path="/checkin"           element={<CheckIn />} />

                <Route path="*"                  element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </ProtectedRoute>
        }
      />

    </Routes>
  );
}

export default App;
