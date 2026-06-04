// Module-level memory of the last route path that rendered WITHOUT crashing.
//
// Written by <ErrorBoundary> (the only place that knows whether its children
// committed cleanly) and read by <RouteErrorBoundary>'s "Reiniciar" handler so
// it can send the user back to a safe page after a crash.
//
// Kept outside React state on purpose: it must survive the crash render and be
// reachable from a class component without prop-drilling through every route.
let _lastGoodPath = null;

export function recordGoodPath(path) {
  if (typeof path === 'string' && path) _lastGoodPath = path;
}

export function getLastGoodPath() {
  return _lastGoodPath;
}
