// MuscleGroupPicker.jsx
//
// Visual primary/secondary muscle picker built on the trainer image +
// polygon overlay. Each polygon corresponds to a single anatomical
// bucket (Upper Chest, Front Delts, Lats, etc.) and is selectable
// independently — picking "Front Delts" does NOT also light up Side
// and Rear Delts. The form translates the chosen buckets back to
// muscle_group enum values on save.
//
// Both primary and secondary are multi-select arrays so a compound lift
// (e.g. bench → upper + mid chest, triceps, front delts) can be tagged
// properly. The mode pill decides whether the next tap goes into the
// primary or secondary set.
//
// API:
//   <MuscleGroupPicker
//     primaryBuckets={['chest-mid','front-delts']}
//     secondaryBuckets={['triceps']}
//     onPrimaryToggle={(bucketId) => ...}
//     onSecondaryToggle={(bucketId) => ...}
//   />

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMuscleAssets } from '../lib/musclePolygons';
import { useAuth } from '../contexts/AuthContext';

const PRIMARY_FILL   = '#DC2626';   // red-600
const SECONDARY_FILL = '#FCA5A5';   // red-300
const FALLBACK_FILL  = 'rgba(212,175,55,0.06)';
const STROKE         = 'rgba(0,0,0,0.55)';

export default function MuscleGroupPicker({
  primaryBuckets = [],
  secondaryBuckets = [],
  onPrimaryToggle,
  onSecondaryToggle,
  maxWidth = 320,
}) {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  // Sex-aware trainer photo + traced polygons (falls back to male).
  const assets = useMemo(() => getMuscleAssets(profile?.sex), [profile?.sex]);
  const [view, setView] = useState('front');
  const [mode, setMode] = useState('primary'); // 'primary' | 'secondary'

  const isFront = view === 'front';
  const polygons = isFront ? assets.FRONT_POLYGONS : assets.BACK_POLYGONS;
  const dim = isFront ? assets.FRONT_DIM : assets.BACK_DIM;
  const photo = isFront ? assets.FRONT_PHOTO : assets.BACK_PHOTO;
  const vb = `0 0 ${dim.w} ${dim.h}`;
  const aspect = `${dim.w} / ${dim.h}`;

  const primarySet = useMemo(() => new Set(primaryBuckets || []), [primaryBuckets]);
  const secondarySet = useMemo(() => new Set(secondaryBuckets || []), [secondaryBuckets]);

  const handleTap = (bucketId) => {
    if (!bucketId) return;
    if (mode === 'primary') {
      onPrimaryToggle?.(bucketId);
      return;
    }
    if (primarySet.has(bucketId)) return; // can't be both primary and secondary
    onSecondaryToggle?.(bucketId);
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Front / Back toggle */}
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
                onClick={() => setView(v)}
                style={{
                  padding: '5px 14px',
                  border: 'none',
                  borderRadius: 999,
                  background: active ? 'var(--color-bg-card)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : undefined,
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
        style={{
          position: 'relative',
          width: '100%',
          maxWidth,
          margin: '0 auto',
          borderRadius: 16,
          background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
          border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
          padding: 6,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', width: '100%', aspectRatio: aspect }}>
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
              filter: 'saturate(0.92) contrast(1.02)',
            }}
          />
          <svg
            viewBox={vb}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {polygons.map((poly) => {
              const isPrimary = primarySet.has(poly.bucketId);
              const isSecondary = !isPrimary && secondarySet.has(poly.bucketId);
              const fill = isPrimary ? PRIMARY_FILL : isSecondary ? SECONDARY_FILL : FALLBACK_FILL;
              const opacity = isPrimary ? 0.62 : isSecondary ? 0.55 : 0.3;
              const stroke = isPrimary ? PRIMARY_FILL : isSecondary ? SECONDARY_FILL : STROKE;
              return (
                <polygon
                  key={poly.id}
                  points={poly.points}
                  onClick={() => handleTap(poly.bucketId)}
                  fill={fill}
                  fillOpacity={opacity}
                  stroke={stroke}
                  strokeWidth={isPrimary ? 2.2 : isSecondary ? 1.8 : 1.2}
                  strokeLinejoin="round"
                  style={{ cursor: 'pointer', transition: 'fill 180ms, fill-opacity 180ms, stroke 180ms' }}
                />
              );
            })}
          </svg>
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12, gap: 8 }}>
        {[
          { key: 'primary',   label: t('exerciseLibrary.primaryMuscleLabel', 'Primary'),       dot: PRIMARY_FILL },
          { key: 'secondary', label: t('exerciseLibrary.secondaryMusclesLabel', 'Secondary'), dot: SECONDARY_FILL },
        ].map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 active:scale-95 transition-all"
              style={{
                background: active ? 'var(--color-bg-card)' : 'var(--color-surface-hover)',
                border: `1px solid ${active ? m.dot : 'var(--color-border-subtle)'}`,
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: m.dot, display: 'inline-block' }} />
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
