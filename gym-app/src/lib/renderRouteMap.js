// renderRouteMap.js
// -----------------------------------------------------------------------------
// Single entry point for "give me a Strava-style route image". Walks a
// fallback chain so the share card always gets the best available render
// without the caller needing to know how the sausage is made:
//
//   1. IndexedDB cache hit (pre-rendered at Finish — instant, offline-safe)
//   2. Mapbox Static Images API (server-rendered real map, ~200ms)
//   3. CartoDB tile stitcher (client-side, ~1-2s, requires network)
//   4. Route-only stylized render (no tiles, always works, looks intentional)
//
// All paths return a `data:image/png;base64,…` URL. Callers don't care which
// layer produced it.
// -----------------------------------------------------------------------------

import { getCachedMapImageDataUrl, cacheMapImage, dataUrlToBlob } from './mapImageCache';
import { fetchMapboxStaticDataUrl, isMapboxConfigured } from './mapboxStatic';
import { generateStaticRouteMap, generateRouteOnlyImage } from './staticRouteMap';

export async function renderRouteMap({
  route,
  width,
  height,
  accent = '#FC5200',
  sessionId = null,
  // When true, skip the cache lookup (used by the pre-render-at-Finish flow
  // that intentionally forces a fresh render).
  skipCache = false,
} = {}) {
  if (!Array.isArray(route) || route.length < 2) return null;

  // Layer 1 — pre-rendered cache
  if (sessionId && !skipCache) {
    try {
      const cached = await getCachedMapImageDataUrl(sessionId);
      if (cached) {
        console.log('[renderRouteMap] source: cache', { sessionId });
        return { src: cached, source: 'cache' };
      }
    } catch {}
  }

  // Layer 2 — Mapbox (only if a token is configured)
  if (isMapboxConfigured()) {
    try {
      const url = await fetchMapboxStaticDataUrl(route, { width, height, accent });
      if (url) {
        console.log('[renderRouteMap] source: mapbox', { width, height });
        return { src: url, source: 'mapbox' };
      }
      console.warn('[renderRouteMap] mapbox configured but returned null — falling back');
    } catch (err) {
      console.warn('[renderRouteMap] mapbox threw:', err?.message);
    }
  } else {
    console.log('[renderRouteMap] mapbox not configured — skipping');
  }

  // Layer 3 — client-side CartoDB tile stitcher
  try {
    const url = await generateStaticRouteMap(route, width, height, { accent });
    if (url) {
      console.log('[renderRouteMap] source: stitched (CartoDB)');
      return { src: url, source: 'stitched' };
    }
  } catch {}

  // Layer 4 — route-only fallback (offline, no map, but still polished)
  try {
    const url = generateRouteOnlyImage(route, width, height, { accent });
    if (url) {
      console.log('[renderRouteMap] source: route-only fallback');
      return { src: url, source: 'route-only' };
    }
  } catch {}

  return null;
}

// Pre-render at Finish & Log: render once with the best available source and
// stash in IndexedDB keyed by session id. Subsequent share-sheet opens are
// instant because layer 1 hits.
//
// IMPORTANT: only cache real-map renders (mapbox / stitched). The route-only
// fallback is a client-render that we can always reproduce — caching it
// would poison the cache so that even after Mapbox starts working, the
// share sheet keeps showing the no-map version forever.
export async function prerenderAndCache({ route, width, height, accent, sessionId }) {
  if (!sessionId) return null;
  const result = await renderRouteMap({ route, width, height, accent, sessionId, skipCache: true });
  if (!result?.src) return null;
  if (result.source === 'route-only') {
    console.log('[renderRouteMap] skipping cache write — route-only fallback');
    return result;
  }
  try {
    const blob = await dataUrlToBlob(result.src);
    if (blob) await cacheMapImage(sessionId, blob);
  } catch (err) {
    console.warn('[renderRouteMap] cache write failed:', err?.message);
  }
  return result;
}
