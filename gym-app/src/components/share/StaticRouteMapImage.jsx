// StaticRouteMapImage.jsx
// -----------------------------------------------------------------------------
// Renders the best-available route map image — pre-rendered cache, Mapbox,
// CartoDB tile stitcher, or route-only fallback. The fallback chain lives in
// renderRouteMap.js; this component just consumes the result and renders an
// <img>. Calls onReady once the image is fully decoded so the share-sheet
// rasterizer can wait for a stable frame before snapshotting.
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderRouteMap } from '../../lib/renderRouteMap';

export default function StaticRouteMapImage({
  route,
  width,
  height,
  accent = '#FC5200',
  borderRadius = 0,
  fallback = null,
  sessionId = null,
  onReady,
}) {
  const { t } = useTranslation('pages');
  const [src, setSrc] = useState(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let alive = true;
    if (!Array.isArray(route) || route.length < 2) { setSrc(null); return; }
    renderRouteMap({ route, width, height, accent, sessionId })
      .then((result) => { if (alive) setSrc(result?.src || null); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [route, width, height, accent, sessionId]);

  if (!src) {
    return fallback ?? (
      <div
        style={{
          width, height, borderRadius,
          background: '#1A1F25',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: 700,
        }}
      >
        {t('share.loadingMap', { defaultValue: 'Loading map…' })}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={t('share.routeMap', { defaultValue: 'Route map' })}
      onLoad={() => onReadyRef.current?.()}
      style={{
        width, height, borderRadius, display: 'block', objectFit: 'cover',
      }}
    />
  );
}
