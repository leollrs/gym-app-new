import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
// PostHog is lazy-loaded to keep it out of the critical rendering path.
// The LazyPostHogProvider below renders children immediately and wraps them
// with the real <PostHogProvider> once the @posthog/react chunk has loaded.
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Toast from './components/Toast.jsx';
import StuckLoadingRecovery from './components/StuckLoadingRecovery.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { initWatchListeners, onWatchMessage, syncRoutinesToWatch, syncUserContextToWatch, syncQRToWatch } from './lib/watchBridge';
import { getCached } from './lib/queryCache';
import { supabase } from './lib/supabase';
import { installAppResume, notifyBackground, notifyForeground } from './lib/appResume';
import { hydrateFromDurable, flushToDurable, whenHydrated } from './lib/durableStorage';
import { i18nPrimaryReady } from './i18n/i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 s freshness window. Re-navigating between pages within the window
      // still paints instantly from cache with no refetch (so tab-switching
      // feels native-fast). Past the window, mount triggers a background
      // refetch — `placeholderData: prev` keeps the cached UI on screen
      // while the refetch lands, so the user never sees a spinner.
      //
      // Why not staleTime: Infinity + refetchOnMount: false anymore?
      // That combo gave instant paint but eliminated *every* self-healing
      // path. Any post-update data-shape mismatch in the persisted cache
      // would render forever against poisoned data with no chance to
      // recover. The current settings keep the instant-paint UX (cached
      // data is shown immediately) but always re-fetch after 30 s so a
      // bad row gets corrected on the next view.
      //
      // Hooks that genuinely need "never refetch" can still opt in per-call
      // with `staleTime: Infinity`.
      staleTime: 30_000,
      gcTime: 7 * 24 * 60 * 60 * 1000, // 7 d — stays in memory + persists to localStorage
      placeholderData: (prev) => prev,
      retry: (failureCount) => {
        if (!navigator.onLine) return false;
        return failureCount < 1;
      },
      retryDelay: 500,
      refetchOnWindowFocus: false,
      refetchOnMount: true,            // refetch when stale (respects staleTime above)
      refetchOnReconnect: 'stale',
      networkMode: 'offlineFirst',
    },
  },
});

// Build ID is injected by vite.config.js. Fall back to a literal in case the
// define plugin didn't run (some test/dev paths skip define).
// eslint-disable-next-line no-undef
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

// Persister backed by localStorage. We keep the sync persister (idb-async is
// not installed) but aggressively flush on pagehide / visibilitychange so a
// hard app-kill on iOS doesn't lose a recent cache entry.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'tugympr-query-cache',
  throttleTime: 1000,
  // Only serialize actual successful data — cuts down the persisted payload so
  // the 5-10MB localStorage quota (iOS WebView) doesn't force an eviction.
  serialize: JSON.stringify,
  deserialize: JSON.parse,
});

persistQueryClient({
  queryClient,
  persister,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days — survive a week between opens
  // Tied to the build hash — every deploy auto-invalidates the persisted
  // cache. No more manual "remember to bump v2 when you change a query".
  buster: BUILD_ID,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      const key = query.queryKey?.[0];
      const skipKeys = ['realtime', 'admin-members', 'admin-churn', 'admin-audit'];
      return query.state.status === 'success' && !skipKeys.includes(key);
    },
  },
});

// ── Aggressive flush: iOS WebView can be killed at any moment ─────────────
// Normally the sync persister writes on every mutation (throttled 1s). If the
// OS kills the app between a mutation and the throttled flush, that write is
// lost. Hooking pagehide/visibilitychange gives us a last-chance flush.
const flushCache = () => {
  try {
    const state = queryClient.getQueryCache().getAll();
    const serialized = state
      .filter(q => q.state.status === 'success' && !['realtime', 'admin-members', 'admin-churn', 'admin-audit'].includes(q.queryKey?.[0]))
      .map(q => ({ queryKey: q.queryKey, state: q.state }));
    const snapshot = {
      buster: BUILD_ID,
      timestamp: Date.now(),
      clientState: { queries: serialized, mutations: [] },
    };
    window.localStorage.setItem('tugympr-query-cache', JSON.stringify(snapshot));
  } catch { /* localStorage full or serialization failure — skip */ }
  // Mirror localStorage → @capacitor/preferences on native. Protects the
  // workout draft + RQ cache from WKWebView eviction under memory pressure.
  flushToDurable();
};
window.addEventListener('pagehide', flushCache);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushCache();
});

// ── App-resume recovery ────────────────────────────────────────────────────
// After a real spell in the background, refresh the auth token, wake the
// realtime socket (non-destructively — see appResume.js), and refetch stale
// data. Fixes the "left it open, came back, nothing reloaded until I killed
// and reopened the app" bug across member / admin / front-desk surfaces.
installAppResume(queryClient);

// ── Cold-start warm-up ────────────────────────────────────────────────────
// If we have a Supabase session cached in localStorage already, kick off the
// dashboard + notifications fetches immediately — before AuthContext / App.jsx
// has even hydrated. The moment the UI mounts, the cache either has data or
// an in-flight query, so no skeleton flashes.
//
// Token freshness gate: we read `expires_at` from the persisted session and
// SKIP the warm-up if the token is already expired (or within 60s of it).
// Without this gate, an expired cached token would fire two 401s into the
// error tracker on every cold load — Supabase auth auto-refreshes shortly
// after, so the component-level queries succeed anyway, but the 401 noise
// pollutes the console and the error log. Skipping is cheap — the regular
// React Query mounts on AuthContext-resolved will refetch in <500ms.
(async () => {
  try {
    const sessionKey = Object.keys(window.localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!sessionKey) return;
    const raw = window.localStorage.getItem(sessionKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const userId = parsed?.user?.id || parsed?.currentSession?.user?.id;
    if (!userId) return;

    // expires_at is unix seconds (Supabase auth-js convention). Anything
    // within 60s of now is effectively expired by the time the request
    // hits the server.
    const expiresAt = parsed?.expires_at || parsed?.currentSession?.expires_at;
    if (expiresAt && Number(expiresAt) * 1000 < Date.now() + 60_000) {
      return; // stale token — let auth refresh, then normal queries run
    }

    // Fire-and-forget — in-flight queries dedupe automatically
    queryClient.prefetchQuery({
      queryKey: ['dashboard', userId],
      queryFn: async () => {
        const { data, error } = await supabase.rpc('get_dashboard_data');
        if (error) throw error;
        return data;
      },
    }).catch(() => {});
    queryClient.prefetchQuery({
      queryKey: ['notifications', userId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('notifications')
          .select('id, title, body, type, read_at, created_at, profile_id')
          .eq('profile_id', userId)
          .is('dismissed_at', null)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return data;
      },
    }).catch(() => {});
  } catch { /* warm-up is best-effort */ }
})();

const isNative = Capacitor.isNativePlatform();
const Router = isNative ? MemoryRouter : BrowserRouter;

// Tell Capgo the app loaded successfully (enables OTA live updates)
CapacitorUpdater.notifyAppReady();

// Initialize Apple Watch communication bridge
initWatchListeners();

// Global error tracking — catches JS errors, promise rejections, network failures, slow APIs, auth/HTTP errors
// These listeners are intentionally never removed: they live at module scope and their
// lifetime matches the application's lifetime (the module is loaded once and never unloaded).
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

// On iOS, scroll focused input into view when keyboard opens
if (isNative) {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }
  });
}

// Handle watch messages at app level (routines sync, QR open, etc.)
onWatchMessage(async (msg) => {
  if (!msg) return;
  const action = msg.action || msg.type;

  if (action === 'request_routines') {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
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
                // Inline calendar-week math (no top-level import — main.jsx is the bootstrap).
                const _start = new Date(prog.program_start); _start.setHours(0, 0, 0, 0);
                const _sunday = new Date(_start); _sunday.setDate(_sunday.getDate() - _sunday.getDay());
                const _today = new Date(); _today.setHours(0, 0, 0, 0);
                const weekNum = Math.floor((_today - _sunday) / 86400000 / 7) + 1;
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

  if (action === 'request_qr_png') {
    // Watch asked us to (re)send the pre-rendered QR PNG.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (userId) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('qr_code_payload')
          .eq('id', userId)
          .maybeSingle();
        if (prof?.qr_code_payload) {
          syncQRToWatch(prof.qr_code_payload).catch(() => {});
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
    // Watch users are already in motion — they don't see the phone's warm-up
    // gate, so the Watch sends `skipWarmUp: true` to keep the two surfaces in
    // sync. Encode as a query param because the watch-navigate event channel
    // only carries a path string.
    const skipWarmUp = msg.skipWarmUp === true || msg.skipWarmUp === 'true';
    const path = `/session/${msg.routineId}${skipWarmUp ? '?skipWarmUp=1' : ''}`;
    window.__watchPendingNav = path;
    window.dispatchEvent(new CustomEvent('watch-navigate', { detail: path }));
    // Fire notification in case app is in background
    if (isNative) {
      import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
        LocalNotifications.schedule({
          notifications: [{
            id: 99902,
            title: 'TuGymPR',
            body: 'Tap to start your workout',
            sound: 'default',
            extra: { action: 'start_workout', routineId: msg.routineId, skipWarmUp },
          }]
        }).catch(() => {});
      }).catch(() => {});
    }
  }

  // ── Watch quick-start tiles (Cardio · free / Free lift / Mobility) ────────
  // The Watch's StartWorkoutChoiceView surfaces three "free-form" tiles in
  // addition to the user's saved routines. Tapping one fires a dedicated
  // action that the iPhone interprets and routes to the matching surface.
  if (action === 'start_cardio_free') {
    const path = '/cardio-live';
    window.__watchPendingNav = path;
    window.dispatchEvent(new CustomEvent('watch-navigate', { detail: path }));
  }
  if (action === 'start_free_lift') {
    // Phone path for "Free lift" is the empty session — same surface the
    // Quick Start screen uses. Skip warmup since the Watch user is in the gym.
    // If the watch supplied a pre-picked exercise we encode it as a query
    // param so ActiveSession (or a tab listener) can seed it as the first
    // exercise instead of starting blank.
    const exId = msg.exerciseId ? `&exerciseId=${encodeURIComponent(String(msg.exerciseId))}` : '';
    const exName = msg.exerciseName ? `&exerciseName=${encodeURIComponent(String(msg.exerciseName))}` : '';
    const path = `/session/empty?skipWarmUp=1${exId}${exName}`;
    window.__watchPendingNav = path;
    window.dispatchEvent(new CustomEvent('watch-navigate', { detail: path }));
  }

  // ── Open the Nutrition page from the Watch Log Food tile ──────────────
  if (action === 'open_nutrition') {
    const path = '/nutrition';
    window.__watchPendingNav = path;
    window.dispatchEvent(new CustomEvent('watch-navigate', { detail: path }));
  }

  // ── Watch-tracked free-lift session — log into workout_sessions ──────
  // The Watch's free-lift flow tracks every set on the wrist (so the user
  // doesn't depend on the phone being open) and ships the entire session
  // on Save & End. We persist via the standard complete_workout RPC so it
  // counts toward streak / PRs / XP exactly like a phone-tracked workout.
  // Payload shape (multi-exercise):
  //   { exercises: [{id, name, sets: [{weight, reps, set_number, skipped?}]}],
  //     duration_seconds, started_at, completed_at }
  // Legacy single-exercise shape (`exercise_id` / `exercise_name` / `sets`)
  // is also still accepted so older watch builds keep saving correctly.
  if (action === 'watch_workout_complete') {
    (async () => {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession?.user?.id) {
          console.warn('[watch] free-lift save skipped — not authenticated');
          return;
        }

        // Normalise into the multi-exercise shape regardless of payload form.
        let entries;
        if (Array.isArray(msg.exercises) && msg.exercises.length > 0) {
          entries = msg.exercises;
        } else {
          entries = [{
            id:   msg.exercise_id || null,
            name: msg.exercise_name || 'Exercise',
            sets: Array.isArray(msg.sets) ? msg.sets : [],
          }];
        }

        const phoneExercises = [];
        let totalVolume = 0;
        let totalCompleted = 0;
        entries.forEach((entry, idx) => {
          const exerciseId = entry.id || null;
          const exerciseName = entry.name || `Exercise ${idx + 1}`;
          const rawSets = Array.isArray(entry.sets) ? entry.sets : [];
          // Drop skipped sets from the saved record — they don't represent
          // work the user actually did. (We still keep the entry visible.)
          const realSets = rawSets.filter((s) => !s.skipped);
          if (realSets.length === 0) return;
          const phoneSets = realSets.map((s) => ({
            weight: Number(s.weight) || 0,
            reps:   Number(s.reps)   || 0,
            is_pr:  false,
          }));
          totalVolume += phoneSets.reduce((sum, s) => sum + (s.weight * s.reps), 0);
          totalCompleted += phoneSets.length;
          phoneExercises.push({
            exercise_id: exerciseId,
            name:        exerciseName,
            position:    phoneExercises.length,
            sets:        phoneSets,
          });
        });

        if (phoneExercises.length === 0) {
          console.log('[watch] free-lift save skipped — no logged sets');
          return;
        }

        const completedAt = msg.completed_at || new Date().toISOString();
        const startedAt   = msg.started_at   || new Date(Date.now() - (Number(msg.duration_seconds) || 1) * 1000).toISOString();
        const routineName = phoneExercises.length > 1
          ? 'Free Lift'
          : phoneExercises[0].name;
        const payload = {
          routine_name:     routineName,
          started_at:       startedAt,
          completed_at:     completedAt,
          duration_seconds: Math.max(1, Number(msg.duration_seconds) || 0),
          total_volume_lbs: totalVolume,
          completed_sets:   totalCompleted,
          exercises:        phoneExercises,
          session_prs:      [],
        };
        const { error } = await supabase.rpc('complete_workout', { p_payload: payload });
        if (error) {
          console.warn('[watch] complete_workout failed:', error.message);
        } else {
          console.log(`[watch] free-lift session saved — ${phoneExercises.length} exercise(s), ${totalCompleted} set(s)`);
        }
      } catch (e) {
        console.warn('[watch] watch_workout_complete failed:', e?.message || e);
      }
    })();
  }

  // ── Watch-tracked cardio session — log into cardio_sessions ──────────
  // The Watch's LiveCardioWatchView ships duration + HR + cal (and
  // sometimes distance) on End. Persist via the same RPC the iPhone uses
  // so streak / activity feed / leaderboards all pick it up automatically.
  if (action === 'watch_cardio_session') {
    (async () => {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession?.user?.id) return;
        const payload = {
          cardio_type:        msg.cardio_type || 'other',
          duration_seconds:   Math.max(1, Number(msg.duration_seconds) || 0),
          calories_burned:    Number(msg.calories_burned) || null,
          avg_heart_rate:     Number(msg.avg_heart_rate)  || null,
          distance_km:        msg.distance_km != null ? Number(msg.distance_km) : null,
          source:             'watch',
        };
        const { error } = await supabase.rpc('log_cardio_session', { p_payload: payload });
        if (error) console.warn('[watch] log_cardio_session RPC failed:', error.message);
      } catch (e) {
        console.warn('[watch] watch_cardio_session save failed:', e?.message || e);
      }
    })();
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
    // Watch for theme changes to update status bar.
    // This observer is intentionally never disconnected: it is created at module scope
    // (inside a one-time dynamic import) and its lifetime matches the application's
    // lifetime. The module is loaded once on native platforms and never unloaded.
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

    // Handle deep links / Universal Links (opens app with a URL)
    CapApp.addListener('appUrlOpen', ({ url }) => {
      try {
        const parsed = new URL(url);
        const path = parsed.pathname;
        // /invite/CODE → store code and push to signup
        const inviteMatch = path.match(/\/invite\/([A-Z0-9-]+)$/i);
        if (inviteMatch) {
          localStorage.setItem('pendingInviteCode', inviteMatch[1].toUpperCase());
          window.dispatchEvent(new CustomEvent('deeplink', { detail: { path: '/signup' } }));
        }
        // /friend/CODE → store code for post-login processing
        const friendMatch = path.match(/\/friend\/([A-Z0-9]+)$/i);
        if (friendMatch) {
          localStorage.setItem('pendingFriendCode', friendMatch[1].toUpperCase());
          window.dispatchEvent(new CustomEvent('deeplink', { detail: { path: '/' } }));
        }
      } catch {}
    });

    // Handle app state changes (resume/pause)
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        // App resumed from background — check for OTA updates and run the
        // resume recovery (token refresh + realtime wake + data refetch).
        // appStateChange is the canonical native signal; visibilitychange is
        // less reliable in the WebView. notifyForeground is a no-op if we
        // weren't backgrounded long enough or already healed via visibility.
        CapacitorUpdater.notifyAppReady();
        notifyForeground(queryClient);
      } else {
        // App going to background: flush localStorage → preferences NOW so
        // iOS can suspend/kill the WebView without losing recent writes (the
        // workout draft, RQ cache, etc.). Fire-and-forget; the OS will give
        // the JS task a brief window to settle.
        flushCache();
        notifyBackground();
      }
    });

    // Cold-start deep link: if iOS killed the WebView while an active workout
    // draft exists, jump straight to the session so the ActiveSession restore
    // path runs instead of the user landing on Dashboard and having to re-open.
    // Await durable hydration first — without this, an evicted localStorage
    // would miss the draft even though @capacitor/preferences has it.
    whenHydrated().then(() => {
      try {
        const draftKeys = Object.keys(window.localStorage).filter(k => k.startsWith('gym_session_'));
        for (const k of draftKeys) {
          const raw = window.localStorage.getItem(k);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          // Only deep-link if the draft is recent (last 6 h) and not marked ended
          const age = Date.now() - new Date(parsed?.startedAt || 0).getTime();
          if (parsed?.loggedSets && age > 0 && age < 6 * 60 * 60 * 1000) {
            const routineId = k.replace('gym_session_', '');
            if (routineId && window.location.pathname !== `/session/${routineId}`) {
              window.history.replaceState(null, '', `/session/${routineId}?resume=1`);
            }
            break;
          }
        }
      } catch { /* localStorage unavailable or malformed draft */ }
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

// Lazy PostHog wrapper — renders children immediately, then wraps with the
// real PostHogProvider once the chunk loads. Analytics events fired before
// the provider mounts are simply missed (acceptable tradeoff for faster TTI).
function LazyPostHogProvider({ apiKey, options, children }) {
  const [Provider, setProvider] = React.useState(null);

  React.useEffect(() => {
    import('@posthog/react').then((mod) => {
      setProvider(() => mod.PostHogProvider);
    }).catch(() => {});
  }, []);

  if (Provider) {
    return <Provider apiKey={apiKey} options={options}>{children}</Provider>;
  }
  return children;
}

// Stuck-loading recovery watcher. Mounted on its own React root, OUTSIDE
// the main provider tree — so if AuthProvider / QueryClient / Router throw
// and the app below never renders, the watcher still runs its timer and
// can auto-recover (cache wipe + reload) or surface the manual banner.
// HMR guard — Vite HMR resets module-level state on every file save, so a
// `let mounted = false` flag won't survive across hot reloads. Stashing the
// root on `window` instead so the SAME instance is preserved across HMR
// reruns of main.jsx, and on subsequent runs we just .render() into the
// existing root instead of creating a new one (which React 18 warns about).
// In production main.jsx executes once, so this is purely dev-quality.
const mountRecoveryRoot = () => {
  try {
    let host = document.getElementById('recovery-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'recovery-root';
      document.body.appendChild(host);
    }
    if (!window.__tugymRecoveryRoot) {
      window.__tugymRecoveryRoot = ReactDOM.createRoot(host);
    }
    window.__tugymRecoveryRoot.render(<StuckLoadingRecovery />);
  } catch { /* if even this fails, nothing more we can do */ }
};

// Same HMR guard as the recovery root — Vite re-runs main.jsx on file save
// and React 18 logs a "createRoot called twice" warning if we mount a
// second root on #root. Persisting the root on `window` so HMR re-renders
// reuse the existing one. (Production main.jsx runs once → noop.)
const renderApp = () => {
  // Mount recovery FIRST so its 10s timer is already running regardless of
  // whether the main render below throws synchronously.
  mountRecoveryRoot();

  if (!window.__tugymAppRoot) {
    window.__tugymAppRoot = ReactDOM.createRoot(document.getElementById('root'));
  }
  window.__tugymAppRoot.render(
    <React.StrictMode>
      {/* Top-level ErrorBoundary — catches a synchronous throw from ANY
          provider (AuthProvider, ThemeProvider, Router) or from <App />
          itself. Without it, such a throw leaves #root empty → black
          screen with no recovery. The per-route ErrorBoundaries inside
          App only catch throws below <Routes>. The StuckLoadingRecovery
          watcher on its own root is the last-resort net beneath this. */}
      <ErrorBoundary>
        <LazyPostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN} options={posthogOptions}>
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
        </LazyPostHogProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
  // Hide the launch splash explicitly on the next paint frame. Combined with
  // launchShowDuration: 800 in capacitor.config, this typically hides ~500ms
  // sooner than the timer alone — perceived launch goes from 2s to <800ms.
  if (isNative) {
    requestAnimationFrame(() => {
      import('@capacitor/splash-screen').then(({ SplashScreen }) => {
        SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
      }).catch(() => {});
    });
  }
};

// Wait for:
//   1. Durable storage hydration (native only) — gives ActiveSession + RQ
//      persister access to the workout draft / cache before first render.
//   2. i18n primary-locale `pages` namespace — first paint already shows
//      localized strings instead of raw keys.
// Both are hard-capped at 800ms so a misbehaving plugin or slow chunk fetch
// never blocks startup indefinitely.
const bootGates = [i18nPrimaryReady];
if (isNative) bootGates.push(hydrateFromDurable());
Promise.race([
  Promise.all(bootGates),
  new Promise((resolve) => setTimeout(resolve, 800)),
]).finally(renderApp);
