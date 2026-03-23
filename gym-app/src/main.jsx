import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Toast from './components/Toast.jsx';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { initWatchListeners } from './lib/watchBridge';
import './i18n/i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,      // 2 min — data stays fresh
      gcTime: 10 * 60 * 1000,         // 10 min — cache kept in memory
      retry: 1,                        // retry failed requests once
      refetchOnWindowFocus: false,     // don't refetch on tab focus (mobile app)
    },
  },
});

const isNative = Capacitor.isNativePlatform();
const Router = isNative ? MemoryRouter : BrowserRouter;

// Tell Capgo the app loaded successfully (enables OTA live updates)
CapacitorUpdater.notifyAppReady();

// Initialize Apple Watch communication bridge
initWatchListeners();

// ── Native platform initialization ──────────────────────────
if (isNative) {
  // Status bar — light text on dark background
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: Style.Dark });
    StatusBar.setBackgroundColor({ color: '#05070B' });
    if (Capacitor.getPlatform() === 'android') {
      StatusBar.setOverlaysWebView({ overlay: true });
    }
  }).catch(() => {});

  // Keyboard — handle iOS keyboard push behavior
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    Keyboard.setAccessoryBarVisible({ isVisible: true });
    Keyboard.setScroll({ isDisabled: false });
    // On iOS, shrink the webview when keyboard opens (prevents content hiding)
    Keyboard.addListener('keyboardWillShow', (info) => {
      document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
      document.body.classList.add('keyboard-open');
    });
    Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.style.setProperty('--keyboard-height', '0px');
      document.body.classList.remove('keyboard-open');
    });
  }).catch(() => {});

  // Splash screen — hide after auth session is resolved (avoids white flash)
  import('@capacitor/splash-screen').then(({ SplashScreen }) => {
    import('./lib/supabase').then(({ supabase }) => {
      supabase.auth.getSession().finally(() => {
        SplashScreen.hide({ fadeOutDuration: 300 });
      });
    }).catch(() => SplashScreen.hide({ fadeOutDuration: 300 }));
  }).catch(() => {});

  // App — handle Android hardware back button
  import('@capacitor/app').then(({ App: CapApp }) => {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        CapApp.minimizeApp();
      }
    });

    // Handle app state changes (resume/pause)
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        // App resumed from background — check for OTA updates
        CapacitorUpdater.notifyAppReady();
      }
    });
  }).catch(() => {});

  // Network — listen for connectivity changes
  import('@capacitor/network').then(({ Network }) => {
    Network.addListener('networkStatusChange', (status) => {
      document.body.classList.toggle('offline', !status.connected);
    });
    // Check initial status
    Network.getStatus().then((status) => {
      document.body.classList.toggle('offline', !status.connected);
    });
  }).catch(() => {});
}

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

// Prevent pull-to-refresh on native (conflicts with app scroll)
if (isNative) {
  document.body.style.overscrollBehavior = 'none';
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  </React.StrictMode>
);
