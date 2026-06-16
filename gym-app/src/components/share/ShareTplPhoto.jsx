import React from 'react';
import GymLockup from './GymLockup';
import { TuFont } from './ShareFormats';

/**
 * TEMPLATE D — Photo (Strava / Ariana Grande style).
 * Full-bleed photo background with a dark gradient overlay and stats layered
 * on top. Falls back to a dark gradient + barbell SVG when no backgroundSrc is
 * provided.
 */
function Stat({ label, value, size, align = 'left' }) {
  return (
    <div style={{ textAlign: align, minWidth: 0, overflow: 'hidden' }}>
      <div
        style={{
          fontFamily: TuFont.body,
          fontSize: size.num,
          fontWeight: 800,
          color: '#fff',
          letterSpacing: -0.5,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: size.lbl,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.55)',
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          marginTop: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default function ShareTplPhoto({
  w,
  h,
  data = {},
  showGym = true,
  showExactWeights = true,
  showMuscles = true, // eslint-disable-line no-unused-vars
  showPRs = true,
  accent = '#2EC4C4', // eslint-disable-line no-unused-vars
  backgroundSrc,
  transparent = false,
}) {
  // Sticker mode without a user-supplied photo: render bare stats over a
  // transparent canvas (Strava's "no background" Stats Sticker). When the
  // user DOES pick a photo, keep it even in sticker mode — their photo IS
  // the design.
  const sticker = transparent && !backgroundSrc;
  const pad = Math.round(w * 0.06);
  // Scale typography based on the shorter dimension to keep things sensible
  // across 9:16 / 1:1 / 4:5.
  const aspect = h / w;
  const titleFs =
    aspect > 1.5 ? Math.round(w * 0.135) : aspect > 1.1 ? Math.round(w * 0.11) : Math.round(w * 0.1);
  const statSize =
    aspect > 1.5
      ? { num: Math.round(w * 0.085), lbl: 10 }
      : aspect > 1.1
        ? { num: Math.round(w * 0.07), lbl: 10 }
        : { num: Math.round(w * 0.065), lbl: 10 };

  const prCount = Array.isArray(data.prs) ? data.prs.length : data.prs || 0;
  const volumeLabel = showExactWeights
    ? `${Math.round(((data.volume || 0) / 1000) * 10) / 10}k`
    : `${Math.round((data.volume || 0) / 1000)}k+`;

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        // Sticker (no user photo): drop the surface so the exported PNG carries
        // alpha and the text/stats float on whatever IG Story photo the user
        // composes us over. With a user photo OR in opaque mode, fall back to
        // the dark surface as before.
        background: sticker ? 'transparent' : '#0A0D10',
        fontFamily: TuFont.body,
      }}
    >
      {/* Background: photo (if picked), or fallback gradient + barbell when
          opaque, or NOTHING when sticker mode + no photo. */}
      {backgroundSrc ? (
        <img
          src={backgroundSrc}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : !sticker ? (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, #3a3530 0%, #1a1817 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'radial-gradient(circle at 20% 40%, rgba(255,200,100,0.18), transparent 50%), radial-gradient(circle at 75% 65%, rgba(40,40,40,0.8), transparent 60%)',
            }}
          />
          <svg
            viewBox="0 0 400 220"
            preserveAspectRatio="xMidYMid slice"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.45 }}
          >
            <rect x="240" y="40" width="8" height="150" fill="#111" />
            <rect x="320" y="40" width="8" height="150" fill="#111" />
            <rect x="236" y="95" width="96" height="6" fill="#222" />
            <circle cx="260" cy="120" r="28" fill="#0a0a0a" />
            <circle cx="260" cy="120" r="20" fill="#2a2a2a" />
            <circle cx="308" cy="120" r="28" fill="#0a0a0a" />
            <circle cx="308" cy="120" r="20" fill="#2a2a2a" />
          </svg>
        </>
      ) : null}

      {/* Dark gradient overlay — purely for legibility on top of the bg/photo.
          Skipped in sticker mode so the stats sit on raw alpha (the IG photo
          the user will compose us over does the contrast job itself). */}
      {!sticker && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 100%)',
          }}
        />
      )}

      {/* Top-left: eyebrow + workout name */}
      <div
        style={{
          position: 'absolute',
          top: pad,
          left: pad,
          right: pad,
          zIndex: 2,
          color: '#fff',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.7)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {data.date || ''}
        </div>
        <div
          style={{
            fontFamily: TuFont.display,
            fontSize: titleFs,
            fontWeight: 800,
            letterSpacing: -1,
            lineHeight: 0.95,
            marginTop: 6,
            textShadow: '0 2px 20px rgba(0,0,0,0.4)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {data.name || 'Workout'}
        </div>
      </div>

      {/* Bottom: stats strip + optional gym lockup */}
      <div
        style={{
          position: 'absolute',
          bottom: pad,
          left: pad,
          right: pad,
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: Math.round(pad * 0.6),
        }}
      >
        {/* Stat strip */}
        <div
          style={{
            display: 'grid',
            // minmax(0,1fr) lets each cell shrink below its content width so the
            // Stat values truncate (ellipsis) instead of overflowing the strip.
            gridTemplateColumns: 'minmax(0,1fr) 1px minmax(0,1fr) 1px minmax(0,1fr)',
            alignItems: 'center',
            gap: Math.round(pad * 0.4),
            paddingTop: Math.round(pad * 0.5),
            borderTop: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <Stat label="Duration" value={`${data.duration || 0}'`} size={statSize} />
          <div style={{ width: 1, height: '62%', background: 'rgba(255,255,255,0.18)', margin: '0 auto' }} />
          <Stat label="Volume" value={volumeLabel} size={statSize} align="center" />
          <div style={{ width: 1, height: '62%', background: 'rgba(255,255,255,0.18)', margin: '0 auto' }} />
          <Stat label={showPRs ? 'PRs' : 'Sets'} value={showPRs ? prCount : data.sets || 0} size={statSize} align="right" />
        </div>

        {/* Gym lockup */}
        {showGym && data.gym && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <GymLockup s={w / 270} gym={data.gym} logoUrl={data.gymLogoUrl} size="sm" tone="light" />
          </div>
        )}
      </div>
    </div>
  );
}
