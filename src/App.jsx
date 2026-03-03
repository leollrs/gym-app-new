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
import { ExerciseLibraryPage } from './pages/ExerciseLibrary';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/Onboarding';

// ── TV DISPLAY ─────────────────────────────────────────────
const TVDisplay = () => (
  <div className="container main-content animate-fade-in" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
    <h1 className="text-h1 text-gradient" style={{ fontSize: '5rem' }}>LEADERBOARD</h1>
    <p className="text-h2 text-muted mt-4">Top Lifters This Week</p>
  </div>
);

// ── LOADING SCREEN ─────────────────────────────────────────
const LoadingScreen = () => (
  <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      <p className="text-[13px] text-[#4B5563]">Loading…</p>
    </div>
  </div>
);

// ── PROTECTED ROUTE ────────────────────────────────────────
// Redirects unauthenticated users to /login.
// Redirects authenticated but non-onboarded users to /onboarding.
const ProtectedRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" replace />;
  if (profile && !profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  return children;
};

// ── PUBLIC ROUTE ───────────────────────────────────────────
// Redirects already-authenticated users away from login/signup.
const PublicRoute = ({ children }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user && profile?.is_onboarded)      return <Navigate to="/" replace />;
  if (user && profile && !profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  return children;
};

// ── APP ────────────────────────────────────────────────────
function App() {
  return (
    <Routes>

      {/* Public — unauthenticated only */}
      <Route path="/login"  element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />

      {/* Onboarding — authenticated but not yet onboarded */}
      <Route path="/onboarding" element={<Onboarding />} />

      {/* TV display — no auth required, no nav */}
      <Route path="/tv-display" element={<TVDisplay />} />

      {/* Protected — main app with nav */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <div className="app-wrapper">
              <Navigation />
              <Routes>
                <Route path="/"                  element={<Dashboard />} />
                <Route path="/workouts"          element={<Workouts />} />
                <Route path="/workouts/:id/edit" element={<WorkoutBuilder />} />
                <Route path="/social"            element={<SocialFeed />} />
                <Route path="/profile"           element={<Profile />} />
                <Route path="/exercises"         element={<ExerciseLibraryPage />} />
                <Route path="/session/:id"       element={<ActiveSession />} />
                <Route path="/session-summary"  element={<SessionSummary />} />
                <Route path="/workout-log"      element={<WorkoutLog />} />
                <Route path="/leaderboard"     element={<Leaderboard />} />
              </Routes>
            </div>
          </ProtectedRoute>
        }
      />

    </Routes>
  );
}

export default App;
