// ShareTplCardio.jsx
// -----------------------------------------------------------------------------
// Strava-style share card templates for a cardio session. Mirrors the shape of
// the workout share templates (ShareTplEditorial / ShareTplBoldSport etc.) but
// uses the GPS route polyline as the hero visual. All four "styles" are
// implemented in one component via the `variant` prop:
//   • editorial  — warm paper, route on top, stats in a clean grid
//   • bold       — dark gradient, big numbers, accent glow
//   • poster     — torn stripe + huge display type, route offset
//   • photo      — user-supplied photo bg w/ gradient + route overlay
//
// Consumed by ShareCardioSheet.jsx, which renders into an offscreen node and
// rasterizes via rasterizeNode().
// -----------------------------------------------------------------------------

import React from 'react';
import { routeToSvgPoints, formatPace } from '../../lib/gpsTracker';
import StaticRouteMapImage from './StaticRouteMapImage';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function displayDistance(km, unit) {
  if (km == null) return '—';
  const v = unit === 'mi' ? km / 1.60934 : km;
  return v.toFixed(2);
}

function paceDisplay(secPerKm, unit) {
  if (!secPerKm) return '—';
  const v = unit === 'mi' ? secPerKm * 1.60934 : secPerKm;
  return formatPace(v);
}

// `s` is the canvas-to-preview scale. Cardio share default canvas is
// 1080×1920 (so s ≈ 4) — without scaling, the 11 px gym name was lost
// on the export. Default 1 keeps the in-app preview behaviour for any
// caller that doesn't pass `s` yet.
function GymLockup({ gymName, light, s = 1 }) {
  if (!gymName) return null;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6 * s,
        fontSize: 11 * s, fontWeight: 800, letterSpacing: 1.5 * s,
        textTransform: 'uppercase',
        color: light ? 'rgba(255,255,255,0.88)' : 'rgba(10,13,16,0.6)',
        fontFamily: FONT_BODY,
      }}
    >
      <div
        style={{
          width: 14 * s, height: 14 * s, borderRadius: 4 * s,
          background: light ? 'rgba(255,255,255,0.9)' : '#0A0D10',
        }}
      />
      {gymName}
    </div>
  );
}

export default function ShareTplCardio({
  w = 1080, h = 1920,
  variant = 'editorial',
  data = {},
  accent = '#2EC4C4',
  showGym = true,
  backgroundSrc,
  // Photo variant only: when true AND no user-supplied photo, the card
  // renders on a transparent canvas (Strava Stats Sticker pattern). The
  // exported PNG carries alpha so the user can drop it on whatever IG
  // Story photo they compose us over.
  transparent = false,
  mapVersion = 0,
}) {
  // Same scaling convention as the workout share templates — every literal
  // pixel value is multiplied by `s` so the card reads at full Story
  // scale when exported, regardless of which canvas width it was
  // designed at (270 preview / 1080 export). Defaults imply s≈4 for
  // the export pipeline.
  const s = w / 270;
  const safeData = data || {};
  // Tolerant mapping — accept both camelCase (in-memory) and snake_case
  // (Supabase row) shapes. All numeric fields default to safe values so the
  // template can never crash on nulls/undefineds.
  const cardioType = safeData.cardioType || safeData.cardio_type || 'running';
  const durationSeconds = Number(safeData.durationSeconds ?? safeData.duration_seconds ?? 0) || 0;
  const distanceKm = safeData.distanceKm ?? safeData.distance_km ?? null;
  const calories = Number(safeData.calories ?? 0) || 0;
  const avgPaceSecPerKm = safeData.avgPaceSecPerKm ?? safeData.avg_pace_sec_per_km ?? null;
  const elevationGainM = Number(safeData.elevationGainM ?? safeData.elevation_gain_m ?? 0) || 0;
  const route = Array.isArray(safeData.route) ? safeData.route : [];
  const unit = safeData.unit || 'km';
  const gymName = safeData.gymName || safeData.gym_name;
  const sessionId = safeData.sessionId || safeData.session_id || safeData.id || null;

  const polyPoints = routeToSvgPoints(route, 900, 520, 20);

  const distLabel = displayDistance(distanceKm, unit);
  const paceLabel = paceDisplay(avgPaceSecPerKm, unit);
  const durLabel = formatDuration(durationSeconds);

  // ───────────────────────── Editorial (Strava-style) ──────
  // Layout: dark backdrop, large map hero with the route polyline drawn over
  // real OSM tiles, big distance numeral, three stats in a row, gym lockup.
  // Mirrors the reference Strava share layout: visual first, numbers second.
  if (variant === 'editorial') {
    const mapH = Math.round(h * 0.58);
    const mapW = w - 96;
    return (
      <div
        style={{
          width: w, height: h,
          background: '#0A0D10',
          position: 'relative',
          padding: 48,
          boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
          fontFamily: FONT_BODY,
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div
            style={{
              fontSize: 28, fontWeight: 800, letterSpacing: 2,
              textTransform: 'uppercase', color: accent,
            }}
          >
            {cardioType.replace(/_/g, ' ')}
          </div>
          {showGym && <GymLockup s={s} gymName={gymName} light />}
        </div>

        {/* Map hero — real OSM tiles + route polyline */}
        <div
          style={{
            width: mapW, height: mapH,
            borderRadius: 24,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        >
          {route.length >= 2 ? (
            <StaticRouteMapImage
              key={`map-${mapVersion}`}
              route={route}
              width={mapW}
              height={mapH}
              accent={accent}
              sessionId={sessionId}
            />
          ) : (
            <div
              style={{
                width: '100%', height: '100%',
                background: '#14181C',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.4)', fontSize: 24, fontWeight: 800,
              }}
            >
              Indoor session
            </div>
          )}
        </div>

        {/* Big distance numeral */}
        <div style={{ marginTop: 36 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 132,
              letterSpacing: -5, lineHeight: 0.9, color: '#fff',
            }}
          >
            {distLabel}
            <span style={{ fontSize: 56, color: accent, marginLeft: 12, letterSpacing: -1 }}>
              {unit}
            </span>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Stats row */}
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            paddingTop: 24,
            borderTop: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <StatCompact label="TIME" value={durLabel} accent={accent} />
          <StatCompact label={`PACE /${unit}`} value={paceLabel} accent={accent} />
          {elevationGainM > 0
            ? <StatCompact label="ELEV (m)" value={`${Math.round(elevationGainM)}`} accent={accent} />
            : <StatCompact label="CAL" value={`${calories}`} accent={accent} />}
        </div>

        <div
          style={{
            fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.55)',
            letterSpacing: 2, marginTop: 24, textTransform: 'uppercase',
          }}
        >
          TuGymPR
        </div>
      </div>
    );
  }

  // ───────────────────────── Bold (dark) ─────────────────
  if (variant === 'bold') {
    return (
      <div
        style={{
          width: w, height: h,
          position: 'relative',
          background:
            `radial-gradient(ellipse at 30% 0%, ${accent}33 0%, transparent 55%), #0A0D10`,
          padding: 64,
          boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
          fontFamily: FONT_BODY,
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: accent }}>
            {cardioType.replace(/_/g, ' ')}
          </div>
          {showGym && <GymLockup s={s} gymName={gymName} light />}
        </div>

        <div style={{ marginTop: 80, marginBottom: 20 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 200,
              letterSpacing: -8, lineHeight: 0.85, color: '#fff',
            }}
          >
            {distLabel}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 72,
              letterSpacing: -2, color: accent, marginTop: 6,
              textTransform: 'uppercase',
            }}
          >
            {unit}
          </div>
        </div>

        {polyPoints && (
          <div style={{ marginTop: 10 }}>
            <svg viewBox="0 0 900 520" width="100%" height={380} preserveAspectRatio="xMidYMid meet">
              <polyline
                points={polyPoints}
                fill="none" stroke={accent}
                strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 30 }}>
          <Stat dark label="DURATION" value={durLabel} accent={accent} />
          <Stat dark label={`PACE /${unit}`} value={paceLabel} accent={accent} />
          <Stat dark label="CAL" value={`${calories}`} accent={accent} />
          {elevationGainM > 0 && <Stat dark label="ELEV m" value={`${Math.round(elevationGainM)}`} accent={accent} />}
        </div>

        <div
          style={{
            fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
            letterSpacing: 2, marginTop: 28, textTransform: 'uppercase',
          }}
        >
          TuGymPR
        </div>
      </div>
    );
  }

  // ───────────────────────── Poster (torn stripe) ─────────
  if (variant === 'poster') {
    const stripeColor = '#FF5A2E';
    return (
      <div
        style={{
          width: w, height: h,
          position: 'relative', overflow: 'hidden',
          background: '#EEEBE3',
          fontFamily: FONT_BODY, color: '#0A0D10',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '28%', left: -60, right: -60, height: 180,
            background: stripeColor, transform: 'rotate(-6deg)',
          }}
        />
        <div style={{ position: 'relative', padding: 64 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase' }}>
              {cardioType.replace(/_/g, ' ')}
            </div>
            {showGym && <GymLockup s={s} gymName={gymName} />}
          </div>

          <div
            style={{
              position: 'absolute', top: '22%', left: 0, right: 0,
              textAlign: 'center', padding: '0 40px',
            }}
          >
            <div
              style={{
                fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 280,
                lineHeight: 0.82, letterSpacing: -10, color: '#0A0D10',
              }}
            >
              {distLabel}
            </div>
            <div
              style={{
                fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 88,
                letterSpacing: -2, color: '#fff', marginTop: 4, textTransform: 'uppercase',
              }}
            >
              {unit}
            </div>
          </div>

          <div
            style={{
              position: 'absolute', left: 64, right: 64, bottom: 120,
              display: 'flex', justifyContent: 'space-between',
            }}
          >
            <Stat label="DURATION" value={durLabel} accent={stripeColor} />
            <Stat label={`PACE /${unit}`} value={paceLabel} accent={stripeColor} />
            <Stat label="CAL" value={`${calories}`} accent={stripeColor} />
          </div>

          <div
            style={{
              position: 'absolute', left: 64, bottom: 64,
              fontSize: 22, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase',
              color: 'rgba(10,13,16,0.55)',
            }}
          >
            TuGymPR
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────── Photo (bg photo + route) ─────
  if (variant === 'photo') {
    // Sticker mode for the photo variant: no user photo + transparent flag on.
    // Drop the bg + dark legibility overlay so the rasterized PNG carries
    // alpha. With a user photo OR opaque mode, behave as before.
    const photoSticker = transparent && !backgroundSrc;
    return (
      <div
        style={{
          width: w, height: h, position: 'relative',
          overflow: 'hidden',
          background: photoSticker
            ? 'transparent'
            : backgroundSrc
              ? `linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.9) 100%), url(${backgroundSrc}) center/cover`
              : `linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.9) 100%), linear-gradient(135deg, #3d2a1a 0%, #14080a 100%)`,
          padding: 64, boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          fontFamily: FONT_BODY, color: '#fff',
        }}
      >
        {polyPoints && (
          <div
            style={{
              position: 'absolute', top: 120, left: 40, right: 40,
              opacity: 0.95,
            }}
          >
            <svg viewBox="0 0 900 520" width="100%" height={420} preserveAspectRatio="xMidYMid meet">
              <polyline
                points={polyPoints}
                fill="none" stroke={accent}
                strokeWidth="14" strokeLinecap="round" strokeLinejoin="round"
                filter="url(#glow)"
              />
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="4" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
            </svg>
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: accent }}>
            {cardioType.replace(/_/g, ' ')}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 180,
              letterSpacing: -6, lineHeight: 0.85, color: '#fff', marginTop: 10,
            }}
          >
            {distLabel} <span style={{ fontSize: 80, color: accent }}>{unit}</span>
          </div>
          <div
            style={{
              marginTop: 24, display: 'flex', gap: 40,
              borderTop: '1px solid rgba(255,255,255,0.25)',
              paddingTop: 24,
            }}
          >
            <Stat dark label="DURATION" value={durLabel} accent={accent} />
            <Stat dark label={`PACE /${unit}`} value={paceLabel} accent={accent} />
            <Stat dark label="CAL" value={`${calories}`} accent={accent} />
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {showGym ? <GymLockup s={s} gymName={gymName} light /> : <span />}
            <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: 2 }}>
              TuGymPR
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Strava-style compact stat: small uppercase label on top, big value below.
// Bumped fontSize/letterSpacing for IG readability — labels were 12 px on a
// 1080-wide canvas and looked like spaced-out specks once IG re-scaled. Same
// uppercase-track design, just at a size that survives the post.
function StatCompact({ label, value, accent }) {
  return (
    <div>
      <div
        style={{
          fontSize: 22, fontWeight: 800, letterSpacing: 1.8,
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.6)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 60,
          letterSpacing: -1.2, lineHeight: 1, color: '#fff',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, accent, big, dark }) {
  return (
    <div>
      <div
        style={{
          fontFamily: FONT_DISPLAY, fontWeight: 900,
          fontSize: big ? 96 : 72,
          letterSpacing: -2, lineHeight: 0.95,
          color: dark ? '#fff' : '#0A0D10',
        }}
      >
        {value}
        {unit && (
          <span
            style={{
              fontSize: big ? 36 : 28, marginLeft: 8,
              color: accent, fontWeight: 800,
            }}
          >
            {unit}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: big ? 16 : 14,
          fontWeight: 800, letterSpacing: 2,
          textTransform: 'uppercase',
          color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(10,13,16,0.5)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}
