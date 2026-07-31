import { useState } from 'react';

/**
 * An <img> that degrades instead of showing the browser's broken-image glyph.
 *
 * THE PROBLEM IT SOLVES: most photo surfaces render Supabase SIGNED urls —
 * progress photos, check-in photos, social posts. Those expire (1h, 6h), and
 * the URL is baked into already-rendered data or a cache. Leave a tab open past
 * the expiry, or delete the underlying object, and every one of those <img>
 * tags paints a blue box with a question mark where a member's photo was.
 *
 * On failure it renders a neutral block carrying the SAME className and style,
 * so the layout is byte-identical to the loaded state — no reflow, no collapsed
 * grid cell, just a quiet placeholder. Pass `fallback` to override, including
 * `fallback={null}` to remove the element entirely.
 */
export default function SafeImg({ src, fallback, className = '', style, alt = '', ...rest }) {
  const [failed, setFailed] = useState(false);
  // Reset when the src changes so a re-signed URL gets a fresh chance.
  const [tried, setTried] = useState(src);
  if (src !== tried) { setTried(src); setFailed(false); }

  if (!src || failed) {
    if (fallback !== undefined) return fallback;
    return (
      <div
        aria-hidden
        className={className}
        style={{ ...style, background: 'var(--color-surface-hover, rgba(127,127,127,0.12))' }}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      {...rest}
      onError={() => setFailed(true)}
    />
  );
}
