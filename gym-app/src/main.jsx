import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { PostHogProvider } from '@posthog/react';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Toast from './components/Toast.jsx';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { initWatchListeners, onWatchMessage, syncRoutinesToWatch, syncUserContextToWatch } from './lib/watchBridge';
import { getCached } from './lib/queryCache';
import { supabase } from './lib/supabase';
import './i18n/i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,      // 2 min — data stays fresh
      gcTime: 10 * 60 * 1000,         // 10 min — cache kept in memory
      retry: (failureCount) => {
        // Don't retry on network loss — wait for reconnect
        if (!navigator.onLine) return false;
        return failureCount < 1;
      },
      retryDelay: 3000,               // wait 3s before retry
      refetchOnWindowFocus: false,     // don't refetch on tab focus (mobile app)
      networkMode: 'offlineFirst',     // serve cached data when offline
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'tugympr-query-cache',
});

persistQueryClient({
  queryClient,
  persister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      // Only persist successful queries, skip real-time data
      const key = query.queryKey?.[0];
      const skipKeys = ['notifications', 'realtime', 'feed'];
      return query.state.status === 'success' && !skipKeys.includes(key);
    },
  },
});

const isNative = Capacitor.isNativePlatform();
const Router = isNative ? MemoryRouter : BrowserRouter;

// Tell Capgo the app loaded successfully (enables OTA live updates)
CapacitorUpdater.notifyAppReady();

// Initialize Apple Watch communication bridge
initWatchListeners();

// Global error tracking — catches JS errors, promise rejections, network failures, slow APIs, auth/HTTP errors
import { trackError, installFetchInterceptor } from './lib/errorTracker';
installFetchInterceptor();
window.addEventListener('error', (event) => {
  trackError('js_error', event.error || event.message, { filename: event.filename, lineno: event.lineno, colno: event.colno });
});
window.addEventListener('unhandledrejection', (event) => {
  trackError('promise_rejection', event.reason);
});
// Track when app goes offline/online
window.addEventListener('offline', () => {
  trackError('network_error', 'Device went offline');
});
window.addEventListener('online', () => {
  trackError('network_error', 'Device came back online', { recovered: true });
});

// Handle watch messages at app level (routines sync, QR open, etc.)
onWatchMessage((msg) => {
  if (!msg) return;
  const action = msg.action || msg.type;

  if (action === 'request_routines') {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const supabaseRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || '';
      const storageKey = `sb-${supabaseRef}-auth-token`;
      const userId = JSON.parse(localStorage.getItem(storageKey) || '{}')?.user?.id;
      if (userId) {
        const cached = getCached(`routines:${userId}`);
        if (cached?.data?.length) {
          // Determine today's program routines
          supabase.from('generated_programs')
            .select('program_start, expires_at')
            .eq('profile_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .then(({ data: programs }) => {
              let todayIds = new Set();
              const prog = programs?.[0];
              if (prog && new Date(prog.expires_at) > new Date()) {
                const weekNum = Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1;
                const isWeekA = weekNum % 2 === 1;
                todayIds = new Set(
                  cached.data
                    .filter(r => r.name?.startsWith('Auto:') && (isWeekA ? (r.name.endsWith(' A') || !r.name.endsWith(' B')) : r.name.endsWith(' B')))
                    .map(r => r.id)
                );
              }
              syncRoutinesToWatch(cached.data.map(r => ({
                id: r.id,
                name: r.name,
                exercises: r.routine_exercises || [],
                exerciseCount: r.exerciseCount || r.routine_exercises?.length || 0,
                lastUsed: r.lastPerformedAt || '',
                isProgram: r.name?.startsWith('Auto:') || false,
                isTodayWorkout: todayIds.has(r.id),
              })));
            })
            .catch(() => {
              // Fallback without today info
              syncRoutinesToWatch(cached.data.map(r => ({
                id: r.id, name: r.name,
                exercises: r.routine_exercises || [],
                exerciseCount: r.exerciseCount || r.routine_exercises?.length || 0,
                lastUsed: r.lastPerformedAt || '',
                isProgram: r.name?.startsWith('Auto:') || false,
                isTodayWorkout: false,
              })));
            });
        }
      }
    } catch {}
  }

  if (action === 'open_qr') {
    // Dispatch QR open event — works if app is in foreground
    window.dispatchEvent(new CustomEvent('watch-open-qr'));
    // Also fire a local notification in case app is in background
    if (isNative) {
      import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
        LocalNotifications.schedule({
          notifications: [{
            id: 99901,
            title: 'TuGymPR',
            body: 'Tap to show your QR code',
            sound: 'default',
            extra: { action: 'open_qr' },
          }]
        }).catch(() => {});
      }).catch(() => {});
    }
  }

  if (action === 'start_workout' && msg.routineId) {
    // Store pending navigation so App.jsx picks it up even if not yet listening
    window.__watchPendingNav = `/session/${msg.routineId}`;
    window.dispatchEvent(new CustomEvent('watch-navigate', { detail: `/session/${msg.routineId}` }));
    // Fire notification in case app is in background
    if (isNative) {
      import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
        LocalNotifications.schedule({
          notifications: [{
            id: 99902,
            title: 'TuGymPR',
            body: 'Tap to start your workout',
            sound: 'default',
            extra: { action: 'start_workout', routineId: msg.routineId },
          }]
        }).catch(() => {});
      }).catch(() => {});
    }
  }
});

// Handle notification taps (from Watch-triggered notifications)
if (isNative) {
  import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
    LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const extra = event?.notification?.extra;
      if (extra?.action === 'open_qr') {
        window.dispatchEvent(new CustomEvent('watch-open-qr'));
      }
      if (extra?.action === 'start_workout' && extra?.routineId) {
        window.__watchPendingNav = `/session/${extra.routineId}`;
        window.dispatchEvent(new CustomEvent('watch-navigate', { detail: `/session/${extra.routineId}` }));
      }
    });
    // Request permission
    LocalNotifications.requestPermissions().catch(() => {});
  }).catch(() => {});
}

// ── Native platform initialization ──────────────────────────
if (isNative) {
  // Add platform CSS class to html element for platform-specific styling
  if (Capacitor.getPlatform() === 'android') {
    document.documentElement.classList.add('android-platform');
    // On Android, ensure dark mode class matches system setting
    // Some Android WebViews don't properly report prefers-color-scheme
    const androidIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const hasNoPreference = !window.matchMedia('(prefers-color-scheme: light)').matches && !androidIsDark;
    if (hasNoPreference) {
      // WebView can't detect system theme, default to dark
      document.documentElement.classList.add('dark');
    }
  } else if (Capacitor.getPlatform() === 'ios') {
    document.documentElement.classList.add('ios-platform');
  }

  // Status bar — adapt to current theme
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    const applyStatusBarTheme = () => {
      const isDark = document.documentElement.classList.contains('dark');
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
      StatusBar.setBackgroundColor({ color: isDark ? '#05070B' : '#F8FAFC' });
    };
    applyStatusBarTheme();
    if (Capacitor.getPlatform() === 'android') {
      StatusBar.setOverlaysWebView({ overlay: true });
    }
    // Watch for theme changes to update status bar
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          applyStatusBarTheme();
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
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

const appPlatform = isNative ? Capacitor.getPlatform() : 'web';
const appHost = isNative ? `app.tugympr.${appPlatform}` : window.location.host;

const posthogOptions = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: '2026-01-30',
  capture_pageview: false, // We handle page views manually via useLocation
  persistence: 'localStorage',
  property_denylist: [],
  sanitize_properties: (properties) => {
    // Replace localhost URLs with meaningful app paths
    if (properties['$current_url']) {
      try {
        const url = new URL(properties['$current_url']);
        properties['$current_url'] = `https://${appHost}${url.pathname}`;
      } catch {}
    }
    if (properties['$host']) properties['$host'] = appHost;
    if (properties['$pathname'] === '/') properties['$pathname'] = properties['$current_url']?.split(appHost)?.[1] || '/';
    properties['$app_platform'] = appPlatform;
    return properties;
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN} options={posthogOptions}>
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
    </PostHogProvider>
  </React.StrictMode>
);
