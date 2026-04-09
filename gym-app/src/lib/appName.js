// Returns the white-label app name for use in document.title etc.
// Falls back to 'TuGymPR' if gym config hasn't loaded yet.
// Uses window global to avoid import overhead across 38+ files.
window.__APP_NAME = window.__APP_NAME || 'TuGymPR';

export function setAppName(name) {
  if (name) window.__APP_NAME = name;
}

export function getAppName() {
  return window.__APP_NAME || 'TuGymPR';
}
