import { Routes, Route } from 'react-router-dom';
import './App.css';

import Dashboard from './pages/Dashboard';
import Navigation from './components/Navigation';
import Workouts from './pages/Workouts';
import SocialFeed from './pages/SocialFeed';
import ActiveSession from './pages/ActiveSession';

const Profile = () => (
  <div className="container main-content animate-fade-in">
    <h1 className="text-h1 text-gradient">Profile</h1>
    <p className="text-muted">Manage your settings and achievements.</p>
  </div>
);

const TVDisplay = () => (
  <div className="container main-content animate-fade-in" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
    <h1 className="text-h1 text-gradient" style={{ fontSize: '5rem' }}>LEADERBOARD</h1>
    <p className="text-h2 text-muted mt-4">Top Lifters This Week</p>
  </div>
);

function App() {
  return (
    <div className="app-wrapper bg-slate-900 text-slate-50 min-h-screen">
      <Navigation />

      {/* Main Routing */}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/workouts" element={<Workouts />} />
        <Route path="/social" element={<SocialFeed />} />
        <Route path="/profile" element={<Profile />} />

        {/* Gym Admin/TV Routes */}
        <Route path="/tv-display" element={<TVDisplay />} />

        {/* Fullscreen App Views */}
        <Route path="/session/:id" element={<ActiveSession />} />
      </Routes>
    </div>
  );
}

export default App;
