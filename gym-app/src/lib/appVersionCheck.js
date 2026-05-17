// appVersionCheck.js
// Single-source-of-truth for whether the bundled client is allowed to talk
// to the current API. Polls the `get_app_version` RPC on cold start and
// every 15 minutes thereafter; if the bundled version (injected by
// vite.config.js as `__APP_VERSION__` from package.json) is below the
// server's `min_required_version`, every subscriber is notified and the
// global UpdateRequiredModal mounts a hard gate over the app.
//
// We deliberately do NOT intercept every Supabase response — Supabase REST
// has no global response header we can rely on, and adding a check to every
// request would either add latency or duplicate this poll. A 15 min cadence
// catches a freshly-bumped min version inside one session, which is enough
// for a hard-gate rollout to drain user traffic onto the new build.

import { supabase } from './supabase';

const POLL_INTERVAL_MS = 15 * 60 * 1000;

// eslint-disable-next-line no-undef
export const CLIENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

const listeners = new Set();
let pollTimer = null;
let inflight = null;
// Default status — `outdated: false` until we hear from the server, so a
// cold-start before the first RPC settles doesn't paint the gate by mistake.
let currentStatus = {
  outdated:           false,
  clientVersion:      CLIENT_VERSION,
  minRequired:        null,
  latest:             null,
  iosStoreUrl:        null,
  androidStoreUrl:    null,
  lastCheckedAt:      null,
};

function parseSemver(v) {
  if (!v || typeof v !== 'string') return [0, 0, 0];
  // Strip any "-beta.1" / "+build" suffix so 1.2.3-rc1 still compares.
  const core = v.split(/[-+]/)[0];
  const parts = core.split('.').map((p) => Number.parseInt(p, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareSemver(a, b) {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

function notify() {
  listeners.forEach((cb) => { try { cb(currentStatus); } catch { /* listener crash shouldn't break others */ } });
}

// QA / dev escape hatch: setting `__forceUpdateGate = '1'` in localStorage
// forces the modal to paint regardless of what the server says, so the gate
// can be smoke-tested without bumping the DB. Read on every fetch so the
// flag can be toggled at runtime from the devtools console.
function readForceFlag() {
  try { return typeof window !== 'undefined' && window.localStorage?.getItem('__forceUpdateGate') === '1'; }
  catch { return false; }
}

async function fetchVersion() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_app_version');
      const forced = readForceFlag();
      if ((error || !data) && !forced) return;
      const minRequired = data?.min_required_version || (forced ? '999.999.999' : '0.0.0');
      const outdated = forced || compareSemver(CLIENT_VERSION, minRequired) < 0;
      currentStatus = {
        outdated,
        clientVersion:   CLIENT_VERSION,
        minRequired,
        latest:          data?.latest_version || null,
        iosStoreUrl:     data?.ios_store_url || null,
        androidStoreUrl: data?.android_store_url || null,
        lastCheckedAt:   Date.now(),
        forced,
      };
      notify();
    } catch {
      // Offline / RPC error — keep last-known status. The gate fails open
      // so a Supabase outage doesn't lock everyone out.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function getClientVersion() { return CLIENT_VERSION; }
export function getVersionStatus() { return currentStatus; }

export function subscribeToVersion(cb) {
  listeners.add(cb);
  // Fire once immediately with whatever we know so the modal can paint
  // straight away if we've already detected an outdated client.
  try { cb(currentStatus); } catch { /* subscriber threw — ignore */ }
  return () => listeners.delete(cb);
}

export function startVersionCheck() {
  fetchVersion();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchVersion, POLL_INTERVAL_MS);
}

export function stopVersionCheck() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Re-check when the tab/app comes back to the foreground — covers the case
// where the user backgrounded the app for hours and a new min version was
// shipped while they were away. Cheap (one RPC) and only fires on resume.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fetchVersion();
  });
}
