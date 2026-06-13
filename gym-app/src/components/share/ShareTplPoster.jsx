import React from 'react';
import GymLockup from './GymLockup';

// `s` is the canvas-to-preview scale (w / 270). Multiply every literal
// pixel by `s` so the same template renders proportionally at 270×480
// (preview) and 1080×1920 (IG Story export).
function PosterStat({ label, value, s = 1 }) {
  return (
    <div>
      <div style={{ fontSize: 8 * s, fontWeight: 800, letterSpacing: 1.2 * s, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: '"Archivo", sans-serif', fontSize: 20 * s, fontWeight: 900, color: '#fff', letterSpacing: -0.5 * s, lineHeight: 1, marginTop: 1 * s }}>
        {value}
      </div>
    </div>
  );
}

/**
 * TEMPLATE C — Poster (layered, magazine). Orange accent fixed (#FF5A2E).
 * Ported from Share Workout.html reference.
 */
export default function ShareTplPoster({
  w, h, data,
  showGym = true,
  showExactWeights = true,
  showMuscles = true, // eslint-disable-line no-unused-vars
  showPRs = true,
  accent = '#FF5A2E',
}) {
  // Aspect-aware layout tweaks — square/portrait need a smaller headline
  // and tighter stat-card placement so the bottom-right card doesn't
  // collide with the centred giant title.
  const aspect = h / w;
  const mode = aspect >= 1.4 ? 'tall' : aspect >= 1.05 ? 'portrait' : 'square';
  const pad = Math.round(w * (mode === 'square' ? 0.05 : 0.055));
  // Single scale factor — see PosterStat. Keeps every literal pixel value
  // proportional across preview (270 wide) and export (1080 wide).
  const s = w / 270;
  // data.gym may be an object ({name,location}) or a string — render only the
  // name as text (a raw object as a React child crashes the share sheet).
  const gymLabel = (typeof data?.gym === 'string' ? data.gym : data?.gym?.name) || 'TuGymPR';
  const nameWords = (data.name || '').split(' ').slice(0, 2);
  const headlineFs = w * (mode === 'tall' ? 0.22 : mode === 'portrait' ? 0.18 : 0.14);
  const statCardBottom = pad * (mode === 'square' ? 2.6 : 3.8);
  const accentSplashTop = `${mode === 'tall' ? 32 : mode === 'portrait' ? 38 : 44}%`;

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        background: '#EEEBE3',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
      }}
    >
      {/* paper texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.35,
          pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(10,13,16,0.04) 0, rgba(10,13,16,0.04) 1px, transparent 1px, transparent 3px)',
        }}
      />

      {/* accent splash */}
      <div
        style={{
          position: 'absolute',
          top: accentSplashTop,
          left: -w * 0.15,
          width: w * 1.3,
          height: w * (mode === 'square' ? 0.5 : 0.7),
          borderRadius: '50%',
          background: accent,
          transform: 'rotate(-8deg)',
        }}
      />

      {/* Top label. IG Stories' close-button + sticker-tool chrome covers
          the first ~7% of the canvas; positioning at plain `pad` (~5.5%)
          tucks the "Vol. 01" line and date underneath IG's own UI. Push
          down into the safe zone — `pad * 2.5` lands around 13% which
          clears IG's overlay on every device. */}
      <div
        style={{
          position: 'absolute',
          top: pad * 2.5,
          left: pad,
          right: pad,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 3,
        }}
      >
        <div
          style={{
            fontFamily: '"Archivo", sans-serif',
            fontSize: 9 * s,
            fontWeight: 900,
            letterSpacing: 2.2 * s,
            color: '#0A0D10',
            textTransform: 'uppercase',
            borderBottom: '1.5px solid #0A0D10',
            paddingBottom: 4 * s,
          }}
        >
          Vol. 01 — Log No. {data.sessionNo || '—'}
        </div>
        <div style={{ fontSize: 9 * s, fontWeight: 700, color: '#0A0D10', letterSpacing: 1.4 * s, textTransform: 'uppercase' }}>
          {data.date}
        </div>
      </div>

      {/* Giant headline — pushed down to keep the spacing below the
          new (safer) top-label position. */}
      <div
        style={{
          position: 'absolute',
          top: pad * 4,
          left: pad,
          right: pad,
          zIndex: 3,
          fontFamily: '"Archivo Black", "Archivo", sans-serif',
          fontSize: headlineFs,
          fontWeight: 900,
          color: '#0A0D10',
          letterSpacing: -2 * s,
          lineHeight: 0.82,
          textTransform: 'uppercase',
        }}
      >
        {nameWords.length > 0
          ? nameWords.map((word, i) => (
              <div
                key={i}
                style={{
                  color: i === 1 ? '#FAFAF7' : '#0A0D10',
                  WebkitTextStroke: i === 1 ? `${1.5 * s}px #0A0D10` : 'none',
                  textShadow: i === 1 ? `${3 * s}px ${3 * s}px 0 #0A0D10` : 'none',
                }}
              >
                {word}
              </div>
            ))
          : <div>WORKOUT</div>}
      </div>

      {/* Stat card */}
      <div
        style={{
          position: 'absolute',
          bottom: statCardBottom,
          right: pad,
          zIndex: 4,
          background: '#0A0D10',
          color: '#fff',
          padding: `${pad * 0.8}px ${pad * 0.9}px`,
          transform: 'rotate(-2deg)',
          boxShadow: `${4 * s}px ${4 * s}px 0 rgba(255,255,255,0.8)`,
          maxWidth: w * 0.62,
        }}
      >
        <div style={{ fontSize: 8 * s, fontWeight: 800, letterSpacing: 1.6 * s, color: accent, textTransform: 'uppercase' }}>
          The Numbers
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 * s, marginTop: 6 * s }}>
          <PosterStat s={s} label="Time" value={`${data.duration}'`} />
          <PosterStat s={s} label="Sets" value={data.sets} />
          <PosterStat
            s={s}
            label="Vol"
            value={
              showExactWeights
                ? `${Math.round(((data.volume || 0) / 1000) * 10) / 10}k`
                : `${Math.round((data.volume || 0) / 1000)}k+`
            }
          />
          <PosterStat s={s} label="Kcal" value={data.kcal} />
        </div>
        {showPRs && data.prs?.[0] && (
          <div
            style={{
              marginTop: 8 * s,
              paddingTop: 8 * s,
              borderTop: '1px solid rgba(255,255,255,0.15)',
              fontSize: 10 * s,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{ color: accent }}>🏆 PR · </span>
            {data.prs[0].lift}
            {showExactWeights && data.prs[0].weight ? ` — ${data.prs[0].weight} lbs` : ''}
          </div>
        )}
      </div>

      {/* Footer stripe */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 5,
          background: '#0A0D10',
          color: '#fff',
          padding: `${pad * 0.55}px ${pad}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {showGym && data.gym ? (
          <GymLockup s={s} gym={data.gym} logoUrl={data.gymLogoUrl} size="sm" tone="light" />
        ) : (
          <div style={{ fontSize: 10 * s, fontWeight: 700, color: '#fff' }}>@{data.userHandle || data.user}</div>
        )}
        <div style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontSize: 11 * s, fontWeight: 800, letterSpacing: -0.3 * s }}>
          {gymLabel}
        </div>
      </div>
    </div>
  );
}
