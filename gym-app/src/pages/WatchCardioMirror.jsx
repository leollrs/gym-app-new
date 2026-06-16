// WatchCardioMirror.jsx
// -----------------------------------------------------------------------------
// Live mirror of a cardio session being tracked on the Apple Watch.
//
// The watch owns the GPS/HR session and streams stats here every ~2s via
// `watch_cardio_progress` (relayed through the watch bridge). On End it sends
// `watch_cardio_session` (which main.jsx saves to the DB). This screen shows
// the run in real time — timer, distance, pace, HR, calories, and a route map
// that draws as you move — then freezes on a summary once it ends.
//
// It only ever READS from the watch; ending/pausing happen on the wrist.
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, Footprints, Bike, Waves, CircleDot, TrendingUp,
  PersonStanding, Flame, Mountain, Heart, Watch as WatchIcon, CheckCircle2,
} from 'lucide-react';
import { onWatchMessage } from '../lib/watchBridge';
import RouteMap from '../components/cardio/RouteMap';
import { useWakeLock } from '../hooks/useWakeLock';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

// type slug → icon + accent (mirrors LiveCardio's palette)
const TYPE_META = {
  running:       { icon: Footprints,     color: '#10B981' },
  walking:       { icon: PersonStanding, color: '#22C55E' },
  cycling:       { icon: Bike,           color: '#3B82F6' },
  hiking:        { icon: Mountain,       color: '#10B981' },
  rowing:        { icon: Waves,          color: '#06B6D4' },
  elliptical:    { icon: CircleDot,      color: '#8B5CF6' },
  stair_climber: { icon: TrendingUp,     color: '#F59E0B' },
  hiit:          { icon: Flame,          color: '#F97316' },
};
const DEFAULT_META = { icon: Heart, color: '#F97316' };

function fmtTime(total) {
  const t = Math.max(0, Math.floor(total || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtPace(distanceM, elapsed) {
  if (!distanceM || distanceM < 50 || !elapsed) return '--:--';
  const secPerKm = elapsed / (distanceM / 1000);
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.floor(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function WatchCardioMirror() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get('type') || 'other';
  const meta = TYPE_META[type] || DEFAULT_META;
  const Icon = meta.icon;
  const accent = meta.color;

  const [elapsed, setElapsed] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [hr, setHr] = useState(0);
  const [cal, setCal] = useState(0);
  const [paused, setPaused] = useState(false);
  const [route, setRoute] = useState([]); // [{ lat, lng, t }]
  const [ended, setEnded] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  // Keep the screen awake while the run is live (the user is watching it tick).
  useWakeLock(!ended);

  // Smooth the displayed timer between the watch's ~2s ticks: count locally
  // from the last tick, re-syncing to the watch's authoritative elapsed each
  // time a tick lands. Freezes when paused or ended.
  const tickAtRef = useRef(Date.now());
  useEffect(() => {
    if (ended || paused) return;
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [ended, paused]);
  const shownElapsed = (ended || paused)
    ? elapsed
    : elapsed + Math.max(0, Math.floor((now - tickAtRef.current) / 1000));

  // Live ticks + end signal from the watch (fanned out by the watch bridge).
  useEffect(() => {
    const unsub = onWatchMessage((msg) => {
      if (!msg?.action) return;
      if (msg.action === 'watch_cardio_progress') {
        const e = Number(msg.elapsed_seconds) || 0;
        setElapsed(e);
        tickAtRef.current = Date.now();
        setNow(Date.now());
        setDistanceM(Number(msg.distance_m) || 0);
        setHr(Number(msg.heart_rate) || 0);
        setCal(Number(msg.calories) || 0);
        setPaused(!!msg.paused);
        setLastUpdate(Date.now());
        if (Array.isArray(msg.route_tail) && msg.route_tail.length) {
          setRoute((prev) => prev.concat(msg.route_tail));
        }
      } else if (msg.action === 'watch_cardio_session') {
        // Final summary — freeze on the saved numbers + full route.
        setEnded(true);
        setPaused(false);
        if (msg.duration_seconds != null) setElapsed(Number(msg.duration_seconds) || 0);
        if (msg.distance_km != null) setDistanceM((Number(msg.distance_km) || 0) * 1000);
        if (msg.avg_heart_rate != null) setHr(Number(msg.avg_heart_rate) || 0);
        if (msg.calories_burned != null) setCal(Number(msg.calories_burned) || 0);
        if (Array.isArray(msg.route) && msg.route.length) setRoute(msg.route);
      }
    });
    return unsub;
  }, []);

  // Saved session id (dispatched by main.jsx after the log_cardio_session RPC).
  useEffect(() => {
    const onSaved = (e) => { if (e?.detail?.id) setSavedId(e.detail.id); };
    window.addEventListener('tugympr:watch-cardio-saved', onSaved);
    return () => window.removeEventListener('tugympr:watch-cardio-saved', onSaved);
  }, []);

  const label = t(`cardio.types.${type}`, { ns: 'pages', defaultValue: type.replace(/_/g, ' ') });
  const stale = !ended && (now - lastUpdate > 8000);
  const distanceKm = distanceM / 1000;
  const hasRoute = route.length >= 1;

  const exit = () => navigate('/', { replace: true });

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: FONT_BODY,
        display: 'flex',
        flexDirection: 'column',
        padding: 'max(env(safe-area-inset-top), 12px) 16px calc(env(safe-area-inset-bottom) + 16px)',
      }}
    >
      <style>{`@keyframes tugympr-pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button
          type="button"
          onClick={exit}
          aria-label={t('back', 'Back')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 12, flexShrink: 0,
            background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
            border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
            color: 'var(--color-text-primary)',
          }}
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 9, flexShrink: 0,
              background: `${accent}22`, color: accent,
            }}
          >
            <Icon size={17} strokeWidth={2.4} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, lineHeight: 1.1, textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)' }}>
              <WatchIcon size={11} />
              {ended ? t('watchCardio.saved', 'Session saved')
                : stale ? t('watchCardio.waiting', 'Waiting for your watch…')
                : t('watchCardio.fromWatch', 'Tracking on your Apple Watch')}
            </div>
          </div>
        </div>
        {!ended && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: paused ? 'var(--color-text-muted)' : '#EF4444',
              animation: paused ? 'none' : 'tugympr-pulse 1.4s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
              {paused ? t('watchCardio.paused', 'Paused') : t('watchCardio.live', 'Live')}
            </span>
          </div>
        )}
      </div>

      {/* Timer */}
      <div style={{ textAlign: 'center', margin: '8px 0 16px' }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 64, lineHeight: 1, letterSpacing: -2, fontVariantNumeric: 'tabular-nums' }}>
          {fmtTime(shownElapsed)}
        </div>
      </div>

      {/* Route map (outdoor activities once a fix arrives) */}
      {hasRoute && (
        <div style={{ marginBottom: 14 }}>
          <RouteMap points={route} height={240} follow={!ended} />
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Stat label={t('watchCardio.distance', 'Distance')} value={distanceKm.toFixed(2)} sub="km" />
        <Stat label={t('watchCardio.pace', 'Pace')} value={fmtPace(distanceM, ended ? elapsed : shownElapsed)} sub="/km" />
        <Stat label={t('watchCardio.bpm', 'BPM')} value={hr > 0 ? String(hr) : '--'} accent="#EF4444" />
        <Stat label="Cal" value={String(cal)} accent={accent} />
      </div>

      <div style={{ flex: 1 }} />

      {/* Footer */}
      {ended ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px', borderRadius: 14, fontWeight: 700, fontSize: 14,
            background: '#10B98118', color: '#10B981',
          }}>
            <CheckCircle2 size={18} /> {t('watchCardio.saved', 'Session saved')}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {savedId && (
              <button
                type="button"
                onClick={() => navigate(`/cardio/${savedId}`, { replace: true })}
                style={{
                  flex: 1, padding: '14px', borderRadius: 14, fontWeight: 800, fontSize: 15,
                  fontFamily: FONT_DISPLAY,
                  background: 'var(--color-surface-hover, rgba(15,20,25,0.05))',
                  border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
                  color: 'var(--color-text-primary)',
                }}
              >
                {t('watchCardio.viewSummary', 'View summary')}
              </button>
            )}
            <button
              type="button"
              onClick={exit}
              style={{
                flex: 1, padding: '14px', borderRadius: 14, fontWeight: 800, fontSize: 15,
                fontFamily: FONT_DISPLAY, color: '#fff', border: 'none', background: accent,
              }}
            >
              {t('done', 'Done')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          textAlign: 'center', fontSize: 12, fontWeight: 600, lineHeight: 1.4,
          color: 'var(--color-text-muted)', padding: '0 12px',
        }}>
          {stale
            ? t('watchCardio.waiting', 'Waiting for your watch…')
            : t('watchCardio.fromWatch', 'Tracking on your Apple Watch')}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div
      style={{
        flex: 1, minWidth: 0, padding: '12px 8px', borderRadius: 16, textAlign: 'center',
        background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
      }}
    >
      <div style={{
        fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 21, lineHeight: 1.05,
        letterSpacing: -0.5, color: accent || 'var(--color-text-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
        {sub ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-subtle)', marginLeft: 2 }}>{sub}</span> : null}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
        color: 'var(--color-text-muted)', marginTop: 4, fontFamily: FONT_BODY,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
    </div>
  );
}
