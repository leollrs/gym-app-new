/**
 * Shared primitives used by all 4 TV display styles.
 *
 * - TVAvatar:    initials-based fallback avatar, with optional image source.
 *                Color is derived from the name hash so siblings/duplicates
 *                still get visually distinct circles.
 * - TVLogoMark:  the gym's logo (signed URL passed in) OR a generic mark when
 *                no logo is configured. Sized via the `size` prop.
 * - TVSparkBars: a tiny inline bar chart of a fixed-length series, used by
 *                V1/V4 to show "last 14 days of activity" per row.
 */

import { useMemo } from 'react';

// Stable palette for initial-avatar backgrounds. Picked from the name hash
// so the same person always gets the same color across slides.
const AVATAR_COLORS = [
  '#FF5A2E', '#2EE0E0', '#D4AF37', '#2FA66B',
  '#8E5BFF', '#E04D4D', '#FFC447', '#3DBEFF',
  '#FF6B9D', '#5BD17A',
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < (s?.length || 0); i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function TVAvatar({ name, src, size = 48, ring = false, ringColor }) {
  const initials = useMemo(() => {
    if (!name) return '?';
    return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }, [name]);
  const bg = AVATAR_COLORS[hashString(name || '') % AVATAR_COLORS.length];
  const fontSize = Math.round(size * 0.42);
  const border = ring ? `3px solid ${ringColor || '#FFFFFF'}` : undefined;

  if (src) {
    return (
      <img
        src={src}
        alt={name || 'avatar'}
        width={size}
        height={size}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', flexShrink: 0,
          border,
        }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }

  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: bg, color: '#FFFFFF',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize, flexShrink: 0,
        border,
        letterSpacing: '-0.02em',
      }}
    >
      {initials}
    </div>
  );
}


/**
 * TVLogoMark — renders the gym's logo if a URL is provided, otherwise a
 * generic dumbbell mark in the requested color. Used in style headers.
 */
export function TVLogoMark({ src, size = 40, color = '#FFFFFF' }) {
  if (src) {
    return (
      <img
        src={src}
        alt="logo"
        style={{
          width: size, height: size, objectFit: 'contain',
          background: '#FFFFFFEE',
          borderRadius: size * 0.18,
          padding: size * 0.08,
          flexShrink: 0,
        }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  // Generic dumbbell glyph — same proportions as a heavy weight icon.
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ flexShrink: 0 }}>
      <rect x="6"  y="22" width="10" height="20" rx="2" fill={color}/>
      <rect x="2"  y="18" width="6"  height="28" rx="2" fill={color}/>
      <rect x="48" y="22" width="10" height="20" rx="2" fill={color}/>
      <rect x="56" y="18" width="6"  height="28" rx="2" fill={color}/>
      <rect x="16" y="29" width="32" height="6"  rx="1" fill={color}/>
    </svg>
  );
}


/**
 * TVSparkBars — fixed-length bar chart in `w x h` pixels. Bars are scaled
 * to `max(data)`. The last bar uses `color`; earlier bars use `restColor`.
 */
export function TVSparkBars({ data = [], w = 200, h = 32, color = '#2EE0E0', restColor = 'rgba(255,255,255,0.12)', gap = 2 }) {
  const max = Math.max(1, ...data.map(Number));
  const barW = (w - gap * (data.length - 1)) / data.length;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {data.map((v, i) => {
        const bh = (Number(v) / max) * (h - 2);
        const x = i * (barW + gap);
        const y = h - bh;
        const isLast = i === data.length - 1;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={Math.max(2, bh)}
            rx={1}
            fill={isLast ? color : restColor}
          />
        );
      })}
    </svg>
  );
}
