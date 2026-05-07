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
