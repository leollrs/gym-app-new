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
export default function MuscleFigure({ readiness, sex, accent = '#19B8B8', maxWidth = 320, labels = {} }) {
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
          border: on ? 'none' : '1px solid rgba(15,20,25,0.12)',
          background: on ? accent : 'transparent',
          color: on ? '#fff' : 'rgba(15,20,25,0.55)',
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
        borderRadius: 18, background: 'rgba(15,20,25,0.04)',
        border: '1px solid rgba(15,20,25,0.08)', padding: 8, overflow: 'hidden',
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
              return (
                <polygon
                  key={poly.id}
                  points={poly.points}
                  fill={c}
                  fillOpacity={0.55}
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
