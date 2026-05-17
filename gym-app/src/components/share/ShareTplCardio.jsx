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
function GymLockup({ gymName, gymLogoUrl, light, s = 1 }) {
  if (!gymName) return null;
  const boxBg = light ? 'rgba(255,255,255,0.12)' : 'rgba(10,13,16,0.06)';
  const boxBorder = light ? 'rgba(255,255,255,0.2)' : 'rgba(10,13,16,0.12)';
  const initial = (gymName.trim()[0] || 'G').toUpperCase();
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
          width: 18 * s, height: 18 * s, borderRadius: 5 * s,
          background: gymLogoUrl ? 'transparent' : boxBg,
          border: gymLogoUrl ? 'none' : `${1 * s}px solid ${boxBorder}`,
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {gymLogoUrl ? (
          <img
            src={gymLogoUrl}
            alt=""
            crossOrigin="anonymous"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span
            style={{
              fontSize: 10 * s, fontWeight: 900,
              color: light ? '#fff' : '#0A0D10',
              letterSpacing: 0,
            }}
          >
            {initial}
          </span>
        )}
      </div>
      {gymName}
    </div>
  );
}

export default function ShareTplCardio({
  w = 1080, h = 1920,
  variant = 'editorial',
  data = {},
  accent = '#2EC4C4',
  customTitle,            // overrides cardio-type label when truthy
  themeMode = 'dark',     // 'dark' | 'light' — editorial + bold respect this
  showGym = true,
  showMap = true,
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
  const gymLogoUrl = safeData.gymLogoUrl || safeData.gym_logo_url || null;
  const sessionId = safeData.sessionId || safeData.session_id || safeData.id || null;

  const polyPoints = routeToSvgPoints(route, 900, 520, 20);

  const distLabel = displayDistance(distanceKm, unit);
  const paceLabel = paceDisplay(avgPaceSecPerKm, unit);
  const durLabel = formatDuration(durationSeconds);
  // Cardio-type label, or a user-provided override (capped + uppercased).
  const titleLabel = (customTitle && customTitle.trim())
    ? customTitle.trim().slice(0, 32)
    : cardioType.replace(/_/g, ' ');

  // ───────────────────────── Editorial (Strava-style) ──────
  // Three layout modes derived from the format's aspect ratio:
  //   • tall   (≥1.4)  — IG Story: vertical stack, hero map up top
  //   • portrait (1.0–1.4) — IG 4:5: vertical stack, smaller map
  //   • square (<1.05) — IG Feed: side-by-side, map left + numbers right
  if (variant === 'editorial') {
    const aspect = h / w;
    const mode = aspect >= 1.4 ? 'tall' : aspect >= 1.05 ? 'portrait' : 'square';
    const pad = (mode === 'square' ? 28 : 36) * s;
    const light = themeMode === 'light';
    const bg = light ? '#EEEBE3' : '#0A0D10';
    const fg = light ? '#0A0D10' : '#fff';
    const subFg = light ? 'rgba(10,13,16,0.55)' : 'rgba(255,255,255,0.55)';
    const borderCol = light ? 'rgba(10,13,16,0.12)' : 'rgba(255,255,255,0.12)';

    // Square mode renders side-by-side: map fills the left column, the
    // headline+number+stats stack runs down the right. Keeps the visual
    // identity intact while making 1:1 not feel like a crop.
    if (mode === 'square') {
      // Even 50/50 columns — earlier draft computed mapSide = h - pad*2 which
      // collapsed the right column to a negative width on a 1:1 canvas.
      const colGap = pad;
      const colW = Math.round((w - pad * 2 - colGap) / 2);
      const mapSide = Math.round(h - pad * 2);
      return (
        <div
          style={{
            width: w, height: h,
            background: bg, color: fg,
            padding: pad, boxSizing: 'border-box',
            display: 'flex', gap: pad,
            fontFamily: FONT_BODY,
            overflow: 'hidden',
          }}
        >
          {showMap && (
            <div
              style={{
                width: colW, height: mapSide,
                borderRadius: 18 * s,
                overflow: 'hidden',
                flexShrink: 0,
                boxShadow: `0 ${8 * s}px ${24 * s}px rgba(0,0,0,0.4)`,
              }}
            >
              {route.length >= 2 ? (
                <StaticRouteMapImage
                  key={`map-${mapVersion}-${light ? 'l' : 'd'}`}
                  route={route} width={colW} height={mapSide}
                  accent={accent} sessionId={sessionId} light={light}
                />
              ) : (
                <div
                  style={{
                    width: '100%', height: '100%',
                    background: light ? '#E8E6DF' : '#14181C',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: light ? 'rgba(10,13,16,0.45)' : 'rgba(255,255,255,0.4)',
                    fontSize: 14 * s, fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: 1.4 * s,
                    textAlign: 'center', padding: 12 * s,
                  }}
                >
                  Indoor session
                </div>
              )}
            </div>
          )}
          <div style={{ width: showMap ? colW : w - pad * 2, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 14 * s, fontWeight: 800, letterSpacing: 1.8 * s, textTransform: 'uppercase', color: accent, flexShrink: 0 }}>
              {titleLabel}
            </div>
            {showGym && (
              <div style={{ marginTop: 8 * s, flexShrink: 0 }}>
                <GymLockup s={s} gymName={gymName} gymLogoUrl={gymLogoUrl} light={!light} />
              </div>
            )}
            <div style={{ marginTop: 14 * s, flexShrink: 0 }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY, fontWeight: 900,
                  fontSize: w * 0.13, letterSpacing: -1.5 * s,
                  lineHeight: 0.9, color: fg,
                }}
              >
                {distLabel}
              </div>
              <div style={{ fontSize: w * 0.05, color: accent, fontWeight: 800, marginTop: 4 * s, letterSpacing: 1.2 * s, textTransform: 'uppercase' }}>
                {unit}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 8 * s,
                paddingTop: 12 * s,
                borderTop: `1px solid ${borderCol}`,
                flexShrink: 0,
              }}
            >
              <StatRow s={s} light={light} label="TIME" value={durLabel} />
              <StatRow s={s} light={light} label={`PACE /${unit}`} value={paceLabel} />
              {elevationGainM > 0
                ? <StatRow s={s} light={light} label="ELEV (m)" value={`${Math.round(elevationGainM)}`} />
                : <StatRow s={s} light={light} label="CAL" value={`${calories}`} />}
            </div>
            <div style={{ fontSize: 10 * s, fontWeight: 700, color: subFg, letterSpacing: 1.4 * s, marginTop: 10 * s, textTransform: 'uppercase', flexShrink: 0 }}>
              TuGymPR
            </div>
          </div>
        </div>
      );
    }

    // Tall + Portrait — vertical stack with adaptive map height.
    // Story leaves ~50% of canvas for the map; portrait crunches to ~38%.
    const mapH = Math.round(h * (mode === 'tall' ? 0.5 : 0.4));
    const mapW = Math.round(w - pad * 2);
    return (
      <div
        style={{
          width: w, height: h,
          background: bg,
          position: 'relative',
          padding: pad,
          boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
          fontFamily: FONT_BODY,
          color: fg,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 * s, flexShrink: 0 }}>
          <div
            style={{
              fontSize: 16 * s, fontWeight: 800, letterSpacing: 2 * s,
              textTransform: 'uppercase', color: accent,
            }}
          >
            {titleLabel}
          </div>
          {showGym && <GymLockup s={s} gymName={gymName} gymLogoUrl={gymLogoUrl} light={!light} />}
        </div>

        {showMap && (
          <div
            style={{
              width: mapW, height: mapH,
              borderRadius: 18 * s,
              overflow: 'hidden',
              flexShrink: 0,
              boxShadow: `0 ${10 * s}px ${30 * s}px rgba(0,0,0,0.45), inset 0 0 0 ${1 * s}px rgba(255,255,255,0.06)`,
            }}
          >
            {route.length >= 2 ? (
              <StaticRouteMapImage
                key={`map-${mapVersion}-${light ? 'l' : 'd'}`}
                route={route} width={mapW} height={mapH}
                accent={accent} sessionId={sessionId} light={light}
              />
            ) : (
              <div
                style={{
                  width: '100%', height: '100%',
                  background: light ? '#E8E6DF' : '#14181C',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: light ? 'rgba(10,13,16,0.45)' : 'rgba(255,255,255,0.4)',
                  fontSize: 14 * s, fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: 1.4 * s,
                }}
              >
                Indoor session
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 18 * s, flexShrink: 0 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900,
              fontSize: w * (mode === 'tall' ? 0.16 : 0.14),
              letterSpacing: -2 * s, lineHeight: 0.9, color: fg,
            }}
          >
            {distLabel}
            <span style={{ fontSize: w * 0.07, color: accent, marginLeft: 6 * s, letterSpacing: -0.5 * s }}>
              {unit}
            </span>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10 * s,
            paddingTop: 14 * s,
            borderTop: `1px solid ${borderCol}`,
            flexShrink: 0,
          }}
        >
          <StatCompact s={s} light={light} label="TIME" value={durLabel} accent={accent} />
          <StatCompact s={s} light={light} label={`PACE /${unit}`} value={paceLabel} accent={accent} />
          {elevationGainM > 0
            ? <StatCompact s={s} light={light} label="ELEV (m)" value={`${Math.round(elevationGainM)}`} accent={accent} />
            : <StatCompact s={s} light={light} label="CAL" value={`${calories}`} accent={accent} />}
        </div>

        <div
          style={{
            fontSize: 12 * s, fontWeight: 700, color: subFg,
            letterSpacing: 1.6 * s, marginTop: 12 * s, textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          TuGymPR
        </div>
      </div>
    );
  }

  // ───────────────────────── Bold ───────────────────────
  // Aspect-aware: tall stretches the number + polyline vertically;
  // square ditches the polyline and centres the number.
  if (variant === 'bold') {
    const aspect = h / w;
    const mode = aspect >= 1.4 ? 'tall' : aspect >= 1.05 ? 'portrait' : 'square';
    const light = themeMode === 'light';
    const bg = light
      ? `radial-gradient(ellipse at 30% 0%, ${accent}26 0%, transparent 55%), #EEEBE3`
      : `radial-gradient(ellipse at 30% 0%, ${accent}33 0%, transparent 55%), #0A0D10`;
    const fg = light ? '#0A0D10' : '#fff';
    const subFg = light ? 'rgba(10,13,16,0.55)' : 'rgba(255,255,255,0.5)';
    const pad = (mode === 'square' ? 28 : 36) * s;
    const numberFs = w * (mode === 'tall' ? 0.28 : mode === 'portrait' ? 0.24 : 0.22);
    const unitFs = w * (mode === 'tall' ? 0.1 : mode === 'portrait' ? 0.09 : 0.08);
    const polyHeight = mode === 'tall' ? h * 0.22 : mode === 'portrait' ? h * 0.16 : 0;
    return (
      <div
        style={{
          width: w, height: h,
          position: 'relative',
          background: bg,
          padding: pad,
          boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
          fontFamily: FONT_BODY,
          color: fg,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 16 * s, fontWeight: 800, letterSpacing: 2 * s, textTransform: 'uppercase', color: accent }}>
            {titleLabel}
          </div>
          {showGym && <GymLockup s={s} gymName={gymName} gymLogoUrl={gymLogoUrl} light={!light} />}
        </div>

        <div style={{ marginTop: (mode === 'square' ? 12 : 30) * s, marginBottom: 10 * s, flexShrink: 0 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: numberFs,
              letterSpacing: -3 * s, lineHeight: 0.85, color: fg,
            }}
          >
            {distLabel}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: unitFs,
              letterSpacing: -1 * s, color: accent, marginTop: 4 * s,
              textTransform: 'uppercase',
            }}
          >
            {unit}
          </div>
        </div>

        {showMap && polyPoints && polyHeight > 0 && (
          <div style={{ marginTop: 4 * s, flexShrink: 0 }}>
            <svg viewBox="0 0 900 520" width="100%" height={polyHeight} preserveAspectRatio="xMidYMid meet">
              <polyline
                points={polyPoints}
                fill="none" stroke={accent}
                strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 14 * s, flexShrink: 0, flexWrap: 'wrap' }}>
          <StatCompact s={s} light={light} label="DURATION" value={durLabel} accent={accent} />
          <StatCompact s={s} light={light} label={`PACE /${unit}`} value={paceLabel} accent={accent} />
          <StatCompact s={s} light={light} label="CAL" value={`${calories}`} accent={accent} />
          {elevationGainM > 0 && <StatCompact s={s} light={light} label="ELEV m" value={`${Math.round(elevationGainM)}`} accent={accent} />}
        </div>

        <div
          style={{
            fontSize: 12 * s, fontWeight: 700, color: subFg,
            letterSpacing: 1.6 * s, marginTop: 12 * s, textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          TuGymPR
        </div>
      </div>
    );
  }

  // ───────────────────────── Poster (torn stripe) ─────────
  // Aspect-aware: square + portrait shrink the giant numeral and stripe
  // so the stats stay visible; tall keeps the original poster scale.
  if (variant === 'poster') {
    const aspect = h / w;
    const mode = aspect >= 1.4 ? 'tall' : aspect >= 1.05 ? 'portrait' : 'square';
    const stripeColor = accent;
    const pad = (mode === 'square' ? 28 : 36) * s;
    const stripeH = w * (mode === 'tall' ? 0.4 : mode === 'portrait' ? 0.36 : 0.3);
    const numeralFs = w * (mode === 'tall' ? 0.3 : mode === 'portrait' ? 0.24 : 0.2);
    const unitFs = w * (mode === 'tall' ? 0.1 : mode === 'portrait' ? 0.085 : 0.075);
    return (
      <div
        style={{
          width: w, height: h,
          position: 'relative', overflow: 'hidden',
          background: '#EEEBE3',
          fontFamily: FONT_BODY, color: '#0A0D10',
          padding: pad,
          boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Decorative stripe — sits behind the distance numeral */}
        <div
          style={{
            position: 'absolute',
            top: '52%', left: -w * 0.2, right: -w * 0.2,
            height: stripeH,
            transform: 'translateY(-50%) rotate(-6deg)',
            background: stripeColor,
            zIndex: 1,
          }}
        />

        {/* Top row */}
        <div style={{ position: 'relative', zIndex: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: (mode === 'square' ? 14 : 16) * s, fontWeight: 800, letterSpacing: 2 * s, textTransform: 'uppercase' }}>
            {titleLabel}
          </div>
          {showGym && <GymLockup s={s} gymName={gymName} gymLogoUrl={gymLogoUrl} />}
        </div>

        {/* Big centred distance numeral */}
        <div
          style={{
            position: 'relative', zIndex: 3, flex: 1,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: numeralFs,
              lineHeight: 0.82, letterSpacing: -4 * s, color: '#0A0D10',
            }}
          >
            {distLabel}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: unitFs,
              letterSpacing: -1 * s, color: '#fff', marginTop: 4 * s, textTransform: 'uppercase',
            }}
          >
            {unit}
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            position: 'relative', zIndex: 3,
            display: 'flex', justifyContent: 'space-between',
            gap: (mode === 'square' ? 8 : 12) * s,
            marginBottom: 12 * s, flexShrink: 0,
          }}
        >
          <PosterCardioStat label="DURATION" value={durLabel} s={s} />
          <PosterCardioStat label={`PACE /${unit}`} value={paceLabel} s={s} />
          <PosterCardioStat label="CAL" value={`${calories}`} s={s} />
        </div>

        {/* TuGymPR wordmark */}
        <div
          style={{
            position: 'relative', zIndex: 3,
            fontSize: 14 * s, fontWeight: 800, letterSpacing: 1.5 * s,
            textTransform: 'uppercase', color: 'rgba(10,13,16,0.55)',
            flexShrink: 0,
          }}
        >
          TuGymPR
        </div>
      </div>
    );
  }

  // ───────────────────────── Photo (bg photo + route) ─────
  // Aspect-aware: content always anchors to the bottom of the photo so the
  // user's framing stays the hero. Number/label sizes scale with width.
  if (variant === 'photo') {
    const aspect = h / w;
    const mode = aspect >= 1.4 ? 'tall' : aspect >= 1.05 ? 'portrait' : 'square';
    // Sticker mode for the photo variant: no user photo + transparent flag on.
    // Drop the bg + dark legibility overlay so the rasterized PNG carries
    // alpha. With a user photo OR opaque mode, behave as before.
    const photoSticker = transparent && !backgroundSrc;
    const pad = (mode === 'square' ? 28 : 36) * s;
    const distFs = w * (mode === 'tall' ? 0.2 : mode === 'portrait' ? 0.17 : 0.15);
    const unitFs = w * (mode === 'tall' ? 0.09 : mode === 'portrait' ? 0.08 : 0.07);
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
          padding: pad, boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          fontFamily: FONT_BODY, color: '#fff',
        }}
      >
        {showMap && polyPoints && mode !== 'square' && (
          <div
            style={{
              position: 'absolute', top: pad * 1.4, left: pad * 0.4, right: pad * 0.4,
              opacity: 0.95, pointerEvents: 'none',
            }}
          >
            <svg viewBox="0 0 900 520" width="100%" height={h * (mode === 'tall' ? 0.35 : 0.28)} preserveAspectRatio="xMidYMid meet">
              <polyline
                points={polyPoints}
                fill="none" stroke={accent}
                strokeWidth="14" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ fontSize: 14 * s, fontWeight: 800, letterSpacing: 2 * s, textTransform: 'uppercase', color: accent }}>
            {titleLabel}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: distFs,
              letterSpacing: -2 * s, lineHeight: 0.85, color: '#fff', marginTop: 8 * s,
            }}
          >
            {distLabel} <span style={{ fontSize: unitFs, color: accent }}>{unit}</span>
          </div>
          <div
            style={{
              marginTop: 14 * s, display: 'flex', gap: 18 * s, flexWrap: 'wrap',
              borderTop: '1px solid rgba(255,255,255,0.25)',
              paddingTop: 12 * s,
            }}
          >
            <StatCompact s={s} label="DURATION" value={durLabel} accent={accent} />
            <StatCompact s={s} label={`PACE /${unit}`} value={paceLabel} accent={accent} />
            <StatCompact s={s} label="CAL" value={`${calories}`} accent={accent} />
          </div>
          <div style={{ marginTop: 12 * s, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {showGym ? <GymLockup s={s} gymName={gymName} gymLogoUrl={gymLogoUrl} light /> : <span />}
            <div style={{ fontSize: 12 * s, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: 1.6 * s, textTransform: 'uppercase' }}>
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
// Horizontal label-value row used by the square-aspect editorial layout —
// fits well in the right-hand column without grid wrapping.
function StatRow({ label, value, s = 1, light = false }) {
  const labelColor = light ? 'rgba(10,13,16,0.55)' : 'rgba(255,255,255,0.6)';
  const valueColor = light ? '#0A0D10' : '#fff';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 * s }}>
      <div style={{ fontSize: 9 * s, fontWeight: 800, letterSpacing: 1.4 * s, textTransform: 'uppercase', color: labelColor }}>
        {label}
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 18 * s, color: valueColor, letterSpacing: -0.3 * s, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function PosterCardioStat({ label, value, s = 1 }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10 * s, fontWeight: 800, letterSpacing: 1.4 * s,
          textTransform: 'uppercase', color: 'rgba(10,13,16,0.55)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 26 * s,
          letterSpacing: -0.5 * s, lineHeight: 1, color: '#0A0D10', marginTop: 4 * s,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatCompact({ label, value, accent, s = 1, light = false }) {
  const labelColor = light ? 'rgba(10,13,16,0.55)' : 'rgba(255,255,255,0.6)';
  const valueColor = light ? '#0A0D10' : '#fff';
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10 * s, fontWeight: 800, letterSpacing: 1.4 * s,
          textTransform: 'uppercase',
          color: labelColor,
          marginBottom: 4 * s,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 22 * s,
          letterSpacing: -0.5 * s, lineHeight: 1, color: valueColor,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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
