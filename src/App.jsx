import { Routes, Route } from 'react-router-dom';
import './App.css';

import Dashboard from './pages/Dashboard';
import Navigation from './components/Navigation';
import Workouts from './pages/Workouts';
import SocialFeed from './pages/SocialFeed';
import ActiveSession from './pages/ActiveSession';
import Profile from './pages/Profile';
import WorkoutBuilder from './pages/WorkoutBuilder';
import { ExerciseLibraryPage } from './pages/ExerciseLibrary';

const TVDisplay = () => (
  <div className="container main-content animate-fade-in" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
    <h1 className="text-h1 text-gradient" style={{ fontSize: '5rem' }}>LEADERBOARD</h1>
    <p className="text-h2 text-muted mt-4">Top Lifters This Week</p>
  </div>
);

function App() {
  return (
    <div className="app-wrapper">
      <Navigation />

      <Routes>
        {/* Main app */}
        <Route path="/"          element={<Dashboard />} />
        <Route path="/workouts"  element={<Workouts />} />
        <Route path="/social"    element={<SocialFeed />} />
        <Route path="/profile"   element={<Profile />} />
        <Route path="/exercises" element={<ExerciseLibraryPage />} />

        {/* Workout builder — edit a routine */}
        <Route path="/workouts/:id/edit" element={<WorkoutBuilder />} />

        {/* Active session — fullscreen workout tracker */}
        <Route path="/session/:id" element={<ActiveSession />} />

        {/* Gym TV */}
        <Route path="/tv-display" element={<TVDisplay />} />
      </Routes>
    </div>
  );
}

export default App;
