// BodyMusclePicker.jsx
//
// Reusable picker built on top of the same trainer image + polygon data
// the Recovery modal uses. Tap a polygon → emit its bucket ID. Front/back
// toggle (swipe or chip). Selected bucket gets a blue stroke + glow so
// the user always knows which area is active.
//
// API:
//   <BodyMusclePicker
//      selected={bucketId | null}
//      onSelect={(bucketId) => ...}
//      view="front" | "back"           (optional; defaults to internal toggle)
//      onViewChange={(view) => ...}
//      maxWidth={number}                (px, default 420)
//   />

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FRONT_POLYGONS, BACK_POLYGONS, FRONT_DIM, BACK_DIM } from '../lib/musclePolygons';
import { MUSCLE_BUCKET_BY_ID } from '../lib/muscleBuckets';

const FRONT_PHOTO = '/readiness/male_trainer_front.jpeg';
const BACK_PHOTO = '/readiness/male_trainer_back.jpeg';
const SELECT_COLOR = '#3B82F6';
const HIGHLIGHT_COLOR = '#DC2626';
const FILL = 'rgba(212,175,55,0.08)';
const STROKE = 'rgba(0,0,0,0.6)';

function useHorizontalSwipe({ onLeft, onRight }) {
  const start = React.useRef(null);
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    onPointerUp: (e) => {
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      const dt = Date.now() - start.current.t;
      start.current = null;
      if (Math.abs(dx) < 50) return;
      if (Math.abs(dy) > Math.abs(dx) * 0.7) return;
      if (dt > 600) return;
      if (dx < 0) onLeft?.();
      else onRight?.();
    },
  };
}

export default function BodyMusclePicker({
  selected = null,
  onSelect,
  view: controlledView,
  onViewChange,
  maxWidth = 420,
  highlightedRegions = null, // array of region IDs (e.g. ['front_delts','triceps']) painted red
}) {
  const { t } = useTranslation('pages');
  // Resolve `highlightedRegions` once per change: a polygon is highlighted
  // if any of its bucket's regionIds appears in the highlight set.
  const highlightSet = useMemo(() => {
    if (!Array.isArray(highlightedRegions) || highlightedRegions.length === 0) return null;
    return new Set(highlightedRegions);
  }, [highlightedRegions]);
  const [internalView, setInternalView] = useState('front');
  const view = controlledView ?? internalView;
  const setView = (v) => {
    if (onViewChange) onViewChange(v);
    else setInternalView(v);
  };

  const isFront = view === 'front';
  const polygons = isFront ? FRONT_POLYGONS : BACK_POLYGONS;
  const dim = isFront ? FRONT_DIM : BACK_DIM;
  const photo = isFront ? FRONT_PHOTO : BACK_PHOTO;
  const vb = `0 0 ${dim.w} ${dim.h}`;
  const aspect = `${dim.w} / ${dim.h}`;

  const [flipDir, setFlipDir] = useState(null);
  useEffect(() => {
    if (!flipDir) return;
    const id = setTimeout(() => setFlipDir(null), 280);
    return () => clearTimeout(id);
  }, [flipDir]);

  const swipe = useHorizontalSwipe({
    onLeft: () => {
      if (view === 'front') { setFlipDir('left'); setView('back'); }
    },
    onRight: () => {
      if (view === 'back') { setFlipDir('right'); setView('front'); }
    },
  });

  return (
    <div style={{ width: '100%' }}>
      <style>{`
        @keyframes bmp-flip-left  { from { transform: translateX(40px);  opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes bmp-flip-right { from { transform: translateX(-40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>

      {/* Front / Back toggle pill */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--color-surface-hover, rgba(15,20,25,0.05))',
            border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
            borderRadius: 999,
            padding: 3,
          }}
        >
          {['front', 'back'].map((v) => {
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => {
                  if (v === view) return;
                  setFlipDir(v === 'back' ? 'left' : 'right');
                  setView(v);
                }}
                style={{
                  padding: '6px 18px',
                  border: 'none',
                  borderRadius: 999,
                  background: active ? 'var(--color-bg-card)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : undefined,
                  transition: 'background 160ms, color 160ms',
                }}
              >
                {v === 'front'
                  ? t('exerciseLibrary.front', { defaultValue: 'Front' })
                  : t('exerciseLibrary.back', { defaultValue: 'Back' })}
              </button>
            );
          })}
        </div>
      </div>

      {/* Figure card */}
      <div
        {...swipe}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth,
          margin: '0 auto',
          borderRadius: 18,
          background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
          border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
          padding: 8,
          overflow: 'hidden',
          touchAction: 'pan-y',
        }}
      >
        <div
          key={view}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: aspect,
            animation: flipDir ? `bmp-flip-${flipDir} 240ms cubic-bezier(0.2,0.8,0.2,1)` : undefined,
          }}
        >
          <img
            src={photo}
            alt={view}
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              userSelect: 'none',
              WebkitUserDrag: 'none',
              pointerEvents: 'none',
              filter: 'saturate(0.95) contrast(1.02)',
            }}
          />
          <svg
            viewBox={vb}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {polygons.map((poly) => {
              const isSel = selected === poly.bucketId;
              const bucket = MUSCLE_BUCKET_BY_ID.get(poly.bucketId);
              const isHighlighted = !isSel && highlightSet && bucket
                ? bucket.regionIds.some((r) => highlightSet.has(r))
                : false;
              const fillColor = isSel ? SELECT_COLOR : isHighlighted ? HIGHLIGHT_COLOR : FILL;
              const strokeColor = isSel ? SELECT_COLOR : isHighlighted ? HIGHLIGHT_COLOR : STROKE;
              return (
                <polygon
                  key={poly.id}
                  points={poly.points}
                  onClick={() => onSelect?.(poly.bucketId)}
                  fill={fillColor}
                  fillOpacity={isSel ? 0.55 : isHighlighted ? 0.5 : 0.35}
                  stroke={strokeColor}
                  strokeWidth={isSel ? 3 : isHighlighted ? 2 : 1.4}
                  strokeLinejoin="round"
                  style={{
                    cursor: 'pointer',
                    transition: 'fill 200ms, stroke 200ms, fill-opacity 200ms, stroke-width 200ms',
                    filter: isSel
                      ? 'drop-shadow(0 0 6px rgba(59,130,246,0.65))'
                      : isHighlighted
                      ? 'drop-shadow(0 0 4px rgba(220,38,38,0.5))'
                      : undefined,
                  }}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
