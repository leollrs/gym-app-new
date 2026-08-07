import { useState } from 'react';
import { getMuscleAssets } from '../lib/musclePolygons';
import { aggregateRegions } from '../lib/readinessEngine';
import { BUCKET_BY_ID, STATE_HEX } from '../lib/readinessBuckets';

// Standalone anatomical muscle figure — the same photo + traced polygons the
// member sees in ReadinessModal, painted by a readiness Map (region → state).
// Reusable read-only viz: front/back toggle, no detail sheet. Used on the
// trainer side to show a client's recovery, but app-agnostic.
//
// Props:
//   readiness : Map from computeReadiness(sessions, { windowDays })
//   sex       : 'male' | 'female' (optional; falls back to the male assets)
//   accent    : active-toggle color (default teal)
//   maxWidth  : figure max width in px
//   onMuscleTap      : (bucketId) => void — makes muscles tappable (optional)
//   selectedBucketId : currently-highlighted bucket id (optional)
export default function MuscleFigure({ readiness, sex, accent = '#19B8B8', maxWidth = 320, labels = {}, onMuscleTap, selectedBucketId }) {
  const [view, setView] = useState('front');
  const isFront = view === 'front';
  const assets = getMuscleAssets(sex);
  const photo = isFront ? assets.FRONT_PHOTO : assets.BACK_PHOTO;
  const polygons = isFront ? assets.FRONT_POLYGONS : assets.BACK_POLYGONS;
  const dim = isFront ? assets.FRONT_DIM : assets.BACK_DIM;
  const vb = `0 0 ${dim.w} ${dim.h}`;

  const pill = (v, label) => {
    const on = view === v;
    return (
      <button key={v} type="button" onClick={() => setView(v)}
        style={{
          padding: '6px 16px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer',
          border: on ? 'none' : '1px solid var(--color-border-default)',
          background: on ? accent : 'transparent',
          // Theme-aware: hardcoded near-black was invisible on dark.
          color: on ? '#fff' : 'var(--color-text-secondary)',
        }}>
        {label}
      </button>
    );
  };

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 10 }}>
        {pill('front', labels.front || 'Front')}
        {pill('back', labels.back || 'Back')}
      </div>
      <div style={{
        position: 'relative', width: '100%', maxWidth, margin: '0 auto',
        borderRadius: 18, background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)', padding: 8, overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: `${dim.w} / ${dim.h}` }}>
          <img
            src={photo} alt={view} draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none', pointerEvents: 'none', filter: 'saturate(0.95) contrast(1.02)' }}
          />
          <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {polygons.map((poly) => {
              const bucket = BUCKET_BY_ID.get(poly.bucketId);
              const agg = bucket ? aggregateRegions(readiness, bucket.regionIds) : { state: 'fresh' };
              const c = STATE_HEX[agg.state] || STATE_HEX.rest;
              const isSel = !!selectedBucketId && poly.bucketId === selectedBucketId;
              const tappable = !!onMuscleTap && !!bucket;
              return (
                <polygon
                  key={poly.id}
                  points={poly.points}
                  onClick={tappable ? () => onMuscleTap(poly.bucketId) : undefined}
                  fill={c}
                  fillOpacity={isSel ? 0.85 : 0.55}
                  stroke={isSel ? accent : 'rgba(0,0,0,0.6)'}
                  strokeWidth={isSel ? 3 : 1.4}
                  strokeLinejoin="round"
                  style={tappable ? { cursor: 'pointer', transition: 'fill-opacity .2s, stroke .2s, stroke-width .2s', filter: isSel ? `drop-shadow(0 0 6px ${accent}aa)` : undefined } : undefined}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
