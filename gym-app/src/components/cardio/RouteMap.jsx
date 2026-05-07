// RouteMap.jsx
// -----------------------------------------------------------------------------
// Strava / Nike Run Club-style live route map built on Leaflet + OSM tiles.
// No API key, no billing — OpenStreetMap is free to use with attribution.
//
// Props:
//   points  — [{ lat, lng, t }, ...]   (live GPS snapshot from gpsTracker)
//   height  — px height of the map container (default 260)
//   follow  — auto-fit bounds when new points arrive (default true)
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Classic Leaflet-with-bundlers pain: default marker icons point to broken URLs
// after webpack/vite processes them. Rewire the default icon to the bundled
// PNGs explicitly so any vanilla L.Marker renders correctly.
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const ACCENT = '#2EC4C4';

// Pulsing dot for the current position. Implemented as a divIcon with inline
// CSS keyframes so it works without polluting the global stylesheet.
const pulseIcon = L.divIcon({
  className: 'tugympr-cardio-pulse',
  html: `
    <div style="position:relative;width:22px;height:22px;">
      <span style="
        position:absolute;inset:0;border-radius:9999px;
        background:${ACCENT};opacity:0.35;
        animation: tugympr-pulse 1.6s ease-out infinite;
      "></span>
      <span style="
        position:absolute;inset:5px;border-radius:9999px;
        background:${ACCENT};
        box-shadow:0 0 0 3px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.35);
      "></span>
    </div>
    <style>
      @keyframes tugympr-pulse {
        0%   { transform: scale(0.5); opacity: 0.6; }
        100% { transform: scale(2.4); opacity: 0;   }
      }
    </style>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Small circle marker for the starting point.
const startIcon = L.divIcon({
  className: 'tugympr-cardio-start',
  html: `
    <div style="
      width:12px;height:12px;border-radius:9999px;
      background:#ffffff;
      border:3px solid ${ACCENT};
      box-shadow:0 2px 5px rgba(0,0,0,0.3);
    "></div>
  `,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

// Internal helper: fits bounds whenever the polyline grows, throttled so we
// don't re-fit on every single GPS fix (which would cause the map to constantly
// jitter around as tiles reload).
function AutoFit({ positions, follow }) {
  const map = useMap();
  const lastFitCountRef = useRef(0);

  useEffect(() => {
    if (!follow || positions.length < 2) return;
    const n = positions.length;
    // Fit on the first pair, and then every 10th new point, to keep things stable.
    const delta = n - lastFitCountRef.current;
    if (lastFitCountRef.current === 0 || delta >= 10) {
      const bounds = L.latLngBounds(positions);
      try {
        map.fitBounds(bounds, { padding: [24, 24], animate: true, maxZoom: 17 });
      } catch {}
      lastFitCountRef.current = n;
    } else {
      // Otherwise just pan smoothly to the latest fix
      try {
        map.panTo(positions[n - 1], { animate: true, duration: 0.6 });
      } catch {}
    }
  }, [positions, follow, map]);

  return null;
}

export default function RouteMap({ points = [], height = 260, follow = true }) {
  // Leaflet wants [lat, lng] tuples, not {lat, lng} objects.
  const positions = useMemo(
    () => points.map((p) => [p.lat, p.lng]),
    // We intentionally key off length so the map only re-renders when a new
    // fix actually arrives — not on every React render upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points.length]
  );

  const start = positions[0];
  const current = positions[positions.length - 1];

  // Sensible initial view: if we have points, center on the latest; otherwise
  // a safe world-ish default (will be replaced on first fix).
  const initialCenter = current || [0, 0];
  const initialZoom = current ? 16 : 2;

  return (
    <div
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        height,
        background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
        // Leaflet tiles sometimes bleed 1px outside their container on iOS
        position: 'relative',
      }}
    >
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl={true}
        style={{ height: '100%', width: '100%' }}
      >
        {/* CartoDB Voyager — muted, Strava/Nike-style cartography. No API key.
            {r} selector requests retina tiles so the map stays crisp on iPhone. */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://osm.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={20}
        />

        {/* Route polyline — render with a darker outer casing underneath for
            the premium "track" look that Nike Run Club / Strava use. */}
        {positions.length >= 2 && (
          <>
            <Polyline
              positions={positions}
              pathOptions={{
                color: 'rgba(10,13,16,0.35)',
                weight: 8,
                opacity: 1,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
            <Polyline
              positions={positions}
              pathOptions={{
                color: ACCENT,
                weight: 5,
                opacity: 1,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
          </>
        )}

        {start && <Marker position={start} icon={startIcon} />}
        {current && <Marker position={current} icon={pulseIcon} />}

        <AutoFit positions={positions} follow={follow} />
      </MapContainer>
    </div>
  );
}
