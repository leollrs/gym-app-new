import React from 'react';

/**
 * Simple front-body heatmap. Accepts per-muscle intensity 0..1.
 * Ported verbatim from the Share Workout reference design.
 */
export default function MuscleMap({ muscles = {}, size = 80, color = '#2EC4C4', dim = '#333' }) {
  const h = (k) => Math.max(0.18, Math.min(1, muscles[k] || 0));
  const col = (k) => {
    const v = h(k);
    return `color-mix(in oklch, ${color} ${Math.round(v * 100)}%, ${dim})`;
  };
  return (
    <svg viewBox="0 0 64 100" width={size * 0.64} height={size} aria-hidden="true">
      {/* head */}
      <ellipse cx="32" cy="10" rx="7" ry="8.5" fill={dim} opacity="0.5" />
      {/* neck */}
      <rect x="29" y="17" width="6" height="5" fill={dim} opacity="0.5" />
      {/* shoulders */}
      <path d="M17 22 Q21 21 25 22 L25 30 Q21 30 17 30 Z" fill={col('shoulders')} />
      <path d="M47 22 Q43 21 39 22 L39 30 Q43 30 47 30 Z" fill={col('shoulders')} />
      {/* chest */}
      <path d="M25 22 Q32 21 39 22 L39 36 Q32 39 25 36 Z" fill={col('chest')} />
      {/* biceps */}
      <rect x="14" y="28" width="7" height="18" rx="3" fill={col('arms')} />
      <rect x="43" y="28" width="7" height="18" rx="3" fill={col('arms')} />
      {/* forearms */}
      <rect x="14" y="47" width="6" height="15" rx="2.5" fill={dim} opacity="0.5" />
      <rect x="44" y="47" width="6" height="15" rx="2.5" fill={dim} opacity="0.5" />
      {/* core */}
      <rect x="26" y="37" width="12" height="14" rx="2" fill={col('core')} />
      {/* hips */}
      <path d="M24 51 L40 51 L41 58 L23 58 Z" fill={dim} opacity="0.55" />
      {/* quads */}
      <rect x="23" y="58" width="8" height="22" rx="3" fill={col('quads')} />
      <rect x="33" y="58" width="8" height="22" rx="3" fill={col('quads')} />
      {/* calves */}
      <rect x="24" y="81" width="6" height="15" rx="2" fill={col('calves')} />
      <rect x="34" y="81" width="6" height="15" rx="2" fill={col('calves')} />
    </svg>
  );
}
