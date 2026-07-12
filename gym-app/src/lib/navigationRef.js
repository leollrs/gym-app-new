// Bridge between modules that live outside the Router lifecycle (AuthContext,
// auth interceptors, error handlers) and react-router's useNavigate.
//
// On Capacitor, `window.location.href = '/login'` reloads `capacitor://localhost/login`
// from disk, blowing away JS state, in-flight fetches, and pending native callbacks.
// This module lets non-component code call navigate() instead.

let navigateFn = null;

export function setNavigateFn(fn) {
  navigateFn = fn;
}

// ── Router-truth path + in-app back-stack depth ───────────────
// On native the app runs under MemoryRouter, which never updates
// `window.location` or `window.history`. So the Android hardware-back handler
// in main.jsx cannot read the current route from window.location (it's frozen
// at the static base → every page looked like a "main page" and the app
// minimized on every back press), and `window.history.back()` was a no-op.
// <NavBridge> in App.jsx feeds the live route + navigation type here so the
// back handler can tell a sub-page from a tab and go back via the router.
let currentPath = '/';
let navDepth = 0;

export function setCurrentPath(path) {
  if (typeof path === 'string' && path) currentPath = path;
}

export function getCurrentPath() {
  return currentPath;
}

// Called on every navigation with react-router's navigation type. Tracks how
// deep we are in the in-app stack so back can distinguish "go back" from
// "nothing to go back to → home".
export function noteNavigation(navigationType) {
  if (navigationType === 'PUSH') navDepth += 1;
  else if (navigationType === 'POP') navDepth = Math.max(0, navDepth - 1);
  // REPLACE leaves depth unchanged (it swaps the top of the stack).
}

export function canGoBackInApp() {
  return navDepth > 0;
}

export function safeNavigate(to, options) {
  if (typeof navigateFn === 'function') {
    try {
      navigateFn(to, options);
      return true;
    } catch (err) {
      console.warn('[safeNavigate] navigate threw:', err);
    }
  }
  // Fallback for the brief window before App mounts and the bridge registers.
  // On Capacitor this still kills the WebView, but it's better than silently
  // doing nothing — the session-expiry guard in AuthContext can fire on cold
  // mount before <NavigateBridge /> attaches.
  try {
    if (typeof to === 'string' && typeof window !== 'undefined') {
      const replace = options?.replace;
      if (replace) window.location.replace(to);
      else window.location.assign(to);
    }
  } catch {}
  return false;
}

export function safeReload() {
  // navigate(0) in react-router v6 refreshes the current route without
  // reloading the bundle — preferred on Capacitor where window.location.reload
  // can leave a black screen if the service worker isn't in scope.
  if (typeof navigateFn === 'function') {
    try {
      navigateFn(0);
      return;
    } catch {}
  }
  try {
    if (typeof window !== 'undefined') window.location.reload();
  } catch {}
}
