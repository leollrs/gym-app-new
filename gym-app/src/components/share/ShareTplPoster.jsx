import React from 'react';
import GymLockup from './GymLockup';

// `s` is the canvas-to-preview scale (w / 270). Multiply every literal
// pixel by `s` so the same template renders proportionally at 270×480
// (preview) and 1080×1920 (IG Story export).
function PosterStat({ label, value, s = 1 }) {
  return (
    <div style={{ minWidth: 0, overflow: 'hidden' }}>
      <div
        style={{
          fontSize: 8 * s,
          fontWeight: 800,
          letterSpacing: 1.2 * s,
          color: 'rgba(255,255,255,0.55)',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: '"Archivo", sans-serif',
          fontSize: 20 * s,
          fontWeight: 900,
          color: '#fff',
          letterSpacing: -0.5 * s,
          lineHeight: 1,
          marginTop: 1 * s,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
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
  // Conservative height estimate of the bottom-right stat card (label + 2×2
  // grid + optional PR row + vertical padding). Used to bound the headline so
  // it never grows down into the card on square/portrait, where vertical space
  // is tight. Over-estimating slightly is safe — it just keeps the title higher.
  const statCardH =
    pad * 1.6 + // top + bottom padding (pad*0.8 each)
    14 * s + // "The Numbers" label
    (20 + 8 + 20) * s + // two stat rows (value height) + row gap
    (showPRs && data.prs?.[0] ? 26 * s : 0); // PR divider + row
  // Lowest y the headline block may reach: clear the stat card's top edge with
  // a small breathing gap.
  const headlineBottom = statCardBottom + statCardH + 8 * s;

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
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10 * s,
          zIndex: 3,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            fontFamily: '"Archivo", sans-serif',
            fontSize: 9 * s,
            fontWeight: 900,
            letterSpacing: 2.2 * s,
            color: '#0A0D10',
            textTransform: 'uppercase',
            borderBottom: '1.5px solid #0A0D10',
            paddingBottom: 4 * s,
            whiteSpace: 'nowrap',
          }}
        >
          Vol. 01 — Log No. {data.sessionNo || '—'}
        </div>
        <div
          style={{
            minWidth: 0,
            flexShrink: 1,
            fontSize: 9 * s,
            fontWeight: 700,
            color: '#0A0D10',
            letterSpacing: 1.4 * s,
            textTransform: 'uppercase',
            textAlign: 'right',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {data.date}
        </div>
      </div>

      {/* Giant headline — pushed down to keep the spacing below the
          new (safer) top-label position. Bottom-bounded so the words never
          run into the stat card on square/portrait, and each word clips with
          an ellipsis so a long single word can't bleed off the page edge. */}
      <div
        style={{
          position: 'absolute',
          top: pad * 4,
          left: pad,
          right: pad,
          // Reserve the lower portion of the canvas for the stat card so the
          // headline can grow downward without overlapping it.
          bottom: headlineBottom,
          zIndex: 3,
          fontFamily: '"Archivo Black", "Archivo", sans-serif',
          fontSize: headlineFs,
          fontWeight: 900,
          color: '#0A0D10',
          letterSpacing: -2 * s,
          lineHeight: 0.82,
          textTransform: 'uppercase',
          overflow: 'hidden',
        }}
      >
        {nameWords.length > 0
          ? nameWords.map((word, i) => (
              <div
                key={i}
                style={{
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 * s, marginTop: 6 * s }}>
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
              display: 'flex',
              alignItems: 'baseline',
              gap: 6 * s,
              fontSize: 10 * s,
              fontWeight: 700,
            }}
          >
            {/* Name truncates; the weight keeps a fixed column so the number
                is never clipped by a long lift name. */}
            <span
              style={{
                minWidth: 0,
                flexShrink: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span style={{ color: accent }}>🏆 PR · </span>
              {data.prs[0].lift}
            </span>
            {showExactWeights && data.prs[0].weight ? (
              <span style={{ flexShrink: 0, whiteSpace: 'nowrap', color: accent }}>
                {data.prs[0].weight} lbs
              </span>
            ) : null}
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
          gap: 10 * s,
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
          {showGym && data.gym ? (
            <GymLockup s={s} gym={data.gym} logoUrl={data.gymLogoUrl} size="sm" tone="light" />
          ) : (
            <div
              style={{
                fontSize: 10 * s,
                fontWeight: 700,
                color: '#fff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              @{data.userHandle || data.user}
            </div>
          )}
        </div>
        <div
          style={{
            flexShrink: 0,
            maxWidth: w * 0.45,
            fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
            fontSize: 11 * s,
            fontWeight: 800,
            letterSpacing: -0.3 * s,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {gymLabel}
        </div>
      </div>
    </div>
  );
}
