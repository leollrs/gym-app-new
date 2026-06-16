import React from 'react';
import { TuFont } from './ShareFormats';

/**
 * Gym branding lockup for share cards.
 * Ported from the Share Workout reference (Vol. 01).
 */
export default function GymLockup({ gym = {}, size = 'md', tone = 'light', logoUrl, style = {}, s = 1 }) {
  const light = tone === 'light';
  const fg = light ? '#fff' : '#0A0D10';
  const sub = light ? 'rgba(255,255,255,0.72)' : 'rgba(10,13,16,0.6)';
  const logoBg = light ? 'rgba(255,255,255,0.12)' : 'rgba(10,13,16,0.06)';
  const borderCol = light ? 'rgba(255,255,255,0.2)' : 'rgba(10,13,16,0.12)';

  // `s` is the canvas-to-preview scale (w / 270 in callers). Multiply every
  // literal size by it so the gym name reads at full Story scale on a
  // 1080-wide export instead of staying at 11–16 px regardless. Defaults
  // to 1 so call sites that don't pass `s` (legacy) keep their original
  // appearance.
  const base = {
    sm: { logo: 26, name: 11, loc: 9, gap: 8 },
    md: { logo: 34, name: 13, loc: 10, gap: 10 },
    lg: { logo: 44, name: 16, loc: 11, gap: 12 },
  }[size] || { logo: 34, name: 13, loc: 10, gap: 10 };
  const sizes = {
    logo: base.logo * s,
    name: base.name * s,
    loc:  base.loc  * s,
    gap:  base.gap  * s,
  };

  const initial = ((gym.name || 'G').trim()[0] || 'G').toUpperCase();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: sizes.gap, minWidth: 0, ...style }}>
      <div
        style={{
          width: sizes.logo,
          height: sizes.logo,
          borderRadius: sizes.logo / 2,
          background: logoBg,
          border: `${1.5 * s}px solid ${borderCol}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            crossOrigin="anonymous"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span
            style={{
              color: '#E8C547',
              fontFamily: '"Archivo", system-ui',
              fontWeight: 900,
              fontSize: sizes.logo * 0.42,
              letterSpacing: -0.5 * s,
            }}
          >
            {initial}
          </span>
        )}
      </div>
      <div style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
        <div
          style={{
            fontFamily: TuFont.display,
            fontSize: sizes.name,
            fontWeight: 800,
            color: fg,
            letterSpacing: -0.2 * s,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            // Cap to the parent block (which is minWidth:0 inside the card's
            // footer) rather than a fixed px, so long gym names truncate to the
            // space actually available at any card size instead of overflowing.
            maxWidth: Math.min(180 * s, 1000),
          }}
        >
          {gym.name || 'TuGymPR'}
        </div>
        {gym.location && (
          <div
            style={{
              fontSize: sizes.loc,
              color: sub,
              fontWeight: 600,
              letterSpacing: 0.4 * s,
              textTransform: 'uppercase',
              marginTop: 2 * s,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: Math.min(180 * s, 1000),
            }}
          >
            {gym.location}
          </div>
        )}
      </div>
    </div>
  );
}
