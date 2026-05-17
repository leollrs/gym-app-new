// LiveCardio.jsx
// -----------------------------------------------------------------------------
// Warm-paper Strava-style GPS cardio tracker. Supports:
//   • Type picker (pick) → active tracking → done
//   • GPS route capture for Run / Walk / Bike / Hike (via gpsTracker.js)
//   • Timer-only tracking for HIIT / Stairs / indoor rows, etc.
//   • Rolling-pace, average pace, elevation, distance, calories
//   • Live SVG polyline of the route so far
//   • Draft-persists to localStorage every 5s
//   • Share-this-run CTA that opens ShareCardioSheet
//   • Preserves existing log_cardio_session RPC + extra fields
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronDown,
  Footprints, Bike, Waves, CircleDot, TrendingUp,
  Zap, Droplets, PersonStanding, Flame,
  Swords, CircleDashed, Music, Mountain, Snowflake, Heart,
  Play, Pause, Square, MapPin, Activity as ActivityIcon, Share2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { estimateCardioCalories } from '../lib/cardioCalories';
import { recordCardioLogged } from '../lib/cardioLedger';
import { createGpsTracker, formatPace } from '../lib/gpsTracker';
import { prewarmBackgroundLocation } from '../lib/backgroundLocationBridge';
import { prerenderAndCache } from '../lib/renderRouteMap';
import ShareCardioSheet from '../components/share/ShareCardioSheet';
import RouteMap from '../components/cardio/RouteMap';
import { startLiveActivity, updateLiveActivity, endLiveActivity } from '../lib/liveActivityBridge';
import { App as CapApp } from '@capacitor/app';
import { useWakeLock } from '../hooks/useWakeLock';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

const CARDIO_MAIN = [
  { key: 'running',       icon: Footprints,     color: '#10B981', gps: true },
  { key: 'walking',       icon: PersonStanding, color: '#22C55E', gps: true },
  { key: 'cycling',       icon: Bike,           color: '#3B82F6', gps: true },
  { key: 'hiking',        icon: Mountain,       color: '#10B981', gps: true },
  { key: 'rowing',        icon: Waves,          color: '#06B6D4', gps: false },
  { key: 'elliptical',    icon: CircleDot,      color: '#8B5CF6', gps: false },
  { key: 'stair_climber', icon: TrendingUp,     color: '#F59E0B', gps: false },
  { key: 'hiit',          icon: Flame,          color: '#F97316', gps: false },
  { key: 'jump_rope',     icon: Zap,            color: '#EF4444', gps: false },
];

const CARDIO_MORE = [
  { key: 'swimming',      icon: Droplets,       color: '#0EA5E9', gps: false },
  { key: 'basketball',    icon: CircleDashed,   color: '#F97316', gps: false },
  { key: 'soccer',        icon: CircleDashed,   color: '#22C55E', gps: false },
  { key: 'tennis',        icon: CircleDashed,   color: '#FBBF24', gps: false },
  { key: 'boxing',        icon: Swords,         color: '#EF4444', gps: false },
  { key: 'dance',         icon: Music,          color: '#EC4899', gps: false },
  { key: 'yoga',          icon: Heart,          color: '#8B5CF6', gps: false },
  { key: 'pilates',       icon: Heart,          color: '#06B6D4', gps: false },
  { key: 'martial_arts',  icon: Swords,         color: '#DC2626', gps: false },
  { key: 'skiing',        icon: Snowflake,      color: '#60A5FA', gps: true },
  { key: 'other',         icon: Flame,          color: '#6B7280', gps: false },
];

const ALL_TYPES = [...CARDIO_MAIN, ...CARDIO_MORE];
const STORAGE_KEY = 'tugympr_live_cardio';

function formatTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Memoized — prevents every stat card re-rendering on every elapsed-time tick.
const Stat = memo(function Stat({ label, value, sub }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 10px',
        borderRadius: 18,
        background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
        minWidth: 0,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 22,
          fontWeight: 900,
          color: 'var(--color-text-primary)',
          letterSpacing: -0.5,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginTop: 3,
          fontFamily: FONT_BODY,
        }}
      >
        {label}
        {sub ? <span style={{ color: 'var(--color-text-subtle)', marginLeft: 4 }}>{sub}</span> : null}
      </div>
    </div>
  );
});

// Memoized RouteMap wrapper — Leaflet is expensive and we don't want it
// re-rendering on every 250ms timer tick.
const MemoRouteMap = memo(
  function MemoRouteMap({ points, height }) {
    return <RouteMap points={points} height={height} />;
  },
  (prev, next) => prev.points.length === next.points.length && prev.height === next.height
);

export default function LiveCardio() {
  const { t } = useTranslation('pages');
  const { user, profile, gymLogoUrl } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    document.title = t('cardio.title', 'Live Cardio') + ' | ' + (window.__APP_NAME || 'TuGymPR');
  }, [t]);

  // ── Flush any cardio sessions that were queued while offline ──
  useEffect(() => {
    if (!user?.id || !navigator.onLine) return;
    const key = `pending_cardio-${user.id}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    let queued;
    try { queued = JSON.parse(raw); } catch { queued = []; }
    if (!queued?.length) return;
    (async () => {
      const remaining = [];
      for (const item of queued) {
        try {
          const { error } = await supabase.rpc('log_cardio_session', { p_payload: item.payload });
          if (error) throw error;
        } catch {
          remaining.push(item);
        }
      }
      if (remaining.length) localStorage.setItem(key, JSON.stringify(remaining));
      else localStorage.removeItem(key);
    })();
  }, [user?.id]);

  // Default to imperial when metric_units is undefined — matches ActiveSession's
  // weight default (lb). Otherwise PR/US users see "1.61 km" for a 1-mile run,
  // assume the GPS is mis-converted, and lose trust in the tracker.
  const unit = profile?.metric_units === true ? 'km' : 'mi';

  // ── State restoration ─────────────────────────────────────
  const [saved] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && raw.phase) return raw;
    } catch {}
    return null;
  });

  const initialType = location.state?.cardioType || saved?.cardioType || 'running';
  const [phase, setPhase] = useState(saved?.phase || 'pick');
  const [cardioType, setCardioType] = useState(initialType);
  const [showMore, setShowMore] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const selectedType = ALL_TYPES.find(c => c.key === cardioType) || CARDIO_MAIN[0];
  const useGps = !!selectedType.gps;

  // ── GPS pre-warm ──────────────────────────────────────────
  // The moment the user lands on the cardio picker with a GPS-eligible type
  // selected, fire startUpdatingLocation in the background. By the time they
  // tap Start, the iOS plugin already has a fix cached and the tracker uses
  // it instantly via the bridge's replay-on-attach. This is how Strava and
  // Nike Run Club hide the 5-10s GPS lock latency.
  useEffect(() => {
    if (phase !== 'pick' || !useGps) return;
    prewarmBackgroundLocation();
  }, [phase, useGps]);

  // ── GPS tracker (only when useGps) ────────────────────────
  const trackerRef = useRef(null);
  const [gpsState, setGpsState] = useState(null);
  const [gpsError, setGpsError] = useState('');
  // Local ticker for the BIG timer display when running in GPS mode. The
  // tracker itself throttles emits to 1.5s (for distance/pace), which is too
  // slow for a second-accurate wall clock. This reads the tracker's snapshot
  // every 500ms and only updates state when the integer second changes.
  const [gpsTickSec, setGpsTickSec] = useState(0);

  // Timer-only fallback (for non-GPS activities). A single 250ms interval is
  // smooth enough for an "HH:MM:SS" counter that only updates once per second
  // and avoids rAF-induced re-render storms that made the timer flicker.
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const accumRef = useRef(saved?.accumulatedSec || 0);
  const tickIvRef = useRef(null);

  useEffect(() => {
    if (useGps) return; // GPS tracker owns its own timer
    if (!running) {
      if (tickIvRef.current) { clearInterval(tickIvRef.current); tickIvRef.current = null; }
      return;
    }
    if (!startRef.current) startRef.current = Date.now();
    const tick = () => {
      const e = accumRef.current + (Date.now() - startRef.current) / 1000;
      // Only setElapsed if the integer second actually changed — prevents
      // re-renders every 250ms when the displayed value hasn't moved.
      const next = Math.floor(e);
      setElapsed((prev) => (prev === next ? prev : next));
    };
    tick();
    tickIvRef.current = setInterval(tick, 250);
    return () => {
      if (tickIvRef.current) { clearInterval(tickIvRef.current); tickIvRef.current = null; }
    };
  }, [running, useGps]);

  // ── Summary input (manual distance, intensity) ────────────
  const [manualDistance, setManualDistance] = useState('');
  const [intensity, setIntensity] = useState('moderate');
  const [submitting, setSubmitting] = useState(false);
  const [savedSession, setSavedSession] = useState(null);

  const bodyWeightLbs = profile?.weight_lbs ?? 165;
  const sessionEndedRef = useRef(false);

  // Keep the screen awake while actively tracking a cardio session.
  useWakeLock(phase === 'tracking');

  // ── Draft persistence (every 3s + on app background) ──────
  // Save the FULL session state — including the GPS route polyline, splits,
  // distance, and elevation — so the WebView being killed mid-run (memory
  // pressure, swipe-up, long background) doesn't lose progress.
  const saveDraft = useCallback(() => {
    if (phase !== 'tracking') return;
    const snap = trackerRef.current?.snapshot();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cardioType,
      phase,
      useGps,
      accumulatedSec: useGps
        ? snap?.elapsedSec ?? 0
        : (running && startRef.current
            ? accumRef.current + (Date.now() - startRef.current) / 1000
            : accumRef.current),
      running,
      startedAt: running ? new Date().toISOString() : null,
      lastUpdate: Date.now(),
      // GPS-only payload — null on timer-only sessions
      gps: useGps && snap ? {
        distanceM: snap.distanceM,
        elevationGainM: snap.elevationGainM,
        movingTimeMs: snap.movingTimeMs,
        splits: snap.splits,
        route: snap.route,
      } : null,
    }));
  }, [phase, running, cardioType, useGps]);

  useEffect(() => {
    if (phase !== 'tracking') return;
    saveDraft();
    const iv = setInterval(saveDraft, 3000);
    return () => clearInterval(iv);
  }, [phase, saveDraft]);

  // Flush draft the instant iOS tells us the app is backgrounding — covers
  // the worst-case 3s gap where the user could lose progress. Listen on both
  // Capacitor's appStateChange AND the DOM `pagehide` event because iOS
  // WKWebView is more aggressive about suspending the JS runtime than
  // Capacitor's lifecycle hook implies.
  useEffect(() => {
    if (phase !== 'tracking') return;
    let handle;
    (async () => {
      handle = await CapApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) saveDraft();
      });
    })();
    const onHide = () => saveDraft();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('visibilitychange', onHide);
    return () => {
      handle?.remove?.();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('visibilitychange', onHide);
    };
  }, [phase, saveDraft]);

  // ── Auto-resume after WebView restart ─────────────────────
  // If the page mounted with a saved tracking phase, the user backgrounded
  // mid-run and iOS reaped the WebView. Re-attach the timer and (for GPS
  // sessions) re-spawn the tracker seeded with the saved route + distance
  // so the user picks up exactly where they left off.
  const didAutoResumeRef = useRef(false);
  useEffect(() => {
    if (didAutoResumeRef.current) return;
    if (!saved || saved.phase !== 'tracking') return;
    // Belt + suspenders: if a tracker is somehow already attached (e.g. user
    // tapped Start before this effect ran), don't spawn a second one — that
    // would duplicate the native location listener and double every fix.
    if (trackerRef.current) { didAutoResumeRef.current = true; return; }
    didAutoResumeRef.current = true;

    const offsetSec = Number(saved.accumulatedSec) || 0;

    if (!useGps) {
      // Timer-only: rewind startRef so elapsed = offsetSec at the next tick
      accumRef.current = offsetSec;
      startRef.current = Date.now();
      setRunning(true);
      return;
    }

    (async () => {
      const tracker = createGpsTracker({
        unit,
        seed: {
          distanceM: saved.gps?.distanceM || 0,
          elevationGainM: saved.gps?.elevationGainM || 0,
          movingTimeMs: saved.gps?.movingTimeMs || 0,
          splits: saved.gps?.splits || [],
          route: saved.gps?.route || [],
          elapsedOffsetSec: offsetSec,
        },
      });
      trackerRef.current = tracker;
      tracker.onUpdate((snap) => setGpsState(snap));
      try {
        await tracker.start();
      } catch (err) {
        console.warn('[LiveCardio] resume tracker.start() failed:', err);
        setGpsError(t('cardio.gpsUnavailableTimerOnly', 'GPS unavailable — tracking time only'));
      }
    })();
  }, [saved, useGps, unit, t]);

  useEffect(() => {
    return () => {
      if (tickIvRef.current) clearInterval(tickIvRef.current);
      // Intentionally DO NOT stop the GPS tracker on unmount — a live cardio
      // session should keep running even if the user navigates away from this
      // page or the app is backgrounded. The tracker is only stopped when the
      // user taps "End" (handleFinish) or explicitly discards the session.
    };
  }, []);

  // ── GPS mode display ticker (keeps the big timer smooth even though the
  //     tracker throttles its emits for distance/pace noise reduction)
  useEffect(() => {
    if (!useGps || phase !== 'tracking') return;
    const iv = setInterval(() => {
      const snap = trackerRef.current?.snapshot?.();
      if (!snap) return;
      const next = snap.elapsedSec | 0;
      setGpsTickSec((prev) => (prev === next ? prev : next));
    }, 500);
    return () => clearInterval(iv);
  }, [useGps, phase]);

  // ── Live Activity updates (lock screen / Dynamic Island) ──
  useEffect(() => {
    if (phase !== 'tracking') return;
    const id = setInterval(() => {
      const snap = trackerRef.current?.snapshot();
      const elapsedSec = useGps
        ? (snap?.elapsedSec ?? 0)
        : (running && startRef.current
            ? Math.floor(accumRef.current + (Date.now() - startRef.current) / 1000)
            : Math.floor(accumRef.current));
      const paused = useGps ? !!snap?.paused : !running;
      const distKm = useGps && snap?.distanceM ? snap.distanceM / 1000 : null;
      updateLiveActivity({
        elapsedSeconds: elapsedSec,
        completedSets: 0,
        totalSets: 0,
        currentExerciseName: '',
        isResting: false,
        restRemainingSeconds: 0,
        isPaused: paused,
        distanceKm: distKm,
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [phase, useGps, running]);

  // ── Actions ───────────────────────────────────────────────
  const startTimerOnlyFallback = useCallback(() => {
    startRef.current = Date.now();
    accumRef.current = 0;
    setRunning(true);
  }, []);

  const handleStart = () => {
    console.log('[LiveCardio] Start pressed. useGps=', useGps, 'type=', cardioType);

    // IMMEDIATE: transition UI + start timer so the button always feels
    // responsive. GPS permission request happens asynchronously in the
    // background — if it eventually resolves to "granted", we attach the
    // GPS tracker on top of the timer.
    setPhase('tracking');
    startTimerOnlyFallback();

    // Fire Live Activity (non-blocking)
    startLiveActivity({
      routineName: t(`cardio.types.${cardioType}`, cardioType.replace(/_/g, ' ')),
      totalSets: 0,
      completedSets: 0,
      currentExerciseName: '',
      startTimestamp: Date.now(),
    }).catch((err) => {
      console.warn('[LiveCardio] Live Activity start failed (non-fatal):', err);
    });

    if (!useGps) return;

    // Async GPS bootstrap — don't await, don't block UI
    (async () => {
      const tracker = createGpsTracker({ unit });
      trackerRef.current = tracker;

      // Request permission with a 15s safety timeout so a hung plugin can
      // never block us from running in timer-only mode.
      let perm = null;
      try {
        perm = await Promise.race([
          tracker.requestPermissions(),
          new Promise((resolve) => setTimeout(() => resolve({ location: 'timeout' }), 15000)),
        ]);
        console.log('[LiveCardio] Permission result:', perm);
      } catch (err) {
        console.warn('[LiveCardio] requestPermissions threw:', err);
      }

      const loc = perm?.location;
      const granted = loc === 'granted' || loc === 'granted-always' || loc === 'granted-when-in-use';

      if (!granted) {
        setGpsError(t('cardio.gpsUnavailableTimerOnly', 'GPS unavailable — tracking time only'));
        return;
      }

      tracker.onUpdate((snap) => setGpsState(snap));
      try {
        await tracker.start();
      } catch (err) {
        console.warn('[LiveCardio] tracker.start() failed:', err);
        setGpsError(t('cardio.gpsUnavailableTimerOnly', 'GPS unavailable — tracking time only'));
      }
    })();

  };

  const handlePauseResume = () => {
    // If GPS was requested but permission is still pending OR was denied,
    // the tracker may never have been instantiated — fall back to timer.
    if (useGps && trackerRef.current) {
      const snap = trackerRef.current.snapshot?.();
      if (snap?.paused) trackerRef.current.resume?.();
      else trackerRef.current.pause?.();
    } else {
      if (running) {
        accumRef.current += (Date.now() - startRef.current) / 1000;
        startRef.current = null;
        setRunning(false);
      } else {
        startRef.current = Date.now();
        setRunning(true);
      }
    }
  };

  const handleFinish = async () => {
    if (useGps && trackerRef.current) {
      const final = await trackerRef.current.stop();
      setGpsState(final);
    } else if (running) {
      accumRef.current += (Date.now() - startRef.current) / 1000;
      startRef.current = null;
      setRunning(false);
      setElapsed(Math.floor(accumRef.current));
    }
    setPhase('done');
  };

  // Prefer the smooth 500ms-polled gpsTickSec over the throttled gpsState for
  // the on-screen timer. Fall back to whatever gpsState has if the tick hasn't
  // started yet (first render).
  const elapsedSec = useGps
    ? (gpsTickSec || gpsState?.elapsedSec || 0)
    : elapsed;
  const distanceUnits = useGps
    ? (gpsState?.distanceUnits ?? 0)
    : (manualDistance ? parseFloat(manualDistance) : 0);
  const distanceKm = useGps
    ? ((gpsState?.distanceM ?? 0) / 1000)
    : (manualDistance
        ? (unit === 'mi' ? parseFloat(manualDistance) * 1.60934 : parseFloat(manualDistance))
        : null);
  const avgPaceSecPerUnit = useGps
    ? gpsState?.avgPaceSecPerUnit
    : (elapsedSec > 0 && distanceUnits > 0 ? elapsedSec / distanceUnits : null);
  const currentPaceSecPerUnit = gpsState?.currentPaceSecPerUnit;
  const elevationGainM = gpsState?.elevationGainM ?? 0;
  // GPS activities: calories track distance, not time. Stationary = 0 cal.
  const cal = estimateCardioCalories(cardioType, elapsedSec, bodyWeightLbs, distanceKm, { requireMovement: useGps });

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const route = useGps ? (gpsState?.route ?? []) : [];
      const splits = useGps ? (gpsState?.splits ?? []) : [];
      const avgPaceSecPerKm = useGps
        ? gpsState?.avgPaceSecPerUnit != null
          ? (unit === 'mi'
              ? gpsState.avgPaceSecPerUnit / 1.60934
              : gpsState.avgPaceSecPerUnit)
          : null
        : null;

      const payload = {
        cardio_type: cardioType,
        duration_seconds: Math.max(1, Math.floor(elapsedSec)), // CHECK: > 0
        distance_km: distanceKm,
        calories_burned: cal,
        intensity,
        source: useGps ? 'gps' : 'manual',
        route,
        splits,
        avg_pace_sec_per_km: avgPaceSecPerKm,
        elevation_gain_m: elevationGainM || null,
      };
      let saved = null;
      let savedErr = null;
      try {
        const { data, error } = await supabase.rpc('log_cardio_session', { p_payload: payload });
        if (error) throw error;
        saved = data;
      } catch (rpcErr) {
        // Surface the full error so we can actually see what went wrong.
        console.warn('[LiveCardio] log_cardio_session RPC failed:', {
          message: rpcErr?.message,
          details: rpcErr?.details,
          hint: rpcErr?.hint,
          code: rpcErr?.code,
        });
        // Fall back to a direct insert so the session isn't lost.
        try {
          // Duration must be > 0 for the CHECK constraint — clamp to 1s minimum.
          const safeDuration = Math.max(1, Math.floor(payload.duration_seconds || 0));
          const { data, error } = await supabase
            .from('cardio_sessions')
            .insert({
              profile_id: user?.id,
              gym_id: profile?.gym_id, // NOT NULL in schema — must be provided
              cardio_type: payload.cardio_type,
              duration_seconds: safeDuration,
              distance_km: payload.distance_km,
              calories_burned: payload.calories_burned,
              intensity: payload.intensity,
              source: payload.source,
              route: payload.route,
              splits: payload.splits,
              avg_pace_sec_per_km: payload.avg_pace_sec_per_km,
              elevation_gain_m: payload.elevation_gain_m,
              started_at: new Date(Date.now() - safeDuration * 1000).toISOString(),
              completed_at: new Date().toISOString(),
            })
            .select()
            .single();
          if (error) throw error;
          saved = data;
        } catch (insertErr) {
          console.warn('[LiveCardio] direct insert failed:', {
            message: insertErr?.message,
            details: insertErr?.details,
            hint: insertErr?.hint,
            code: insertErr?.code,
          });
          savedErr = insertErr;
        }
      }

      if (savedErr) {
        // Don't queue under 'anon' — sessions on shared devices would mix.
        // If the user is logged out, drop the queue and notify them.
        if (!user?.id) {
          showToast(t('cardio.logFailedSignedOut', 'Cannot save — please sign in.'), 'error');
          setPhase('summary');
          setSavedSession({ id: null, ...payload, unit });
          return;
        }
        // Queue to localStorage for later retry on reconnect. Keyed per user.
        try {
          const key = `pending_cardio-${user.id}`;
          const prev = JSON.parse(localStorage.getItem(key) || '[]');
          prev.push({ payload, queuedAt: Date.now() });
          localStorage.setItem(key, JSON.stringify(prev));
        } catch {}
        // Clear the live-cardio draft even on the offline path — otherwise the
        // dashboard hero keeps showing the run as "in progress" forever.
        sessionEndedRef.current = true;
        localStorage.removeItem(STORAGE_KEY);
        recordCardioLogged(user?.id, {
          cardioType: payload.cardio_type,
          startedAt: saved?.startedAt || new Date(Date.now() - elapsedSec * 1000).toISOString(),
          loggedAt: new Date().toISOString(),
        });
        showToast(t('cardio.logQueued', 'Saved locally — will sync when online'), 'info');
        setPhase('summary');
        setSavedSession({ id: null, ...payload, unit });
      } else {
        sessionEndedRef.current = true;
        localStorage.removeItem(STORAGE_KEY);
        const sessionId = saved?.session_id || saved?.id || null;
        // Append a tombstone to the per-user ledger. This survives DB delete,
        // restart, and bundle updates — anything finished here is gone for
        // good as far as the dashboard is concerned.
        recordCardioLogged(user?.id, {
          id: sessionId,
          cardioType: payload.cardio_type,
          startedAt: saved?.startedAt || new Date(Date.now() - elapsedSec * 1000).toISOString(),
          loggedAt: new Date().toISOString(),
        });
        setSavedSession({
          id: sessionId,
          ...payload,
          unit,
        });
        showToast(t('cardio.loggedSuccess', 'Cardio logged!'), 'success');
        setPhase('summary');

        // Pre-render the share-card map RIGHT NOW while we're still online and
        // the route is in memory. Cached in IndexedDB by session id so the
        // share sheet opens instantly later — and works offline. Non-blocking.
        if (sessionId && Array.isArray(payload.route) && payload.route.length >= 2) {
          prerenderAndCache({
            route: payload.route,
            width: 1080,
            height: 1080,
            accent,
            sessionId,
          }).catch((err) => console.warn('[LiveCardio] map pre-render failed:', err?.message));
        }
      }

      // End the Live Activity once we've finished logging (success or queued).
      try {
        await endLiveActivity({
          elapsedSeconds: Math.floor(elapsedSec),
          completedSets: 0,
          totalSets: 0,
        });
      } catch {}
    } catch (err) {
      console.error('[LiveCardio] log error', err);
      showToast(t('cardio.logError', 'Failed to log. Try again.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, useGps, gpsState, cardioType, elapsedSec, distanceKm, cal, intensity, elevationGainM, unit, showToast, t, user?.id]);

  const handleBack = () => {
    // 'done' is post-End, pre-Log — the run is finished but unsaved. Treat
    // it the same as 'pick'/'summary': scrub the live-cardio draft so the
    // dashboard doesn't keep showing it as "in progress" forever after the
    // user backs out without tapping Log.
    if (phase === 'pick' || phase === 'summary' || phase === 'done') {
      sessionEndedRef.current = true;
      localStorage.removeItem(STORAGE_KEY);
      endLiveActivity({ elapsedSeconds: Math.floor(elapsedSec), completedSets: 0, totalSets: 0 }).catch(() => {});
      navigate('/', { replace: true });
    } else {
      // preserve in progress — Live Activity continues so the user sees it on
      // the lock screen and can resume via the app icon.
      navigate('/', { replace: true });
    }
  };

  const accent = 'var(--color-accent, #2EC4C4)';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-bg-primary, #FAFAF7)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        fontFamily: FONT_BODY,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', height: 56,
          borderBottom: '1px solid var(--color-border-subtle, rgba(15,20,25,0.06))',
        }}
      >
        <button
          type="button" onClick={handleBack} aria-label={t('liveCardio.back', { defaultValue: 'Back' })}
          style={{
            width: 44, height: 44, borderRadius: 14,
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-primary)',
          }}
        >
          <ChevronLeft size={22} />
        </button>
        <div
          style={{
            fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 16,
            color: 'var(--color-text-primary)', letterSpacing: -0.3,
          }}
        >
          {phase === 'pick'
            ? t('cardio.trackLive', 'Track Live')
            : t(`cardio.types.${cardioType}`, cardioType.replace(/_/g, ' '))}
        </div>
        <div style={{ width: 44 }} />
      </div>

      {/* ── Pick phase ────────────────────────────────────── */}
      {phase === 'pick' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 20px' }}>
          <div
            style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase',
              color: accent, marginBottom: 4,
            }}
          >
            {t('cardio.activity', 'Activity')}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 28,
              letterSpacing: -0.8, color: 'var(--color-text-primary)', marginBottom: 16,
            }}
          >
            {t('cardio.pickActivity', 'Pick an activity')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[...CARDIO_MAIN, ...(showMore ? CARDIO_MORE : [])].map(ct => {
              const Icon = ct.icon;
              const sel = cardioType === ct.key;
              return (
                <button
                  key={ct.key}
                  type="button"
                  onClick={() => setCardioType(ct.key)}
                  aria-pressed={sel}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '16px 8px',
                    borderRadius: 18,
                    border: `1.5px solid ${sel ? `${ct.color}66` : 'var(--color-border-subtle, rgba(15,20,25,0.08))'}`,
                    background: sel
                      ? `color-mix(in srgb, ${ct.color} 10%, var(--color-bg-card))`
                      : 'var(--color-bg-card, #FAFAF7)',
                    cursor: 'pointer', position: 'relative',
                    minHeight: 92, fontFamily: FONT_BODY,
                  }}
                >
                  {ct.gps && (
                    <div
                      style={{
                        position: 'absolute', top: 8, right: 8,
                        display: 'flex', alignItems: 'center', gap: 2,
                        padding: '2px 6px', borderRadius: 999,
                        background: `color-mix(in srgb, ${ct.color} 18%, transparent)`,
                        color: ct.color,
                        fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                      }}
                    >
                      <MapPin size={8} /> GPS
                    </div>
                  )}
                  <div
                    style={{
                      width: 44, height: 44, borderRadius: 14,
                      background: sel ? `${ct.color}22` : 'var(--color-surface-hover, rgba(15,20,25,0.05))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Icon size={20} style={{ color: sel ? ct.color : 'var(--color-text-muted)' }} />
                  </div>
                  <span
                    style={{
                      fontSize: 11, fontWeight: 800, textAlign: 'center',
                      color: sel ? ct.color : 'var(--color-text-primary)',
                    }}
                  >
                    {t(`cardio.types.${ct.key}`, ct.key.replace(/_/g, ' '))}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button" onClick={() => setShowMore(s => !s)}
            style={{
              width: '100%', marginTop: 10, padding: '10px 0',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            <ChevronDown
              size={14}
              style={{
                transform: showMore ? 'rotate(180deg)' : 'none',
                transition: 'transform 160ms',
              }}
            />
            {showMore ? t('cardio.showLess', 'Show less') : t('cardio.showMore', 'More activities')}
          </button>
        </div>
      )}

      {phase === 'pick' && (
        <div style={{ padding: '12px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
          <button
            type="button" onClick={handleStart}
            style={{
              width: '100%', height: 56, borderRadius: 16,
              border: 'none', cursor: 'pointer',
              background: accent,
              color: 'var(--color-bg-card, #0A0D10)',
              fontFamily: FONT_BODY, fontWeight: 900, fontSize: 15,
              letterSpacing: 0.4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent, #2EC4C4) 30%, transparent)',
            }}
          >
            <Play size={18} />
            {t('cardio.start', 'Start')}
          </button>
        </div>
      )}

      {/* ── Tracking phase ────────────────────────────────── */}
      {phase === 'tracking' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 10px' }}>
          {/* Big timer */}
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY, fontSize: 60, fontWeight: 900,
                letterSpacing: -2, color: 'var(--color-text-primary)',
                lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatTime(elapsedSec)}
            </div>
            <div
              style={{
                marginTop: 4, fontSize: 12, fontWeight: 700,
                letterSpacing: 1.2, textTransform: 'uppercase',
                color: (useGps ? gpsState?.paused : !running) && elapsedSec > 0
                  ? 'var(--color-text-muted)'
                  : accent,
              }}
            >
              {(useGps ? gpsState?.paused : !running) && elapsedSec > 0
                ? t('cardio.paused', 'Paused')
                : t('cardio.tracking', 'Tracking…')}
            </div>
          </div>

          {/* Stat grid */}
          {useGps ? (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <Stat
                  label={t('cardio.distance', 'Distance')}
                  value={distanceUnits.toFixed(2)}
                  sub={unit}
                />
                <Stat
                  label={t('cardio.pace', 'Pace')}
                  value={formatPace(currentPaceSecPerUnit)}
                  sub={`/${unit}`}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                <Stat
                  label={t('cardio.avgPace', 'Avg pace')}
                  value={formatPace(avgPaceSecPerUnit)}
                  sub={`/${unit}`}
                />
                <Stat
                  label={t('cardio.elevation', 'Elevation')}
                  value={`${Math.round(elevationGainM)}`}
                  sub="m"
                />
                <Stat
                  label={t('cardio.cal', 'cal')}
                  value={`${cal}`}
                />
              </div>

              {/* Live route — real map (Leaflet + OSM tiles) */}
              {gpsState?.route?.length ? (
                <div style={{ marginBottom: 16 }}>
                  <MemoRouteMap points={gpsState.route} height={280} />
                </div>
              ) : (
                <div
                  style={{
                    borderRadius: 20,
                    background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                    border: '1px dashed var(--color-border-subtle, rgba(15,20,25,0.2))',
                    padding: '30px 20px',
                    textAlign: 'center',
                    color: 'var(--color-text-muted)',
                    fontSize: 12, fontWeight: 700,
                    marginBottom: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <MapPin size={14} />
                  {t('cardio.acquiringGps', 'Waiting for GPS…')}
                </div>
              )}

              {gpsError && (
                <div
                  style={{
                    padding: '10px 12px', borderRadius: 14,
                    background: 'color-mix(in srgb, #EF4444 8%, transparent)',
                    border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)',
                    color: '#EF4444', fontSize: 12, fontWeight: 600,
                    marginBottom: 16,
                  }}
                >
                  {gpsError}
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <Stat
                label={t('cardio.cal', 'cal')}
                value={`${cal}`}
              />
            </div>
          )}
        </div>
      )}

      {phase === 'tracking' && (
        <div
          style={{
            padding: '12px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)',
            display: 'flex', gap: 10,
          }}
        >
          <button
            type="button" onClick={handlePauseResume}
            style={{
              flex: 2, height: 56, borderRadius: 16,
              border: 'none', cursor: 'pointer',
              background: accent, color: 'var(--color-bg-card, #0A0D10)',
              fontFamily: FONT_BODY, fontWeight: 900, fontSize: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent, #2EC4C4) 30%, transparent)',
            }}
          >
            {(useGps ? gpsState?.paused : !running) && elapsedSec > 0 ? (
              <><Play size={18} /> {t('cardio.resume', 'Resume')}</>
            ) : (
              <><Pause size={18} /> {t('cardio.pause', 'Pause')}</>
            )}
          </button>
          <button
            type="button" onClick={handleFinish}
            style={{
              flex: 1, height: 56, borderRadius: 16,
              border: '1.5px solid var(--color-border-subtle, rgba(15,20,25,0.18))',
              background: 'var(--color-bg-card, #FAFAF7)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontFamily: FONT_BODY, fontWeight: 900, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Square size={16} />
            {t('cardio.finish', 'End')}
          </button>
        </div>
      )}

      {/* ── Done phase (manual entry for non-GPS) ─────────── */}
      {phase === 'done' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY, fontSize: 44, fontWeight: 900,
                letterSpacing: -1.2, color: 'var(--color-text-primary)',
                fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              }}
            >
              {formatTime(elapsedSec)}
            </div>
            <div
              style={{
                marginTop: 6, fontSize: 12, fontWeight: 800, color: accent,
                letterSpacing: 1.2, textTransform: 'uppercase',
              }}
            >
              ~{cal} {t('cardio.cal', 'cal')}
            </div>
          </div>

          {!useGps && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                {t('cardio.distance', 'Distance')}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  type="number" min="0" step="0.1" placeholder="0.0"
                  value={manualDistance}
                  onChange={e => setManualDistance(e.target.value)}
                  style={{
                    flex: 1, padding: '12px 14px',
                    borderRadius: 16,
                    border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
                    background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                    color: 'var(--color-text-primary)',
                    fontSize: 16, fontFamily: FONT_BODY, outline: 'none',
                  }}
                />
                <div
                  style={{
                    padding: '0 16px', borderRadius: 16,
                    background: accent, color: 'var(--color-bg-card)',
                    fontWeight: 800, fontSize: 13,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {unit}
                </div>
              </div>
            </>
          )}

          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
            {t('cardio.intensity', 'Intensity')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {['easy', 'moderate', 'hard', 'max'].map(lvl => {
              const sel = intensity === lvl;
              const c = { easy: '#22C55E', moderate: '#F59E0B', hard: '#EF4444', max: '#DC2626' }[lvl];
              return (
                <button
                  key={lvl} type="button"
                  onClick={() => setIntensity(lvl)}
                  style={{
                    padding: '12px 4px', borderRadius: 16,
                    border: `1px solid ${sel ? `${c}66` : 'var(--color-border-subtle, rgba(15,20,25,0.08))'}`,
                    background: sel
                      ? `color-mix(in srgb, ${c} 12%, var(--color-bg-card))`
                      : 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                    color: sel ? c : 'var(--color-text-primary)',
                    cursor: 'pointer',
                    fontWeight: 800, fontSize: 12,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}
                >
                  {t(`cardio.intensities.${lvl}`, lvl)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div style={{ padding: '12px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)', display: 'flex', gap: 10 }}>
          <button
            type="button" onClick={handleSubmit} disabled={submitting}
            style={{
              flex: 1, height: 56, borderRadius: 16,
              border: 'none', cursor: submitting ? 'default' : 'pointer',
              background: accent, color: 'var(--color-bg-card, #0A0D10)',
              fontFamily: FONT_BODY, fontWeight: 900, fontSize: 15,
              opacity: submitting ? 0.6 : 1,
              boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent, #2EC4C4) 30%, transparent)',
            }}
          >
            {submitting
              ? t('cardio.logging', 'Logging…')
              : t('cardio.finishAndLog', 'Finish & Log')}
          </button>
          <button
            type="button"
            onClick={() => { setShowShare(true); }}
            aria-label={t('cardio.shareThisRun', 'Share this run')}
            style={{
              width: 56, height: 56, borderRadius: 16,
              border: '1.5px solid var(--color-border-subtle, rgba(15,20,25,0.18))',
              background: 'transparent', cursor: 'pointer',
              color: 'var(--color-text-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Share2 size={20} />
          </button>
        </div>
      )}

      {/* ── Summary + share ─────────────────────────────── */}
      {phase === 'summary' && savedSession && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: accent }}>
              {t('cardio.sessionSaved', 'Session saved')}
            </div>
            <div
              style={{
                fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 32,
                letterSpacing: -0.8, color: 'var(--color-text-primary)', marginTop: 4,
              }}
            >
              {t(`cardio.types.${savedSession.cardio_type}`, savedSession.cardio_type.replace(/_/g, ' '))}
            </div>
          </div>

          {savedSession.route?.length >= 2 && (
            <div style={{ marginBottom: 14 }}>
              <MemoRouteMap points={savedSession.route} height={220} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <Stat label={t('cardio.duration', 'Duration')} value={formatTime(savedSession.duration_seconds)} />
            {savedSession.distance_km != null && (
              <Stat
                label={t('cardio.distance', 'Distance')}
                value={(unit === 'mi' ? savedSession.distance_km / 1.60934 : savedSession.distance_km).toFixed(2)}
                sub={unit}
              />
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            <Stat label={t('cardio.cal', 'cal')} value={`${savedSession.calories_burned}`} />
            {savedSession.avg_pace_sec_per_km != null && (
              <Stat
                label={t('cardio.avgPace', 'Avg pace')}
                value={formatPace(unit === 'mi' ? savedSession.avg_pace_sec_per_km * 1.60934 : savedSession.avg_pace_sec_per_km)}
                sub={`/${unit}`}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => { console.log('[LiveCardio] share tapped (summary phase)', { hasSavedSession: !!savedSession }); setShowShare(true); }}
            style={{
              width: '100%', height: 54, borderRadius: 16,
              border: 'none', cursor: 'pointer',
              background: accent, color: 'var(--color-bg-card, #0A0D10)',
              fontFamily: FONT_BODY, fontWeight: 900, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent, #2EC4C4) 30%, transparent)',
            }}
          >
            <Share2 size={17} />
            {t('cardio.shareThisRun', 'Share this run')}
          </button>

          <button
            type="button" onClick={() => navigate('/', { replace: true })}
            style={{
              width: '100%', height: 48, marginTop: 10, borderRadius: 16,
              border: '1.5px solid var(--color-border-subtle, rgba(15,20,25,0.18))',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontFamily: FONT_BODY, fontWeight: 800, fontSize: 13,
            }}
          >
            {t('cardio.done', 'Done')}
          </button>
        </div>
      )}

      {/* Share sheet — uses savedSession when present, otherwise builds the
          share-data object from in-memory tracker state so the user can also
          share before tapping "Finish & Log". */}
      <ShareCardioSheet
        open={showShare}
        onClose={() => setShowShare(false)}
        data={savedSession ? {
          sessionId: savedSession.id,
          cardioType: savedSession.cardio_type,
          durationSeconds: savedSession.duration_seconds,
          distanceKm: savedSession.distance_km,
          calories: savedSession.calories_burned,
          avgPaceSecPerKm: savedSession.avg_pace_sec_per_km,
          elevationGainM: savedSession.elevation_gain_m,
          route: savedSession.route || [],
          unit,
          gymName: profile?.gym_name,
          gymLogoUrl,
        } : (phase === 'done' ? {
          sessionId: null,
          cardioType,
          durationSeconds: Math.floor(elapsedSec),
          distanceKm: distanceKm || null,
          calories: cal,
          avgPaceSecPerKm: gpsState?.avgPaceSecPerUnit ?? null,
          elevationGainM: elevationGainM || 0,
          route: gpsState?.route || [],
          unit,
          gymName: profile?.gym_name,
          gymLogoUrl,
        } : null)}
      />
    </div>
  );
}
