// gpsTracker.js
// -----------------------------------------------------------------------------
// Lightweight wrapper around @capacitor/geolocation that captures a continuous
// stream of fixes while a cardio session is active. Exposes:
//   • distance (meters, cumulative, Haversine between consecutive fixes)
//   • instantaneous pace  (rolling 30s average, seconds per km)
//   • average pace        (total seconds / total km)
//   • elevation gain      (sum of positive altitude deltas)
//   • splits              (auto-lapped per km or per mile)
//   • route polyline      [{ lat, lng, t }, ...]  — suitable for JSONB storage
//
// Intended usage:
//   const t = createGpsTracker({ unit: 'km' });
//   await t.requestPermissions();
//   await t.start();         // begins watchPosition
//   t.onUpdate((state) => { ... });
//   t.pause();  t.resume();
//   const snap = await t.stop();   // final summary
//
// NOTE: iOS background location requires `UIBackgroundModes: ['location']` in
// Info.plist AND an allowsBackgroundLocationUpdates flag set by the native
// layer. This module is production-ready for foreground tracking; background
// behavior is passively supported via the Capacitor plugin's watchPosition but
// should be validated on-device before shipping to members.
// -----------------------------------------------------------------------------

import { Geolocation as CapGeolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
  requestBackgroundLocationPermissions,
  checkBackgroundLocationPermissions,
} from './backgroundLocationBridge';

const EARTH_R_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine distance between two {lat, lng} points, in meters.
export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Format seconds/km (or seconds/mi) as "M:SS"
export function formatPace(secPerUnit) {
  if (!secPerUnit || !Number.isFinite(secPerUnit) || secPerUnit <= 0) return '--:--';
  const m = Math.floor(secPerUnit / 60);
  const s = Math.floor(secPerUnit % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function createGpsTracker({
  unit = 'km',                // 'km' or 'mi'
  accuracyThreshold = 15,     // drop fixes worse than this (meters) — tighter to kill noise
  smoothingWindow = 4,        // number of recent fixes to smooth pace over
  paceWindowSec = 60,         // rolling window for "current pace" — 60s gives a stable reading
  minSpeedMps = 0.5,          // below this, treat as stationary (≈1.8 km/h)
  emitMinIntervalMs = 1500,   // UI throttle — don't emit more than this often
  emitMinDistanceM = 5,       // don't emit unless we've moved 5m since last emit
  // Resume seed — when the app was backgrounded mid-run and the WebView got
  // killed, re-create the tracker with the saved progress so distance, route
  // polyline, splits, elevation gain, and elapsed time all survive the reload.
  // Shape: { distanceM, route: [{lat,lng,t}], splits, elevationGainM, elapsedOffsetSec }
  seed = null,
} = {}) {
  const unitMeters = unit === 'mi' ? 1609.344 : 1000;

  let watchId = null;
  let Geolocation = null;
  let usingBackgroundPlugin = false;

  const state = {
    active: false,
    paused: false,
    startedAt: null,
    pausedAccumMs: 0,
    lastPauseAt: null,

    // Moving-time accumulator — incremented in handleFix only when a fix
    // actually represents movement (passes the jitter / speed gates). Used
    // for avg pace so a runner who pauses at a stoplight or stands at a
    // gym lobby for 5 minutes doesn't see their average pace blow up to
    // 100 min/km. Mirrors Strava's "moving pace" metric.
    movingTimeMs: 0,

    points: [],          // kept fixes: { lat, lng, altitude, accuracy, t, dist }
    distanceM: 0,
    elevationGainM: 0,
    splits: [],          // [{ km: 1, seconds: 312, pace_sec_per_km }]
    lastSplitM: 0,
    lastSplitT: null,
    lastEmitAtMs: 0,
    lastEmitDistanceM: 0,
  };

  const listeners = new Set();
  function emitNow() {
    const snap = snapshot();
    state.lastEmitAtMs = Date.now();
    state.lastEmitDistanceM = state.distanceM;
    listeners.forEach(fn => { try { fn(snap); } catch {} });
  }
  // Rate-limited emit — combine the time throttle + minimum-distance gate so
  // downstream UI (React state) doesn't re-render multiple times per second.
  function emit({ force = false } = {}) {
    if (force) { emitNow(); return; }
    const now = Date.now();
    const timeOk = (now - state.lastEmitAtMs) >= emitMinIntervalMs;
    const distOk = Math.abs(state.distanceM - state.lastEmitDistanceM) >= emitMinDistanceM;
    if (timeOk || distOk) emitNow();
  }

  async function ensurePlugin() {
    // Static import — more reliable in the Capacitor WebView than dynamic
    // import which can fail silently when the bundler can't resolve the
    // plugin module at runtime.
    if (!Geolocation) Geolocation = CapGeolocation;
    return Geolocation;
  }

  async function requestPermissions() {
    const isNative = Capacitor?.isNativePlatform?.() === true;
    console.log('[gpsTracker] requestPermissions start, isNative=', isNative);

    // On native iOS/Android, route the permission request through the custom
    // BackgroundLocation plugin. It owns the single CLLocationManager whose
    // delegate fires the real iOS system dialog. Using navigator.geolocation
    // here competes with our native plugin for the delegate and has been
    // observed to silently swallow the prompt — most visibly, the app never
    // appears in Settings > Privacy > Location Services.
    if (isNative) {
      try {
        console.log('[gpsTracker] requestPermissions → native BackgroundLocation plugin');
        const existing = await checkBackgroundLocationPermissions();
        console.log('[gpsTracker] existing permission status:', existing?.location);
        if (existing?.location === 'granted' || existing?.location === 'denied' || existing?.location === 'restricted') {
          return existing;
        }
        const res = await requestBackgroundLocationPermissions();
        console.log('[gpsTracker] native requestPermissions result:', res);
        return res;
      } catch (err) {
        console.warn('[gpsTracker] native permission request failed:', err);
        return { location: 'denied' };
      }
    }

    // Web fallback — navigator.geolocation.getCurrentPosition triggers the
    // browser's permission prompt.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      console.log('[gpsTracker] requestPermissions → navigator.geolocation (web)');
      return new Promise((resolve) => {
        let settled = false;
        const finish = (loc) => {
          if (settled) return;
          settled = true;
          console.log('[gpsTracker] navigator.geolocation result:', loc);
          resolve({ location: loc });
        };
        const hardTimeout = setTimeout(() => finish('timeout'), 20000);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(hardTimeout);
            console.log('[gpsTracker] initial fix:', pos?.coords);
            finish('granted');
          },
          (err) => {
            clearTimeout(hardTimeout);
            console.warn('[gpsTracker] navigator.geolocation err:', err?.code, err?.message);
            finish(err?.code === 1 ? 'denied' : 'unavailable');
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      });
    }

    return { location: 'prompt' };
  }

  function handleFix(position) {
    if (!state.active || state.paused) return;
    const coords = position?.coords;
    if (!coords) return;
    // Log the first 10 fixes so we can verify on-device that watchPosition is
    // actually firing. After that, stay quiet to keep the console clean.
    if (state.points.length < 10) {
      try {
        console.log('[gpsTracker] fix', state.points.length, {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          altitude: coords.altitude,
          t: position.timestamp || Date.now(),
        });
      } catch {}
    }
    // Accuracy gate. iOS commonly returns a ~1500m cell-tower fix as the
    // very first reading — accepting it would plant the start marker miles
    // away and inject a phantom 1km segment into the polyline as soon as
    // the real GPS lock arrives. So we require ≤100m for the first fix,
    // ≤30m during warmup (next 4 fixes), then the strict 15m thereafter.
    const effectiveThreshold =
      state.points.length === 0 ? 100 :
      state.points.length < 5  ? 30 :
      accuracyThreshold;
    if (!coords.accuracy || coords.accuracy > effectiveThreshold) return;

    const now = position.timestamp || Date.now();
    const point = {
      lat: coords.latitude,
      lng: coords.longitude,
      altitude: coords.altitude ?? null,
      accuracy: coords.accuracy ?? null,
      t: now,
    };

    const prev = state.points[state.points.length - 1];
    if (prev) {
      const d = haversineMeters(prev, point);
      const dtSec = Math.max(0.001, (point.t - prev.t) / 1000);

      // Jitter filter 1 — minimum displacement gate. GPS has 3-20m noise even
      // when stationary, so tiny moves are almost always noise. Use the larger
      // of 2m or the reported accuracy as the noise floor.
      const noiseFloor = Math.max(2, coords.accuracy || 0);

      // Jitter filter 2 — minimum speed gate. Prefer the device-reported speed
      // (iOS CLLocation.speed is often available and smoothed) and fall back to
      // derived speed. Below 0.5 m/s we're effectively stationary.
      const reportedSpeed = typeof coords.speed === 'number' && coords.speed >= 0
        ? coords.speed
        : null;
      const derivedSpeed = d / dtSec;
      const speedMps = reportedSpeed != null ? reportedSpeed : derivedSpeed;

      // Jitter filter 3 — teleport rejection (unchanged; GPS sometimes jumps)
      const isTeleport = derivedSpeed >= 50;

      const isMovement = !isTeleport && d >= noiseFloor && speedMps >= minSpeedMps;

      if (isMovement) {
        state.distanceM += d;
        // Only accumulate moving time when this delta represents real movement.
        // Cap a single inter-fix delta at 30s — covers the common GPS pattern of
        // a long-stale fix arriving after a tunnel / signal loss without
        // exploding moving time.
        state.movingTimeMs += Math.min(30000, dtSec * 1000);
        point.dist = state.distanceM;
        if (point.altitude != null && prev.altitude != null) {
          const dAlt = point.altitude - prev.altitude;
          if (dAlt > 0.5) state.elevationGainM += dAlt; // tiny threshold to ignore noise
        }
      } else {
        // Don't accumulate distance — this is stationary noise or a jump.
        point.dist = state.distanceM;
      }
    } else {
      point.dist = 0;
      state.lastSplitT = now;
    }
    state.points.push(point);

    // Auto split every unit (km/mi)
    while (state.distanceM - state.lastSplitM >= unitMeters) {
      const splitEndT = state.points[state.points.length - 1].t;
      const seconds = (splitEndT - (state.lastSplitT || splitEndT)) / 1000;
      const n = state.splits.length + 1;
      state.splits.push({
        index: n,
        unit,
        seconds,
        pace_sec_per_unit: seconds,
      });
      state.lastSplitM += unitMeters;
      state.lastSplitT = splitEndT;
    }

    emit();
  }

  // elapsedOffsetSec — optional override for the time already elapsed before
  // start() is called (e.g. the latency of the permission-request dialog). When
  // provided, startedAt is wound back so the GPS timer reflects wall-clock time
  // from the moment the user tapped Start, not just from when permission was
  // granted.
  async function start({ elapsedOffsetSec: callElapsedOffsetSec } = {}) {
    if (state.active) return;
    state.active = true;
    state.paused = false;
    // If we're resuming a backgrounded session, wind startedAt back so
    // elapsedSec() returns the correct accumulated time on the very first
    // emit — without this, the timer would visibly jump from 0 → real time.
    // callElapsedOffsetSec (permission-wait latency) takes precedence over the
    // seed value (which is for session resume from draft, not permission wait).
    const resolvedOffsetSec = callElapsedOffsetSec ?? seed?.elapsedOffsetSec ?? 0;
    const offsetMs = resolvedOffsetSec * 1000;
    state.startedAt = Date.now() - offsetMs;
    state.pausedAccumMs = 0;

    if (seed) {
      state.distanceM = seed.distanceM || 0;
      state.elevationGainM = seed.elevationGainM || 0;
      state.splits = Array.isArray(seed.splits) ? seed.splits.slice() : [];
      state.points = Array.isArray(seed.route)
        ? seed.route.map(p => ({
            lat: p.lat, lng: p.lng, t: p.t,
            altitude: p.altitude ?? null,
            accuracy: p.accuracy ?? null,
            dist: state.distanceM,
          }))
        : [];
      // Best-effort reconstruction of moving time from saved snapshot. If the
      // resume seed didn't carry movingTimeMs forward (older drafts), fall
      // back to elapsed offset so avg pace stays roughly correct.
      state.movingTimeMs = seed.movingTimeMs ?? ((seed.elapsedOffsetSec || 0) * 1000);
      state.lastSplitM = Math.floor(state.distanceM / unitMeters) * unitMeters;
      state.lastSplitT = state.points.length
        ? state.points[state.points.length - 1].t
        : null;
    } else {
      state.points = [];
      state.splits = [];
      state.distanceM = 0;
      state.elevationGainM = 0;
      state.movingTimeMs = 0;
      state.lastSplitM = 0;
      state.lastSplitT = null;
    }

    // On native iOS, use our BackgroundLocation custom plugin. It holds a
    // native CLLocationManager with allowsBackgroundLocationUpdates=true so
    // GPS continues firing when the app is backgrounded or the screen is
    // locked — WKWebView pauses navigator.geolocation in that state, which
    // stalls distance accumulation mid-run.
    if (Capacitor?.isNativePlatform?.()) {
      console.log('[gpsTracker] start() → BackgroundLocation native plugin');
      try {
        await startBackgroundLocation(
          (pos) => handleFix(pos),
          (err) => console.warn('[gpsTracker] BackgroundLocation error:', err?.message)
        );
        usingBackgroundPlugin = true;
        emit({ force: true });
        return;
      } catch (err) {
        console.warn('[gpsTracker] BackgroundLocation start failed, falling back:', err);
      }
    }

    // Web fallback — navigator.geolocation.watchPosition.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      console.log('[gpsTracker] start() → navigator.geolocation.watchPosition');
      watchId = navigator.geolocation.watchPosition(
        (pos) => handleFix(pos),
        (err) => console.warn('[gpsTracker] navigator watchPosition error:', err?.code, err?.message),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
      console.log('[gpsTracker] watchId =', watchId);
      return;
    }

    try {
      const plugin = await ensurePlugin();
      console.log('[gpsTracker] start() → watchPosition via Capacitor plugin');
      watchId = await plugin.watchPosition(
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        (position, err) => {
          if (err) { console.warn('[gpsTracker] watchPosition error:', err); return; }
          handleFix(position);
        }
      );
      console.log('[gpsTracker] watchId =', watchId);
    } catch (err) {
      // Web fallback
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        console.log('[gpsTracker] start() → navigator.geolocation.watchPosition (web fallback)');
        watchId = navigator.geolocation.watchPosition(
          (pos) => handleFix(pos),
          (geoErr) => { console.warn('[gpsTracker] web watchPosition error:', geoErr); },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
      } else {
        console.warn('[gpsTracker] no geolocation available', err);
        throw err;
      }
    }
    emit({ force: true });
  }

  function pause() {
    if (!state.active || state.paused) return;
    state.paused = true;
    state.lastPauseAt = Date.now();
    emit({ force: true });
  }

  function resume() {
    if (!state.active || !state.paused) return;
    if (state.lastPauseAt) {
      state.pausedAccumMs += Date.now() - state.lastPauseAt;
      state.lastPauseAt = null;
    }
    state.paused = false;
    emit({ force: true });
  }

  async function stop() {
    if (!state.active) return snapshot();
    try {
      if (usingBackgroundPlugin) {
        await stopBackgroundLocation();
        usingBackgroundPlugin = false;
      } else if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
        // watchId is numeric when using navigator.geolocation (primary path)
        navigator.geolocation.clearWatch(watchId);
      } else if (watchId != null) {
        const plugin = await ensurePlugin();
        if (plugin?.clearWatch) await plugin.clearWatch({ id: watchId });
      }
    } catch {}
    watchId = null;
    if (state.paused && state.lastPauseAt) {
      state.pausedAccumMs += Date.now() - state.lastPauseAt;
      state.lastPauseAt = null;
    }
    state.active = false;
    state.paused = false;
    const final = snapshot();
    emit({ force: true });
    return final;
  }

  function elapsedSec() {
    if (!state.startedAt) return 0;
    const end = state.paused && state.lastPauseAt ? state.lastPauseAt : Date.now();
    return Math.max(0, Math.floor((end - state.startedAt - state.pausedAccumMs) / 1000));
  }

  function currentPaceSecPerUnit() {
    // Rolling window: how long did we take for the last paceWindowSec seconds of movement?
    if (state.points.length < 2) return null;
    const now = state.points[state.points.length - 1].t;
    const cutoff = now - paceWindowSec * 1000;
    // Find the first point within the window
    let anchor = state.points[state.points.length - 2];
    for (let i = state.points.length - 1; i >= 0; i--) {
      if (state.points[i].t <= cutoff) { anchor = state.points[i]; break; }
      anchor = state.points[i];
    }
    const dMeters = Math.max(0.001, state.points[state.points.length - 1].dist - anchor.dist);
    const dSec = Math.max(0.001, (now - anchor.t) / 1000);
    const paceSecPerUnit = (dSec / dMeters) * unitMeters;
    if (!Number.isFinite(paceSecPerUnit) || paceSecPerUnit > 60 * 60) return null;
    return paceSecPerUnit;
  }

  function avgPaceSecPerUnit() {
    // Use MOVING time (only the seconds during which we were actually
    // moving) instead of elapsed time. Without this, standing still in
    // the gym lobby for 3 minutes and then running 1 km gave avg pace
    // ≈ "100 min/km" — the elapsed clock kept ticking but distance didn't.
    const units = state.distanceM / unitMeters;
    if (units < 0.05) return null;     // need ≥50m before pace is meaningful
    const movingSec = state.movingTimeMs / 1000;
    if (movingSec < 1) return null;
    const pace = movingSec / units;
    // Sanity cap — anything slower than 60 min/km is almost certainly noise
    // (or the user truly walking slower than 1 km/h, which we'd rather show
    // as "—" than as a wildly misleading number).
    if (!Number.isFinite(pace) || pace > 60 * 60) return null;
    return pace;
  }

  function snapshot() {
    return {
      active: state.active,
      paused: state.paused,
      unit,
      elapsedSec: elapsedSec(),
      movingTimeMs: state.movingTimeMs,
      distanceM: state.distanceM,
      distanceUnits: state.distanceM / unitMeters,
      elevationGainM: state.elevationGainM,
      currentPaceSecPerUnit: currentPaceSecPerUnit(),
      avgPaceSecPerUnit: avgPaceSecPerUnit(),
      route: state.points.map(p => ({ lat: p.lat, lng: p.lng, t: p.t })),
      splits: state.splits.slice(),
      pointCount: state.points.length,
    };
  }

  function onUpdate(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    start, pause, resume, stop,
    onUpdate, snapshot,
    requestPermissions,
  };
}

// Convert [{ lat, lng, ... }] → SVG polyline points string, projected into a
// [width × height] viewport with padding. Uses equirectangular projection —
// fine for <50 km runs and much cheaper than Web Mercator.
export function routeToSvgPoints(route, width = 320, height = 180, padding = 8) {
  if (!route || route.length < 2) return '';
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of route) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const latRange = Math.max(1e-6, maxLat - minLat);
  const lngRange = Math.max(1e-6, maxLng - minLng);
  const midLat = (minLat + maxLat) / 2;
  // Compensate longitude compression at latitude
  const lngScale = Math.cos(toRad(midLat));
  const normW = width - padding * 2;
  const normH = height - padding * 2;
  const scale = Math.min(normW / (lngRange * lngScale), normH / latRange);
  const offsetX = (normW - lngRange * lngScale * scale) / 2 + padding;
  const offsetY = (normH - latRange * scale) / 2 + padding;
  return route.map(p => {
    const x = offsetX + (p.lng - minLng) * lngScale * scale;
    const y = height - (offsetY + (p.lat - minLat) * scale); // invert y
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
