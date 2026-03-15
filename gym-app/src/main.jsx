import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Toast from './components/Toast.jsx';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { initWatchListeners } from './lib/watchBridge';
import './index.css';

const Router = Capacitor.isNativePlatform() ? MemoryRouter : BrowserRouter;

// Tell Capgo the app loaded successfully (enables OTA live updates)
CapacitorUpdater.notifyAppReady();

// Initialize Apple Watch communication bridge
initWatchListeners();

// iOS: reset viewport zoom after leaving an input field
// iOS zooms in when focusing inputs (accessibility), but never zooms back out.
// Temporarily setting maximum-scale=1 forces it to restore normal zoom, then we
// remove that restriction so pinch-to-zoom still works.
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
  document.addEventListener('focusout', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      const viewport = document.querySelector('meta[name=viewport]');
      if (viewport) {
        const orig = viewport.getAttribute('content');
        viewport.setAttribute('content', orig + ', maximum-scale=1');
        setTimeout(() => viewport.setAttribute('content', orig), 50);
      }
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
          <Toast />
        </ToastProvider>
      </ThemeProvider>
    </Router>
  </React.StrictMode>
);
