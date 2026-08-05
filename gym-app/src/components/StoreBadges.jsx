// StoreBadges.jsx
// The App Store / Google Play badges, drawn INLINE as SVG.
//
// WHY INLINE AND NOT AN <img>: index.html ships a strict CSP —
// `img-src 'self' data: blob: https://*.supabase.co …` — so the artwork Apple and
// Google host on their own CDNs is blocked outright. Inline SVG is same-origin
// markup, costs no request, and stays sharp at any density, which a raster badge
// on a 3x phone does not.
//
// ⚠️ BEFORE LAUNCH: these are faithful RECREATIONS, not the official files. Both
// Apple ("Download on the App Store" — Apple Marketing Resources) and Google
// ("Get it on Google Play" — Play badge generator) require their own artwork,
// with fixed clear-space and minimum-size rules, and Apple checks it at review.
// Drop the official SVGs into `public/` and swap the two components below for
// <img> tags — the CSP already allows 'self', so nothing else has to change.

const APPLE_LOGO = 'M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z';

// The badges sit on the dark radial gradient this page uses, so they take the
// black fill + hairline border treatment both vendors specify for dark surfaces.
const shell = {
  display: 'flex', alignItems: 'center', gap: 10,
  height: 52, padding: '0 16px',
  // Measured: the App Store lockup comes out 154px and Google Play 172px. Left
  // alone they stack as two centred rectangles of different widths, which reads
  // as sloppy rather than as two vendors' marks. A shared min-width evens the
  // block; the artwork inside is untouched, so neither vendor's no-distortion
  // rule is bent — only the padding around it grows.
  minWidth: 176,
  justifyContent: 'center',
  borderRadius: 10,
  background: '#000',
  border: '1px solid rgba(255,255,255,0.28)',
  textDecoration: 'none',
  boxSizing: 'border-box',
};
// The two-line lockup: a small caption over a large wordmark. Line height is
// pinned rather than inherited — this page's font stack is Barlow, and letting a
// condensed face set the wordmark is what makes a recreated badge read as fake.
const capStyle = {
  display: 'block', color: '#fff', fontSize: 10, lineHeight: '11px',
  letterSpacing: 0.2, fontWeight: 400,
  fontFamily: '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif',
};
const wordStyle = {
  display: 'block', color: '#fff', fontSize: 19, lineHeight: '22px',
  letterSpacing: -0.3, fontWeight: 600,
  fontFamily: '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif',
};

export function AppStoreBadge({ href, caption = 'Download on the' }) {
  return (
    <a href={href} style={shell} aria-label="Download on the App Store">
      <svg viewBox="0 0 384 512" width="24" height="30" aria-hidden="true" focusable="false" style={{ flexShrink: 0, marginTop: -2 }}>
        <path d={APPLE_LOGO} fill="#fff" />
      </svg>
      <span>
        <span style={capStyle}>{caption}</span>
        <span style={wordStyle}>App Store</span>
      </span>
    </a>
  );
}

export function GooglePlayBadge({ href, caption = 'GET IT ON' }) {
  return (
    <a href={href} style={shell} aria-label="Get it on Google Play">
      {/* Four wedges, not one glyph — the Play mark is only recognisable in
          colour, and a monochrome version reads as a generic play button. */}
      <svg viewBox="0 0 512 512" width="26" height="28" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
        <path d="M47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0z" fill="#00A0FF" />
        <path d="M325.3 234.3 104.6 13l280.8 161.2-60.1 60.1z" fill="#00E676" />
        <path d="M472.2 225.6l-88.6-51.3-65.2 65.2 65.2 65.2 90.4-51.3c27.1-21.4 27.1-56.7-1.8-77.8z" fill="#FFCE00" />
        <path d="M104.6 499l280.8-161.2-60.1-60.1L104.6 499z" fill="#FF3A44" />
      </svg>
      <span>
        <span style={{ ...capStyle, fontSize: 9, letterSpacing: 1.1, textTransform: 'uppercase' }}>{caption}</span>
        <span style={wordStyle}>Google Play</span>
      </span>
    </a>
  );
}

/**
 * Render whichever badges are configured, in the order given.
 * `stores` entries are `{ key: 'ios' | 'android', url }` — already sorted by the
 * caller so the visitor's own platform comes first.
 */
export default function StoreBadges({ stores, captions }) {
  if (!stores?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
      {stores.map((s) => (s.key === 'ios'
        ? <AppStoreBadge key={s.key} href={s.url} caption={captions?.ios} />
        : <GooglePlayBadge key={s.key} href={s.url} caption={captions?.android} />
      ))}
    </div>
  );
}
