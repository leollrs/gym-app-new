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
  light = false,
  onReady,
}) {
  const { t } = useTranslation('pages');
  const [src, setSrc] = useState(null);
  // "Still fetching" and "every renderer failed" are different states. They used
  // to collapse into `!src`, so a failed map sat on "Loading map…" forever — and
  // because the card gets RASTERIZED for sharing, that placeholder was baked
  // into the image the member sent their friends.
  const [failed, setFailed] = useState(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let alive = true;
    if (!Array.isArray(route) || route.length < 2) { setSrc(null); setFailed(true); return; }
    setFailed(false);
    setSrc(null);
    renderRouteMap({ route, width, height, accent, sessionId, light })
      .then((result) => {
        if (!alive) return;
        if (result?.src) setSrc(result.src);
        else setFailed(true);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [route, width, height, accent, sessionId, light]);

  if (!src) {
    if (failed) {
      // Nothing to draw. Say so once, quietly — never a spinner-in-a-photo.
      return fallback ?? (
        <div
          style={{
            width, height, borderRadius,
            background: light ? '#E8E6DF' : '#14181C',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: light ? 'rgba(10,13,16,0.4)' : 'rgba(255,255,255,0.35)',
            fontSize: Math.max(12, Math.round(width * 0.055)), fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: 1.2,
            textAlign: 'center', padding: 12,
          }}
        >
          {t('share.noRoute', { defaultValue: 'No route' })}
        </div>
      );
    }
    return fallback ?? (
      <div
        style={{
          width, height, borderRadius,
          background: light ? '#E8E6DF' : '#1A1F25',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: light ? 'rgba(10,13,16,0.45)' : 'rgba(255,255,255,0.45)',
          fontSize: Math.max(12, Math.round(width * 0.05)), fontWeight: 700,
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
