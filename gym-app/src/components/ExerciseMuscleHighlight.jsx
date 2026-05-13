// ExerciseMuscleHighlight.jsx
//
// Replacement for the old BodyDiagram inside the exercise detail modal.
// Uses the same trainer image + polygon overlay the Recovery page and the
// Exercise Library body picker use, so the visual language stays consistent
// across the app. Primary regions render bright red, secondary regions
// render a lighter red — instantly readable.
//
// Sex-aware: reads `useAuth().profile.sex` to pick the male or female
// trainer images. Falls back to male if the female assets aren't deployed
// yet (the female trainer ships in a follow-up).

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FRONT_POLYGONS, BACK_POLYGONS, FRONT_DIM, BACK_DIM } from '../lib/musclePolygons';
import { MUSCLE_BUCKET_BY_ID } from '../lib/muscleBuckets';
import { useAuth } from '../contexts/AuthContext';

const PRIMARY_FILL = '#DC2626';   // red-600
const SECONDARY_FILL = '#FCA5A5'; // red-300

// Future-proof: when the female trainer assets ship, drop them at the
// paths below. Until then we just fall back to the male set.
const TRAINER_IMAGES = {
  male:   { front: '/readiness/male_trainer_front.jpeg',   back: '/readiness/male_trainer_back.jpeg' },
  female: { front: '/readiness/female_trainer_front.jpeg', back: '/readiness/female_trainer_back.jpeg' },
};
const FEMALE_AVAILABLE = false; // flip once the female JPEGs are committed

export default function ExerciseMuscleHighlight({
  primaryRegions = [],
  secondaryRegions = [],
  title,
}) {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const [view, setView] = useState('front');

  // Map an anatomical region ID to its localized human name, using the
  // same i18n keys the Recovery breakdown sheet uses. Drop dupes so e.g.
  // "Quads" doesn't appear twice when both quads + hip_flexors are listed.
  const labelFor = (regionId) => t(`readinessModal.regions.${regionId}`, { defaultValue: regionId });
  const dedupeLabels = (regions) => {
    const out = [];
    const seen = new Set();
    for (const r of regions) {
      const lbl = labelFor(r);
      if (!seen.has(lbl)) { seen.add(lbl); out.push(lbl); }
    }
    return out;
  };
  const primaryLabels = useMemo(() => dedupeLabels(primaryRegions), [primaryRegions]);
  const secondaryLabels = useMemo(() => dedupeLabels(secondaryRegions.filter((r) => !primaryRegions.includes(r))), [primaryRegions, secondaryRegions]);

  // Pick image set based on user profile sex. Fall back to male while the
  // female trainer assets aren't shipped yet.
  const setKey = useMemo(() => {
    const raw = (profile?.sex || '').toLowerCase();
    if (raw === 'female' && FEMALE_AVAILABLE) return 'female';
    return 'male';
  }, [profile?.sex]);
  const images = TRAINER_IMAGES[setKey];

  const primarySet = useMemo(() => new Set(primaryRegions), [primaryRegions]);
  const secondarySet = useMemo(() => new Set(secondaryRegions), [secondaryRegions]);

  const isFront = view === 'front';
  const polygons = isFront ? FRONT_POLYGONS : BACK_POLYGONS;
  const dim = isFront ? FRONT_DIM : BACK_DIM;
  const photo = isFront ? images.front : images.back;
  const vb = `0 0 ${dim.w} ${dim.h}`;
  const aspect = `${dim.w} / ${dim.h}`;

  const polygonFill = (poly) => {
    const bucket = MUSCLE_BUCKET_BY_ID.get(poly.bucketId);
    if (!bucket) return null;
    const hitsPrimary = bucket.regionIds.some((r) => primarySet.has(r));
    if (hitsPrimary) return { color: PRIMARY_FILL, opacity: 0.65 };
    const hitsSecondary = bucket.regionIds.some((r) => secondarySet.has(r));
    if (hitsSecondary) return { color: SECONDARY_FILL, opacity: 0.55 };
    return null;
  };

  return (
    <div>
      {title && (
        <p
          className="text-[11px] font-extrabold uppercase tracking-[0.12em] mb-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {title}
        </p>
      )}

      {/* Front / Back toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--color-surface-hover, rgba(15,20,25,0.05))',
            border: '1px solid var(--color-border-subtle)',
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

      {/* Trainer image + polygon overlay */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 280,
          margin: '0 auto',
          borderRadius: 14,
          background: 'var(--color-surface-hover, rgba(15,20,25,0.03))',
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
              const fill = polygonFill(poly);
              return (
                <polygon
                  key={poly.id}
                  points={poly.points}
                  fill={fill ? fill.color : 'rgba(0,0,0,0)'}
                  fillOpacity={fill ? fill.opacity : 0}
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth={1}
                  strokeLinejoin="round"
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}
          </svg>
        </div>
      </div>

      {/* Targeted-muscles list — shows the actual region names, not just
          color swatches. Primary row first (red), secondary row below. */}
      <div className="mt-4 flex flex-col gap-2">
        {primaryLabels.length > 0 && (
          <div className="flex items-start gap-2">
            <span
              style={{
                flexShrink: 0,
                marginTop: 2,
                width: 10, height: 10, borderRadius: 2,
                background: PRIMARY_FILL,
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('exerciseLibrary.primaryTargets', { defaultValue: 'Primario' })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {primaryLabels.map((label) => (
                  <span
                    key={`p-${label}`}
                    className="text-[11px] font-bold px-2 py-1 rounded-full"
                    style={{
                      background: `color-mix(in srgb, ${PRIMARY_FILL} 14%, transparent)`,
                      color: PRIMARY_FILL,
                      border: `1px solid color-mix(in srgb, ${PRIMARY_FILL} 28%, transparent)`,
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        {secondaryLabels.length > 0 && (
          <div className="flex items-start gap-2">
            <span
              style={{
                flexShrink: 0,
                marginTop: 2,
                width: 10, height: 10, borderRadius: 2,
                background: SECONDARY_FILL,
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('exerciseLibrary.secondaryTargets', { defaultValue: 'Secundario' })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {secondaryLabels.map((label) => (
                  <span
                    key={`s-${label}`}
                    className="text-[11px] font-bold px-2 py-1 rounded-full"
                    style={{
                      background: 'var(--color-surface-hover)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
