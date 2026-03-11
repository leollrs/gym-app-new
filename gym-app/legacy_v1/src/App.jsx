import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Workouts from './pages/Workouts';
import SocialFeed from './pages/SocialFeed';
import Profile from './pages/Profile';
import Navigation from './components/Navigation';
import './App.css';
import { USERS } from './mockDb';

function App() {
  const [user, setUser] = useState(null);

  const handleLogin = (username) => {
    const foundUser = Object.values(USERS).find(u => u.username === username);
    if (foundUser || username === 'fitleo') {
      setUser(foundUser || USERS.current_user);
    } else {
      setUser({
        id: `user_${Date.now()}`,
        username,
        displayName: username.charAt(0).toUpperCase() + username.slice(1),
        friends: [],
        goals: "Get fit"
      });
    }
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
    <Router>
      {user && <TopBar user={user} />}

      <main className="app-content">
        <Routes>
          <Route path="/login" element={!user ? <Login onLogin={handleLogin} /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <Dashboard user={user} /> : <Navigate to="/login" />} />
          <Route path="/workouts" element={user ? <Workouts user={user} /> : <Navigate to="/login" />} />
          <Route path="/social" element={user ? <SocialFeed currentUser={user} /> : <Navigate to="/login" />} />
          <Route path="/profile" element={user ? <Profile user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>

      {user && <Navigation />}
    </Router>
  );
}

const TopBar = ({ user }) => (
  <header className="glass-nav flex-between">
    <h2 className="outfit-font text-gradient">LIFTR</h2>
    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-surface-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 600 }}>
      {user.displayName[0].toUpperCase()}
    </div>
  </header>
);

export default App;
