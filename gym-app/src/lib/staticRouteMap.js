// staticRouteMap.js
// -----------------------------------------------------------------------------
// Renders a Strava-style static map image of a GPS route by:
//   1. Computing the route bounding box
//   2. Picking the zoom level that fits the box into the requested canvas
//   3. Fetching the OSM/CartoDB raster tiles needed to cover that area
//   4. Stitching tiles onto a canvas
//   5. Drawing the polyline (with start/end markers) on top
//   6. Returning a `data:image/png;base64,…` URL ready to drop into an <img>
//
// All tile fetches go to https://*.basemaps.cartocdn.com (already whitelisted
// in our CSP). No API key, no quota — that's why we picked CartoDB Voyager in
// the live tracker too.
// -----------------------------------------------------------------------------

const TILE_SIZE = 256;

// Lon/lat → world pixel coords at given zoom (Web Mercator, no projection libs)
function project(lat, lng, zoom) {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * TILE_SIZE * Math.pow(2, zoom);
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
    TILE_SIZE *
    Math.pow(2, zoom);
  return { x, y };
}

function bounds(route) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of route) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

// Pick the highest zoom (most detail) where the route still fits the canvas
// with some padding.
function pickZoom(route, w, h, padding = 24) {
  const b = bounds(route);
  for (let z = 18; z >= 1; z--) {
    const tl = project(b.maxLat, b.minLng, z);
    const br = project(b.minLat, b.maxLng, z);
    if (br.x - tl.x + padding * 2 <= w && br.y - tl.y + padding * 2 <= h) {
      return z;
    }
  }
  return 1;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function generateStaticRouteMap(route, w, h, opts = {}) {
  if (!Array.isArray(route) || route.length < 2) return null;
  const accent = opts.accent || '#FC5200'; // Strava orange by default
  const padding = opts.padding ?? 28;

  const zoom = pickZoom(route, w, h, padding);

  // Center the route in the canvas
  const b = bounds(route);
  const tl = project(b.maxLat, b.minLng, zoom);
  const br = project(b.minLat, b.maxLng, zoom);
  const routeW = br.x - tl.x;
  const routeH = br.y - tl.y;
  const offsetX = (w - routeW) / 2 - tl.x;
  const offsetY = (h - routeH) / 2 - tl.y;

  // Tile grid that covers the canvas
  const minTileX = Math.floor(-offsetX / TILE_SIZE);
  const maxTileX = Math.floor((w - offsetX) / TILE_SIZE);
  const minTileY = Math.floor(-offsetY / TILE_SIZE);
  const maxTileY = Math.floor((h - offsetY) / TILE_SIZE);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Light backdrop in case some tiles fail to load
  ctx.fillStyle = '#E8E6DF';
  ctx.fillRect(0, 0, w, h);

  // Stitch tiles. Use Voyager (light + muted). Subdomains a/b/c/d for parallel.
  const subdomains = ['a', 'b', 'c', 'd'];
  const tilePromises = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const sub = subdomains[(tx + ty) % subdomains.length];
      const url = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}@2x.png`;
      const dx = offsetX + tx * TILE_SIZE;
      const dy = offsetY + ty * TILE_SIZE;
      tilePromises.push(
        loadImage(url)
          .then((img) => ctx.drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE))
          .catch(() => {/* tile missing — leave backdrop */}),
      );
    }
  }
  await Promise.all(tilePromises);

  // Draw route polyline
  const points = route.map((p) => {
    const pt = project(p.lat, p.lng, zoom);
    return { x: pt.x + offsetX, y: pt.y + offsetY };
  });

  // White casing first (Strava-style "halo"), then accent stroke on top
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  // Start marker (white circle w/ accent ring)
  const start = points[0];
  const end = points[points.length - 1];
  function marker(p, fill) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = fill;
    ctx.stroke();
  }
  marker(start, accent);
  marker(end, '#0A0D10');

  return canvas.toDataURL('image/png');
}

// ── Route-only fallback ──────────────────────────────────────────────────────
// When neither Mapbox nor the CartoDB tile stitcher can fetch tiles (offline,
// CSP block, etc.), render the polyline alone on a stylized dark backdrop
// with subtle topographic noise lines. Same big-stats card layout — looks
// intentional, not broken. Strava itself does this when no map is available.
export function generateRouteOnlyImage(route, w, h, opts = {}) {
  if (!Array.isArray(route) || route.length < 2) return null;
  const accent = opts.accent || '#FC5200';
  const padding = opts.padding ?? 36;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Dark gradient backdrop
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1A1F25');
  grad.addColorStop(1, '#0A0D10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle topographic-style horizontal noise lines
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y * 0.07) * 3);
    ctx.lineTo(w, y + Math.cos(y * 0.05) * 3);
    ctx.stroke();
  }

  // Project route into the canvas using a simple equirectangular fit
  const b = bounds(route);
  const latRange = Math.max(1e-6, b.maxLat - b.minLat);
  const lngRange = Math.max(1e-6, b.maxLng - b.minLng);
  const midLat = (b.minLat + b.maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  const scale = Math.min(innerW / (lngRange * lngScale), innerH / latRange);
  const offsetX = (innerW - lngRange * lngScale * scale) / 2 + padding;
  const offsetY = (innerH - latRange * scale) / 2 + padding;
  const points = route.map((p) => ({
    x: offsetX + (p.lng - b.minLng) * lngScale * scale,
    y: h - (offsetY + (p.lat - b.minLat) * scale),
  }));

  // White halo + accent stroke (same look as the real-map version)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  // Markers
  function marker(p, fill) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = fill;
    ctx.stroke();
  }
  marker(points[0], accent);
  marker(points[points.length - 1], '#0A0D10');

  return canvas.toDataURL('image/png');
}
