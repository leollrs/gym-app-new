// mapboxStatic.js
// -----------------------------------------------------------------------------
// Mapbox Static Images API — generates a Strava-quality route image with a
// single HTTP call. The polyline is encoded directly into the URL using the
// Google Encoded Polyline algorithm and Mapbox renders it server-side over
// real map tiles.
//
// Usage:
//   const url = mapboxStaticUrlForRoute(route, { width, height, accent });
//   // -> https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/path-…/auto/Wx{H}@2x?access_token=…
//
// Returns null when no token is configured so the caller can fall back to
// the client-side tile stitcher / route-only render.
//
// The token comes from the VITE_MAPBOX_TOKEN env var (set in .env or the
// build environment). It's a public-scoped token — safe to ship in the
// client bundle as long as it's URL-restricted in the Mapbox dashboard.
// -----------------------------------------------------------------------------

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

// Default style — Mapbox's "dark-v11" matches the dark Strava aesthetic.
// Other good options: streets-v12, outdoors-v12, satellite-streets-v12.
const DEFAULT_STYLE = 'dark-v11';

// Encode a polyline into Google's Encoded Polyline Algorithm (precision 5).
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
function encodePolyline(points) {
  let prevLat = 0;
  let prevLng = 0;
  const out = [];

  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out.push(encodeSigned(lat - prevLat));
    out.push(encodeSigned(lng - prevLng));
    prevLat = lat;
    prevLng = lng;
  }
  return out.join('');
}

function encodeSigned(num) {
  let sgn = num < 0 ? ~(num << 1) : (num << 1);
  let str = '';
  while (sgn >= 0x20) {
    str += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  str += String.fromCharCode(sgn + 63);
  return str;
}

export function isMapboxConfigured() {
  return !!MAPBOX_TOKEN;
}

// Mapbox URLs require a literal 3 or 6 char hex color (no '#'). Callers
// often pass `var(--color-accent, #FC5200)` which is a CSS expression — not
// a color value. Resolve CSS vars via getComputedStyle, then sanitize.
function resolveHexColor(input) {
  if (!input || typeof input !== 'string') return 'FC5200';
  let val = input.trim();
  // CSS var() — pull the resolved computed value (which will be a hex,
  // rgb(), or hsl() string). Fall back to the var()'s own fallback if the
  // document/computedStyle isn't available.
  if (val.startsWith('var(')) {
    try {
      const m = val.match(/var\((--[^,)\s]+)(?:\s*,\s*([^)]+))?\)/);
      if (m && typeof window !== 'undefined') {
        const computed = getComputedStyle(document.documentElement)
          .getPropertyValue(m[1]).trim();
        if (computed) val = computed;
        else if (m[2]) val = m[2].trim();
      }
    } catch { /* fall through */ }
  }
  // Hex form
  let m = val.match(/#?([0-9a-fA-F]{6})\b/) || val.match(/#?([0-9a-fA-F]{3})\b/);
  if (m) return m[1].toUpperCase();
  // rgb(r, g, b) / rgba(r, g, b, a)
  m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const toHex = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
    return (toHex(m[1]) + toHex(m[2]) + toHex(m[3])).toUpperCase();
  }
  return 'FC5200';
}

export function mapboxStaticUrlForRoute(route, opts = {}) {
  if (!MAPBOX_TOKEN) return null;
  if (!Array.isArray(route) || route.length < 2) return null;

  const width = Math.min(1280, Math.max(64, Math.round(opts.width ?? 600)));
  const height = Math.min(1280, Math.max(64, Math.round(opts.height ?? 600)));
  // Resolve CSS vars and validate — Mapbox URLs MUST be a literal 6-char hex.
  // Passing "var(--color-accent, #FC5200)" raw breaks the URL and Mapbox 422s.
  const accent = resolveHexColor(opts.accent);
  const style = opts.style || DEFAULT_STYLE;
  const strokeWidth = opts.strokeWidth ?? 5;

  // Decimate very dense routes to fit Mapbox's 8192-char URL limit. Sample
  // every Nth point so a 2-hour run with 10k fixes still fits.
  const maxPoints = 500;
  let pts = route;
  if (pts.length > maxPoints) {
    const step = Math.ceil(pts.length / maxPoints);
    pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }
  const encoded = encodePolyline(pts);
  const escaped = encodeURIComponent(encoded);

  // Path overlay spec: path-{stroke-width}+{color}-{opacity}({encoded})
  const path = `path-${strokeWidth}+${accent}-1(${escaped})`;

  const url = `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${path}/auto/${width}x${height}@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`;
  return url;
}

// Fetches the Mapbox URL and returns a data URL. Used by the share-card
// pre-renderer so the rasterizer sees an inline image (foreignObject can't
// load remote URLs at serialization time).
export async function fetchMapboxStaticDataUrl(route, opts = {}) {
  const url = mapboxStaticUrlForRoute(route, opts);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[mapboxStatic] HTTP', res.status, await res.text().catch(() => ''));
      return null;
    }
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[mapboxStatic] fetch failed:', err?.message || err);
    return null;
  }
}
